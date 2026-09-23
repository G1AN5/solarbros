import { type FormEvent, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatTile } from '@/components/ui/StatTile'
import { currency, currencyCompact, date, daysSince, humanize } from '@/lib/format'
import { INVOICE_STATUS_TONE, PAYMENT_STAGE_LABEL } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { Receipt, type ReceiptData } from '@/components/ui/Receipt'
import {
  useAllInvoices,
  useCreateInvoice,
  useRecordPayment,
  useSendCollectionReminders,
} from '@/lib/queries/inventory-finance'
import { useProjects } from '@/lib/queries/operations'
import {
  useConfirmRefund,
  useInvoicePayments,
  usePaymentsAwaitingVerification,
  useRecordRefund,
  useRefunds,
  useVerifyPayment,
} from '@/lib/queries/payments'
import { useCompany } from '@/lib/queries/public-site'
import { settingNum, useSettings } from '@/lib/queries/settings'
import type { Invoice } from '@/types/domain'
import { datedFilename, downloadCsv } from '@/lib/csv'

/* ============================================================================
   FinancePage — Transactions, Quotations & Invoicing module.
   ----------------------------------------------------------------------------
   Invoices are not created by hand. They are TRIGGERED BY MILESTONES:

       contract signed         → down payment invoice
       materials delivered     → delivery invoice
       commissioning complete  → final invoice

   That coupling is what keeps billing honest: an invoice cannot be issued for
   work that has not happened, because the milestone is what raises it.

   The ageing table below is the collections view — how overdue, and by how
   much. Anything past 30 days should be escalated.
   ========================================================================== */

/** Days between the due date and today. Negative means not yet due. */
function daysOverdue(invoice: Invoice): number {
  return daysSince(invoice.dueAt)
}

export function FinancePage() {
  const invoicesQuery = useAllInvoices()
  const invoices = invoicesQuery.data ?? []

  const settings = useSettings().data
  const dualControlThreshold = settingNum(settings, 'finance.dual_control_threshold', 50000)

  const pendingQuery = usePaymentsAwaitingVerification()
  const pending = pendingQuery.data ?? []
  const verify = useVerifyPayment()

  const recordPayment = useRecordPayment()
  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null)
  const [recorded, setRecorded] = useState<{ awaitingVerification: boolean } | null>(null)

  /* ---------------------------------------------------------------- RECEIPTS
     Same document the customer can print, issued from this side of the desk -
     because the request usually arrives by phone, and the accountant should
     not have to ask the customer to log in and print it themselves. */
  const company = useCompany()
  const [receiptInvoice, setReceiptInvoice] = useState<Invoice | null>(null)
  const receiptPayments = useInvoicePayments(receiptInvoice?.id).data ?? []

  function buildReceipt(invoice: Invoice | null): ReceiptData | null {
    if (!invoice) return null

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
      reference: invoice.number.replace(/^INV/, 'AR'),
      issuedTo: invoice.clientName,
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

  /* Two more inert buttons. "Send reminders" is the one that matters: chasing
     an overdue invoice is the single most valuable thing on a collections
     screen, and it was a decoration. */
  const projects = useProjects().data ?? []
  const createInvoice = useCreateInvoice()
  const sendReminders = useSendCollectionReminders()
  const [raising, setRaising] = useState(false)
  const [raised, setRaised] = useState<string | null>(null)
  const [remindersSent, setRemindersSent] = useState<number | null>(null)

  /* ----------------------------------------------------------------- REFUNDS
     Listed as a known limitation for several sessions: `payments.amount` has
     `check (amount > 0)`, so a refund could not be a negative payment and there
     was no other way to give money back. A cancelled contract was therefore
     settled outside the system, and the ledger stopped being the record.

     Migration 0047 makes it a separate event that names the payment it
     reverses. None of its rules are restated here — capped at what was taken,
     verified payments only, a second person to confirm. */
  const refunds = useRefunds().data ?? []
  const recordRefund = useRecordRefund()
  const confirmRefund = useConfirmRefund()
  const [refundingInvoice, setRefundingInvoice] = useState<Invoice | null>(null)
  const refundablePayments = useInvoicePayments(refundingInvoice?.id).data ?? []

  const awaitingRefundConfirmation = refunds.filter((r) => r.status === 'recorded')

  function handleRecordRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    recordRefund.mutate(
      {
        paymentId: String(form.get('payment')),
        amount: Number(form.get('amount')),
        reason: String(form.get('reason') ?? ''),
        externalReference: String(form.get('reference') ?? ''),
      },
      { onSuccess: () => setRefundingInvoice(null) },
    )
  }

  function handleCreateInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const project = projects.find((p) => p.id === String(form.get('project')))

    createInvoice.mutate(
      {
        projectId: String(form.get('project')),
        clientId: project?.clientId ?? null,
        stage: String(form.get('stage')) as 'retention',
        amount: Number(form.get('amount')),
        dueAt: String(form.get('due')),
        notes: String(form.get('notes') ?? ''),
      },
      { onSuccess: (result) => setRaised(result?.invoice_number ?? null) },
    )
  }

  function closeInvoiceModal() {
    setRaising(false)
    setRaised(null)
    createInvoice.reset()
  }

  function closePaymentModal() {
    setPayingInvoice(null)
    setRecorded(null)
    recordPayment.reset()
  }

  function handleRecordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!payingInvoice) return
    const form = new FormData(event.currentTarget)

    recordPayment.mutate(
      {
        invoiceId: payingInvoice.id,
        amount: Number(form.get('amount')),
        method: String(form.get('method')) as 'bank_transfer',
        reference: String(form.get('reference') ?? ''),
        note: String(form.get('note') ?? ''),
      },
      { onSuccess: (result) => setRecorded(result) },
    )
  }

  const totalInvoiced = invoices.reduce((sum, i) => sum + i.amount, 0)
  const totalCollected = invoices.reduce((sum, i) => sum + i.amountPaid, 0)
  const outstanding = totalInvoiced - totalCollected
  const overdue = invoices.filter((i) => i.status === 'overdue')
  const overdueTotal = overdue.reduce((sum, i) => sum + (i.amount - i.amountPaid), 0)

  const columns: Column<Invoice>[] = [
    { header: 'Invoice', cell: (i) => <code>{i.number}</code> },
    {
      header: 'Client',
      cell: (i) => (
        <div>
          <div className="strong">{i.clientName}</div>
          <div className="xs dim">{PAYMENT_STAGE_LABEL[i.stage]}</div>
        </div>
      ),
    },
    { header: 'Issued', cell: (i) => date(i.issuedAt) },
    {
      header: 'Due',
      cell: (i) => {
        const days = daysOverdue(i)
        const unpaid = i.amount > i.amountPaid
        return (
          <div>
            {date(i.dueAt)}
            {unpaid && days > 0 && (
              <div className="xs" style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>
                {days} days overdue
              </div>
            )}
          </div>
        )
      },
    },
    { header: 'Amount', numeric: true, cell: (i) => currency(i.amount) },
    {
      header: 'Paid',
      numeric: true,
      cell: (i) => (
        <span className={i.amountPaid < i.amount ? 'muted' : 'strong'}>
          {currency(i.amountPaid)}
        </span>
      ),
    },
    {
      header: 'Balance',
      numeric: true,
      cell: (i) => (
        <span
          className="strong"
          style={{ color: i.amount > i.amountPaid ? 'var(--danger-fg)' : undefined }}
        >
          {currency(i.amount - i.amountPaid)}
        </span>
      ),
    },
    {
      header: 'Status',
      cell: (i) => <Badge tone={INVOICE_STATUS_TONE[i.status]}>{humanize(i.status)}</Badge>,
    },
    {
      header: '',
      /* Not either/or. A part-paid invoice needs BOTH: the balance still has
         to be recorded, and the customer can still ask for a receipt for what
         they have already paid. Keying this off `status === 'paid'` alone is
         why a part payment used to hide the receipt entirely. */
      cell: (i) => (
        <div className="row">
          {i.amount > i.amountPaid && (
            <Button variant="outline" size="sm" onClick={() => setPayingInvoice(i)}>
              Record payment
            </Button>
          )}
          {i.amountPaid > 0 && (
            <>
              <Button variant="ghost" size="sm" onClick={() => setReceiptInvoice(i)}>
                Receipt
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRefundingInvoice(i)}>
                Refund
              </Button>
            </>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Invoicing & collections"
        description="Staged milestone invoices, payment recording and receivables ageing."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(datedFilename('invoices'), invoices, [
                  { header: 'Invoice', value: (i) => i.number },
                  { header: 'Customer', value: (i) => i.clientName },
                  { header: 'Stage', value: (i) => i.stage },
                  { header: 'Issued', value: (i) => i.issuedAt },
                  { header: 'Due', value: (i) => i.dueAt },
                  { header: 'Amount', value: (i) => i.amount },
                  { header: 'Paid', value: (i) => i.amountPaid },
                  { header: 'Balance', value: (i) => i.amount - i.amountPaid },
                  { header: 'Status', value: (i) => i.status },
                ])
              }
            >
              Export for accounting
            </Button>
            <Button variant="primary" onClick={() => setRaising(true)}>
              + New invoice
            </Button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Total invoiced" value={currencyCompact(totalInvoiced)} />
        <StatTile
          label="Collected"
          value={currencyCompact(totalCollected)}
          delta={`${Math.round((totalCollected / totalInvoiced) * 100)}% of invoiced`}
          direction="up"
        />
        <StatTile label="Outstanding" value={currencyCompact(outstanding)} />
        <StatTile
          label="Overdue"
          value={currencyCompact(overdueTotal)}
          delta={`${overdue.length} invoice${overdue.length === 1 ? '' : 's'}`}
          direction={overdue.length ? 'up' : 'flat'}
          invertDelta
        />
      </div>

      {/* ------------------------------------ AWAITING A SECOND PERSON
          Payments at or above the dual-control threshold are recorded but do
          NOT count towards the invoice until somebody other than the person who
          recorded them confirms it against the bank statement. Until this queue
          is worked, the money is logged and not recognised - so it sits above
          the invoice table rather than on a screen nobody visits. */}
      {pending.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--warning-solid)' }}>
          <CardHeader
            title={`Awaiting verification (${pending.length})`}
            action={
              <span className="xs dim">
                Second approval required at {currency(dualControlThreshold)} and above
              </span>
            }
          />
          <CardBody>
            <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
              These payments have been recorded but are not yet counted against their invoices.
              Check each one against the bank statement before confirming. You cannot verify a
              payment you recorded yourself.
            </p>

            <div className="stack stack--sm">
              {pending.map((payment) => (
                <div key={payment.id} className="row row--between">
                  <div>
                    <span className="strong small">{currency(payment.amount)}</span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      {payment.invoiceNumber} · {humanize(payment.method)}
                      {payment.reference ? ` · ref ${payment.reference}` : ''} · recorded by{' '}
                      {payment.recordedByName} on {date(payment.paidAt)}
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={verify.isPending}
                    onClick={() => verify.mutate({ paymentId: payment.id })}
                  >
                    Confirm received
                  </Button>
                </div>
              ))}
            </div>

            <FormError error={verify.error} />
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------- COLLECTIONS ALERT */}
      {overdue.length > 0 && (
        <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--danger-solid)' }}>
          <CardHeader
            title="⚠ Overdue receivables"
            action={
              <div className="row">
                {remindersSent !== null && (
                  <span className="xs dim">
                    {remindersSent} reminder{remindersSent === 1 ? '' : 's'} queued
                  </span>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  disabled={sendReminders.isPending}
                  onClick={() =>
                    sendReminders.mutate(
                      {
                        invoices: overdue.map((i) => ({
                          id: i.id,
                          number: i.number,
                          clientId: i.clientId ?? null,
                          balance: i.amount - i.amountPaid,
                        })),
                      },
                      { onSuccess: (count) => setRemindersSent(count) },
                    )
                  }
                >
                  {sendReminders.isPending ? 'Sending…' : 'Send reminders'}
                </Button>
              </div>
            }
          />
          <CardBody>
            <FormError error={sendReminders.error} />
            <div className="stack stack--sm">
              {overdue.map((invoice) => (
                <div key={invoice.id} className="row row--between">
                  <div>
                    <span className="strong small">{invoice.clientName}</span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      {invoice.number} · {PAYMENT_STAGE_LABEL[invoice.stage]} · due{' '}
                      {date(invoice.dueAt)}
                    </span>
                  </div>
                  <div className="row">
                    <span className="num strong" style={{ color: 'var(--danger-fg)' }}>
                      {currency(invoice.amount - invoice.amountPaid)}
                    </span>
                    <Badge tone="danger">{daysOverdue(invoice)} days</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <QueryState
        isLoading={invoicesQuery.isLoading}
        error={invoicesQuery.error as Error | null}
        emptyIcon="&#129534;"
        emptyTitle="No invoices yet"
        emptyMessage="Invoices are raised automatically as project milestones complete."
      >
        <DataTable columns={columns} rows={invoices} rowKey={(i) => i.id} />
      </QueryState>

      {/* -------------------------------------------- AGEING SUMMARY */}
      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardHeader title="Receivables ageing" />
        <CardBody>
          <div className="grid grid--4">
            {[
              { label: 'Current', min: -Infinity, max: 0, tone: 'success' as const },
              { label: '1–30 days', min: 1, max: 30, tone: 'warning' as const },
              { label: '31–60 days', min: 31, max: 60, tone: 'danger' as const },
              { label: '60+ days', min: 61, max: Infinity, tone: 'danger' as const },
            ].map((bucket) => {
              const bucketInvoices = invoices.filter((i) => {
                if (i.amount <= i.amountPaid) return false
                const days = daysOverdue(i)
                return days >= bucket.min && days <= bucket.max
              })
              const total = bucketInvoices.reduce((sum, i) => sum + (i.amount - i.amountPaid), 0)

              return (
                <div
                  key={bucket.label}
                  style={{
                    padding: 'var(--space-4)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <Badge tone={bucket.tone}>{bucket.label}</Badge>
                  <div
                    style={{
                      fontSize: 'var(--text-xl)',
                      fontWeight: 700,
                      marginTop: 'var(--space-2)',
                    }}
                  >
                    {currency(total)}
                  </div>
                  <div className="xs dim">
                    {bucketInvoices.length} invoice{bucketInvoices.length === 1 ? '' : 's'}
                  </div>
                </div>
              )
            })}
          </div>
        </CardBody>
      </Card>

      {/* --------------------------------------------- RECORD A PAYMENT */}
      <Modal
        open={payingInvoice !== null}
        onClose={closePaymentModal}
        title={payingInvoice ? `Record payment · ${payingInvoice.number}` : 'Record payment'}
      >
        {recorded ? (
          <div className="stack stack--sm">
            <div style={{ fontSize: '1.75rem' }}>{recorded.awaitingVerification ? '⏳' : '✅'}</div>
            <h4 style={{ margin: 0 }}>
              {recorded.awaitingVerification
                ? 'Recorded, awaiting verification'
                : 'Payment recorded'}
            </h4>
            <p className="small muted">
              {recorded.awaitingVerification
                ? `This is ${currency(dualControlThreshold)} or more, so it does not count towards the invoice until a second person confirms it against the bank statement. It is now in the verification queue below.`
                : 'The invoice balance has been updated.'}
            </p>
            <Button variant="outline" onClick={closePaymentModal}>
              Done
            </Button>
          </div>
        ) : (
          payingInvoice && (
            <form className="stack" onSubmit={handleRecordPayment}>
              <div
                className="row row--between"
                style={{
                  padding: 'var(--space-3)',
                  background: 'var(--ink-50)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <span className="small">{payingInvoice.clientName}</span>
                <span className="small strong">
                  {currency(payingInvoice.amount - payingInvoice.amountPaid)} outstanding
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="pay-amount">
                  Amount received
                </label>
                <input
                  id="pay-amount"
                  name="amount"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  defaultValue={payingInvoice.amount - payingInvoice.amountPaid}
                />
                <span className="field__hint">
                  A payment larger than the outstanding balance is refused - split it across the
                  correct invoices instead.
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="pay-method">
                  How it was paid
                </label>
                <select
                  id="pay-method"
                  name="method"
                  className="select"
                  defaultValue="bank_transfer"
                >
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="gcash">GCash</option>
                  <option value="maya">Maya</option>
                  <option value="qrph">QR Ph</option>
                  <option value="online_banking">Online banking</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                  <option value="credit_card">Card</option>
                  <option value="financing">Third-party financing</option>
                </select>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="pay-ref">
                  Reference
                </label>
                <input
                  id="pay-ref"
                  name="reference"
                  className="input"
                  placeholder="Deposit slip number, GCash reference, cheque number"
                />
                <span className="field__hint">
                  This is what an auditor matches against the bank statement. Worth typing properly.
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="pay-note">
                  Note <span className="dim">(optional)</span>
                </label>
                <textarea id="pay-note" name="note" className="textarea" rows={2} />
              </div>

              <FormError error={recordPayment.error} />

              <Button type="submit" variant="primary" block disabled={recordPayment.isPending}>
                {recordPayment.isPending ? 'Recording…' : 'Record payment'}
              </Button>
            </form>
          )
        )}
      </Modal>

      <Receipt
        open={receiptInvoice !== null}
        onClose={() => setReceiptInvoice(null)}
        receipt={buildReceipt(receiptInvoice)}
      />

      {/* ------------------------------------------------ NEW INVOICE */}
      <Modal open={raising} onClose={closeInvoiceModal} title="Raise an invoice">
        {raised ? (
          <div className="stack stack--sm">
            <div style={{ fontSize: '1.75rem' }}>🧾</div>
            <h4 style={{ margin: 0 }}>{raised} raised</h4>
            <p className="small muted">
              It is on the customer's billing page now, and they can pay it online if it is within
              the gateway ceiling.
            </p>
            <Button variant="outline" block onClick={closeInvoiceModal}>
              Done
            </Button>
          </div>
        ) : (
          <form className="stack" onSubmit={handleCreateInvoice}>
            <p className="small muted">
              Invoices are normally raised by milestones, which is what keeps a charge tied to work
              that has actually happened. Use this for the things that are not milestones — a
              chargeable service call, a part outside warranty, an agreed variation.
            </p>

            <div className="field">
              <label className="field__label" htmlFor="inv-project">
                Project
              </label>
              <select id="inv-project" name="project" className="select" required>
                <option value="">Choose a project…</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.reference} · {project.clientName}
                  </option>
                ))}
              </select>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="inv-stage">
                  Stage
                </label>
                <select id="inv-stage" name="stage" className="select" defaultValue="retention">
                  <option value="retention">Other / retention</option>
                  <option value="down_payment">Down payment</option>
                  <option value="delivery">On delivery</option>
                  <option value="commissioning">On commissioning</option>
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="inv-amount">
                  Amount
                </label>
                <input
                  id="inv-amount"
                  name="amount"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="inv-due">
                Due date
              </label>
              <input id="inv-due" name="due" className="input" type="date" required />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="inv-notes">
                What it is for
              </label>
              <textarea id="inv-notes" name="notes" className="textarea" rows={3} />
              <span className="field__hint">
                The customer reads this. "Service call 4 Sept — inverter fan replacement" beats
                "Additional works".
              </span>
            </div>

            <FormError error={createInvoice.error} />

            <Button type="submit" variant="primary" block disabled={createInvoice.isPending}>
              {createInvoice.isPending ? 'Raising…' : 'Raise the invoice'}
            </Button>
          </form>
        )}
      </Modal>

      {/* ------------------------------ REFUNDS AWAITING A SECOND PERSON */}
      {awaitingRefundConfirmation.length > 0 && (
        <Card style={{ marginTop: 'var(--space-6)', borderColor: 'var(--warning-solid)' }}>
          <CardHeader
            title={`Refunds awaiting confirmation (${awaitingRefundConfirmation.length})`}
            action={
              <span className="xs dim">You cannot confirm a refund you recorded yourself</span>
            }
          />
          <CardBody>
            <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
              These have been recorded and have NOT yet come off the invoice. Money leaving the
              company is the one place a second pair of eyes matters most.
            </p>

            <div className="stack stack--sm">
              {awaitingRefundConfirmation.map((refund) => (
                <div key={refund.id} className="row row--between">
                  <div>
                    <span className="strong small">{currency(refund.amount)}</span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      {refund.invoiceNumber} · {refund.clientName} · recorded by{' '}
                      {refund.recordedBy ?? 'somebody'} on {date(refund.recordedAt)}
                    </span>
                    <span className="xs dim" style={{ display: 'block' }}>
                      {refund.reason}
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={confirmRefund.isPending}
                    onClick={() => confirmRefund.mutate({ refundId: refund.id })}
                  >
                    Confirm it has gone back
                  </Button>
                </div>
              ))}
            </div>

            <FormError error={confirmRefund.error} />
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------------ RECORD A REFUND */}
      <Modal
        open={refundingInvoice !== null}
        onClose={() => {
          setRefundingInvoice(null)
          recordRefund.reset()
        }}
        title={refundingInvoice ? `Refund · ${refundingInvoice.number}` : 'Refund'}
      >
        {refundingInvoice && (
          <form className="stack" onSubmit={handleRecordRefund}>
            {refundablePayments.length === 0 ? (
              <p className="small muted">
                There are no verified payments against this invoice to refund. A payment that has
                not been confirmed as received should be cancelled rather than refunded.
              </p>
            ) : (
              <>
                <div className="field">
                  <label className="field__label" htmlFor="refund-payment">
                    Which payment is being reversed
                  </label>
                  <select id="refund-payment" name="payment" className="select" required>
                    {refundablePayments.map((payment) => (
                      <option key={payment.id} value={payment.id}>
                        {currency(payment.amount)} · {humanize(payment.method)} ·{' '}
                        {date(payment.paidAt)}
                        {payment.reference ? ` · ${payment.reference}` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="field__hint">
                    A refund names the payment it reverses, so the two can be matched on a
                    statement. You cannot refund more than that payment.
                  </span>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="refund-amount">
                    Amount to return
                  </label>
                  <input
                    id="refund-amount"
                    name="amount"
                    className="input"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                  />
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="refund-reason">
                    Why
                  </label>
                  <textarea
                    id="refund-reason"
                    name="reason"
                    className="textarea"
                    rows={3}
                    required
                    minLength={10}
                    placeholder="Contract cancelled before mobilisation; down payment returned less the survey fee."
                  />
                  <span className="field__hint">
                    This is the first thing an auditor reads. "Refund" on its own is refused.
                  </span>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="refund-ref">
                    Reference <span className="dim">(optional)</span>
                  </label>
                  <input
                    id="refund-ref"
                    name="reference"
                    className="input"
                    placeholder="Gateway refund id, or the bank transfer reference"
                  />
                </div>

                <FormError error={recordRefund.error} />

                <Button type="submit" variant="primary" block disabled={recordRefund.isPending}>
                  {recordRefund.isPending ? 'Recording…' : 'Record the refund'}
                </Button>

                <p className="xs dim">
                  Recording it does not move the invoice. A second person confirms it once the money
                  has actually gone back.
                </p>
              </>
            )}
          </form>
        )}
      </Modal>
    </>
  )
}
