import { useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { StatTile } from '@/components/ui/StatTile'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/app/auth/useAuth'
import { currency, date as fmtDate, humanize, relative } from '@/lib/format'
import {
  useAddBlackout,
  useBlackouts,
  useEnquiries,
  useMarkEnquiry,
  useRemoveBlackout,
  useSetVisitStatus,
  useVisitRequests,
  type Enquiry,
} from '@/lib/queries/enquiries'

/* ============================================================================
   EnquiriesPage — everything a stranger sent us, and what was done about it.
   ----------------------------------------------------------------------------
   THE PROBLEM THIS SOLVES
   /contact and /booking both wrote complete leads from the day they were built.
   Nothing was ever lost. But the only screen that showed them was the CRM
   board, which shows a name, a stage and a score — and no email address, no
   phone number and not the message the person typed. So a rep could see that
   somebody wanted a quotation and had no way to answer them.

   TWO KINDS OF ENQUIRY, ONE PAGE, KEPT APART
   A quotation request is a message to answer. A visit request is a slot in the
   diary that needs confirming. They arrive from different forms and need
   different actions, so they are separate tabs rather than one merged list —
   but they belong on one page, because "what has come in from the website" is
   a single question a rep asks once a morning.

   WHY THERE IS NO "SEND QUOTATION" BUTTON
   This system does not send the quotation. The rep attaches a PDF in their own
   mail client, where they can write a covering note and see it in their sent
   items. Pretending otherwise would mean building a mail sender whose failures
   are invisible. What this page does is make the address one tap away, and
   record that it was done.
   ========================================================================== */

type Tab = 'quotes' | 'visits' | 'calendar'

const STATUS_TONE: Record<Enquiry['status'], 'neutral' | 'warning' | 'brand' | 'success'> = {
  new: 'warning',
  contacted: 'brand',
  quoted: 'brand',
  converted: 'success',
}

const STATUS_LABEL: Record<Enquiry['status'], string> = {
  new: 'Awaiting reply',
  contacted: 'Contacted',
  quoted: 'Quotation sent',
  converted: 'Became a customer',
}

export function EnquiriesPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('quotes')

  const enquiriesQuery = useEnquiries()
  const visitsQuery = useVisitRequests()
  const blackoutsQuery = useBlackouts()

  const mark = useMarkEnquiry()
  const setVisitStatus = useSetVisitStatus()
  const addBlackout = useAddBlackout()
  const removeBlackout = useRemoveBlackout()

  const enquiries = enquiriesQuery.data ?? []
  const visits = visitsQuery.data ?? []
  const blackouts = blackoutsQuery.data ?? []

  const awaiting = enquiries.filter((e) => e.status === 'new')
  const unconfirmed = visits.filter((v) => v.status === 'requested')

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

  return (
    <div className="stack">
      <PageHeader
        title="Enquiries"
        description="Quotation requests and visit bookings from the public website."
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
          label="Became customers"
          value={String(enquiries.filter((e) => e.status === 'converted').length)}
        />
      </div>

      <Tabs
        tabs={[
          { value: 'quotes' as Tab, label: `Quotation requests (${enquiries.length})` },
          { value: 'visits' as Tab, label: `Visit requests (${visits.length})` },
          { value: 'calendar' as Tab, label: 'Calendar availability' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ==================================================== QUOTATIONS */}
      {tab === 'quotes' && (
        <QueryState
          isLoading={enquiriesQuery.isLoading}
          error={enquiriesQuery.error as Error | null}
          isEmpty={enquiries.length === 0}
          emptyIcon="&#9993;"
          emptyTitle="No enquiries yet"
          emptyMessage="Requests from the contact form and the estimator arrive here."
        >
          <div className="stack">
            {enquiries.map((enquiry) => (
              <Card key={enquiry.id}>
                <CardBody>
                  <div className="row row--between row--wrap" style={{ gap: 'var(--space-3)' }}>
                    <div>
                      <div className="row" style={{ gap: 'var(--space-2)' }}>
                        <span className="strong">{enquiry.name}</span>
                        <Badge tone={STATUS_TONE[enquiry.status]}>
                          {STATUS_LABEL[enquiry.status]}
                        </Badge>
                        <Badge tone="neutral">{humanize(enquiry.source)}</Badge>
                      </div>
                      <div className="xs dim" style={{ marginTop: 'var(--space-1)' }}>
                        Received {relative(enquiry.createdAt)}
                      </div>
                    </div>

                    {/* The whole point of the page: the address, one tap away.
                        `mailto:` opens whatever they already use, with the
                        subject filled in. */}
                    <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <a
                        className="btn btn--outline btn--sm"
                        href={`mailto:${enquiry.email}?subject=${encodeURIComponent(
                          'Your solar quotation from SolarBros',
                        )}`}
                      >
                        ✉ Email
                      </a>
                      {enquiry.phone && (
                        <a className="btn btn--outline btn--sm" href={`tel:${enquiry.phone}`}>
                          ✆ Call
                        </a>
                      )}
                    </div>
                  </div>

                  {/* --------------------------------------- CONTACT */}
                  <div className="grid grid--3" style={{ marginTop: 'var(--space-4)' }}>
                    <div>
                      <div className="xs dim">Email</div>
                      <div className="small strong">{enquiry.email}</div>
                    </div>
                    <div>
                      <div className="xs dim">Phone</div>
                      <div className="small strong">{enquiry.phone ?? 'Not given'}</div>
                    </div>
                    <div>
                      <div className="xs dim">Monthly bill</div>
                      <div className="small strong">
                        {enquiry.monthlyBill ? currency(enquiry.monthlyBill) : 'Not given'}
                      </div>
                    </div>
                  </div>

                  {enquiry.address && (
                    <div style={{ marginTop: 'var(--space-3)' }}>
                      <div className="xs dim">Address</div>
                      <div className="small">{enquiry.address}</div>
                    </div>
                  )}

                  {/* What they actually wrote — nowhere else in the app shows
                      this, and it is the most useful thing they sent. */}
                  {enquiry.message && (
                    <div
                      style={{
                        marginTop: 'var(--space-3)',
                        padding: 'var(--space-3)',
                        background: 'var(--ink-50)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      <div className="xs dim">Their message</div>
                      <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                        {enquiry.message}
                      </p>
                    </div>
                  )}

                  {/* --------------------------------------- ACTIONS */}
                  <div
                    className="row row--wrap"
                    style={{ gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}
                  >
                    {!enquiry.firstContactedAt && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={mark.isPending}
                        onClick={() => mark.mutate({ leadId: enquiry.id, what: 'contacted' })}
                      >
                        Mark as contacted
                      </Button>
                    )}
                    {!enquiry.quotationSentAt && (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={mark.isPending}
                        onClick={() => mark.mutate({ leadId: enquiry.id, what: 'quoted' })}
                      >
                        I have sent the quotation
                      </Button>
                    )}
                    {enquiry.quotationSentAt && (
                      <span className="xs dim">
                        Quotation sent {relative(enquiry.quotationSentAt)}
                      </span>
                    )}
                    {enquiry.convertedClientId && (
                      <span className="xs dim">
                        This person has since registered — their account now holds this history.
                      </span>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </QueryState>
      )}

      {/* ======================================================== VISITS */}
      {tab === 'visits' && (
        <QueryState
          isLoading={visitsQuery.isLoading}
          error={visitsQuery.error as Error | null}
          isEmpty={visits.length === 0}
          emptyIcon="&#128197;"
          emptyTitle="No visits requested"
          emptyMessage="Bookings made on the public site appear here for confirmation."
        >
          <div className="stack">
            {visits.map((visit) => (
              <Card key={visit.id}>
                <CardBody>
                  <div className="row row--between row--wrap" style={{ gap: 'var(--space-3)' }}>
                    <div>
                      <div className="row" style={{ gap: 'var(--space-2)' }}>
                        <span className="strong">{visit.contactName ?? 'Someone'}</span>
                        <Badge tone={visit.status === 'requested' ? 'warning' : 'success'}>
                          {humanize(visit.status)}
                        </Badge>
                        <Badge tone="neutral">{humanize(visit.appointmentType)}</Badge>
                      </div>
                      <div className="small" style={{ marginTop: 'var(--space-1)' }}>
                        {fmtDate(visit.scheduledDate)} at {visit.timeSlot}
                      </div>
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

                  {visit.status === 'requested' && (
                    <div
                      className="row row--wrap"
                      style={{ gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}
                    >
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={setVisitStatus.isPending}
                        onClick={() => setVisitStatus.mutate({ id: visit.id, status: 'confirmed' })}
                      >
                        Confirm this visit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={setVisitStatus.isPending}
                        onClick={() =>
                          setVisitStatus.mutate({
                            id: visit.id,
                            status: 'cancelled',
                            reason: 'Declined from the enquiries inbox',
                          })
                        }
                      >
                        Decline
                      </Button>
                      <span className="xs dim">
                        Confirming puts it on the dispatch board for crew assignment.
                      </span>
                    </div>
                  )}
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
                calendar is drawn, so nobody can book a Sunday by other means.
              </p>
              <p className="small muted" style={{ marginTop: 'var(--space-3)' }}>
                Use the list below for one-off closures — public holidays, stock-take, a company
                outing. A closed date is greyed out on the public booking form whatever the weekday
                setting says.
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
    </div>
  )
}
