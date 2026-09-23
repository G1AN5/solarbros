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
import { humanize, relative } from '@/lib/format'
import { TICKET_PRIORITY_TONE, TICKET_STATUS_TONE } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import {
  useAllTickets,
  useCreateAppointment,
  useCrew,
  useUpdateTicket,
} from '@/lib/queries/operations'
import type { Ticket, TicketStatus } from '@/types/domain'
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
   ========================================================================== */

type Filter = 'all' | TicketStatus

const PRIORITY_WEIGHT = { urgent: 0, high: 1, normal: 2, low: 3 }

export function AdminTicketsPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const [working, setWorking] = useState<Ticket | null>(null)

  const ticketsQuery = useAllTickets()
  const tickets = ticketsQuery.data ?? []
  const crew = useCrew().data ?? []
  const updateTicket = useUpdateTicket()

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
  const urgent = tickets.filter((t) => t.priority === 'urgent' && t.status !== 'resolved')
  const unassigned = open.filter((t) => !t.assignedTo)

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
      cell: (t) => <Badge tone={TICKET_PRIORITY_TONE[t.priority]}>{humanize(t.priority)}</Badge>,
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
          delta="2-hour response target"
          direction={urgent.length ? 'up' : 'flat'}
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
            <div className="row">
              <Badge tone="danger">Urgent</Badge>
              <span className="small muted">2 hours — system down or a safety risk</span>
            </div>
            <div className="row">
              <Badge tone="warning">High</Badge>
              <span className="small muted">1 business day — output materially affected</span>
            </div>
            <div className="row">
              <Badge tone="info">Normal</Badge>
              <span className="small muted">2 business days</span>
            </div>
            <div className="row">
              <Badge tone="neutral">Low</Badge>
              <span className="small muted">5 business days</span>
            </div>
          </div>
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

              updateTicket.mutate(
                {
                  id: working.id,
                  status: String(form.get('status')) as Ticket['status'],
                  priority: String(form.get('priority')) as Ticket['priority'],
                  assignedTo: assignee || null,
                  resolution: String(form.get('resolution') ?? '') || undefined,
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
                Raised by {working.clientName} · {humanize(working.category)}
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
                {crew.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                  </option>
                ))}
              </select>
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
                <input id="disp-date" name="date" className="input" type="date" required />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="disp-slot">
                  Time
                </label>
                <select id="disp-slot" name="slot" className="select" defaultValue="09:00">
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
