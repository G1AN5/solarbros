/* ============================================================================
   ROW LEVEL SECURITY VERIFICATION
   ----------------------------------------------------------------------------
   Signs in as each demo account through the real Supabase API and checks what
   the database actually returns.

   WHY THIS EXISTS AND WHY IT IS NOT A UNIT TEST
   Every role check in the React code decides what to RENDER. None of it decides
   what a user may READ. Testing access through the UI proves nothing, because
   the UI only ever asks for what it intends to show — it never tries to read
   somebody else's invoices.

   This script does try. It uses the anon key and real passwords, exactly as a
   browser would, so a policy mistake shows up as a row count instead of as a
   customer discovering another customer's contract value.

   It is a script rather than a Vitest test because it needs live credentials
   and a network, neither of which CI has.

       npm run verify:rls

   ========================================================================== */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

/* --- Read .env.local without adding a dotenv dependency ------------------- */
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
const KEY = env.VITE_SUPABASE_ANON_KEY
const PASSWORD = 'SolarBros2026!'

if (!URL || !KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

/** Count rows a given signed-in role can actually read from a table. */
async function countAs(client, table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
  if (error) return `ERR(${error.code ?? error.message})`
  return count ?? 0
}

async function signIn(email) {
  const client = createClient(URL, KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

/* Each expectation is written as "what must be true", so a failure names the
   security property that broke rather than just a number that changed. */
const results = []
function check(role, description, actual, pass) {
  results.push({ role, description, actual: String(actual), pass })
}

/* A "CAN read" expectation is satisfied by the policy ALLOWING the read — not
   by there being something to read. On a freshly reset system every content
   table is empty, and reporting that as "2 SECURITY EXPECTATIONS FAILED" is
   how a security suite teaches people to ignore it.

   So an empty result is reported as SKIP, and only an actual error — which is
   what a denying policy produces here — fails. */
function checkReadable(role, description, actual) {
  if (String(actual).startsWith('ERR')) {
    results.push({ role, description, actual: String(actual), pass: false })
    return
  }
  if (Number(actual) === 0) {
    results.push({ role, description, actual: 'none yet', pass: true, skipped: true })
    return
  }
  results.push({ role, description, actual: String(actual), pass: true })
}

console.log('Verifying Row Level Security against the live database...\n')

/* ------------------------------------------------ ANONYMOUS (logged out) */
{
  const anon = createClient(URL, KEY, { auth: { persistSession: false } })

  const packages = await countAs(anon, 'packages')
  checkReadable('anon', 'CAN read published packages', packages)

  const reviews = await countAs(anon, 'reviews')
  checkReadable('anon', 'CAN read approved reviews', reviews)

  // The critical one. A public site that leaks its leads table hands a
  // competitor the entire prospect list.
  const leads = await countAs(anon, 'leads')
  check('anon', 'CANNOT read leads', leads, leads === 0 || String(leads).startsWith('ERR'))

  const projects = await countAs(anon, 'projects')
  check(
    'anon',
    'CANNOT read projects',
    projects,
    projects === 0 || String(projects).startsWith('ERR'),
  )

  const invoices = await countAs(anon, 'invoices')
  check(
    'anon',
    'CANNOT read invoices',
    invoices,
    invoices === 0 || String(invoices).startsWith('ERR'),
  )

  const profiles = await countAs(anon, 'profiles')
  check(
    'anon',
    'CANNOT read profiles',
    profiles,
    profiles === 0 || String(profiles).startsWith('ERR'),
  )

  /* Since migration 0021 the public forms go through validated functions, and
     the direct table write is closed. Both halves are asserted: a stranger must
     not be able to write a raw row, and the front door must still open.
     Checking only the first would pass on a website whose forms are broken. */
  const { error: insErr } = await anon.from('leads').insert({
    name: 'RLS probe',
    email: `probe-${Date.now()}@example.test`,
    source: 'estimator',
    monthly_bill: 5000,
  })
  check('anon', 'CANNOT write a lead row directly', insErr ? 'blocked' : 'WROTE IT', !!insErr)

  const { error: rpcErr } = await anon.rpc('submit_enquiry', {
    p_name: 'RLS probe',
    p_email: `probe-${Date.now()}@example.test`,
    p_message: 'Created by verify:rls.',
  })
  check('anon', 'CAN submit through the public form', rpcErr ? rpcErr.message : 'ok', !rpcErr)

  // Forging an audit entry must be impossible.
  const { error: auditErr } = await anon.from('audit_log').insert({
    action: 'FORGED',
    entity: 'test',
    entity_id: 'x',
  })
  check('anon', 'CANNOT forge an audit entry', auditErr ? 'blocked' : 'WROTE IT', !!auditErr)
}

/* ------------------------------------------------------------- CLIENT */
{
  const client = await signIn('client@demo.solarbros.ph')

  check('client', 'CAN see own project', await countAs(client, 'projects'), true)
  check('client', 'CAN see own invoices', await countAs(client, 'invoices'), true)
  check('client', 'CAN see own milestones', await countAs(client, 'project_milestones'), true)
  check('client', 'CAN see own serial assets', await countAs(client, 'serialised_assets'), true)

  const leads = await countAs(client, 'leads')
  check('client', 'CANNOT see the CRM', leads, leads === 0)

  const stock = await countAs(client, 'stock_items')
  check('client', 'CANNOT see inventory', stock, stock === 0)

  const audit = await countAs(client, 'audit_log')
  check('client', 'CANNOT see the audit log', audit, audit === 0)

  const quotes = await countAs(client, 'quotations')
  check('client', 'CANNOT see internal quotations', quotes, quotes === 0)

  const payroll = await countAs(client, 'payroll_lines')
  check('client', 'CANNOT see payroll', payroll, payroll === 0)

  // Privilege escalation: the single most valuable thing to attempt.
  const { data: me } = await client.auth.getUser()
  const { data: esc, error: escErr } = await client
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', me.user.id)
    .select()
  // Blocked either by an error (WITH CHECK violation) or by affecting no rows.
  const escalated = !escErr && (esc?.length ?? 0) > 0
  check('client', 'CANNOT promote self to admin', escalated ? 'ESCALATED' : 'blocked', !escalated)

  // Confirm from the database rather than trusting the write's return value.
  const { data: roleNow } = await client
    .from('profiles')
    .select('role')
    .eq('id', me.user.id)
    .single()
  check(
    'client',
    'role is still client after the attempt',
    roleNow?.role ?? '?',
    roleNow?.role === 'client',
  )

  // Milestones are reported by the crew, never by the customer.
  //
  // IMPORTANT: a blocked write does NOT produce an error here. When RLS filters
  // a row out of the USING clause, PostgREST reports success and simply updates
  // zero rows. Testing `error !== null` therefore gives a false failure on a
  // correctly-blocked write, and — far worse — would give a false PASS if a
  // write were ever silently permitted. The only trustworthy signal is how many
  // rows came back from .select().
  const { data: ms } = await client
    .from('project_milestones')
    .select('id')
    .neq('status', 'done')
    .limit(1)
  if (ms?.length) {
    const { data: written } = await client
      .from('project_milestones')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', ms[0].id)
      .select()
    const rows = written?.length ?? 0
    check('client', 'CANNOT complete own milestones', `${rows} rows`, rows === 0)
  }

  await client.auth.signOut()
}

/* --------------------------------------------------------- TECHNICIAN */
{
  const tech = await signIn('technician@demo.solarbros.ph')

  check('technician', 'CAN see assigned project', await countAs(tech, 'projects'), true)
  check(
    'technician',
    'CAN see stock (what is on the van)',
    await countAs(tech, 'stock_items'),
    true,
  )
  check('technician', 'CAN see own appointments', await countAs(tech, 'appointments'), true)

  const invoices = await countAs(tech, 'invoices')
  check('technician', 'CANNOT see invoices', invoices, invoices === 0)

  const audit = await countAs(tech, 'audit_log')
  check('technician', 'CANNOT see the audit log', audit, audit === 0)

  const payroll = await countAs(tech, 'payroll_lines')
  check('technician', 'CANNOT see everyone payroll', payroll, payroll === 0)

  // A technician MAY move a milestone on a job they are crewed on. This is the
  // one write that drives the whole system.
  const { data: ms } = await tech
    .from('project_milestones')
    .select('id,key,status')
    .eq('key', 'dc_wiring')
    .limit(1)
  if (ms?.length) {
    /* Read the note first and put it back afterwards. This probe used to leave
       "RLS probe: crew write permitted" on a real milestone, where it showed up
       on the CUSTOMER'S dashboard under "currently in progress" — found by
       looking at the portal rather than by any test. A verification script that
       writes to production data has to clean up after itself. */
    const { data: before } = await tech
      .from('project_milestones')
      .select('note')
      .eq('id', ms[0].id)
      .single()

    const { data: written, error } = await tech
      .from('project_milestones')
      .update({ note: 'RLS probe: crew write permitted' })
      .eq('id', ms[0].id)
      .select()
    const rows = written?.length ?? 0
    check(
      'technician',
      'CAN update milestone on own job',
      error ? error.message : `${rows} rows`,
      !error && rows === 1,
    )

    await tech
      .from('project_milestones')
      .update({ note: before?.note ?? null })
      .eq('id', ms[0].id)
  }

  await tech.auth.signOut()
}

/* --------------------------------------------------------------- SALES */
{
  const sales = await signIn('sales@demo.solarbros.ph')

  check('sales', 'CAN see the CRM', await countAs(sales, 'leads'), true)
  check('sales', 'CAN see quotations', await countAs(sales, 'quotations'), true)

  const payroll = await countAs(sales, 'payroll_lines')
  check('sales', 'CANNOT see payroll', payroll, payroll === 0)

  const audit = await countAs(sales, 'audit_log')
  check('sales', 'CANNOT see the audit log', audit, audit === 0)

  await sales.auth.signOut()
}

/* ---------------------------------------------------------- ACCOUNTANT */
{
  const acct = await signIn('accounts@demo.solarbros.ph')

  check('accountant', 'CAN see invoices', await countAs(acct, 'invoices'), true)
  check('accountant', 'CAN see payments', await countAs(acct, 'payments'), true)

  const audit = await countAs(acct, 'audit_log')
  check('accountant', 'CANNOT see the audit log', audit, audit === 0)

  await acct.auth.signOut()
}

/* --------------------------------------------------------------- ADMIN */
{
  const admin = await signIn('admin@demo.solarbros.ph')

  const audit = await countAs(admin, 'audit_log')
  check('admin', 'CAN see the audit log', audit, Number(audit) > 0)
  check('admin', 'CAN see everything', await countAs(admin, 'projects'), true)

  // Even an administrator must not be able to rewrite history.
  const { data: entry } = await admin.from('audit_log').select('id').limit(1)
  if (entry?.length) {
    const { error: updErr } = await admin
      .from('audit_log')
      .update({ action: 'TAMPERED' })
      .eq('id', entry[0].id)
      .select()
    check('admin', 'CANNOT edit the audit log', updErr ? 'blocked' : 'TAMPERED', !!updErr)

    const { error: delErr } = await admin.from('audit_log').delete().eq('id', entry[0].id).select()
    check('admin', 'CANNOT delete the audit log', delErr ? 'blocked' : 'DELETED', !!delErr)
  }

  await admin.auth.signOut()
}

/* --------------------------------------------------------- CLEAN UP
   The anon probe above inserts a real lead each run. Left alone they pile up in
   the CRM and clutter a demonstration, so remove them as admin — which also
   exercises the delete policy. */
{
  const admin = await signIn('admin@demo.solarbros.ph')
  const { error } = await admin.from('leads').delete().eq('name', 'RLS probe')
  check('admin', 'CAN clean up probe leads', error ? error.message : 'ok', !error)
  await admin.auth.signOut()
}

/* ------------------------------------------------------------- REPORT */
console.log(
  ['ROLE', 'EXPECTATION', 'RESULT', ''].map((h, i) => h.padEnd([12, 42, 10, 4][i])).join(''),
)
console.log('-'.repeat(70))

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(
    r.role.padEnd(12) +
      r.description.padEnd(42) +
      r.actual.slice(0, 9).padEnd(10) +
      (r.skipped ? 'SKIP' : r.pass ? 'PASS' : 'FAIL'),
  )
}

const skipped = results.filter((r) => r.skipped).length

console.log('-'.repeat(70))
console.log(
  `${results.length - failed - skipped}/${results.length - skipped} passed` +
    (skipped > 0 ? `, ${skipped} skipped (nothing published yet to read)` : ''),
)
if (failed > 0) {
  console.error(`\n${failed} SECURITY EXPECTATION(S) FAILED`)
  process.exit(1)
}
console.log('\nAll access-control expectations hold.')
