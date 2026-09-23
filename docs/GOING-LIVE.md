# Going live with real data

From an empty system to a closed deal, naming who does what at each step.

This is the practical companion to `WALKTHROUGH.md`. The walkthrough shows you
the features; this one gets SolarBros' own information in and takes one real
customer all the way through.

---

## 0. Put the branding in

Drop the logo at **`public/solarbroslogo.jpg`** — that exact path and filename.

Everything in `public/` is copied to the site root untouched, so the file is
reachable at a fixed URL. That matters for a favicon, which the browser fetches
before any JavaScript runs and therefore cannot be a bundled asset with a hashed
name. One file now serves both the browser tab and the logo in the app header.

```
public/
  solarbroslogo.jpg     <- put it here
  robots.txt
```

If it is missing, nothing breaks: the tab falls back to the browser's blank
icon and the header falls back to a drawn sun. That is deliberate — a
broken-image box on every screen is a worse failure than a plain one.

> **A JPG will work but is not the ideal icon.** It has no transparency, so a
> non-square logo gets letterboxed against white, and on the dark sidebar it
> shows as a white tile. The component sits it on a rounded backing so that
> reads as intentional. If you can export a **square PNG with a transparent
> background**, save it as `solarbroslogo.png`, and tell me — it is a two-line
> change and it will look noticeably cleaner.

The company name in the tab and beside the logo comes from the
`company.name` setting, not from the code, so changing it in **Business
Settings** changes it everywhere.

---

## 1. Clear the worked example

The system currently contains a full demonstration: sample customers, a signed
contract, a project mid-installation. Useful for learning the screens, wrong to
build on.

Open the **Supabase SQL editor**, paste in `supabase/reset-to-production.sql`,
and read it before you run it. It prints what survived.

It is more thorough than `clear-demo-data.sql`: it also removes **every user
account**, so the system afterwards has nobody who can sign in. That is the
point — the next step is you creating the first administrator.

`npm run audit:data` reports what is actually left, any time.

It keeps your business settings and the website content, and removes every
lead, project, invoice, ticket and account.

> Do this once, when you are ready. If you want the demo back afterwards you
> will need to re-run the seed migration, so make the decision deliberately.

---

## 2. Put the company's own details in

**As Administrator → Business Settings.**

Work down the categories. The ones that matter before anybody uses the system:

| Setting                                                           | Why it cannot wait                                                                                                                                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `company.*` — name, email, phone, address, hours                  | Printed on every quotation, receipt and turnover certificate                                                                                                                                  |
| `finance.bank_name`, `bank_account_name`, `bank_account_number`   | **A customer cannot pay you until these are filled in.** The billing page hides the panel entirely while they are blank, rather than showing an empty account number for somebody to guess at |
| `finance.gcash_number`                                            | Optional. Shown next to the bank details for smaller amounts                                                                                                                                  |
| `finance.down_payment_pct` / `delivery_pct` / `commissioning_pct` | Must total 100. These decide what each milestone invoice is worth                                                                                                                             |
| `sales.discount_authority_pct`                                    | How much a rep may discount before an administrator has to approve it. Enforced by the database, not the screen                                                                               |
| `warranty.*`                                                      | Printed on the turnover certificate the customer keeps                                                                                                                                        |

> **Dual control on payments is currently off.** `finance.dual_control_threshold`
> is `0`, which the system reads as "off" — an accountant records a payment and
> it counts immediately. Set it to an amount to require a second person above
> that figure. Worth turning on as the team grows.

---

## 3. Get the people in

Read **`docs/AUTH-SETUP.md`** first and do the dashboard configuration in it —
email confirmation, the reset-code template and real SMTP. The application
assumes all three.

### Point the auth emails at the deployed site, not at your laptop

Do this **before** anybody registers on the live site, or every confirmation and
password-reset link will be broken.

The application builds each link from `window.location.origin`, so a visitor who
registers at `https://solarbros.vercel.app` gets a link back to that address. The
reason your test link said `http://localhost:5173` is simply that you registered
from a dev server, and `localhost` on your phone means _the phone itself_ — which
is running nothing. On your laptop the same link worked because there, localhost
really was the dev server. **This resolves itself on deployment.**

What does _not_ resolve itself is Supabase's allowlist. Supabase only honours the
address the app asks for if that address is on the list; anything else silently
falls back to the **Site URL**. So an unconfigured project sends everybody to
whatever that field happens to say — often still `http://localhost:3000`.

In the Supabase dashboard, **Authentication → URL Configuration**:

| Field         | Set it to                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Site URL      | `https://your-production-domain` — the fallback, and where a link with no explicit target goes                              |
| Redirect URLs | Add `https://your-production-domain/**`. Keep `http://localhost:5173/**` as a second entry so local development still works |

The `/**` wildcard matters: the app sends people to `/login`, `/staff/login` and
`/reset-password` depending on who they are, and a bare origin with no wildcard
matches none of those.

Afterwards, register one throwaway account on the live site and open the email on
a phone that is **not** on your home network. That is the only way to be sure the
link does not depend on something local.

### The first administrator

By hand, in the Supabase dashboard. This is the only way an administrator is
ever made, and the last step of `supabase/reset-to-production.sql` has the exact
statements.

### Everybody else registers themselves

Send new employees the link to **`/staff/register`**. It is not reachable from
anywhere on the site. They enter their own details and choose the role the
company gave them.

That claim grants **nothing**. The account is created on the `client` role and
inactive, so the database refuses it everything until you approve it.

### You approve them

**Roles & Access** shows everyone waiting, with the role each has claimed. Check
it is the role they were actually given, then confirm — there is a dialog
restating who and which role, because the approve and refuse buttons sit next to
each other on a list.

| Role                | Lands on             | Can reach                                                       |
| ------------------- | -------------------- | --------------------------------------------------------------- |
| `sales`             | Leads & Pipeline     | CRM, quotations, projects, tickets, website content, settings   |
| `project_engineer`  | Projects             | Projects, dispatch, permits, tickets, inventory, settings       |
| `inventory_manager` | Inventory            | Inventory, purchasing, assets, warranty approvals, settings     |
| `accountant`        | Invoicing            | Invoicing, payroll, purchasing, quotations, analytics, settings |
| `technician`        | Today (field portal) | The mobile job portal only                                      |
| `admin`             | Analytics            | Everything, plus governance, audit log and the outbox           |

> **Roles cannot be toggled anywhere in the application.** Approving a
> registration is the only route, enforced by a database trigger rather than by
> the absence of a dropdown — an administrator with full UPDATE rights on
> `profiles` still cannot set one. A customer can never be made staff at all.
>
> Refusing somebody keeps their account, inactive, so they can be approved later
> if they simply picked the wrong role. Nothing is deleted.

> Typing another role's URL bounces you to your own landing page rather than
> opening an empty screen. That is a navigation guard, not the security
> boundary — the database refuses the data regardless, which is what
> `npm run verify:rls` checks.

---

## 4. Stock the catalogue

**As Inventory Manager → Inventory → + New item.**

Every product you sell or fit. The SKU must be unique and appears on purchase
orders.

Tick **carries a serial number** for panels, inverters and batteries. That flag
decides whether a technician is asked to scan each unit on site, which is what
makes a warranty claim possible years later.

Put the **opening stock** in on the form. It is recorded as a receipt movement
rather than as a starting number, so the ledger explains the balance from the
very first unit.

Then **Purchasing → Suppliers** for whoever you buy from, with their lead times.

---

## 5. Publish the public site

**As Sales or Administrator → Website Content.**

Packages, portfolio items, blog posts and customer reviews. The public site
reads these directly — there is no separate copy — so anything you publish here
is live immediately.

At minimum before you send anyone to the site: three packages, and enough
portfolio entries that the gallery is not one lonely card.

---

## 6. Now take one customer all the way through

This is the part to rehearse before the demonstration. Each step names the role
that does it.

### The prospect finds you

**Public site.** They use **Estimator**, or **Book a Visit**, or **Contact**.

All three create a real lead. The estimator additionally stores the appliance
answers behind it, so the rep can see how the size was arrived at.

> Booking enforces 24 hours' notice and a capacity limit per slot, both checked
> at the moment of writing. Two people cannot be promised the same 9am.

### Sales qualifies it

**As Sales → Leads & Pipeline.**

1. The lead is at **New**. Open **Edit** to correct anything mistyped — a lead
   captured on a phone usually has one wrong digit in the mobile number.
2. **Move stage** to **Contacted**, then **Qualified** as you learn more.
3. The score is recomputed by the database from the bill and the answers. You
   do not set it.

### Sales quotes

**As Sales → Quotations & BOM.**

Build the quotation against the catalogue from step 4. The lines you choose
become the **bill of materials**, and that is what will later reserve stock and
show on the project's Materials tab.

> A discount beyond `sales.discount_authority_pct` needs an administrator. The
> rule is in a database trigger, so it applies however the quotation is saved.

### The customer signs

**As the customer**, in their portal — or in person on a laptop.

1. Sales sends the contract. The customer sees it under **Contracts**.
2. They sign it.
3. **Sales or Administrator counter-signs.** This is the hinge of the whole
   system. Counter-signing:
   - creates the **project** and its seven milestones,
   - **reserves the stock** the BOM needs,
   - raises the **down-payment invoice**,
   - notifies the customer.

> The customer can only ever change the signature field on their own contract.
> Everything else — value, payment split, our counter-signature — is refused by
> a trigger, which `npm run verify:contracts` proves.

### The customer pays the deposit

**They transfer to the bank details from step 2**, quoting the invoice number.

**As Accountant → Invoicing → Record payment.** Enter what arrived, the method
and the bank reference. The invoice balance and the project total both move.

> Overpayment is refused with the balance named. A recorded payment cannot be
> edited afterwards — a correction is a **Refund** plus a fresh entry, which
> keeps the ledger a ledger.

### Engineering gets it ready

**As Project Engineer:**

- **Permits** — file each one, then record the authority's decision on their
  behalf. Those entries are audited at `warning` severity so a later reader can
  tell an external decision from an employee's assertion of one.
- **Projects → the project → Materials** — check every line reads **Reserved**
  rather than **Short**. A shortfall is closed by **Purchasing**.
- **Dispatch board** — book the installation and assign a crew.

> Structural mounting will not complete until permits **and** materials are both
> clear. An administrator can override that, and the override is audited.

### The crew installs

**As Technician**, on a phone, at the site.

1. **Today** — the assigned job.
2. Tick milestones as they finish. The customer watches this update live.
3. **Logging** — scan each serialised unit and record materials consumed. The
   scan is what creates the warranty record.
4. **Complete job** — capture the customer's name as sign-off.

> The field portal queues writes when there is no signal and syncs when there
> is. The **Account** tab shows how many are still pending — check it before
> driving away.

### The remaining invoices raise themselves

Completing **materials delivered** raises the delivery invoice; completing
**commissioning** raises the final one. Neither is typed by anybody, which is
what keeps a charge tied to work that actually happened.

Record each payment as before.

### Turnover

**As Project Engineer or Administrator:**

1. Complete the **turnover** milestone.
2. Set the project to **Completed**.
3. **Generate turnover certificate** → **Print or save as PDF**. Upload the
   saved file to the project's Documents so the customer has it in their vault.

### After the sale

- The customer sees their serial numbers under **Warranty**.
- They raise a **Support ticket**; the office replies in the same thread, can
  keep an internal note the customer never sees, and can turn the ticket into a
  scheduled repair visit.
- They can request a **system upgrade**, which arrives back on the CRM board as
  a referral-sourced lead — the shortest sales cycle you have.

---

## 7. Check the whole thing still holds

```bash
npm run verify:rls           # every role sees only what it should
npm run verify:forms         # the three public entry points
npm run verify:onboarding    # prospect becomes a customer
npm run verify:contracts     # signing, and what a customer may not touch
npm run verify:payments      # provenance, overpayment, refunds, dual control
npm run verify:procurement   # requisition limit, goods receipt
npm run verify:milestones    # ordering and the synchronise gate
npm run verify:notifications # exactly-once delivery
npm run verify:interconnect  # a write by one role, read by another
npm run verify:support       # tickets, uploads, upgrade requests
npm run verify:settings      # settings actually drive behaviour
npm run verify:staff         # what an approved role reaches; deactivation revokes
npm run verify:staff-approval # registration grants nothing; only approval moves a role

# Housekeeping
npm run audit:data           # what is actually in the database right now
npm run clean:probes         # clear records left by an interrupted verification run
```

Run them against the real data too, not just the demo. Every suite now creates
the fixtures it needs — a stock item, a supplier, a serialised unit — rather
than borrowing seeded ones, so they work on a completely empty system and clean
up after themselves.

Two things to know:

- **A crashed run cannot reach its own cleanup**, and the leftovers make the
  next run report a cleanup failure that looks like a real bug. `npm run
clean:probes` clears them.
- **The staff suites skip rather than fail** when Supabase's built-in email
  sender hits its rate limit of roughly two messages an hour. Configure SMTP
  (see `docs/AUTH-SETUP.md`) and they run properly — and so does real staff
  registration, which uses the same path.

---

## What the system deliberately does not do

Worth knowing before somebody asks in a demonstration.

- **No card or e-wallet checkout.** Payments arrive by bank transfer and are
  recorded by staff. The gateway was removed rather than switched off.
- **No payroll calculation.** SSS, PhilHealth, Pag-IBIG and withholding tax are
  worked out wherever you do payroll today and entered as one deductions
  figure. The register totals what you give it.
- **Refunds are recorded here, moved elsewhere.** The ledger entry, the cap and
  the reason are real; returning the money is still a bank transfer.
- **Multi-factor authentication and session expiry** are configured in the
  Supabase Auth dashboard, not in this application.
- **Executive analytics aggregate in the browser.** Every figure is real, but
  they belong in Postgres views before this carries years of data.
