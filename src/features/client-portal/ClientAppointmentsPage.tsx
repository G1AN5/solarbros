import { type FormEvent, useState } from 'react'

import { FormError } from '@/components/ui/FormError'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { date, humanize } from '@/lib/format'
import { APPOINTMENT_STATUS_TONE, APPOINTMENT_TYPE_LABEL } from '@/lib/labels'
import {
  useCancelAppointment,
  useMyAppointments,
  useRequestAppointment,
} from '@/lib/queries/client-portal'

/* ============================================================================
   ClientAppointmentsPage — the client-side view of the shared scheduling system.
   ----------------------------------------------------------------------------
   Same `appointments` table as the public /booking page and the admin dispatch
   board — a different slice of it. The difference from the public page is WHAT
   a signed-in client may book:

     public /booking          → consultations and surveys only (pre-sale)
     THIS PAGE                → installation dates and maintenance visits,
                                because the client has an active project

   Cancellation and reschedule requests write back to the same rows, and the
   change surfaces immediately on /admin/dispatch for the coordinator.
   ========================================================================== */

export function ClientAppointmentsPage() {
  const requestVisit = useRequestAppointment()
  const cancelVisit = useCancelAppointment()
  const [requested, setRequested] = useState(false)

  /* This form used to be `onSubmit={(e) => e.preventDefault()}` — a complete
     booking form that saved nothing and did not even acknowledge the press.
     The customer had no way to ask for a maintenance visit at all. */
  function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formEl = event.currentTarget
    const form = new FormData(formEl)

    requestVisit.mutate(
      {
        type: String(form.get('visitType') ?? 'maintenance') as 'maintenance',
        date: String(form.get('prefDate') ?? ''),
        timeSlot: String(form.get('prefTime') ?? '09:00'),
        notes: String(form.get('visitNotes') ?? ''),
      },
      {
        onSuccess: () => {
          setRequested(true)
          formEl.reset()
        },
      },
    )
  }

  // RLS already scopes appointments to the signed-in customer.
  const appointmentsQuery = useMyAppointments()
  const mine = appointmentsQuery.data ?? []

  const upcoming = mine.filter((a) => a.status !== 'completed' && a.status !== 'cancelled')
  const past = mine.filter((a) => a.status === 'completed' || a.status === 'cancelled')

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Installation visits, maintenance calls and consultations."
        breadcrumbs={[{ label: 'Portal', to: '/portal' }, { label: 'Appointments' }]}
        actions={
          /* The request form is already on this page, below the fold on a
             phone. The button used to do nothing at all; scrolling to the form
             and focusing the first field is what a customer expected it to do
             all along. */
          <Button
            variant="primary"
            onClick={() => {
              const form = document.getElementById('request-visit')
              form?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              document.getElementById('prefDate')?.focus({ preventScroll: true })
            }}
          >
            Book a maintenance visit
          </Button>
        }
      />

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <Card>
            <CardHeader
              title="Upcoming"
              action={<Badge tone="info">{upcoming.length} scheduled</Badge>}
            />
            <CardBody>
              {upcoming.length === 0 ? (
                <EmptyState
                  icon="📅"
                  title="Nothing scheduled"
                  message="Book a maintenance visit or contact your engineer."
                />
              ) : (
                <div className="stack">
                  {upcoming.map((appt) => (
                    <div
                      key={appt.id}
                      style={{
                        padding: 'var(--space-4)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        borderLeft: '3px solid var(--brand-500)',
                      }}
                    >
                      <div className="row row--between">
                        <span className="strong">{APPOINTMENT_TYPE_LABEL[appt.type]}</span>
                        <Badge tone={APPOINTMENT_STATUS_TONE[appt.status]}>
                          {humanize(appt.status)}
                        </Badge>
                      </div>
                      <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                        📅 {date(appt.date)} · {appt.timeSlot}
                      </div>
                      <div className="small muted">📍 {appt.address}</div>
                      {appt.assignedTo.length > 0 && (
                        <div className="small muted">👷 {appt.assignedTo.join(', ')}</div>
                      )}
                      {appt.notes && (
                        <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                          {appt.notes}
                        </p>
                      )}
                      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
                        {/* Rescheduling is cancel-then-rebook rather than a
                            separate flow: moving a visit means re-checking crew
                            availability, which is the coordinator's job, and a
                            half-working reschedule that silently double-books is
                            worse than an honest two-step. */}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={cancelVisit.isPending}
                          onClick={() =>
                            cancelVisit.mutate({
                              appointmentId: appt.id,
                              reason: 'Cancelled by the customer from their portal',
                            })
                          }
                        >
                          {cancelVisit.isPending ? 'Cancelling…' : 'Cancel this visit'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" />
            <CardBody>
              {past.length === 0 ? (
                <p className="small muted">No past appointments yet.</p>
              ) : (
                <div className="stack stack--sm">
                  {past.map((appt) => (
                    <div key={appt.id} className="row row--between small">
                      <span>{APPOINTMENT_TYPE_LABEL[appt.type]}</span>
                      <span className="dim">{date(appt.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ---------------------------------------- BOOK A NEW VISIT */}
        <Card>
          <CardHeader title="Request a visit" id="request-visit" />
          <CardBody>
            <form className="stack" onSubmit={handleRequest}>
              <div className="field">
                <label className="field__label" htmlFor="visitType">
                  What do you need?
                </label>
                <select
                  id="visitType"
                  name="visitType"
                  className="select"
                  defaultValue="maintenance"
                >
                  <option value="maintenance">Preventive maintenance</option>
                  <option value="repair">Emergency repair</option>
                  <option value="virtual_consultation">Virtual consultation</option>
                </select>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="prefDate">
                  Preferred date
                </label>
                <input id="prefDate" name="prefDate" className="input" type="date" required />
                <span className="field__hint">
                  We will confirm against technician availability and email you.
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="prefTime">
                  Preferred time
                </label>
                <select id="prefTime" name="prefTime" className="select" defaultValue="09:00">
                  <option value="09:00">Morning (8:00 AM – 12:00 PM)</option>
                  <option value="13:00">Afternoon (1:00 PM – 5:00 PM)</option>
                  <option value="10:00">Either</option>
                </select>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="visitNotes">
                  Describe the issue
                </label>
                <textarea
                  id="visitNotes"
                  name="visitNotes"
                  className="textarea"
                  placeholder="e.g. output has dropped since last week, inverter showing a warning light"
                />
              </div>

              {requested && (
                <p
                  className="small"
                  style={{
                    padding: 'var(--space-3)',
                    background: 'var(--success-bg)',
                    color: 'var(--success-fg)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  Requested. It is on our dispatch board now — we will confirm the time once a
                  technician is assigned, and you will see it above.
                </p>
              )}

              <FormError error={requestVisit.error} />

              <Button type="submit" variant="primary" block disabled={requestVisit.isPending}>
                {requestVisit.isPending ? 'Sending…' : 'Submit request'}
              </Button>

              <p className="xs dim center">
                Requests appear immediately on our dispatch board. Urgent faults? Raise a support
                ticket instead — those are triaged first.
              </p>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
