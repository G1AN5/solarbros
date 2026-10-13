import { type FormEvent, useRef, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { PageHeader } from '@/components/ui/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { QueryState } from '@/components/ui/QueryState'
import { TicketThread } from '@/components/ui/TicketThread'
import { humanize, relative } from '@/lib/format'
import { TICKET_PRIORITY_TONE, TICKET_STATUS_TONE } from '@/lib/labels'
import {
  useMyProject,
  useMyTickets,
  useRaiseTicket,
  useRateTicket,
} from '@/lib/queries/client-portal'
import { useCompany } from '@/lib/queries/public-site'
import { useClientUpload } from '@/lib/queries/storage'
import type { Ticket, TicketCategory, TicketPriority } from '@/types/domain'

/* ============================================================================
   ClientTicketsPage — the "Support ticketing page" from the spec.
   ----------------------------------------------------------------------------
   WHERE A TICKET GOES AFTER SUBMISSION

     /portal/tickets  ──creates──▶  tickets row (status: 'open')
              │
              ▼
     /admin/tickets   ──triaged──▶  assigned to an engineer
              │
              ▼ (if a site visit is needed)
     /admin/dispatch  ──creates──▶  appointment (type: 'repair')
              │
              ▼
     /field           ──technician attends, logs the fix
              │
              ▼
     back here        ──status: 'resolved', customer notified

   Photo upload matters: most hardware faults are diagnosable from a picture of
   the inverter's error screen, which avoids a wasted truck roll.
   ========================================================================== */

export function ClientTicketsPage() {
  const [composing, setComposing] = useState(false)
  const [raised, setRaised] = useState<string | null>(null)
  const ticketsQuery = useMyTickets()
  const clientTickets = ticketsQuery.data ?? []
  const raiseTicket = useRaiseTicket()
  /* "View thread" opened nothing, so a customer could raise a ticket and
     then had no way to add the photograph, serial number or clarification
     the office asks for next - the conversation moved to the phone and the
     ticket stopped being the record of it. */
  const [reading, setReading] = useState<Ticket | null>(null)

  /* The photo input said "strongly recommended" and threw the file away. It
     is the single most useful thing a customer can send: most inverter faults
     are diagnosable from a picture of the error screen, which saves a van. */
  const project = useMyProject().data
  const uploadPhoto = useClientUpload()
  const photosRef = useRef<HTMLInputElement>(null)

  /* Once a ticket is resolved the customer can say how it went. The column
     existed; nothing asked. */
  const rate = useRateTicket()
  const company = useCompany()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    raiseTicket.mutate(
      {
        subject: String(form.get('subject') ?? ''),
        description: String(form.get('description') ?? ''),
        category: String(form.get('category') ?? 'other') as TicketCategory,
        priority: String(form.get('priority') ?? 'normal') as TicketPriority,
      },
      {
        onSuccess: async (ticket) => {
          /* Photos are attached AFTER the ticket exists, because each one is
             filed against its id. A failed photo does not lose the ticket —
             the report is the important half, and the office can ask again. */
          const files = Array.from(photosRef.current?.files ?? [])
          if (ticket && project && files.length > 0) {
            for (const file of files) {
              try {
                await uploadPhoto.mutateAsync({
                  file,
                  projectId: project.id,
                  kind: 'other',
                  ticketId: ticket.id,
                })
              } catch {
                // Reported below through the mutation's own error state.
              }
            }
          }

          setComposing(false)
          setRaised(ticket?.reference ?? null)
        },
      },
    )
  }

  return (
    <>
      <PageHeader
        title="Support tickets"
        description="Report an issue and follow it through to resolution."
        breadcrumbs={[{ label: 'Portal', to: '/portal' }, { label: 'Support' }]}
        actions={
          <Button variant="primary" onClick={() => setComposing((c) => !c)}>
            {composing ? 'Cancel' : '+ New ticket'}
          </Button>
        }
      />

      {/* ------------------------------------------------ NEW TICKET */}
      {composing && (
        <Card accent style={{ marginBottom: 'var(--space-6)' }}>
          <CardHeader title="Raise a new support ticket" />
          <CardBody>
            <form className="stack" onSubmit={handleSubmit}>
              <div className="field">
                <label className="field__label" htmlFor="tsubject">
                  Subject
                </label>
                <input
                  id="tsubject"
                  name="subject"
                  className="input"
                  required
                  placeholder="Short summary of the issue"
                />
              </div>

              <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field__label" htmlFor="tcat">
                    Category
                  </label>
                  <select
                    id="tcat"
                    name="category"
                    className="select"
                    defaultValue="hardware_fault"
                  >
                    <option value="hardware_fault">Hardware fault</option>
                    <option value="performance">Performance / low output</option>
                    <option value="billing">Billing question</option>
                    <option value="maintenance">Maintenance request</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field__label" htmlFor="tpri">
                    Urgency
                  </label>
                  <select id="tpri" name="priority" className="select" defaultValue="normal">
                    <option value="low">Low — can wait</option>
                    <option value="normal">Normal</option>
                    <option value="high">High — affecting output</option>
                    <option value="urgent">Urgent — system is down</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="tdesc">
                  What is happening?
                </label>
                <textarea
                  id="tdesc"
                  name="description"
                  className="textarea"
                  required
                  placeholder="When did it start? Any error codes or warning lights? Has anything changed recently?"
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="tphoto">
                  Photos <span className="dim">(strongly recommended)</span>
                </label>
                <input
                  id="tphoto"
                  ref={photosRef}
                  className="input"
                  type="file"
                  multiple
                  accept="image/*"
                  disabled={!project}
                />
                <span className="field__hint">
                  A photo of the inverter screen or the affected hardware usually lets us diagnose
                  without a site visit.
                </span>
              </div>

              <FormError error={raiseTicket.error} />
              <FormError error={uploadPhoto.error} />

              <Button type="submit" variant="primary" disabled={raiseTicket.isPending}>
                {raiseTicket.isPending ? 'Submitting…' : 'Submit ticket'}
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      {raised && (
        <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--success-solid)' }}>
          <CardBody>
            <div className="row row--between">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.5rem' }}>✅</span>
                <div>
                  <h4 style={{ margin: 0 }}>Ticket {raised} raised</h4>
                  <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                    It is in our support queue now. The status changes here as we work on it, and
                    you will be notified when it is resolved.
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setRaised(null)}>
                Dismiss
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* -------------------------------------------- TICKET LIST */}
      <QueryState
        isLoading={ticketsQuery.isLoading}
        error={ticketsQuery.error as Error | null}
        isEmpty={clientTickets.length === 0}
        emptyIcon="🎫"
        emptyTitle="No tickets yet"
        emptyMessage="Raise one above if something is not working as it should."
        loadingLabel="Loading your tickets…"
      >
        <div className="stack">
          {clientTickets.map((ticket) => (
            <Card key={ticket.id} interactive>
              <CardBody>
                <div className="row row--between row--wrap" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <div className="row">
                      <code>{ticket.reference}</code>
                      <Badge tone={TICKET_PRIORITY_TONE[ticket.priority]}>
                        {humanize(ticket.priority)}
                      </Badge>
                      <Badge tone={TICKET_STATUS_TONE[ticket.status]}>
                        {humanize(ticket.status)}
                      </Badge>
                    </div>
                    <h4 style={{ marginTop: 'var(--space-2)' }}>{ticket.subject}</h4>
                    <p className="small dim" style={{ marginTop: 'var(--space-1)' }}>
                      Opened {relative(ticket.createdAt)} · Last update{' '}
                      {relative(ticket.lastUpdate)}
                      {ticket.assignedTo && ` · Assigned to ${ticket.assignedTo}`}
                    </p>

                    {/* The office writes this FOR the customer. It was being
                        stored and never shown to them, so a resolved ticket
                        said "Resolved" and nothing about what was done. */}
                    {ticket.resolution && (
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
                        <strong>What we did:</strong> {ticket.resolution}
                      </p>
                    )}

                    {(ticket.status === 'resolved' || ticket.status === 'closed') && (
                      <div
                        className="row row--wrap"
                        style={{ marginTop: 'var(--space-3)', gap: 4 }}
                      >
                        <span className="xs dim">
                          {ticket.satisfactionRating ? 'Your rating:' : 'How did we do?'}
                        </span>
                        {[1, 2, 3, 4, 5].map((stars) => (
                          <button
                            key={stars}
                            type="button"
                            className="star-button"
                            aria-label={`${stars} star${stars === 1 ? '' : 's'}`}
                            aria-pressed={(ticket.satisfactionRating ?? 0) >= stars}
                            disabled={rate.isPending}
                            onClick={() => rate.mutate({ ticketId: ticket.id, rating: stars })}
                          >
                            {(ticket.satisfactionRating ?? 0) >= stars ? '★' : '☆'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setReading(ticket)}>
                    View thread
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
        <FormError error={rate.error} />
      </QueryState>

      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardBody>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.5rem' }}>⚡</span>
            <div>
              <h4>System completely down?</h4>
              <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                Mark the ticket <strong>Urgent</strong> — those are looked at first during business
                hours. For anything involving sparks, burning smells or water ingress, switch off
                your AC disconnect and call us directly
                {company.phone ? (
                  <>
                    {' '}
                    on <a href={`tel:${company.phone.replace(/\s+/g, '')}`}>{company.phone}</a>
                  </>
                ) : null}
                .
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------ CONVERSATION */}
      <Modal
        open={reading !== null}
        onClose={() => setReading(null)}
        title={reading ? `${reading.reference} · ${reading.subject}` : 'Ticket'}
      >
        {reading && <TicketThread ticketId={reading.id} readOnly={reading.status === 'closed'} />}
      </Modal>
    </>
  )
}
