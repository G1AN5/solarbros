import { type FormEvent, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatTile } from '@/components/ui/StatTile'
import { date, humanize } from '@/lib/format'
import { APPOINTMENT_STATUS_TONE, APPOINTMENT_TYPE_LABEL } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import {
  useAllAppointments,
  useAssignCrew,
  useCreateAppointment,
  useCrew,
  useDispatchReadiness,
} from '@/lib/queries/operations'
import { useAuth } from '@/app/auth/useAuth'
import type { AppointmentType } from '@/types/domain'

/* ============================================================================
   DispatchPage — Project & Dispatch module.
   ----------------------------------------------------------------------------
   THE ROUTING HUB OF THE WHOLE SYSTEM. Requests arrive here from three places
   and leave in one direction:

     INBOUND
       public /booking             → consultations, site surveys
       /portal/appointments        → maintenance, repairs
       /admin/tickets              → repair visits raised from a support ticket

     OUTBOUND
       assign staff → status 'dispatched' → appears on that technician's
       /field Today list, and the client sees the confirmation in their portal

   Unassigned requests are shown first and highlighted: an unassigned request is
   a promise made to a customer that nobody is keeping yet.
   ========================================================================== */

/** Today as YYYY-MM-DD in the browser's own timezone. */
function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function DispatchPage() {
  /* This was hardcoded to '2026-09-05'. Every day after that one, the
     coordinator opened the dispatch board on a date in the past and saw an
     empty schedule - and toISOString() is not the fix either, because it
     converts to UTC and shows yesterday to anyone in Manila before 8am. */
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const [creating, setCreating] = useState(false)

  const { user } = useAuth()
  const appointmentsQuery = useAllAppointments()
  const crewQuery = useCrew()
  const assignCrew = useAssignCrew()
  const createAppointment = useCreateAppointment()

  const appointments = appointmentsQuery.data ?? []
  const crew = crewQuery.data ?? []

  const unassigned = appointments.filter((a) => a.assignedTo.length === 0)
  const assigned = appointments.filter((a) => a.assignedTo.length > 0)
  const forSelectedDate = appointments.filter((a) => a.date === selectedDate)

  /* Bookings arrive from the public site and the customer portal, but a
     coordinator ringing someone back had no way to put the visit in - the
     button opened nothing. */
  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    createAppointment.mutate(
      {
        type: String(form.get('type') ?? 'maintenance') as AppointmentType,
        date: String(form.get('date') ?? ''),
        timeSlot: String(form.get('slot') ?? '09:00'),
        contactName: String(form.get('contact') ?? ''),
        contactPhone: String(form.get('phone') ?? ''),
        address: String(form.get('address') ?? ''),
        notes: String(form.get('notes') ?? ''),
      },
      { onSuccess: () => setCreating(false) },
    )
  }

  return (
    <>
      <PageHeader
        title="Dispatch board"
        description="Assign crews to surveys, installations, maintenance and repairs."
        actions={
          <>
            <input
              className="input"
              type="date"
              style={{ width: 'auto' }}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <Button variant="primary" onClick={() => setCreating(true)}>
              + New appointment
            </Button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile
          label="Unassigned requests"
          value={String(unassigned.length)}
          delta="Needs a crew"
          direction="up"
          invertDelta
        />
        <StatTile label="Dispatched today" value={String(forSelectedDate.length)} />
        <StatTile label="Crew available" value={String(crew.length)} />
        <StatTile
          label="This week"
          value={String(appointments.length)}
          delta="All appointment types"
        />
      </div>

      <QueryState
        isLoading={appointmentsQuery.isLoading}
        error={appointmentsQuery.error as Error | null}
      >
        {null}
      </QueryState>

      {/* -------------------------------------- UNASSIGNED QUEUE (urgent) */}
      {unassigned.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--warning-solid)' }}>
          <CardHeader
            title="⚠ Awaiting assignment"
            action={<Badge tone="warning">{unassigned.length} pending</Badge>}
          />
          <CardBody>
            <div className="stack">
              {unassigned.map((appt) => (
                <div
                  key={appt.id}
                  className="row row--between row--wrap"
                  style={{
                    padding: 'var(--space-3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--warning-bg)',
                  }}
                >
                  <div>
                    <div className="row">
                      <span className="strong">{APPOINTMENT_TYPE_LABEL[appt.type]}</span>
                      <Badge tone={APPOINTMENT_STATUS_TONE[appt.status]}>
                        {humanize(appt.status)}
                      </Badge>
                    </div>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <span className="small">{appt.clientName}</span>
                      <ReadinessBadge projectId={appt.projectId} type={appt.type} />
                    </div>
                    <div className="xs dim">
                      📍 {appt.address} · 📅 {date(appt.date)} {appt.timeSlot}
                    </div>
                  </div>
                  <div className="row">
                    {/* Selecting a crew member assigns AND dispatches in one
                        step. The status change is what notifies the customer,
                        so it happens only after somebody is actually assigned. */}
                    <select
                      className="select"
                      style={{ width: 'auto' }}
                      value=""
                      disabled={assignCrew.isPending}
                      onChange={(e) => {
                        if (!e.target.value || !user) return
                        assignCrew.mutate({
                          appointmentId: appt.id,
                          userId: e.target.value,
                          assignedBy: user.id,
                        })
                      }}
                    >
                      <option value="" disabled>
                        {assignCrew.isPending ? 'Assigning…' : 'Assign crew…'}
                      </option>
                      {crew.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        {/* --------------------------------------- CREW SCHEDULE BOARD */}
        <Card>
          <CardHeader
            title={`Crew schedule — ${date(selectedDate)}`}
            action={<span className="xs dim">Pushed live to the field portal</span>}
          />
          <CardBody>
            <div className="stack">
              {crew.map((member) => {
                const jobs = forSelectedDate.filter((a) => a.assignedTo.includes(member.fullName))
                return (
                  <div
                    key={member.id}
                    style={{
                      padding: 'var(--space-3)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <div className="row row--between">
                      <span className="row">
                        <span className="avatar">{member.initials}</span>
                        <span className="strong small">{member.fullName}</span>
                      </span>
                      <Badge
                        tone={
                          jobs.length === 0 ? 'neutral' : jobs.length > 2 ? 'danger' : 'success'
                        }
                      >
                        {jobs.length === 0
                          ? 'Free'
                          : `${jobs.length} job${jobs.length > 1 ? 's' : ''}`}
                      </Badge>
                    </div>

                    {jobs.length > 0 && (
                      <div className="stack stack--sm" style={{ marginTop: 'var(--space-3)' }}>
                        {jobs.map((job) => (
                          <div
                            key={job.id}
                            className="xs"
                            style={{
                              padding: 'var(--space-2)',
                              background: 'var(--bg-page)',
                              borderRadius: 'var(--radius-sm)',
                              borderLeft: '3px solid var(--brand-500)',
                            }}
                          >
                            <div className="strong">
                              {job.timeSlot} · {APPOINTMENT_TYPE_LABEL[job.type]}
                            </div>
                            <div className="dim">
                              {job.clientName} — {job.address}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>

        <div className="stack">
          {/* Routing map placeholder — the spec's "geographic routing map". */}
          <Card>
            <CardHeader title="Routing map" />
            <div
              style={{
                height: 280,
                background:
                  'repeating-linear-gradient(45deg, var(--ink-100), var(--ink-100) 12px, var(--ink-200) 12px, var(--ink-200) 24px)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--text-muted)',
              }}
            >
              🗺️ Map with job pins and optimised routes
            </div>
            <CardBody>
              <p className="small muted">
                Plot each day's jobs geographically so a coordinator can group nearby visits and cut
                travel time. Mapbox or Google Maps Directions API with waypoint optimisation would
                do the routing.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="All scheduled appointments" />
            <CardBody>
              <div className="stack stack--sm">
                {assigned.map((appt) => (
                  <div key={appt.id} className="row row--between">
                    <div>
                      <div className="small strong">
                        {APPOINTMENT_TYPE_LABEL[appt.type]} — {appt.clientName}
                      </div>
                      <div className="xs dim">
                        {date(appt.date)} {appt.timeSlot} · {appt.assignedTo.join(', ')}
                      </div>
                    </div>
                    <Badge tone={APPOINTMENT_STATUS_TONE[appt.status]}>
                      {humanize(appt.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* ------------------------------------------- NEW APPOINTMENT */}
      <Modal open={creating} onClose={() => setCreating(false)} title="New appointment">
        <form className="stack" onSubmit={handleCreate}>
          <div className="field">
            <label className="field__label" htmlFor="appt-type">
              Type of visit
            </label>
            <select id="appt-type" name="type" className="select" defaultValue="maintenance">
              <option value="site_survey">Site survey</option>
              <option value="installation">Installation</option>
              <option value="maintenance">Maintenance</option>
              <option value="repair">Repair</option>
              <option value="virtual_consultation">Virtual consultation</option>
            </select>
          </div>

          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="appt-date">
                Date
              </label>
              <input
                id="appt-date"
                name="date"
                className="input"
                type="date"
                required
                defaultValue={selectedDate}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="appt-slot">
                Time
              </label>
              <select id="appt-slot" name="slot" className="select" defaultValue="09:00">
                <option value="08:00">08:00</option>
                <option value="09:00">09:00</option>
                <option value="10:00">10:00</option>
                <option value="13:00">13:00</option>
                <option value="14:00">14:00</option>
                <option value="15:00">15:00</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="appt-contact">
              Who is expecting us
            </label>
            <input id="appt-contact" name="contact" className="input" required />
          </div>

          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="appt-phone">
                Contact number
              </label>
              <input
                id="appt-phone"
                name="phone"
                className="input"
                placeholder="+63 9XX XXX XXXX"
              />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label className="field__label" htmlFor="appt-address">
                Address
              </label>
              <input id="appt-address" name="address" className="input" />
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="appt-notes">
              Notes for the crew
            </label>
            <textarea id="appt-notes" name="notes" className="textarea" rows={2} />
            <span className="field__hint">
              Gate codes, dog, roof access, anything that wastes a trip if nobody knows it.
            </span>
          </div>

          <FormError error={createAppointment.error} />

          <Button type="submit" variant="primary" block disabled={createAppointment.isPending}>
            {createAppointment.isPending ? 'Creating…' : 'Create — then assign a crew'}
          </Button>
        </form>
      </Modal>
    </>
  )
}

/* ============================================================================
   ReadinessBadge
   ----------------------------------------------------------------------------
   Asks the database whether a project's permits and materials are actually in
   place before a coordinator sends a crew to it. Sending one early is the
   expensive mistake — a wasted day, or work that has to come down again.

   Its own component because the answer is per-project and hooks cannot be
   called in a loop. Rendered only for installation visits: a survey or a
   consultation needs neither permits nor stock.
   ========================================================================== */

function ReadinessBadge({ projectId, type }: { projectId?: string; type: AppointmentType }) {
  const needsProject = type === 'installation' || type === 'maintenance' || type === 'repair'
  const readiness = useDispatchReadiness(needsProject ? projectId : undefined)

  if (!needsProject || !projectId || readiness.data === undefined) return null

  return readiness.data ? (
    <Badge tone="success">Ready</Badge>
  ) : (
    <Badge tone="warning">Permits or stock outstanding</Badge>
  )
}
