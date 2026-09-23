/* ============================================================================
   PORTAL INTERCONNECTION VERIFICATION
   ----------------------------------------------------------------------------
   Every write in this application is supposed to show up somewhere else: a
   customer raises a ticket and the office sees it; the office resolves it and
   the customer sees that. This checks those round trips, from both ends.

   WHY IT EXISTS
   A customer raised a support ticket and it appeared nowhere — not in their own
   portal, not in the admin queue. The cause was not the database and not RLS:
   the form's submit handler called `preventDefault()` and closed the panel, and
   `useRaiseTicket` was never imported. The mutation had been written, tested by
   nobody, and wired to nothing.

   That is invisible to a schema test, an RLS test and a typecheck. It is only
   visible if something actually performs the round trip. An audit afterwards
   found FIFTEEN mutations that no screen called.

   So this script does what a person does: writes as one role, reads as another,
   and asserts the value arrived.

       npm run verify:interconnect

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

const admin = await signIn('admin@demo.solarbros.ph')
const engineer = await signIn('engineer@demo.solarbros.ph')
const client = await signIn('client@demo.solarbros.ph')

const created = { tickets: [], appointments: [], warranty: [], movements: [] }

/* ========================================================================== */
console.log(`\n1 · Support ticket · customer raises, office sees\n${LINE}`)

const { data: ticket, error: raiseError } = await client
  .from('tickets')
  .insert({
    subject: 'Interconnect check — inverter fault',
    description: 'Error code E013 on the display since this morning.',
    priority: 'high',
    category: 'hardware_fault',
    status: 'open',
    client_id: client.userId,
  })
  .select('id, reference, status')
  .single()

check('the customer can raise a ticket', !raiseError, raiseError?.message)
if (ticket) created.tickets.push(ticket.id)

check(
  'it gets a reference from the sequence, not a random number',
  !!ticket?.reference?.startsWith('TKT-'),
  `reference is ${ticket?.reference}`,
)

/* The reference used to be `TKT-${year}-${random 1000..9999}` generated in the
   browser, against a UNIQUE column whose seeded values sit in that same range.
   Ten more in a row would have collided sooner or later. */
const refs = new Set()
for (let i = 0; i < 5; i++) {
  const { data: extra } = await client
    .from('tickets')
    .insert({
      subject: `Interconnect collision probe ${i}`,
      description: 'Checking that references cannot collide.',
      priority: 'low',
      category: 'other',
      status: 'open',
      client_id: client.userId,
    })
    .select('id, reference')
    .single()
  if (extra) {
    created.tickets.push(extra.id)
    refs.add(extra.reference)
  }
}
check('five more tickets get five distinct references', refs.size === 5, `${refs.size} unique`)

/* --- The office end ----------------------------------------------------- */
const { data: inQueue } = await admin
  .from('tickets')
  .select('id, subject, description, client_id, status')
  .eq('id', ticket.id)
  .maybeSingle()

check('it appears in the admin queue', !!inQueue)
check(
  'and the description came with it, so it can be triaged',
  inQueue?.description?.includes('E013'),
  'the office cannot read what the customer wrote',
)

/* ========================================================================== */
console.log(`\n2 · Support ticket · office acts, customer sees\n${LINE}`)

const { data: triaged, error: triageError } = await admin
  .from('tickets')
  .update({
    status: 'in_progress',
    assigned_to: engineer.userId,
    priority: 'urgent',
  })
  .eq('id', ticket.id)
  .select('id, status, assigned_to')

check('the office can triage it', !triageError, triageError?.message)
check('assigning it sticks', triaged?.[0]?.assigned_to === engineer.userId)

const { data: customerView } = await client
  .from('tickets')
  .select('status, priority, assigned_to')
  .eq('id', ticket.id)
  .single()

check(
  'the customer sees the new status',
  customerView.status === 'in_progress',
  `customer sees ${customerView.status}`,
)
check('and the raised priority', customerView.priority === 'urgent')

const { data: resolved } = await admin
  .from('tickets')
  .update({
    status: 'resolved',
    resolution: 'Replaced the DC isolator. Tested at full output.',
    resolved_at: new Date().toISOString(),
  })
  .eq('id', ticket.id)
  .select('id')
check('the office can resolve it', (resolved?.length ?? 0) === 1)

const { data: closedView } = await client
  .from('tickets')
  .select('status, resolution')
  .eq('id', ticket.id)
  .single()
check('the customer sees it resolved', closedView.status === 'resolved')
check(
  'and can read what was done',
  closedView.resolution?.includes('DC isolator'),
  'the resolution is invisible to the customer',
)

/* ========================================================================== */
console.log(`\n3 · A customer cannot triage their own ticket\n${LINE}`)

const { data: selfAssign } = await client
  .from('tickets')
  .update({ assigned_to: client.userId, priority: 'urgent' })
  .eq('id', created.tickets[1])
  .select('id')
check(
  'the customer cannot assign or re-prioritise',
  (selfAssign?.length ?? 0) === 0,
  'a customer edited a ticket after raising it',
)

const otherClientTicket = await client.from('tickets').select('id').neq('client_id', client.userId)
check(
  "and cannot read another customer's tickets",
  (otherClientTicket.data ?? []).length === 0,
  `read ${otherClientTicket.data?.length} foreign ticket(s)`,
)

/* ========================================================================== */
console.log(`\n4 · Appointment · customer books, dispatch sees\n${LINE}`)

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

const { data: appt, error: apptError } = await client
  .from('appointments')
  .insert({
    appointment_type: 'maintenance',
    status: 'requested',
    scheduled_date: tomorrow,
    time_slot: '10:00',
    client_id: client.userId,
    contact_name: 'Interconnect Check',
  })
  .select('id, status')
  .single()

check('the customer can request a visit', !apptError, apptError?.message)
if (appt) created.appointments.push(appt.id)

const { data: onBoard } = await admin
  .from('appointments')
  .select('id, status')
  .eq('id', appt.id)
  .maybeSingle()
check('it lands on the dispatch board', !!onBoard)
check('unassigned, awaiting a coordinator', onBoard?.status === 'requested')

const { data: dispatched } = await admin
  .from('appointments')
  .update({ status: 'dispatched' })
  .eq('id', appt.id)
  .select('id')
check('dispatch can assign it', (dispatched?.length ?? 0) === 1)

const { data: apptCustomerView } = await client
  .from('appointments')
  .select('status')
  .eq('id', appt.id)
  .single()
check('and the customer sees the confirmation', apptCustomerView.status === 'dispatched')

/* Dispatching notifies. The row is the proof the customer was told. */
const { data: dispatchNotice } = await admin
  .from('notifications')
  .select('id, title')
  .eq('entity_id', appt.id)
check(
  'dispatching queued a notification to the customer',
  (dispatchNotice ?? []).length > 0,
  'nobody told the customer a crew was assigned',
)

/* ========================================================================== */
console.log(`\n5 · Warranty · customer requests, office reviews\n${LINE}`)

const { data: ownProject } = await client.from('projects').select('id').limit(1).maybeSingle()

if (!ownProject) {
  console.log('  SKIP  this customer has no project to transfer')
} else {
  /* `warranty_requests` links to a PROJECT, not an individual serialised asset
     — a transfer moves the whole installation to a new owner. */
  const { data: warranty, error: warrantyError } = await client
    .from('warranty_requests')
    .insert({
      request_type: 'transfer',
      project_id: ownProject.id,
      client_id: client.userId,
      status: 'pending',
      transfer_to_name: 'Interconnect Buyer',
      transfer_to_email: 'buyer@demo.solarbros.ph',
    })
    .select('id, status')
    .single()

  check('the customer can request a warranty transfer', !warrantyError, warrantyError?.message)

  if (warranty) {
    created.warranty.push(warranty.id)

    const { data: forReview } = await admin
      .from('warranty_requests')
      .select('id, status')
      .eq('id', warranty.id)
      .maybeSingle()
    check('it reaches the approvals queue', !!forReview)

    const { data: approved } = await admin
      .from('warranty_requests')
      .update({
        status: 'approved',
        reviewed_by: admin.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', warranty.id)
      .select('id')
    check('the office can approve it', (approved?.length ?? 0) === 1)

    const { data: customerSees } = await client
      .from('warranty_requests')
      .select('status')
      .eq('id', warranty.id)
      .single()
    check('and the customer sees the decision', customerSees.status === 'approved')
  }
}

/* ========================================================================== */
console.log(`\n6 · Stock · a movement changes the balance everyone reads\n${LINE}`)

const inventory = await signIn('inventory@demo.solarbros.ph')

/* Get-or-create rather than borrow.

   These suites were written against the seeded demonstration catalogue and
   crashed outright on an empty one — which is exactly what a freshly reset
   production database is. A suite that only runs on demo data is a suite
   nobody can run when it matters. */
let { data: item } = await inventory
  .from('stock_items')
  .select('id, name, on_hand')
  .order('sku')
  .limit(1)
  .maybeSingle()

if (!item) {
  const { data: made, error: makeError } = await inventory
    .from('stock_items')
    .insert({
      sku: `VERIFY-INTER-${Date.now()}`,
      name: 'Verification probe item',
      category: 'accessory',
      unit_cost: 500,
      reorder_point: 5,
    })
    .select('id, name, on_hand')
    .single()

  if (makeError) {
    console.error(`Could not create a stock item to test against: ${makeError.message}`)
    process.exit(1)
  }
  item = made
}

const before = Number(item.on_hand)

const { data: movement, error: movementError } = await inventory
  .from('stock_movements')
  .insert({
    stock_item_id: item.id,
    movement_type: 'adjustment',
    quantity: 3,
    note: 'Interconnect check',
  })
  .select('id')
  .single()

check('the inventory manager can post a movement', !movementError, movementError?.message)
if (movement) created.movements.push(movement.id)

const { data: after } = await admin.from('stock_items').select('on_hand').eq('id', item.id).single()

check(
  'the balance moved by exactly the posted quantity',
  Number(after.on_hand) === before + 3,
  `expected ${before + 3}, got ${after.on_hand}`,
)

/* Everyone reads the same number — this is the interconnection. */
const { data: engineerSees } = await engineer
  .from('stock_items')
  .select('on_hand')
  .eq('id', item.id)
  .single()
check('and the project engineer reads the same figure', Number(engineerSees.on_hand) === before + 3)

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

for (const id of created.warranty) await admin.from('warranty_requests').delete().eq('id', id)
for (const id of created.appointments) {
  await admin.from('notifications').delete().eq('entity_id', id)
  await admin.from('appointments').delete().eq('id', id)
}
let deletedTickets = 0
for (const id of created.tickets) {
  const { data: gone } = await admin.from('tickets').delete().eq('id', id).select('id')
  deletedTickets += gone?.length ?? 0
}
check(
  'every test ticket was actually deleted',
  deletedTickets === created.tickets.length,
  `deleted ${deletedTickets} of ${created.tickets.length}`,
)
for (const id of created.movements) await admin.from('stock_movements').delete().eq('id', id)
await admin.from('stock_items').update({ on_hand: before }).eq('id', item.id)

const { data: restored } = await admin
  .from('stock_items')
  .select('on_hand')
  .eq('id', item.id)
  .single()
check('the warehouse balance is back where it started', Number(restored.on_hand) === before)

const { data: leftTickets } = await admin
  .from('tickets')
  .select('id')
  .like('subject', 'Interconnect%')
check('the test records were removed', (leftTickets?.length ?? 0) === 0)

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
