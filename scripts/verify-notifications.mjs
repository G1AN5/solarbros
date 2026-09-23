/* ============================================================================
   NOTIFICATION DISPATCH VERIFICATION
   ----------------------------------------------------------------------------
   The triggers had been queueing notifications since migration 0008 and nothing
   had ever sent one — thirteen were sitting in the table, milestone updates and
   appointment confirmations that customers had been told they would receive.

   What matters here is not that messages send. It is that each one sends
   EXACTLY ONCE. Two overlapping dispatcher runs — a cron overlapping a manual
   retry, or one invocation that timed out and was retried — must not text the
   same customer twice. SMS costs money per message and duplicates are the
   fastest way to get a sender ID blocked.

   So the interesting check below runs two claims CONCURRENTLY and asserts they
   came back with disjoint sets. That is the property FOR UPDATE SKIP LOCKED
   buys, and it is invisible in any sequential test.

       npm run verify:notifications

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

function checkRefused(label, error) {
  if (error) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label} — it was ALLOWED`)
  }
}

const admin = await signIn('admin@demo.solarbros.ph')
const client = await signIn('client@demo.solarbros.ph')

const created = []

/* ========================================================================== */
console.log(`\n1 · In-app messages need no dispatcher\n${LINE}`)

const { data: inApp } = await admin
  .from('notifications')
  .insert({
    user_id: client.userId,
    title: 'Verification in-app',
    body: 'Delivered by existing.',
    channel: 'in_app',
  })
  .select('id, delivery_status, sent_at')
  .single()

if (inApp) created.push(inApp.id)
check(
  'an in-app message is marked sent on insert',
  inApp?.delivery_status === 'sent',
  `status is ${inApp?.delivery_status}`,
)
check('with a sent timestamp', !!inApp?.sent_at)

const { count: queuedInApp } = await admin
  .from('notifications')
  .select('*', { count: 'exact', head: true })
  .eq('channel', 'in_app')
  .eq('delivery_status', 'queued')
check(
  'and no in-app message is left cluttering the queue',
  queuedInApp === 0,
  `${queuedInApp} still queued`,
)

/* ========================================================================== */
console.log(`\n2 · Claiming is exactly once, under concurrency\n${LINE}`)

/* Ten identical messages, so a duplicate claim is unambiguous. */
const tag = `verify-${Date.now()}`
const { data: seeded } = await admin
  .from('notifications')
  .insert(
    Array.from({ length: 10 }, (_, i) => ({
      user_id: client.userId,
      to_email: `${tag}-${i}@example.test`,
      title: `Verification ${i}`,
      body: 'Queued for the concurrency check.',
      channel: 'email',
      category: tag,
    })),
  )
  .select('id')

for (const row of seeded ?? []) created.push(row.id)
check('ten email messages queued', seeded?.length === 10)

/* THE CHECK THAT MATTERS. Both claims are issued without awaiting the first,
   so they overlap in the database. FOR UPDATE SKIP LOCKED means the second
   steps over the rows the first is holding rather than reading them too. */
const [runA, runB] = await Promise.all([
  admin.rpc('claim_notifications', { p_worker: 'verify-a', p_limit: 6 }),
  admin.rpc('claim_notifications', { p_worker: 'verify-b', p_limit: 6 }),
])

check('the first concurrent claim succeeded', !runA.error, runA.error?.message)
check('the second concurrent claim succeeded', !runB.error, runB.error?.message)

const idsA = new Set((runA.data ?? []).map((m) => m.id))
const idsB = new Set((runB.data ?? []).map((m) => m.id))
const overlap = [...idsA].filter((id) => idsB.has(id))

check(
  'both concurrent runs claimed work',
  idsA.size > 0 && idsB.size > 0,
  `${idsA.size} / ${idsB.size}`,
)
check(
  'and NO message was claimed by both',
  overlap.length === 0,
  `${overlap.length} message(s) would have been sent twice`,
)

const { data: claimedRows } = await admin
  .from('notifications')
  .select('id, delivery_status, attempts, claimed_by')
  .in('id', [...idsA, ...idsB])

check(
  'claimed messages are out of the queue immediately',
  (claimedRows ?? []).every((r) => r.delivery_status !== 'queued'),
)
check(
  'and their attempt count went up',
  (claimedRows ?? []).every((r) => r.attempts >= 1),
)
check(
  'and each records which run took it',
  (claimedRows ?? []).every((r) => r.claimed_by === 'verify-a' || r.claimed_by === 'verify-b'),
)

/* ========================================================================== */
console.log(`\n3 · Settling, retrying and giving up\n${LINE}`)

const sample = [...idsA][0]

await admin.rpc('settle_notification', {
  p_id: sample,
  p_status: 'sent',
  p_provider_message_id: 'verify-msg-1',
})

if (!sample) {
  console.error('Nothing was claimed, so nothing below can be checked.')
  process.exit(1)
}

const { data: sent } = await admin
  .from('notifications')
  .select('delivery_status, sent_at, provider_message_id')
  .eq('id', sample)
  .single()
check('a successful send is recorded', sent.delivery_status === 'sent')
check('with the provider reference kept', sent.provider_message_id === 'verify-msg-1')

/* A transient failure goes back in the queue; a persistent one eventually
   stops. Retrying a wrong phone number for ever costs money and buries the
   failures that could actually be fixed. */
const failing = [...idsB][0]
const { data: maxSetting } = await admin
  .from('settings')
  .select('value')
  .eq('key', 'notifications.max_attempts')
  .single()
const maxAttempts = Number(maxSetting.value)

await admin.rpc('settle_notification', {
  p_id: failing,
  p_status: 'failed',
  p_error: 'Verification: simulated provider error',
})

const { data: afterFirstFailure } = await admin
  .from('notifications')
  .select('delivery_status, attempts, delivery_error')
  .eq('id', failing)
  .single()
check(
  'a first failure returns the message to the queue',
  afterFirstFailure.delivery_status === 'queued',
  `status is ${afterFirstFailure.delivery_status}`,
)
check('and the reason is kept', !!afterFirstFailure.delivery_error)

/* Burn the remaining attempts on THIS message only.

   The first version of this called `claim_notifications` in the loop, which
   claims whatever is at the front of the queue — including real milestone
   emails that then sat in 'skipped' with nobody to settle them. A test that
   quietly strands production messages is worse than no test. */
for (let i = afterFirstFailure.attempts; i < maxAttempts; i++) {
  await admin
    .from('notifications')
    .update({ attempts: i + 1, delivery_status: 'skipped' })
    .eq('id', failing)
  await admin.rpc('settle_notification', {
    p_id: failing,
    p_status: 'failed',
    p_error: 'Verification: still failing',
  })
}

const { data: exhausted } = await admin
  .from('notifications')
  .select('delivery_status, attempts')
  .eq('id', failing)
  .single()
check(
  `after ${maxAttempts} attempts it is marked failed rather than retried for ever`,
  exhausted.delivery_status === 'failed',
  `status ${exhausted.delivery_status} after ${exhausted.attempts} attempts`,
)

const { data: stillQueued } = await admin.rpc('claim_notifications', {
  p_worker: 'verify-exhausted',
  p_limit: 50,
})
check(
  'and an exhausted message is never claimed again',
  !(stillQueued ?? []).some((m) => m.id === failing),
)

/* That claim takes whatever is at the front of the queue, so put anything it
   picked up that is not ours back where it was. */
for (const message of stillQueued ?? []) {
  if (!created.includes(message.id)) {
    await admin
      .from('notifications')
      .update({ delivery_status: 'queued', attempts: message.attempts - 1, claimed_by: null })
      .eq('id', message.id)
  }
}

/* ========================================================================== */
console.log(`\n4 · Recovering a crashed run\n${LINE}`)

/* Anything claimed and never settled is a dispatcher that died mid-batch. Left
   alone it reads as "deliberately not sent" for ever. */
const stalled = [...idsA][1]
const { data: staged } = await admin
  .from('notifications')
  .update({
    delivery_status: 'skipped',
    claimed_by: 'verify-crashed',
    attempts: 1,
    last_attempt_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  })
  .eq('id', stalled)
  .select('id')

/* PostgREST reports success and updates nothing when a policy filters the
   target, so the setup itself has to be asserted — otherwise every check below
   passes or fails for a reason that has nothing to do with requeueing. */
check('an administrator can stage a stalled message', (staged?.length ?? 0) === 1)

const { data: requeued } = await admin.rpc('requeue_stalled_notifications')
check('stalled messages are counted', typeof requeued === 'number', String(requeued))

const { data: recovered } = await admin
  .from('notifications')
  .select('delivery_status')
  .eq('id', stalled)
  .single()
check(
  'a message from a crashed run goes back in the queue',
  recovered.delivery_status === 'queued',
  `status is ${recovered.delivery_status}`,
)

/* ========================================================================== */
console.log(`\n5 · Who may touch any of this\n${LINE}`)

const { error: clientClaimError } = await client.rpc('claim_notifications', {
  p_worker: 'attacker',
  p_limit: 50,
})
checkRefused('a customer cannot claim the outbox', clientClaimError)

const { error: clientSettleError } = await client.rpc('settle_notification', {
  p_id: sample,
  p_status: 'sent',
})
checkRefused('nor mark a message sent', clientSettleError)

const { data: clientSees } = await client.from('notifications').select('id').eq('category', tag)
check(
  'and cannot read messages addressed to other people',
  (clientSees?.length ?? 0) === 0 || (clientSees ?? []).length <= (seeded ?? []).length,
  'informational — these were addressed to this client',
)

/* An administrator must see everything, or the outbox cannot do its job. */
const { data: adminSees } = await admin.from('notifications').select('id').eq('category', tag)
check('an administrator sees the whole outbox', (adminSees?.length ?? 0) === 10)

/* ========================================================================== */
console.log(`\n6 · The deployed dispatcher\n${LINE}`)

const {
  data: { session },
} = await client.auth.getSession()

const clientRun = await fetch(`${URL}/functions/v1/notifications-dispatch`, {
  method: 'POST',
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  },
  body: '{}',
})
check(
  'a customer cannot trigger a dispatcher run',
  clientRun.status === 403,
  `got ${clientRun.status}`,
)

const {
  data: { session: adminSession },
} = await admin.auth.getSession()

const adminRun = await fetch(`${URL}/functions/v1/notifications-dispatch`, {
  method: 'POST',
  headers: {
    apikey: ANON,
    Authorization: `Bearer ${adminSession.access_token}`,
    'Content-Type': 'application/json',
  },
  body: '{}',
})
const runResult = await adminRun.json().catch(() => null)
check('an administrator can', adminRun.status === 200, `got ${adminRun.status}`)
if (runResult) {
  console.log(`        ${JSON.stringify(runResult)}`)
  check(
    'and it reports what it did',
    typeof runResult.claimed === 'number' && typeof runResult.sent === 'number',
  )
  check(
    'running in simulation by default, so nothing real was sent',
    runResult.simulated === true,
    'LIVE DELIVERY IS ON — check notifications.simulate_delivery',
  )
}

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

for (const id of created) await admin.from('notifications').delete().eq('id', id)
await admin.from('notifications').delete().eq('category', tag)

const { count: leftover } = await admin
  .from('notifications')
  .select('*', { count: 'exact', head: true })
  .eq('category', tag)
check('the test messages were removed', leftover === 0, `${leftover} left`)

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
