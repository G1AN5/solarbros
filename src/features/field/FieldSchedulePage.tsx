import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import { date, humanize } from '@/lib/format'
import { APPOINTMENT_STATUS_TONE, APPOINTMENT_TYPE_LABEL } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { useMySchedule } from '@/lib/queries/field'

/* ============================================================================
   FieldSchedulePage — the technician's upcoming week.
   ----------------------------------------------------------------------------
   Read-only. Assignments are made by a coordinator on /admin/dispatch and
   pushed here; a technician cannot self-assign, because dispatch has to balance
   the whole crew's load and travel routes.

   Grouped by date rather than shown as a calendar grid: on a phone, a
   chronological list is far easier to scan than a month view.
   ========================================================================== */

export function FieldSchedulePage() {
  const scheduleQuery = useMySchedule()
  const mine = scheduleQuery.data ?? []

  // Group by date so each day gets one heading.
  const byDate = mine.reduce<Record<string, typeof mine>>((groups, appt) => {
    ;(groups[appt.date] ??= []).push(appt)
    return groups
  }, {})

  const dates = Object.keys(byDate).sort()

  return (
    <div className="stack">
      <div>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Schedule</h1>
        <p className="small muted">Your assigned jobs for the coming days.</p>
      </div>

      <QueryState
        isLoading={scheduleQuery.isLoading}
        error={scheduleQuery.error as Error | null}
        isEmpty={dates.length === 0}
        emptyIcon="&#128197;"
        emptyTitle="Nothing scheduled"
        emptyMessage="Assignments appear here as the coordinator dispatches them."
      >
        {dates.map((day) => (
          <div key={day}>
            <h3
              style={{
                fontSize: 'var(--text-sm)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
                marginBottom: 'var(--space-2)',
              }}
            >
              {date(day)}
            </h3>

            <div className="stack stack--sm">
              {byDate[day].map((job) => (
                <Link key={job.id} to={`/field/jobs/${job.id}`}>
                  <Card interactive>
                    <CardBody>
                      <div className="row row--between">
                        <span className="small strong">{job.timeSlot}</span>
                        <Badge tone={APPOINTMENT_STATUS_TONE[job.status]}>
                          {humanize(job.status)}
                        </Badge>
                      </div>
                      <div className="strong" style={{ marginTop: 'var(--space-1)' }}>
                        {APPOINTMENT_TYPE_LABEL[job.type]}
                      </div>
                      <div className="small muted">{job.clientName}</div>
                      <div className="xs dim">📍 {job.address}</div>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </QueryState>

      <Card>
        <CardBody>
          <p className="xs dim">
            Schedules are set by the dispatch coordinator. If you cannot make an assignment, contact
            the office rather than swapping directly with a colleague — inventory and client
            notifications are tied to the assignment.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
