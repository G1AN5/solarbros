# How money is handled

SolarBros settles by bank transfer and over-the-counter deposit. Staff record
what arrives. There is no payment gateway.

---

## 1. Why there is no checkout

There was one, and it was removed in migration `0050` rather than switched off.

The business does not take card or e-wallet payments through the system, so a
checkout in the application was a feature that looked finished and was not.
Worse, the schema behind it — `payment_intents`, `payment_webhook_events`,
gateway columns on `payments` — told anybody reading the database that the
application processes online payments. A table nobody writes to is a claim
nobody checks.

The removal was deliberate rather than a deletion of inconvenient code:

| Removed                                    | Why it existed                                                | Why it went                 |
| ------------------------------------------ | ------------------------------------------------------------- | --------------------------- |
| `payments-checkout` Edge Function          | Read the invoice server-side and opened a hosted checkout     | Nothing calls it            |
| `payments-webhook` Edge Function           | Verified the provider's signature and settled the invoice     | No provider                 |
| `payment_intents`                          | The checkout session and its status                           | Nothing creates one         |
| `payment_webhook_events`                   | Idempotency ledger, so a retried callback could not pay twice | Nothing to retry            |
| `payments.source / provider / external_id` | Told a gateway payment from a manual one                      | Every payment is manual now |

**If the company ever does want online payments**, this is the right way round.
Re-adding a gateway is a known piece of work with a clear shape. Carrying dead
infrastructure that pretends to be live is not.

---

## 2. The rules matter more without a gateway, not less

This is the part worth understanding.

With a gateway, a signed webhook is independent evidence that money moved. The
provider says so, cryptographically, and nobody inside the company can forge it.

Without one, **the only evidence a payment arrived is that somebody said so.**
Everything below exists because of that.

### Provenance is taken, never given

`recorded_by` is set from the session by a database trigger. It is not read from
the request, so a payment cannot be attributed to a colleague — including by
somebody editing the request in their browser.

### A recorded payment cannot be edited

Amount and invoice are settled at insert. Changing them afterwards is refused.

A correction is therefore a **refund plus a fresh entry**, both of which are
their own audited events. That is the difference between a ledger and a
spreadsheet: history that can be quietly rewritten is not history.

### Overpayment is refused, with the balance named

A payment larger than the outstanding balance — beyond
`finance.overpayment_tolerance`, which absorbs rounding and bank charges — is
refused and tells the accountant what the balance actually is, so it can be
split across the right invoices.

### Dual control is available and currently off

`finance.dual_control_threshold` is `0`, which the trigger reads as **off**: an
accountant records a payment and it counts immediately. That is what the owner
asked for.

Set it to an amount and a manual payment at or above that figure must be
verified by somebody other than whoever recorded it — enforced on `UPDATE` as
well as `INSERT`, so it cannot be defeated by recording honestly and then
editing the row.

> A threshold of `0` read literally would mean `amount >= 0`, i.e. every payment
> needs two people, which would lock the accountant out of recording anything at
> all. The trigger treats `0` as off for exactly that reason, and
> `npm run verify:payments` asserts both halves: that off means off, and that
> switching it on still enforces.

### A customer cannot declare their own payment

At any amount, verified or not. The customer is not the party who decides
whether money arrived.

---

## 3. What the customer sees

**Portal → Billing.**

- What they owe, by stage, and by when.
- **Where to send it** — bank name, account name, account number and optionally
  GCash, read from settings rather than written into the page. Changing bank
  does not need a developer, and this is the one piece of information a customer
  must get exactly right.
- What has been received, and any refunds, with the reason.

The panel is hidden entirely while the bank settings are blank. Showing a
customer an empty account number invites them to guess.

There is no "Pay now" button, and the invoice row says `Transfer ₱X` instead. A
control that cannot work is worse than a sentence explaining what to do.

---

## 4. Refunds

`payments.amount` carries `check (amount > 0)`, so a refund is not a negative
payment. It is a separate event (`payment_refunds`, migration `0047`) that:

- names the payment it reverses,
- is capped at what was actually taken, across every refund against it,
- can only be raised against a **verified** payment,
- reduces the invoice only once somebody **other than the recorder** confirms it,
- is audited at `warning` severity on both steps.

Recording a refund does not move the invoice. Confirming it does. Returning the
money itself is still a bank transfer — the system records the decision, not the
transaction.

---

## 5. Configuring it

**Administrator → Business Settings → Finance.**

| Setting                                                           | Effect                                     |
| ----------------------------------------------------------------- | ------------------------------------------ |
| `finance.bank_name`                                               | Shown on the customer's billing page       |
| `finance.bank_account_name`                                       | Must match the bank record exactly         |
| `finance.bank_account_number`                                     | Check it twice                             |
| `finance.gcash_number`                                            | Optional, shown alongside                  |
| `finance.payment_instructions`                                    | The paragraph under the bank details       |
| `finance.dual_control_threshold`                                  | `0` is off; any amount enables it          |
| `finance.overpayment_tolerance`                                   | How much over the balance a payment may be |
| `finance.down_payment_pct` / `delivery_pct` / `commissioning_pct` | Must total 100                             |

---

## 6. Checking it

```bash
npm run verify:payments
```

Covers provenance, dual control both ways, overpayment, immutability, what a
customer may and may not do, and the full refund lifecycle including the cap and
the second-person rule.

---

## 7. Files

| Path                                                   | What                                             |
| ------------------------------------------------------ | ------------------------------------------------ |
| `supabase/migrations/…0022_payment_integrity.sql`      | The original rules                               |
| `supabase/migrations/…0047_payment_refunds.sql`        | Refunds                                          |
| `supabase/migrations/…0050_remove_payment_gateway.sql` | Gateway removal, bank settings, dual control off |
| `src/lib/queries/payments.ts`                          | Reading the ledger, recording refunds            |
| `src/lib/queries/inventory-finance.ts`                 | `useRecordPayment`                               |
| `src/features/admin/FinancePage.tsx`                   | The accountant's screen                          |
| `src/features/client-portal/BillingPage.tsx`           | What the customer sees                           |
| `scripts/verify-payments.mjs`                          | The checks above                                 |
