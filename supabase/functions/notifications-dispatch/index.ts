/* ============================================================================
   EDGE FUNCTION · notifications-dispatch
   ----------------------------------------------------------------------------
   Sends the queued email and SMS. Runs on a schedule, and can be triggered by
   an administrator from the outbox screen.

   IT DOES NOT DECIDE WHAT TO SEND
   Notifications are queued by database triggers when something actually happens
   — a milestone completed, a crew assigned, an invoice raised. This function
   only moves them out of the queue. That split matters: the decision to notify
   belongs in the same transaction as the event that caused it, or a customer
   gets told about work that was rolled back.

   EXACTLY ONCE IS THE WHOLE PROBLEM
   Claiming happens in the database via `claim_notifications`, which uses
   FOR UPDATE SKIP LOCKED and flips the status in the same transaction that
   selects the rows. Two overlapping runs therefore pick up different messages
   rather than the same ones twice. Doing it here — read, then send, then mark —
   would let a cron run that overlapped a manual retry text every customer twice.

   SIMULATION IS THE DEFAULT
   With `notifications.simulate_delivery` on, messages are marked sent and
   appear in the outbox with nothing actually leaving the building. The entire
   flow is demonstrable end to end with no provider account, which is what the
   outbox was designed for in migration 0001. Turning it off is a deliberate
   act by an administrator once credentials exist.

   DEPLOY WITH
       npx supabase functions deploy notifications-dispatch

   SECRETS (only needed once simulation is switched off)
       RESEND_API_KEY        email
       RESEND_FROM           e.g. "SolarBros <noreply@solarbros.ph>"
       SEMAPHORE_API_KEY     SMS, Philippine numbers
       SEMAPHORE_SENDER_NAME registered sender ID
   ========================================================================== */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

interface SendResult {
  ok: boolean
  providerMessageId?: string
  error?: string
}

/* ============================================================================
   EMAIL · Resend
   ========================================================================== */

async function sendEmail(to: string, subject: string, body: string): Promise<SendResult> {
  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM') ?? 'SolarBros <onboarding@resend.dev>'
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set' }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      // Plain text, deliberately. A customer notification is three sentences and
      // a link; an HTML template would be more to maintain, more to get wrong on
      // a phone, and more likely to be filtered as marketing.
      text: body,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    return { ok: false, error: payload?.message ?? `Resend returned ${response.status}` }
  }
  return { ok: true, providerMessageId: payload?.id }
}

/* ============================================================================
   SMS · Semaphore
   ----------------------------------------------------------------------------
   A Philippine gateway, which matters: international providers charge several
   times as much per message to PH networks, and some cannot deliver to all of
   them at all.
   ========================================================================== */

/** Normalise to the 639XXXXXXXXX form Semaphore expects. */
function toPhilippineNumber(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.startsWith('63') && digits.length === 12) return digits
  if (digits.startsWith('09') && digits.length === 11) return `63${digits.slice(1)}`
  if (digits.startsWith('9') && digits.length === 10) return `63${digits}`
  return null
}

async function sendSms(to: string, body: string): Promise<SendResult> {
  const key = Deno.env.get('SEMAPHORE_API_KEY')
  if (!key) return { ok: false, error: 'SEMAPHORE_API_KEY is not set' }

  const number = toPhilippineNumber(to)
  if (!number) {
    // Permanent, not transient. Retrying a malformed number just spends the
    // retry budget; the settle function will fail it once attempts run out.
    return { ok: false, error: `"${to}" is not a usable Philippine mobile number` }
  }

  const form = new URLSearchParams({
    apikey: key,
    number,
    // 160 characters is one SMS segment. Longer messages are billed per
    // segment, so a truncated message is a deliberate cost decision rather
    // than an oversight — the full detail is in the portal and the email.
    message: body.slice(0, 320),
  })
  const sender = Deno.env.get('SEMAPHORE_SENDER_NAME')
  if (sender) form.set('sendername', sender)

  const response = await fetch('https://api.semaphore.co/api/v4/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    return { ok: false, error: `Semaphore returned ${response.status}` }
  }
  const first = Array.isArray(payload) ? payload[0] : payload
  return { ok: true, providerMessageId: first?.message_id?.toString() }
}

/* ========================================================================== */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  /* An administrator may trigger a run from the outbox. A scheduled run has no
     user, and presents the service role key instead. Anything else is refused —
     this function can spend money. */
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  const isServiceRole = token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!isServiceRole) {
    const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
    } = await asCaller.auth.getUser()
    if (!user) return json({ error: 'Please sign in first.' }, 401)

    const { data: profile } = await admin
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.role !== 'admin' || !profile?.is_active) {
      return json({ error: 'Only an administrator can run the dispatcher.' }, 403)
    }
  }

  try {
    // Pick up anything a previous run claimed and never finished.
    const { data: requeued } = await admin.rpc('requeue_stalled_notifications')

    const { data: settings } = await admin
      .from('settings')
      .select('key, value')
      .in('key', [
        'notifications.simulate_delivery',
        'notifications.email_enabled',
        'notifications.sms_enabled',
      ])

    const setting = (key: string, fallback: boolean) => {
      const found = settings?.find((s) => s.key === key)
      return found === undefined ? fallback : found.value !== false
    }

    const simulate = setting('notifications.simulate_delivery', true)
    const emailEnabled = setting('notifications.email_enabled', true)
    const smsEnabled = setting('notifications.sms_enabled', true)

    const worker = `run-${new Date().toISOString()}`
    const { data: batch, error: claimError } = await admin.rpc('claim_notifications', {
      p_worker: worker,
      p_limit: null,
    })

    if (claimError) return json({ error: claimError.message }, 500)

    const summary = { claimed: batch?.length ?? 0, sent: 0, failed: 0, skipped: 0, requeued }

    for (const message of batch ?? []) {
      const channelEnabled = message.channel === 'email' ? emailEnabled : smsEnabled

      if (!channelEnabled) {
        // Not a failure. The company turned this channel off, and retrying it
        // every run would burn the attempt budget for no reason.
        await admin.rpc('settle_notification', {
          p_id: message.id,
          p_status: 'skipped',
          p_error: `${message.channel} is switched off in Settings.`,
        })
        summary.skipped++
        continue
      }

      const destination = message.channel === 'email' ? message.to_email : message.to_phone

      if (!destination) {
        await admin.rpc('settle_notification', {
          p_id: message.id,
          p_status: 'failed',
          p_error: `No ${message.channel === 'email' ? 'email address' : 'mobile number'} on file.`,
        })
        summary.failed++
        continue
      }

      let result: SendResult

      if (simulate) {
        // The point of the outbox: everything is recorded exactly as it would be,
        // and nothing leaves the building.
        result = { ok: true, providerMessageId: `simulated-${crypto.randomUUID()}` }
      } else if (message.channel === 'email') {
        result = await sendEmail(destination, message.title, message.body)
      } else {
        result = await sendSms(destination, `${message.title}: ${message.body}`)
      }

      await admin.rpc('settle_notification', {
        p_id: message.id,
        p_status: result.ok ? 'sent' : 'failed',
        p_provider_message_id: result.providerMessageId ?? null,
        p_error: result.ok ? null : (result.error ?? 'Unknown provider error'),
      })

      if (result.ok) summary.sent++
      else summary.failed++
    }

    return json({ ...summary, simulated: simulate })
  } catch (error) {
    console.error('[notifications-dispatch]', error)
    // The claimed batch stays in flight and `requeue_stalled_notifications`
    // picks it up on the next run, so nothing is lost.
    return json({ error: 'The dispatcher run failed. Claimed messages will be retried.' }, 500)
  }
})
