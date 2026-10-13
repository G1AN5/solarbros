import { type FormEvent, useMemo, useState } from 'react'

import { useAuth } from '@/app/auth/useAuth'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { date as formatDate } from '@/lib/format'
import { APPOINTMENT_TYPE_LABEL } from '@/lib/labels'
import { useAvailableSlots, useClosedDates, useRequestBooking } from '@/lib/queries/public-forms'
import { settingText, useSettings } from '@/lib/queries/settings'
import type { AppointmentType } from '@/types/domain'
import { PageBanner } from '@/components/layout/PageBanner'
import { Loader } from '@/components/ui/Loader'

/* ============================================================================
   BookingPage — Self-Service Appointment & Consultation Booking.
   ----------------------------------------------------------------------------
   The spec listed a "calendar scheduling system" under all four portals. They
   are ONE system with four views; this is the public entry point:

     public /booking  ─── creates ──▶ enquiry + appointment (status: 'requested')
                                          │
                                          ▼
     admin /enquiries ─── sales confirms the time ──▶ 'confirmed'
     admin /dispatch  ─── assigns a crew ──▶ 'dispatched'
                                          │
                                          ▼
     field /field     ─── technician sees it on their Today list
                                          │
                                          ▼
     client /portal   ─── the customer sees it, once they have an account
                          with the same email address

   Only two appointment types are bookable publicly (consultation and survey).
   Installation and maintenance dates are scheduled from inside the client
   portal, because they require an active project.

   THE CALENDAR IS THE BUSINESS'S
   It showed the current month only — so on the 28th there were three days to
   choose from — and greyed out Sundays by arithmetic, whatever the company had
   set. It now runs six months ahead, and closed weekdays and holiday dates
   come from the same settings and blackout list the server checks against.

   SLOT AVAILABILITY IS REAL, AND IT IS CHECKED TWICE.
   `available_slots` counts what is already booked and returns a slot plus a
   yes/no — never who is in it. That answer is ADVISORY: `request_booking`
   counts again inside the write, so the second of two people pressing the
   same 9am is refused rather than both being promised it.
   ========================================================================== */

const BOOKABLE_TYPES: AppointmentType[] = ['virtual_consultation', 'site_survey']

/** How far ahead a visit may be booked — the server refuses beyond 180 days. */
const MONTHS_AHEAD = 5

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* Captured once per page load rather than on every render: reading the clock
   during render makes a component impure, and a booking calendar does not need
   to notice midnight passing mid-session. */
const TODAY = new Date()
const TODAY_ISO = iso(TODAY)
const LAST_ISO = iso(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + 180))

export function BookingPage() {
  const { user } = useAuth()
  const [type, setType] = useState<AppointmentType>('virtual_consultation')
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const book = useRequestBooking()

  const settings = useSettings().data
  const workedDays = settingText(settings, 'operations.booking_weekdays', '1,2,3,4,5,6')
    .split(',')
    .map((d) => Number(d.trim()))
    .filter((d) => d >= 1 && d <= 7)
  const closedDates = new Set(useClosedDates().data ?? [])
  const closedWeekdays = [1, 2, 3, 4, 5, 6, 7].filter((d) => !workedDays.includes(d))

  const slotsQuery = useAvailableSlots(selectedDate)
  const slots = slotsQuery.data ?? []

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedDate || selectedSlot === null) return

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')

    book.mutate(
      {
        type: type as 'virtual_consultation' | 'site_survey',
        date: selectedDate,
        timeSlot: selectedSlot,
        name: String(form.get('name') ?? ''),
        email,
        phone: String(form.get('phone') ?? ''),
        address: String(form.get('address') ?? ''),
        notes: String(form.get('notes') ?? ''),
      },
      {
        onSuccess: () => {
          setSentTo(email)
          setConfirmed(true)
          // The confirmation is short; without this it opens scrolled to the footer.
          window.scrollTo({ top: 0 })
        },
      },
    )
  }

  // The month on show, with leading blanks so the 1st lands on its weekday.
  const { cells, monthLabel } = useMemo(() => {
    const first = new Date(TODAY.getFullYear(), TODAY.getMonth() + monthOffset, 1)
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const days = Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(first.getFullYear(), first.getMonth(), i + 1)
      return { day: i + 1, iso: iso(d), isoWeekday: d.getDay() === 0 ? 7 : d.getDay() }
    })
    return {
      cells: { leadingBlanks: first.getDay(), days },
      monthLabel: first.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
    }
  }, [monthOffset])

  if (confirmed) {
    return (
      <div className="section">
        <div className="container container--narrow center">
          <div style={{ fontSize: '3rem' }}>✅</div>
          <h1 style={{ marginBlock: 'var(--space-4)' }}>Booking requested</h1>
          <p className="muted">
            Your {APPOINTMENT_TYPE_LABEL[type].toLowerCase()} is pencilled in for{' '}
            <strong>{selectedDate ? formatDate(selectedDate) : ''}</strong> at{' '}
            <strong>{selectedSlot}</strong>. We will confirm it within one business day
            {sentTo ? (
              <>
                , by phone or by email to <strong>{sentTo}</strong>
              </>
            ) : null}
            .
          </p>
          <p className="small muted" style={{ marginTop: 'var(--space-4)' }}>
            {user
              ? 'It is on your account too — see Appointments in your portal.'
              : 'Create a free account with the same email address to follow it, and everything after it, from your own portal.'}
          </p>
          <p className="xs dim" style={{ marginTop: 'var(--space-6)' }}>
            Nothing is confirmed until you hear from us.
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <PageBanner
        eyebrow="Free consultation"
        title="Book a visit"
        lead="Pick a slot that suits you. Virtual consultations run about 30 minutes; on-site surveys take 1-2 hours. Both are free and carry no obligation."
      />

      <div className="section section--muted">
        <div className="container">
          <div className="grid grid--2" style={{ alignItems: 'start' }}>
            <div className="stack">
              {/* -------------------------------------------- 1. TYPE */}
              <Card>
                <CardHeader title="1. What do you need?" />
                <CardBody>
                  <div className="stack stack--sm">
                    {BOOKABLE_TYPES.map((t) => (
                      <label
                        key={t}
                        className="row"
                        style={{
                          padding: 'var(--space-3)',
                          border: `1px solid ${type === t ? 'var(--brand-500)' : 'var(--border)'}`,
                          background: type === t ? 'var(--brand-50)' : 'transparent',
                          borderRadius: 'var(--radius)',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="radio"
                          name="apptType"
                          checked={type === t}
                          onChange={() => setType(t)}
                        />
                        <span>
                          <span className="strong">{APPOINTMENT_TYPE_LABEL[t]}</span>
                          <span className="small dim" style={{ display: 'block' }}>
                            {t === 'virtual_consultation'
                              ? '30 min · video call · discuss sizing and budget'
                              : '1–2 hrs · at your property · roof measurement and structural check'}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </CardBody>
              </Card>

              {/* -------------------------------------------- 2. DATE */}
              <Card>
                <CardHeader
                  title={`2. Pick a date — ${monthLabel}`}
                  action={
                    <div className="row" style={{ gap: 4 }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={monthOffset === 0}
                        onClick={() => setMonthOffset((m) => m - 1)}
                        aria-label="Previous month"
                      >
                        ‹
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={monthOffset >= MONTHS_AHEAD}
                        onClick={() => setMonthOffset((m) => m + 1)}
                        aria-label="Next month"
                      >
                        ›
                      </Button>
                    </div>
                  }
                />
                <CardBody>
                  <div className="cal">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                      <div key={d} className="cal__dow">
                        {d}
                      </div>
                    ))}

                    {Array.from({ length: cells.leadingBlanks }, (_, i) => (
                      <div key={`blank-${i}`} />
                    ))}

                    {cells.days.map(({ day, iso: dayIso, isoWeekday }) => {
                      const closed =
                        dayIso < TODAY_ISO ||
                        dayIso > LAST_ISO ||
                        !workedDays.includes(isoWeekday) ||
                        closedDates.has(dayIso)
                      return (
                        <button
                          key={dayIso}
                          type="button"
                          className={`cal__day${selectedDate === dayIso ? ' is-selected' : ''}`}
                          disabled={closed}
                          onClick={() => {
                            setSelectedDate(dayIso)
                            setSelectedSlot(null)
                          }}
                          aria-label={formatDate(dayIso)}
                        >
                          {day}
                        </button>
                      )
                    })}
                  </div>
                  <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
                    {closedWeekdays.length > 0
                      ? `Closed ${closedWeekdays.map((d) => WEEKDAY_NAMES[d - 1]).join(' and ')}s and on public holidays. `
                      : 'Closed on public holidays. '}
                    Times are Philippine time (GMT+8).
                  </p>
                </CardBody>
              </Card>
            </div>

            {/* --------------------------------------- 3. SLOT + DETAILS */}
            <div className="stack">
              <Card>
                <CardHeader title="3. Choose a time" />
                <CardBody>
                  {!selectedDate ? (
                    <p className="muted small">Select a date first to see available times.</p>
                  ) : slotsQuery.isLoading ? (
                    <Loader label="Checking what is free…" />
                  ) : slots.every((s) => !s.available) ? (
                    <p className="muted small">
                      Nothing is free on {formatDate(selectedDate)} — it may be fully booked or too
                      soon to arrange. Please pick another day.
                    </p>
                  ) : (
                    <div className="slot-grid">
                      {slots.map(({ slot, available, remaining }) => (
                        <button
                          key={slot}
                          type="button"
                          className={`slot${selectedSlot === slot ? ' is-selected' : ''}`}
                          disabled={!available}
                          onClick={() => setSelectedSlot(slot)}
                          title={
                            available
                              ? `${remaining} place${remaining === 1 ? '' : 's'} left`
                              : 'Fully booked, or too soon to staff'
                          }
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="4. Your details" />
                <CardBody>
                  <form className="stack" onSubmit={handleSubmit}>
                    <div className="field">
                      <label className="field__label" htmlFor="name">
                        Full name
                      </label>
                      <input
                        id="name"
                        name="name"
                        className="input"
                        required
                        autoComplete="name"
                        defaultValue={user?.fullName ?? ''}
                        placeholder="Juan Dela Cruz"
                      />
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="bemail">
                        Email
                      </label>
                      <input
                        id="bemail"
                        name="email"
                        className="input"
                        type="email"
                        required
                        autoComplete="email"
                        defaultValue={user?.email ?? ''}
                        placeholder="you@email.com"
                      />
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="phone">
                        Mobile number
                      </label>
                      <input
                        id="phone"
                        name="phone"
                        className="input"
                        required
                        autoComplete="tel"
                        defaultValue={user?.phone ?? ''}
                        placeholder="+63 9XX XXX XXXX"
                      />
                    </div>
                    {type === 'site_survey' && (
                      <div className="field">
                        <label className="field__label" htmlFor="addr">
                          Property address
                        </label>
                        <textarea
                          id="addr"
                          name="address"
                          className="textarea"
                          required
                          defaultValue={user?.address ?? ''}
                          placeholder="House no., street, barangay, city"
                        />
                      </div>
                    )}
                    <div className="field">
                      <label className="field__label" htmlFor="notes">
                        Anything we should know? <span className="dim">(optional)</span>
                      </label>
                      <textarea
                        id="notes"
                        name="notes"
                        className="textarea"
                        placeholder="e.g. two-storey, metal roof, frequent brownouts"
                      />
                    </div>

                    <FormError error={book.error} />

                    <Button
                      type="submit"
                      variant="primary"
                      block
                      size="lg"
                      disabled={!selectedDate || selectedSlot === null || book.isPending}
                    >
                      {book.isPending
                        ? 'Requesting…'
                        : selectedSlot && selectedDate
                          ? `Request ${formatDate(selectedDate)} at ${selectedSlot}`
                          : 'Select a date and time first'}
                    </Button>
                  </form>
                </CardBody>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
