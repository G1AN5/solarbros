import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/app/auth/useAuth'
import { throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'

/* ============================================================================
   TICKET CONVERSATION
   ----------------------------------------------------------------------------
   One module for both sides of the desk, deliberately. The customer's support
   page and the staff queue are reading and writing the SAME rows, and the last
   time those two views were built separately the customer's ticket did not
   appear in the office at all.

   Visibility is decided in the database, not here. `ticket_thread` is
   SECURITY DEFINER and filters internal notes out for a customer, so this file
   can render whatever it is given without a client-side rule that could be
   edited away in devtools.

   Author names come back from the RPC because RLS grants rows and not columns:
   `profiles` cannot be joined by a customer without also handing out every
   staff email address and mobile number.
   ========================================================================== */

export const ticketKeys = {
  thread: (ticketId: string) => ['tickets', 'thread', ticketId] as const,
}

export interface TicketMessage {
  id: string
  body: string
  isInternal: boolean
  createdAt: string
  authorName: string
  authorIsStaff: boolean
}

export function useTicketThread(ticketId: string | undefined) {
  return useQuery({
    queryKey: ticketKeys.thread(ticketId ?? 'none'),
    enabled: Boolean(ticketId),
    // A support thread is a live conversation; a stale one reads as being
    // ignored by the other side.
    staleTime: 5_000,
    queryFn: async (): Promise<TicketMessage[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!ticketId) return []

      const { data, error } = await supabase.rpc('ticket_thread', { p_ticket_id: ticketId })
      if (error) throwReadable(error)

      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        body: String(row.body ?? ''),
        isInternal: Boolean(row.is_internal),
        createdAt: String(row.created_at),
        authorName: String(row.author_name ?? 'SolarBros'),
        authorIsStaff: Boolean(row.author_is_staff),
      }))
    },
  })
}

/**
 * Post a reply.
 *
 * `author_id` is sent because the insert policy requires it to equal
 * `auth.uid()` — it is a signature, not a choice, and a forged one is refused
 * by the database rather than trusted.
 *
 * `isInternal` is only honoured for staff; migration 0039 refuses it from a
 * customer outright rather than quietly clearing it, because a control that
 * appears to work and does not is worse than one that errors.
 */
export function usePostTicketMessage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { ticketId: string; body: string; isInternal?: boolean }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!user) throw new Error('Please sign in again.')

      const body = input.body.trim()
      if (!body) throw new Error('Type a message first.')

      const { data, error } = await supabase
        .from('ticket_messages')
        .insert({
          ticket_id: input.ticketId,
          author_id: user.id,
          body,
          is_internal: input.isInternal ?? false,
        })
        .select('id')
        .single()

      if (error) throwReadable(error)
      return data
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ticketKeys.thread(variables.ticketId) })
      /* A reply bumps the ticket's `updated_at` in a trigger, so both queues
         are now showing a stale "Last update". Invalidate both: this is the
         interconnection the whole application is judged on, and it is exactly
         what was missing when a customer's ticket never reached the office. */
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/* ============================================================================
   ATTACHMENTS
   ----------------------------------------------------------------------------
   A photo of the inverter's error screen is usually enough to diagnose a fault
   without sending a van, which is why the ticket form asks for one. Uploading
   it and then not showing it anywhere would have been the same defect in a new
   place: the work happens, and nobody can see that it did.

   `documents_read` scopes these already — staff see all, the customer sees
   their own client-visible rows — so both sides use the same query.
   ========================================================================== */

export interface TicketAttachment {
  id: string
  name: string
  storagePath: string | null
  uploadedAt: string
}

export function useTicketAttachments(ticketId: string | undefined) {
  return useQuery({
    queryKey: ['tickets', 'attachments', ticketId ?? 'none'],
    enabled: Boolean(ticketId),
    queryFn: async (): Promise<TicketAttachment[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!ticketId) return []

      const { data, error } = await supabase
        .from('documents')
        .select('id, name, storage_path, uploaded_at')
        .eq('ticket_id', ticketId)
        .order('uploaded_at', { ascending: true })

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        storagePath: row.storage_path,
        uploadedAt: row.uploaded_at,
      }))
    },
  })
}
