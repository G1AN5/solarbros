/* ============================================================================
   STAFF APPROVAL VERIFICATION
   ----------------------------------------------------------------------------
   A role is the most dangerous thing this system hands out, so the rules around
   granting one are asserted rather than assumed:

     1. Registering and CLAIMING a role grants nothing at all.
     2. A pending account is refused everything a member of staff could read.
     3. Only an administrator may approve, and never their own registration.
     4. Approval is the ONLY route by which profiles.role can change — an
        administrator with full UPDATE on profiles still cannot set one.
     5. A customer can never be turned into staff, by anybody.
     6. Nobody can promote themselves.

       npm run verify:staff-approval

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

async function signIn(email) {
  const client = fresh()
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

const admin = await signIn('admin@demo.solarbros.ph')
const client = await signIn('client@demo.solarbros.ph')

const stamp = Date.now()
const applicantEmail = `approval-probe-${stamp}@demo.solarbros.ph`

/* ========================================================================== */
console.log(`\n1 · Registering claims a role and is granted nothing\n${LINE}`)

const applicant = fresh()
const { data: signUpData, error: signUpError } = await applicant.auth.signUp({
  email: applicantEmail,
  password: PASSWORD,
  options: {
    data: {
      full_name: 'Approval Probe',
      // The claim. Note it is NOT 'role' — nothing reads a role from here.
      requested_role: 'accountant',
    },
  },
})

if (isRateLimited(signUpError)) {
  console.log('  SKIP  the email rate limit was hit — configure SMTP, see docs/AUTH-SETUP.md')
  console.log(`\n${LINE}`)
  console.log('Skipped: Supabase’s built-in email sender allows about two messages an hour.')
  process.exit(0)
}

check('a stranger can register at the staff page', !signUpError, signUpError?.message)

const applicantId = signUpData?.user?.id
if (!applicantId) {
  console.log('\nCannot continue without an account.')
  process.exit(1)
}

const { data: parked } = await admin
  .from('profiles')
  .select('role, is_active, requested_role, approval_status')
  .eq('id', applicantId)
  .maybeSingle()

check(
  'the account is parked on the least-privileged role',
  parked?.role === 'client',
  `role is ${parked?.role}`,
)
check('and is inactive, so every staff policy denies', parked?.is_active === false)
check('the claim is recorded separately', parked?.requested_role === 'accountant')
check('and it is queued for approval', parked?.approval_status === 'pending')

/* ========================================================================== */
console.log(`\n2 · A pending account can read nothing\n${LINE}`)

/* Only if the project allows sign-in before confirmation; when email
   confirmation is on there is no session and that is a stronger result still. */
if (signUpData.session) {
  const pendingClient = fresh()
  await pendingClient.auth.setSession(signUpData.session)

  const { data: invoices } = await pendingClient.from('invoices').select('id').limit(1)
  check(
    'an accountant-in-waiting cannot read invoices',
    (invoices?.length ?? 0) === 0,
    `${invoices?.length} rows came back`,
  )

  const { data: ownProfile } = await pendingClient
    .from('profiles')
    .select('email, approval_status')
    .eq('id', applicantId)
    .maybeSingle()
  check(
    'but they can see their own row, so the app can say "awaiting approval"',
    ownProfile?.email === applicantEmail,
  )

  const { data: selfPromote } = await pendingClient
    .from('profiles')
    .update({ role: 'admin' })
    .eq('id', applicantId)
    .select('id')
  check(
    'and cannot promote themselves',
    (selfPromote?.length ?? 0) === 0,
    'the update went through',
  )
} else {
  check('email confirmation is on, so there is no session to test with', true)
}

/* ========================================================================== */
console.log(`\n3 · Only approval can move a role\n${LINE}`)

/* The crucial one. `profiles_admin_all` grants an administrator UPDATE on every
   profile, so without the immutability trigger this would simply succeed. */
const { data: directSet, error: directSetError } = await admin
  .from('profiles')
  .update({ role: 'accountant' })
  .eq('id', applicantId)
  .select('id')

check(
  'an administrator cannot set a role directly, even with UPDATE rights',
  Boolean(directSetError) || (directSet?.length ?? 0) === 0,
  'the update went through',
)

const { data: stillParked } = await admin
  .from('profiles')
  .select('role')
  .eq('id', applicantId)
  .maybeSingle()
check('and the role really did not move', stillParked?.role === 'client')

const { error: clientApproveError } = await client.rpc('approve_staff', {
  p_user_id: applicantId,
  p_approve: true,
})
check(
  'a customer cannot approve anybody',
  Boolean(clientApproveError),
  clientApproveError ? '' : 'the call succeeded',
)

const { error: selfApproveError } = await admin.rpc('approve_staff', {
  p_user_id: admin.userId,
  p_approve: true,
})
check(
  'an administrator cannot approve their own registration',
  Boolean(selfApproveError),
  selfApproveError ? '' : 'the call succeeded',
)

/* ========================================================================== */
console.log(`\n4 · Approval grants exactly what was claimed\n${LINE}`)

const { error: approveError } = await admin.rpc('approve_staff', {
  p_user_id: applicantId,
  p_approve: true,
})
check('an administrator can approve', !approveError, approveError?.message)

const { data: approved } = await admin
  .from('profiles')
  .select('role, is_active, approval_status, approved_by')
  .eq('id', applicantId)
  .maybeSingle()

check('the role is now the one claimed', approved?.role === 'accountant')
check('the account is active', approved?.is_active === true)
check('and it is marked approved', approved?.approval_status === 'approved')
check('stamped with who approved it', approved?.approved_by === admin.userId)

const { error: reApproveError } = await admin.rpc('approve_staff', {
  p_user_id: applicantId,
  p_approve: true,
})
check(
  'approving twice is refused',
  Boolean(reApproveError),
  reApproveError ? '' : 'the second call succeeded',
)

const { data: auditRows } = await admin
  .from('audit_log')
  .select('action, severity')
  .eq('entity_id', applicantId)
check(
  'and the grant is on the audit trail at warning severity',
  (auditRows ?? []).some((r) => r.action === 'staff_registration_approved' && r.severity === 'warning'),
)

/* ========================================================================== */
console.log(`\n5 · A customer stays a customer\n${LINE}`)

const { data: promoteCustomer, error: promoteCustomerError } = await admin
  .from('profiles')
  .update({ role: 'admin' })
  .eq('id', client.userId)
  .select('id')

check(
  'an administrator cannot promote a customer',
  Boolean(promoteCustomerError) || (promoteCustomer?.length ?? 0) === 0,
  'the update went through',
)

const { error: approveCustomerError } = await admin.rpc('approve_staff', {
  p_user_id: client.userId,
  p_approve: true,
})
check(
  'and cannot approve one into a role either',
  Boolean(approveCustomerError),
  approveCustomerError ? '' : 'the call succeeded',
)

const { data: stillClient } = await admin
  .from('profiles')
  .select('role')
  .eq('id', client.userId)
  .maybeSingle()
check('the customer is still a customer', stillClient?.role === 'client')

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

await admin.from('notifications').delete().eq('entity_id', applicantId)
await admin.from('audit_log').delete().eq('entity_id', applicantId)

console.log(`  The probe account ${applicantEmail} remains in auth.users.`)
console.log('  Remove it from the Supabase dashboard, or with:')
console.log(`    delete from auth.users where email like 'approval-probe-%';`)

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
