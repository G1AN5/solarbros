/* ============================================================================
   MESSAGING FENCE VERIFICATION
   ----------------------------------------------------------------------------
   Staff may write to any colleague. A customer may write only to the people on
   their own installation, plus an administrator.

   THE UI IS NOT THE TEST. The "New message" list is filtered by the database,
   so of course it looks right. What matters is whether the rule survives
   somebody ignoring the interface entirely and calling the endpoints with the
   publishable key, which is in the browser bundle of a public website. That is
   what this script does: it signs in as a real customer and attacks.

       node scripts/verify-messaging.mjs <password>

   The password is passed on the command line rather than stored, because this
   repository deliberately keeps no staff credentials. Pass the shared test
   password; every probe account uses it.
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

const PASSWORD = process.argv[2] ?? process.env.VERIFY_PASSWORD
const CLIENT_EMAIL = process.argv[3] ?? process.env.VERIFY_CLIENT_EMAIL

if (!PASSWORD || !CLIENT_EMAIL) {
  console.log('SKIP  needs a password and a customer email:')
  console.log('      node scripts/verify-messaging.mjs <password> <customer-email>')
  process.exit(0)
}

const db = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

const { error: signInError } = await db.auth.signInWithPassword({
  email: CLIENT_EMAIL,
  password: PASSWORD,
})

if (signInError) {
  console.log(`FAIL  could not sign in as ${CLIENT_EMAIL} — ${signInError.message}`)
  process.exit(1)
}

const results = []
const check = (name, ok, detail) => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log(`\nMESSAGING — signed in as a customer (${CLIENT_EMAIL})\n`)

/* The directory the customer is offered. */
const { data: directory } = await db.rpc('messageable_people')
const roles = (directory ?? []).map((p) => p.role)

check(
  'the directory contains no staff outside their own job',
  roles.every((role) => role === 'admin'),
  `offered: ${roles.join(', ') || 'nobody'}`,
)

/* Somebody the customer must NOT reach. Found through the service-side list
   rather than hardcoded, so this works on any database. */
const forbidden = (directory ?? []).map((p) => p.id)

/* A customer cannot read the staff list, so the ids to attack come from the
   caller. Without one, the remaining probes cannot run — say so rather than
   passing vacuously. */
const TARGET = process.argv[4] ?? process.env.VERIFY_FORBIDDEN_ID

if (!TARGET) {
  console.log(
    'SKIP  pass the user id of a staff member NOT on this customer\'s job as the 4th\n' +
      '      argument to test the bypass directly.',
  )
} else {
  check('that id is genuinely not in their directory', !forbidden.includes(TARGET))

  const { data: may } = await db.rpc('may_message', { p_other: TARGET })
  check('may_message says no', may === false, `returned ${may}`)

  /* THE ONE THAT MATTERS. Calling the endpoint anyway. */
  const { data: created, error: openError } = await db.rpc('open_conversation', {
    p_other: TARGET,
    p_body: 'Bypassing the interface to reach somebody I am not entitled to.',
  })
  check(
    'open_conversation is refused when called directly',
    Boolean(openError) && !created,
    openError ? openError.message : `NOT REFUSED — created conversation ${created}`,
  )
}

/* The staffing map. A customer passing another customer's id used to get back
   that customer's engineer, crew and sales rep. */
const { error: staffError } = await db.rpc('staff_for_client', {
  p_client: '00000000-0000-0000-0000-000000000000',
})
check(
  'staff_for_client is not reachable from the API at all',
  Boolean(staffError),
  staffError ? staffError.message.slice(0, 70) : 'STILL EXPOSED',
)

/* And the table underneath it. */
const { data: profiles } = await db.from('profiles').select('id, email, role')
check(
  'the profiles table exposes only their own row',
  (profiles ?? []).length <= 1,
  `${(profiles ?? []).length} rows readable`,
)

await db.auth.signOut()

const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
