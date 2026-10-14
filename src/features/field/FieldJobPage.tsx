import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Progress } from '@/components/ui/Progress'
import { checklistSummary, parseChecklistSummary } from '@/lib/checklist'
import { dateTime } from '@/lib/format'
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_TONE,
  APPOINTMENT_TYPE_LABEL,
} from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import {
  clockInFor,
  useCompleteJob,
  useCompleteMilestone,
  useJob,
  useOfflineQueue,
  useStartJob,
} from '@/lib/queries/field'

/* ============================================================================
   FieldJobPage — the job screen a technician works from all day.
   ----------------------------------------------------------------------------
   THIS SCREEN IS THE SOURCE OF TRUTH FOR PROJECT PROGRESS.

   When a technician taps a milestone here, that single write fans out:
       → /admin/projects       operations see the update
       → /portal/project       the customer's progress bar moves
       → notifications         milestone email/SMS fires to the client

   Progress should be reported by the person who actually did the work,
   standing at the site, not by an office keying in what they were told.

   THE DAY ON ONE SCREEN, IN ORDER
     1. Start the job     — the visit shows "in progress" to the office and the
                            customer, and the clock starts for the timesheet
     2. Work the checklist and move the milestones
     3. Close the job     — the customer's printed name, the checklist result
                            and the hours are all recorded in one go

   OFFLINE: every write is queued on the phone and replayed on reconnect.
   ========================================================================== */

const CHECKLISTS: Record<string, string[]> = {
  installation: [
    'Site safety briefing completed with crew',
    'Fall-arrest anchors installed and inspected',
    'Roof condition photographed before work',
    'Racking rails aligned and torqued to spec',
    'Panels mounted and clamps torqued',
    'Panel serial numbers scanned',
    'DC strings tested — open-circuit voltage recorded',
    'Inverter mounted and DC connections made',
    'AC connection to main panel completed',
    'System energised and production confirmed',
    'Work area cleaned and materials removed',
    'Client walkthrough completed and signed off',
  ],
  site_survey: [
    'Roof dimensions measured and recorded',
    'Roof orientation and tilt noted',
    'Shading assessment completed',
    'Structural condition assessed and photographed',
    'Main electrical panel inspected — spare breaker capacity confirmed',
    'Proposed inverter location identified',
    'Cable route measured',
    'Client expectations discussed and recorded',
  ],
  maintenance: [
    'Panels visually inspected for damage or soiling',
    'Panels cleaned',
    'All DC and AC connections torque-checked',
    'Inverter error log downloaded and reviewed',
    'Production compared against expected output',
    'Mounting hardware inspected for corrosion',
    'Findings recorded and client briefed',
  ],
  repair: [
    'Fault reproduced or error code recorded',
    'System isolated safely before work',
    'Faulty component identified (serial noted if replaced)',
    'Repair carried out and connections re-checked',
    'System re-energised and production confirmed',
    'Client briefed on what was found and done',
  ],
}

/* The ticks are kept on the phone per job, so a reload — or the battery
   dying on a roof — does not lose the morning's checklist. The result goes
   into the visit record when the job is closed, and a closed job reads its
   ticks back from there (src/lib/checklist.ts). */
const CHECK_KEY = 'solarbros.job-checklist'

function loadChecked(jobId: string): number[] {
  try {
    const all = JSON.parse(localStorage.getItem(CHECK_KEY) ?? '{}') as Record<string, number[]>
    return all[jobId] ?? []
  } catch {
    return []
  }
}

function saveChecked(jobId: string, indexes: number[] | null) {
  try {
    const all = JSON.parse(localStorage.getItem(CHECK_KEY) ?? '{}') as Record<string, number[]>
    if (indexes === null) delete all[jobId]
    else all[jobId] = indexes
    localStorage.setItem(CHECK_KEY, JSON.stringify(all))
  } catch {
    // Storage refused: the ticks still work for this visit, they just will
    // not survive a reload.
  }
}

/** Ask the phone where we are, without ever waiting long for it. */
function currentPosition(): Promise<{ latitude?: number; longitude?: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({})
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => resolve({}),
      { timeout: 5000, maximumAge: 60_000 },
    )
  })
}

export function FieldJobPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const jobQuery = useJob(jobId)
  const completeMilestone = useCompleteMilestone()
  const completeJob = useCompleteJob()
  const startJob = useStartJob()
  const [signoffName, setSignoffName] = useState('')
  const [closedNote, setClosedNote] = useState<string | null>(null)
  /** Waiting for the phone's position, which can take seconds before the start is sent. */
  const [locating, setLocating] = useState(false)
  const { isOnline } = useOfflineQueue()

  const [checked, setChecked] = useState<Set<number>>(
    () => new Set(jobId ? loadChecked(jobId) : []),
  )
  /** The milestone whose write is in flight, so only that row shows a spinner. */
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const jobStatus = jobQuery.data?.appointment?.status
  useEffect(() => {
    // A finished job's ticks live on its record, not on this phone.
    if (jobId && jobStatus !== 'completed') saveChecked(jobId, [...checked])
  }, [jobId, jobStatus, checked])

  const job = jobQuery.data?.appointment
  const project = jobQuery.data?.project
  const milestones = project?.milestones ?? []
  const clockIn = jobId ? clockInFor(jobId) : undefined

  if (jobQuery.isLoading || jobQuery.error || !job) {
    return (
      <QueryState
        isLoading={jobQuery.isLoading}
        error={jobQuery.error as Error | null}
        isEmpty={!job}
        emptyIcon="&#128269;"
        emptyTitle="Job not found"
        emptyMessage="This job may have been reassigned. Check your Today list."
      >
        {null}
      </QueryState>
    )
  }

  const phone = jobQuery.data?.clientPhone || job.contactPhone
  const checklist = CHECKLISTS[job.type] ?? CHECKLISTS.installation
  const isClosed = job.status === 'completed' || closedNote !== null
  const isStarted = job.status === 'in_progress' || Boolean(clockIn)
  /* Closed: the ticks the record holds. Until the closed visit has reloaded,
     the ticks still on screen are the ones just recorded. */
  const recorded = isClosed ? parseChecklistSummary(job.notes, checklist) : null
  const ticks = recorded ?? checked
  const progress = ticks.size / checklist.length

  function toggleItem(index: number) {
    setChecked((previous) => {
      const next = new Set(previous)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  /**
   * Advance a milestone: pending -> in progress -> done -> pending.
   *
   * THIS IS THE MOST CONSEQUENTIAL TAP IN THE APPLICATION. Marking one done
   * fires database triggers that move the customer's progress bar, email them,
   * raise the next staged invoice at the billing stages, and close the project
   * at turnover. None of that logic is in this file.
   */
  function cycleMilestone(milestoneId: string, currentStatus: string, label: string) {
    const next =
      currentStatus === 'pending'
        ? 'in_progress'
        : currentStatus === 'in_progress'
          ? 'done'
          : 'pending'

    setPendingKey(milestoneId)
    completeMilestone.mutate(
      { milestoneId, label, status: next as 'pending' | 'in_progress' | 'done' },
      { onSettled: () => setPendingKey(null) },
    )
  }

  async function handleStart() {
    if (!job) return
    setLocating(true)
    const position = await currentPosition()
    setLocating(false)
    startJob.mutate({ appointmentId: job.id, projectId: job.projectId ?? null, ...position })
  }

  function handleClose() {
    if (!job) return
    /* The checklist result goes onto the visit record, where the office and
       the customer can both read it, rather than staying on this phone. */
    const summary = checklistSummary(checklist, checked)
    const notes = job.notes ? `${job.notes}\n\n${summary}` : summary

    completeJob.mutate(
      { appointmentId: job.id, projectId: job.projectId ?? null, signoffName, notes },
      {
        onSuccess: (result) => {
          saveChecked(job.id, null)
          setClosedNote(
            result?.queued
              ? `Closed on this phone and signed by ${signoffName}. It will reach the office when you have signal.`
              : `Job closed and signed by ${signoffName}. The customer can see it as completed.`,
          )
        },
      },
    )
  }

  return (
    <div className="stack">
      <Link to="/field" className="small muted">
        ← Today
      </Link>

      {/* ------------------------------------------------- JOB HEADER */}
      <Card>
        <CardBody>
          <div className="row row--between">
            <span className="strong">{job.timeSlot}</span>
            <Badge tone={APPOINTMENT_STATUS_TONE[job.status]}>
              {APPOINTMENT_STATUS_LABEL[job.status]}
            </Badge>
          </div>
          <h2 style={{ fontSize: 'var(--text-lg)', marginTop: 'var(--space-2)' }}>
            {APPOINTMENT_TYPE_LABEL[job.type]}
          </h2>
          <p className="strong">{job.clientName}</p>
          <p className="small muted">📍 {job.address || 'Address not recorded — call ahead'}</p>
          {project && <p className="xs dim">Project {project.reference}</p>}
          {job.notes && (
            <p className="small" style={{ marginTop: 'var(--space-2)', whiteSpace: 'pre-wrap' }}>
              {job.notes}
            </p>
          )}

          <div className="row" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
            <a
              className="btn btn--outline btn--sm btn--block"
              href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
              target="_blank"
              rel="noreferrer"
            >
              🧭 Navigate
            </a>
            {phone ? (
              <a className="btn btn--outline btn--sm btn--block" href={`tel:${phone}`}>
                📞 Call
              </a>
            ) : (
              <Button variant="outline" size="sm" block disabled>
                📞 No phone on file
              </Button>
            )}
          </div>

          {/* Straight to this job on the logging screen — before or after it
              is closed, since photos and serials often follow the visit. */}
          <Link
            className="btn btn--outline btn--sm btn--block"
            to={`/field/logging?job=${job.id}`}
            style={{ marginTop: 'var(--space-2)' }}
          >
            📷 Photos, serials &amp; materials
          </Link>

          {/* ------------------------------------------- ARRIVED ON SITE */}
          {!isClosed && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              {isStarted ? (
                <p className="xs dim">
                  {clockIn
                    ? `On site since ${dateTime(clockIn.at)} — your hours stop when you close the job.`
                    : 'In progress.'}
                </p>
              ) : (
                <Button
                  variant="primary"
                  block
                  disabled={locating || startJob.isPending}
                  onClick={() => void handleStart()}
                >
                  {locating
                    ? 'Finding your location…'
                    : startJob.isPending
                      ? 'Starting…'
                      : '▶ I have arrived — start the job'}
                </Button>
              )}
              <FormError error={startJob.error} />
            </div>
          )}
        </CardBody>
      </Card>

      {/* -------------------------------------------- STAGE CHECKLIST */}
      <Card>
        <CardBody>
          <div className="row row--between" style={{ marginBottom: 'var(--space-3)' }}>
            <h3 style={{ fontSize: 'var(--text-base)' }}>Checklist</h3>
            <span className="small dim">
              {ticks.size}/{checklist.length}
            </span>
          </div>

          <Progress value={progress} tone={progress === 1 ? 'success' : 'brand'} />

          <div style={{ marginTop: 'var(--space-4)' }}>
            {checklist.map((item, index) => (
              <div
                key={item}
                className={`checklist__item${ticks.has(index) ? ' is-done' : ''}`}
                onClick={() => !isClosed && toggleItem(index)}
                role="checkbox"
                aria-checked={ticks.has(index)}
                aria-disabled={isClosed}
                tabIndex={isClosed ? -1 : 0}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isClosed) {
                    e.preventDefault()
                    toggleItem(index)
                  }
                }}
              >
                {/* The mark is drawn only on a ticked item. An invisible one on
                    every item showed up as a column of ticks whenever the
                    text was selected. */}
                <span className="checklist__box" aria-hidden>
                  {ticks.has(index) ? '✓' : ''}
                </span>
                <span className="small">{item}</span>
              </div>
            ))}
          </div>

          <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
            {!isClosed
              ? 'Your ticks are kept on this phone until you close the job, then recorded on the visit for the office and the customer.'
              : recorded || closedNote
                ? 'Recorded on the visit when the job was closed. The office and the customer see the same result.'
                : 'This visit was closed without a checklist result on its record.'}
          </p>
        </CardBody>
      </Card>

      {/* ---------------------------------------- MILESTONE UPDATER
          Only a job with a project has stages. A survey or a consultation
          happens before there is anything to build. */}
      {project && (
        <Card>
          <CardBody>
            <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-2)' }}>
              Project milestones
            </h3>
            <p className="xs dim" style={{ marginBottom: 'var(--space-3)' }}>
              Tap to advance. The client sees this update on their portal immediately.
            </p>

            <div className="stack stack--sm">
              {milestones.map((milestone) => {
                const id = milestone.id
                const busy = pendingKey === id
                return (
                  <button
                    key={milestone.key}
                    className="row row--between"
                    // Without a row id there is nothing to update. Disabling is
                    // honest; firing a write that matches no rows is not.
                    disabled={busy || !id}
                    onClick={() => id && cycleMilestone(id, milestone.status, milestone.label)}
                    style={{
                      width: '100%',
                      padding: 'var(--space-3)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background:
                        milestone.status === 'done'
                          ? 'var(--success-bg)'
                          : milestone.status === 'in_progress'
                            ? 'var(--warning-bg)'
                            : milestone.status === 'blocked'
                              ? 'var(--danger-bg)'
                              : 'var(--bg-surface)',
                      textAlign: 'left',
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    <span className="small strong">{milestone.label}</span>
                    <span>
                      {busy && '⏳'}
                      {!busy && milestone.status === 'done' && '✅'}
                      {!busy && milestone.status === 'in_progress' && '🔨'}
                      {!busy && milestone.status === 'pending' && '⬜'}
                      {!busy && milestone.status === 'blocked' && '⛔'}
                    </span>
                  </button>
                )
              })}
            </div>

            <FormError error={completeMilestone.error} />

            {/* A technician needs to know whether the office has actually seen
                the update, not just whether the button worked. */}
            {!isOnline && (
              <p
                className="xs"
                style={{
                  marginTop: 'var(--space-3)',
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--warning-bg)',
                  color: 'var(--warning-fg)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                Offline — your taps are saved on this phone and will send themselves when you have
                signal.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------- CLIENT SIGN-OFF */}
      <Card>
        <CardBody>
          <h3 style={{ fontSize: 'var(--text-base)' }}>Client sign-off</h3>

          {isClosed ? (
            <p
              className="small"
              style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-3)',
                background: 'var(--success-bg)',
                color: 'var(--success-fg)',
                borderRadius: 'var(--radius)',
              }}
            >
              ✓{' '}
              {closedNote ??
                `Completed${job.signoffName ? ` and signed by ${job.signoffName}` : ''}${
                  job.completedAt ? ` on ${dateTime(job.completedAt)}` : ''
                }.`}
            </p>
          ) : (
            <>
              {/* A printed name, given by the customer standing in front of the
                  technician, recorded with the server's timestamp. It replaced a
                  "signature capture" box that captured nothing. */}
              <p className="xs dim" style={{ marginBlock: 'var(--space-2)' }}>
                Ask the customer to check the work, then type the name they give you. Their name and
                the time are recorded against this visit as their acceptance.
              </p>

              <div className="field" style={{ marginTop: 'var(--space-3)' }}>
                <input
                  className="input"
                  placeholder="Customer's full name"
                  value={signoffName}
                  onChange={(e) => setSignoffName(e.target.value)}
                  autoComplete="off"
                />
              </div>

              <FormError error={completeJob.error} />

              <Button
                variant="primary"
                block
                size="lg"
                style={{ marginTop: 'var(--space-3)' }}
                disabled={completeJob.isPending || signoffName.trim().length < 2}
                onClick={handleClose}
              >
                {completeJob.isPending ? 'Closing…' : 'Complete job & sync'}
              </Button>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
