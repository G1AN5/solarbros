import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { StatTile } from '@/components/ui/StatTile'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/app/auth/useAuth'
import { currency, date as fmtDate, relative } from '@/lib/format'
import { APPOINTMENT_STATUS_LABEL, APPOINTMENT_TYPE_LABEL } from '@/lib/labels'
import {
  ORIGIN_LABEL,
  useAddBlackout,
  useBlackouts,
  useEnquiries,
  useMarkEnquiry,
  useRemoveBlackout,
  useSetVisitStatus,
  useVisitRequests,
  type Enquiry,
  type EnquiryOrigin,
  type VisitRequest,
} from '@/lib/queries/enquiries'
import { LeadDetails } from './LeadDetails'

/* ============================================================================
   EnquiriesPage — everything that came in, with everything it contained.
   ----------------------------------------------------------------------------
   THE PROBLEM THIS SOLVES
   The estimator, the contact form and the booking page all wrote complete
   records from the day they were built, but this page showed only the lead
   row: a name, an email, a phone number. The appliance list a visitor spent
   five minutes building, the system they were shown, the visit they asked for
   and whether they were already a customer were all in the database and on
   nobody's screen.

   Each enquiry now opens to the whole submission — see LeadDetails — and is
   labelled with the form it came from, so a rep can tell at a glance which
   need a reply, which need a visit confirming and which already have an
   account with a contract waiting.

   WHY THERE IS NO "SEND QUOTATION" BUTTON
   Quotations are built on the Quotations page, from the bill of materials.
   "Prepare a quotation" takes the rep there with this lead already chosen.
   The reply itself goes from the rep's own mail client; this page records that
   it happened.
   ========================================================================== */

type Tab = 'enquiries' | 'visits' | 'calendar'
type OriginFilter = 'all' | EnquiryOrigin
type StatusFilter = 'open' | Enquiry['status'] | 'all'

const STATUS_TONE: Record<
  Enquiry['status'],
  'neutral' | 'warning' | 'brand' | 'success' | 'danger'
> = {
  new: 'warning',
  contacted: 'brand',
  quoted: 'brand',
  won: 'success',
  lost: 'neutral',
}

const STATUS_LABEL: Record<Enquiry['status'], string> = {
  new: 'Awaiting reply',
  contacted: 'Contacted',
  quoted: 'Quotation sent',
  won: 'Contract signed',
  lost: 'Lost',
}

const ORIGIN_ICON: Record<EnquiryOrigin, string> = {
  estimator: '🧮',
  booking: '📅',
  contact: '✉',
  upgrade: '⬆',
  walk_in: '🚶',
  referral: '🤝',
  facebook: 'f',
}

const VISIT_ORIGIN_LABEL: Record<VisitRequest['origin'], string> = {
  public_booking: 'Booked on the website',
  customer_portal: 'Requested from the customer portal',
  office: 'Entered by the office',
}

export function EnquiriesPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('enquiries')
  const [origin, setOrigin] = useState<OriginFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [declining, setDeclining] = useState<VisitRequest | null>(null)

  const enquiriesQuery = useEnquiries()
  const visitsQuery = useVisitRequests()
  const blackoutsQuery = useBlackouts()

  const mark = useMarkEnquiry()
  const setVisitStatus = useSetVisitStatus()
  const addBlackout = useAddBlackout()
  const removeBlackout = useRemoveBlackout()

  const enquiries = useMemo(() => enquiriesQuery.data ?? [], [enquiriesQuery.data])
  const visits = visitsQuery.data ?? []
  const blackouts = blackoutsQuery.data ?? []

  const awaiting = enquiries.filter((e) => e.status === 'new')
  const unconfirmed = visits.filter((v) => v.status === 'requested')

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return enquiries.filter((e) => {
      if (origin !== 'all' && e.origin !== origin) return false
      if (statusFilter === 'open' && (e.status === 'won' || e.status === 'lost')) return false
      if (statusFilter !== 'open' && statusFilter !== 'all' && e.status !== statusFilter) {
        return false
      }
      if (!term) return true
      return [e.name, e.email, e.phone ?? '', e.location ?? '', e.address ?? '', e.message ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [enquiries, origin, statusFilter, search])

  function countOf(o: EnquiryOrigin) {
    return enquiries.filter((e) => e.origin === o).length
  }

  function handleAddBlackout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const day = String(data.get('date') ?? '')
    if (!day) return
    addBlackout.mutate(
      { date: day, reason: String(data.get('reason') ?? '') },
      { onSuccess: () => form.reset() },
    )
  }

  function handleDecline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!declining) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim()
    setVisitStatus.mutate(
      {
        id: declining.id,
        status: 'cancelled',
        reason: reason || 'Declined from the enquiries inbox',
      },
      { onSuccess: () => setDeclining(null) },
    )
  }

  return (
    <div className="stack">
      <PageHeader
        title="Enquiries"
        description="Everything sent from the estimator, the contact form and the booking page — in full."
      />

      <FormError
        error={mark.error ?? setVisitStatus.error ?? addBlackout.error ?? removeBlackout.error}
      />

      <div className="grid grid--4">
        <StatTile
          label="Awaiting a reply"
          value={String(awaiting.length)}
          delta={awaiting.length > 0 ? 'Nobody has answered these' : 'All answered'}
          direction={awaiting.length > 0 ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile label="Visits to confirm" value={String(unconfirmed.length)} />
        <StatTile
          label="Quotations sent"
          value={String(enquiries.filter((e) => e.status === 'quoted').length)}
        />
        <StatTile
          label="Contracts signed"
          value={String(enquiries.filter((e) => e.status === 'won').length)}
        />
      </div>

      <Tabs
        tabs={[
          { value: 'enquiries' as Tab, label: 'All enquiries', count: enquiries.length },
          { value: 'visits' as Tab, label: 'Visit requests', count: visits.length },
          { value: 'calendar' as Tab, label: 'Calendar availability' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ==================================================== ENQUIRIES */}
      {tab === 'enquiries' && (
        <>
          <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
            {(
              [
                ['all', `All (${enquiries.length})`],
                ['estimator', `🧮 Estimator (${countOf('estimator')})`],
                ['contact', `✉ Contact form (${countOf('contact')})`],
                ['booking', `📅 Book a visit (${countOf('booking')})`],
                ['upgrade', `⬆ Upgrades (${countOf('upgrade')})`],
                ['walk_in', `🚶 Walk-in (${countOf('walk_in')})`],
              ] as [OriginFilter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`btn btn--sm ${origin === value ? 'btn--dark' : 'btn--outline'}`}
                onClick={() => setOrigin(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="row row--wrap" style={{ gap: 'var(--space-3)' }}>
            <input
              className="input"
              style={{ maxWidth: 320 }}
              placeholder="Search name, email, phone, message…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search enquiries"
            />
            <select
              className="select"
              style={{ width: 'auto' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Filter by status"
            >
              <option value="open">Still open</option>
              <option value="new">Awaiting reply</option>
              <option value="contacted">Contacted</option>
              <option value="quoted">Quotation sent</option>
              <option value="won">Contract signed</option>
              <option value="lost">Lost</option>
              <option value="all">Everything</option>
            </select>
          </div>

          <QueryState
            isLoading={enquiriesQuery.isLoading}
            error={enquiriesQuery.error as Error | null}
            isEmpty={visible.length === 0}
            emptyIcon="&#9993;"
            emptyTitle={enquiries.length === 0 ? 'No enquiries yet' : 'Nothing matches'}
            emptyMessage={
              enquiries.length === 0
                ? 'Submissions from the estimator, the contact form and the booking page arrive here.'
                : 'Try a different filter or search.'
            }
          >
            <div className="stack">
              {visible.map((enquiry) => {
                const isOpen = expanded === enquiry.id
                const latestEstimate = enquiry.estimates[0]
                const latestVisit = enquiry.visits[0]

                return (
                  <Card key={enquiry.id}>
                    <CardBody>
                      <div className="row row--between row--wrap" style={{ gap: 'var(--space-3)' }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
                            <span className="strong">{enquiry.name}</span>
                            <Badge tone={STATUS_TONE[enquiry.status]}>
                              {STATUS_LABEL[enquiry.status]}
                            </Badge>
                            <Badge tone="neutral">
                              {ORIGIN_ICON[enquiry.origin]} {ORIGIN_LABEL[enquiry.origin]}
                            </Badge>
                            {enquiry.account && <Badge tone="success">Has an account</Badge>}
                          </div>
                          <div className="xs dim" style={{ marginTop: 'var(--space-1)' }}>
                            {enquiry.email}
                            {enquiry.phone ? ` · ${enquiry.phone}` : ''} · received{' '}
                            {relative(enquiry.createdAt)}
                            {enquiry.ownerName ? ` · owner ${enquiry.ownerName}` : ''}
                          </div>

                          {/* The one line that says what they actually want. */}
                          <div className="small" style={{ marginTop: 'var(--space-2)' }}>
                            {latestEstimate
                              ? `Estimator: ${latestEstimate.recommendedKw ?? '—'} kWp, ${
                                  latestEstimate.appliances.length
                                } appliance${latestEstimate.appliances.length === 1 ? '' : 's'}, shown ${
                                  latestEstimate.estimatedCost !== null
                                    ? currency(latestEstimate.estimatedCost)
                                    : '—'
                                }`
                              : latestVisit
                                ? `${APPOINTMENT_TYPE_LABEL[latestVisit.type]} on ${fmtDate(
                                    latestVisit.date,
                                  )} at ${latestVisit.timeSlot} — ${APPOINTMENT_STATUS_LABEL[
                                    latestVisit.status
                                  ].toLowerCase()}`
                                : enquiry.message
                                  ? `“${enquiry.message.slice(0, 160)}${enquiry.message.length > 160 ? '…' : ''}”`
                                  : enquiry.monthlyBill
                                    ? `Monthly bill ${currency(enquiry.monthlyBill)}`
                                    : 'No message'}
                          </div>
                        </div>

                        <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
                          <a
                            className="btn btn--outline btn--sm"
                            href={`mailto:${enquiry.email}?subject=${encodeURIComponent(
                              'Your solar enquiry with SolarBros',
                            )}`}
                          >
                            ✉ Email
                          </a>
                          {enquiry.phone && (
                            <a className="btn btn--outline btn--sm" href={`tel:${enquiry.phone}`}>
                              ✆ Call
                            </a>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpanded(isOpen ? null : enquiry.id)}
                            aria-expanded={isOpen}
                          >
                            {isOpen ? 'Hide details' : 'Full details'}
                          </Button>
                        </div>
                      </div>

                      {isOpen && (
                        <div style={{ marginTop: 'var(--space-4)' }}>
                          <LeadDetails enquiry={enquiry} />
                        </div>
                      )}

                      {/* --------------------------------------- ACTIONS */}
                      {enquiry.status !== 'won' && enquiry.status !== 'lost' && (
                        <div
                          className="row row--wrap"
                          style={{ gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}
                        >
                          {!enquiry.firstContactedAt && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={mark.isPending}
                              onClick={() =>
                                mark.mutate({
                                  leadId: enquiry.id,
                                  what: 'contacted',
                                  stage: enquiry.stage,
                                })
                              }
                            >
                              Mark as contacted
                            </Button>
                          )}
                          <Link
                            className="btn btn--primary btn--sm"
                            to={`/admin/quotes?lead=${enquiry.id}`}
                          >
                            Prepare a quotation
                          </Link>
                          {!enquiry.quotationSentAt && enquiry.quotations.length === 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={mark.isPending}
                              title="For a quotation you sent from your own email, outside the system"
                              onClick={() =>
                                mark.mutate({
                                  leadId: enquiry.id,
                                  what: 'quoted',
                                  stage: enquiry.stage,
                                })
                              }
                            >
                              I sent a quotation by email
                            </Button>
                          )}
                          {enquiry.quotationSentAt && (
                            <span className="xs dim">
                              Quotation sent {relative(enquiry.quotationSentAt)}
                            </span>
                          )}
                        </div>
                      )}
                    </CardBody>
                  </Card>
                )
              })}
            </div>
          </QueryState>
        </>
      )}

      {/* ======================================================== VISITS */}
      {tab === 'visits' && (
        <QueryState
          isLoading={visitsQuery.isLoading}
          error={visitsQuery.error as Error | null}
          isEmpty={visits.length === 0}
          emptyIcon="&#128197;"
          emptyTitle="No visits waiting"
          emptyMessage="Bookings from the website and visit requests from customers appear here for confirmation."
        >
          <div className="stack">
            {visits.map((visit) => (
              <Card key={visit.id}>
                <CardBody>
                  <div className="row row--between row--wrap" style={{ gap: 'var(--space-3)' }}>
                    <div>
                      <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
                        <span className="strong">
                          {visit.accountName ?? visit.contactName ?? 'Someone'}
                        </span>
                        <Badge tone={visit.status === 'requested' ? 'warning' : 'success'}>
                          {APPOINTMENT_STATUS_LABEL[visit.status]}
                        </Badge>
                        <Badge tone="neutral">
                          {APPOINTMENT_TYPE_LABEL[visit.appointmentType]}
                        </Badge>
                        {visit.accountName && <Badge tone="success">Customer account</Badge>}
                      </div>
                      <div className="small" style={{ marginTop: 'var(--space-1)' }}>
                        {fmtDate(visit.scheduledDate)} at {visit.timeSlot}
                        {visit.projectReference ? ` · project ${visit.projectReference}` : ''}
                      </div>
                      <div className="xs dim">{VISIT_ORIGIN_LABEL[visit.origin]}</div>
                    </div>

                    <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      {visit.email && (
                        <a className="btn btn--outline btn--sm" href={`mailto:${visit.email}`}>
                          ✉ Email
                        </a>
                      )}
                      {visit.contactPhone && (
                        <a className="btn btn--outline btn--sm" href={`tel:${visit.contactPhone}`}>
                          ✆ Call
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="grid grid--3" style={{ marginTop: 'var(--space-4)' }}>
                    <div>
                      <div className="xs dim">Email</div>
                      <div className="small strong">{visit.email ?? 'Not given'}</div>
                    </div>
                    <div>
                      <div className="xs dim">Phone</div>
                      <div className="small strong">{visit.contactPhone ?? 'Not given'}</div>
                    </div>
                    <div>
                      <div className="xs dim">Requested</div>
                      <div className="small strong">{relative(visit.createdAt)}</div>
                    </div>
                  </div>

                  {visit.address && (
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <div className="xs dim">Address</div>
                      <div className="small">{visit.address}</div>
                    </div>
                  )}

                  {visit.notes && (
                    <div
                      style={{
                        marginTop: 'var(--space-3)',
                        padding: 'var(--space-3)',
                        background: 'var(--ink-50)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      <div className="xs dim">Their note</div>
                      <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                        {visit.notes}
                      </p>
                    </div>
                  )}

                  <div
                    className="row row--wrap"
                    style={{ gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}
                  >
                    {visit.status === 'requested' && (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={setVisitStatus.isPending}
                          onClick={() =>
                            setVisitStatus.mutate({ id: visit.id, status: 'confirmed' })
                          }
                        >
                          Confirm this visit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={setVisitStatus.isPending}
                          onClick={() => setDeclining(visit)}
                        >
                          Decline…
                        </Button>
                      </>
                    )}
                    <Link className="btn btn--outline btn--sm" to="/admin/dispatch">
                      Assign a crew on the Dispatch board →
                    </Link>
                    <span className="xs dim">
                      Confirming tells the customer; assigning a crew puts it on a technician&apos;s
                      Today list.
                    </span>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </QueryState>
      )}

      {/* ====================================================== CALENDAR */}
      {tab === 'calendar' && (
        <div className="stack">
          <Card>
            <CardHeader title="Which days can prospects book?" />
            <CardBody>
              <p className="small muted">
                The times of day and the days of the week you work are in{' '}
                <strong>Business Settings → Operations</strong>: “Bookable times” and “Days of the
                week worked”. Both are enforced when a booking is submitted, not only when the
                calendar is drawn, so nobody can book a closed day by other means.
              </p>
              <p className="small muted" style={{ marginTop: 'var(--space-3)' }}>
                Use the list below for one-off closures — public holidays, stock-take, a company
                outing. A closed date is greyed out on the public booking calendar.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Closed dates" />
            <CardBody>
              <form
                onSubmit={handleAddBlackout}
                className="row row--wrap"
                style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}
              >
                <div className="field" style={{ marginBottom: 0 }}>
                  <label className="field__label" htmlFor="blackoutDate">
                    Date
                  </label>
                  <input
                    id="blackoutDate"
                    name="date"
                    type="date"
                    className="input"
                    required
                    min={new Date().toISOString().slice(0, 10)}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
                  <label className="field__label" htmlFor="blackoutReason">
                    Reason (optional)
                  </label>
                  <input
                    id="blackoutReason"
                    name="reason"
                    className="input"
                    placeholder="e.g. Public holiday"
                    maxLength={120}
                  />
                </div>
                <Button type="submit" variant="primary" disabled={addBlackout.isPending}>
                  Close this date
                </Button>
              </form>

              <div className="stack stack--sm" style={{ marginTop: 'var(--space-5)' }}>
                {blackouts.length === 0 && (
                  <p className="small muted">
                    No closed dates. Bookings follow the weekday setting alone.
                  </p>
                )}
                {blackouts.map((blackout) => (
                  <div key={blackout.date} className="row row--between">
                    <div>
                      <span className="small strong">{fmtDate(blackout.date)}</span>
                      {blackout.reason && <span className="xs dim"> · {blackout.reason}</span>}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={removeBlackout.isPending}
                      onClick={() => removeBlackout.mutate(blackout.date)}
                    >
                      Reopen
                    </Button>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {user?.role !== 'admin' && (
            <p className="xs dim">
              Business Settings are administrator-only; ask an administrator to change the working
              days or bookable times.
            </p>
          )}
        </div>
      )}

      {/* ------------------------------------------------ DECLINE A VISIT */}
      <Modal
        open={declining !== null}
        onClose={() => setDeclining(null)}
        title="Decline this visit request"
      >
        {declining && (
          <form className="stack" onSubmit={handleDecline}>
            <p className="small muted">
              {declining.accountName ?? declining.contactName ?? 'The customer'} asked for a{' '}
              {APPOINTMENT_TYPE_LABEL[declining.appointmentType].toLowerCase()} on{' '}
              {fmtDate(declining.scheduledDate)} at {declining.timeSlot}. They are told it was
              declined, with the reason below.
            </p>
            <div className="field">
              <label className="field__label" htmlFor="decline-reason">
                Reason
              </label>
              <input
                id="decline-reason"
                name="reason"
                className="input"
                placeholder="e.g. Outside our service area — we will call you to discuss"
                maxLength={200}
              />
            </div>
            <FormError error={setVisitStatus.error} />
            <Button type="submit" variant="primary" block disabled={setVisitStatus.isPending}>
              Decline and tell them
            </Button>
          </form>
        )}
      </Modal>
    </div>
  )
}
