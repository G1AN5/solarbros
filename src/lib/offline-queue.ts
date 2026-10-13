/* ============================================================================
   OFFLINE WRITE QUEUE
   ----------------------------------------------------------------------------
   A durable queue for writes made by technicians who have no signal.

   WHY THIS IS NOT OPTIONAL
   The field portal is used on rooftops, in warehouses, and in parts of Rizal and
   Batangas where mobile data simply stops. A technician who taps "DC Wiring
   complete" and sees it silently fail has done the work twice: once on the roof,
   once again at the office that evening from memory. In practice they stop using
   the app, and the customer's tracker goes stale — which is the one thing the
   whole system promises not to do.

   HOW IT WORKS
   Writes go through `runOrQueue()`. When online, it performs the write directly.
   When offline — or when the write fails for a network reason — the action is
   appended to localStorage and the caller is told it was queued rather than
   failed. On reconnect, `flushQueue()` replays them oldest-first.

   WHAT IS DELIBERATELY NOT QUEUED
   Photographs. A phone photo is several megabytes; base64-encoding a dozen of
   them into localStorage would blow past the 5 MB quota and lose the lot. Photos
   need connectivity, and the UI says so plainly rather than pretending.

   IDEMPOTENCE
   Each action carries a client-generated id. Replaying a milestone update is
   safe because it sets an absolute state ("done"), not a relative one
   ("advance by one"). That is a deliberate constraint on what may be queued:
   only writes that can be applied twice without harm.

   WHY localStorage AND NOT IndexedDB
   The payloads are small JSON objects and the queue is short — a day's work is
   perhaps thirty actions. IndexedDB would be the right answer for photos or
   thousands of rows; for this, it is a great deal of machinery for no benefit.
   ========================================================================== */

const QUEUE_KEY = 'solarbros.offline-queue'
const MAX_ATTEMPTS = 5

export type QueuedActionType =
  | 'milestone_update'
  | 'serial_scan'
  | 'material_usage'
  | 'checklist_item'
  | 'time_log'
  /* Arriving on site: the visit moves to in progress and the clock starts. */
  | 'job_start'
  /* Closing a job. Queued like everything else, because the moment a technician
     is most likely to have no signal is standing in a customer's garden at the
     end of the visit. */
  | 'job_complete'

export interface QueuedAction {
  id: string
  type: QueuedActionType
  payload: Record<string, unknown>
  queuedAt: string
  attempts: number
  /** Human-readable, so the sync panel can say what is waiting. */
  label: string
}

/* --- Storage -------------------------------------------------------------- */

/*
 * Cached snapshot. This is NOT an optimisation — it is required for
 * correctness.
 *
 * `getQueue` is the snapshot function for useSyncExternalStore, which compares
 * snapshots by REFERENCE to decide whether to re-render. Parsing the JSON afresh
 * on every call returns a new array each time, so React concludes the store
 * changed on every render, re-renders, calls the snapshot again, and loops until
 * it throws "Maximum update depth exceeded" (React error #185).
 *
 * Caching against the raw string means the reference only changes when the
 * stored value genuinely does.
 */
let cachedRaw: string | null = null
let cachedQueue: QueuedAction[] = []

export function getQueue(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY) ?? '[]'
    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedQueue = JSON.parse(raw) as QueuedAction[]
    }
    return cachedQueue
  } catch {
    // Corrupted JSON or a locked-down browser. Return the last good snapshot,
    // which is a stable reference, rather than a fresh empty array that would
    // reintroduce the loop above.
    return cachedQueue
  }
}

function writeQueue(actions: QueuedAction[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(actions))
  } catch {
    // Quota exceeded or private browsing. Nothing useful to do here — the
    // caller has already been told the write was queued, and losing it is
    // better than throwing mid-job.
  }
  notify()
}

export function enqueue(
  type: QueuedActionType,
  payload: Record<string, unknown>,
  label: string,
): QueuedAction {
  const action: QueuedAction = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    label,
  }
  writeQueue([...getQueue(), action])
  return action
}

function removeFromQueue(id: string) {
  writeQueue(getQueue().filter((a) => a.id !== id))
}

function bumpAttempts(id: string) {
  writeQueue(getQueue().map((a) => (a.id === id ? { ...a, attempts: a.attempts + 1 } : a)))
}

export function clearQueue() {
  writeQueue([])
}

/* --- What could not be synced --------------------------------------------- */

/* An action the server refused (a stage done out of order, a duplicate
   serial) is dropped from the queue so it cannot block everything behind it.
   It used to be dropped into the browser console, where no technician will
   ever look — so it was lost silently, which the header of this file says is
   the one thing this queue must never do. They are now kept, with the reason,
   for the Account screen to show until the technician has read them. */

const FAILED_KEY = 'solarbros.offline-failed'

export interface FailedAction {
  id: string
  label: string
  reason: string
  failedAt: string
}

let cachedFailedRaw: string | null = null
let cachedFailed: FailedAction[] = []

export function getFailedActions(): FailedAction[] {
  try {
    const raw = localStorage.getItem(FAILED_KEY) ?? '[]'
    if (raw !== cachedFailedRaw) {
      cachedFailedRaw = raw
      cachedFailed = JSON.parse(raw) as FailedAction[]
    }
    return cachedFailed
  } catch {
    return cachedFailed
  }
}

function recordFailure(action: QueuedAction, error: unknown) {
  const reason = error instanceof Error ? error.message : String(error)
  const next = [
    { id: action.id, label: action.label, reason, failedAt: new Date().toISOString() },
    ...getFailedActions(),
  ].slice(0, 20)
  try {
    localStorage.setItem(FAILED_KEY, JSON.stringify(next))
  } catch {
    // Nothing more can be done; the console line below still records it.
  }
  notify()
}

export function dismissFailedActions() {
  try {
    localStorage.removeItem(FAILED_KEY)
  } catch {
    // Locked-down storage: there is nothing to dismiss anyway.
  }
  notify()
}

/* --- Subscriptions -------------------------------------------------------- */

type Listener = () => void
const listeners = new Set<Listener>()

function notify() {
  listeners.forEach((l) => l())
}

export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/* --- Execution ------------------------------------------------------------ */

/** Handlers are supplied by the query layer, which owns the Supabase client. */
export type ActionHandlers = Record<
  QueuedActionType,
  (payload: Record<string, unknown>) => Promise<void>
>

/**
 * Is this failure worth retrying?
 *
 * A network error will succeed later. A constraint violation or a permission
 * denial will fail identically every time, and retrying it forever would keep a
 * poisoned action at the head of the queue, blocking everything behind it.
 */
export function isRetryable(error: unknown): boolean {
  /* The error layer marks a request that never arrived (db-error.ts). Read
     that first: in a production build the message itself has been rewritten
     for the person reading it, and no longer says "fetch" or "network". */
  if (error && typeof error === 'object' && 'retryable' in error) {
    return Boolean((error as { retryable?: unknown }).retryable)
  }

  // A raw browser error that never went through the error layer.
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('timeout')
  )
}

export interface FlushResult {
  synced: number
  failed: number
  remaining: number
}

/**
 * Replay everything waiting, oldest first.
 *
 * Order matters: a serial scan for a project should land after the milestone
 * that created the context for it, and a technician's own actions read more
 * sensibly in the audit log in the order they actually happened.
 */
export async function flushQueue(handlers: ActionHandlers): Promise<FlushResult> {
  if (!navigator.onLine) {
    return { synced: 0, failed: 0, remaining: getQueue().length }
  }

  let synced = 0
  let failed = 0

  for (const action of getQueue()) {
    try {
      await handlers[action.type](action.payload)
      removeFromQueue(action.id)
      synced++
    } catch (error) {
      if (!isRetryable(error) || action.attempts + 1 >= MAX_ATTEMPTS) {
        // Give up on this one rather than blocking the queue behind it. It is
        // dropped from the queue but recorded in the console, because silently
        // discarding a technician's work is worse than a noisy failure.
        console.error(
          `[SolarBros] Discarding unsyncable action "${action.label}" after ${action.attempts + 1} attempts:`,
          error,
        )
        recordFailure(action, error)
        removeFromQueue(action.id)
        failed++
      } else {
        bumpAttempts(action.id)
        failed++
      }
    }
  }

  return { synced, failed, remaining: getQueue().length }
}

/**
 * Perform a write, or queue it if that is not currently possible.
 *
 * Returns whether it went through immediately, so the UI can say "saved" versus
 * "saved on your phone, will sync" — a distinction a technician standing on a
 * roof genuinely needs to know.
 */
export async function runOrQueue(
  type: QueuedActionType,
  payload: Record<string, unknown>,
  label: string,
  run: () => Promise<void>,
): Promise<{ queued: boolean }> {
  if (!navigator.onLine) {
    enqueue(type, payload, label)
    return { queued: true }
  }

  try {
    await run()
    return { queued: false }
  } catch (error) {
    if (isRetryable(error)) {
      enqueue(type, payload, label)
      return { queued: true }
    }
    // A permission or constraint failure is a real error the technician should
    // see, not something to hide in a queue that will never drain.
    throw error
  }
}
