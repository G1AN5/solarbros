import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { currency, date } from '@/lib/format'

/* ============================================================================
   Receipt — a printable official receipt.
   ----------------------------------------------------------------------------
   The Receipt button was inert on both the customer's billing page and the
   accountant's invoice list. A customer who has paid PHP 340,000 asks for one,
   and in the Philippines an OR is not a nicety — it is what a business
   customer needs to claim the expense.

   WHY PRINT AND NOT A PDF LIBRARY
   jsPDF and pdfmake are 250-400 KB, and every one of them re-implements text
   layout badly. `window.print()` uses the browser's own engine, which already
   knows how to paginate, and every browser on every platform offers "Save as
   PDF" in that dialogue. So the customer gets a PDF, and the app ships nothing
   extra to a phone on mobile data.

   The print stylesheet hides the application around it, so what prints is the
   receipt and not a screenshot of a web page with a sidebar.

   NOT A BIR-REGISTERED OFFICIAL RECEIPT. That requires an accredited printer
   or a CAS permit, and a serial range issued by the BIR. This is an
   acknowledgement of payment with everything on it that one needs — say so
   plainly rather than implying an accreditation the company may not have.
   ========================================================================== */

export interface ReceiptData {
  reference: string
  issuedTo: string
  issuedAt: string
  lines: { label: string; amount: number }[]
  total: number
  method?: string
  paymentReference?: string
  company: {
    name: string
    address: string
    email: string
    phone: string
  }
}

interface ReceiptProps {
  open: boolean
  onClose: () => void
  receipt: ReceiptData | null
}

export function Receipt({ open, onClose, receipt }: ReceiptProps) {
  if (!receipt) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Receipt ${receipt.reference}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {/* Every browser's print dialogue offers "Save as PDF", so this is
              both the print button and the download button. */}
          <Button variant="primary" onClick={() => window.print()}>
            Print or save as PDF
          </Button>
        </>
      }
    >
      <div className="receipt" id="printable-receipt">
        <div className="receipt__head">
          <div>
            <div className="receipt__company">{receipt.company.name}</div>
            <div className="receipt__meta">{receipt.company.address}</div>
            <div className="receipt__meta">
              {receipt.company.phone} · {receipt.company.email}
            </div>
          </div>
          <div className="receipt__stamp">
            <div className="receipt__label">Receipt</div>
            <div className="receipt__ref">{receipt.reference}</div>
            <div className="receipt__meta">{date(receipt.issuedAt)}</div>
          </div>
        </div>

        <div className="receipt__to">
          <span className="receipt__label">Received from</span>
          <div className="receipt__name">{receipt.issuedTo}</div>
        </div>

        <table className="receipt__table">
          <tbody>
            {/* Index keys: two tranches paid the same day by the same
                method produce identical labels, and a colliding key drops
                a line off the receipt. */}
            {receipt.lines.map((line, index) => (
              <tr key={index}>
                <td>{line.label}</td>
                <td className="receipt__amount">{currency(line.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>Total received</strong>
              </td>
              <td className="receipt__amount">
                <strong>{currency(receipt.total)}</strong>
              </td>
            </tr>
          </tfoot>
        </table>

        {(receipt.method || receipt.paymentReference) && (
          <p className="receipt__meta">
            Paid by {receipt.method ?? 'bank transfer'}
            {receipt.paymentReference ? ` · reference ${receipt.paymentReference}` : ''}
          </p>
        )}

        <p className="receipt__note">
          This is an acknowledgement of payment received. It is not a BIR-registered Official
          Receipt — ask us if you need one for your accounts and we will issue it separately.
        </p>
      </div>
    </Modal>
  )
}
