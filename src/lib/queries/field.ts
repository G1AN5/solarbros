import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toAppointment, toProject } from './mappers'
import { useAuth } from '@/app/auth/useAuth'
import {
  flushQueue,
  getQueue,
  runOrQueue,
  subscribeToQueue,
  type ActionHandlers,
} from '@/lib/offline-queue'
import { NOT_CONNECTED, supabase } from '@/lib/supabase'
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

   None of that logic is here. It is in migration 0008, so it happens
   identically whether the tap came from this portal, the admin screen, or a
   replayed offline action.

   EVERY WRITE IS OFFLINE-TOLERANT
   Each mutation goes through `runOrQueue`. With no signal the action is stored
   on the phone and the technician is told it is queued; on reconnect it replays.
   Photographs are the exception and say so — they are too large for the queue.
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
   THE OFFLINE QUEUE, AS A HOOK
   ========================================================================== */

export function useOfflineQueue() {
  const queryClient = useQueryClient()

  const queue = useSyncExternalStore(subscribeToQueue, getQueue, getQueue)
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)

  /* Handlers live here rather than in offline-queue.ts, because replaying an
     action must go through exactly the same code path as performing it live —
     otherwise the two drift and the offline path is the one nobody tests. */
  const handlers: ActionHandlers = {
    milestone_update: async (p) => {
      if (!supabase) return
      const { error } = await supabase
        .from('project_milestones')
        .update({
          status: p.status as 'done' | 'in_progress' | 'pending' | 'blocked',
          completed_at: p.completedAt as string | null,
          completed_by: p.userId as string | null,
          note: (p.note as string) ?? null,
        })
        .eq('id', p.milestoneId as string)
      if (error) throw error
    },
    serial_scan: async (p) => {
      if (!supabase) return
      const { error } = await supabase.from('serialised_assets').insert({
        serial_number: p.serialNumber as string,
        product_name: p.productName as string,
        stock_item_id: (p.stockItemId as string) ?? null,
        project_id: p.projectId as string,
        client_id: (p.clientId as string) ?? null,
        installed_at: p.installedAt as string,
        warranty_years: (p.warrantyYears as number) ?? 10,
        scanned_by: p.userId as string,
      })
      if (error) throw error
    },
    material_usage: async (p) => {
      if (!supabase) return
      const { error } = await supabase.rpc('consume_project_stock', {
        p_project_id: p.projectId as string,
        p_stock_item_id: p.stockItemId as string,
        p_quantity: p.quantity as number,
      })
      if (error) throw error
    },
    checklist_item: async (p) => {
      if (!supabase) return
      // Checklist progress rides on the milestone's note field for now; a
      // dedicated table lands with the digital-forms work.
      const { error } = await supabase
        .from('project_milestones')
        .update({ note: p.note as string })
        .eq('id', p.milestoneId as string)
      if (error) throw error
    },
    job_complete: async (p) => {
      if (!supabase) return
      const { error } = await supabase
        .from('appointments')
        .update({
          status: 'completed',
          completed_at: p.completedAt as string,
          client_signoff_name: p.signoffName as string,
          client_signoff_at: p.completedAt as string,
        })
        .eq('id', p.appointmentId as string)
      if (error) throw error
    },
    time_log: async (p) => {
      if (!supabase) return
      const { error } = await supabase.from('time_logs').insert({
        user_id: p.userId as string,
        project_id: (p.projectId as string) ?? null,
        appointment_id: (p.appointmentId as string) ?? null,
        clock_in: p.clockIn as string,
        clock_out: (p.clockOut as string) ?? null,
        latitude: (p.latitude as number) ?? null,
        longitude: (p.longitude as number) ?? null,
      })
      if (error) throw error
    },
  }

  const sync = useCallback(async () => {
    if (syncing || !navigator.onLine) return
    setSyncing(true)
    try {
      const result = await flushQueue(handlers)
      if (result.synced > 0) {
        setLastSync(new Date().toISOString())
        // Everything the replayed writes touch is now stale.
        void queryClient.invalidateQueries({ queryKey: ['field'] })
        void queryClient.invalidateQueries({ queryKey: ['ops'] })
        void queryClient.invalidateQueries({ queryKey: ['client'] })
      }
    } finally {
      setSyncing(false)
    }
    // `handlers` is rebuilt each render but closes over nothing that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return { queue, pending: queue.length, isOnline, syncing, lastSync, sync }
}

/* ============================================================================
   JOBS
   ========================================================================== */

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
      if (!supabase) throw new Error(NOT_CONNECTED)

      // RLS restricts appointments to those this technician is assigned to, so
      // no user filter is needed — the inner join is only for the crew names.
      const { data, error } = await supabase
        .from('appointments')
        .select(
          '*, appointment_assignees!inner(user_id, profiles!appointment_assignees_user_id_fkey(full_name))',
        )
        .eq('scheduled_date', day)
        .order('time_slot')

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

export function useMySchedule() {
  const { user } = useAuth()

  return useQuery({
    queryKey: fieldKeys.schedule(user?.id),
    enabled: Boolean(user),
    queryFn: async (): Promise<Appointment[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('appointments')
        .select(
          '*, appointment_assignees!inner(user_id, profiles!appointment_assignees_user_id_fkey(full_name))',
        )
        .gte('scheduled_date', localToday())
        .order('scheduled_date')
        .order('time_slot')

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
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('appointments')
        .select(
          '*, appointment_assignees(user_id, profiles!appointment_assignees_user_id_fkey(full_name)), project:projects(*, project_milestones(*)), client:profiles!appointments_client_id_fkey(phone)',
        )
        .eq('id', appointmentId!)
        .maybeSingle()

      if (error) throw error
      if (!data) return null

      const crew = (data.appointment_assignees ?? [])
        .map((a) => a.profiles?.full_name)
        .filter((n): n is string => Boolean(n))

      return {
        appointment: toAppointment(data, crew),
        project: data.project
          ? toProject(data.project, data.project.project_milestones ?? [])
          : null,
        clientPhone: data.client?.phone ?? data.contact_phone ?? null,
      }
    },
  })
}

/* ============================================================================
   THE WRITES
   ========================================================================== */

/**
 * Mark a milestone. The single most important write in the application.
 *
 * Sets an ABSOLUTE state, never a relative one, which is what makes it safe to
 * replay from the offline queue: applying "set to done" twice is harmless,
 * whereas "advance one stage" twice would skip a milestone.
 */
export function useCompleteMilestone() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    /*
     * CRITICAL: TanStack Query defaults to networkMode 'online', which PAUSES a
     * mutation while the browser is offline — the mutationFn is never called at
     * all. That is sensible for an app without its own offline story, but here
     * it silently disabled the entire offline queue: a technician tapped, the
     * mutation was parked in memory, nothing was written to localStorage, and
     * closing the tab lost the work.
     *
     * 'always' hands control to runOrQueue, which is the thing that actually
     * knows how to persist a write for later.
     */
    networkMode: 'always',
    mutationFn: async (input: {
      milestoneId: string
      label: string
      status: 'pending' | 'in_progress' | 'done' | 'blocked'
      note?: string
    }) => {
      const payload = {
        milestoneId: input.milestoneId,
        status: input.status,
        completedAt: input.status === 'done' ? new Date().toISOString() : null,
        userId: input.status === 'done' ? (user?.id ?? null) : null,
        note: input.note ?? null,
      }

      return runOrQueue(
        'milestone_update',
        payload,
        `${input.label} → ${input.status.replace('_', ' ')}`,
        async () => {
          if (!supabase) return
          const { error } = await supabase
            .from('project_milestones')
            .update({
              status: payload.status,
              completed_at: payload.completedAt,
              completed_by: payload.userId,
              note: payload.note,
            })
            .eq('id', input.milestoneId)
          if (error) throw error
        },
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['field'] })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      // The customer is watching the same rows.
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/**
 * Record a scanned serial number.
 *
 * Without this the asset registry has holes, and a warranty claim fails years
 * later when it is far too late to fix. That is why serial capture is a blocking
 * checklist item rather than an optional one.
 */
export function useScanSerial() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    /*
     * CRITICAL: TanStack Query defaults to networkMode 'online', which PAUSES a
     * mutation while the browser is offline — the mutationFn is never called at
     * all. That is sensible for an app without its own offline story, but here
     * it silently disabled the entire offline queue: a technician tapped, the
     * mutation was parked in memory, nothing was written to localStorage, and
     * closing the tab lost the work.
     *
     * 'always' hands control to runOrQueue, which is the thing that actually
     * knows how to persist a write for later.
     */
    networkMode: 'always',
    mutationFn: async (input: {
      serialNumber: string
      productName: string
      projectId: string
      clientId?: string
      stockItemId?: string
      warrantyYears?: number
    }) => {
      const payload = {
        serialNumber: input.serialNumber.trim().toUpperCase(),
        productName: input.productName,
        projectId: input.projectId,
        clientId: input.clientId ?? null,
        stockItemId: input.stockItemId ?? null,
        installedAt: localToday(),
        warrantyYears: input.warrantyYears ?? 10,
        userId: user?.id ?? null,
      }

      return runOrQueue('serial_scan', payload, `Serial ${payload.serialNumber}`, async () => {
        if (!supabase) return
        const { error } = await supabase.from('serialised_assets').insert({
          serial_number: payload.serialNumber,
          product_name: payload.productName,
          stock_item_id: payload.stockItemId,
          project_id: payload.projectId,
          client_id: payload.clientId,
          installed_at: payload.installedAt,
          warranty_years: payload.warrantyYears,
          scanned_by: payload.userId,
        })
        if (error) {
          // A duplicate serial is a real mistake worth surfacing, not a network
          // problem to retry forever.
          if (error.code === '23505') {
            throw new Error(`Serial ${payload.serialNumber} has already been recorded.`)
          }
          throw error
        }
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['field'] })
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/**
 * Log materials actually used on site.
 *
 * Goes through the `consume_project_stock` function, which deducts stock,
 * releases the reservation and writes the movement ledger inside one
 * transaction — and checks that the caller is actually on this project's crew.
 */
export function useLogMaterials() {
  const queryClient = useQueryClient()

  return useMutation({
    /*
     * CRITICAL: TanStack Query defaults to networkMode 'online', which PAUSES a
     * mutation while the browser is offline — the mutationFn is never called at
     * all. That is sensible for an app without its own offline story, but here
     * it silently disabled the entire offline queue: a technician tapped, the
     * mutation was parked in memory, nothing was written to localStorage, and
     * closing the tab lost the work.
     *
     * 'always' hands control to runOrQueue, which is the thing that actually
     * knows how to persist a write for later.
     */
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

      return runOrQueue(
        'material_usage',
        payload,
        `${input.quantity} × ${input.itemName}`,
        async () => {
          if (!supabase) return
          const { error } = await supabase.rpc('consume_project_stock', {
            p_project_id: input.projectId,
            p_stock_item_id: input.stockItemId,
            p_quantity: input.quantity,
          })
          if (error) throw error
        },
      )
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inv'] })
      void queryClient.invalidateQueries({ queryKey: ['field'] })
      // A scanned serial is the customer's warranty record. It belongs on
      // their asset list the moment the technician captures it.
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/* ============================================================================
   TIME LOGS
   ========================================================================== */

export function useMyTimeLogs() {
  const { user } = useAuth()

  return useQuery({
    queryKey: fieldKeys.timeLogs(user?.id),
    enabled: Boolean(user),
    queryFn: async () => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const periodStart = new Date()
      periodStart.setDate(1)

      const { data, error } = await supabase
        .from('time_logs')
        .select('hours, clock_in')
        .gte('clock_in', periodStart.toISOString())

      if (error) throw error

      const total = (data ?? []).reduce((sum, r) => sum + Number(r.hours ?? 0), 0)
      // A standard month is roughly 176 hours; anything beyond is overtime.
      const regular = Math.min(total, 176)

      return {
        regularHours: Math.round(regular * 10) / 10,
        overtimeHours: Math.round(Math.max(total - 176, 0) * 10) / 10,
        jobsCompleted: (data ?? []).length,
      }
    },
  })
}

/**
 * Serial numbers already recorded against a project.
 *
 * The logging screen used to show a hardcoded pair of serials and count them
 * "2 of 14" — a display that never changed no matter what was scanned. This
 * reads the real registry, so a technician can see what they have already done
 * and what is left.
 */
export function useProjectSerials(projectId?: string) {
  return useQuery({
    queryKey: ['field', 'serials', projectId ?? 'none'],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<{ id: string; serialNumber: string; productName: string }[]> => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { data, error } = await supabase
        .from('serialised_assets')
        .select('id, serial_number, product_name')
        .eq('project_id', projectId!)
        .order('created_at', { ascending: true })

      if (error) throw error
      return (data ?? []).map((row) => ({
        id: row.id,
        serialNumber: row.serial_number,
        productName: row.product_name,
      }))
    },
  })
}

/**
 * Close a job, with the customer's acceptance.
 *
 * The button for this had no handler at all, so every visit stayed
 * 'dispatched' for ever and the customer's portal never showed one as finished.
 *
 * Queued like every other field write. The end of a visit — standing in
 * somebody's garden, packing up — is exactly when a technician is least likely
 * to have signal, and asking them to come back to it later means it does not
 * happen.
 */
export function useCompleteJob() {
  const queryClient = useQueryClient()

  return useMutation({
    // See the note on useCompleteMilestone: 'online' would park this in memory
    // and lose it, rather than handing it to the queue.
    networkMode: 'always',
    mutationFn: async (input: { appointmentId: string; signoffName: string }) => {
      const name = input.signoffName.trim()
      if (name.length < 2) {
        throw new Error('Ask the customer for their name before closing the job.')
      }

      const payload = {
        appointmentId: input.appointmentId,
        signoffName: name,
        completedAt: new Date().toISOString(),
      }

      return runOrQueue('job_complete', payload, `Job closed — signed by ${name}`, async () => {
        if (!supabase) return
        const { error } = await supabase
          .from('appointments')
          .update({
            status: 'completed',
            completed_at: payload.completedAt,
            client_signoff_name: name,
            client_signoff_at: payload.completedAt,
          })
          .eq('id', input.appointmentId)
        if (error) throw error
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['field'] })
      void queryClient.invalidateQueries({ queryKey: ['ops'] })
      void queryClient.invalidateQueries({ queryKey: ['client'] })
    },
  })
}

/**
 * Change your own password.
 *
 * `auth.updateUser` acts on the signed-in session and nothing else, so this
 * cannot be pointed at another account however the argument is tampered with —
 * which is why the technician's own portal is a safe place to offer it.
 *
 * Deliberately NOT queued for offline replay. Every other write in this portal
 * is, because a job logged on a roof must not be lost; a password is the
 * opposite case. Replaying one later would change the account at an
 * unpredictable moment, and Supabase would reject the stale token anyway.
 */
export function useChangePassword() {
  return useMutation({
    networkMode: 'online',
    mutationFn: async (input: { password: string }) => {
      if (!supabase) throw new Error(NOT_CONNECTED)

      const { error } = await supabase.auth.updateUser({ password: input.password })
      if (error) throw error
    },
  })
}
