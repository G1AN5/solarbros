import { type FormEvent, useState } from 'react'

import { useAuth } from '@/app/auth/useAuth'
import { FormError } from '@/components/ui/FormError'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { date } from '@/lib/format'
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_TONE,
  APPOINTMENT_TYPE_LABEL,
} from '@/lib/labels'
import {
  useCancelAppointment,
  useMyAppointments,
  useMyProject,
  useRequestAppointment,
} from '@/lib/queries/client-portal'
import { useAvailableSlots } from '@/lib/queries/public-forms'

/* ============================================================================
   ClientAppointmentsPage — the client-side view of the shared scheduling system.
   ----------------------------------------------------------------------------
   Same `appointments` table as the public /booking page and the admin dispatch
   board — a different slice of it.

     before a project    → a site survey or a virtual consultation
     with a project      → maintenance and repair visits as well, attached to
                           the project so the crew knows which system it is

   THE TIMES ARE THE BOOKING CALENDAR'S
   The form offered "Morning / Afternoon / Either" mapped to three invented
   times, and any date at all — Sundays, holidays, tomorrow at 8am. It now asks
   the same function the public calendar asks, so a closed day or a full slot
   cannot be requested here either.

   Cancellations write back to the same rows, and the change surfaces at once on
   /admin/dispatch for the coordinator, who is notified.
   ========================================================================== */

type VisitType = 'site_survey' | 'maintenance' | 'repair' | 'virtual_consultation'

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ClientAppointmentsPage() {
  const { user } = useAuth()
  const project = useMyProject().data
  const requestVisit = useRequestAppointment()
  const cancelVisit = useCancelAppointment()

  const [visitType, setVisitType] = useState<VisitType>(project ? 'maintenance' : 'site_survey')
  const [prefDate, setPrefDate] = useState('')
  const [slot, setSlot] = useState<string | null>(null)
  const [requested, setRequested] = useState(false)

  const slotsQuery = useAvailableSlots(prefDate || undefined)
  const slots = slotsQuery.data ?? []
  const anyOpen = slots.some((s) => s.available)

  const types: VisitType[] = project
    ? ['maintenance', 'repair', 'virtual_consultation', 'site_survey']
    : ['site_survey', 'virtual_consultation']

  function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!slot) return
    const formEl = event.currentTarget
    const form = new FormData(formEl)

    requestVisit.mutate(
      {
        type: visitType,
        date: prefDate,
        timeSlot: slot,
        // A maintenance or repair visit is ABOUT the installed system; the
        // crew needs the project to know which one and where.
        projectId: project && visitType !== 'site_survey' ? project.id : undefined,
        address: String(form.get('address') ?? '') || undefined,
        notes: String(form.get('visitNotes') ?? ''),
      },
      {
        onSuccess: () => {
          setRequested(true)
          setSlot(null)
          setPrefDate('')
          formEl.reset()
        },
      },
    )
  }

  // RLS already scopes appointments to the signed-in customer.
  const appointmentsQuery = useMyAppointments()
  const mine = appointmentsQuery.data ?? []

  const upcoming = mine
    .filter((a) => a.status !== 'completed' && a.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date))
  const past = mine.filter((a) => a.status === 'completed' || a.status === 'cancelled')

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Site surveys, installation visits, maintenance calls and consultations."
        breadcrumbs={[{ label: 'Portal', to: '/portal' }, { label: 'Appointments' }]}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              const form = document.getElementById('request-visit')
              form?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              document.getElementById('visitType')?.focus({ preventScroll: true })
            }}
          >
            Request a visit
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
              <FormError error={cancelVisit.error} />
              {upcoming.length === 0 ? (
                <EmptyState
                  icon="📅"
                  title="Nothing scheduled"
                  message="Request a visit and we will confirm the time."
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
                          {APPOINTMENT_STATUS_LABEL[appt.status]}
                        </Badge>
                      </div>
                      <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                        📅 {date(appt.date)} · {appt.timeSlot}
                      </div>
                      {appt.address && <div className="small muted">📍 {appt.address}</div>}
                      {appt.assignedTo.length > 0 && (
                        <div className="small muted">👷 {appt.assignedTo.join(', ')}</div>
                      )}
                      {appt.status === 'requested' && (
                        <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                          Requested — we will confirm the time and tell you who is coming.
                        </p>
                      )}
                      {appt.notes && (
                        <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                          {appt.notes}
                        </p>
                      )}
                      {appt.status !== 'in_progress' && (
                        <div className="row" style={{ marginTop: 'var(--space-3)' }}>
                          {/* Rescheduling is cancel-then-rebook: moving a visit
                              means re-checking crew availability, which is the
                              coordinator's job. */}
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={cancelVisit.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Cancel the ${APPOINTMENT_TYPE_LABEL[appt.type].toLowerCase()} on ${date(appt.date)}?`,
                                )
                              ) {
                                cancelVisit.mutate({
                                  appointmentId: appt.id,
                                  reason: 'Cancelled by the customer from their portal',
                                })
                              }
                            }}
                          >
                            Cancel this visit
                          </Button>
                        </div>
                      )}
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
                      <span>
                        {APPOINTMENT_TYPE_LABEL[appt.type]}{' '}
                        <span className="dim">· {APPOINTMENT_STATUS_LABEL[appt.status]}</span>
                      </span>
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
                  value={visitType}
                  onChange={(e) => setVisitType(e.target.value as VisitType)}
                >
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t === 'repair' ? 'Repair — something is wrong' : APPOINTMENT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                {visitType === 'repair' && (
                  <span className="field__hint">
                    For a fault, a support ticket is triaged first and is usually quicker.
                  </span>
                )}
              </div>

              <div className="field">
                <label className="field__label" htmlFor="prefDate">
                  Preferred date
                </label>
                <input
                  id="prefDate"
                  name="prefDate"
                  className="input"
                  type="date"
                  required
                  min={isoDay(1)}
                  max={isoDay(180)}
                  value={prefDate}
                  onChange={(e) => {
                    setPrefDate(e.target.value)
                    setSlot(null)
                  }}
                />
              </div>

              <div className="field">
                <span className="field__label">Preferred time</span>
                {!prefDate ? (
                  <span className="field__hint">Choose a date to see the free times.</span>
                ) : slotsQuery.isLoading ? (
                  <span className="field__hint">Checking what is free…</span>
                ) : !anyOpen ? (
                  <span className="field__hint" style={{ color: 'var(--danger-fg)' }}>
                    Nothing free that day — we may be closed, fully booked, or it is too soon to
                    arrange. Please choose another date.
                  </span>
                ) : (
                  <div className="slot-grid">
                    {slots.map((s) => (
                      <button
                        key={s.slot}
                        type="button"
                        className={`slot${slot === s.slot ? ' is-selected' : ''}`}
                        disabled={!s.available}
                        onClick={() => setSlot(s.slot)}
                      >
                        {s.slot}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {(visitType === 'site_survey' || !project) &&
                visitType !== 'virtual_consultation' && (
                  <div className="field">
                    <label className="field__label" htmlFor="address">
                      Property address
                    </label>
                    <input
                      id="address"
                      name="address"
                      className="input"
                      required
                      defaultValue={user?.address ?? ''}
                      placeholder="House no., street, barangay, city"
                    />
                  </div>
                )}

              <div className="field">
                <label className="field__label" htmlFor="visitNotes">
                  {visitType === 'repair' || visitType === 'maintenance'
                    ? 'Describe the issue'
                    : 'Anything we should know?'}{' '}
                  <span className="dim">(optional)</span>
                </label>
                <textarea
                  id="visitNotes"
                  name="visitNotes"
                  className="textarea"
                  placeholder={
                    visitType === 'repair' || visitType === 'maintenance'
                      ? 'e.g. output has dropped since last week, inverter showing a warning light'
                      : 'e.g. two-storey, metal roof, frequent brownouts'
                  }
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
                  Requested. It is with our team now — we will confirm the time once a technician is
                  assigned, and you will see it under Upcoming and be notified.
                </p>
              )}

              <FormError error={requestVisit.error} />

              <Button
                type="submit"
                variant="primary"
                block
                disabled={requestVisit.isPending || !slot}
              >
                {requestVisit.isPending
                  ? 'Sending…'
                  : slot
                    ? `Request ${date(prefDate)} at ${slot}`
                    : 'Choose a date and time'}
              </Button>

              <p className="xs dim center">
                Times are in Philippine time. Urgent faults? Raise a support ticket instead — those
                are triaged first.
              </p>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
