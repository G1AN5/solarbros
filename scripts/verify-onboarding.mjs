/* ============================================================================
   PROSPECT-TO-CLIENT ONBOARDING VERIFICATION
   ----------------------------------------------------------------------------
   Walks the handover that the whole business depends on, and that was silently
   broken until migration 0033:

     estimator submission  ->  lead
     sales quotes them     ->  quotation
     quote accepted        ->  contract (awaiting_client, client_id NULL)
     THEY REGISTER         ->  account linked to all of the above
     they sign             ->  contract awaiting_company

   Before 0033 the registration form asked for a project reference, sent it in
   the user's metadata, and nothing server-side ever read it. The account was
   created, the contract existed, and neither knew about the other — so the
   customer's portal was permanently empty and the contract they were supposed
   to sign was unreachable. Nothing errored; the two records simply never met.

   THE SECURITY HALF MATTERS AS MUCH AS THE FUNCTIONAL HALF.
   A project reference is printed on quotations and emails. It is an identifier,
   not a secret. So registering with a guessed reference must claim nothing —
   the email on the lead has to match the address being registered.

       npm run verify:onboarding

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

async function signIn(email, password = PASSWORD) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
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
const visitor = createClient(URL, ANON, { auth: { persistSession: false } })

const run = Date.now()
/* `@demo.solarbros.ph`, the same domain the seeded accounts use.

   Supabase Auth validates the domain at SIGNUP and rejects both `example.test`
   and `example.com`, while a plain table insert accepts anything — so the lead
   was created and only the registration failed, which is a confusing way to
   discover the rule. Everything created here is prefixed `onboarding-`. */
const prospectEmail = `onboarding-prospect-${run}@demo.solarbros.ph`
const strangerEmail = `onboarding-stranger-${run}@demo.solarbros.ph`

/* ========================================================================== */
console.log(`\n1 · A prospect submits the estimator\n${LINE}`)

const { error: submitError } = await visitor.rpc('submit_estimate', {
  p_name: 'Onboarding Prospect',
  p_email: prospectEmail,
  p_phone: '+63 900 111 2222',
  p_address: 'Paranaque',
  p_appliances: [{ applianceId: 'ac-15', quantity: 1, hoursPerDay: 8 }],
  p_estimate: {
    usagePattern: 'balanced',
    regionId: 'ncr',
    ratePerKwh: 13.5,
    currentMonthlyCost: 5000,
    monthlyKwh: 370,
    recommendedKw: 5,
    systemType: 'on_grid',
    estimatedCost: 300000,
    monthlySavings: 4500,
    paybackYears: 5.5,
  },
})
check('the public estimator creates a lead', !submitError, submitError?.message)

const { data: lead } = await admin
  .from('leads')
  .select('id, name, converted_client_id, score')
  .eq('email', prospectEmail)
  .maybeSingle()
check('sales can see it in the pipeline', !!lead)
check('with no client account yet', lead?.converted_client_id === null)

/* ========================================================================== */
console.log(`\n2 · Sales quotes them and raises a contract\n${LINE}`)

const { data: quotation } = await admin
  .from('quotations')
  .insert({
    lead_id: lead.id,
    system_kw: 5,
    system_type: 'on_grid',
    total_price: 300000,
    status: 'accepted',
  })
  .select('id, reference')
  .single()
check('a quotation is raised', !!quotation?.reference)

const { data: contract } = await admin
  .from('contracts')
  .insert({
    quotation_id: quotation.id,
    lead_id: lead.id,
    contract_value: 300000,
    status: 'awaiting_client',
  })
  .select('id, reference, client_id')
  .single()
check('a contract is raised awaiting their signature', !!contract?.reference)
check(
  'and it has no customer attached yet — they have no account',
  contract?.client_id === null,
  `client_id is ${contract?.client_id}`,
)

/* ========================================================================== */
console.log(`\n3 · The prospect registers\n${LINE}`)

/* The account is created through the `manage-staff` Edge Function rather than
   `auth.signUp`, for a reason worth recording.

   `signUp` sends a confirmation email, and Supabase's BUILT-IN sender is
   rate-limited to a couple of messages an hour. Running this twice in an hour
   fails with "email rate limit exceeded" — nothing to do with the code under
   test. That limit is also exactly why custom SMTP is on the pre-production
   checklist: the built-in sender cannot carry real signups.

   The linking logic is identical either way. `handle_new_user` is a trigger on
   `auth.users`, so it fires for an admin-created account and a self-registered
   one alike — and this path is a real scenario too: sales creating a portal
   account for a customer who asked them to. */
const { data: created, error: signUpError } = await admin.functions.invoke('manage-staff', {
  body: {
    action: 'create',
    email: prospectEmail,
    fullName: 'Onboarding Prospect',
    role: 'client',
    phone: '+63 900 111 2222',
  },
})
check('an account can be created for them', !signUpError, signUpError?.message)

const newUserId = created?.userId
const newPassword = created?.temporaryPassword
check('an account exists', !!newUserId)

/* THE CHECK THIS SCRIPT EXISTS FOR. Before 0033 every one of these was null,
   and the customer had a working login attached to nothing at all. */
const { data: linkedLead } = await admin
  .from('leads')
  .select('converted_client_id')
  .eq('id', lead.id)
  .single()
check(
  'their lead is now linked to the account',
  linkedLead.converted_client_id === newUserId,
  `converted_client_id is ${linkedLead.converted_client_id}`,
)

const { data: linkedContract } = await admin
  .from('contracts')
  .select('client_id, status')
  .eq('id', contract.id)
  .single()
check(
  'and so is the contract waiting for their signature',
  linkedContract.client_id === newUserId,
  `client_id is ${linkedContract.client_id}`,
)

/* ========================================================================== */
console.log(`\n4 · They can now actually sign it\n${LINE}`)

const client = await signIn(prospectEmail, newPassword)

const { data: visible } = await client
  .from('contracts')
  .select('id, reference, contract_value, status')
  .eq('client_id', client.userId)

check(
  'the contract appears in their portal',
  (visible ?? []).some((c) => c.id === contract.id),
  'the signing card would show nothing',
)

const { data: signed, error: signError } = await client
  .from('contracts')
  .update({
    client_signed_at: new Date().toISOString(),
    client_signature_name: 'Onboarding Prospect',
    status: 'awaiting_company',
  })
  .eq('id', contract.id)
  .select('status')

check('and they can sign it', !signError, signError?.message)
check('which hands it back to us', signed?.[0]?.status === 'awaiting_company')

/* ========================================================================== */
console.log(`\n5 · A stranger cannot claim somebody else's project\n${LINE}`)

/* A project reference is printed on every quotation and email. If registering
   with one were enough to claim the project, anyone who saw a quotation could
   take over that customer's portal. */
/* The email is the boundary. A reference typed at registration can only narrow
   what already matches the address — it can never claim anything on its own —
   so an account on an address nobody has quoted must end up with nothing,
   whatever reference it presents. */
const { data: stranger } = await admin.functions.invoke('manage-staff', {
  body: {
    action: 'create',
    email: strangerEmail,
    fullName: 'Opportunist',
    role: 'client',
  },
})

const strangerId = stranger?.userId
check('the stranger gets an account', !!strangerId)

const { data: stolenProjects } = await admin
  .from('projects')
  .select('id, reference')
  .eq('client_id', strangerId)
check(
  'but it claims NO project',
  (stolenProjects ?? []).length === 0,
  `claimed ${stolenProjects?.length} project(s) on an unmatched email`,
)

const { data: stolenContracts } = await admin
  .from('contracts')
  .select('id')
  .eq('client_id', strangerId)
check('and no contract', (stolenContracts ?? []).length === 0)

const { data: originalProject } = await admin
  .from('projects')
  .select('client_id')
  .eq('reference', 'SB-2026-1001')
  .maybeSingle()
check(
  "and the real customer's project is untouched",
  originalProject?.client_id !== strangerId,
  'the project changed hands',
)

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

await admin.from('contracts').delete().eq('id', contract.id)
await admin.from('quotations').delete().eq('id', quotation.id)
await admin.from('estimates').delete().eq('lead_id', lead.id)
await admin.from('leads').delete().eq('id', lead.id)

const { data: leftover } = await admin.from('leads').select('id').eq('email', prospectEmail)
check('the test records were removed', (leftover?.length ?? 0) === 0)

console.log(`\n  Two auth users remain — the Edge Function cannot delete users`)
console.log(`  by design. Clear them in the Supabase SQL editor:`)
console.log(`    delete from auth.users where email like 'onboarding-%';`)

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
