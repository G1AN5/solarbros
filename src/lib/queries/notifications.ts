import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   THE NOTIFICATION OUTBOX
   ----------------------------------------------------------------------------
   Admin-facing view of every message the system has queued, and the button that
   dispatches them.

   WHY AN OUTBOX EXISTS AT ALL
   Outbound messaging is the part of a system that fails silently. Nobody
   notices that appointment confirmations stopped going out until a customer
   turns up on the wrong day — and by then the evidence is a provider dashboard
   somebody has to remember the password for.

   This is deliberately readable by a person: what was queued, what was sent,
   what failed and why, and what it would have said. It also means the whole
   flow is demonstrable with simulation on and no provider account at all.
   ========================================================================== */

export const outboxKeys = {
  all: (status?: string) => ['admin', 'outbox', status ?? 'all'] as const,
}

export interface OutboxMessage {
  id: string
  title: string
  body: string
  channel: 'in_app' | 'email' | 'sms'
  category: string
  toEmail: string | null
  toPhone: string | null
  recipientName: string | null
  deliveryStatus: 'queued' | 'sent' | 'failed' | 'skipped'
  deliveryError: string | null
  attempts: number
  providerMessageId: string | null
  sentAt: string | null
  createdAt: string
}

export function useOutbox(status?: 'queued' | 'sent' | 'failed' | 'skipped') {
  return useQuery({
    queryKey: outboxKeys.all(status),
    queryFn: async (): Promise<OutboxMessage[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      let query = supabase
        .from('notifications')
        .select(
          'id, title, body, channel, category, to_email, to_phone, delivery_status, delivery_error, attempts, provider_message_id, sent_at, created_at, recipient:profiles(full_name)',
        )
        .order('created_at', { ascending: false })
        .limit(100)

      if (status) query = query.eq('delivery_status', status)

      const { data, error } = await query
      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        channel: row.channel,
        category: row.category,
        toEmail: row.to_email,
        toPhone: row.to_phone,
        recipientName: row.recipient?.full_name ?? null,
        deliveryStatus: row.delivery_status,
        deliveryError: row.delivery_error,
        attempts: row.attempts,
        providerMessageId: row.provider_message_id,
        sentAt: row.sent_at,
        createdAt: row.created_at,
      }))
    },
  })
}

/**
 * Run the dispatcher now.
 *
 * Normally scheduled; this is here because "did that go out?" during a
 * demonstration, or after fixing a wrong phone number, should not mean waiting
 * for the next cron tick. The Edge Function checks that the caller is an
 * administrator — it can spend money.
 */
export function useDispatchNotifications() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<{
      claimed: number
      sent: number
      failed: number
      skipped: number
      requeued: number
      simulated: boolean
    }> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase.functions.invoke('notifications-dispatch', {
        body: {},
      })

      if (error) {
        let detail = 'The dispatcher could not be started.'
        const res = (error as { context?: Response }).context
        if (res && typeof res.json === 'function') {
          try {
            const parsed = await res.json()
            if (parsed?.error) detail = parsed.error
          } catch {
            /* keep the friendly default */
          }
        }
        throw new Error(detail)
      }

      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'outbox'] })
    },
  })
}
