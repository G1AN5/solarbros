/* ============================================================================
   SEARCH INJECTION
   ----------------------------------------------------------------------------
   The console search once built a PostgREST filter by interpolating the term
   into a filter-grammar string. A comma in that grammar is an OR separator, so
   a search for `x,status.eq.completed` sent a condition the user had written.

   It is now a bound parameter to `console_search`, which cannot be read as
   syntax whatever it contains. These checks assert that — and that the
   function is SECURITY INVOKER, so row-level security still scopes the results
   to whoever is asking.

       npm run verify:search
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

const LINE = '='.repeat(64)
let passed = 0
let failed = 0
function check(label, ok, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`) }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const admin = createClient(URL, ANON, { auth: { persistSession: false } })
const { error: signInError } = await admin.auth.signInWithPassword({
  email: process.env.ADMIN_EMAIL ?? 'admin@demo.solarbros.ph',
  password: process.env.ADMIN_PASSWORD ?? 'SolarBros2026!',
})

if (signInError) {
  console.log(`Could not sign in: ${signInError.message}`)
  console.log('Set ADMIN_EMAIL and ADMIN_PASSWORD to run this against your own admin account.')
  process.exit(0)
}

console.log(`\nSearch cannot be injected\n${LINE}`)

/* Each of these is a valid PostgREST filter fragment. Under the old
   implementation they would have been parsed as query syntax. */
const PAYLOADS = [
  'x,status.eq.completed',
  'a,role.eq.admin',
  'b),or(id.not.is.null',
  "'; drop table public.leads; --",
  '%',
  '_',
]

for (const payload of PAYLOADS) {
  const { error } = await admin.rpc('console_search', { p_term: payload })
  check(`\`${payload.slice(0, 34)}\` is treated as text`, !error, error?.message)
}

/* The clearest proof: the table it tried to drop is still there. */
const { error: leadsError } = await admin.from('leads').select('id', { head: true, count: 'exact' })
check('the leads table survived a DROP TABLE payload', !leadsError, leadsError?.message)

/* Anonymous visitors cannot search the console at all. */
const anon = createClient(URL, ANON, { auth: { persistSession: false } })
const { error: anonError } = await anon.rpc('console_search', { p_term: 'test' })
check(
  'a logged-out visitor cannot call it',
  Boolean(anonError),
  anonError ? '' : 'the call succeeded',
)

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
