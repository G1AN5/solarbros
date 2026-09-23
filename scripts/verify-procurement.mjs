/* ============================================================================
   PROCUREMENT VERIFICATION
   ----------------------------------------------------------------------------
   Exercises the two tracks that stand between a signed contract and an
   installation, and the three gaps migration 0026 closed:

     1. THE REQUISITION LIMIT was a setting nothing read. It had promised since
        0018 that "a purchase order above this needs administrator approval",
        while no code anywhere enforced it.

     2. RECEIVING A DELIVERY ADDED NO STOCK. Marking a purchase order received
        changed a status and nothing else, so the warehouse showed goods it had
        physically taken in as still missing — and the reorder report kept
        asking for more.

     3. RESERVATIONS HAD NO RELEASE PATH. Consumption released them correctly,
        but a cancelled project held its stock for ever, with nothing on any
        screen to explain why the warehouse had less available than it held.

   Plus the external-party proxy pattern, which is the point of the permits
   screen: an approval must record who entered it, and must be distinguishable
   in the audit log from an actual decision by the authority.

       npm run verify:procurement

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

const admin = await signIn('admin@demo.solarbros.ph')
const inventory = await signIn('inventory@demo.solarbros.ph')
const engineer = await signIn('engineer@demo.solarbros.ph')

const created = { orders: [], permits: [] }

/* ========================================================================== */
console.log(`\n1 · Raising a purchase order\n${LINE}`)

let { data: supplier } = await admin
  .from('suppliers')
  .select('id, name')
  .limit(1)
  .maybeSingle()

if (!supplier) {
  const { data: made, error: supplierError } = await admin
    .from('suppliers')
    .insert({ name: `Verification Supplier ${Date.now()}`, lead_time_days: 7 })
    .select('id, name')
    .single()

  if (supplierError) {
    console.error(`Could not create a supplier to test against: ${supplierError.message}`)
    process.exit(1)
  }
  supplier = made
}
/* Get-or-create rather than borrow.

   These suites were written against the seeded demonstration catalogue and
   crashed outright on an empty one — which is exactly what a freshly reset
   production database is. A suite that only runs on demo data is a suite
   nobody can run when it matters. */
let { data: item } = await admin
  .from('stock_items')
  .select('id, sku, name, on_hand, unit_cost')
  .order('sku')
  .limit(1)
  .maybeSingle()

if (!item) {
  const { data: made, error: makeError } = await admin
    .from('stock_items')
    .insert({
      sku: `VERIFY-PROC-${Date.now()}`,
      name: 'Verification probe item',
      category: 'accessory',
      unit_cost: 500,
      reorder_point: 5,
    })
    .select('id, sku, name, on_hand, unit_cost')
    .single()

  if (makeError) {
    console.error(`Could not create a stock item to test against: ${makeError.message}`)
    process.exit(1)
  }
  item = made
}

const startingOnHand = Number(item.on_hand)
console.log(`Using ${item.name} (${item.sku}) — ${startingOnHand} on hand`)

const { data: smallPo, error: smallPoError } = await inventory
  .from('purchase_orders')
  .insert({ supplier_id: supplier.id, status: 'draft', total_amount: 5000 })
  .select('id, po_number, status')
  .single()

check('an inventory manager can raise a purchase order', !smallPoError, smallPoError?.message)
if (smallPo) {
  created.orders.push(smallPo.id)
  check('it gets a PO number from the sequence', !!smallPo.po_number, 'po_number is null')
  console.log(`        ${smallPo.po_number}`)
}

/* ========================================================================== */
console.log(`\n2 · The requisition approval limit\n${LINE}`)

const { data: limitSetting } = await admin
  .from('settings')
  .select('value')
  .eq('key', 'inventory.requisition_approval_limit')
  .single()
const limit = Number(limitSetting.value)
console.log(`Limit is ${limit.toLocaleString()}`)

const { data: bigPo } = await inventory
  .from('purchase_orders')
  .insert({ supplier_id: supplier.id, status: 'draft', total_amount: limit + 50000 })
  .select('id, po_number')
  .single()

if (bigPo) created.orders.push(bigPo.id)

check('a large order can still be DRAFTED by an inventory manager', !!bigPo)

const { error: overLimitError } = await inventory
  .from('purchase_orders')
  .update({ status: 'approved' })
  .eq('id', bigPo.id)
checkRefused('but they cannot approve it past the limit', overLimitError, 'administrator approval')

const { data: adminApproved, error: adminApproveError } = await admin
  .from('purchase_orders')
  .update({ status: 'approved' })
  .eq('id', bigPo.id)
  .select('id, approved_by, approved_at')
check('an administrator can', !adminApproveError, adminApproveError?.message)
check(
  'and the approval is attributed to them, not to whoever asked',
  adminApproved?.[0]?.approved_by === admin.userId,
  `attributed to ${adminApproved?.[0]?.approved_by}`,
)
check('with a timestamp filled in by the database', !!adminApproved?.[0]?.approved_at)

const { error: smallApproveError } = await inventory
  .from('purchase_orders')
  .update({ status: 'approved' })
  .eq('id', smallPo.id)
check(
  'an order under the limit needs no administrator',
  !smallApproveError,
  smallApproveError?.message,
)

/* ========================================================================== */
console.log(`\n3 · Receiving a delivery actually moves stock\n${LINE}`)

const ORDER_QTY = 7
const { error: lineError } = await inventory.from('purchase_order_lines').insert({
  purchase_order_id: smallPo.id,
  stock_item_id: item.id,
  quantity: ORDER_QTY,
  unit_cost: Number(item.unit_cost),
})
check('lines can be added to the order', !lineError, lineError?.message)

await inventory.from('purchase_orders').update({ status: 'ordered' }).eq('id', smallPo.id)

const { error: receiveError } = await inventory
  .from('purchase_orders')
  .update({ status: 'received' })
  .eq('id', smallPo.id)
check('the delivery can be received', !receiveError, receiveError?.message)

const { data: afterReceipt } = await admin
  .from('stock_items')
  .select('on_hand')
  .eq('id', item.id)
  .single()

check(
  `on_hand rose by the ${ORDER_QTY} received`,
  Number(afterReceipt.on_hand) === startingOnHand + ORDER_QTY,
  `expected ${startingOnHand + ORDER_QTY}, got ${afterReceipt.on_hand}`,
)

const { data: movements } = await admin
  .from('stock_movements')
  .select('id, movement_type, quantity')
  .eq('purchase_order_id', smallPo.id)

check(
  'and it went through the ledger, not straight into the balance',
  (movements ?? []).some((m) => m.movement_type === 'receipt' && Number(m.quantity) === ORDER_QTY),
  `movements: ${JSON.stringify(movements)}`,
)

/* Double-click, or a retried request. Receiving twice must not double stock —
   the same failure the payment webhook guards against, from another direction. */
await inventory.from('purchase_orders').update({ status: 'ordered' }).eq('id', smallPo.id)
await inventory.from('purchase_orders').update({ status: 'received' }).eq('id', smallPo.id)

const { data: afterSecond } = await admin
  .from('stock_items')
  .select('on_hand')
  .eq('id', item.id)
  .single()

check(
  'receiving the same order twice does not double the stock',
  Number(afterSecond.on_hand) === startingOnHand + ORDER_QTY,
  `expected ${startingOnHand + ORDER_QTY}, got ${afterSecond.on_hand}`,
)

/* ========================================================================== */
console.log(`\n4 · Permits, and the external-party proxy\n${LINE}`)

const { data: project } = await admin.from('projects').select('id, reference').limit(1).single()

const { data: permit, error: permitError } = await engineer
  .from('permits')
  .insert({
    project_id: project.id,
    permit_type: 'net_metering',
    authority: 'Verification Utility',
    status: 'preparing',
  })
  .select('id')
  .single()

check('a project engineer can track a permit', !permitError, permitError?.message)
if (permit) created.permits.push(permit.id)

/* The constraint that stops an approval from appearing out of nowhere. */
const { error: noRecorderError } = await engineer
  .from('permits')
  .update({ status: 'approved' })
  .eq('id', permit.id)
checkRefused(
  'an approval with no recorder is refused by the database',
  noRecorderError,
  'permits_decision_needs_recorder',
)

const { error: approveError } = await engineer
  .from('permits')
  .update({
    status: 'approved',
    external_reference: 'NM-2026-VERIFY-001',
    decided_at: new Date().toISOString(),
    recorded_by: engineer.userId,
    recorded_at: new Date().toISOString(),
  })
  .eq('id', permit.id)
check('a properly attributed approval is accepted', !approveError, approveError?.message)

/* The severity is what separates "the utility approved this" from "an employee
   said the utility approved this". */
const { data: auditRows } = await admin
  .from('audit_log')
  .select('action, severity, entity, entity_id')
  .eq('entity', 'permits')
  .eq('entity_id', permit.id)

check('the decision was written to the audit log', (auditRows?.length ?? 0) > 0)
check(
  'at WARNING severity, marking it as a proxy entry',
  auditRows?.[0]?.severity === 'warning',
  `severity was ${auditRows?.[0]?.severity}`,
)

const { data: clientTry } = await (
  await signIn('client@demo.solarbros.ph')
)
  .from('permits')
  .select('id')
  .limit(1)
check('a customer cannot read permits at all', (clientTry?.length ?? 0) === 0)

/* ========================================================================== */
console.log(`\n5 · Releasing reserved stock\n${LINE}`)

const { data: reservedItem } = await admin
  .from('stock_items')
  .select('id, name, reserved')
  .gt('reserved', 0)
  .limit(1)
  .maybeSingle()

if (!reservedItem) {
  console.log('  SKIP  no reserved stock in the database to release')
} else {
  const { data: reservation } = await admin
    .from('stock_reservations')
    .select('project_id, quantity_held')
    .eq('stock_item_id', reservedItem.id)
    .eq('status', 'reserved')
    .limit(1)
    .maybeSingle()

  if (!reservation) {
    console.log('  SKIP  no active reservation to release')
  } else {
    const before = Number(reservedItem.reserved)
    const held = Number(reservation.quantity_held)

    const { error: releaseError } = await inventory.rpc('release_project_reservations', {
      p_project_id: reservation.project_id,
    })
    check('reserved stock can be released', !releaseError, releaseError?.message)

    const { data: afterRelease } = await admin
      .from('stock_items')
      .select('reserved')
      .eq('id', reservedItem.id)
      .single()

    check(
      'and `reserved` actually came down',
      Number(afterRelease.reserved) === Math.max(0, before - held),
      `expected ${Math.max(0, before - held)}, got ${afterRelease.reserved}`,
    )

    const { data: releasedRow } = await admin
      .from('stock_reservations')
      .select('status, quantity_held')
      .eq('project_id', reservation.project_id)
      .eq('stock_item_id', reservedItem.id)
      .maybeSingle()

    check('the reservation row records that it was released', releasedRow?.status === 'released')

    // Put it back, so the demo data is unchanged.
    await admin.from('stock_items').update({ reserved: before }).eq('id', reservedItem.id)
    await admin
      .from('stock_reservations')
      .update({ status: 'reserved', quantity_held: held })
      .eq('project_id', reservation.project_id)
      .eq('stock_item_id', reservedItem.id)
    console.log('        (restored the reservation)')
  }
}

const { error: clientReleaseError } = await (
  await signIn('client@demo.solarbros.ph')
).rpc('release_project_reservations', { p_project_id: project.id })
checkRefused('a customer cannot release warehouse stock', clientReleaseError)

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

for (const id of created.permits) await admin.from('permits').delete().eq('id', id)

for (const id of created.orders) {
  await admin.from('stock_movements').delete().eq('purchase_order_id', id)
  await admin.from('purchase_order_lines').delete().eq('purchase_order_id', id)
  await admin.from('purchase_orders').delete().eq('id', id)
}

// The receipt movements are gone, so put the balance back where it started.
await admin.from('stock_items').update({ on_hand: startingOnHand }).eq('id', item.id)

const { data: restored } = await admin
  .from('stock_items')
  .select('on_hand')
  .eq('id', item.id)
  .single()
check(
  'the warehouse balance is back where it started',
  Number(restored.on_hand) === startingOnHand,
  `expected ${startingOnHand}, got ${restored.on_hand}`,
)
console.log(`  Removed ${created.orders.length} order(s) and ${created.permits.length} permit(s).`)

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
