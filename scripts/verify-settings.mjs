/* ============================================================================
   SETTINGS VERIFICATION
   ----------------------------------------------------------------------------
   Proves the settings table actually drives behaviour rather than merely being
   displayed. Each check changes a setting, observes the database behaving
   differently, then restores the original value.

   The important negative case is delegation: an accountant must be able to
   change a price and must NOT be able to change a lead-scoring weight, even
   though both live in the same table.

       npm run verify:settings
   ========================================================================== */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const URL = env.VITE_SUPABASE_URL,
  KEY = env.VITE_SUPABASE_ANON_KEY,
  PW = 'SolarBros2026!'

const results = []
const check = (d, a, p) => results.push({ d, a: String(a), p })
const signIn = async (e) => {
  const c = createClient(URL, KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email: e, password: PW })
  if (error) throw error
  return c
}

const admin = await signIn('admin@demo.solarbros.ph')

// --- 1. A setting change must alter how the scoring trigger computes --------
{
  const probe = {
    name: 'Settings probe',
    email: `settings-probe-${Date.now()}@example.com`,
    source: 'estimator',
    monthly_bill: 10000,
  }

  const { data: before } = await admin.from('leads').insert(probe).select('id,score').single()

  // Double the value of each peso of monthly bill.
  await admin.from('settings').update({ value: 250 }).eq('key', 'scoring.bill_divisor')

  const { data: after } = await admin
    .from('leads')
    .insert({ ...probe, email: `settings-probe2-${Date.now()}@example.com` })
    .select('id,score')
    .single()

  check(
    'changing a scoring weight changes the score',
    `${before.score} -> ${after.score}`,
    after.score > before.score,
  )

  await admin.from('settings').update({ value: 500 }).eq('key', 'scoring.bill_divisor')
  await admin.from('leads').delete().in('id', [before.id, after.id])
}

// --- 2. Discount authority is enforced by the DATABASE ----------------------
{
  /* Its OWN lead, not whichever one happens to come back first.

     Quotations are versioned per lead (`unique (lead_id, version)`), and this
     used to borrow an arbitrary existing lead without setting a version — so it
     collided with that lead's real quotation as soon as the data changed
     underneath it. A test that depends on which row sorts first is a test that
     fails for reasons unrelated to what it is checking. */
  const { data: lead } = await admin
    .from('leads')
    .insert({
      name: 'Settings Probe',
      email: `settings-probe-${Date.now()}@demo.solarbros.ph`,
      source: 'walk_in',
    })
    .select('id')
    .single()

  let version = 0
  const mk = (pct) => ({
    lead_id: lead.id,
    version: ++version,
    system_kw: 6,
    system_type: 'hybrid',
    total_price: 500000,
    discount_pct: pct,
    status: 'sent',
  })

  // 15% is above the seeded 10% limit, so this must be refused.
  const { error: refused } = await admin.from('quotations').insert(mk(15))
  check('discount above the limit is refused', refused ? 'blocked' : 'ACCEPTED', !!refused)

  // Raise the limit and the same quotation becomes acceptable.
  await admin.from('settings').update({ value: 20 }).eq('key', 'sales.discount_authority_pct')
  const { data: allowed, error: allowErr } = await admin.from('quotations').insert(mk(15)).select()
  check(
    'raising the limit permits the same discount',
    allowErr ? allowErr.message : 'accepted',
    !allowErr,
  )
  if (allowed?.length) await admin.from('quotations').delete().eq('id', allowed[0].id)

  await admin.from('settings').update({ value: 10 }).eq('key', 'sales.discount_authority_pct')

  await admin.from('quotations').delete().eq('lead_id', lead.id)
  await admin.from('leads').delete().eq('id', lead.id)
}

// --- 3. Delegation: right role yes, wrong role no --------------------------
{
  const acct = await signIn('accounts@demo.solarbros.ph')

  const { data: priced } = await acct
    .from('settings')
    .update({ value: 56000 })
    .eq('key', 'pricing.cost_per_kw_on_grid')
    .select()
  check(
    'accountant CAN change a price',
    priced?.length ? 'yes' : 'REFUSED',
    (priced?.length ?? 0) === 1,
  )
  await acct.from('settings').update({ value: 55000 }).eq('key', 'pricing.cost_per_kw_on_grid')

  const { data: scored } = await acct
    .from('settings')
    .update({ value: 99 })
    .eq('key', 'scoring.source_referral')
    .select()
  check(
    'accountant CANNOT change lead scoring',
    (scored?.length ?? 0) === 0 ? 'blocked' : 'CHANGED IT',
    (scored?.length ?? 0) === 0,
  )
  await acct.auth.signOut()

  const tech = await signIn('technician@demo.solarbros.ph')
  const { data: t } = await tech
    .from('settings')
    .update({ value: 1 })
    .eq('key', 'sales.discount_authority_pct')
    .select()
  check(
    'technician CANNOT change any setting',
    (t?.length ?? 0) === 0 ? 'blocked' : 'CHANGED IT',
    (t?.length ?? 0) === 0,
  )
  await tech.auth.signOut()
}

// --- 4. Public settings reach a logged-out visitor -------------------------
{
  const anon = createClient(URL, KEY, { auth: { persistSession: false } })
  const { data: pub } = await anon.from('settings').select('key').limit(100)
  const keys = (pub ?? []).map((r) => r.key)
  check('anon CAN read public settings', keys.length, keys.length > 0)
  check(
    'anon CANNOT read internal pricing',
    keys.includes('pricing.cost_per_kw_on_grid') ? 'LEAKED' : 'blocked',
    !keys.includes('pricing.cost_per_kw_on_grid'),
  )
  check(
    'anon CANNOT read discount authority',
    keys.includes('sales.discount_authority_pct') ? 'LEAKED' : 'blocked',
    !keys.includes('sales.discount_authority_pct'),
  )
}

// --- 5. Per-item reorder point is editable by the right role ---------------
{
  const inv = await signIn('inventory@demo.solarbros.ph')

  /* Makes its own item rather than borrowing one. Borrowing crashed outright
     on a system with an empty catalogue — which is exactly what a freshly
     reset production database is — and a suite that cannot run on a clean
     system is one nobody runs when it matters. */
  const probeSku = `VERIFY-SETTINGS-${Date.now()}`
  const { data: item, error: itemError } = await inv
    .from('stock_items')
    .insert({
      sku: probeSku,
      name: 'Verification probe item',
      category: 'accessory',
      reorder_point: 10,
      unit_cost: 1,
    })
    .select('id,reorder_point')
    .single()

  if (itemError || !item) {
    check('inventory manager CAN create a catalogue item', itemError?.message ?? 'no row', false)
    throw new Error('Cannot continue without a stock item to test against.')
  }

  const { data: upd } = await inv
    .from('stock_items')
    .update({ reorder_point: item.reorder_point + 5 })
    .eq('id', item.id)
    .select()
  check(
    'inventory manager CAN change a reorder point',
    upd?.length ? 'yes' : 'REFUSED',
    (upd?.length ?? 0) === 1,
  )
  await inv.from('stock_items').delete().eq('id', item.id)
  await inv.auth.signOut()
}

await admin.auth.signOut()

console.log('\n' + 'EXPECTATION'.padEnd(50) + 'RESULT'.padEnd(16))
console.log('-'.repeat(72))
let f = 0
for (const r of results) {
  if (!r.p) f++
  console.log(r.d.padEnd(50) + r.a.slice(0, 15).padEnd(16) + (r.p ? 'PASS' : 'FAIL'))
}
console.log('-'.repeat(72))
console.log(`${results.length - f}/${results.length} passed`)
if (f) {
  console.error(`\n${f} FAILED`)
  process.exit(1)
}
console.log('\nSettings drive real behaviour, and delegation holds.')
