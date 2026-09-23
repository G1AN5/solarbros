import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { Progress } from '@/components/ui/Progress'
import { StatTile } from '@/components/ui/StatTile'
import { currency, date, humanize } from '@/lib/format'
import { INVOICE_STATUS_TONE, PAYMENT_STAGE_LABEL } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { datedFilename, downloadCsv } from '@/lib/csv'
import { Receipt, type ReceiptData } from '@/components/ui/Receipt'
import { useMyInvoices, useMyProject } from '@/lib/queries/client-portal'
import { useInvoicePayments, useRefunds } from '@/lib/queries/payments'
import { useCompany } from '@/lib/queries/public-site'
import { usePaymentDetails } from '@/lib/queries/settings'
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
   seen it on a statement.
   ========================================================================== */

export function BillingPage() {
  const projectQuery = useMyProject()
  const invoicesQuery = useMyInvoices()
  const project = projectQuery.data
  const invoices = invoicesQuery.data ?? []

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
        if (inv.status === 'paid') {
          return (
            <Button variant="ghost" size="sm" onClick={() => setReceiptInvoice(inv)}>
              Receipt
            </Button>
          )
        }

        /* No button, because there is nothing for one to do — the customer
           pays from their own banking app. Saying HOW rather than offering a
           control that cannot work is the honest version of this cell. */
        return (
          <span className="xs dim" title="Bank details are below">
            Transfer {currency(inv.amount - inv.amountPaid)}
          </span>
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
          value={`${Math.round((project.amountPaid / project.contractValue) * 100)}%`}
        />
      </div>

      {/* Staged payment schedule — sets the expectation before the table. */}
      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <CardHeader title="Payment schedule" />
        <CardBody>
          <Progress
            value={project.amountPaid / project.contractValue}
            label={`${currency(project.amountPaid)} of ${currency(project.contractValue)} collected`}
            tone="success"
          />

          <div className="grid" style={{ marginTop: 'var(--space-6)' }}>
            {(
              [
                { stage: 'down_payment', pct: 50, trigger: 'On contract signing' },
                { stage: 'delivery', pct: 35, trigger: 'When equipment arrives on site' },
                { stage: 'commissioning', pct: 15, trigger: 'After successful turnover' },
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
          <DataTable columns={columns} rows={invoices} rowKey={(inv) => inv.id} />
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
                Your balance above updates once we have matched your transfer against our bank
                statement — usually the next working day. Nothing is lost in between; the reference
                on your transfer is what we match it by.
              </p>
            </>
          ) : (
            /* Better to say nothing than to show a customer an empty account
               number and let them guess at it. */
            <p className="small muted">
              Please contact the office for payment details. We will confirm where to send your
              payment and the reference to quote.
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
