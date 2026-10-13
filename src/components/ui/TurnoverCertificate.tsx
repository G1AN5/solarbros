import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { currency, date } from '@/lib/format'

/* ============================================================================
   TurnoverCertificate — the document handed over at the end of a job.
   ----------------------------------------------------------------------------
   "Generate turnover certificate" was the second action on the project page
   and did nothing. It is not decoration: in the Philippines the turnover
   certificate is what a customer keeps as proof the system was commissioned
   and accepted, and it is the document a warranty claim years later is checked
   against.

   Printed by the browser for the same reason receipts are — every print
   dialogue offers "Save as PDF", so nobody has to download a PDF library to
   produce one page of text. The company can then upload the saved file into
   the project's documents, where the customer sees it in their vault.

   Deliberately refuses to render for a project that is not complete. A
   certificate that says the work is finished when it is not is worse than no
   certificate at all — so the button explains rather than lying.
   ========================================================================== */

export interface TurnoverData {
  projectReference: string
  clientName: string
  address: string
  systemSize: number
  contractValue: number
  completedAt: string
  engineerName: string
  warrantyPanelYears: number
  warrantyInverterYears: number
  warrantyWorkmanshipYears: number
  /** Only for a system with storage; an on-grid system has no battery to cover. */
  warrantyBatteryYears?: number
  company: {
    name: string
    address: string
    email: string
    phone: string
  }
}

interface TurnoverCertificateProps {
  open: boolean
  onClose: () => void
  data: TurnoverData | null
}

export function TurnoverCertificate({ open, onClose, data }: TurnoverCertificateProps) {
  if (!data) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Turnover certificate · ${data.projectReference}`}
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
            <div className="receipt__label">Certificate of</div>
            <div className="receipt__ref">Turnover</div>
            <div className="receipt__meta">{data.projectReference}</div>
          </div>
        </div>

        <p className="receipt__note" style={{ marginTop: 'var(--space-4)' }}>
          This certifies that the photovoltaic system described below has been installed, tested and
          commissioned by {data.company.name}, and accepted by the owner on{' '}
          <strong>{date(data.completedAt)}</strong>.
        </p>

        <div className="receipt__to">
          <span className="receipt__label">Owner</span>
          <div className="receipt__name">{data.clientName}</div>
          <div className="receipt__meta">{data.address}</div>
        </div>

        <table className="receipt__table">
          <tbody>
            <tr>
              <td>System capacity</td>
              <td className="receipt__amount">{data.systemSize} kWp</td>
            </tr>
            <tr>
              <td>Contract value</td>
              <td className="receipt__amount">{currency(data.contractValue)}</td>
            </tr>
            <tr>
              <td>Commissioned</td>
              <td className="receipt__amount">{date(data.completedAt)}</td>
            </tr>
            <tr>
              <td>Supervising engineer</td>
              <td className="receipt__amount">{data.engineerName}</td>
            </tr>
            <tr>
              <td>Panel warranty</td>
              <td className="receipt__amount">{data.warrantyPanelYears} years</td>
            </tr>
            <tr>
              <td>Inverter warranty</td>
              <td className="receipt__amount">{data.warrantyInverterYears} years</td>
            </tr>
            {data.warrantyBatteryYears !== undefined && (
              <tr>
                <td>Battery warranty</td>
                <td className="receipt__amount">{data.warrantyBatteryYears} years</td>
              </tr>
            )}
            <tr>
              <td>Workmanship warranty</td>
              <td className="receipt__amount">{data.warrantyWorkmanshipYears} years</td>
            </tr>
          </tbody>
        </table>

        {/* Two signatures, because acceptance is a two-sided statement. Printed
            blank and signed by hand: the customer's electronic signature lives
            on the contract, and reusing it here would be putting their name to
            a document they have not read. */}
        <div className="receipt__signatures">
          <div>
            <div className="receipt__signline" />
            <div className="receipt__meta">For {data.company.name}</div>
          </div>
          <div>
            <div className="receipt__signline" />
            <div className="receipt__meta">Owner · {data.clientName}</div>
          </div>
        </div>

        <p className="receipt__note">
          Keep this certificate. A warranty claim is checked against the commissioning date on it.
        </p>
      </div>
    </Modal>
  )
}
