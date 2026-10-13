import { type FormEvent, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatTile } from '@/components/ui/StatTile'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { TicketThread } from '@/components/ui/TicketThread'
import { useAuth } from '@/app/auth/useAuth'
import { humanize, relative } from '@/lib/format'
import { ROLE_LABEL, TICKET_PRIORITY_TONE, TICKET_STATUS_TONE } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { useStaff } from '@/lib/queries/admin'
import { useAllTickets, useCreateAppointment, useUpdateTicket } from '@/lib/queries/operations'
import { settingNum, settingText, useSettings } from '@/lib/queries/settings'
import { useNow } from '@/lib/use-now'
import type { Ticket, TicketPriority, TicketStatus } from '@/types/domain'
import { datedFilename, downloadCsv } from '@/lib/csv'

/* ============================================================================
   AdminTicketsPage — the staff-side support queue.
   ----------------------------------------------------------------------------
   Same `tickets` table the client writes to from /portal/tickets. This is the
   triage side.

   THE ESCALATION PATH
     ticket raised → triaged here → if a site visit is needed, "Dispatch a
     technician" creates an appointment (type 'repair') on /admin/dispatch,
     which pushes to the technician's /field Today list.

   Sorting is deliberately by priority THEN age: an urgent ticket opened an hour
   ago outranks a low-priority one from last week.

   RESPONSE TARGETS COME FROM SETTINGS
   The targets card was four typed sentences and nothing measured against
   them. They are now the `support.sla_*_hours` settings, and a ticket still
   untouched past its target is flagged in the queue.
   ========================================================================== */

type Filter = 'all' | TicketStatus

const PRIORITY_WEIGHT = { urgent: 0, high: 1, normal: 2, low: 3 }

const PRIORITY_MEANING: Record<TicketPriority, string> = {
  urgent: 'system down or a safety risk',
  high: 'output materially affected',
  normal: 'a fault or a question',
  low: 'when convenient',
}

function hoursLabel(hours: number): string {
  return hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${Math.round(hours / 24)} days`
}

export function AdminTicketsPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [working, setWorking] = useState<Ticket | null>(null)

  const { user } = useAuth()
  const ticketsQuery = useAllTickets()
  const tickets = ticketsQuery.data ?? []
  /* Anyone on the staff can own a ticket — a billing question belongs with
     the accountant, a fault with an engineer or technician. The list used to
     offer field staff only. */
  const staff = (useStaff().data ?? []).filter((s) => s.isActive)
  const updateTicket = useUpdateTicket()

  const settings = useSettings().data
  const sla: Record<TicketPriority, number> = {
    urgent: settingNum(settings, 'support.sla_urgent_hours', 2),
    high: settingNum(settings, 'support.sla_high_hours', 24),
    normal: settingNum(settings, 'support.sla_normal_hours', 48),
    low: settingNum(settings, 'support.sla_low_hours', 120),
  }
  const slots = settingText(
    settings,
    'operations.booking_slots',
    '08:00,09:00,10:00,11:00,13:00,14:00,15:00,16:00',
  )
    .split(',')
    .map((slot) => slot.trim())
    .filter(Boolean)

  /** Still not picked up, and older than its priority's response target. */
  const now = useNow()
  function responseOverdue(ticket: Ticket): boolean {
    if (ticket.status !== 'open') return false
    const ageHours = (now - new Date(ticket.createdAt).getTime()) / 3_600_000
    return ageHours > sla[ticket.priority]
  }

  /* "Dispatch" was a second, inert button sitting next to the real one. The
     escalation it named - ticket becomes a site visit - is the step the flow
     diagram calls for and the only one that was missing, so it now happens
     here, inside triage, where the person deciding it already is. */
  const createAppointment = useCreateAppointment()
  const [dispatching, setDispatching] = useState<Ticket | null>(null)

  function handleDispatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dispatching) return
    const form = new FormData(event.currentTarget)

    createAppointment.mutate(
      {
        type: 'repair',
        date: String(form.get('date') ?? ''),
        timeSlot: String(form.get('slot') ?? '09:00'),
        contactName: dispatching.clientName || 'Customer',
        address: String(form.get('address') ?? ''),
        notes: `${dispatching.reference}: ${dispatching.subject}\n\n${dispatching.description}`,
        clientId: dispatching.clientId ?? null,
        projectId: dispatching.projectId || null,
        ticketId: dispatching.id,
      },
      {
        onSuccess: () => {
          // A ticket with a technician booked is no longer merely "open".
          updateTicket.mutate({ id: dispatching.id, status: 'in_progress' })
          setDispatching(null)
        },
      },
    )
  }

  const rows = (filter === 'all' ? tickets : tickets.filter((t) => t.status === filter))
    .slice()
    .sort((a, b) => {
      const byPriority = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
      if (byPriority !== 0) return byPriority
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })

  const open = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed')
  const urgent = open.filter((t) => t.priority === 'urgent')
  const unassigned = open.filter((t) => !t.assignedTo)
  const overdue = open.filter(responseOverdue)

  /* This tile read "1.8 days · 12% faster" and both figures were typed in by
     hand. A support manager judges the team on this number, so inventing it is
     not a harmless placeholder. Measured from the tickets that have actually
     been resolved; with none resolved yet it says so rather than guessing. */
  const resolved = tickets.filter((t) => t.resolvedAt)
  const avgResolutionDays =
    resolved.length === 0
      ? null
      : resolved.reduce(
          (sum, t) =>
            sum +
            (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()) / 86_400_000,
          0,
        ) / resolved.length

  /* The queue was read-only: a list of problems with no way to act on any of
     them. Assigning, progressing and resolving are the whole job. */
  const columns: Column<Ticket>[] = [
    { header: 'Ref', cell: (t) => <code>{t.reference}</code> },
    {
      header: 'Subject',
      cell: (t) => (
        <div style={{ maxWidth: '40ch' }}>
          <div className="strong">{t.subject}</div>
          <div className="xs dim">
            {t.clientName} · {humanize(t.category)}
          </div>
        </div>
      ),
    },
    {
      header: 'Priority',
      cell: (t) => (
        <div className="stack stack--sm" style={{ gap: 2 }}>
          <Badge tone={TICKET_PRIORITY_TONE[t.priority]}>{humanize(t.priority)}</Badge>
          {responseOverdue(t) && <Badge tone="danger">Response overdue</Badge>}
        </div>
      ),
    },
    {
      header: 'Status',
      cell: (t) => <Badge tone={TICKET_STATUS_TONE[t.status]}>{humanize(t.status)}</Badge>,
    },
    {
      header: 'Assigned',
      cell: (t) =>
        t.assignedTo ? (
          <span className="small">{t.assignedTo}</span>
        ) : (
          <Badge tone="warning">Unassigned</Badge>
        ),
    },
    { header: 'Opened', cell: (t) => <span className="xs dim">{relative(t.createdAt)}</span> },
    {
      header: 'Last update',
      cell: (t) => <span className="xs dim">{relative(t.lastUpdate)}</span>,
    },
  ]

  return (
    <>
      <PageHeader
        title="Support tickets"
        description="Triage client-reported issues and turn them into scheduled service visits."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              downloadCsv(datedFilename('tickets'), rows, [
                { header: 'Reference', value: (t) => t.reference },
                { header: 'Subject', value: (t) => t.subject },
                { header: 'Customer', value: (t) => t.clientName },
                { header: 'Category', value: (t) => t.category },
                { header: 'Priority', value: (t) => t.priority },
                { header: 'Status', value: (t) => t.status },
                { header: 'Assigned to', value: (t) => t.assignedTo ?? '' },
                { header: 'Opened', value: (t) => t.createdAt },
                { header: 'Last update', value: (t) => t.lastUpdate },
                { header: 'Resolution', value: (t) => t.resolution ?? '' },
              ])
            }
          >
            Export CSV
          </Button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Open tickets" value={String(open.length)} />
        <StatTile
          label="Urgent"
          value={String(urgent.length)}
          delta={
            overdue.length
              ? `${overdue.length} past their response target`
              : `${hoursLabel(sla.urgent)} response target`
          }
          direction={urgent.length || overdue.length ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile
          label="Unassigned"
          value={String(unassigned.length)}
          delta="Needs an owner"
          direction={unassigned.length ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile
          label="Avg. resolution"
          value={avgResolutionDays === null ? '—' : `${avgResolutionDays.toFixed(1)} days`}
          delta={
            resolved.length === 0
              ? 'Nothing resolved yet'
              : `Across ${resolved.length} resolved ticket${resolved.length === 1 ? '' : 's'}`
          }
          direction="flat"
        />
      </div>

      <Tabs
        tabs={[
          { value: 'all' as Filter, label: 'All', count: tickets.length },
          { value: 'open' as Filter, label: 'Open' },
          { value: 'in_progress' as Filter, label: 'In progress' },
          { value: 'awaiting_client' as Filter, label: 'Awaiting client' },
          { value: 'resolved' as Filter, label: 'Resolved' },
          { value: 'closed' as Filter, label: 'Closed' },
        ]}
        active={filter}
        onChange={setFilter}
      />

      <QueryState
        isLoading={ticketsQuery.isLoading}
        error={ticketsQuery.error as Error | null}
        emptyIcon="&#127881;"
        emptyTitle="No tickets"
        emptyMessage="Nothing needs attention right now."
      >
        <DataTable
          columns={[
            ...columns,
            {
              header: '',
              cell: (ticket: Ticket) => (
                <Button variant="outline" size="sm" onClick={() => setWorking(ticket)}>
                  {ticket.status === 'resolved' ? 'Review' : 'Work on it'}
                </Button>
              ),
            },
          ]}
          rows={rows}
          rowKey={(t) => t.id}
          emptyMessage="No tickets in this state."
        />
      </QueryState>

      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardBody>
          <h4>Response targets</h4>
          <div className="grid" style={{ marginTop: 'var(--space-3)' }}>
            {(['urgent', 'high', 'normal', 'low'] as TicketPriority[]).map((priority) => (
              <div key={priority} className="row">
                <Badge tone={TICKET_PRIORITY_TONE[priority]}>{humanize(priority)}</Badge>
                <span className="small muted">
                  {hoursLabel(sla[priority])} — {PRIORITY_MEANING[priority]}
                </span>
              </div>
            ))}
          </div>
          <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
            Set under Settings → Support. A ticket still open past its target is flagged above.
          </p>
        </CardBody>
      </Card>

      {/* ------------------------------------------------ TRIAGE
          Assignment, status and resolution in one place. The customer sees
          every one of these changes on their own tickets page — the same row,
          read through a different policy. */}
      <Modal
        open={working !== null}
        onClose={() => setWorking(null)}
        title={working ? `${working.reference} · ${working.subject}` : 'Ticket'}
      >
        {working && (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              const assignee = String(form.get('assignee') ?? '')

              const coverage = String(form.get('warranty') ?? '')
              const warrantyCovered =
                coverage === 'covered' ? true : coverage === 'billable' ? false : null

              updateTicket.mutate(
                {
                  id: working.id,
                  status: String(form.get('status')) as Ticket['status'],
                  priority: String(form.get('priority')) as Ticket['priority'],
                  assignedTo: assignee || null,
                  resolution: String(form.get('resolution') ?? '') || undefined,
                  // Only sent when it changed, so the triage stamp means something.
                  ...(warrantyCovered !== (working.warrantyCovered ?? null)
                    ? { warrantyCovered, triagedBy: user?.id }
                    : {}),
                },
                { onSuccess: () => setWorking(null) },
              )
            }}
          >
            <div
              style={{
                padding: 'var(--space-3)',
                background: 'var(--ink-50)',
                borderRadius: 'var(--radius)',
              }}
            >
              <p className="small">{working.description}</p>
              <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                Raised by {working.clientName} · {humanize(working.category)} ·{' '}
                {relative(working.createdAt)}
                {working.satisfactionRating
                  ? ` · rated ${'★'.repeat(working.satisfactionRating)}`
                  : ''}
              </p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="ticket-assignee">
                Assign to
              </label>
              <select
                id="ticket-assignee"
                name="assignee"
                className="select"
                defaultValue={working.assignedToId ?? ''}
              >
                <option value="">Unassigned</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName} · {ROLE_LABEL[member.role]}
                  </option>
                ))}
              </select>
              <span className="field__hint">They are notified, and it appears in their bell.</span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="ticket-warranty">
                Warranty
              </label>
              <select
                id="ticket-warranty"
                name="warranty"
                className="select"
                defaultValue={
                  working.warrantyCovered === true
                    ? 'covered'
                    : working.warrantyCovered === false
                      ? 'billable'
                      : ''
                }
              >
                <option value="">Not decided yet</option>
                <option value="covered">Covered by the warranty</option>
                <option value="billable">Not covered — chargeable</option>
              </select>
              <span className="field__hint">
                A chargeable repair is invoiced from Finance as an &ldquo;Other&rdquo; invoice.
              </span>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="ticket-status">
                  Status
                </label>
                <select
                  id="ticket-status"
                  name="status"
                  className="select"
                  defaultValue={working.status}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="awaiting_client">Awaiting client</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="ticket-priority">
                  Priority
                </label>
                <select
                  id="ticket-priority"
                  name="priority"
                  className="select"
                  defaultValue={working.priority}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            {/* The conversation, in the same place as the triage decision.
                Anything typed here reaches the customer's own support page. */}
            <div className="field">
              <span className="field__label">Conversation</span>
              <TicketThread
                ticketId={working.id}
                allowInternal
                readOnly={working.status === 'closed'}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="ticket-resolution">
                What was done?
              </label>
              <textarea
                id="ticket-resolution"
                name="resolution"
                className="textarea"
                rows={3}
                defaultValue={working.resolution ?? ''}
                placeholder="The customer reads this. Say what you found and what you did about it."
              />
            </div>

            <FormError error={updateTicket.error} />

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Button type="submit" variant="primary" disabled={updateTicket.isPending}>
                {updateTicket.isPending ? 'Saving…' : 'Save and notify the customer'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDispatching(working)
                  setWorking(null)
                }}
              >
                Send a technician
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ------------------------------------ TICKET -> SERVICE VISIT */}
      <Modal
        open={dispatching !== null}
        onClose={() => setDispatching(null)}
        title={dispatching ? `Site visit for ${dispatching.reference}` : 'Site visit'}
      >
        {dispatching && (
          <form className="stack" onSubmit={handleDispatch}>
            <p className="small muted">
              This creates a repair appointment linked to {dispatching.reference}, so the visit and
              the fault it was raised for stay joined. It lands unassigned on the dispatch board;
              give it a crew there and the technician sees it on their Today list.
            </p>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="disp-date">
                  Date
                </label>
                <input
                  id="disp-date"
                  name="date"
                  className="input"
                  type="date"
                  required
                  min={new Date().toISOString().slice(0, 10)}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="disp-slot">
                  Time
                </label>
                <select id="disp-slot" name="slot" className="select" defaultValue={slots[0]}>
                  {slots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="disp-address">
                Address
              </label>
              <input id="disp-address" name="address" className="input" />
              <span className="field__hint">
                Leave blank to use the address already on the customer's project.
              </span>
            </div>

            <FormError error={createAppointment.error} />

            <Button type="submit" variant="primary" block disabled={createAppointment.isPending}>
              {createAppointment.isPending ? 'Booking…' : 'Book the visit'}
            </Button>
          </form>
        )}
      </Modal>
    </>
  )
}
