import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { currency, date as fmtDate, dateTime, humanize, number } from '@/lib/format'
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_TONE,
  APPOINTMENT_TYPE_LABEL,
  CONTRACT_STATUS_LABEL,
  CONTRACT_STATUS_TONE,
  LEAD_STAGE_LABEL,
  QUOTATION_STATUS_TONE,
  SYSTEM_TYPE_LABEL,
} from '@/lib/labels'
import { ORIGIN_LABEL, type Enquiry, type EstimateDetail } from '@/lib/queries/enquiries'

/* ============================================================================
   LeadDetails — everything a person has sent us, and everything since.
   ----------------------------------------------------------------------------
   One component for the Enquiries inbox and the CRM, because they are two
   views of the same person and must not disagree about them.

   WHAT IT SHOWS, BY WHERE THE ENQUIRY CAME FROM
     Contact form   the message, the area, the monthly bill
     Estimator      every appliance with its hours, the usage pattern, region,
                    rate, roof area — and the system the visitor was shown
     Book a visit   the visit asked for, its date, time and status
     Every one      the customer account it belongs to, its quotations and
                    contract, and who on the team owns it
   ========================================================================== */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="xs dim">{label}</div>
      <div className="small strong">{children}</div>
    </div>
  )
}

function EstimateBlock({ estimate }: { estimate: EstimateDetail }) {
  return (
    <div
      className="stack stack--sm"
      style={{
        padding: 'var(--space-3)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div className="row row--between row--wrap">
        <span className="small strong">Estimator submission</span>
        <span className="xs dim">{dateTime(estimate.createdAt)}</span>
      </div>

      {/* What the visitor was shown. Stored as they saw it, so a change in
          prices since does not quietly rewrite what they believe they were
          told. */}
      <div className="grid grid--3" style={{ gap: 'var(--space-3)' }}>
        <Row label="Recommended system">
          {estimate.recommendedKw !== null ? `${estimate.recommendedKw} kWp` : '—'}
          {estimate.systemType ? ` · ${SYSTEM_TYPE_LABEL[estimate.systemType]}` : ''}
        </Row>
        <Row label="Shown price">
          {estimate.estimatedCost !== null ? currency(estimate.estimatedCost) : '—'}
        </Row>
        <Row label="Monthly savings">
          {estimate.monthlySavings !== null ? currency(estimate.monthlySavings) : '—'}
          {estimate.paybackYears !== null
            ? ` · payback ${Math.round(estimate.paybackYears)} yrs`
            : ''}
        </Row>
        <Row label="Panels · inverter · batteries">
          {estimate.panelCount ?? '—'} · {estimate.inverterKw ?? '—'} kW · {estimate.batteryCount}
        </Row>
        <Row label="Peak load · daily use">
          {number(estimate.peakLoadW)} W · {number(estimate.dailyWh)} Wh
        </Row>
        <Row label="Monthly use">{number(estimate.monthlyKwh)} kWh</Row>
        <Row label="Usage pattern">{estimate.usagePattern || '—'}</Row>
        <Row label="Region">{estimate.region || '—'}</Row>
        <Row label="Rate · bill they stated">
          {estimate.ratePerKwh !== null ? `₱${estimate.ratePerKwh}/kWh` : '—'} ·{' '}
          {estimate.statedMonthlyBill !== null ? currency(estimate.statedMonthlyBill) : 'not given'}
        </Row>
        <Row label="Usable roof area">
          {estimate.roofAreaSqm !== null ? `${estimate.roofAreaSqm} m²` : 'not given'}
        </Row>
      </div>

      {estimate.appliances.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Appliance</th>
                <th className="table__num">Qty</th>
                <th className="table__num">Watts</th>
                <th className="table__num">Hours/day</th>
              </tr>
            </thead>
            <tbody>
              {estimate.appliances.map((appliance, index) => (
                <tr key={`${appliance.name}-${index}`}>
                  <td className="small">
                    {appliance.name}
                    {appliance.isInverterType && <span className="xs dim"> · inverter type</span>}
                    {appliance.custom && <span className="xs dim"> · added by them</span>}
                  </td>
                  <td className="table__num">{appliance.quantity}</td>
                  <td className="table__num">{number(appliance.watts)}</td>
                  <td className="table__num">{appliance.hoursPerDay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function LeadDetails({ enquiry }: { enquiry: Enquiry }) {
  return (
    <div className="stack">
      {/* ------------------------------------------------- WHO */}
      <div className="grid grid--3" style={{ gap: 'var(--space-3)' }}>
        <Row label="Email">
          <a href={`mailto:${enquiry.email}`}>{enquiry.email}</a>
        </Row>
        <Row label="Mobile">
          {enquiry.phone ? <a href={`tel:${enquiry.phone}`}>{enquiry.phone}</a> : 'Not given'}
        </Row>
        <Row label="Came in through">
          {ORIGIN_LABEL[enquiry.origin]} · {dateTime(enquiry.createdAt)}
        </Row>
        <Row label="Area / location">{enquiry.location || 'Not given'}</Row>
        <Row label="Monthly bill">
          {enquiry.monthlyBill !== null ? currency(enquiry.monthlyBill) : 'Not given'}
        </Row>
        <Row label="Estimated system">
          {enquiry.estimatedKw !== null ? `${enquiry.estimatedKw} kWp` : 'Not sized yet'}
        </Row>
        <Row label="Pipeline stage">
          {LEAD_STAGE_LABEL[enquiry.stage]} · score {enquiry.score}
        </Row>
        <Row label="Owner">{enquiry.ownerName ?? 'Unassigned'}</Row>
        <Row label="Customer account">
          {enquiry.account ? (
            <span>
              ✓ {enquiry.account.name}
              {enquiry.account.email.toLowerCase() !== enquiry.email.toLowerCase() && (
                <span className="xs dim"> ({enquiry.account.email})</span>
              )}
            </span>
          ) : (
            'No account yet'
          )}
        </Row>
      </div>

      {enquiry.address && enquiry.address !== enquiry.location && (
        <Row label="Property address">{enquiry.address}</Row>
      )}

      {/* --------------------------------------------- WHAT THEY WROTE */}
      {enquiry.message && (
        <div
          style={{
            padding: 'var(--space-3)',
            background: 'var(--ink-50)',
            borderRadius: 'var(--radius)',
          }}
        >
          <div className="xs dim">
            {enquiry.origin === 'upgrade' ? 'Their upgrade request' : 'Their message'}
          </div>
          <p className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {enquiry.message}
          </p>
        </div>
      )}

      {/* --------------------------------------------- THE ESTIMATOR */}
      {enquiry.estimates.map((estimate) => (
        <EstimateBlock key={estimate.id} estimate={estimate} />
      ))}

      {/* -------------------------------------------- VISITS ASKED FOR */}
      {enquiry.visits.length > 0 && (
        <div className="stack stack--sm">
          <div className="xs dim strong">VISITS</div>
          {enquiry.visits.map((visit) => (
            <div
              key={visit.id}
              className="row row--between row--wrap"
              style={{
                padding: 'var(--space-3)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div>
                <div className="small strong">
                  {APPOINTMENT_TYPE_LABEL[visit.type]} · {fmtDate(visit.date)} at {visit.timeSlot}
                </div>
                {visit.address && <div className="xs dim">📍 {visit.address}</div>}
                {visit.notes && (
                  <div className="xs" style={{ whiteSpace: 'pre-wrap', marginTop: 2 }}>
                    “{visit.notes}”
                  </div>
                )}
              </div>
              <Badge tone={APPOINTMENT_STATUS_TONE[visit.status]}>
                {APPOINTMENT_STATUS_LABEL[visit.status]}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {/* -------------------------------------- WHAT HAS BEEN DONE SINCE */}
      {(enquiry.quotations.length > 0 || enquiry.contract) && (
        <div className="stack stack--sm">
          <div className="xs dim strong">QUOTATIONS AND CONTRACT</div>
          {enquiry.quotations.map((q) => (
            <div key={q.id} className="row row--between small">
              <span>
                <code>{q.reference}</code> · {currency(q.totalPrice)}
              </span>
              <Badge tone={QUOTATION_STATUS_TONE[q.status] ?? 'neutral'}>
                {humanize(q.status)}
              </Badge>
            </div>
          ))}
          {enquiry.contract && (
            <div className="row row--between small">
              <span>
                <code>{enquiry.contract.reference}</code>
              </span>
              <Badge tone={CONTRACT_STATUS_TONE[enquiry.contract.status] ?? 'neutral'}>
                {CONTRACT_STATUS_LABEL[enquiry.contract.status] ??
                  humanize(enquiry.contract.status)}
              </Badge>
            </div>
          )}
          <Link className="xs" to="/admin/quotes" style={{ color: 'var(--text-brand)' }}>
            Open Quotations →
          </Link>
        </div>
      )}
    </div>
  )
}
