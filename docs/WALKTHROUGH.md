# The walkthrough

One pass through the system in the order the business actually works: a stranger
on the website becomes a customer with a working solar installation, and every
staff role does its part along the way.

Follow it once and you will have exercised every screen and left behind a
realistic set of records.

**Have a phone out as well as a laptop.** The field portal and the public site
are built for a phone, and reviewing them on a large monitor tells you nothing
about whether they work.

---

## Part 0 — Accounts

### Where accounts come from

There is no panel on the login screen that signs you in as any role, and there
are no demo accounts. Both were removed deliberately: anything that hands out a
staff session is a way in, and a way in on a public page is a way in for
everybody.

| Who                     | How they get an account                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| The first administrator | Created by hand in Supabase. No page can produce one                               |
| Other staff             | They register at `/staff/register`, claim a role, and an administrator approves it |
| Customers               | They register at `/register`, and are clients permanently                          |

### Create the administrator

Supabase dashboard → **Authentication → Users → Add user**. Enter an email and
password and tick _Auto Confirm User_, so you are not waiting on an email.

Then in **SQL Editor**:

```sql
select public.grant_admin('YOUR-ADMIN-EMAIL@example.com');
```

It replies `… is now an administrator (was client)`. Run it again for a second
administrator whenever you need one.

**A plain `update public.profiles set role = 'admin'` will be refused**, and
that is deliberate — a trigger rejects every change to `profiles.role` that has
not come through an approved route, whoever is asking and whichever key they
hold. `grant_admin` is one of those routes and is reachable only over a direct
database connection, never from a browser. Every use writes a `critical` audit
row.

### The fast way to set the rest of the team up

Supabase's built-in email sender allows roughly **two messages an hour**, which
is not enough to register five people in one sitting. So do not register them.

For each of the five staff roles: **Authentication → Users → Add user**, tick
_Auto Confirm User_ — that sends no email at all — then in the SQL editor:

```sql
select public.grant_staff_role('them@company.com', 'project_engineer');
```

Valid roles: `sales`, `project_engineer`, `inventory_manager`, `accountant`,
`technician`.

Five accounts in five minutes instead of an afternoon of waiting. The
self-registration flow at `/staff/register` still exists and is the right route
for a real hire — try it once with a throwaway address so you have seen the
approval queue work.

### Decide your addresses

Gmail's `+` trick is useful here: `you+sales@gmail.com` and
`you+admin@gmail.com` are different accounts that both arrive in your one inbox.

| Role              | Lands on           | Your email |
| ----------------- | ------------------ | ---------- |
| Administrator     | `/admin`           |            |
| Sales             | `/admin/crm`       |            |
| Project Engineer  | `/admin/projects`  |            |
| Inventory Manager | `/admin/inventory` |            |
| Accountant        | `/admin/finance`   |            |
| Field Technician  | `/field`           |            |
| Customer          | `/portal`          |            |

Each role lands on the page it works in, not on a dashboard half of them cannot
read.

### Roles cannot be toggled

Approve a registration at **Roles & access** (`/admin/governance`). You can
approve somebody as a _different_ role than they claimed — a new hire ticking
the wrong box should not need a developer.

Afterwards there is no dropdown to change it. A role is set once, and changing
it means `grant_staff_role` in the SQL editor. That is deliberate: the common
disaster is not a malicious administrator, it is a tired one clicking the wrong
row.

Customers are permanent. Try to promote one from anywhere — the governance
screen, the SQL editor, the service key — and the database refuses.

### Seeing two roles at once

Duplicating a browser tab will not work, and this trips everybody up once.

Supabase keeps the session in `localStorage`, which every tab of the same
browser profile shares, and it broadcasts sign-in and sign-out. Signing in as
the administrator in one tab makes the other tab the administrator too.
**That is correct**, and it is what you want in production.

Two people on two devices never share anything. To see two roles at once
yourself, use a second browser profile (Chrome: avatar → Add). Incognito gets
you two at a time and no more, because all incognito windows share one session.

---

## Part 0.5 — Before the first quotation

**Skip this and the sales flow will produce a ₱0 quotation that cannot become a
contract.** It is the one piece of setup the system genuinely cannot do without.

The quote builder prices its bill of materials from your stock catalogue. A
starter catalogue ships with the system — panels, inverters, batteries, racking
and cable at indicative trade prices — so the flow works on day one.

**As Inventory Manager → Inventory.** Correct the unit costs against a real
supplier invoice. Everything downstream is arithmetic on these numbers: the
bill of materials, the quoted price, the margin the rep sees, and the purchase
orders raised from shortfalls.

Two things worth knowing:

- **`on_hand` starts at zero for everything**, on purpose. Stock arrives by
  receiving a purchase order. Inventing stock would put a number on the
  warehouse screen that nobody can go and count.
- **Suppliers are placeholders.** Replace the three seeded ones with your real
  suppliers under Purchasing before raising an order.

Also worth setting now, as Administrator → **Business Settings**:

| Setting                                                           | Why it cannot wait                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `finance.bank_name`, `bank_account_name`, `bank_account_number`   | **A customer cannot pay you until these are filled in.** The billing page hides the panel entirely while they are blank |
| `finance.down_payment_pct` / `delivery_pct` / `commissioning_pct` | Must total 100. A contract is refused otherwise, and these decide what each milestone invoice is worth                  |
| `pricing.*`                                                       | The public estimator quotes from these. They are readable signed out, so changing one changes what a visitor is told    |

---

## Part 1 — A stranger becomes a lead

**As nobody. Public site, on your phone.**

1. `/` — the home page. Then `/packages`, which lists the hybrid range at its
   real array sizes.
2. `/estimator`. Tick the appliances a household runs: a couple of aircon units,
   a fridge, a rice cooker, lights. Set the hours. Watch the peso figure appear
   beside each line — that, rather than any marketing copy, is what explains a
   customer's bill to them.
3. Set the usage pattern to **Mostly at night**. The recommendation changes from
   on-grid to hybrid, because a household that uses power after dark needs
   somewhere to put the daytime surplus.
4. Enter your monthly bill. The page cross-checks your appliance list against it
   and says if the two disagree.
5. Submit the estimate with a name and email.

Then, separately, try the other two ways in: **`/contact`** for a personalised
quotation, and **`/booking`** for a site visit.

---

## Part 2 — What came in from the website

**Sign in as Sales at `/staff/login`.** Go to **Enquiries** (`/admin/enquiries`).

This is the page a rep opens first each morning. Everything the public site
collected is here with the contact details needed to answer it — the email as a
one-tap `mailto`, the phone as a `tel`, and the message they actually typed.

1. **Quotation requests** tab. Open the enquiry from `/contact`. Press **Email**
   — your own mail client opens with the subject filled in.
2. Press **Mark as contacted**. The "Awaiting a reply" tile drops by one.
3. Later, when you have actually sent the PDF, press **I have sent the
   quotation**. The lead moves to the `quoted` stage on the CRM board.
4. **Visit requests** tab. Confirm the booking from `/booking`. It appears on
   the dispatch board for crew assignment.
5. **Calendar availability** tab. Close a date — a public holiday — and check
   `/booking` greys it out.

> **This system does not send the quotation.** The rep attaches the PDF in their
> own mail client, where they can write a covering note and see it in sent
> items. What this page does is make the address one tap away and record that it
> was done.

**A prospect has no account yet, and that is fine.** They are tracked by email.
If they later register with the same address, every lead, contract, project,
invoice and appointment carrying that address is attached to the new account
automatically.

---

## Part 3 — Sales quotes it

**Still as Sales.** `/admin/crm`, then `/admin/quotes`.

1. On the CRM board, **drag the lead** to _Contacted_. It should stay after a
   refresh. On a phone, or from a keyboard, use the **Move stage** button —
   dragging is an enhancement, not the only route.
2. Go to **Quotations & BOM**. Pick the lead and a package. The bill of
   materials builds itself from the catalogue, labour comes from settings, and
   the margin starts at the configured target.
3. Watch the **vs advertised** figure under the quoted price. A bottom-up quote
   that has drifted far from the price the customer already read on the website
   is something to notice before sending, not after.
4. **Save quotation** → **Send** → **Customer accepted**.

Accepting raises the contract, at the payment stages from settings.

> If you see _"This quotation comes to ₱0"_, your stock catalogue is empty — go
> back to Part 0.5. That message exists because this exact thing used to fail
> two steps later against a database constraint that named none of it.

---

## Part 4 — The project engineer prepares the job

**Sign in as Project Engineer.** You land on `/admin/projects`.

1. Open the project. The milestone list is the same list the customer sees and
   the same list the technician ticks off, so the customer's progress bar cannot
   disagree with reality.
2. `/admin/permits` — add the permits this job needs, then approve them.

   **A project with no permits recorded does not count as cleared.** Silence is
   not approval. Permits come from outside bodies who do not use this system, so
   the engineer records what happened outside and the job proceeds. Every
   process here that waits on a third party works this way.

3. `/admin/dispatch` — schedule the installation and assign a crew.

---

## Part 5 — Inventory releases the materials

**Sign in as Inventory Manager.**

1. The reservations for this project are listed. Anything short holds the
   project gate shut regardless of the permits.
2. `/admin/purchasing` — raise a purchase order for the shortfall and receive
   it. Stock goes up.
3. Release the reservation. The materials gate clears.

---

## Part 6 — The technician does the work

**Sign in as Field Technician, on your phone.** You land on `/field`.

Built for somebody on a roof with one bar, so it carries no images, no charts
and no animation worth the name.

1. Today's jobs are listed. Open the installation.
2. Tick milestones off as you go. Each updates the customer's tracker.
3. **Logging → Photos.** Choose which of the eight required photographs you are
   taking, then capture it. The checklist reflects what is actually on the
   project — it is not a decoration.
4. **Logging → Serials.** Pick the equipment from the catalogue and type the
   serial. It is recorded against this customer, and their warranty page reads
   from the same table.
5. **Logging → Materials.** Log what was consumed.
6. Capture the customer's sign-off and complete the job.

> Every control here is disabled until a job with a project is assigned to you.
> The page says so rather than leaving you tapping a dead button.

---

## Part 7 — The accountant takes the money

**Sign in as Accountant.** You land on `/admin/finance`.

1. The completed project has produced invoices, split by the milestone
   percentages from settings.
2. There is no payment gateway. The customer pays by bank transfer or over the
   counter, and the accountant records what arrived: amount, date, reference.
3. Record a part payment. The balance moves; the invoice stays open.
4. Record the rest. It closes.

`/admin/hr` holds the payroll register — a record of what was paid, not a
system that pays anybody.

---

## Part 8 — The customer's own account

**Sign in as the customer at `/login`.** You land on `/portal`.

1. The project tracker shows exactly the milestones the technician ticked.
2. `/portal/billing` — the invoices and the payments recorded against them.
3. `/portal/documents` — contract and handover pack.
4. `/portal/tickets` — raise one, answer it from `/admin/tickets` as staff, and
   watch the conversation appear on both sides. Each reply carries the name of
   the person who wrote it, and nothing else about them.
5. `/portal/warranty` — file a claim; approve it at `/admin/warranty`.
6. `/portal/messages` — message the people on your installation. A customer can
   reach their engineer, their crew, the rep who sold it, and an administrator.
   Nobody else, and the list they are shown is filtered by the database rather
   than by the page.
7. `/portal/profile` — change your name and photo. The name is what staff see on
   your tickets.

---

## Part 9 — The administrator's own screens

- `/admin` — every figure is measured from the records you just created. An
  empty database says zero. It does not invent a number to look busy.
- `/admin/settings` — prices, margins, hardware assumptions, payment stages.
  Change **Base price (hybrid)**, save, then open `/estimator` **signed out**.
  The quote moves. That link is the whole point of the settings screen.
- `/admin/content` — portfolio, blog, reviews, **packages, brands, FAQ and the
  legal pages**. All of it editable, including adding and removing.
- `/admin/governance` — approvals and the permission matrix.
- `/admin/audit` — who changed what, including every `grant_admin`.
- `/admin/outbox` — every email the system tried to send.

---

## What to check if something looks wrong

**A staff member cannot see a page.** Probably correct. Each role reaches only
the pages it works in, and the rest are refused at the route, not merely hidden
from the menu.

**A save appeared to work but nothing changed.** Row-level security refuses a
write by returning no rows rather than by raising an error. The screens treat an
empty result as a refusal and say so; if you find one that stays silent, that is
a bug worth reporting.

**An error mentions a constraint or a table name.** It should not. Database
errors are translated into sentences that name the cause in business terms. If a
raw one reaches you, the translation is missing a case — send it over.

**Emails are not arriving.** The built-in sender is rate-limited to roughly two
an hour. Configure real SMTP — see `docs/AUTH-SETUP.md`. This is required before
launch, not optional.

**A quotation is ₱0.** The stock catalogue is empty. See Part 0.5.
