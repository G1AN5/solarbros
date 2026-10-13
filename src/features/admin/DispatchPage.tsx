import { type FormEvent, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatTile } from '@/components/ui/StatTile'
import { date } from '@/lib/format'
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_TONE,
  APPOINTMENT_TYPE_LABEL,
} from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { useLeads } from '@/lib/queries/crm'
import {
  useAllAppointments,
  useAssignCrew,
  useClientAccounts,
  useCreateAppointment,
  useCrew,
  useDispatchReadiness,
  useMaintenanceSchedules,
  useProjects,
  useScheduleMaintenanceVisit,
  useUnassignCrew,
  useUpdateAppointment,
  type MaintenanceDue,
  type OfficeAppointment,
} from '@/lib/queries/operations'
import { settingText, useSettings } from '@/lib/queries/settings'
import { useAuth } from '@/app/auth/useAuth'
import type { AppointmentType } from '@/types/domain'

/* ============================================================================
   DispatchPage — Project & Dispatch module.
   ----------------------------------------------------------------------------
   THE ROUTING HUB OF THE WHOLE SYSTEM. Requests arrive here from four places
   and leave in one direction:

     INBOUND
       public /booking             → consultations, site surveys
       /portal/appointments        → maintenance, repairs
       /admin/tickets              → repair visits raised from a support ticket
       maintenance schedules       → the annual visit after turnover

     OUTBOUND
       assign staff → status 'dispatched' → appears on that technician's
       /field Today list, and the customer is told who is coming

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

const DEFAULT_SLOTS = '08:00,09:00,10:00,11:00,13:00,14:00,15:00,16:00'

const LIVE: OfficeAppointment['status'][] = ['requested', 'confirmed', 'dispatched', 'in_progress']

type Subject = 'project' | 'client' | 'lead'

export function DispatchPage() {
  /* This was hardcoded to '2026-09-05'. Every day after that one, the
     coordinator opened the dispatch board on a date in the past and saw an
     empty schedule - and toISOString() is not the fix either, because it
     converts to UTC and shows yesterday to anyone in Manila before 8am. */
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const [creating, setCreating] = useState(false)
  const [subject, setSubject] = useState<Subject>('project')
  const [editing, setEditing] = useState<OfficeAppointment | null>(null)
  const [scheduling, setScheduling] = useState<MaintenanceDue | null>(null)

  const { user } = useAuth()
  const appointmentsQuery = useAllAppointments()
  const crewQuery = useCrew()
  const projects = useProjects().data ?? []
  const clients = useClientAccounts().data ?? []
  const leads = (useLeads().data ?? []).filter((l) => l.stage !== 'lost' && l.stage !== 'installed')
  const maintenance = useMaintenanceSchedules().data ?? []
  const assignCrew = useAssignCrew()
  const unassignCrew = useUnassignCrew()
  const createAppointment = useCreateAppointment()
  const updateAppointment = useUpdateAppointment()
  const scheduleMaintenance = useScheduleMaintenanceVisit()

  /* The times offered are the business's own (Business Settings → Operations),
     the same list the public booking page uses — not a second list typed into
     this page that left out 11:00 and 16:00. */
  const settings = useSettings().data
  const slots = settingText(settings, 'operations.booking_slots', DEFAULT_SLOTS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const appointments = useMemo(() => appointmentsQuery.data ?? [], [appointmentsQuery.data])
  const crew = crewQuery.data ?? []
  const today = todayIso()

  /* Only visits that still need a crew. Cancelled and completed requests used
     to sit in this queue for ever — anything without an assignee counted. */
  const unassigned = appointments.filter(
    (a) => a.assignedTo.length === 0 && (a.status === 'requested' || a.status === 'confirmed'),
  )
  const scheduled = appointments.filter(
    (a) => a.assignedTo.length > 0 && LIVE.includes(a.status) && a.date >= today,
  )
  const forSelectedDate = appointments.filter(
    (a) => a.date === selectedDate && a.status !== 'cancelled',
  )
  const dueMaintenance = maintenance.filter((m) => !m.appointmentId)

  // Monday-to-Sunday of the selected date, for an honest "this week" count.
  const weekCount = useMemo(() => {
    const anchor = new Date(`${selectedDate}T00:00:00`)
    const monday = new Date(anchor)
    monday.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7))
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return appointments.filter(
      (a) => a.status !== 'cancelled' && a.date >= iso(monday) && a.date <= iso(sunday),
    ).length
  }, [appointments, selectedDate])

  /* A route for the day's visits in the order they are booked, handed to
     Google Maps rather than drawn here: the crew opens it on their phone and
     gets turn-by-turn directions for free. */
  const dayAddresses = forSelectedDate
    .filter((a) => a.address)
    .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot))
    .map((a) => a.address)
  const routeUrl =
    dayAddresses.length > 0
      ? `https://www.google.com/maps/dir/${dayAddresses.map((a) => encodeURIComponent(a)).join('/')}`
      : null

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const target = String(form.get('target') ?? '')

    createAppointment.mutate(
      {
        type: String(form.get('type') ?? 'maintenance') as AppointmentType,
        date: String(form.get('date') ?? ''),
        timeSlot: String(form.get('slot') ?? slots[0] ?? '09:00'),
        contactName: String(form.get('contact') ?? ''),
        contactPhone: String(form.get('phone') ?? ''),
        address: String(form.get('address') ?? ''),
        notes: String(form.get('notes') ?? ''),
        projectId: subject === 'project' ? target || null : null,
        clientId: subject === 'client' ? target || null : null,
        leadId: subject === 'lead' ? target || null : null,
      },
      { onSuccess: () => setCreating(false) },
    )
  }

  function handleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)
    const action = String(
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? 'save',
    )

    updateAppointment.mutate(
      action === 'cancel'
        ? {
            id: editing.id,
            status: 'cancelled',
            cancelledReason: String(form.get('reason') ?? ''),
          }
        : action === 'complete'
          ? { id: editing.id, status: 'completed' }
          : {
              id: editing.id,
              date: String(form.get('date') ?? editing.date),
              timeSlot: String(form.get('slot') ?? editing.timeSlot),
              notes: String(form.get('notes') ?? ''),
            },
      { onSuccess: () => setEditing(null) },
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
              aria-label="Day to show"
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
          delta={unassigned.length ? 'Needs a crew' : 'All covered'}
          direction={unassigned.length ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile
          label={`Visits on ${date(selectedDate)}`}
          value={String(forSelectedDate.length)}
        />
        <StatTile label="Crew available" value={String(crew.length)} />
        <StatTile label="This week" value={String(weekCount)} delta="Booked visits, Mon–Sun" />
      </div>

      <QueryState
        isLoading={appointmentsQuery.isLoading}
        error={appointmentsQuery.error as Error | null}
      >
        {null}
      </QueryState>

      <FormError error={assignCrew.error ?? unassignCrew.error} />

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
                    gap: 'var(--space-3)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="row row--wrap">
                      <span className="strong">{APPOINTMENT_TYPE_LABEL[appt.type]}</span>
                      <Badge tone={APPOINTMENT_STATUS_TONE[appt.status]}>
                        {APPOINTMENT_STATUS_LABEL[appt.status]}
                      </Badge>
                      {appt.projectReference && (
                        <Badge tone="neutral">{appt.projectReference}</Badge>
                      )}
                    </div>
                    <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
                      <span className="small">{appt.accountName ?? appt.clientName}</span>
                      <ReadinessBadge projectId={appt.projectId} type={appt.type} />
                    </div>
                    <div className="xs dim">
                      📅 {date(appt.date)} {appt.timeSlot}
                      {appt.address ? ` · 📍 ${appt.address}` : ''}
                    </div>
                    <div className="xs dim">
                      {appt.contactPhone ? `✆ ${appt.contactPhone}` : 'No phone on file'}
                      {appt.contactEmail ? ` · ✉ ${appt.contactEmail}` : ''}
                    </div>
                    {appt.notes && (
                      <div className="xs" style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>
                        “{appt.notes}”
                      </div>
                    )}
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
                      aria-label="Assign crew"
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
                    <Button variant="ghost" size="sm" onClick={() => setEditing(appt)}>
                      Manage
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------- MAINTENANCE DUE */}
      {dueMaintenance.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-6)' }}>
          <CardHeader
            title="Preventive maintenance due"
            action={<Badge tone="info">{dueMaintenance.length} to book</Badge>}
          />
          <CardBody>
            <div className="stack stack--sm">
              {dueMaintenance.map((item) => (
                <div key={item.id} className="row row--between row--wrap">
                  <div>
                    <span className="small strong">
                      {item.projectReference} · {item.clientName}
                    </span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      Due {date(item.dueDate)} · {item.address}
                    </span>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setScheduling(item)}>
                    Book the visit
                  </Button>
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
                const jobs = forSelectedDate.filter((a) => a.assigneeIds.includes(member.id))
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
                          <button
                            key={job.id}
                            type="button"
                            className="xs"
                            onClick={() => setEditing(job)}
                            style={{
                              padding: 'var(--space-2)',
                              background: 'var(--bg-page)',
                              borderRadius: 'var(--radius-sm)',
                              border: 0,
                              borderLeft: '3px solid var(--brand-500)',
                              textAlign: 'left',
                              cursor: 'pointer',
                              color: 'inherit',
                            }}
                          >
                            <div className="strong">
                              {job.timeSlot} · {APPOINTMENT_TYPE_LABEL[job.type]} ·{' '}
                              {APPOINTMENT_STATUS_LABEL[job.status]}
                            </div>
                            <div className="dim">
                              {job.accountName ?? job.clientName} — {job.address}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {crew.length === 0 && (
                <p className="small muted">
                  No technicians or project engineers are active yet. Approve their registrations
                  under Roles &amp; Access.
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        <div className="stack">
          <Card>
            <CardHeader title="Route for the day" />
            <CardBody>
              {routeUrl ? (
                <>
                  <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
                    {forSelectedDate
                      .filter((a) => a.address)
                      .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot))
                      .map((a) => (
                        <li key={a.id}>
                          {a.timeSlot} · {a.address}
                        </li>
                      ))}
                  </ol>
                  <a
                    className="btn btn--outline btn--block"
                    style={{ marginTop: 'var(--space-3)' }}
                    href={routeUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    🧭 Open the route in Google Maps
                  </a>
                </>
              ) : (
                <p className="small muted">No visits with an address on {date(selectedDate)}.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Upcoming assigned visits" />
            <CardBody>
              {scheduled.length === 0 ? (
                <p className="small muted">Nothing assigned from today onwards.</p>
              ) : (
                <div className="stack stack--sm">
                  {scheduled.map((appt) => (
                    <div key={appt.id} className="row row--between">
                      <div>
                        <div className="small strong">
                          {APPOINTMENT_TYPE_LABEL[appt.type]} —{' '}
                          {appt.accountName ?? appt.clientName}
                        </div>
                        <div className="xs dim">
                          {date(appt.date)} {appt.timeSlot} · {appt.assignedTo.join(', ')}
                        </div>
                      </div>
                      <div className="row">
                        <Badge tone={APPOINTMENT_STATUS_TONE[appt.status]}>
                          {APPOINTMENT_STATUS_LABEL[appt.status]}
                        </Badge>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(appt)}>
                          Manage
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* ------------------------------------------- NEW APPOINTMENT */}
      <Modal
        open={creating}
        onClose={() => {
          setCreating(false)
          createAppointment.reset()
        }}
        title="New appointment"
      >
        <form className="stack" onSubmit={handleCreate}>
          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
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
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="appt-subject">
                Who is it for?
              </label>
              <select
                id="appt-subject"
                className="select"
                value={subject}
                onChange={(e) => setSubject(e.target.value as Subject)}
              >
                <option value="project">A project (installation, maintenance, repair)</option>
                <option value="client">A customer account</option>
                <option value="lead">A lead (survey, consultation)</option>
              </select>
            </div>
          </div>

          {/* Every visit is FOR somebody. The form used to have no way to say
              who, and the database refused it with "one of the values is
              outside what the system allows". */}
          <div className="field">
            <label className="field__label" htmlFor="appt-target">
              {subject === 'project' ? 'Project' : subject === 'client' ? 'Customer' : 'Lead'}
            </label>
            <select id="appt-target" name="target" className="select" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {subject === 'project' &&
                projects
                  .filter((p) => p.status !== 'cancelled')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.reference} · {p.clientName} · {p.address}
                    </option>
                  ))}
              {subject === 'client' &&
                clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} · {c.email}
                  </option>
                ))}
              {subject === 'lead' &&
                leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.email}
                    {l.location ? ` · ${l.location}` : ''}
                  </option>
                ))}
            </select>
            <span className="field__hint">
              The name, number and address are filled in from their record — change them below only
              if the visit is somewhere else.
            </span>
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
                min={today}
                defaultValue={selectedDate >= today ? selectedDate : today}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="appt-slot">
                Time
              </label>
              <select id="appt-slot" name="slot" className="select" defaultValue={slots[0]}>
                {slots.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <details>
            <summary className="small" style={{ cursor: 'pointer' }}>
              Different contact or address for this visit?
            </summary>
            <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
              <div className="field">
                <label className="field__label" htmlFor="appt-contact">
                  Who is expecting us
                </label>
                <input id="appt-contact" name="contact" className="input" />
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
            </div>
          </details>

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

      {/* ------------------------------------------ MANAGE A VISIT */}
      <Modal
        open={editing !== null}
        onClose={() => {
          setEditing(null)
          updateAppointment.reset()
        }}
        title={
          editing ? `${APPOINTMENT_TYPE_LABEL[editing.type]} · ${date(editing.date)}` : 'Visit'
        }
      >
        {editing && (
          <form className="stack" onSubmit={handleEdit}>
            <div
              className="stack stack--sm"
              style={{
                padding: 'var(--space-3)',
                background: 'var(--ink-50)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div className="row row--between">
                <span className="small strong">{editing.accountName ?? editing.clientName}</span>
                <Badge tone={APPOINTMENT_STATUS_TONE[editing.status]}>
                  {APPOINTMENT_STATUS_LABEL[editing.status]}
                </Badge>
              </div>
              <div className="xs dim">
                {editing.address || 'No address'} · {editing.contactPhone ?? 'no phone'}
                {editing.contactEmail ? ` · ${editing.contactEmail}` : ''}
              </div>
              {editing.projectReference && (
                <div className="xs dim">Project {editing.projectReference}</div>
              )}
            </div>

            {/* The crew, with a way to take somebody off. */}
            <div>
              <div className="xs dim strong">CREW</div>
              {editing.assignedTo.length === 0 ? (
                <p className="small muted">Nobody yet — assign from the queue.</p>
              ) : (
                <div className="stack stack--sm" style={{ marginTop: 'var(--space-2)' }}>
                  {editing.assignedTo.map((name, index) => (
                    <div key={editing.assigneeIds[index] ?? name} className="row row--between">
                      <span className="small">{name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={unassignCrew.isPending || editing.status === 'completed'}
                        onClick={() =>
                          unassignCrew.mutate(
                            {
                              appointmentId: editing.id,
                              userId: editing.assigneeIds[index],
                              remaining: editing.assignedTo.length - 1,
                            },
                            { onSuccess: () => setEditing(null) },
                          )
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {editing.status !== 'completed' && editing.status !== 'cancelled' && (
                <select
                  className="select"
                  style={{ marginTop: 'var(--space-2)' }}
                  value=""
                  disabled={assignCrew.isPending}
                  aria-label="Add a crew member"
                  onChange={(e) => {
                    if (!e.target.value || !user) return
                    assignCrew.mutate(
                      { appointmentId: editing.id, userId: e.target.value, assignedBy: user.id },
                      { onSuccess: () => setEditing(null) },
                    )
                  }}
                >
                  <option value="" disabled>
                    Add a crew member…
                  </option>
                  {crew
                    .filter((member) => !editing.assigneeIds.includes(member.id))
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.fullName}
                      </option>
                    ))}
                </select>
              )}
            </div>

            {editing.status !== 'completed' && editing.status !== 'cancelled' && (
              <>
                <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="field__label" htmlFor="edit-date">
                      Move to
                    </label>
                    <input
                      id="edit-date"
                      name="date"
                      className="input"
                      type="date"
                      defaultValue={editing.date}
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="field__label" htmlFor="edit-slot">
                      Time
                    </label>
                    <select
                      id="edit-slot"
                      name="slot"
                      className="select"
                      defaultValue={editing.timeSlot}
                    >
                      {[...new Set([editing.timeSlot, ...slots])].map((slot) => (
                        <option key={slot} value={slot}>
                          {slot}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="edit-notes">
                    Notes for the crew
                  </label>
                  <textarea
                    id="edit-notes"
                    name="notes"
                    className="textarea"
                    rows={2}
                    defaultValue={editing.notes ?? ''}
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="edit-reason">
                    If cancelling, why? <span className="dim">(the customer is told)</span>
                  </label>
                  <input id="edit-reason" name="reason" className="input" />
                </div>

                <FormError error={updateAppointment.error} />

                <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
                  <Button
                    type="submit"
                    value="save"
                    variant="primary"
                    disabled={updateAppointment.isPending}
                  >
                    Save changes
                  </Button>
                  {editing.status === 'in_progress' || editing.status === 'dispatched' ? (
                    <Button
                      type="submit"
                      value="complete"
                      variant="outline"
                      disabled={updateAppointment.isPending}
                      title="For a visit that happened without the field app — a dead phone, say"
                    >
                      Mark completed
                    </Button>
                  ) : null}
                  <Button
                    type="submit"
                    value="cancel"
                    variant="ghost"
                    disabled={updateAppointment.isPending}
                  >
                    Cancel the visit
                  </Button>
                </div>
              </>
            )}

            {editing.status === 'completed' && (
              <p className="small muted">
                Completed
                {editing.signoffName ? `, signed off by ${editing.signoffName}` : ''}.
              </p>
            )}
            {editing.status === 'cancelled' && (
              <p className="small muted">
                Cancelled{editing.cancelledReason ? `: ${editing.cancelledReason}` : ''}.
              </p>
            )}
          </form>
        )}
      </Modal>

      {/* -------------------------------------- BOOK A MAINTENANCE VISIT */}
      <Modal
        open={scheduling !== null}
        onClose={() => {
          setScheduling(null)
          scheduleMaintenance.reset()
        }}
        title="Book the maintenance visit"
      >
        {scheduling && (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              scheduleMaintenance.mutate(
                {
                  scheduleId: scheduling.id,
                  projectId: scheduling.projectId,
                  date: String(form.get('date') ?? ''),
                  timeSlot: String(form.get('slot') ?? slots[0]),
                },
                { onSuccess: () => setScheduling(null) },
              )
            }}
          >
            <p className="small muted">
              {scheduling.projectReference} · {scheduling.clientName} · due{' '}
              {date(scheduling.dueDate)}. The visit lands in the queue above for a crew; closing it
              in the field books next year&apos;s.
            </p>
            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="maint-date">
                  Date
                </label>
                <input
                  id="maint-date"
                  name="date"
                  className="input"
                  type="date"
                  required
                  min={today}
                  defaultValue={scheduling.dueDate >= today ? scheduling.dueDate : today}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="maint-slot">
                  Time
                </label>
                <select id="maint-slot" name="slot" className="select" defaultValue={slots[0]}>
                  {slots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <FormError error={scheduleMaintenance.error} />
            <Button type="submit" variant="primary" block disabled={scheduleMaintenance.isPending}>
              Book it
            </Button>
          </form>
        )}
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
  const needsProject = type === 'installation'
  const readiness = useDispatchReadiness(needsProject ? projectId : undefined)

  if (!needsProject || !projectId || readiness.data === undefined) return null

  return readiness.data ? (
    <Badge tone="success">Permits and materials ready</Badge>
  ) : (
    <Badge tone="warning">Permits or stock outstanding</Badge>
  )
}
