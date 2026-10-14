import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toAppointment, toProject, toTicket } from './mappers'
import { assertWritten, readableDbError, throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import type { Appointment, AppointmentType, Project, Ticket } from '@/types/domain'

/* ============================================================================
   OPERATIONS — projects, dispatch, permits, support, warranty
   ----------------------------------------------------------------------------
   Feeds /admin/projects, /admin/dispatch, /admin/tickets and /admin/warranty.

   ONE PATTERN RUNS THROUGH ALL OF IT: the mutations here do not implement
   business rules, they trigger them. Completing a milestone raises an invoice,
   queues a notification and closes the project — but none of that happens in
   this file. It happens in database triggers (migration 0008), so it happens
   identically whether the update comes from this UI, the field portal, an
   import script, or somebody fixing a row by hand in the dashboard.
   ========================================================================== */

export const opsKeys = {
  projects: ['ops', 'projects'] as const,
  project: (id?: string) => ['ops', 'project', id] as const,
  appointments: ['ops', 'appointments'] as const,
  crew: ['ops', 'crew'] as const,
  tickets: ['ops', 'tickets'] as const,
  warranty: ['ops', 'warranty'] as const,
  permits: (projectId?: string) => ['ops', 'permits', projectId] as const,
}

/* ============================================================================
   PROJECTS
   ========================================================================== */

export function useProjects() {
  return useQuery({
    queryKey: opsKeys.projects,
    queryFn: async (): Promise<Project[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('projects')
        .select(
          '*, project_milestones(*), client:profiles!projects_client_id_fkey(full_name), engineer:profiles!projects_assigned_engineer_fkey(full_name)',
        )
        .order('created_at', { ascending: false })

      if (error) throwReadable(error)

      return (data ?? []).map((row) => {
        const project = toProject(row, row.project_milestones ?? [])
        project.clientName = row.client?.full_name ?? 'Unassigned'
        project.assignedEngineer = row.engineer?.full_name ?? 'Unassigned'
        return project
      })
    },
  })
}

export function useProject(projectId?: string) {
  return useQuery({
    queryKey: opsKeys.project(projectId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<Project | null> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('projects')
        .select(
          '*, project_milestones(*), client:profiles!projects_client_id_fkey(full_name), engineer:profiles!projects_assigned_engineer_fkey(full_name)',
        )
        .eq('id', projectId!)
        .maybeSingle()

      if (error) throwReadable(error)
      if (!data) return null

      const project = toProject(data, data.project_milestones ?? [])
      project.clientName = data.client?.full_name ?? 'Unassigned'
      project.assignedEngineer = data.engineer?.full_name ?? 'Unassigned'
      return project
    },
  })
}

/**
 * Move a milestone.
 *
 * Everything downstream — the staged invoice, the customer notification, the
 * project closing on turnover — is fired by the trigger on this table. This
 * mutation only records what happened.
 */
export function useUpdateMilestone() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      milestoneId: string
      status: 'pending' | 'in_progress' | 'done' | 'blocked'
      userId?: string
      note?: string
    }) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      /* `completed_by` is deliberately NOT sent. Migration 0027 fills it from
         the session, so a milestone cannot be credited to a colleague — the
         same reasoning as payments in 0022 and contracts in 0023. */
      const { data, error } = await supabase
        .from('project_milestones')
        .update({
          status: input.status,
          // The database rejects 'done' without a timestamp, so it is set here
          // rather than left to the caller to remember.
          completed_at: input.status === 'done' ? new Date().toISOString() : null,
          note: input.note ?? null,
        })
        .eq('id', input.milestoneId)
        .select('id')

      if (error) {
        /* The state machine raises sentences written for the person holding the
           tablet — "Cannot start AC Wiring, DC Wiring is still in progress", or
           the gate explaining exactly which precondition is missing. Passing
           them through beats replacing them with something vaguer. */
        if (error.code === '42501') throw new Error(error.message)
        throw readableDbError(error)
      }
      // A role that may not move stages gets zero rows back, not an error.
      assertWritten(
        data,
        'Only the project engineer, an administrator or the crew on this job can move its stages.',
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      // The customer's own view reads different query keys.
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/* ============================================================================
   THE SYNCHRONISE GATE
   ----------------------------------------------------------------------------
   Permitting and procurement run in parallel after a contract is executed, and
   physical work waits for both. This asks the database the SAME question the
   trigger asks, through the same function, so the screen and the rule can never
   drift apart — a UI that computes its own version of a server rule eventually
   disagrees with it, and the user is told two different things.

   Read before anyone clicks, so the page can explain what is outstanding rather
   than only refusing afterwards.
   ========================================================================== */

export interface ProjectGate {
  /** False on a database without migration 0077, where every permit gates the crew. */
  phased: boolean
  /** The permits the crew needs are approved. */
  permitsReady: boolean
  permitsTotal: number
  permitsApproved: number
  permitsRejected: number
  /** Building and electrical permits: they gate structural mounting. */
  workPermitsTotal: number
  workPermitsApproved: number
  workPermitsRejected: number
  /** The utility's approvals: they gate signing off commissioning. */
  energiseReady: boolean
  energisePermitsTotal: number
  energisePermitsApproved: number
  energisePermitsRejected: number
  materialsReady: boolean
  reservations: number
  reservationsShort: number
}

export function useProjectGate(projectId?: string) {
  return useQuery({
    queryKey: ['ops', 'gate', projectId ?? 'none'],
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectGate> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase.rpc('project_gate_status', {
        p_project_id: projectId!,
      })
      if (error) throwReadable(error)

      const gate = data as Record<string, unknown>
      // A database without migration 0077 has no phases: every permit gated
      // the crew, so the overall figures are the crew's figures.
      const phased = gate.work_permits_total !== undefined
      return {
        phased,
        permitsReady: Boolean(gate.permits_ready),
        permitsTotal: Number(gate.permits_total ?? 0),
        permitsApproved: Number(gate.permits_approved ?? 0),
        permitsRejected: Number(gate.permits_rejected ?? 0),
        workPermitsTotal: Number((phased ? gate.work_permits_total : gate.permits_total) ?? 0),
        workPermitsApproved: Number(
          (phased ? gate.work_permits_approved : gate.permits_approved) ?? 0,
        ),
        workPermitsRejected: Number(
          (phased ? gate.work_permits_rejected : gate.permits_rejected) ?? 0,
        ),
        energiseReady: phased ? Boolean(gate.energise_ready) : true,
        energisePermitsTotal: Number(gate.energise_permits_total ?? 0),
        energisePermitsApproved: Number(gate.energise_permits_approved ?? 0),
        energisePermitsRejected: Number(gate.energise_permits_rejected ?? 0),
        materialsReady: Boolean(gate.materials_ready),
        reservations: Number(gate.reservations ?? 0),
        reservationsShort: Number(gate.reservations_short ?? 0),
      }
    },
  })
}

/* Permits live in procurement.ts — the permit screen and the project page both
   read them from there. A second copy of the same two hooks used to sit here,
   unused, waiting to drift. */

/** True when permitting AND procurement have both finished (flow L1-B gate). */
export function useDispatchReadiness(projectId?: string) {
  return useQuery({
    queryKey: ['ops', 'dispatch-ready', projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<boolean> => {
      if (!supabase) return true
      const { data, error } = await supabase.rpc('project_ready_for_dispatch', {
        p_project_id: projectId!,
      })
      if (error) throwReadable(error)
      return Boolean(data)
    },
  })
}

/* ============================================================================
   DISPATCH
   ========================================================================== */

/** A visit as the office sees it: who it is for and how to reach them. */
export interface OfficeAppointment extends Appointment {
  /** Ids, alongside the names in `assignedTo`, so a crew member can be removed. */
  assigneeIds: string[]
  contactEmail: string | null
  accountName: string | null
  projectReference: string | null
}

export function useAllAppointments() {
  return useQuery({
    queryKey: opsKeys.appointments,
    queryFn: async (): Promise<OfficeAppointment[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      /* The lead and the customer account are joined so the board can show an
         email and a name for every visit — a public booking carries them on
         the lead, a portal request on the account. Before, the board showed
         only what was typed into the visit itself, and a portal request had no
         address or number at all. */
      const { data, error } = await supabase
        .from('appointments')
        .select(
          '*, appointment_assignees(user_id, profiles!appointment_assignees_user_id_fkey(full_name)), lead:leads!appointments_lead_id_fkey(email), account:profiles!appointments_client_id_fkey(full_name, email), project:projects!appointments_project_id_fkey(reference)',
        )
        .order('scheduled_date', { ascending: true })
        .order('time_slot', { ascending: true })

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        ...toAppointment(
          row,
          (row.appointment_assignees ?? [])
            .map((a) => a.profiles?.full_name)
            .filter((n): n is string => Boolean(n)),
        ),
        assigneeIds: (row.appointment_assignees ?? []).map((a) => a.user_id),
        contactEmail: row.lead?.email ?? row.account?.email ?? null,
        accountName: row.account?.full_name ?? null,
        projectReference: row.project?.reference ?? null,
      }))
    },
  })
}

/** Customer accounts — who a visit or a manual invoice can be for. */
export function useClientAccounts() {
  return useQuery({
    queryKey: ['ops', 'client-accounts'],
    staleTime: 60_000,
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, address')
        .eq('role', 'client')
        .eq('is_active', true)
        .is('requested_role', null)
        .order('full_name')
      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        address: row.address,
      }))
    },
  })
}

/**
 * Create an appointment from the office.
 *
 * Three things arrive on the dispatch board: a public booking, a customer's
 * request from their portal, and this - the coordinator ringing a customer back
 * and putting the visit in themselves, or turning a support ticket into a site
 * visit. That third route did not exist: "+ New appointment" and "Dispatch"
 * were both buttons with no handler, so a ticket that needed a technician had
 * to be re-entered as if it were a fresh booking, losing the link back to the
 * problem it was raised for.
 *
 * `ticket_id` is what keeps that link. The visit and the ticket that caused it
 * stay joined, so the resolution written on the ticket is about the job that
 * was actually done.
 */
export function useCreateAppointment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      type: AppointmentType
      date: string
      timeSlot: string
      contactName?: string
      contactPhone?: string
      address?: string
      notes?: string
      clientId?: string | null
      projectId?: string | null
      leadId?: string | null
      ticketId?: string | null
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      /* A visit has to be FOR somebody — a lead, a customer or a project — or
         the crew has no way to know whose site it is. The database refuses one
         without (`appointments_needs_a_subject`), which reached the screen as
         "one of the values is outside what the system allows". Said here,
         where it can be acted on. */
      if (!input.clientId && !input.projectId && !input.leadId && !input.ticketId) {
        throw new Error('Choose who this visit is for — a project, a customer or a lead.')
      }
      if (!input.date) throw new Error('Choose a date for the visit.')

      const { data, error } = await supabase
        .from('appointments')
        .insert({
          appointment_type: input.type,
          /* 'confirmed', because the office is booking it: the customer agreed
             the time on the phone. It stays in the unassigned queue until a
             crew is on it, which is the step that notifies them. */
          status: 'confirmed',
          scheduled_date: input.date,
          time_slot: input.timeSlot,
          // Blank fields are filled from the lead, account or project (0071).
          contact_name: input.contactName?.trim() ?? '',
          contact_phone: input.contactPhone?.trim() || null,
          address: input.address?.trim() || null,
          notes: input.notes?.trim() || null,
          client_id: input.clientId ?? null,
          project_id: input.projectId ?? null,
          lead_id: input.leadId ?? null,
          ticket_id: input.ticketId ?? null,
        })
        .select('id')
        .single()

      if (error) throwReadable(error)
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      // The customer sees their own visit appear in the portal without a
      // reload, which is the whole point of the two portals sharing a table.
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/** Everyone who can be sent to a job: technicians and project engineers. */
export function useCrew() {
  return useQuery({
    queryKey: opsKeys.crew,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, avatar_initials')
        .in('role', ['technician', 'project_engineer'])
        .eq('is_active', true)
        .order('full_name')
      if (error) throwReadable(error)
      return (data ?? []).map((r) => ({
        id: r.id,
        fullName: r.full_name,
        role: r.role,
        initials: r.avatar_initials ?? '??',
      }))
    },
  })
}

/**
 * Assign a crew member and dispatch the visit.
 *
 * Two writes: the assignment, then the status. The status change is what fires
 * the notification trigger, so it goes second — notifying a customer that a
 * team is on the way before anyone is actually assigned would be a lie.
 */
export function useAssignCrew() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { appointmentId: string; userId: string; assignedBy: string }) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const { error: assignError } = await supabase.from('appointment_assignees').insert({
        appointment_id: input.appointmentId,
        user_id: input.userId,
        assigned_by: input.assignedBy,
      })
      // 23505 = already assigned. Harmless; carry on to the status update.
      if (assignError && assignError.code !== '23505') throwReadable(assignError)

      /* Only a visit that has not started moves to 'dispatched'. Adding a
         second technician to a job already under way must not knock it back
         from "in progress". Assigning also puts them on the project's crew
         (0072), which is what lets them see it in the field portal. */
      const { error: statusError } = await supabase
        .from('appointments')
        .update({ status: 'dispatched' })
        .eq('id', input.appointmentId)
        .in('status', ['requested', 'confirmed'])

      if (statusError) throwReadable(statusError)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
      void queryClient.invalidateQueries({ queryKey: ['enquiries'] })
    },
  })
}

/** Take a crew member off a visit. With nobody left, it goes back to the queue. */
export function useUnassignCrew() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { appointmentId: string; userId: string; remaining: number }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('appointment_assignees')
        .delete()
        .eq('appointment_id', input.appointmentId)
        .eq('user_id', input.userId)
        .select('user_id')
      if (error) throwReadable(error)
      assertWritten(data, 'That crew member could not be removed — your role may not change crews.')

      if (input.remaining <= 0) {
        const { error: statusError } = await supabase
          .from('appointments')
          .update({ status: 'confirmed' })
          .eq('id', input.appointmentId)
          .eq('status', 'dispatched')
        if (statusError) throwReadable(statusError)
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/**
 * Reschedule, cancel, or close a visit from the office.
 *
 * The board could create and assign visits and do nothing else with them: a
 * customer who rang to move their survey had to be cancelled and re-entered,
 * and a visit that happened without the app (the technician's phone died) sat
 * "dispatched" for ever. Moving or cancelling it notifies the customer and the
 * crew (0073).
 */
export function useUpdateAppointment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      id: string
      date?: string
      timeSlot?: string
      status?: 'confirmed' | 'cancelled' | 'completed'
      cancelledReason?: string
      notes?: string | null
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const patch: Database['public']['Tables']['appointments']['Update'] = {}
      if (input.date) patch.scheduled_date = input.date
      if (input.timeSlot) patch.time_slot = input.timeSlot
      if (input.status) patch.status = input.status
      if (input.status === 'cancelled') {
        patch.cancelled_reason = input.cancelledReason?.trim() || 'Cancelled by the office'
      }
      if (input.notes !== undefined) patch.notes = input.notes?.trim() || null

      const { data, error } = await supabase
        .from('appointments')
        .update(patch)
        .eq('id', input.id)
        .select('id')

      if (error) throwReadable(error)
      assertWritten(data, 'That visit was not updated — your role may not change bookings.')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
      void queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      void queryClient.invalidateQueries({ queryKey: ['field'] })
    },
  })
}

/* ============================================================================
   SUPPORT
   ========================================================================== */

export function useAllTickets() {
  return useQuery({
    queryKey: opsKeys.tickets,
    queryFn: async (): Promise<Ticket[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      /* The ASSIGNEE is joined as well as the client. `tickets.assigned_to` is
         a uuid, and the mapper puts it straight into `assignedTo` — so without
         this join the queue displayed a raw id where a colleague's name should
         be, the same way the customer dashboard did before migration 0031. */
      const { data, error } = await supabase
        .from('tickets')
        .select(
          '*, client:profiles!tickets_client_id_fkey(full_name), assignee:profiles!tickets_assigned_to_fkey(full_name)',
        )
        .order('created_at', { ascending: false })

      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        ...toTicket(row, row.client?.full_name ?? 'Unknown'),
        assignedTo: row.assignee?.full_name ?? undefined,
        assignedToId: row.assigned_to ?? undefined,
      }))
    },
  })
}

export function useUpdateTicket() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      id: string
      status?: Ticket['status']
      assignedTo?: string | null
      priority?: Ticket['priority']
      resolution?: string
      /** Decided at triage: does the warranty cover this, or is it billable? */
      warrantyCovered?: boolean | null
      triagedBy?: string
    }) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      // Typed against the generated Update shape rather than a loose record,
      // so a mistyped column name is a compile error instead of a silent no-op.
      const patch: Database['public']['Tables']['tickets']['Update'] = {}
      if (input.status) {
        patch.status = input.status
        if (input.status === 'resolved') patch.resolved_at = new Date().toISOString()
      }
      if (input.assignedTo !== undefined) patch.assigned_to = input.assignedTo
      if (input.priority) patch.priority = input.priority
      if (input.resolution) patch.resolution = input.resolution
      if (input.warrantyCovered !== undefined) {
        patch.warranty_covered = input.warrantyCovered
        if (input.triagedBy) {
          patch.triaged_by = input.triagedBy
          patch.triaged_at = new Date().toISOString()
        }
      }

      const { data, error } = await supabase
        .from('tickets')
        .update(patch)
        .eq('id', input.id)
        .select('id')
      if (error) throwReadable(error)
      assertWritten(data, 'That ticket was not updated — your role may not change it.')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/* ============================================================================
   WARRANTY APPROVALS
   ========================================================================== */

export interface WarrantyRequestRow {
  id: string
  type: 'registration' | 'transfer'
  status: 'pending' | 'approved' | 'rejected'
  clientId: string
  clientName: string
  projectId: string
  projectReference: string
  transferToName: string | null
  transferToEmail: string | null
  transferToPhone: string | null
  expectedTransferDate: string | null
  submittedAt: string
  reviewedAt: string | null
  reviewNotes: string | null
}

export function useWarrantyRequests() {
  return useQuery({
    queryKey: opsKeys.warranty,
    queryFn: async (): Promise<WarrantyRequestRow[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('warranty_requests')
        .select(
          '*, client:profiles!warranty_requests_client_id_fkey(full_name), project:projects(reference)',
        )
        .order('submitted_at', { ascending: false })

      if (error) throwReadable(error)

      return (data ?? []).map((row) => ({
        id: row.id,
        type: row.request_type,
        status: row.status,
        clientId: row.client_id,
        clientName: row.client?.full_name ?? 'Unknown',
        projectId: row.project_id,
        projectReference: row.project?.reference ?? '',
        transferToName: row.transfer_to_name,
        transferToEmail: row.transfer_to_email,
        transferToPhone: row.transfer_to_phone,
        expectedTransferDate: row.expected_transfer_date,
        submittedAt: row.submitted_at,
        reviewedAt: row.reviewed_at,
        reviewNotes: row.review_notes,
      }))
    },
  })
}

/**
 * Approve or reject a warranty request.
 *
 * Approving a TRANSFER reassigns every serialised asset on the project to the
 * new owner — done by the trigger in 0008, logged at 'critical'. That is why it
 * is restricted to inventory managers and admins in the RLS policy.
 */
export function useReviewWarrantyRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      id: string
      approve: boolean
      reviewerId: string
      notes?: string
    }) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      if (!input.approve && !input.notes?.trim()) {
        throw new Error('Say why it is being rejected — the customer reads it.')
      }

      const { data, error } = await supabase
        .from('warranty_requests')
        .update({
          status: input.approve ? 'approved' : 'rejected',
          reviewed_by: input.reviewerId,
          reviewed_at: new Date().toISOString(),
          review_notes: input.notes?.trim() || null,
        })
        .eq('id', input.id)
        .eq('status', 'pending')
        .select('id')

      if (error) throwReadable(error)
      assertWritten(data, 'That request was already decided, or your role may not review it.')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/**
 * Move a project between planning, in progress, on hold, completed, cancelled.
 *
 * "Update status" was the primary action on the project page and had no
 * handler, so a project that stalled waiting on a permit could not be put on
 * hold and went on reading "In progress" to the customer for weeks.
 *
 * Milestones are NOT touched here. They have their own state machine (0027)
 * with ordering rules and an audited override; a status change that quietly
 * moved them would be a way around it.
 */
export function useUpdateProjectStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; status: Project['status']; note?: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('projects')
        .update({ status: input.status })
        .eq('id', input.id)
        .select('id, status')

      if (error) throwReadable(error)
      /* PostgREST reports a write the policy filtered out as 200 with zero
         rows, not as an error. Treating that as success is how a change that
         never happened gets reported as saved. */
      if (!data || data.length === 0) {
        throw new Error('That change was refused. Your role may not update this project.')
      }
      return data[0]
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      // The customer's own project page shows this status.
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/**
 * Documents of one kind, keyed by project.
 *
 * Built for the warranty transfer queue, where "View proof of sale" was a
 * button with no handler — so the reviewer was asked to approve moving a
 * warranty to a different person without being shown the evidence for it,
 * which is the one thing that review exists to check.
 *
 * One query rather than one per row: a queue of thirty transfers should not
 * open thirty connections to find thirty documents.
 */
export function useDocumentsByKind(kind: 'proof_of_sale' | 'turnover_certificate') {
  return useQuery({
    queryKey: ['ops', 'documents', kind],
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, { id: string; storagePath: string | null }>> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('documents')
        .select('id, project_id, storage_path, uploaded_at')
        .eq('kind', kind)
        .order('uploaded_at', { ascending: false })

      if (error) throwReadable(error)

      const byProject: Record<string, { id: string; storagePath: string | null }> = {}
      for (const row of data ?? []) {
        // Ordered newest first, so the first one seen for a project wins.
        if (row.project_id && !byProject[row.project_id]) {
          byProject[row.project_id] = { id: row.id, storagePath: row.storage_path }
        }
      }
      return byProject
    },
  })
}

/* ============================================================================
   BILL OF MATERIALS
   ----------------------------------------------------------------------------
   The project page showed a hardcoded five-line BOM — the same panels, the same
   inverter, the same PHP 8,200 unit price, on every project in the system. It
   then subtracted that invented total from the real contract value and
   presented the difference as the project's MARGIN, with a percentage.

   That is the most dangerous kind of placeholder: not obviously fake, sitting
   on a page an engineer or an owner uses to judge whether a job is worth doing.

   The real lineage already existed and simply was not read:

       projects.contract_id -> contracts.quotation_id -> quotation_lines

   Reservations are joined in separately, because what was QUOTED and what the
   warehouse actually managed to HOLD are different numbers, and the gap between
   them is what procurement has to close before installation.
   ========================================================================== */

export interface BomRow {
  stockItemId: string | null
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  /** How much of `quantity` the warehouse has actually reserved. */
  quantityHeld: number
}

export function useProjectBom(projectId?: string) {
  return useQuery({
    queryKey: ['ops', 'bom', projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<BomRow[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      if (!projectId) return []

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('contract_id')
        .eq('id', projectId)
        .maybeSingle()

      if (projectError) throwReadable(projectError)
      // A project created before its contract, or seeded without one, has no
      // BOM yet. That is a real state, not an error.
      if (!project?.contract_id) return []

      const { data: contract, error: contractError } = await supabase
        .from('contracts')
        .select('quotation_id')
        .eq('id', project.contract_id)
        .maybeSingle()

      if (contractError) throwReadable(contractError)
      if (!contract?.quotation_id) return []

      const [lines, reservations] = await Promise.all([
        supabase
          .from('quotation_lines')
          .select('stock_item_id, description, quantity, unit_price, line_total, sort_order')
          .eq('quotation_id', contract.quotation_id)
          .order('sort_order'),
        supabase
          .from('stock_reservations')
          .select('stock_item_id, quantity_held')
          .eq('project_id', projectId),
      ])

      if (lines.error) throwReadable(lines.error)

      const held = new Map<string, number>()
      for (const row of reservations.data ?? []) {
        if (row.stock_item_id) held.set(row.stock_item_id, Number(row.quantity_held))
      }

      return (lines.data ?? []).map((row) => ({
        stockItemId: row.stock_item_id,
        description: row.description,
        quantity: Number(row.quantity),
        unitPrice: Number(row.unit_price),
        lineTotal: Number(row.line_total),
        quantityHeld: row.stock_item_id ? (held.get(row.stock_item_id) ?? 0) : 0,
      }))
    },
  })
}

/* ============================================================================
   THE PROJECT TEAM
   ----------------------------------------------------------------------------
   A project had an `assigned_engineer` column and a `project_crew` table, and
   nothing anywhere wrote either. So every project read "Engineer: To be
   assigned" for its whole life, the customer could only ever message an
   administrator, and a technician's access to the job depended on a table no
   screen could fill. Dispatching a technician to a project's visit now adds
   them to the crew automatically (0072); this is the office's own control over
   the same two things.
   ========================================================================== */

export interface CrewMember {
  userId: string
  fullName: string
  role: string
  crewRole: string
}

export function useProjectCrew(projectId?: string) {
  return useQuery({
    queryKey: ['ops', 'crew', projectId ?? 'none'],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<CrewMember[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('project_crew')
        .select('user_id, crew_role, member:profiles!project_crew_user_id_fkey(full_name, role)')
        .eq('project_id', projectId!)
      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        userId: row.user_id,
        fullName: row.member?.full_name ?? 'Unknown',
        role: row.member?.role ?? '',
        crewRole: row.crew_role,
      }))
    },
  })
}

export function useSetProjectEngineer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { projectId: string; engineerId: string | null }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('projects')
        .update({ assigned_engineer: input.engineerId })
        .eq('id', input.projectId)
        .select('id')
      if (error) throwReadable(error)
      assertWritten(data, 'That was refused — your role may not change the project team.')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

export function useAddCrewMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { projectId: string; userId: string; crewRole: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { error } = await supabase.from('project_crew').insert({
        project_id: input.projectId,
        user_id: input.userId,
        crew_role: input.crewRole,
      })
      if (error && error.code !== '23505') throwReadable(error)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}

export function useRemoveCrewMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { projectId: string; userId: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('project_crew')
        .delete()
        .eq('project_id', input.projectId)
        .eq('user_id', input.userId)
        .select('user_id')
      if (error) throwReadable(error)
      assertWritten(
        data,
        'That was refused — only a project engineer or an administrator changes crews.',
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}

/* ============================================================================
   PREVENTIVE MAINTENANCE
   ----------------------------------------------------------------------------
   A schedule row is written when a project is turned over (0008), and
   nothing read it: the "annual maintenance" in the flow diagram's after-sales
   branch was a date in a table nobody looked at. The dispatch board now lists
   what is due, and booking a visit from it links the two — so completing the
   visit closes the schedule and books the next one (0073).
   ========================================================================== */

export interface MaintenanceDue {
  id: string
  projectId: string
  projectReference: string
  clientId: string | null
  clientName: string
  address: string
  dueDate: string
  appointmentId: string | null
  notifiedAt: string | null
}

export function useMaintenanceSchedules() {
  return useQuery({
    queryKey: ['ops', 'maintenance'],
    queryFn: async (): Promise<MaintenanceDue[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('maintenance_schedules')
        .select(
          'id, project_id, due_date, appointment_id, notified_at, project:projects!maintenance_schedules_project_id_fkey(reference, address, client_id, client:profiles!projects_client_id_fkey(full_name))',
        )
        .eq('status', 'pending')
        .order('due_date')
      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        projectReference: row.project?.reference ?? '',
        clientId: row.project?.client_id ?? null,
        clientName: row.project?.client?.full_name ?? 'Customer',
        address: row.project?.address ?? '',
        dueDate: row.due_date,
        appointmentId: row.appointment_id,
        notifiedAt: row.notified_at,
      }))
    },
  })
}

/** Book the visit for a maintenance schedule, and link the two. */
export function useScheduleMaintenanceVisit() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      scheduleId: string
      projectId: string
      date: string
      timeSlot: string
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data: visit, error } = await supabase
        .from('appointments')
        .insert({
          appointment_type: 'maintenance',
          status: 'confirmed',
          scheduled_date: input.date,
          time_slot: input.timeSlot,
          contact_name: '',
          project_id: input.projectId,
          notes: 'Scheduled preventive maintenance.',
        })
        .select('id')
        .single()
      if (error) throwReadable(error)

      const { error: linkError } = await supabase
        .from('maintenance_schedules')
        .update({ appointment_id: visit.id })
        .eq('id', input.scheduleId)
      if (linkError) throwReadable(linkError)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/* ============================================================================
   WHAT THE CREW LEFT BEHIND: PHOTOS AND SERIALS
   ========================================================================== */

export interface SitePhoto {
  id: string
  storagePath: string
  category: string | null
  caption: string | null
  takenAt: string
  latitude: number | null
  longitude: number | null
  clientVisible: boolean
}

/**
 * Photos for a project, or for visits that have no project yet — a site
 * survey's, shown on its enquiry. Staff see all; RLS shows a customer the
 * visible ones on their own project.
 */
export function useSitePhotos(scope: { projectId?: string; appointmentIds?: string[] }) {
  const { projectId } = scope
  const visitIds = [...(scope.appointmentIds ?? [])].sort()

  return useQuery({
    queryKey: ['ops', 'photos', projectId ?? 'none', visitIds.join(',')],
    enabled: Boolean(projectId) || visitIds.length > 0,
    queryFn: async (): Promise<SitePhoto[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const base = supabase
        .from('site_photos')
        .select(
          'id, storage_path, photo_category, caption, taken_at, latitude, longitude, is_client_visible',
        )
      const { data, error } = await (
        projectId ? base.eq('project_id', projectId) : base.in('appointment_id', visitIds)
      ).order('taken_at', { ascending: false })
      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        storagePath: row.storage_path,
        category: row.photo_category,
        caption: row.caption,
        takenAt: row.taken_at,
        latitude: row.latitude !== null ? Number(row.latitude) : null,
        longitude: row.longitude !== null ? Number(row.longitude) : null,
        clientVisible: row.is_client_visible,
      }))
    },
  })
}

export function useProjectAssets(projectId?: string) {
  return useQuery({
    queryKey: ['ops', 'assets', projectId ?? 'none'],
    enabled: Boolean(projectId),
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('serialised_assets')
        .select('id, serial_number, product_name, installed_at, warranty_expires_at, status')
        .eq('project_id', projectId!)
        .order('created_at')
      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        serialNumber: row.serial_number,
        productName: row.product_name,
        installedAt: row.installed_at,
        warrantyExpiresAt: row.warranty_expires_at,
        status: row.status,
      }))
    },
  })
}

/** Staff names for a list of ids — milestone sign-offs, recorders, approvers. */
export function useStaffNames(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort()
  return useQuery({
    queryKey: ['ops', 'staff-names', unique.join(',')],
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase.rpc('staff_display_names', { p_ids: unique })
      if (error) throwReadable(error)
      return (data as Record<string, string> | null) ?? {}
    },
  })
}

/** Show or hide a site photo from the customer. Photos are visible by default. */
export function useSetPhotoVisibility() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; visible: boolean }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('site_photos')
        .update({ is_client_visible: input.visible })
        .eq('id', input.id)
        .select('id')
      if (error) throwReadable(error)
      assertWritten(data, 'That photo could not be changed.')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops', 'photos'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/* ============================================================================
   ONE PROJECT'S DOCUMENTS
   ----------------------------------------------------------------------------
   The project page used the customer portal's "all my documents" query and
   filtered it in the browser — which, for an office account, downloaded every
   document of every project to show the handful belonging to one.
   ========================================================================== */

export interface ProjectDocument {
  id: string
  name: string
  kind: string
  storagePath: string | null
  uploadedAt: string
  clientVisible: boolean
  uploadedBy: string | null
}

export function useProjectDocuments(projectId?: string) {
  return useQuery({
    queryKey: ['ops', 'documents', 'project', projectId ?? 'none'],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectDocument[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('documents')
        .select('id, name, kind, storage_path, uploaded_at, is_client_visible, uploaded_by')
        .eq('project_id', projectId!)
        .order('uploaded_at', { ascending: false })
      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        storagePath: row.storage_path,
        uploadedAt: row.uploaded_at,
        clientVisible: row.is_client_visible,
        uploadedBy: row.uploaded_by,
      }))
    },
  })
}

export function useSetDocumentVisibility() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { id: string; visible: boolean }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)
      const { data, error } = await supabase
        .from('documents')
        .update({ is_client_visible: input.visible })
        .eq('id', input.id)
        .select('id')
      if (error) throwReadable(error)
      assertWritten(data, 'That document could not be changed.')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops', 'documents'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}
