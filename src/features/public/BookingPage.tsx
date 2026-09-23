import { type FormEvent, useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { APPOINTMENT_TYPE_LABEL } from '@/lib/labels'
import { useAvailableSlots, useRequestBooking } from '@/lib/queries/public-forms'
import type { AppointmentType } from '@/types/domain'
import { PageBanner } from '@/components/layout/PageBanner'
import { Loader } from '@/components/ui/Loader'

/* ============================================================================
   BookingPage — Self-Service Appointment & Consultation Booking.
   ----------------------------------------------------------------------------
   The spec listed a "calendar scheduling system" under all four portals. They
   are ONE system with four views; this is the public entry point:

     public /booking  ─── creates ──▶ appointment (status: 'requested')
                                          │
                                          ▼
     admin /dispatch  ─── assigns staff ──▶ status: 'dispatched'
                                          │
                                          ▼
     field /field     ─── technician sees it on their Today list
                                          │
                                          ▼
     client /portal/appointments ─── customer sees the confirmation

   Only two appointment types are bookable publicly (consultation and survey).
   Installation and maintenance dates are scheduled from inside the client
   portal, because they require an active project.

   SLOT AVAILABILITY IS REAL, AND IT IS CHECKED TWICE.
   `available_slots` counts what is already booked and returns a slot plus a
   yes/no — never who is in it, because this page is public and the count would
   otherwise expose the company's whole diary.

   That answer is ADVISORY. Anyone can call the endpoint and ignore it, so
   `request_booking` counts again inside the write. Two visitors looking at the
   same free slot is ordinary, and the second one has to be refused rather than
   both being promised the same 9am.
   ========================================================================== */

const BOOKABLE_TYPES: AppointmentType[] = ['virtual_consultation', 'site_survey']

const TIME_SLOTS = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00']

/* Today is captured once when the module loads rather than on every render.
   Reading the clock during render makes a component impure, and a fresh `new
   Date()` each pass would also invalidate the useMemo below every time. A
   booking calendar does not need to notice midnight passing mid-session. */
const TODAY = new Date()

export function BookingPage() {
  const [type, setType] = useState<AppointmentType>('virtual_consultation')
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const book = useRequestBooking()

  /* The calendar only shows the current month, so the date is assembled from
     today's year and month plus the day clicked — as a plain YYYY-MM-DD string,
     not via toISOString(), which converts to UTC and would ask about the wrong
     day for an evening slot in Manila. */
  const selectedDate =
    selectedDay === null
      ? undefined
      : `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(
          selectedDay,
        ).padStart(2, '0')}`

  const slotsQuery = useAvailableSlots(selectedDate)
  const slots = slotsQuery.data ?? []

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedDay === null || selectedSlot === null) return

    const form = new FormData(event.currentTarget)

    book.mutate(
      {
        type: type as 'virtual_consultation' | 'site_survey',
        date: selectedDate!,
        timeSlot: selectedSlot,
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        phone: String(form.get('phone') ?? ''),
        address: String(form.get('address') ?? ''),
        notes: String(form.get('notes') ?? ''),
      },
      { onSuccess: () => setConfirmed(true) },
    )
  }

  // Build the current month's grid, with leading blanks so the 1st lands on the
  // correct weekday column.
  const { daysInMonth, leadingBlanks, monthLabel } = useMemo(() => {
    const year = TODAY.getFullYear()
    const month = TODAY.getMonth()
    return {
      daysInMonth: new Date(year, month + 1, 0).getDate(),
      leadingBlanks: new Date(year, month, 1).getDay(),
      monthLabel: TODAY.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }),
    }
  }, [])

  if (confirmed) {
    return (
      <div className="section">
        <div className="container container--narrow center">
          <div style={{ fontSize: '3rem' }}>✅</div>
          <h1 style={{ marginBlock: 'var(--space-4)' }}>Booking requested</h1>
          <p className="muted">
            Your {APPOINTMENT_TYPE_LABEL[type].toLowerCase()} is pencilled in for{' '}
            <strong>
              {monthLabel.split(' ')[0]} {selectedDay}
            </strong>{' '}
            at <strong>{selectedSlot}</strong>. We will confirm by email and SMS within one business
            day once a team member is assigned.
          </p>
          <p className="xs dim" style={{ marginTop: 'var(--space-6)' }}>
            Reference: your request is now on our dispatch board awaiting a team member. Nothing is
            confirmed until you hear from us.
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
                              ? '30 min · Google Meet · discuss sizing and budget'
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
                <CardHeader title={`2. Pick a date — ${monthLabel}`} />
                <CardBody>
                  <div className="cal">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                      <div key={d} className="cal__dow">
                        {d}
                      </div>
                    ))}

                    {/* Empty cells before the 1st of the month. */}
                    {Array.from({ length: leadingBlanks }, (_, i) => (
                      <div key={`blank-${i}`} />
                    ))}

                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1
                      // Past dates and Sundays are not bookable.
                      const isPast = day < TODAY.getDate()
                      const isSunday = (leadingBlanks + i) % 7 === 0
                      return (
                        <button
                          key={day}
                          className={`cal__day${selectedDay === day ? ' is-selected' : ''}`}
                          disabled={isPast || isSunday}
                          onClick={() => {
                            setSelectedDay(day)
                            setSelectedSlot(null)
                          }}
                        >
                          {day}
                        </button>
                      )
                    })}
                  </div>
                  <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
                    Closed Sundays. Slots shown are in Philippine time (GMT+8).
                  </p>
                </CardBody>
              </Card>
            </div>

            {/* --------------------------------------- 3. SLOT + DETAILS */}
            <div className="stack">
              <Card>
                <CardHeader title="3. Choose a time" />
                <CardBody>
                  {selectedDay === null ? (
                    <p className="muted small">Select a date first to see available times.</p>
                  ) : slotsQuery.isLoading ? (
                    <Loader label="Checking what is free…" />
                  ) : (
                    <div className="slot-grid">
                      {(slots.length > 0
                        ? slots
                        : TIME_SLOTS.map((slot) => ({ slot, available: false, remaining: 0 }))
                      ).map(({ slot, available, remaining }) => (
                        <button
                          key={slot}
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
                      disabled={selectedDay === null || selectedSlot === null || book.isPending}
                    >
                      {book.isPending
                        ? 'Requesting…'
                        : selectedSlot
                          ? `Confirm ${selectedSlot} booking`
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
