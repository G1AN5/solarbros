/* ============================================================================
   MILESTONE STATE MACHINE VERIFICATION
   ----------------------------------------------------------------------------
   Before migration 0027, `project_milestones.status` was a free-for-all: any of
   the seven stages could be marked done at any time by anyone the policy let
   through. A technician could complete "Turnover & Handover" on their first day
   on site — which notifies the customer that their installation is finished and
   raises the final invoice.

   Three rules are checked here, and so is the escape hatch:

     ORDER      a stage cannot start while an earlier one is unfinished
     GATE       structural mounting waits for permits AND materials
     DERIVED    the project status follows its milestones instead of drifting
     OVERRIDE   an administrator can force any of it, and it is audited

   The override matters as much as the rules. A system that cannot be overridden
   gets worked around outside itself, and then the records are fiction.

   Builds its own contract and project so the assertions are unambiguous, and
   removes them afterwards.

       npm run verify:milestones

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
const engineer = await signIn('engineer@demo.solarbros.ph')

/* ------------------------------------------------------- BUILD A PROJECT */
console.log(`\nSetting up a project to work on\n${LINE}`)

const tag = Date.now()
const { data: lead } = await admin
  .from('leads')
  .insert({ name: 'Milestone Test', email: `milestone-${tag}@example.test`, source: 'walk_in' })
  .select('id')
  .single()

const { data: quotation } = await admin
  .from('quotations')
  .insert({
    lead_id: lead.id,
    system_kw: 5,
    system_type: 'on_grid',
    total_price: 300000,
    status: 'accepted',
  })
  .select('id')
  .single()

const { data: contract } = await admin
  .from('contracts')
  .insert({
    quotation_id: quotation.id,
    lead_id: lead.id,
    contract_value: 300000,
    status: 'awaiting_company',
    client_signed_at: new Date().toISOString(),
    client_signature_name: 'Milestone Test',
  })
  .select('id')
  .single()

await admin
  .from('contracts')
  .update({
    status: 'executed',
    company_signed_at: new Date().toISOString(),
    company_signed_by: admin.userId,
  })
  .eq('id', contract.id)

const { data: project } = await admin
  .from('projects')
  .select('id, reference, status')
  .eq('contract_id', contract.id)
  .maybeSingle()

check('executing the contract created the project', !!project)
if (!project) {
  console.error('Nothing below can run.')
  process.exit(1)
}
console.log(`        ${project.reference}, status ${project.status}`)

const { data: milestones } = await admin
  .from('project_milestones')
  .select('id, key, label, sequence, status')
  .eq('project_id', project.id)
  .order('sequence')

check('with all seven milestones pending', milestones?.length === 7)
const byKey = Object.fromEntries((milestones ?? []).map((m) => [m.key, m]))

/* ========================================================================== */
console.log(`\n1 · Stages have to happen in order\n${LINE}`)

const { error: skipError } = await engineer
  .from('project_milestones')
  .update({ status: 'done', completed_at: new Date().toISOString() })
  .eq('id', byKey.turnover.id)
checkRefused('an engineer cannot complete turnover on day one', skipError, 'completed in order')

const { error: firstError } = await engineer
  .from('project_milestones')
  .update({ status: 'done', completed_at: new Date().toISOString() })
  .eq('id', byKey.engineering_survey.id)
check('but the first stage can be completed', !firstError, firstError?.message)

const { data: afterFirst } = await admin
  .from('projects')
  .select('status')
  .eq('id', project.id)
  .single()
check(
  'and the project moved from planning to in progress',
  afterFirst.status === 'in_progress',
  `status is ${afterFirst.status}`,
)

const { error: stillBlockedError } = await engineer
  .from('project_milestones')
  .update({ status: 'in_progress' })
  .eq('id', byKey.dc_wiring.id)
checkRefused('the fourth stage is still blocked by the second', stillBlockedError, 'in order')

/* ========================================================================== */
console.log(`\n2 · The synchronise gate\n${LINE}`)

const { data: gateBefore } = await admin.rpc('project_gate_status', { p_project_id: project.id })
check('the gate reports permits are not ready', gateBefore.permits_ready === false)
check(
  'and reports on materials',
  typeof gateBefore.materials_ready === 'boolean',
  JSON.stringify(gateBefore),
)

/* Permitting has to clear first, and it clears from the permits table rather
   than by someone ticking a box. */
const { data: permit } = await engineer
  .from('permits')
  .insert({
    project_id: project.id,
    permit_type: 'lgu_building',
    authority: 'Verification City Hall',
    status: 'preparing',
  })
  .select('id')
  .single()

const { data: permittingPending } = await admin
  .from('project_milestones')
  .select('status')
  .eq('id', byKey.permitting.id)
  .single()
check(
  'tracking a permit does not complete the permitting stage on its own',
  permittingPending.status !== 'done',
  `status is ${permittingPending.status}`,
)

/* A rejection must show as blocked, not as an absence — a stalled project and a
   refused permit look identical otherwise. */
await engineer
  .from('permits')
  .update({
    status: 'rejected',
    external_reference: 'REJ-VERIFY-1',
    decided_at: new Date().toISOString(),
    recorded_by: engineer.userId,
    recorded_at: new Date().toISOString(),
  })
  .eq('id', permit.id)

const { data: permittingBlocked } = await admin
  .from('project_milestones')
  .select('status, note')
  .eq('id', byKey.permitting.id)
  .single()
check(
  'a rejected permit BLOCKS the permitting stage',
  permittingBlocked.status === 'blocked',
  `status is ${permittingBlocked.status}`,
)

await engineer
  .from('permits')
  .update({
    status: 'approved',
    external_reference: 'BP-VERIFY-1',
    decided_at: new Date().toISOString(),
    recorded_by: engineer.userId,
    recorded_at: new Date().toISOString(),
  })
  .eq('id', permit.id)

const { data: permittingDone } = await admin
  .from('project_milestones')
  .select('status')
  .eq('id', byKey.permitting.id)
  .single()
check(
  'approving every tracked permit completes the stage automatically',
  permittingDone.status === 'done',
  `status is ${permittingDone.status}`,
)

const { data: gateAfterPermits } = await admin.rpc('project_gate_status', {
  p_project_id: project.id,
})
check('the gate now reports permits ready', gateAfterPermits.permits_ready === true)

/* Materials are the other half. This project reserved nothing (its quotation
   has no lines), so the gate must still refuse. */
const { error: gateError } = await engineer
  .from('project_milestones')
  .update({ status: 'in_progress' })
  .eq('id', byKey.structural_mounting.id)

if (gateAfterPermits.materials_ready) {
  check('materials are on site, so mounting may begin', !gateError, gateError?.message)
} else {
  checkRefused(
    'physical work is refused while materials are not on site',
    gateError,
    'cannot start yet',
  )
}

/* ========================================================================== */
console.log(`\n3 · An administrator can override, and it is recorded\n${LINE}`)

const { error: overrideError } = await admin
  .from('project_milestones')
  .update({ status: 'in_progress' })
  .eq('id', byKey.structural_mounting.id)
check('an administrator can force the gate', !overrideError, overrideError?.message)

const { data: overrideAudit } = await admin
  .from('audit_log')
  .select('action, severity, entity')
  .eq('entity', 'project_milestones')
  .eq('entity_id', byKey.structural_mounting.id)

check('the override was written to the audit log', (overrideAudit?.length ?? 0) > 0)
check(
  'at WARNING severity, so it can be found later',
  overrideAudit?.[0]?.severity === 'warning',
  `severity was ${overrideAudit?.[0]?.severity}`,
)

/* ========================================================================== */
console.log(`\n4 · Completing the run\n${LINE}`)

for (const key of ['structural_mounting', 'dc_wiring', 'ac_wiring', 'commissioning', 'turnover']) {
  const { error } = await admin
    .from('project_milestones')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', byKey[key].id)
  if (error) {
    check(`completing ${key}`, false, error.message)
    break
  }
}

const { data: finished } = await admin
  .from('projects')
  .select('status, actual_turnover')
  .eq('id', project.id)
  .single()

check(
  'the project reports itself completed once every stage is done',
  finished.status === 'completed',
  `status is ${finished.status}`,
)
check('with the turnover date filled in', !!finished.actual_turnover)

const { data: milestoneInvoices } = await admin
  .from('invoices')
  .select('stage')
  .eq('project_id', project.id)

const stages = (milestoneInvoices ?? []).map((i) => i.stage).sort()
check(
  'and the milestone invoices were raised along the way',
  stages.includes('delivery') && stages.includes('commissioning'),
  `invoices: ${stages.join(', ')}`,
)

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

await admin.from('permits').delete().eq('project_id', project.id)
await admin.from('notifications').delete().eq('entity_id', project.id)
await admin.from('invoices').delete().eq('project_id', project.id)
await admin.from('stock_reservations').delete().eq('project_id', project.id)
await admin.from('project_milestones').delete().eq('project_id', project.id)
await admin.from('projects').delete().eq('id', project.id)
await admin.from('contracts').delete().eq('id', contract.id)
await admin.from('quotations').delete().eq('id', quotation.id)
await admin.from('leads').delete().eq('id', lead.id)

const { data: leftover } = await admin.from('projects').select('id').eq('id', project.id)
check('the test project chain was removed', (leftover?.length ?? 0) === 0)

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
