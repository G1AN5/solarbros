import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toAppointment, toProject, toTicket } from './mappers'
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

      if (error) throw error

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

      if (error) throw error
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
      const { error } = await supabase
        .from('project_milestones')
        .update({
          status: input.status,
          // The database rejects 'done' without a timestamp, so it is set here
          // rather than left to the caller to remember.
          completed_at: input.status === 'done' ? new Date().toISOString() : null,
          note: input.note ?? null,
        })
        .eq('id', input.milestoneId)

      if (error) {
        /* The state machine raises sentences written for the person holding the
           tablet — "Cannot start AC Wiring, DC Wiring is still in progress", or
           the gate explaining exactly which precondition is missing. Passing
           them through beats replacing them with something vaguer. */
        if (error.code === '42501') throw new Error(error.message)
        throw error
      }
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
  permitsReady: boolean
  permitsTotal: number
  permitsApproved: number
  permitsRejected: number
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
      if (error) throw error

      const gate = data as Record<string, unknown>
      return {
        permitsReady: Boolean(gate.permits_ready),
        permitsTotal: Number(gate.permits_total ?? 0),
        permitsApproved: Number(gate.permits_approved ?? 0),
        permitsRejected: Number(gate.permits_rejected ?? 0),
        materialsReady: Boolean(gate.materials_ready),
        reservations: Number(gate.reservations ?? 0),
        reservationsShort: Number(gate.reservations_short ?? 0),
      }
    },
  })
}

/* ============================================================================
   PERMITS · the external-party proxy pattern
   ----------------------------------------------------------------------------
   The city hall and the utility do not use this system. A project engineer
   records their decision on their behalf, and the record captures WHO recorded
   it and the reference number that makes it verifiable later. The trigger in
   0008 writes that to the audit log at 'warning' severity, because "the utility
   approved this" and "an employee said the utility approved this" are different
   claims.
   ========================================================================== */

export interface PermitRecord {
  id: string
  projectId: string
  permitType: string
  authority: string
  status: string
  submittedAt: string | null
  decidedAt: string | null
  externalReference: string | null
  recordedBy: string | null
  recorderName: string | null
  feeAmount: number | null
  findings: string | null
}

export function usePermits(projectId?: string) {
  return useQuery({
    queryKey: opsKeys.permits(projectId),
    queryFn: async (): Promise<PermitRecord[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      let query = supabase
        .from('permits')
        .select('*, recorder:profiles!permits_recorded_by_fkey(full_name)')
        .order('created_at', { ascending: true })

      if (projectId) query = query.eq('project_id', projectId)

      const { data, error } = await query
      if (error) throw error

      return (data ?? []).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        permitType: row.permit_type,
        authority: row.authority,
        status: row.status,
        submittedAt: row.submitted_at,
        decidedAt: row.decided_at,
        externalReference: row.external_reference,
        recordedBy: row.recorded_by,
        recorderName: row.recorder?.full_name ?? null,
        feeAmount: row.fee_amount ? Number(row.fee_amount) : null,
        findings: row.findings,
      }))
    },
  })
}

/**
 * Record an external body's decision on a permit.
 *
 * This is the mutation that lets the whole flow proceed without a real city
 * hall in the loop, which is what makes the system demonstrable end to end. The
 * database refuses an approval or rejection that does not name who recorded it
 * (`permits_decision_needs_recorder`), so the proxy entry is always attributable.
 */
export function useRecordPermitDecision() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      permitId: string
      status: 'submitted' | 'under_review' | 'approved' | 'rejected'
      externalReference?: string
      findings?: string
      userId: string
    }) => {
      if (!supabase) throw new Error('Not connected to the backend.')

      const decided = input.status === 'approved' || input.status === 'rejected'

      const { error } = await supabase
        .from('permits')
        .update({
          status: input.status,
          external_reference: input.externalReference ?? null,
          findings: input.findings ?? null,
          decided_at: decided ? new Date().toISOString() : null,
          recorded_by: decided ? input.userId : null,
          recorded_at: decided ? new Date().toISOString() : null,
          submitted_at: input.status === 'submitted' ? new Date().toISOString() : undefined,
        })
        .eq('id', input.permitId)

      if (error) {
        if (error.message.includes('permits_decision_needs_recorder')) {
          throw new Error('A decision must record who entered it. Please sign in again.')
        }
        throw error
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
    },
  })
}

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
      if (error) throw error
      return Boolean(data)
    },
  })
}

/* ============================================================================
   DISPATCH
   ========================================================================== */

export function useAllAppointments() {
  return useQuery({
    queryKey: opsKeys.appointments,
    queryFn: async (): Promise<Appointment[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('appointments')
        .select(
          '*, appointment_assignees(user_id, profiles!appointment_assignees_user_id_fkey(full_name))',
        )
        .order('scheduled_date', { ascending: true })

      if (error) throw error

      return (data ?? []).map((row) =>
        toAppointment(
          row,
          (row.appointment_assignees ?? [])
            .map((a) => a.profiles?.full_name)
            .filter((n): n is string => Boolean(n)),
        ),
      )
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
      contactName: string
      contactPhone?: string
      address?: string
      notes?: string
      clientId?: string | null
      projectId?: string | null
      ticketId?: string | null
    }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('appointments')
        .insert({
          appointment_type: input.type,
          // 'requested' and not 'confirmed': it is not a commitment until a
          // crew is on it, and the unassigned queue is what makes that visible.
          status: 'requested',
          scheduled_date: input.date,
          time_slot: input.timeSlot,
          contact_name: input.contactName.trim(),
          contact_phone: input.contactPhone?.trim() || null,
          address: input.address?.trim() || null,
          notes: input.notes?.trim() || null,
          client_id: input.clientId ?? null,
          project_id: input.projectId ?? null,
          ticket_id: input.ticketId ?? null,
        })
        .select('id')
        .single()

      if (error) throw error
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
      if (error) throw error
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
      if (assignError && assignError.code !== '23505') throw assignError

      const { error: statusError } = await supabase
        .from('appointments')
        .update({ status: 'dispatched' })
        .eq('id', input.appointmentId)

      if (statusError) throw statusError
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
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

      if (error) throw error
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

      const { error } = await supabase.from('tickets').update(patch).eq('id', input.id)
      if (error) throw error
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
  submittedAt: string
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

      if (error) throw error

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
        submittedAt: row.submitted_at,
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

      const { error } = await supabase
        .from('warranty_requests')
        .update({
          status: input.approve ? 'approved' : 'rejected',
          reviewed_by: input.reviewerId,
          reviewed_at: new Date().toISOString(),
          review_notes: input.notes ?? null,
        })
        .eq('id', input.id)

      if (error) throw error
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

      if (error) throw error
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

      if (error) throw error

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

      if (projectError) throw projectError
      // A project created before its contract, or seeded without one, has no
      // BOM yet. That is a real state, not an error.
      if (!project?.contract_id) return []

      const { data: contract, error: contractError } = await supabase
        .from('contracts')
        .select('quotation_id')
        .eq('id', project.contract_id)
        .maybeSingle()

      if (contractError) throw contractError
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

      if (lines.error) throw lines.error

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
