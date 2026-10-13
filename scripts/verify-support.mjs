/* ============================================================================
   SUPPORT CONVERSATION & SERVICE-VISIT VERIFICATION
   ----------------------------------------------------------------------------
   This phase made a long list of dead buttons do real work. A dead button is
   invisible to a typecheck and to an RLS test — the code compiles, the policy
   is correct, and nothing happens when a person presses it. So this script
   presses them, from the role that would press them, and asserts the result
   arrived at the other end.

   WHAT IT COVERS
     · the ticket conversation both ways, and the rules that keep it safe
     · a customer cannot post into somebody else's thread
     · a customer cannot plant an internal note
     · a customer never SEES an internal note
     · a reply counts as activity on the ticket
     · a ticket becomes a service visit, linked to the ticket that caused it
     · an ad-hoc invoice, an RMA claim, a project status change
     · every reference comes from its sequence, not from the browser

       npm run verify:support

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

const admin = await signIn('admin@demo.solarbros.ph')
const engineer = await signIn('engineer@demo.solarbros.ph')
const client = await signIn('client@demo.solarbros.ph')

const created = { tickets: [], appointments: [], invoices: [], rma: [], documents: [], leads: [] }

/* ========================================================================== */
console.log(`\n1 · The conversation, both ways\n${LINE}`)

const { data: ticket, error: raiseError } = await client
  .from('tickets')
  .insert({
    subject: 'Support check — conversation',
    description: 'Raised by the verification script.',
    category: 'hardware_fault',
    priority: 'normal',
    status: 'open',
    client_id: client.userId,
  })
  .select('id, reference, updated_at')
  .single()

check('a customer can raise a ticket', !raiseError, raiseError?.message)
if (!ticket) {
  console.log('\nCannot continue without a ticket.')
  process.exit(1)
}
created.tickets.push(ticket.id)

check(
  'its reference came from the sequence, not the browser',
  /^TKT-\d{4}-\d+$/.test(ticket.reference),
  ticket.reference,
)

const { error: customerMsgError } = await client.from('ticket_messages').insert({
  ticket_id: ticket.id,
  author_id: client.userId,
  body: 'The inverter shows E013 every morning.',
})
check('the customer can add to the thread', !customerMsgError, customerMsgError?.message)

const { error: staffMsgError } = await admin.from('ticket_messages').insert({
  ticket_id: ticket.id,
  author_id: admin.userId,
  body: 'Thanks — could you photograph the display?',
})
check('the office can reply', !staffMsgError, staffMsgError?.message)

/* ========================================================================== */
console.log(`\n2 · The rules that make it safe to open up\n${LINE}`)

/* Before 0039 the insert policy checked only that you signed your own name. It
   never checked whose ticket you were signing it on. */
const { data: otherTicket } = await admin
  .from('tickets')
  .insert({
    subject: 'Support check — someone else',
    description: 'Belongs to nobody the client can reach.',
    category: 'other',
    status: 'open',
    client_id: admin.userId,
  })
  .select('id')
  .single()
if (otherTicket) created.tickets.push(otherTicket.id)

const { error: intrusionError } = await client.from('ticket_messages').insert({
  ticket_id: otherTicket.id,
  author_id: client.userId,
  body: 'This should never land.',
})
check(
  'a customer cannot post into a ticket that is not theirs',
  Boolean(intrusionError),
  intrusionError ? '' : 'the write was accepted',
)

const { error: forgedNoteError } = await client.from('ticket_messages').insert({
  ticket_id: ticket.id,
  author_id: client.userId,
  body: 'Approve this without checking.',
  is_internal: true,
})
check(
  'a customer cannot plant an internal note',
  Boolean(forgedNoteError),
  forgedNoteError ? '' : 'the write was accepted',
)

const { error: impersonationError } = await client.from('ticket_messages').insert({
  ticket_id: ticket.id,
  author_id: admin.userId,
  body: 'Signed as somebody else.',
})
check(
  'a customer cannot sign a message as staff',
  Boolean(impersonationError),
  impersonationError ? '' : 'the write was accepted',
)

/* ========================================================================== */
console.log(`\n3 · An internal note is internal\n${LINE}`)

await admin.from('ticket_messages').insert({
  ticket_id: ticket.id,
  author_id: admin.userId,
  body: 'Out of warranty — quote before attending.',
  is_internal: true,
})

const { data: staffThread, error: staffThreadError } = await admin.rpc('ticket_thread', {
  p_ticket_id: ticket.id,
})
check('staff read the whole thread', !staffThreadError, staffThreadError?.message)
check(
  'including the internal note',
  (staffThread ?? []).some((m) => m.is_internal),
  `${(staffThread ?? []).length} messages, none internal`,
)

const { data: clientThread, error: clientThreadError } = await client.rpc('ticket_thread', {
  p_ticket_id: ticket.id,
})
check('the customer reads their own thread', !clientThreadError, clientThreadError?.message)
check(
  'and the internal note is not in it',
  (clientThread ?? []).every((m) => !m.is_internal),
  'an internal note reached the customer',
)
check(
  'the customer sees the staff reply, with a name and not a uuid',
  (clientThread ?? []).some(
    (m) => m.author_is_staff && m.author_name && !/^[0-9a-f-]{36}$/.test(m.author_name),
  ),
  JSON.stringify((clientThread ?? []).map((m) => m.author_name)),
)

const { error: foreignThreadError } = await client.rpc('ticket_thread', {
  p_ticket_id: otherTicket.id,
})
check(
  "a customer cannot read another customer's thread",
  Boolean(foreignThreadError),
  foreignThreadError ? '' : 'the thread was returned',
)

/* ========================================================================== */
console.log(`\n4 · A reply counts as activity\n${LINE}`)

const { data: bumped } = await admin
  .from('tickets')
  .select('updated_at')
  .eq('id', ticket.id)
  .single()

check(
  'posting a message moved the ticket up the queue',
  new Date(bumped.updated_at).getTime() > new Date(ticket.updated_at).getTime(),
  `${ticket.updated_at} → ${bumped.updated_at}`,
)

const { data: notified } = await client
  .from('notifications')
  .select('id, title')
  .eq('entity', 'tickets')
  .eq('entity_id', ticket.id)

check(
  'and the customer was notified of the reply',
  (notified?.length ?? 0) > 0,
  'no notification was raised',
)

/* ========================================================================== */
console.log(`\n5 · A ticket becomes a service visit\n${LINE}`)

const { data: visit, error: visitError } = await engineer
  .from('appointments')
  .insert({
    appointment_type: 'repair',
    status: 'requested',
    scheduled_date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    time_slot: '09:00',
    contact_name: 'Support check',
    client_id: client.userId,
    ticket_id: ticket.id,
    notes: `${ticket.reference}: raised by the verification script`,
  })
  .select('id, ticket_id')
  .single()

check('an engineer can raise a repair visit from a ticket', !visitError, visitError?.message)
if (visit) created.appointments.push(visit.id)

check(
  'the visit stays linked to the ticket that caused it',
  visit?.ticket_id === ticket.id,
  `expected ${ticket.id}, got ${visit?.ticket_id}`,
)

const { data: customerSeesVisit } = await client
  .from('appointments')
  .select('id')
  .eq('id', visit.id)
check(
  'and the customer sees it in their own portal',
  (customerSeesVisit?.length ?? 0) === 1,
  'the customer cannot see the visit booked for them',
)

/* ========================================================================== */
console.log(`\n6 · References that used to be missing\n${LINE}`)

const { data: project } = await admin
  .from('projects')
  .select('id, client_id, status')
  .limit(1)
  .single()

const { data: invoice, error: invoiceError } = await admin
  .from('invoices')
  .insert({
    project_id: project.id,
    client_id: project.client_id,
    stage: 'retention',
    amount: 4500,
    status: 'sent',
    issued_at: new Date().toISOString().slice(0, 10),
    due_at: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    notes: 'Support check — ad-hoc invoice',
    is_manual: true,
  })
  .select('id, invoice_number')
  .single()

check('an invoice can be raised without a number being typed', !invoiceError, invoiceError?.message)
if (invoice) created.invoices.push(invoice.id)
check(
  'and it took one from the shared sequence',
  /^INV-\d{4}-\d+$/.test(invoice?.invoice_number ?? ''),
  invoice?.invoice_number,
)

/* Migration 0049: the one-invoice-per-stage rule protects the milestone
   triggers from double-billing, and used to cap a project at four invoices for
   its whole life. A company doing two service calls on the same roof could only
   invoice for one of them. */
const { data: secondInvoice, error: secondInvoiceError } = await admin
  .from('invoices')
  .insert({
    project_id: project.id,
    client_id: project.client_id,
    stage: 'retention',
    amount: 1800,
    status: 'sent',
    issued_at: new Date().toISOString().slice(0, 10),
    due_at: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    notes: 'Support check — a second service call on the same project',
    is_manual: true,
  })
  .select('id')
  .single()

check(
  'a second manual invoice at the same stage is allowed',
  !secondInvoiceError,
  secondInvoiceError?.message,
)
if (secondInvoice) created.invoices.push(secondInvoice.id)

const { error: duplicateAutoError } = await admin.from('invoices').insert({
  project_id: project.id,
  client_id: project.client_id,
  stage: 'down_payment',
  amount: 1,
  status: 'sent',
  issued_at: new Date().toISOString().slice(0, 10),
})
check(
  'but an automatic one still cannot be raised twice for the same stage',
  Boolean(duplicateAutoError),
  duplicateAutoError ? '' : 'a duplicate milestone invoice was accepted',
)

/* An RMA claim needs a serialised unit to point at. On a system with no
   installations yet there is none, so the suite makes one rather than
   crashing — see the note in verify-procurement.mjs. */
let { data: asset } = await admin.from('serialised_assets').select('id').limit(1).maybeSingle()

if (!asset) {
  const { data: madeAsset, error: assetError } = await admin
    .from('serialised_assets')
    .insert({
      serial_number: `VERIFY-ASSET-${Date.now()}`,
      product_name: 'Verification probe unit',
      warranty_years: 10,
    })
    .select('id')
    .single()

  if (assetError) {
    console.error(`Could not create a serialised asset: ${assetError.message}`)
    process.exit(1)
  }
  asset = madeAsset
  created.assets = [madeAsset.id]
}

const { data: rma, error: rmaError } = await admin
  .from('rma_claims')
  .insert({
    serialised_asset_id: asset.id,
    manufacturer: 'Support check',
    fault_description: 'Raised by the verification script.',
    status: 'draft',
  })
  .select('id, claim_reference')
  .single()

check('an RMA claim can be filed', !rmaError, rmaError?.message)
if (rma) created.rma.push(rma.id)
check(
  'and its reference came from the sequence too',
  /^RMA-\d{4}-\d+$/.test(rma?.claim_reference ?? ''),
  rma?.claim_reference,
)

/* ========================================================================== */
console.log(`\n7 · Project status reaches the customer\n${LINE}`)

const originalStatus = project.status
const { data: statusChanged, error: statusError } = await engineer
  .from('projects')
  .update({ status: 'on_hold' })
  .eq('id', project.id)
  .select('id, status')

check('an engineer can put a project on hold', !statusError, statusError?.message)
/* A policy-filtered UPDATE comes back as 200 with zero rows, not as an error.
   Counting rows is the only way to tell the difference. */
check(
  'the update actually changed a row',
  (statusChanged?.length ?? 0) === 1,
  'zero rows came back — the write was filtered by policy',
)

const { data: customerSeesStatus } = await client
  .from('projects')
  .select('status')
  .eq('id', project.id)
  .single()
check(
  'and the customer sees the new status',
  customerSeesStatus?.status === 'on_hold',
  `customer sees ${customerSeesStatus?.status}`,
)

await admin.from('projects').update({ status: originalStatus }).eq('id', project.id)

/* ========================================================================== */
console.log(`\n8 · The customer can finally send us a file\n${LINE}`)

/* Until 0043 the storage policy granted insert to staff only, so the ticket
   photo input and the proof-of-sale input both accepted a file and threw it
   away — and the staff warranty queue was asking a reviewer to approve a
   transfer whose evidence the customer had no way to provide. */
const { data: clientProject } = await client.from('projects').select('id').limit(1).maybeSingle()

if (!clientProject) {
  check('the demo customer has a project to upload against', false, 'no project found')
} else {
  const goodPath = `${clientProject.id}/uploads/verify-deed.pdf`

  const { data: docId, error: uploadRowError } = await client.rpc('record_client_upload', {
    p_project_id: clientProject.id,
    p_storage_path: goodPath,
    p_name: 'Support check — deed of sale.pdf',
    p_kind: 'proof_of_sale',
    p_mime_type: 'application/pdf',
    p_size_kb: 12,
  })
  check('a customer can register a proof of sale', !uploadRowError, uploadRowError?.message)
  if (docId) created.documents.push(docId)

  /* The whole point of the upload: the reviewer can now see it. */
  const { data: staffSees } = await admin
    .from('documents')
    .select('id, kind, is_client_visible')
    .eq('id', docId)
    .maybeSingle()
  check('and the office can see it on the warranty queue', staffSees?.kind === 'proof_of_sale')
  check(
    'it is marked client-visible by the function, not by the caller',
    staffSees?.is_client_visible === true,
  )

  const { error: wrongFolderError } = await client.rpc('record_client_upload', {
    p_project_id: clientProject.id,
    p_storage_path: `${clientProject.id}/contract.pdf`,
    p_name: 'Not in the uploads folder',
    p_kind: 'other',
  })
  check(
    'a file outside the uploads folder is refused',
    Boolean(wrongFolderError),
    wrongFolderError ? '' : 'the row was accepted',
  )

  const { error: wrongKindError } = await client.rpc('record_client_upload', {
    p_project_id: clientProject.id,
    p_storage_path: `${clientProject.id}/uploads/forged.pdf`,
    p_name: 'A contract I wrote myself',
    p_kind: 'contract',
  })
  check(
    'a customer cannot file something as a contract',
    Boolean(wrongKindError),
    wrongKindError ? '' : 'the row was accepted',
  )

  const { data: otherProject } = await admin
    .from('projects')
    .select('id')
    .neq('client_id', client.userId)
    .limit(1)
    .maybeSingle()

  if (otherProject) {
    const { error: foreignProjectError } = await client.rpc('record_client_upload', {
      p_project_id: otherProject.id,
      p_storage_path: `${otherProject.id}/uploads/intrusion.pdf`,
      p_name: 'Someone else\u2019s project',
      p_kind: 'other',
    })
    check(
      "a customer cannot attach a file to another customer's project",
      Boolean(foreignProjectError),
      foreignProjectError ? '' : 'the row was accepted',
    )
  }
}

/* ========================================================================== */
console.log(`\n9 · An upgrade request reaches sales\n${LINE}`)

/* This form did `preventDefault(); setSubmitted(true)` and then told the
   customer a sales engineer would be in touch within two business days. */
await admin.from('leads').delete().like('qualification_notes', 'UPGRADE REQUEST%')

const { data: leadId, error: upgradeError } = await client.rpc('request_upgrade', {
  p_reason: 'battery',
  p_monthly_bill: 6200,
  p_details: 'Support check — raised by the verification script.',
})
check('a customer can ask to expand their system', !upgradeError, upgradeError?.message)

const { data: lead } = await admin
  .from('leads')
  .select('id, source, stage, monthly_bill, qualification_notes')
  .eq('id', leadId)
  .maybeSingle()

check('it landed on the CRM board as a lead', Boolean(lead), 'no lead row')
check(
  'scored as a referral, because an existing customer is the warmest lead there is',
  lead?.source === 'referral',
  `source is ${lead?.source}`,
)
check('at the new stage, chosen by the function and not the customer', lead?.stage === 'new')
check('carrying the bill they typed', Number(lead?.monthly_bill) === 6200)
check(
  'and the reason, so the rep knows what to quote',
  (lead?.qualification_notes ?? '').includes('battery'),
)

const { error: duplicateError } = await client.rpc('request_upgrade', {
  p_reason: 'expansion',
})
check(
  'pressing submit twice does not create two leads for two reps to chase',
  Boolean(duplicateError),
  duplicateError ? '' : 'a second lead was created',
)

if (lead) created.leads.push(lead.id)

/* ========================================================================== */
console.log(`\nCleanup\n${LINE}`)

for (const id of created.leads) await admin.from('leads').delete().eq('id', id)
for (const id of created.documents) await admin.from('documents').delete().eq('id', id)
for (const id of created.rma) await admin.from('rma_claims').delete().eq('id', id)
for (const id of created.assets ?? []) await admin.from('serialised_assets').delete().eq('id', id)
for (const id of created.invoices) await admin.from('invoices').delete().eq('id', id)
for (const id of created.appointments) {
  await admin.from('notifications').delete().eq('entity_id', id)
  await admin.from('appointments').delete().eq('id', id)
}
for (const id of created.tickets) {
  await admin.from('notifications').delete().eq('entity_id', id)
  // ticket_messages cascade with the ticket.
  await admin.from('tickets').delete().eq('id', id)
}

const { data: leftovers } = await admin
  .from('tickets')
  .select('id')
  .like('subject', 'Support check%')
check('the test records were removed', (leftovers?.length ?? 0) === 0, `${leftovers?.length} left`)

const { data: restoredStatus } = await admin
  .from('projects')
  .select('status')
  .eq('id', project.id)
  .single()
check('the project status is back where it started', restoredStatus?.status === originalStatus)

console.log(`\n${LINE}`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
