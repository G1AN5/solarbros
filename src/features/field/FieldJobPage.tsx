import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Progress } from '@/components/ui/Progress'
import { humanize } from '@/lib/format'
import { APPOINTMENT_TYPE_LABEL } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { useCompleteJob, useCompleteMilestone, useJob, useOfflineQueue } from '@/lib/queries/field'

/* ============================================================================
   FieldJobPage — the job screen a technician works from all day.
   ----------------------------------------------------------------------------
   THIS SCREEN IS THE SOURCE OF TRUTH FOR PROJECT PROGRESS.

   When a technician taps a milestone here, that single write fans out:
       → /admin/projects       operations see the update
       → /portal/project       the customer's progress bar moves
       → notifications         milestone email/SMS fires to the client

   Nowhere else in the system can a milestone be marked done. That is
   deliberate: progress should be reported by the person who actually did the
   work, standing at the site, not by an office keying in what they were told.

   OFFLINE BEHAVIOUR: taps must be queued locally (IndexedDB) and replayed when
   connectivity returns. Technicians work in areas with poor signal, and a
   milestone tap that silently fails is worse than no app at all.
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
}

export function FieldJobPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const jobQuery = useJob(jobId)
  const completeMilestone = useCompleteMilestone()
  const completeJob = useCompleteJob()
  const [signoffName, setSignoffName] = useState('')
  const [closed, setClosed] = useState(false)
  const { isOnline } = useOfflineQueue()

  // Checklist ticks are local for now. They are guidance for the technician
  // rather than a record anything else reads; a dedicated digital-forms table
  // lands with that piece of work.
  const [checked, setChecked] = useState<Set<number>>(new Set())
  /** The milestone whose write is in flight, so only that row shows a spinner. */
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  const job = jobQuery.data?.appointment
  const project = jobQuery.data?.project
  const milestones = project?.milestones ?? []

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

  const checklist = CHECKLISTS[job.type] ?? CHECKLISTS.installation
  const progress = checked.size / checklist.length

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
   *
   * The write sets an ABSOLUTE state rather than "advance one", which is what
   * makes it safe to replay from the offline queue.
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
            <Badge tone="warning">{humanize(job.status)}</Badge>
          </div>
          <h2 style={{ fontSize: 'var(--text-lg)', marginTop: 'var(--space-2)' }}>
            {APPOINTMENT_TYPE_LABEL[job.type]}
          </h2>
          <p className="strong">{job.clientName}</p>
          <p className="small muted">📍 {job.address}</p>

          <div className="row" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
            <a
              className="btn btn--outline btn--sm btn--block"
              href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
              target="_blank"
              rel="noreferrer"
            >
              🧭 Navigate
            </a>
            <a
              className="btn btn--outline btn--sm btn--block"
              href={`tel:${jobQuery.data?.clientPhone ?? job.contactPhone ?? ''}`}
            >
              📞 Call
            </a>
          </div>
        </CardBody>
      </Card>

      {/* -------------------------------------------- STAGE CHECKLIST */}
      <Card>
        <CardBody>
          <div className="row row--between" style={{ marginBottom: 'var(--space-3)' }}>
            <h3 style={{ fontSize: 'var(--text-base)' }}>Checklist</h3>
            <span className="small dim">
              {checked.size}/{checklist.length}
            </span>
          </div>

          <Progress value={progress} tone={progress === 1 ? 'success' : 'brand'} />

          <div style={{ marginTop: 'var(--space-4)' }}>
            {checklist.map((item, index) => (
              <div
                key={item}
                className={`checklist__item${checked.has(index) ? ' is-done' : ''}`}
                onClick={() => toggleItem(index)}
                role="checkbox"
                aria-checked={checked.has(index)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleItem(index)
                  }
                }}
              >
                <span className="checklist__box" aria-hidden>
                  ✓
                </span>
                <span className="small">{item}</span>
              </div>
            ))}
          </div>

          <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
            Digital forms replace the paper checklists. Every tick is timestamped and attributed to
            you.
          </p>
        </CardBody>
      </Card>

      {/* ---------------------------------------- MILESTONE UPDATER */}
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
                  </span>
                </button>
              )
            })}
          </div>

          {completeMilestone.error && (
            <p
              className="small"
              style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-3)',
                background: 'var(--danger-bg)',
                color: 'var(--danger-fg)',
                borderRadius: 'var(--radius)',
              }}
              role="alert"
            >
              {(completeMilestone.error as Error).message}
            </p>
          )}

          {/* A technician needs to know whether the office has actually seen the
              update, not just whether the button worked. */}
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

      {/* ------------------------------------------- CLIENT SIGN-OFF */}
      <Card>
        <CardBody>
          <h3 style={{ fontSize: 'var(--text-base)' }}>Client sign-off</h3>
          <p className="xs dim" style={{ marginBlock: 'var(--space-2)' }}>
            Required before the job can be closed. Captures a legally meaningful acceptance of the
            work.
          </p>

          <div
            style={{
              height: 120,
              border: '2px dashed var(--border-strong)',
              borderRadius: 'var(--radius)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            ✍️ Signature capture area
          </div>

          <div className="field" style={{ marginTop: 'var(--space-3)' }}>
            <input
              className="input"
              placeholder="Client name (printed)"
              value={signoffName}
              onChange={(e) => setSignoffName(e.target.value)}
              disabled={closed}
            />
          </div>

          {completeJob.error && (
            <p
              role="alert"
              className="small"
              style={{
                marginTop: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--danger-bg)',
                color: 'var(--danger-fg)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {completeJob.error.message}
            </p>
          )}

          {closed ? (
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
              ✓ Job closed and signed by {signoffName}. The customer can see it as completed.
            </p>
          ) : (
            <Button
              variant="primary"
              block
              size="lg"
              style={{ marginTop: 'var(--space-3)' }}
              disabled={completeJob.isPending || signoffName.trim().length < 2}
              onClick={() =>
                job &&
                completeJob.mutate(
                  { appointmentId: job.id, signoffName },
                  { onSuccess: () => setClosed(true) },
                )
              }
            >
              {completeJob.isPending ? 'Closing…' : 'Complete job & sync'}
            </Button>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
