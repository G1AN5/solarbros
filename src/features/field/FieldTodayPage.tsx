import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { date, humanize } from '@/lib/format'
import { APPOINTMENT_STATUS_TONE, APPOINTMENT_TYPE_LABEL } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { localToday, useMyJobs, useOfflineQueue } from '@/lib/queries/field'

/* ============================================================================
   FieldTodayPage — the technician's daily job list. THE app's home screen for
   anyone working on a roof.
   ----------------------------------------------------------------------------
   MOBILE-FIRST DESIGN RULES APPLIED HERE
     • Big tap targets — gloved hands, bright sunlight.
     • Address and phone are ONE TAP to maps/dialler, not buried in a detail page.
     • Minimum text, maximum contrast.
     • Everything needed for the day loads at once so the screen still works
       when signal drops out at the site.

   Jobs arrive here from /admin/dispatch when a coordinator assigns this
   technician. Nothing is self-assigned.
   ========================================================================== */

export function FieldTodayPage() {
  const today = localToday()
  // RLS already limits appointments to those this technician is assigned
  // to, so the query needs no filter of its own.
  const jobsQuery = useMyJobs(today)
  const { pending, isOnline } = useOfflineQueue()
  const jobs = jobsQuery.data ?? []

  return (
    <div className="stack">
      <div>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Today</h1>
        <p className="small muted">
          {date(today)} · {jobs.length} job{jobs.length === 1 ? '' : 's'} assigned
        </p>
      </div>

      <QueryState
        isLoading={jobsQuery.isLoading}
        error={jobsQuery.error as Error | null}
        isEmpty={jobs.length === 0}
        emptyIcon="&#127780;"
        emptyTitle="No jobs today"
        emptyMessage="Check the Schedule tab for upcoming assignments."
      >
        {jobs.map((job) => (
          <Card key={job.id} interactive>
            <CardBody>
              <div className="row row--between">
                <span className="strong">{job.timeSlot}</span>
                <Badge tone={APPOINTMENT_STATUS_TONE[job.status]}>{humanize(job.status)}</Badge>
              </div>

              <h3 style={{ fontSize: 'var(--text-lg)', marginTop: 'var(--space-2)' }}>
                {APPOINTMENT_TYPE_LABEL[job.type]}
              </h3>
              <p className="strong">{job.clientName}</p>
              <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                📍 {job.address}
              </p>

              {job.notes && (
                <p
                  className="small"
                  style={{
                    marginTop: 'var(--space-3)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'var(--warning-bg)',
                    color: 'var(--warning-fg)',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  📌 {job.notes}
                </p>
              )}

              {job.assignedTo.length > 1 && (
                <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                  Crew: {job.assignedTo.join(', ')}
                </p>
              )}

              {/* Primary action is full-width and unmissable. */}
              <Link
                to={`/field/jobs/${job.id}`}
                className="btn btn--primary btn--block btn--lg"
                style={{ marginTop: 'var(--space-4)' }}
              >
                Open job →
              </Link>

              {/* Secondary actions: one tap to navigate or call. */}
              <div className="row" style={{ marginTop: 'var(--space-2)', gap: 'var(--space-2)' }}>
                <a
                  className="btn btn--outline btn--block"
                  href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  🧭 Navigate
                </a>
                {job.contactPhone ? (
                  <a className="btn btn--outline btn--block" href={`tel:${job.contactPhone}`}>
                    📞 Call client
                  </a>
                ) : (
                  <Button variant="outline" block disabled>
                    📞 No phone on file
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </QueryState>

      {/* Daily summary keeps the technician oriented without a separate screen. */}
      <Card>
        <CardBody>
          <h4 style={{ fontSize: 'var(--text-base)' }}>Today at a glance</h4>
          <div className="stack stack--sm" style={{ marginTop: 'var(--space-3)' }}>
            <div className="row row--between small">
              <span className="muted">Jobs assigned</span>
              <span className="strong">{jobs.length}</span>
            </div>
            <div className="row row--between small">
              <span className="muted">Completed</span>
              <span className="strong">{jobs.filter((j) => j.status === 'completed').length}</span>
            </div>
            <div className="row row--between small">
              <span className="muted">Pending sync</span>
              <span
                className="strong"
                style={{ color: pending > 0 ? 'var(--warning-fg)' : 'var(--success-fg)' }}
              >
                {pending === 0 ? 'All synced' : `${pending} update${pending === 1 ? '' : 's'}`}
              </span>
            </div>
            <div className="row row--between small">
              <span className="muted">Connection</span>
              <span
                className="strong"
                style={{ color: isOnline ? 'var(--success-fg)' : 'var(--danger-fg)' }}
              >
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
