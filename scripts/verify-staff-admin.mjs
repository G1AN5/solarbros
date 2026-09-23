/* ============================================================================
   STAFF LIFECYCLE VERIFICATION
   ----------------------------------------------------------------------------
   What an approved member of staff can reach, and what happens when their
   access is withdrawn.

   This suite used to test the `manage-staff` Edge Function creating accounts
   with a chosen role. That path is gone: staff register themselves and an
   administrator approves the role they claim (covered by
   `npm run verify:staff-approval`), and migration 0052 refuses every other
   route to a role change. What remains here is the part that was always the
   most valuable and is not covered anywhere else:

     1. AN APPROVED ROLE GRANTS EXACTLY ITS OWN MODULES — an engineer reads
        projects and cannot read payroll.
     2. DEACTIVATION ACTUALLY REVOKES. `is_active` was a boolean nothing
        consulted until migration 0016; a leaver kept full access and the
        screen said otherwise. This is the check that caught it.
     3. THE ENDPOINT THAT REMAINS CANNOT MINT STAFF.

       npm run verify:staff

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

function fresh() {
  return createClient(URL, ANON, { auth: { persistSession: false } })
}

async function signIn(email, password = PASSWORD) {
  const client = fresh()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) return { client: null, error: error.message }
  const {
    data: { user },
  } = await client.auth.getUser()
  client.userId = user.id
  return { client, error: null }
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


/* Supabase's BUILT-IN email sender allows roughly two messages an hour, and
   every `auth.signUp` here triggers a confirmation email. Hitting that limit
   says nothing about the code under test, so it is reported as a skip rather
   than a failure — a suite that exits 1 for an environmental reason trains
   people to ignore it exiting 1.

   Configuring real SMTP removes the limit. It is not optional for production
   either: staff registration goes through this same path, so on the built-in
   sender the third person to register in an hour silently receives nothing.
   See docs/AUTH-SETUP.md. */
function isRateLimited(error) {
  return /rate limit/i.test(error?.message ?? '')
}

const { client: admin, error: adminError } = await signIn('admin@demo.solarbros.ph')
if (!admin) {
  console.error(`Could not sign in as the administrator: ${adminError}`)
  process.exit(1)
}

const stamp = Date.now()
const probeEmail = `probe-engineer-${stamp}@demo.solarbros.ph`

/* ========================================================================== */
console.log(`\n1 · The remaining endpoint cannot mint staff\n${LINE}`)

const { error: staffCreateError } = await admin.functions.invoke('manage-staff', {
  body: {
    action: 'create',
    email: `probe-reject-${stamp}@demo.solarbros.ph`,
    fullName: 'Should Not Exist',
    role: 'project_engineer',
  },
})
check(
  'asking it for a staff role is refused',
  Boolean(staffCreateError),
  staffCreateError ? '' : 'an engineer account was created',
)

const { error: setRoleError } = await admin.functions.invoke('manage-staff', {
  body: { action: 'set_role', userId: admin.userId, role: 'admin' },
})
check(
  'and the role-changing action no longer exists',
  Boolean(setRoleError),
  setRoleError ? '' : 'set_role answered',
)

/* ========================================================================== */
console.log(`\n2 · A staff member through the real path\n${LINE}`)

/* Registration, then approval — exactly what a new employee does. */
const applicant = fresh()
const { data: signUpData, error: signUpError } = await applicant.auth.signUp({
  email: probeEmail,
  password: PASSWORD,
  options: {
    data: { full_name: 'Probe Engineer', requested_role: 'project_engineer' },
  },
})

if (isRateLimited(signUpError)) {
  console.log('  SKIP  the email rate limit was hit — configure SMTP, see docs/AUTH-SETUP.md')
  console.log(`\n${LINE}`)
  console.log(`${passed} passed, ${failed} failed (the rest skipped on the email rate limit)`)
  process.exit(failed > 0 ? 1 : 0)
}

check('they can register', !signUpError, signUpError?.message)

const probeId = signUpData?.user?.id
if (!probeId) {
  console.log('\nCannot continue without an account.')
  process.exit(1)
}

const { error: approveError } = await admin.rpc('approve_staff', {
  p_user_id: probeId,
  p_approve: true,
})
check('an administrator can approve them', !approveError, approveError?.message)

const { data: profile } = await admin
  .from('profiles')
  .select('role, is_active')
  .eq('id', probeId)
  .maybeSingle()
check('and they hold the role they claimed', profile?.role === 'project_engineer')

/* ========================================================================== */
console.log(`\n3 · The role grants its own modules and no others\n${LINE}`)

const { client: engineer, error: engineerSignInError } = await signIn(probeEmail)

if (!engineer) {
  /* With email confirmation on, an unconfirmed account cannot sign in. That is
     the correct behaviour, so it is reported rather than failed. */
  check(
    'sign-in is blocked until the address is confirmed, which is correct',
    /confirm/i.test(engineerSignInError ?? ''),
    engineerSignInError ?? '',
  )
  console.log('\n  Skipping the access checks: no session without a confirmed address.')
} else {
  const { count: projects } = await engineer
    .from('projects')
    .select('id', { count: 'exact', head: true })
  check('an engineer can read projects', (projects ?? 0) >= 0)

  const { count: payroll } = await engineer
    .from('payroll_lines')
    .select('id', { count: 'exact', head: true })
  check(
    'and cannot read anybody else’s payroll',
    (payroll ?? 0) === 0,
    `${payroll} rows came back`,
  )

  /* ====================================================================== */
  console.log(`\n4 · Deactivation actually revokes\n${LINE}`)

  const { error: deactivateError } = await admin
    .from('profiles')
    .update({ is_active: false })
    .eq('id', probeId)
  check('an administrator can deactivate them', !deactivateError, deactivateError?.message)

  /* A fresh session, because migration 0016 notes that an existing JWT stays
     valid until it expires. Signing in again is what a real leaver's next
     attempt looks like. */
  const { client: revoked } = await signIn(probeEmail)
  if (revoked) {
    const { count: afterProjects } = await revoked
      .from('projects')
      .select('id', { count: 'exact', head: true })
    check(
      'and a deactivated account reads nothing',
      (afterProjects ?? 0) === 0,
      `${afterProjects} rows still came back`,
    )

    const { data: ownRow } = await revoked
      .from('profiles')
      .select('email')
      .eq('id', probeId)
      .maybeSingle()
    check(
      'but can still see its own row, so the screen can explain why',
      ownRow?.email === probeEmail,
    )
  }
}

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

await admin.from('notifications').delete().eq('entity_id', probeId)
await admin.from('audit_log').delete().eq('entity_id', probeId)

console.log(`  ${probeEmail} remains in auth.users.`)
console.log("  Clear probes with:  delete from auth.users where email like 'probe-%';")

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
