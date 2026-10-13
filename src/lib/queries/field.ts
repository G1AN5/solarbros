import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toAppointment, toProject } from './mappers'
import { settingNum, useSettings } from './settings'
import { useAuth } from '@/app/auth/useAuth'
import {
  dismissFailedActions,
  flushQueue,
  getFailedActions,
  getQueue,
  runOrQueue,
  subscribeToQueue,
  type ActionHandlers,
} from '@/lib/offline-queue'
import { readableDbError, throwReadable } from '@/lib/db-error'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
import { splitHours } from '@/lib/work-hours'
import type { Appointment, Project } from '@/types/domain'

/* ============================================================================
   FIELD TECHNICIAN DATA
   ----------------------------------------------------------------------------
   The smallest query surface in the application, and the most consequential.

   THE ONE WRITE THAT MATTERS
   `useCompleteMilestone` is the single most important mutation in the system. A
   technician taps it on a rooftop and, through database triggers, it:

     * advances the customer's progress bar in their portal,
     * queues them an email and an in-app notification,
     * raises the next staged invoice at the billing milestones,
     * and closes the project and starts the warranty clock at turnover.

   None of that logic is here. It is in the database, so it happens identically
   whether the tap came from this portal, the admin screen, or a replayed
   offline action.

   EVERY WRITE IS OFFLINE-TOLERANT, AND GOES THROUGH ONE HANDLER
   Each mutation goes through `runOrQueue`, and each queued action is replayed
   by the SAME handler that performs it live (`fieldHandlers` below). There used
   to be two copies of every write — one in the mutation, one in the replay —
   which is exactly how the offline path becomes the one nobody tests.
   Photographs are the exception and say so: they are too large for the queue.
   ========================================================================== */

export const fieldKeys = {
  jobs: (userId?: string, date?: string) => ['field', 'jobs', userId, date] as const,
  schedule: (userId?: string) => ['field', 'schedule', userId] as const,
  job: (appointmentId?: string) => ['field', 'job', appointmentId] as const,
  timeLogs: (userId?: string) => ['field', 'time-logs', userId] as const,
}

/** Today, as a local YYYY-MM-DD string. `toISOString` would give UTC and can
 *  land on the wrong day for a technician working an evening job in Manila. */
export function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/* ============================================================================
   CLOCKING IN
   ----------------------------------------------------------------------------
   "Hours come from your job check-ins" said the Account screen — and nothing
   anywhere checked anybody in. The time-log table existed, the payroll register
   read it, and every technician's month was zero hours.

   Starting a job now records the time on the phone; closing it writes one
   time-log row with both ends. Kept on the phone in between because the two
   moments are often hours apart and the second may have no signal at all.
   ========================================================================== */

const CLOCK_KEY = 'solarbros.clock-in'

export interface ClockIn {
  appointmentId: string
  projectId: string | null
  at: string
  latitude?: number
  longitude?: number
}

function readClockIns(): Record<string, ClockIn> {
  try {
    return JSON.parse(localStorage.getItem(CLOCK_KEY) ?? '{}') as Record<string, ClockIn>
  } catch {
    return {}
  }
}

function writeClockIns(value: Record<string, ClockIn>) {
  try {
    localStorage.setItem(CLOCK_KEY, JSON.stringify(value))
  } catch {
    // Storage refused: the job still closes; only the hours are lost.
  }
}

export function clockInFor(appointmentId: string): ClockIn | undefined {
  return readClockIns()[appointmentId]
}

/* ============================================================================
   THE WRITES — ONE COPY, USED LIVE AND ON REPLAY
   ========================================================================== */

function client() {
  if (!supabase) throw new Error(NOT_CONNECTED)
  return supabase
}

export const fieldHandlers: ActionHandlers = {
  milestone_update: async (p) => {
    /* `completed_by` is not sent: the database takes it from the session
       (migration 0072), so a milestone cannot be credited to a colleague. */
    const { data, error } = await client()
      .from('project_milestones')
      .update({
        status: p.status as 'done' | 'in_progress' | 'pending' | 'blocked',
        completed_at: (p.completedAt as string | null) ?? null,
        note: (p.note as string | null) ?? null,
      })
      .eq('id', p.milestoneId as string)
      .select('id')

    if (error) throwReadable(error)
    /* A policy that filters the row out answers "200, nothing changed". Saying
       "saved" to a technician whose tap reached nobody is the worst outcome
       this portal can produce, so it is an error with the reason. */
    if (!data || data.length === 0) {
      throw new Error(
        `${String(p.label ?? 'That stage')} was not saved — you are not on this project's crew. Ask the dispatcher to assign you to the job.`,
      )
    }
  },

  serial_scan: async (p) => {
    const { error } = await client()
      .from('serialised_assets')
      .insert({
        serial_number: p.serialNumber as string,
        product_name: p.productName as string,
        stock_item_id: (p.stockItemId as string | null) ?? null,
        project_id: p.projectId as string,
        client_id: (p.clientId as string | null) ?? null,
        installed_at: p.installedAt as string,
        warranty_years: (p.warrantyYears as number | null) ?? 10,
      })
    if (error) {
      // A duplicate serial is a real mistake worth surfacing, not a network
      // problem to retry forever.
      if (error.code === '23505') {
        throw new Error(`Serial ${String(p.serialNumber)} has already been recorded.`)
      }
      throw readableDbError(error)
    }
  },

  material_usage: async (p) => {
    const { error } = await client().rpc('consume_project_stock', {
      p_project_id: p.projectId as string,
      p_stock_item_id: p.stockItemId as string,
      p_quantity: p.quantity as number,
    })
    if (error) throwReadable(error)
  },

  // Kept so an action queued by an older version of the portal still replays.
  checklist_item: async (p) => {
    const { error } = await client()
      .from('project_milestones')
      .update({ note: p.note as string })
      .eq('id', p.milestoneId as string)
    if (error) throwReadable(error)
  },

  time_log: async (p) => {
    const { error } = await client()
      .from('time_logs')
      .insert({
        user_id: p.userId as string,
        project_id: (p.projectId as string | null) ?? null,
        appointment_id: (p.appointmentId as string | null) ?? null,
        clock_in: p.clockIn as string,
        clock_out: (p.clockOut as string | null) ?? null,
        latitude: (p.latitude as number | null) ?? null,
        longitude: (p.longitude as number | null) ?? null,
        note: (p.note as string | null) ?? null,
      })
    if (error) throwReadable(error)
  },

  job_start: async (p) => {
    const { data, error } = await client()
      .from('appointments')
      .update({ status: 'in_progress' })
      .eq('id', p.appointmentId as string)
      .in('status', ['requested', 'confirmed', 'dispatched'])
      .select('id')
    if (error) throwReadable(error)
    // Zero rows here usually means it was already started — replaying a start
    // is harmless, so only a visit nobody can see is worth an error.
    if (!data || data.length === 0) {
      const { data: visible } = await client()
        .from('appointments')
        .select('id')
        .eq('id', p.appointmentId as string)
      if (!visible || visible.length === 0) {
        throw new Error('That visit is not assigned to you any more.')
      }
    }
  },

  job_complete: async (p) => {
    const { data, error } = await client()
      .from('appointments')
      .update({
        status: 'completed',
        completed_at: p.completedAt as string,
        client_signoff_name: p.signoffName as string,
        client_signoff_at: p.completedAt as string,
        ...(typeof p.notes === 'string' ? { notes: p.notes } : {}),
      })
      .eq('id', p.appointmentId as string)
      .select('id')
    if (error) throwReadable(error)
    if (!data || data.length === 0) {
      throw new Error(
        'That job was not closed — it may have been reassigned. Check with the office.',
      )
    }
  },
}

/* ============================================================================
   THE OFFLINE QUEUE, AS A HOOK
   ========================================================================== */

export function useOfflineQueue() {
  const queryClient = useQueryClient()

  const queue = useSyncExternalStore(subscribeToQueue, getQueue, getQueue)
  const failed = useSyncExternalStore(subscribeToQueue, getFailedActions, getFailedActions)
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)

  const sync = useCallback(async () => {
    if (syncing || !navigator.onLine) return
    setSyncing(true)
    try {
      const result = await flushQueue(fieldHandlers)
      if (result.synced > 0 || result.failed > 0) {
        setLastSync(new Date().toISOString())
        // Everything the replayed writes touch is now stale.
        void queryClient.invalidateQueries({ queryKey: ['field'] })
        void queryClient.invalidateQueries({ queryKey: ['ops'] })
        void queryClient.invalidateQueries({ queryKey: ['client'] })
        void queryClient.invalidateQueries({ queryKey: ['inv'] })
      }
    } finally {
      setSyncing(false)
    }
  }, [syncing, queryClient])

  /* Watch connectivity and drain automatically on reconnect. A technician who
     walks back into signal should not have to remember to press anything. */
  useEffect(() => {
    function goOnline() {
      setIsOnline(true)
      void sync()
    }
    function goOffline() {
      setIsOnline(false)
    }
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [sync])

  return {
    queue,
    pending: queue.length,
    failed,
    dismissFailed: dismissFailedActions,
    isOnline,
    syncing,
    lastSync,
    sync,
  }
}

/* ============================================================================
   JOBS
   ========================================================================== */

const JOB_SELECT =
  '*, appointment_assignees!inner(user_id, profiles!appointment_assignees_user_id_fkey(full_name))'

function crewNames(row: {
  appointment_assignees?: { profiles?: { full_name?: string | null } | null }[] | null
}): string[] {
  return (row.appointment_assignees ?? [])
    .map((a) => a.profiles?.full_name)
    .filter((n): n is string => Boolean(n))
}

export function useMyJobs(date?: string) {
  const { user } = useAuth()
  const day = date ?? localToday()

  return useQuery({
    queryKey: fieldKeys.jobs(user?.id, day),
    enabled: Boolean(user),
    // A dispatcher can reassign mid-morning; a stale job list sends somebody to
    // the wrong address.
    staleTime: 15_000,
    queryFn: async (): Promise<Appointment[]> => {
      // RLS restricts appointments to those this technician is assigned to, so
      // no user filter is needed — the inner join is only for the crew names.
      const { data, error } = await client()
        .from('appointments')
        .select(JOB_SELECT)
        .eq('scheduled_date', day)
        .neq('status', 'cancelled')
        .order('time_slot')

      if (error) throwReadable(error)
      return (data ?? []).map((row) => toAppointment(row, crewNames(row)))
    },
  })
}

export function useMySchedule() {
  const { user } = useAuth()

  return useQuery({
    queryKey: fieldKeys.schedule(user?.id),
    enabled: Boolean(user),
    queryFn: async (): Promise<Appointment[]> => {
      const { data, error } = await client()
        .from('appointments')
        .select(JOB_SELECT)
        .gte('scheduled_date', localToday())
        .neq('status', 'cancelled')
        .order('scheduled_date')
        .order('time_slot')

      if (error) throwReadable(error)
      return (data ?? []).map((row) => toAppointment(row, crewNames(row)))
    },
  })
}

export interface FieldJob {
  appointment: Appointment
  project: Project | null
  clientPhone: string | null
}

export function useJob(appointmentId?: string) {
  return useQuery({
    queryKey: fieldKeys.job(appointmentId),
    enabled: Boolean(appointmentId),
    staleTime: 10_000,
    queryFn: async (): Promise<FieldJob | null> => {
      const { data, error } = await client()
        .from('appointments')
        .select(
          '*, appointment_assignees(user_id, profiles!appointment_assignees_user_id_fkey(full_name)), project:projects(*, project_milestones(*)), client:profiles!appointments_client_id_fkey(phone)',
        )
        .eq('id', appointmentId!)
        .maybeSingle()

      if (error) throwReadable(error)
      if (!data) return null

      return {
        appointment: toAppointment(data, crewNames(data)),
        project: data.project
          ? toProject(data.project, data.project.project_milestones ?? [])
          : null,
        // The visit's own number first: the office may have entered a
        // different contact for this visit. `||`, not `??` — an account saved
        // with an empty phone must not hide the one on the visit.
        clientPhone: data.contact_phone || data.client?.phone || null,
      }
    },
  })
}

/* ============================================================================
   THE MUTATIONS
   ----------------------------------------------------------------------------
   CRITICAL: TanStack Query defaults to networkMode 'online', which PAUSES a
   mutation while the browser is offline — the mutationFn is never called at
   all. That silently disabled the entire offline queue once: a technician
   tapped, the mutation was parked in memory, nothing was written to
   localStorage, and closing the tab lost the work. 'always' hands control to
   runOrQueue, which is the thing that knows how to persist a write for later.
   ========================================================================== */

function useFieldInvalidation() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['field'] })
    void queryClient.invalidateQueries({ queryKey: ['ops'] })
    void queryClient.invalidateQueries({ queryKey: ['client'] })
    void queryClient.invalidateQueries({ queryKey: ['inv'] })
  }
}

/**
 * Mark a milestone. Sets an ABSOLUTE state, never a relative one, which is
 * what makes it safe to replay: applying "set to done" twice is harmless,
 * whereas "advance one stage" twice would skip a milestone.
 */
export function useCompleteMilestone() {
  const invalidate = useFieldInvalidation()

  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: {
      milestoneId: string
      label: string
      status: 'pending' | 'in_progress' | 'done' | 'blocked'
      note?: string
    }) => {
      const payload = {
        milestoneId: input.milestoneId,
        label: input.label,
        status: input.status,
        completedAt: input.status === 'done' ? new Date().toISOString() : null,
        note: input.note ?? null,
      }
      return runOrQueue(
        'milestone_update',
        payload,
        `${input.label} → ${input.status.replace('_', ' ')}`,
        () => fieldHandlers.milestone_update(payload),
      )
    },
    onSuccess: invalidate,
  })
}

/**
 * Record a serial number. Without this the asset registry has holes, and a
 * warranty claim fails years later when it is far too late to fix.
 */
export function useScanSerial() {
  const invalidate = useFieldInvalidation()

  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: {
      serialNumber: string
      productName: string
      projectId: string
      clientId?: string
      stockItemId?: string
      warrantyYears: number
    }) => {
      const payload = {
        serialNumber: input.serialNumber.trim().toUpperCase(),
        productName: input.productName,
        projectId: input.projectId,
        clientId: input.clientId ?? null,
        stockItemId: input.stockItemId ?? null,
        installedAt: localToday(),
        warrantyYears: input.warrantyYears,
      }
      return runOrQueue('serial_scan', payload, `Serial ${payload.serialNumber}`, () =>
        fieldHandlers.serial_scan(payload),
      )
    },
    onSuccess: invalidate,
  })
}

/**
 * Log materials actually used on site, through `consume_project_stock`, which
 * deducts stock, releases the reservation and writes the ledger in one
 * transaction — and checks that the caller is on this project's crew.
 */
export function useLogMaterials() {
  const invalidate = useFieldInvalidation()

  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: {
      projectId: string
      stockItemId: string
      itemName: string
      quantity: number
    }) => {
      if (input.quantity <= 0) throw new Error('Enter a quantity greater than zero.')
      const payload = {
        projectId: input.projectId,
        stockItemId: input.stockItemId,
        quantity: input.quantity,
      }
      return runOrQueue('material_usage', payload, `${input.quantity} × ${input.itemName}`, () =>
        fieldHandlers.material_usage(payload),
      )
    },
    onSuccess: invalidate,
  })
}

/** Arrive on site: the visit is in progress and the clock starts. */
export function useStartJob() {
  const invalidate = useFieldInvalidation()

  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: {
      appointmentId: string
      projectId?: string | null
      latitude?: number
      longitude?: number
    }) => {
      const clockIns = readClockIns()
      if (!clockIns[input.appointmentId]) {
        clockIns[input.appointmentId] = {
          appointmentId: input.appointmentId,
          projectId: input.projectId ?? null,
          at: new Date().toISOString(),
          latitude: input.latitude,
          longitude: input.longitude,
        }
        writeClockIns(clockIns)
      }

      const payload = { appointmentId: input.appointmentId }
      return runOrQueue('job_start', payload, 'Arrived on site', () =>
        fieldHandlers.job_start(payload),
      )
    },
    onSuccess: invalidate,
  })
}

/**
 * Close a job, with the customer's acceptance — and the hours worked on it.
 *
 * Queued like every other field write. The end of a visit — standing in
 * somebody's garden, packing up — is exactly when a technician is least likely
 * to have signal, and asking them to come back to it later means it does not
 * happen.
 */
export function useCompleteJob() {
  const { user } = useAuth()
  const invalidate = useFieldInvalidation()

  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: {
      appointmentId: string
      projectId?: string | null
      signoffName: string
      notes?: string
    }) => {
      const name = input.signoffName.trim()
      if (name.length < 2) {
        throw new Error('Ask the customer for their name before closing the job.')
      }

      const completedAt = new Date().toISOString()
      const payload = {
        appointmentId: input.appointmentId,
        signoffName: name,
        completedAt,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      }

      const result = await runOrQueue(
        'job_complete',
        payload,
        `Job closed — signed by ${name}`,
        () => fieldHandlers.job_complete(payload),
      )

      // The hours, if the technician started the clock when they arrived.
      const clockIns = readClockIns()
      const started = clockIns[input.appointmentId]
      if (started && user) {
        const log = {
          userId: user.id,
          projectId: started.projectId ?? input.projectId ?? null,
          appointmentId: input.appointmentId,
          clockIn: started.at,
          clockOut: completedAt,
          latitude: started.latitude ?? null,
          longitude: started.longitude ?? null,
        }
        await runOrQueue('time_log', log, 'Hours on site', () => fieldHandlers.time_log(log))
        delete clockIns[input.appointmentId]
        writeClockIns(clockIns)
      }

      return result
    },
    onSuccess: invalidate,
  })
}

/* ============================================================================
   TIME LOGS
   ========================================================================== */

export interface MonthHours {
  regularHours: number
  overtimeHours: number
  jobsCompleted: number
  /** Overtime beyond the company's warning threshold for the period. */
  overtimeAlert: boolean
  overtimeThreshold: number
}

export function useMyTimeLogs() {
  const { user } = useAuth()
  const settings = useSettings().data
  const threshold = settingNum(settings, 'operations.overtime_threshold_hours', 20)

  return useQuery({
    queryKey: [...fieldKeys.timeLogs(user?.id), threshold],
    enabled: Boolean(user),
    queryFn: async (): Promise<MonthHours> => {
      const periodStart = new Date()
      periodStart.setDate(1)
      periodStart.setHours(0, 0, 0, 0)

      const [logs, jobs] = await Promise.all([
        client()
          .from('time_logs')
          .select('hours, clock_in')
          .eq('user_id', user!.id)
          .gte('clock_in', periodStart.toISOString()),
        client()
          .from('appointments')
          .select('id, appointment_assignees!inner(user_id)', { count: 'exact', head: true })
          .eq('appointment_assignees.user_id', user!.id)
          .eq('status', 'completed')
          .gte('completed_at', periodStart.toISOString()),
      ])

      if (logs.error) throwReadable(logs.error)

      // Per local day, the same rule the payroll register uses (work-hours.ts).
      const { regular, overtime } = splitHours(
        (logs.data ?? []).map((row) => ({ clockIn: row.clock_in, hours: Number(row.hours ?? 0) })),
      )

      return {
        regularHours: regular,
        overtimeHours: overtime,
        jobsCompleted: jobs.count ?? 0,
        overtimeAlert: threshold > 0 && overtime > threshold,
        overtimeThreshold: threshold,
      }
    },
  })
}

/* ============================================================================
   WHAT IS ON THIS JOB
   ========================================================================== */

/**
 * Serial numbers already recorded against a project — so a technician can see
 * what they have already done and what is left.
 */
export function useProjectSerials(projectId?: string) {
  return useQuery({
    queryKey: ['field', 'serials', projectId ?? 'none'],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<{ id: string; serialNumber: string; productName: string }[]> => {
      const { data, error } = await client()
        .from('serialised_assets')
        .select('id, serial_number, product_name')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: true })

      if (error) throwReadable(error)
      return (data ?? []).map((row) => ({
        id: row.id,
        serialNumber: row.serial_number,
        productName: row.product_name,
      }))
    },
  })
}

export interface JobMaterial {
  stockItemId: string
  name: string
  sku: string
  unit: string
  category: string
  isSerialised: boolean
  /** What the bill of materials calls for. */
  planned: number
  /** What has already been logged as used on this project. */
  used: number
}

/**
 * The materials this job is supposed to use: the project's reservations, which
 * are its bill of materials as the warehouse holds it.
 *
 * The logging screen used to offer the first five items of the whole catalogue
 * — whatever sorted first alphabetically — whatever the job. A technician
 * installing a hybrid system was asked how many charge controllers they had
 * used, and had no way to record the cable they actually had.
 */
export function useJobMaterials(projectId?: string) {
  return useQuery({
    queryKey: ['field', 'materials', projectId ?? 'none'],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<JobMaterial[]> => {
      const [reservations, movements] = await Promise.all([
        client()
          .from('stock_reservations')
          .select(
            'stock_item_id, quantity, item:stock_items(name, sku, unit, category, is_serialised)',
          )
          .eq('project_id', projectId!),
        client()
          .from('stock_movements')
          .select('stock_item_id, quantity')
          .eq('project_id', projectId!)
          .eq('movement_type', 'consumption'),
      ])

      if (reservations.error) throwReadable(reservations.error)

      const used = new Map<string, number>()
      for (const row of movements.data ?? []) {
        used.set(
          row.stock_item_id,
          (used.get(row.stock_item_id) ?? 0) + Math.abs(Number(row.quantity)),
        )
      }

      return (reservations.data ?? [])
        .map((row) => ({
          stockItemId: row.stock_item_id,
          name: row.item?.name ?? 'Item',
          sku: row.item?.sku ?? '',
          unit: row.item?.unit ?? 'pc',
          category: row.item?.category ?? 'accessory',
          isSerialised: Boolean(row.item?.is_serialised),
          planned: Number(row.quantity),
          used: used.get(row.stock_item_id) ?? 0,
        }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
    },
  })
}

/**
 * Change your own password.
 *
 * `auth.updateUser` acts on the signed-in session and nothing else, so this
 * cannot be pointed at another account however the argument is tampered with.
 *
 * Deliberately NOT queued for offline replay. Replaying a password change
 * later would change the account at an unpredictable moment, and Supabase
 * would reject the stale token anyway.
 */
export function useChangePassword() {
  return useMutation({
    networkMode: 'online',
    mutationFn: async (input: { password: string }) => {
      const { error } = await client().auth.updateUser({ password: input.password })
      if (error) throwReadable(error)
    },
  })
}
