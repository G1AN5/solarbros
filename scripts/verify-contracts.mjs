/* ============================================================================
   CONTRACT & CUSTOMER WRITE-SCOPE VERIFICATION
   ----------------------------------------------------------------------------
   Runs the attacks that WORKED against this database before migration 0023, and
   asserts they now fail.

   The hole: `contracts_sign_client` was meant to let a customer sign their own
   contract, and actually let them rewrite every column of it. RLS grants access
   to rows, not columns — the `with check` only re-stated which row, so any
   change was permitted so long as the row stayed theirs.

   Three of these succeeded against the live database when first tried:

       contract_value 680,000 -> 1
       company_signed_at = now()          (forging our counter-signature)
       down_payment_pct 50 -> 1

   Combined with `contracts_executed_needs_both_signatures`, which only requires
   both timestamps to be non-null, a customer could have executed their own
   contract at any value — creating a project, reserving warehouse stock and
   issuing a down-payment invoice for half a peso.

   Every check here also confirms the legitimate path still works, because a
   control that blocks the attack AND the customer is not a fix.

       npm run verify:contracts

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

async function signIn(email) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  const {
    data: { user },
  } = await client.auth.getUser()
  client.userId = user.id
  return client
}

const LINE = '='.repeat(64)
let passed = 0
let failed = 0

function check(label, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** A write that MUST be refused. Succeeding is the failure. */
function checkBlocked(label, { data, error }) {
  // Two ways a write can be stopped: the trigger raises (error), or a policy
  // filters the row so nothing is updated. PostgREST reports the second as
  // success with zero rows, which is why both are checked.
  const blocked = !!error || (data?.length ?? 0) === 0
  if (blocked) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label} — IT WENT THROUGH: ${JSON.stringify(data)}`)
  }
}

const admin = await signIn('admin@demo.solarbros.ph')
const client = await signIn('client@demo.solarbros.ph')

/* Work on a purpose-made contract, so a failed assertion cannot corrupt the
   seeded one that the rest of the demo depends on. */
const { data: lead } = await admin
  .from('leads')
  .insert({
    name: 'Contract Scope Test',
    email: `contract-scope-${Date.now()}@example.test`,
    source: 'walk_in',
  })
  .select('id')
  .single()

const { data: quotation } = await admin
  .from('quotations')
  .insert({
    lead_id: lead.id,
    system_kw: 6,
    system_type: 'hybrid',
    total_price: 500000,
    status: 'accepted',
  })
  .select('id, reference')
  .single()

check('a quotation gets a reference from the sequence', !!quotation?.reference, 'reference is null')
if (quotation) console.log(`        ${quotation.reference}`)

const { data: contract, error: contractError } = await admin
  .from('contracts')
  .insert({
    quotation_id: quotation.id,
    lead_id: lead.id,
    client_id: client.userId,
    contract_value: 500000,
    status: 'awaiting_client',
  })
  .select('id, reference, contract_value, status')
  .single()

check(
  'a contract gets a reference from the sequence',
  !!contract?.reference,
  contractError?.message,
)
if (contract) console.log(`        ${contract.reference}`)

/* Stop here rather than throwing a null-reference twenty lines later. A
   verification script whose own failure mode is a stack trace teaches nobody
   anything — this is how the reference-sequence bug first showed up. */
if (!contract) {
  console.error('Could not create the test contract, so nothing below can run.')
  console.error(`Reason: ${contractError?.message ?? 'unknown'}`)
  process.exit(1)
}

/* ========================================================================== */
console.log(`\n1 · The attacks that used to work\n${LINE}`)

checkBlocked(
  'a customer cannot rewrite their contract value',
  await client
    .from('contracts')
    .update({ contract_value: 1 })
    .eq('id', contract.id)
    .select('id, contract_value'),
)

checkBlocked(
  'a customer cannot forge the company counter-signature',
  await client
    .from('contracts')
    .update({ company_signed_at: new Date().toISOString() })
    .eq('id', contract.id)
    .select('id'),
)

checkBlocked(
  'a customer cannot rewrite the payment schedule',
  await client
    .from('contracts')
    .update({ down_payment_pct: 1, delivery_pct: 1, commissioning_pct: 98 })
    .eq('id', contract.id)
    .select('id'),
)

checkBlocked(
  'a customer cannot execute their own contract',
  await client
    .from('contracts')
    .update({
      status: 'executed',
      client_signed_at: new Date().toISOString(),
      client_signature_name: 'Sneaky Customer',
      company_signed_at: new Date().toISOString(),
    })
    .eq('id', contract.id)
    .select('id'),
)

checkBlocked(
  'a customer cannot reassign the contract to somebody else',
  await client
    .from('contracts')
    .update({ client_id: admin.userId })
    .eq('id', contract.id)
    .select('id'),
)

/* ========================================================================== */
console.log(`\n2 · But signing still works\n${LINE}`)

const { data: signed, error: signError } = await client
  .from('contracts')
  .update({
    client_signed_at: new Date().toISOString(),
    client_signature_name: 'Juan Dela Cruz',
    status: 'awaiting_company',
  })
  .eq('id', contract.id)
  .select('id, status, client_signed_at, client_signature_name')

check(
  'a customer can sign their own contract',
  !signError && signed?.[0]?.client_signed_at,
  signError?.message,
)
check(
  'and it moves to awaiting counter-signature',
  signed?.[0]?.status === 'awaiting_company',
  `status is ${signed?.[0]?.status}`,
)

checkBlocked(
  'signing is a one-way door — it cannot be undone',
  await client
    .from('contracts')
    .update({ client_signed_at: null })
    .eq('id', contract.id)
    .select('id'),
)

const { error: nameError } = await admin
  .from('contracts')
  .update({ client_signed_at: null, client_signature_name: null, status: 'awaiting_client' })
  .eq('id', contract.id)

check('staff can reset a contract for re-signing', !nameError, nameError?.message)

const emptyName = await client
  .from('contracts')
  .update({ client_signed_at: new Date().toISOString(), client_signature_name: ' ' })
  .eq('id', contract.id)
  .select('id')
checkBlocked('a signature with no name is refused', emptyName)

/* ========================================================================== */
console.log(`\n3 · Counter-signing executes the contract\n${LINE}`)

await client
  .from('contracts')
  .update({
    client_signed_at: new Date().toISOString(),
    client_signature_name: 'Juan Dela Cruz',
    status: 'awaiting_company',
  })
  .eq('id', contract.id)

const { data: executed, error: executeError } = await admin
  .from('contracts')
  .update({
    company_signed_at: new Date().toISOString(),
    company_signed_by: admin.userId,
    status: 'executed',
  })
  .eq('id', contract.id)
  .select('id, status')

check('an administrator can counter-sign', !executeError, executeError?.message)
check('the contract reaches executed', executed?.[0]?.status === 'executed')

/* Executing is what the whole flow diagram hangs off: it creates the project,
   reserves stock and raises the down-payment invoice (migration 0008). */
const { data: project } = await admin
  .from('projects')
  .select('id, reference, contract_value')
  .eq('contract_id', contract.id)
  .maybeSingle()

check('executing created the project', !!project, 'no project was created')

if (project) {
  const { data: invoices } = await admin
    .from('invoices')
    .select('id, stage, amount')
    .eq('project_id', project.id)

  check(
    'and raised the down-payment invoice',
    (invoices ?? []).some((i) => i.stage === 'down_payment'),
    `invoices: ${JSON.stringify(invoices)}`,
  )

  const downPayment = (invoices ?? []).find((i) => i.stage === 'down_payment')
  check(
    'for 50% of the contract value',
    downPayment && Number(downPayment.amount) === 250000,
    `got ${downPayment?.amount}`,
  )
}

/* ========================================================================== */
console.log(`\n4 · Appointments and notifications, same pattern\n${LINE}`)

const { data: appt } = await admin
  .from('appointments')
  .insert({
    appointment_type: 'maintenance',
    status: 'requested',
    scheduled_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    time_slot: '10:00',
    client_id: client.userId,
    contact_name: 'Scope Test',
  })
  .select('id')
  .single()

if (appt) {
  checkBlocked(
    'a customer cannot mark their own visit completed',
    await client
      .from('appointments')
      .update({ status: 'completed' })
      .eq('id', appt.id)
      .select('id'),
  )

  checkBlocked(
    'a customer cannot fire the "team assigned" SMS at themselves',
    await client
      .from('appointments')
      .update({ status: 'dispatched' })
      .eq('id', appt.id)
      .select('id'),
  )

  const { error: cancelError } = await client
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appt.id)
  check('but they can still cancel it', !cancelError, cancelError?.message)
}

const { data: notification } = await admin
  .from('notifications')
  .insert({ user_id: client.userId, title: 'Scope test', body: 'Original body.' })
  .select('id')
  .single()

if (notification) {
  checkBlocked(
    'a recipient cannot rewrite a notification',
    await client
      .from('notifications')
      .update({ body: 'Your balance is zero.' })
      .eq('id', notification.id)
      .select('id'),
  )

  const { error: readError } = await client
    .from('notifications')
    .update({ read: true })
    .eq('id', notification.id)
  check('but they can mark it read', !readError, readError?.message)
}

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

if (notification) await admin.from('notifications').delete().eq('id', notification.id)
if (appt) await admin.from('appointments').delete().eq('id', appt.id)

if (project) {
  await admin.from('invoices').delete().eq('project_id', project.id)
  await admin.from('stock_reservations').delete().eq('project_id', project.id)
  await admin.from('project_milestones').delete().eq('project_id', project.id)
  await admin.from('projects').delete().eq('id', project.id)
}
await admin.from('contracts').delete().eq('id', contract.id)
await admin.from('quotations').delete().eq('id', quotation.id)
await admin.from('leads').delete().eq('id', lead.id)

const { data: leftover } = await admin.from('contracts').select('id').eq('id', contract.id)
check('the test contract chain was removed', (leftover?.length ?? 0) === 0)

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
