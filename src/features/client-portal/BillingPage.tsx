import { useRef, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { FormError } from '@/components/ui/FormError'
import { PageHeader } from '@/components/ui/PageHeader'
import { Progress } from '@/components/ui/Progress'
import { StatTile } from '@/components/ui/StatTile'
import { currency, date, humanize } from '@/lib/format'
import { INVOICE_STATUS_TONE, PAYMENT_STAGE_LABEL } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { datedFilename, downloadCsv } from '@/lib/csv'
import { Receipt, type ReceiptData } from '@/components/ui/Receipt'
import { useAuth } from '@/app/auth/useAuth'
import { useMyInvoices, useMyProject } from '@/lib/queries/client-portal'
import { useInvoicePayments, useRefunds } from '@/lib/queries/payments'
import { useCompany } from '@/lib/queries/public-site'
import { useMyContracts } from '@/lib/queries/sales'
import { usePaymentDetails } from '@/lib/queries/settings'
import { useClientUpload } from '@/lib/queries/storage'
import type { Invoice } from '@/types/domain'

/* ============================================================================
   BillingPage — staged invoices, payment history, printable receipts.
   ----------------------------------------------------------------------------
   HOW PAYING WORKS HERE
   By bank transfer or over the counter. There is no card or e-wallet checkout:
   the company settles that way in practice, and the gateway that used to be
   wired in here was removed in migration 0050 rather than left switched off.

   That decision is worth stating plainly, because half-built payment flows are
   how customers lose money. A "Pay now" button that opens a checkout nobody
   reconciles is worse than a bank account number.

   WHAT THIS PAGE THEREFORE OWES THE CUSTOMER
     · what they owe, and by when
     · exactly where to send it, from settings so it is never stale
     · what has already been received, and what has been refunded

   The balance moves when the office records the transfer against the invoice,
   which is the honest representation: the money is not ours until somebody has
   seen it on a statement. To get there sooner, the customer can upload the
   deposit slip or screenshot here; it goes straight to the finance team.
   ========================================================================== */

export function BillingPage() {
  const { user } = useAuth()
  const projectQuery = useMyProject()
  const invoicesQuery = useMyInvoices()
  const project = projectQuery.data
  const invoices = invoicesQuery.data ?? []

  /* The schedule is the one in the customer's own contract. It was typed in as
     50/35/15, so a contract signed on any other split showed the wrong amounts
     beside the right invoices. */
  const contracts = useMyContracts(user?.id).data ?? []
  const contract = contracts.find((c) => c.status === 'executed')

  /* PROOF OF PAYMENT. Named after the invoice it pays, so the accountant can
     see at a glance which one to record it against. */
  const upload = useClientUpload()
  const proofInput = useRef<HTMLInputElement>(null)
  const [proofFor, setProofFor] = useState<Invoice | null>(null)
  const [proofSent, setProofSent] = useState<string | null>(null)

  function chooseProof(invoice: Invoice) {
    setProofFor(invoice)
    setProofSent(null)
    upload.reset()
    proofInput.current?.click()
  }

  function sendProof(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !proofFor || !project) return
    const named = new File([file], `${proofFor.number} - ${file.name}`, { type: file.type })
    upload.mutate(
      { file: named, projectId: project.id, kind: 'receipt' },
      { onSuccess: () => setProofSent(proofFor.number) },
    )
  }

  const bank = usePaymentDetails()
  /* Money going back is the last thing that should be invisible to the person
     it is going back to - and the first thing they ring about when a balance
     moves and nothing on the page explains it. RLS scopes this to refunds
     against their own invoices. */
  const refunds = useRefunds().data ?? []

  /* ---------------------------------------------------------------- RECEIPTS
     The Receipt button used to do nothing. A customer who has paid several
     hundred thousand pesos will ask for one, and a business customer needs it
     to claim the expense - so it cannot stay decorative. The document is built
     from payments the company has actually verified, and printed by the
     browser: every print dialogue offers "Save as PDF", so this is the
     download too, without shipping a PDF library to someone on mobile data. */
  const company = useCompany()
  const [receiptInvoice, setReceiptInvoice] = useState<Invoice | null>(null)
  const receiptPayments = useInvoicePayments(receiptInvoice?.id).data ?? []

  function buildReceipt(invoice: Invoice | null): ReceiptData | null {
    if (!invoice) return null

    /* One line per verified payment. Falling back to the invoice's own paid
       total covers a record migrated from before this table was populated -
       the figure is still the company's, not a guess. */
    const lines =
      receiptPayments.length > 0
        ? receiptPayments.map((p) => ({
            label: `${humanize(p.method)} - ${date(p.paidAt)}${
              p.reference ? ` - ref ${p.reference}` : ''
            }`,
            amount: p.amount,
          }))
        : [
            {
              label: `${PAYMENT_STAGE_LABEL[invoice.stage]} - invoice ${invoice.number}`,
              amount: invoice.amountPaid,
            },
          ]

    return {
      // AR-2026-1001 against INV-2026-1001: tied to the invoice at a glance,
      // but not the same reference, which would confuse anyone's books.
      reference: invoice.number.replace(/^INV/, 'AR'),
      issuedTo: project?.clientName || 'Customer',
      issuedAt: new Date().toISOString(),
      lines,
      total: lines.reduce((sum, line) => sum + line.amount, 0),
      company: {
        name: company.name,
        address: company.address,
        email: company.email,
        phone: company.phone,
      },
    }
  }

  // Billing is meaningless without the contract it bills against.
  if (projectQuery.isLoading || projectQuery.error || !project) {
    return (
      <>
        <PageHeader title="Billing" />
        <QueryState
          isLoading={projectQuery.isLoading}
          error={projectQuery.error as Error | null}
          isEmpty={!project}
          emptyIcon="🧾"
          emptyTitle="Nothing to bill yet"
          emptyMessage="Invoices appear here once your contract is signed."
        >
          {null}
        </QueryState>
      </>
    )
  }

  const unpaid = invoices.filter((i) => i.status !== 'paid')
  const totalDue = unpaid.reduce((sum, i) => sum + (i.amount - i.amountPaid), 0)
  const paidCount = invoices.filter((i) => i.status === 'paid').length

  /* The soonest unpaid due date, rather than a date typed into the markup.
     A hardcoded "Next due 8 Sep" is wrong the day after it is written, and
     wrong in a way that makes the customer distrust every other figure. */
  const nextDue = unpaid
    .map((i) => i.dueAt)
    .filter(Boolean)
    .sort()[0]

  const columns: Column<Invoice>[] = [
    { header: 'Invoice', cell: (inv) => <code>{inv.number}</code> },
    {
      header: 'Stage',
      cell: (inv) => <span className="strong">{PAYMENT_STAGE_LABEL[inv.stage]}</span>,
    },
    { header: 'Issued', cell: (inv) => date(inv.issuedAt) },
    { header: 'Due', cell: (inv) => date(inv.dueAt) },
    { header: 'Amount', numeric: true, cell: (inv) => currency(inv.amount) },
    {
      header: 'Status',
      cell: (inv) => <Badge tone={INVOICE_STATUS_TONE[inv.status]}>{humanize(inv.status)}</Badge>,
    },
    {
      header: '',
      cell: (inv) => {
        /* A receipt for whatever has been received — a part payment too —
           and, while anything is owed, a way to send the proof of payment. */
        return (
          <div className="row row--wrap" style={{ gap: 4 }}>
            {inv.amountPaid > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setReceiptInvoice(inv)}>
                Receipt
              </Button>
            )}
            {inv.amount > inv.amountPaid && (
              <Button
                variant="outline"
                size="sm"
                disabled={upload.isPending}
                onClick={() => chooseProof(inv)}
                title={`Pay ${currency(inv.amount - inv.amountPaid)} by transfer, then upload the slip`}
              >
                {upload.isPending && proofFor?.id === inv.id
                  ? 'Uploading…'
                  : 'I have paid — upload proof'}
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your staged payment schedule, invoices and official receipts."
        breadcrumbs={[{ label: 'Portal', to: '/portal' }, { label: 'Billing' }]}
        actions={
          /* A statement is the whole invoice history in one file - what a
             customer forwards to their accountant or their bank when applying
             for financing. It was a button that did nothing. */
          <Button
            variant="outline"
            disabled={invoices.length === 0}
            onClick={() =>
              downloadCsv(datedFilename('solarbros-statement'), invoices, [
                { header: 'Invoice', value: (i) => i.number },
                { header: 'Stage', value: (i) => PAYMENT_STAGE_LABEL[i.stage] },
                { header: 'Issued', value: (i) => i.issuedAt },
                { header: 'Due', value: (i) => i.dueAt },
                { header: 'Amount', value: (i) => i.amount },
                { header: 'Paid', value: (i) => i.amountPaid },
                { header: 'Balance', value: (i) => i.amount - i.amountPaid },
                { header: 'Status', value: (i) => i.status },
              ])
            }
          >
            Download statement
          </Button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Contract value" value={currency(project.contractValue)} />
        <StatTile
          label="Paid to date"
          value={currency(project.amountPaid)}
          delta={`Across ${paidCount} invoice${paidCount === 1 ? '' : 's'}`}
          direction="up"
        />
        <StatTile
          label="Outstanding"
          value={currency(totalDue)}
          delta={totalDue > 0 && nextDue ? `Next due ${date(nextDue)}` : 'Nothing owed'}
          direction={totalDue > 0 ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile
          label="Payment progress"
          value={`${
            project.contractValue > 0
              ? Math.round((project.amountPaid / project.contractValue) * 100)
              : 0
          }%`}
        />
      </div>

      {/* Staged payment schedule — sets the expectation before the table. */}
      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <CardHeader title="Payment schedule" />
        <CardBody>
          <Progress
            value={project.contractValue > 0 ? project.amountPaid / project.contractValue : 0}
            label={`${currency(project.amountPaid)} of ${currency(project.contractValue)} collected`}
            tone="success"
          />

          <div className="grid" style={{ marginTop: 'var(--space-6)' }}>
            {(
              [
                {
                  stage: 'down_payment',
                  pct: contract?.downPaymentPct ?? 50,
                  trigger: 'When your contract is counter-signed',
                },
                {
                  stage: 'delivery',
                  pct: contract?.deliveryPct ?? 35,
                  trigger: 'When the equipment is installed and wired',
                },
                {
                  stage: 'commissioning',
                  pct: contract?.commissioningPct ?? 15,
                  trigger: 'After successful turnover',
                },
              ] as const
            ).map((row) => {
              const invoice = invoices.find((i) => i.stage === row.stage)
              return (
                <div
                  key={row.stage}
                  style={{
                    padding: 'var(--space-4)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div className="row row--between">
                    <span className="strong">{PAYMENT_STAGE_LABEL[row.stage]}</span>
                    <Badge tone={invoice?.status === 'paid' ? 'success' : 'neutral'}>
                      {invoice ? humanize(invoice.status) : 'Not yet issued'}
                    </Badge>
                  </div>
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginTop: 4 }}>
                    {currency(project.contractValue * (row.pct / 100))}
                  </div>
                  <div className="xs dim">
                    {row.pct}% · {row.trigger}
                  </div>
                </div>
              )
            })}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Invoice history" />
        <CardBody>
          <input
            ref={proofInput}
            type="file"
            accept="image/*,application/pdf"
            onChange={sendProof}
            style={{ display: 'none' }}
          />
          {proofSent && (
            <p
              className="small"
              style={{
                marginBottom: 'var(--space-4)',
                padding: 'var(--space-3)',
                background: 'var(--success-bg)',
                color: 'var(--success-fg)',
                borderRadius: 'var(--radius)',
              }}
            >
              Thank you — your proof of payment for {proofSent} is with our finance team. Your
              balance updates once they have matched it to our bank statement, and you are notified
              when it does.
            </p>
          )}
          <FormError error={upload.error} />
          <DataTable
            columns={columns}
            rows={invoices}
            rowKey={(inv) => inv.id}
            emptyMessage="No invoices yet. The down payment is invoiced once we counter-sign your contract."
          />
        </CardBody>
      </Card>

      {refunds.length > 0 && (
        <Card style={{ marginTop: 'var(--space-6)' }}>
          <CardHeader title="Refunds" />
          <CardBody>
            <div className="stack stack--sm">
              {refunds.map((refund) => (
                <div key={refund.id} className="row row--between">
                  <div>
                    <span className="small strong">{currency(refund.amount)}</span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      {refund.invoiceNumber} · {date(refund.recordedAt)}
                    </span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      {refund.reason}
                    </span>
                  </div>
                  <Badge tone={refund.status === 'confirmed' ? 'success' : 'warning'}>
                    {refund.status === 'confirmed' ? 'Returned' : 'Being processed'}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
              A refund shows as returned once it has left our account. Depending on how you paid, it
              can take a few working days to reach you after that.
            </p>
          </CardBody>
        </Card>
      )}
      {/* --------------------------------------------------- WHERE TO SEND IT
          Read from settings, not written into the markup. Changing bank should
          not need a developer, and this is the one piece of information a
          customer has to get exactly right. */}
      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardHeader title="How to pay" />
        <CardBody>
          {bank.configured ? (
            <>
              <div className="grid grid--2" style={{ gap: 'var(--space-4)' }}>
                {bank.bankName && bank.accountNumber && (
                  <div
                    style={{
                      padding: 'var(--space-4)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <div className="xs dim">Bank transfer or over the counter</div>
                    <div className="strong" style={{ marginTop: 'var(--space-2)' }}>
                      {bank.bankName}
                    </div>
                    {bank.accountName && <div className="small">{bank.accountName}</div>}
                    <div
                      className="num strong"
                      style={{ fontSize: 'var(--text-lg)', marginTop: 'var(--space-1)' }}
                    >
                      {bank.accountNumber}
                    </div>
                  </div>
                )}

                {bank.gcashNumber && (
                  <div
                    style={{
                      padding: 'var(--space-4)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <div className="xs dim">GCash</div>
                    {bank.accountName && (
                      <div className="strong" style={{ marginTop: 'var(--space-2)' }}>
                        {bank.accountName}
                      </div>
                    )}
                    <div
                      className="num strong"
                      style={{ fontSize: 'var(--text-lg)', marginTop: 'var(--space-1)' }}
                    >
                      {bank.gcashNumber}
                    </div>
                  </div>
                )}
              </div>

              <p className="small muted" style={{ marginTop: 'var(--space-4)' }}>
                {bank.instructions}
              </p>

              <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
                After paying, press &ldquo;I have paid — upload proof&rdquo; beside the invoice and
                attach the slip or screenshot. Your balance updates once we have matched it against
                our bank statement — usually the next working day.
              </p>
            </>
          ) : (
            /* Better to say nothing than to show a customer an empty account
               number and let them guess at it. */
            <p className="small muted">
              Please contact the office for payment details
              {company.phone ? ` on ${company.phone}` : ''}
              {company.email ? ` or ${company.email}` : ''}. We will confirm where to send your
              payment and the reference to quote — then upload your proof of payment beside the
              invoice above.
            </p>
          )}
        </CardBody>
      </Card>

      <Receipt
        open={receiptInvoice !== null}
        onClose={() => setReceiptInvoice(null)}
        receipt={buildReceipt(receiptInvoice)}
      />
    </>
  )
}
