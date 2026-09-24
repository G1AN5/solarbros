import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  toAppointment,
  toAsset,
  toDocument,
  toInvoice,
  toNotification,
  toProject,
  toTicket,
} from './mappers'
import { useAuth } from '@/app/auth/useAuth'
import { throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { TicketCategory, TicketPriority } from '@/types/domain'

/* ============================================================================
   CLIENT PORTAL DATA
   ----------------------------------------------------------------------------
   Every query the customer-facing portal makes, in one file.

   THE SECURITY MODEL THESE HOOKS RELY ON
   None of these queries filters by client id, and that is deliberate. Row Level
   Security already restricts every table to the signed-in customer's own rows,
   so `select * from invoices` returns exactly their invoices and nothing else.

   Adding `.eq('client_id', user.id)` on top would be redundant, and worse, it
   would imply the filtering is the security boundary. It is not — the database
   is. If a policy were ever wrong, an extra client-side filter would hide the
   bug rather than expose it, which is the opposite of what you want.

   DEMO MODE
   With no Supabase credentials the same hooks return the fixtures from
   src/mocks/. That keeps `npm run dev` working for an unconfigured clone and
   keeps a single rendering path: components never know which mode they are in.

   STALENESS
   Defaults come from App.tsx (30s). Anything a technician might change while a
   customer is watching — milestones especially — gets a shorter window, because
   the whole promise of the portal is that it is current.
   ========================================================================== */

/** Query keys, centralised so invalidation cannot typo its way into silence. */
export const clientKeys = {
  project: (userId?: string) => ['client', 'project', userId] as const,
  invoices: (userId?: string) => ['client', 'invoices', userId] as const,
  appointments: (userId?: string) => ['client', 'appointments', userId] as const,
  documents: (userId?: string) => ['client', 'documents', userId] as const,
  tickets: (userId?: string) => ['client', 'tickets', userId] as const,
  assets: (userId?: string) => ['client', 'assets', userId] as const,
  notifications: (userId?: string) => ['client', 'notifications', userId] as const,
}

/* ============================================================================
   THE PROJECT
   ----------------------------------------------------------------------------
   A customer has one active installation in the common case. The query fetches
   the project and its milestones together, because rendering a tracker with the
   project loaded but the milestones still pending would flash an empty timeline.
   ========================================================================== */

export function useMyProject() {
  const { user } = useAuth()

  return useQuery({
    queryKey: clientKeys.project(user?.id),
    enabled: Boolean(user),
    // Milestones move while a customer watches the page. Keep this fresh.
    staleTime: 10_000,
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('projects')
        .select('*, project_milestones(*)')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error) throwReadable(error)
      if (!data) return null

      const project = toProject(data, data.project_milestones ?? [])
      // The project row stores an id, not a name; the customer knows who they
      // are, so their own profile name is the right label.
      project.clientName = user?.fullName ?? ''

      /* The engineer's NAME comes from an RPC, not a join.
         `profiles_read_self` limits a customer to their own profile row, so
         joining returns nothing — which is why this field used to render the
         raw uuid. Widening the policy would work and would also hand the
         customer every engineer's email and mobile number, because RLS grants
         rows and not columns. `project_contact` returns the name and nothing
         else. */
      const { data: contact } = await supabase.rpc('project_contact', {
        p_project_id: data.id,
      })
      const engineerName = (contact as { engineer_name?: string } | null)?.engineer_name
      project.assignedEngineer = engineerName ?? 'To be assigned'

      return project
    },
  })
}

/* ============================================================================
   MONEY
   ========================================================================== */

export function useMyInvoices() {
  const { user } = useAuth()

  return useQuery({
    queryKey: clientKeys.invoices(user?.id),
    enabled: Boolean(user),
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .order('issued_at', { ascending: false })

      if (error) throwReadable(error)
      return (data ?? []).map((row) => toInvoice(row, user?.fullName ?? ''))
    },
  })
}

/* ============================================================================
   SCHEDULING
   ========================================================================== */

export function useMyAppointments() {
  const { user } = useAuth()

  return useQuery({
    queryKey: clientKeys.appointments(user?.id),
    enabled: Boolean(user),
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('appointments')
        // The FK must be named explicitly: appointment_assignees points at
        // profiles twice (user_id and assigned_by), so a bare `profiles(...)`
        // embed is ambiguous and PostgREST refuses it.
        .select(
          '*, appointment_assignees(user_id, profiles!appointment_assignees_user_id_fkey(full_name))',
        )
        .order('scheduled_date', { ascending: false })

      if (error) throwReadable(error)

      return (data ?? []).map((row) => {
        const crew = (row.appointment_assignees ?? [])
          .map((a) => a.profiles?.full_name)
          .filter((n): n is string => Boolean(n))
        return toAppointment(row, crew)
      })
    },
  })
}

/** Books a visit from the client portal. Lands on the admin dispatch board. */
export function useRequestAppointment() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      type: 'maintenance' | 'repair' | 'site_survey' | 'virtual_consultation'
      date: string
      timeSlot: string
      projectId?: string
      address?: string
      notes?: string
    }) => {
      if (!supabase) return

      const { error } = await supabase.from('appointments').insert({
        appointment_type: input.type,
        status: 'requested',
        scheduled_date: input.date,
        time_slot: input.timeSlot,
        client_id: user?.id ?? null,
        project_id: input.projectId ?? null,
        contact_name: user?.fullName ?? 'Client',
        address: input.address ?? null,
        notes: input.notes ?? null,
      })
      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientKeys.appointments(user?.id) })
      /* The same row IS the dispatch board's unassigned queue. Without this the
         customer sees their request and the coordinator does not, until
         somebody happens to reload - the identical failure the support ticket
         had. */
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}

/* ============================================================================
   DOCUMENTS & WARRANTY
   ========================================================================== */

export function useMyDocuments() {
  const { user } = useAuth()

  return useQuery({
    queryKey: clientKeys.documents(user?.id),
    enabled: Boolean(user),
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('uploaded_at', { ascending: false })

      if (error) throwReadable(error)
      return (data ?? []).map(toDocument)
    },
  })
}

export function useMyAssets() {
  const { user } = useAuth()

  return useQuery({
    queryKey: clientKeys.assets(user?.id),
    enabled: Boolean(user),
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('serialised_assets')
        .select('*')
        .order('installed_at', { ascending: false })

      if (error) throwReadable(error)
      return (data ?? []).map(toAsset)
    },
  })
}

/* ============================================================================
   SUPPORT
   ========================================================================== */

export function useMyTickets() {
  const { user } = useAuth()

  return useQuery({
    queryKey: clientKeys.tickets(user?.id),
    enabled: Boolean(user),
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throwReadable(error)

      /* `profiles_read_self` means a customer cannot join the assignee, so the
         mapper fell through to the raw uuid and the customer's own ticket read
         "Assigned to 11111111-0000-4000-8000-000000000003".

         `staff_display_names` resolves ids to names for STAFF ONLY — a
         customer id returns nothing, so this cannot be used to enumerate other
         customers. Names only; emails and phone numbers stay private. */
      const assigneeIds = [...new Set((data ?? []).map((row) => row.assigned_to).filter(Boolean))]

      let names: Record<string, string> = {}
      if (assigneeIds.length > 0) {
        const { data: resolved } = await supabase.rpc('staff_display_names', {
          p_ids: assigneeIds as string[],
        })
        names = (resolved as Record<string, string> | null) ?? {}
      }

      return (data ?? []).map((row) => ({
        ...toTicket(row, user?.fullName ?? ''),
        assignedTo: row.assigned_to
          ? (names[row.assigned_to] ?? 'A SolarBros engineer')
          : undefined,
      }))
    },
  })
}

/**
 * Raise a support ticket.
 *
 * The reference is NOT generated here. It used to be
 * `TKT-${year}-${Math.random()...}`, and `tickets.reference` is unique — the
 * seeded tickets sit inside that same random range, so a customer could be
 * refused by a collision on the screen they use when something is already
 * broken. Migration 0034 made it a sequence default, like every other reference
 * in the schema.
 *
 * `client_id` is sent because the RLS policy checks it: `tickets_insert_client`
 * requires `client_id = auth.uid()` for a customer. Omitting it means the row
 * is silently refused.
 */
export function useRaiseTicket() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      subject: string
      description: string
      priority: TicketPriority
      category: TicketCategory
      projectId?: string
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!user) throw new Error('Please sign in again.')

      const { data, error } = await supabase
        .from('tickets')
        .insert({
          subject: input.subject.trim(),
          description: input.description.trim(),
          priority: input.priority,
          category: input.category,
          status: 'open',
          client_id: user.id,
          project_id: input.projectId ?? null,
        })
        .select('id, reference')
        .single()

      if (error) throwReadable(error)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientKeys.tickets(user?.id) })
      // The same row is the admin queue's data. Without this the customer sees
      // their ticket and the office does not, until someone reloads.
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}

/* ============================================================================
   NOTIFICATIONS
   ========================================================================== */

export function useMyNotifications() {
  const { user } = useAuth()

  return useQuery({
    queryKey: clientKeys.notifications(user?.id),
    enabled: Boolean(user),
    staleTime: 15_000,
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throwReadable(error)
      return (data ?? []).map(toNotification)
    },
  })
}

export function useMarkNotificationsRead() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      if (!supabase) return
      // RLS restricts this to the caller's own rows, so no id filter is needed.
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('read', false)
      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientKeys.notifications(user?.id) })
    },
  })
}

/* ============================================================================
   WARRANTY REQUESTS
   ========================================================================== */

export function useRequestWarrantyTransfer() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      projectId: string
      toName: string
      toEmail: string
      toPhone?: string
      transferDate?: string
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      /* `client_id: user?.id ?? ''` would have sent an empty string as a uuid
         and failed on a type error nobody would understand. Say what is
         actually wrong instead. */
      if (!user) throw new Error('Please sign in again.')

      const { error } = await supabase.from('warranty_requests').insert({
        request_type: 'transfer',
        client_id: user.id,
        project_id: input.projectId,
        transfer_to_name: input.toName.trim(),
        transfer_to_email: input.toEmail.trim().toLowerCase(),
        transfer_to_phone: input.toPhone?.trim() || null,
        expected_transfer_date: input.transferDate || null,
      })
      if (error) throwReadable(error)
    },
    onSuccess: () => {
      // The same row is the approvals queue the office works from.
      void queryClient.invalidateQueries({ queryKey: ['client'] })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
    },
  })
}

/* ============================================================================
   NOTIFICATION PREFERENCES
   ----------------------------------------------------------------------------
   The Save button did nothing, and the table it was supposed to write to has
   seven flags while the screen offered eighteen checkboxes across categories
   that do not exist in the schema. A customer turning off marketing email got a
   satisfying click and no change whatsoever.

   Worse, these flags are LIVE: the milestone trigger in migration 0008 reads
   `milestone_email` before queueing anything. So the preference was already
   being honoured — there was simply no way for a customer to set it.

   In-app is deliberately not a preference. It is the bell in the portal, and
   silencing it would mean a customer with no email could miss that their
   installation had finished.
   ========================================================================== */

export interface NotificationPreferences {
  milestoneEmail: boolean
  milestoneSms: boolean
  appointmentEmail: boolean
  appointmentSms: boolean
  billingEmail: boolean
  billingSms: boolean
  marketingEmail: boolean
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  milestoneEmail: true,
  milestoneSms: false,
  appointmentEmail: true,
  appointmentSms: true,
  billingEmail: true,
  billingSms: false,
  marketingEmail: false,
}

export function useNotificationPreferences() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['client', 'notification-prefs', user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<NotificationPreferences> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle()

      if (error) throwReadable(error)
      // No row yet means nobody has changed anything, which is the defaults.
      if (!data) return DEFAULT_PREFERENCES

      return {
        milestoneEmail: data.milestone_email,
        milestoneSms: data.milestone_sms,
        appointmentEmail: data.appointment_email,
        appointmentSms: data.appointment_sms,
        billingEmail: data.billing_email,
        billingSms: data.billing_sms,
        marketingEmail: data.marketing_email,
      }
    },
  })
}

export function useUpdateNotificationPreferences() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (prefs: NotificationPreferences) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!user) throw new Error('Please sign in again.')

      /* UPSERT, because the row may not exist: preferences are only created
         when somebody first changes one. An UPDATE would report success and
         change nothing — the same silent no-op this whole screen already was. */
      const { error } = await supabase.from('notification_preferences').upsert(
        {
          user_id: user.id,
          milestone_email: prefs.milestoneEmail,
          milestone_sms: prefs.milestoneSms,
          appointment_email: prefs.appointmentEmail,
          appointment_sms: prefs.appointmentSms,
          billing_email: prefs.billingEmail,
          billing_sms: prefs.billingSms,
          marketing_email: prefs.marketingEmail,
        },
        { onConflict: 'user_id' },
      )

      if (error) throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['client', 'notification-prefs'] })
    },
  })
}

/**
 * Cancel a visit.
 *
 * The Cancel button had no handler, so a customer who could not be home had no
 * way to say so — the crew turned up anyway. That is a wasted half-day for the
 * company and an unhappy customer, which is the exact combination this portal
 * exists to prevent.
 *
 * Migration 0023 limits a customer to cancelling: they cannot mark a visit
 * completed or dispatched, so this is the one status change they may make.
 */
export function useCancelAppointment() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { appointmentId: string; reason?: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('appointments')
        .update({
          status: 'cancelled',
          cancelled_reason: input.reason?.trim() || 'Cancelled by the customer',
        })
        .eq('id', input.appointmentId)
        .select('id')

      if (error) throwReadable(error)
      // PostgREST reports success and changes nothing when a policy filters the
      // row, so silence would look like it worked.
      if ((data?.length ?? 0) === 0) {
        throw new Error('That visit could not be cancelled. Please call us instead.')
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clientKeys.appointments(user?.id) })
      // It disappears from the dispatch board too.
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}

/**
 * An existing customer asking to expand their system.
 *
 * The form on /portal/upgrade did `e.preventDefault(); setSubmitted(true)` and
 * then told the customer "a sales engineer will come back to you within two
 * business days". Nobody had been told anything - on the one screen where the
 * customer is trying to spend more money.
 *
 * Goes through an RPC because a customer has no INSERT on `leads`, and should
 * not: stage, score and owner are the sales team's fields. `request_upgrade`
 * (0044) decides those and takes only what the customer knows.
 */
export function useRequestUpgrade() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { reason: string; monthlyBill?: number; details?: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase.rpc('request_upgrade', {
        p_reason: input.reason,
        p_monthly_bill: input.monthlyBill ?? undefined,
        p_details: input.details ?? undefined,
      })

      if (error) throwReadable(error)
      return data as string
    },
    onSuccess: () => {
      // It lands on the CRM board beside brand-new prospects.
      void queryClient.invalidateQueries({ queryKey: ['crm'] })
    },
  })
}
