/* ============================================================================
   PUBLIC FORM VERIFICATION
   ----------------------------------------------------------------------------
   Submits the three public forms exactly as an anonymous visitor's browser
   does — anon key, no session — and checks four separate things:

     1. a legitimate submission lands, with the triggers fired;
     2. a malformed one is refused BY THE DATABASE, not by the browser;
     3. the visitor cannot read anything back, or write anything else;
     4. the staff and client paths that shared the old policies still work.

   POINT 4 IS THE ONE THAT WOULD OTHERWISE BREAK SILENTLY
   Migration 0021 dropped three `*_insert_public` policies, each of which was
   quietly doing three jobs: the public form, a staff member adding a walk-in,
   and a signed-in customer booking a maintenance visit. Replacing them with
   named policies is clearer, but it is also exactly the kind of change that
   passes review and then breaks the CRM a fortnight later. So this checks all
   three paths, not just the one the migration was about.

   Cleanup signs in as the administrator, because the visitor who created these
   rows has no right to delete them — which is itself part of the point.

       npm run verify:forms

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

if (!URL || !ANON) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

/* A visitor: anon key, no session, exactly like the browser. */
const visitor = createClient(URL, ANON, { auth: { persistSession: false } })

async function signIn(email) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

/* Every row this script creates is tagged, so cleanup is exact rather than
   "delete anything that looks like a test", which one day deletes a customer. */
const RUN = Date.now()
const LINE = '='.repeat(64)
const mail = (who) => `verify-${who}-${RUN}@example.test`

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

/** A call that is SUPPOSED to fail. Succeeding is the failure. */
function checkRejected(label, error, expectMatch) {
  if (!error) {
    failed++
    console.log(`  FAIL  ${label} — it was ACCEPTED`)
    return
  }
  const matched = !expectMatch || error.message.toLowerCase().includes(expectMatch.toLowerCase())
  if (matched) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label} — rejected, but for the wrong reason: ${error.message}`)
  }
}

/* ========================================================================== */
console.log(`\n1 · Valid submissions\n${LINE}`)

const enquiryEmail = mail('enquiry')
const { error: enquiryError } = await visitor.rpc('submit_enquiry', {
  p_name: 'Verification Enquiry',
  p_email: enquiryEmail,
  p_phone: '+63 900 000 0001',
  p_address: 'Paranaque',
  p_monthly_bill: 8000,
  p_message: 'Interested in a hybrid system.',
})
check('/contact submits', !enquiryError, enquiryError?.message)

const estimateEmail = mail('estimate')
const { error: estimateError } = await visitor.rpc('submit_estimate', {
  p_name: 'Verification Estimator',
  p_email: estimateEmail,
  p_phone: '+63 900 000 0002',
  p_address: 'Paranaque',
  p_appliances: [
    { applianceId: 'aircon-1hp-split', quantity: 2, hoursPerDay: 8, isInverterType: true },
    { applianceId: 'refrigerator', quantity: 1, hoursPerDay: 24 },
    {
      applianceId: 'custom-1',
      quantity: 1,
      hoursPerDay: 3,
      custom: { name: 'Water pump', watts: 750 },
    },
  ],
  p_estimate: {
    usagePattern: 'balanced',
    regionId: 'ncr',
    ratePerKwh: 12.5,
    currentMonthlyCost: 6750,
    peakLoadW: 2400,
    dailyWh: 18000,
    monthlyKwh: 540,
    recommendedKw: 6.2,
    systemType: 'hybrid',
    panelCount: 10,
    inverterKw: 6,
    batteryCount: 2,
    estimatedCost: 480000,
    monthlySavings: 6750,
    paybackYears: 5.9,
  },
})
check('/estimator submits', !estimateError, estimateError?.message)

const bookingEmail = mail('booking')
/* Three days out, not tomorrow. Migration 0038 requires 24 hours' notice, so a
   09:00 slot tomorrow is inside the window whenever this runs after 09:00 -
   which made this check pass in the morning and fail in the afternoon. The
   lead-time rule itself is asserted deliberately further down; this case is
   only meant to prove a valid booking submits. */
const tomorrow = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
const { error: bookingError } = await visitor.rpc('request_booking', {
  p_appointment_type: 'site_survey',
  p_scheduled_date: tomorrow,
  p_time_slot: '09:00',
  p_name: 'Verification Booking',
  p_email: bookingEmail,
  p_phone: '+63 900 000 0003',
  p_address: 'Paranaque',
  p_notes: 'Two-storey, metal roof.',
})
check('/booking submits', !bookingError, bookingError?.message)

/* ========================================================================== */
console.log(`\n2 · What actually landed (read back as the administrator)\n${LINE}`)

const admin = await signIn('admin@demo.solarbros.ph')

const { data: enquiryLead } = await admin
  .from('leads')
  .select('id, source, stage, score, monthly_bill, qualification_notes')
  .eq('email', enquiryEmail)
  .maybeSingle()

check('the enquiry created a lead', !!enquiryLead)
if (enquiryLead) {
  check('tagged as a quote request', enquiryLead.source === 'quote_request', enquiryLead.source)
  check('starts at the top of the pipeline', enquiryLead.stage === 'new', enquiryLead.stage)
  // Scoring is a trigger (migration 0008). If it lived in the browser, a
  // submission that skipped the UI would arrive unscored.
  check('the scoring trigger ran server-side', enquiryLead.score > 0, `score=${enquiryLead.score}`)
  check('the message was kept', !!enquiryLead.qualification_notes)
}

const { data: estimateLead } = await admin
  .from('leads')
  .select('id, source, estimated_kw, monthly_bill')
  .eq('email', estimateEmail)
  .maybeSingle()

check('the estimator created a lead', !!estimateLead)
if (estimateLead) {
  check('tagged as an estimator lead', estimateLead.source === 'estimator', estimateLead.source)
  check('the system size came across', Number(estimateLead.estimated_kw) === 6.2)

  const { data: estimate } = await admin
    .from('estimates')
    .select('appliances, system_type, monthly_kwh, payback_years, region_id')
    .eq('lead_id', estimateLead.id)
    .maybeSingle()

  check('the appliance profile was stored alongside it', !!estimate)
  if (estimate) {
    check('all three appliances survived', estimate.appliances?.length === 3)
    check(
      'a custom appliance kept its wattage',
      estimate.appliances?.[2]?.custom?.watts === 750,
      'custom detail lost in the JSON round trip',
    )
    check('the system type was cast to the enum', estimate.system_type === 'hybrid')
    check('the computed figures were snapshotted', Number(estimate.payback_years) === 5.9)
  }
}

const { data: bookingLead } = await admin
  .from('leads')
  .select('id')
  .eq('email', bookingEmail)
  .maybeSingle()

check('the booking also created a lead for sales', !!bookingLead)
if (bookingLead) {
  const { data: appt } = await admin
    .from('appointments')
    .select('id, status, appointment_type, scheduled_date, notes')
    .eq('lead_id', bookingLead.id)
    .maybeSingle()

  check('the appointment was created', !!appt)
  if (appt) {
    check('it lands unassigned, awaiting dispatch', appt.status === 'requested', appt.status)
    check('with the type the visitor chose', appt.appointment_type === 'site_survey')
    check('on the date the visitor chose', appt.scheduled_date === tomorrow)
  }
}

/* ========================================================================== */
console.log(`\n3 · Rubbish is refused by the database, not the browser\n${LINE}`)

const bad = [
  [
    'an empty name',
    () => visitor.rpc('submit_enquiry', { p_name: '   ', p_email: mail('x1') }),
    'your name',
  ],
  [
    'a malformed email',
    () => visitor.rpc('submit_enquiry', { p_name: 'Nope', p_email: 'not-an-email' }),
    'does not look right',
  ],
  [
    'a 4 MB name',
    () => visitor.rpc('submit_enquiry', { p_name: 'x'.repeat(4_000_000), p_email: mail('x2') }),
    'too long',
  ],
  [
    'a booking inside the notice period',
    () =>
      visitor.rpc('request_booking', {
        p_appointment_type: 'site_survey',
        // An hour from now: the crew cannot be scheduled and the customer
        // should be told so rather than promised a visit.
        p_scheduled_date: new Date(Date.now() + 3_600_000).toISOString().slice(0, 10),
        p_time_slot: '00:30',
        p_name: 'Too Soon',
        p_email: mail('x2b'),
        p_phone: '+63 900 000 0000',
      }),
    'hours notice',
  ],
  [
    'a booking in the past',
    () =>
      visitor.rpc('request_booking', {
        p_appointment_type: 'site_survey',
        p_scheduled_date: '2020-01-01',
        p_time_slot: '09:00',
        p_name: 'Time Traveller',
        p_email: mail('x3'),
        p_phone: '+63 900 000 0000',
      }),
    'already passed',
  ],
  [
    'a booking in the year 3000',
    () =>
      visitor.rpc('request_booking', {
        p_appointment_type: 'site_survey',
        p_scheduled_date: '3000-01-01',
        p_time_slot: '09:00',
        p_name: 'Optimist',
        p_email: mail('x4'),
        p_phone: '+63 900 000 0000',
      }),
    'six months',
  ],
  [
    'booking an installation from the public site',
    () =>
      visitor.rpc('request_booking', {
        p_appointment_type: 'installation',
        p_scheduled_date: tomorrow,
        p_time_slot: '09:00',
        p_name: 'Queue Jumper',
        p_email: mail('x5'),
        p_phone: '+63 900 000 0000',
      }),
    'cannot be booked',
  ],
  [
    'a garbled time slot',
    () =>
      visitor.rpc('request_booking', {
        p_appointment_type: 'site_survey',
        p_scheduled_date: tomorrow,
        p_time_slot: 'whenever',
        p_name: 'Vague',
        p_email: mail('x6'),
        p_phone: '+63 900 000 0000',
      }),
    'time slot',
  ],
  [
    'an estimate with no appliance list',
    () =>
      visitor.rpc('submit_estimate', {
        p_name: 'Empty',
        p_email: mail('x7'),
        p_phone: '',
        p_address: '',
        p_appliances: 'not an array',
        p_estimate: {},
      }),
    null,
  ],
]

for (const [label, run, expect] of bad) {
  const { error } = await run()
  checkRejected(label, error, expect)
}

/* ========================================================================== */
console.log(`\n4 · The throttle\n${LINE}`)

const floodEmail = mail('flood')
let accepted = 0
let throttled = false
for (let i = 0; i < 8; i++) {
  const { error } = await visitor.rpc('submit_enquiry', {
    p_name: `Flood ${i}`,
    p_email: floodEmail,
  })
  if (error) {
    throttled = true
    break
  }
  accepted++
}
check(
  'repeated submissions from one address are cut off',
  throttled,
  `${accepted} accepted without a limit being hit`,
)
check('but a genuine first submission is not', accepted >= 1, `${accepted} accepted`)

/* ========================================================================== */
console.log(`\n5 · The direct write path is closed\n${LINE}`)

const direct = [
  ['leads', { name: 'Direct', email: mail('direct'), source: 'walk_in' }],
  ['estimates', { region_id: 'ncr', usage_pattern: 'balanced' }],
  [
    'appointments',
    {
      appointment_type: 'installation',
      status: 'confirmed',
      scheduled_date: tomorrow,
      time_slot: '09:00',
      contact_name: 'Direct',
    },
  ],
]

for (const [table, row] of direct) {
  const { error } = await visitor.from(table).insert(row)
  checkRejected(`anon cannot INSERT into ${table} directly`, error)
}

/* A lead created through the RPC still must not be readable, or the enquiry
   form becomes a customer-list download: submit anything, then read the table. */
for (const table of ['leads', 'estimates', 'appointments']) {
  const { data } = await visitor.from(table).select('*').limit(5)
  check(
    `anon cannot read ${table}`,
    (data?.length ?? 0) === 0,
    `READ BACK ${data?.length} ROWS — customer data is exposed`,
  )
}

/* Setting a field the form has no business setting. `stage` and `score` are not
   parameters of any function, so there is no route to them at all. */
if (enquiryLead) {
  const { data: updated } = await visitor
    .from('leads')
    .update({ stage: 'won' })
    .eq('id', enquiryLead.id)
    .select('id')
  check('anon cannot move a lead through the pipeline', (updated?.length ?? 0) === 0)

  const { data: deleted } = await visitor
    .from('leads')
    .delete()
    .eq('id', enquiryLead.id)
    .select('id')
  check('anon cannot delete a lead', (deleted?.length ?? 0) === 0)
}

/* ========================================================================== */
console.log(`\n6 · The paths that shared the dropped policies\n${LINE}`)

const sales = await signIn('sales@demo.solarbros.ph')
const walkInEmail = mail('walkin')
const { error: walkInError } = await sales.from('leads').insert({
  name: 'Verification Walk-in',
  email: walkInEmail,
  source: 'walk_in',
})
check('sales can still add a lead by hand', !walkInError, walkInError?.message)

const { error: salesEstimateError } = await sales.from('estimates').insert({
  contact_email: walkInEmail,
  region_id: 'ncr',
  usage_pattern: 'balanced',
  appliances: [],
})
check(
  'sales can still size a system for a caller',
  !salesEstimateError,
  salesEstimateError?.message,
)

const client = await signIn('client@demo.solarbros.ph')
const {
  data: { user: clientUser },
} = await client.auth.getUser()

const { error: clientBookError } = await client.from('appointments').insert({
  appointment_type: 'maintenance',
  status: 'requested',
  scheduled_date: tomorrow,
  time_slot: '14:00',
  client_id: clientUser.id,
  contact_name: 'Verification Client Booking',
})
check('a client can still book from their portal', !clientBookError, clientBookError?.message)

/* The check on client_id is what stops one customer booking a crew in another
   customer's name. Worth proving rather than assuming. */
const { error: impersonateError } = await client.from('appointments').insert({
  appointment_type: 'maintenance',
  status: 'requested',
  scheduled_date: tomorrow,
  time_slot: '15:00',
  client_id: '00000000-0000-0000-0000-000000000001',
  contact_name: 'Someone Else',
})
checkRejected('a client cannot book in another customer’s name', impersonateError)

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

/* Appointments first: their lead_id is ON DELETE SET NULL, so removing the lead
   would orphan them rather than take them with it. Estimates cascade. */
const { data: strayAppts } = await admin
  .from('appointments')
  .select('id')
  .in('contact_name', [
    'Verification Booking',
    'Verification Client Booking',
    'Someone Else',
    'Direct',
  ])

for (const row of strayAppts ?? []) {
  await admin.from('appointments').delete().eq('id', row.id)
}

const { data: strayLeads } = await admin
  .from('leads')
  .select('id, email')
  .like('email', '%@example.test')

for (const row of strayLeads ?? []) {
  await admin.from('leads').delete().eq('id', row.id)
}

console.log(
  `  Removed ${strayLeads?.length ?? 0} lead(s) and ${strayAppts?.length ?? 0} appointment(s).`,
)
console.log('  Estimates cascade with their lead; none are left behind.')

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
