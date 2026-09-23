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

### Why this is more work than it used to be

There is no longer a panel on the login screen that signs you in as any role,
and there are no demo accounts. Both were removed deliberately: anything that
hands out a staff session is a way in, and a way in that exists on a public page
is a way in for everybody.

Accounts now come into being in exactly three ways.

| Who                     | How they get an account                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The first administrator | Created by hand in the Supabase dashboard. There is no sign-up page that can produce one                            |
| Other staff             | They register themselves at `/staff/register`, state the role they were hired for, and an administrator approves it |
| Customers               | They register themselves at `/register`, and are clients. Permanently — see below                                   |

### Create the administrator

In the Supabase dashboard: **Authentication → Users → Add user**. Enter an email
and password and tick _Auto Confirm User_, so you are not waiting on an email.

Then in **SQL Editor**, promote it:

```sql
update public.profiles
set role = 'admin'
where email = 'YOUR-ADMIN-EMAIL@example.com';
```

This is the one time a role is ever set by hand, and it only works from the SQL
editor. The application cannot do it — a database trigger refuses any change to
`profiles.role` that has not come through the approval function, and a trigger
fires regardless of who is asking, so this is not something an administrator can
be tricked into and not something the `service_role` key can bypass either.

### Decide your six addresses

Pick these now and write them in. Gmail's `+` trick is useful here:
`you+sales@gmail.com` and `you+admin@gmail.com` are different accounts that both
arrive in your one inbox, which matters because registration sends a
verification email.

| Role              | Portal it lands on | Your email |
| ----------------- | ------------------ | ---------- |
| Administrator     | `/admin`           |            |
| Sales             | `/admin/crm`       |            |
| Project Engineer  | `/admin/projects`  |            |
| Inventory Manager | `/admin/inventory` |            |
| Accountant        | `/admin/finance`   |            |
| Field Technician  | `/field`           |            |
| Customer          | `/portal`          |            |

Each role lands on the page it actually works in, not on a dashboard half of
them are not allowed to read.

### Register the five staff accounts

`/staff/register` is **not linked from anywhere on the public site**. That is the
point: you send the link to a new hire, and nobody finds it by browsing.

For each of the five staff roles: open `/staff/register`, fill in the name, email
and password, and pick the role from the dropdown. That choice is a _claim_, not
a grant — the account is created with no role at all and cannot reach any staff
page until somebody says so.

Then, as the administrator, go to **Roles & access** (`/admin/governance`). Each
pending registration shows who they say they are and what they claim to be.
Approve it and confirm in the dialog.

Two things worth trying while you are there:

- **Approve somebody as a different role than they claimed.** The dialog lets
  you override the claim. A new hire ticking the wrong box should not need a
  developer.
- **Try to change a role afterwards.** You cannot. There is no toggle. A role is
  set once, at approval, and changing it later means deleting the account and
  starting again. That is deliberate: the common disaster is not a malicious
  administrator, it is a tired one clicking the wrong row in a list.

### Register the customer

`/register` on the public site. This one is linked, obviously.

Try, afterwards, to promote that account to anything else. You cannot — not from
Roles & access, not from the SQL editor via the application, not with the service
key. Client is permanent.

### Seeing two roles at once

Duplicating a browser tab will not work, and this trips everybody up once.

Supabase keeps the session in `localStorage`, which every tab of the same browser
profile shares, and it broadcasts sign-in and sign-out to the other tabs. Signing
in as the administrator in one tab makes the other tab the administrator too,
immediately. **That is correct behaviour, and it is what you want in
production**: one person, one session, and signing out really does sign you out
everywhere.

Two accounts used by two different people on two different devices never share
anything. To see two roles at once _yourself_, you need two separate session
stores:

| How                                             | Sessions            | Good for                           |
| ----------------------------------------------- | ------------------- | ---------------------------------- |
| A second browser profile (Chrome: avatar → Add) | One each, unlimited | The whole walkthrough. Best option |
| One normal window plus one incognito window     | Two                 | A quick two-role check             |
| Chrome _and_ Firefox _and_ Edge                 | One each            | If you dislike profiles            |

All incognito windows share one session with each other, so incognito gets you
two roles at a time and no more. Profiles scale to all seven.

---

## Part 1 — A stranger becomes a lead

**As nobody. Public site, on your phone.**

1. `/` — the home page. Then `/packages`, which lists the seven hybrid systems
   the company sells, at their real array sizes.
2. `/estimator`. Tick the appliances a household actually runs: a couple of
   aircon units, a fridge, a rice cooker, lights. Set the hours. Watch the peso
   figure appear beside each line — that, rather than any marketing copy, is what
   explains a customer's bill to them.
3. Set the usage pattern to **Mostly at night**. The recommendation changes from
   on-grid to hybrid, because a household that uses power after dark needs
   somewhere to put the daytime surplus.
4. Enter your monthly bill. The page cross-checks your appliance list against it
   and tells you if the two disagree.
5. Submit the estimate with the customer's name and email.

That submission is now a lead.

---

## Part 2 — Sales works the lead

**Sign in as Sales at `/staff/login`.** You land on `/admin/crm`.

1. The lead from Part 1 is in the **New** column with a score against it.
2. **Drag the card** to _Contacted_. It should move and stay moved after a
   refresh. On a phone, or from a keyboard, use the **Move stage** button on the
   card instead — dragging is an enhancement, not the only route.
3. Open the lead and correct something — a mistyped phone number, say. Leads are
   captured by somebody typing on a phone, so this is the most common repair.
4. Move it to **Site visit**. That creates an appointment.
5. Go to `/admin/quotes`. Pick the package and the lead. The bill of materials
   builds itself from the package, labour comes from settings, and the margin
   starts at the company's configured target. Note the **vs advertised** figure
   under the quoted price — if your quote has drifted far from the price the
   customer already read on the website, that is where you find out.
6. Save the quote, then move the lead to **Contract**.

Moving a lead to Contract creates the project, the customer record and the stock
reservations in one step. Check `/admin/projects` — it is there.

---

## Part 3 — The project engineer prepares the job

**Sign in as Project Engineer.** You land on `/admin/projects`.

1. Open the new project. The milestone list is the same list the customer sees
   and the same list the technician ticks off, so there is no way for the
   customer's progress bar to disagree with reality.
2. Go to `/admin/permits` and add the permits this job needs. Approve them.

   **This is the bit worth understanding.** A project with no permits recorded
   does not count as cleared. Silence is not approval — if nobody has said which
   permits are needed, the gate stays shut.

   Permits come from outside bodies who do not use this system. So the engineer
   marks them approved here on the strength of the paperwork in their hand, and
   the job proceeds. Every process in this application that waits on an outside
   party works this way: somebody inside the company, in a named role, records
   what happened outside, and the flow continues.

3. Back on the project, the gate should now show permits clear.
4. `/admin/dispatch` — schedule the installation and assign a crew.

---

## Part 4 — Inventory releases the materials

**Sign in as Inventory Manager.** You land on `/admin/inventory`.

1. The reservations for this project are listed. If anything is short, the
   project gate stays shut regardless of the permits.
2. Raise a purchase order at `/admin/purchasing` for anything below its reorder
   point, and receive it. Stock goes up.
3. Release the reservation. The materials gate clears.

---

## Part 5 — The technician does the work

**Sign in as Field Technician, on your phone.** You land on `/field`.

This portal is built for somebody standing on a roof with one bar of signal, so
it carries no images, no charts and no animation worth the name.

1. Today's jobs are listed. Open the installation.
2. Tick the milestones off as you go. Each one updates the customer's tracker in
   real time.
3. Log materials used, then capture the customer's sign-off.
4. Complete the job.

---

## Part 6 — The accountant takes the money

**Sign in as Accountant.** You land on `/admin/finance`.

1. The completed project has produced an invoice.
2. There is no payment gateway and no card checkout. The customer pays by bank
   transfer or over the counter, and the accountant records what arrived:
   amount, date, reference.
3. Record a part payment. The balance moves; the invoice stays open.
4. Record the rest. It closes.

`/admin/hr` holds the payroll register — again a record of what was paid, not a
system that pays anybody.

---

## Part 7 — The customer looks at their own account

**Sign in as the customer at `/login`.** You land on `/portal`.

1. The project tracker shows exactly the milestones the technician ticked.
2. `/portal/billing` shows the invoice and the payments the accountant recorded.
3. `/portal/documents` holds the contract and the handover pack.
4. Raise a support ticket at `/portal/tickets`, then answer it from
   `/admin/tickets` as staff and watch the conversation appear on both sides.
5. `/portal/warranty` — file a claim. An administrator approves it at
   `/admin/warranty`.

---

## Part 8 — The administrator's own screens

**Sign in as the administrator.**

- `/admin` — the executive dashboard. Every figure on it is measured from the
  records you have just created. If the database is empty, it says zero. It does
  not invent a number to look busy.
- `/admin/settings` — prices, margins, hardware assumptions, lead scoring.
  Change **Base price (hybrid)**, save, then open `/estimator` in a signed-out
  window. The quote moves. That link is the whole point of the settings screen
  and it is worth confirming yourself.
- `/admin/content` — the packages, the blog and the public copy.
- `/admin/audit` — who changed what.
- `/admin/outbox` — every email the system tried to send.

---

## What to check if something looks wrong

**A staff member cannot see a page.** That is probably correct. Each role reaches
only the pages it works in; the rest are not merely hidden from the menu, they
are refused at the route. An accountant typing `/admin/crm` is sent back to
their own landing page.

**A save appeared to work but nothing changed.** Row-level security refuses a
write by returning no rows rather than by raising an error. The screens now
treat an empty result as a refusal and say so, but if you see this anywhere that
still stays silent, that is a bug worth reporting.

**Emails are not arriving.** Supabase's built-in sender is rate-limited to
roughly two an hour, which you will hit while registering six accounts in a row.
Wait, or configure a real SMTP provider — see `docs/AUTH-SETUP.md`.
