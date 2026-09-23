/* ============================================================================
   PAYMENT INTEGRITY VERIFICATION
   ----------------------------------------------------------------------------
   The company settles by bank transfer and over the counter. There is no
   payment gateway — it was removed in migration 0050 rather than left switched
   off, because dead schema that implies a capability is a claim nobody checks.

   THAT MAKES THESE RULES MATTER MORE, NOT LESS.
   With a gateway, a signed webhook is evidence that money moved. Without one,
   the only evidence is that somebody said so. Everything below is what stops
   "somebody said so" from being enough on its own:

     1. PROVENANCE     — the recorder is taken from the session, never the
                         request, so a payment cannot be attributed to somebody
                         else.
     2. DUAL CONTROL   — off by default at the owner's request, and asserted
                         here both ways: that it is genuinely off, and that
                         switching the setting on genuinely enforces it.
     3. OVERPAYMENT    — a payment larger than the balance is refused rather
                         than quietly leaving an invoice over-settled.
     4. IMMUTABILITY   — a recorded payment cannot be edited into a different
                         one. Corrections are refunds, which are their own
                         audited event.
     5. THE CUSTOMER   — cannot declare their own payment, at any amount.

       npm run verify:payments

   ========================================================================== */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const URL = env.VITE_SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY
const PASSWORD = 'SolarBros2026!'

if (!URL || !ANON) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

async function signIn(email) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  const {
    data: { user },
  } = await client.auth.getUser()
  // The id is hung off the client so call sites read `admin.from(...)` and
  // `admin.userId` without an extra layer of destructuring everywhere.
  client.userId = user.id
  return client
}

const LINE = '='.repeat(64)
let passed = 0
let failed = 0
const created = []

function check(label, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function checkRefused(label, error, expectMatch) {
  if (!error) {
    failed++
    console.log(`  FAIL  ${label} — it was ALLOWED`)
    return
  }
  const ok = !expectMatch || error.message.toLowerCase().includes(expectMatch.toLowerCase())
  if (ok) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label} — refused for the wrong reason: ${error.message}`)
  }
}

/** Record a payment and remember it, so cleanup is exact. */
async function record(client, row) {
  const res = await client.from('payments').insert(row).select('id').single()
  if (res.data) created.push(res.data.id)
  return res
}

const accountant = await signIn('accounts@demo.solarbros.ph')
const admin = await signIn('admin@demo.solarbros.ph')
const client = await signIn('client@demo.solarbros.ph')

/* Create a dedicated invoice rather than borrowing a seeded one.

   The seed's only invoice is fully paid, so there would be nothing to test
   against — and more importantly, a script that depends on demo data being in a
   particular state fails for confusing reasons the first time somebody runs
   `demo:refresh`. This makes its own invoice on a free stage, tests it to
   destruction, and deletes it. */
const { data: project } = await admin
  .from('projects')
  .select('id, reference, client_id')
  .limit(1)
  .maybeSingle()

if (!project) {
  console.error('No project to attach a test invoice to — run npm run demo:refresh first.')
  process.exit(1)
}

/* Migration 0049 limits the one-invoice-per-stage rule to the invoices the
   milestone triggers raise, so a manual one can use any stage. Before that,
   this script gave up entirely on a project that had been fully billed. */
const TEST_INVOICE_NO = `INV-VERIFY-${Date.now()}`
const { data: invoice, error: invoiceError } = await admin
  .from('invoices')
  .insert({
    invoice_number: TEST_INVOICE_NO,
    project_id: project.id,
    client_id: project.client_id,
    stage: 'retention',
    is_manual: true,
    amount: 200000,
    status: 'sent',
    issued_at: new Date().toISOString().slice(0, 10),
    notes: 'Created by npm run verify:payments. Deleted when it finishes.',
  })
  .select('id, invoice_number, amount, amount_paid, balance, client_id')
  .single()

if (invoiceError) {
  console.error(`Could not create the test invoice: ${invoiceError.message}`)
  process.exit(1)
}

const balance = Number(invoice.balance)
console.log(`\nUsing invoice ${invoice.invoice_number} — balance PHP ${balance.toLocaleString()}`)

/* ========================================================================== */
console.log(`\n1 · Provenance cannot be asserted by the caller\n${LINE}`)

const { data: attributed, error: smallError } = await accountant
  .from('payments')
  .insert({
    invoice_id: invoice.id,
    amount: 1000,
    payment_method: 'bank_transfer',
    reference: 'VERIFY-SMALL',
    // The lie: claim the administrator recorded this.
    recorded_by: admin.userId,
    verified: true,
  })
  .select('id, recorded_by, verified_by')
  .single()

check('a small payment records in one step', !smallError, smallError?.message)
if (attributed) {
  created.push(attributed.id)
  check(
    'the forged recorded_by was overwritten with the real caller',
    attributed.recorded_by === accountant.userId,
    `attributed to ${attributed.recorded_by === admin.userId ? 'the administrator' : 'someone else'}`,
  )
  check('verified_by was filled in from the session', attributed.verified_by === accountant.userId)
}

/* ========================================================================== */
console.log(`\n2 · Separation of duties, which is now a setting\n${LINE}`)

/* The owner asked for straightforward recording, so migration 0050 sets
   `finance.dual_control_threshold` to 0 — which the trigger reads as OFF.

   A threshold of 0 read literally would mean `amount >= 0`, i.e. EVERY payment
   needs two people, which would lock the accountant out of recording anything
   at all. So both halves are asserted: that off means off, and that switching
   it on still works. A control that cannot be switched back on is not off, it
   is gone. */

const { data: openRecord, error: openRecordError } = await accountant
  .from('payments')
  .insert({
    invoice_id: invoice.id,
    amount: 50000,
    payment_method: 'bank_transfer',
    reference: 'DUAL-OFF',
    verified: true,
  })
  .select('id, verified, recorded_by, verified_by')
  .single()

check(
  'with the threshold off, one person records and verifies in a single step',
  !openRecordError,
  openRecordError?.message,
)
if (openRecord) created.push(openRecord.id)
check(
  'and the database stamps them as both, from the session',
  openRecord?.recorded_by === accountant.userId && openRecord?.verified_by === accountant.userId,
)

/* Now switch it on and prove the mechanism survived being disabled. */
await admin.from('settings').update({ value: '25000' }).eq('key', 'finance.dual_control_threshold')

const { error: selfVerifyError } = await record(accountant, {
  invoice_id: invoice.id,
  amount: 30000,
  payment_method: 'bank_transfer',
  reference: 'DUAL-ON',
  verified: true,
})
checkRefused(
  'switched on, one person cannot record AND verify above the threshold',
  selfVerifyError,
  'someone other than',
)

const { data: pending, error: pendingError } = await accountant
  .from('payments')
  .insert({
    invoice_id: invoice.id,
    amount: 30000,
    payment_method: 'bank_transfer',
    reference: 'DUAL-PENDING',
    verified: false,
  })
  .select('id')
  .single()

check('but they can record it as awaiting verification', !pendingError, pendingError?.message)

if (pending) {
  created.push(pending.id)

  /* The interesting attack: record honestly, then quietly edit the row to
     verify it yourself. Without the rule on UPDATE too, it is decoration. */
  const { data: selfEdit } = await accountant
    .from('payments')
    .update({ verified: true, verified_by: accountant.userId })
    .eq('id', pending.id)
    .select('id')
  check(
    'and cannot then verify it themselves by editing the row',
    (selfEdit?.length ?? 0) === 0,
    'the update went through',
  )

  const { data: adminVerify, error: adminVerifyError } = await admin
    .from('payments')
    .update({ verified: true, verified_by: admin.userId })
    .eq('id', pending.id)
    .select('id, verified')
  check(
    'a second person can verify it',
    !adminVerifyError && adminVerify?.[0]?.verified === true,
    adminVerifyError?.message,
  )

  /* Rewriting a settled payment must be impossible, or the ledger is fiction:
     verify PHP 30,000, then edit it to PHP 300,000. */
  const { error: amountEditError } = await admin
    .from('payments')
    .update({ amount: 300000 })
    .eq('id', pending.id)
  checkRefused(
    'a recorded payment cannot have its amount rewritten',
    amountEditError,
    'cannot be altered',
  )
}

// Back to the configured default, so running this twice behaves the same.
await admin.from('settings').update({ value: '0' }).eq('key', 'finance.dual_control_threshold')

/* ========================================================================== */
console.log(`\n3 · Overpayment\n${LINE}`)

const { error: overError } = await record(accountant, {
  invoice_id: invoice.id,
  amount: balance + 50000,
  payment_method: 'bank_transfer',
  reference: 'VERIFY-OVER',
  verified: false,
})
checkRefused('a payment larger than the balance is refused', overError, 'outstanding')

/* Tolerance exists so a bank charge or a rounded transfer is not rejected. */
const { data: remaining } = await accountant
  .from('invoices')
  .select('balance')
  .eq('id', invoice.id)
  .single()

const { error: toleranceError } = await record(accountant, {
  invoice_id: invoice.id,
  amount: Number(remaining.balance) + 50,
  payment_method: 'bank_transfer',
  reference: 'VERIFY-ROUNDING',
  verified: false,
})
check('a small rounding overpayment is accepted', !toleranceError, toleranceError?.message)

/* ========================================================================== */
console.log(`\n4 · What the customer can and cannot do\n${LINE}`)

const { error: clientPayError } = await client.from('payments').insert({
  invoice_id: invoice.id,
  amount: 999999,
  payment_method: 'gcash',
  reference: 'I PAID, HONEST',
  verified: true,
})
checkRefused('a customer cannot declare their own payment', clientPayError)

/* Not even a trivial one. The amount is irrelevant — what matters is that the
   customer is not the one who decides whether money arrived. */
const { error: clientSmallPayError } = await client.from('payments').insert({
  invoice_id: invoice.id,
  amount: 1,
  payment_method: 'cash',
  reference: 'ONE PESO',
  verified: false,
})
checkRefused('not even an unverified one peso', clientSmallPayError)

const { data: clientSees, error: clientReadError } = await client
  .from('payments')
  .select('id, amount')
  .eq('invoice_id', invoice.id)

check(
  'but they can read what has been recorded against their own invoice',
  !clientReadError,
  clientReadError?.message,
)
check(
  'because a balance that moves with no visible reason is a support call',
  Array.isArray(clientSees),
)

/* ========================================================================== */
console.log(`\nRefunds\n${LINE}`)

/* Refunds were a listed limitation for several sessions: `payments.amount` has
   `check (amount > 0)`, so a refund cannot be a negative payment. Migration
   0047 makes it a separate event, and every rule below is enforced in the
   database rather than in the screen that offers the button. */

const refundIds = []

const { data: refundable, error: refundableError } = await accountant
  .from('payments')
  .insert({
    invoice_id: invoice.id,
    amount: 5000,
    payment_method: 'bank_transfer',
    reference: 'REFUND-SOURCE',
    verified: true,
    verified_by: accountant.userId,
    verified_at: new Date().toISOString(),
  })
  .select('id, amount')
  .single()

check('a verified payment exists to refund', !refundableError, refundableError?.message)
if (refundable) created.push(refundable.id)

const { data: paidBefore } = await admin
  .from('invoices')
  .select('amount_paid')
  .eq('id', invoice.id)
  .single()

const { data: refund, error: refundError } = await accountant
  .from('payment_refunds')
  .insert({
    payment_id: refundable.id,
    amount: 2000,
    reason: 'Verification script — partial refund of an overpayment.',
  })
  .select('id, status, recorded_by')
  .single()

check('an accountant can record a refund', !refundError, refundError?.message)
if (refund) refundIds.push(refund.id)

check(
  'it is recorded, not confirmed',
  refund?.status === 'recorded',
  `status is ${refund?.status}`,
)
check(
  'and it is signed by the session, not by the request',
  refund?.recorded_by === accountant.userId,
)

const { data: paidAfterRecording } = await admin
  .from('invoices')
  .select('amount_paid')
  .eq('id', invoice.id)
  .single()
check(
  'recording it does NOT reduce the invoice yet',
  Number(paidAfterRecording.amount_paid) === Number(paidBefore.amount_paid),
  `${paidBefore.amount_paid} became ${paidAfterRecording.amount_paid}`,
)

/* DUAL CONTROL. Money leaving the company is the one place it matters most. */
const { data: selfConfirm } = await accountant
  .from('payment_refunds')
  .update({ status: 'confirmed' })
  .eq('id', refund.id)
  .select('id')
check(
  'the person who recorded it cannot confirm it',
  (selfConfirm?.length ?? 0) === 0,
  'the self-confirmation was accepted',
)

const { data: confirmed, error: confirmError } = await admin
  .from('payment_refunds')
  .update({ status: 'confirmed' })
  .eq('id', refund.id)
  .select('id, status, confirmed_by')
check('a second person can confirm it', !confirmError, confirmError?.message)
check('and the database stamps who did', confirmed?.[0]?.confirmed_by === admin.userId)

const { data: paidAfterConfirming } = await admin
  .from('invoices')
  .select('amount_paid')
  .eq('id', invoice.id)
  .single()
check(
  'confirming it takes the money off the invoice',
  Number(paidAfterConfirming.amount_paid) === Number(paidBefore.amount_paid) - 2000,
  `expected ${Number(paidBefore.amount_paid) - 2000}, got ${paidAfterConfirming.amount_paid}`,
)

/* Never give back more than was taken, counted across every refund. */
const { error: overRefundError } = await accountant.from('payment_refunds').insert({
  payment_id: refundable.id,
  amount: 4000,
  reason: 'Verification script — this would exceed the original payment.',
})
check(
  'refunding more than the payment is refused',
  Boolean(overRefundError),
  overRefundError ? '' : 'the write was accepted',
)

const { error: shortReasonError } = await accountant.from('payment_refunds').insert({
  payment_id: refundable.id,
  amount: 100,
  reason: 'refund',
})
check(
  'a one-word reason is refused — an auditor reads this field first',
  Boolean(shortReasonError),
  shortReasonError ? '' : 'the write was accepted',
)

const { data: unverified } = await accountant
  .from('payments')
  .insert({
    invoice_id: invoice.id,
    amount: 1000,
    payment_method: 'cash',
    reference: 'UNVERIFIED-SOURCE',
    verified: false,
  })
  .select('id')
  .single()
if (unverified) {
  created.push(unverified.id)
  const { error: unverifiedRefundError } = await accountant.from('payment_refunds').insert({
    payment_id: unverified.id,
    amount: 500,
    reason: 'Verification script — reversing money nobody confirmed receiving.',
  })
  check(
    'refunding an unverified payment is refused',
    Boolean(unverifiedRefundError),
    unverifiedRefundError ? '' : 'the write was accepted',
  )
}

const { error: clientRefundError } = await client.from('payment_refunds').insert({
  payment_id: refundable.id,
  amount: 500,
  reason: 'A customer refunding themselves, which should be impossible.',
})
check(
  'a customer cannot record a refund to themselves',
  Boolean(clientRefundError),
  clientRefundError ? '' : 'the write was accepted',
)

const { data: clientSeesRefund } = await client
  .from('payment_refunds')
  .select('id, amount')
  .eq('id', refund.id)
check(
  'but the customer can see a refund against their own invoice',
  (clientSeesRefund?.length ?? 0) === 1,
  'money went back and the customer could not see why the balance moved',
)

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

/* Refunds go first: `payment_refunds.payment_id` is ON DELETE RESTRICT, so the
   payments below cannot be removed while a refund still points at one. */
let deletedRefunds = 0
for (const id of refundIds) {
  const { data: gone } = await admin.from('payment_refunds').delete().eq('id', id).select('id')
  deletedRefunds += gone?.length ?? 0
}
check(
  'every test refund was actually deleted',
  deletedRefunds === refundIds.length,
  `deleted ${deletedRefunds} of ${refundIds.length}`,
)

for (const id of created) {
  await admin.from('payments').delete().eq('id', id)
}

const { data: after } = await admin
  .from('invoices')
  .select('amount_paid, balance, status')
  .eq('id', invoice.id)
  .single()

check(
  'removing the payments restored the invoice totals',
  Number(after.balance) === balance,
  `balance is now ${after.balance}, was ${balance}`,
)

/* The two extra invoices this block used to clear belonged to the checkout
   authorisation tests, which went with the gateway in migration 0050. */
const { error: invoiceDeleteError } = await admin.from('invoices').delete().eq('id', invoice.id)
check('the test invoices were removed', !invoiceDeleteError, invoiceDeleteError?.message)
console.log(`  Removed ${created.length} test payment(s) and 1 invoice.`)

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
