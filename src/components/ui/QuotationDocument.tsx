import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { currency, date } from '@/lib/format'
import { SYSTEM_TYPE_LABEL } from '@/lib/labels'
import type { SystemType } from '@/types/domain'

/* ============================================================================
   QuotationDocument — the quotation as the customer receives it.
   ----------------------------------------------------------------------------
   The estimator promised "a detailed PDF with the exact bill of materials" and
   the quotation step promised the customer a quotation they could keep.
   Nothing produced either: the rep was told to "attach a PDF in their own mail
   client", made from nothing.

   This is that document, printed by the browser — every print dialogue offers
   "Save as PDF", so it is the download too, with no PDF library shipped to a
   phone. The rep saves it and emails it; the customer prints it from their
   portal.

   WHAT IT SHOWS AND DOES NOT
   Equipment and quantities, the price, the payment schedule, the warranties
   and how long the offer stands. Never unit costs: those are what the company
   pays, and the price already carries the margin.
   ========================================================================== */

export interface QuotationDocumentData {
  reference: string
  issuedAt: string
  validUntil: string | null
  customerName: string
  customerEmail?: string
  siteAddress?: string
  systemKw: number
  systemType: SystemType
  panelCount: number | null
  batteryCount: number
  totalPrice: number
  discountPct: number
  items: { description: string; quantity: number }[]
  split: { downPayment: number; delivery: number; commissioning: number }
  warranty: {
    panelYears: number
    inverterYears: number
    batteryYears: number
    workmanshipYears: number
  }
  company: { name: string; address: string; email: string; phone: string }
}

interface Props {
  open: boolean
  onClose: () => void
  data: QuotationDocumentData | null
}

export function QuotationDocument({ open, onClose, data }: Props) {
  if (!data) return null

  const stages = [
    { label: 'Down payment, when the contract is signed', pct: data.split.downPayment },
    { label: 'When the equipment is installed', pct: data.split.delivery },
    { label: 'On commissioning', pct: data.split.commissioning },
  ]

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Quotation ${data.reference}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => window.print()}>
            Print or save as PDF
          </Button>
        </>
      }
    >
      <div className="receipt printable">
        <div className="receipt__head">
          <div>
            <div className="receipt__company">{data.company.name}</div>
            <div className="receipt__meta">{data.company.address}</div>
            <div className="receipt__meta">
              {[data.company.phone, data.company.email].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div className="receipt__stamp">
            <div className="receipt__label">Quotation</div>
            <div className="receipt__ref">{data.reference}</div>
            <div className="receipt__meta">{date(data.issuedAt)}</div>
          </div>
        </div>

        <div className="receipt__to">
          <span className="receipt__label">Prepared for</span>
          <div className="receipt__name">{data.customerName}</div>
          {data.customerEmail && <div className="receipt__meta">{data.customerEmail}</div>}
          {data.siteAddress && <div className="receipt__meta">Site: {data.siteAddress}</div>}
        </div>

        <p style={{ margin: '12px 0' }}>
          <strong>
            {data.systemKw} kWp {SYSTEM_TYPE_LABEL[data.systemType]} solar system
          </strong>
          {data.panelCount ? ` · ${data.panelCount} panels` : ''}
          {data.batteryCount > 0 ? ` · ${data.batteryCount} battery modules` : ''}
        </p>

        <table className="receipt__table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Supplied and installed</th>
              <th className="receipt__amount">Qty</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, index) => (
              <tr key={index}>
                <td>{item.description}</td>
                <td className="receipt__amount">{item.quantity}</td>
              </tr>
            ))}
            <tr>
              <td>Design, permits and net-metering paperwork, installation and commissioning</td>
              <td className="receipt__amount">Included</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>
                  Total price{data.discountPct > 0 ? ` (after ${data.discountPct}% discount)` : ''}
                </strong>
              </td>
              <td className="receipt__amount">
                <strong>{currency(data.totalPrice)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>

        <table className="receipt__table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Payment schedule</th>
              <th className="receipt__amount">Amount</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((stage) => (
              <tr key={stage.label}>
                <td>
                  {stage.label} ({stage.pct}%)
                </td>
                <td className="receipt__amount">{currency((data.totalPrice * stage.pct) / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="receipt__meta" style={{ marginTop: 16 }}>
          Warranties: panels {data.warranty.panelYears} years · inverter{' '}
          {data.warranty.inverterYears} years
          {data.batteryCount > 0 ? ` · batteries ${data.warranty.batteryYears} years` : ''} ·
          workmanship {data.warranty.workmanshipYears} years.
        </p>

        <p className="receipt__note">
          {data.validUntil
            ? `This quotation is valid until ${date(data.validUntil)}. `
            : 'This quotation is valid for 30 days. '}
          Payment is by bank transfer; each stage is invoiced only when it is reached. Final details
          are confirmed by the site survey. Accept it from your {data.company.name} portal, or reply
          to us to go ahead.
        </p>
      </div>
    </Modal>
  )
}
