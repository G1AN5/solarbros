import { type FormEvent, useState } from 'react'

import { useAuth } from '@/app/auth/useAuth'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { QuotationDocument } from '@/components/ui/QuotationDocument'
import { currency, date } from '@/lib/format'
import { QUOTATION_STATUS_TONE, SYSTEM_TYPE_LABEL } from '@/lib/labels'
import { useCompany } from '@/lib/queries/public-site'
import {
  type MyQuotation,
  useMyQuotations,
  useQuotationItems,
  useRespondToQuotation,
} from '@/lib/queries/sales'
import { settingNum, useSettings } from '@/lib/queries/settings'

/* ============================================================================
   MyQuotationsCard — what we have quoted, and the customer's answer.
   ----------------------------------------------------------------------------
   A customer could not see a quotation in their portal at all: it went out as
   an email attachment the rep made by hand, and "yes" was a phone call the rep
   then recorded for them. The quotation is now here to read, print and answer
   — accepting it tells the sales team to prepare the contract, which then
   appears on this same dashboard to sign.

   Only descriptions and quantities are shown, through a function that returns
   nothing else (0074). Unit costs are what the company pays; they never reach
   the customer's browser.
   ========================================================================== */

const STATUS_TEXT: Record<MyQuotation['status'], string> = {
  draft: 'Draft',
  pending_approval: 'Being prepared',
  sent: 'Awaiting your answer',
  accepted: 'Accepted',
  rejected: 'Declined',
  expired: 'Expired',
}

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function MyQuotationsCard() {
  const { user } = useAuth()
  const quotationsQuery = useMyQuotations()
  const respond = useRespondToQuotation()
  const company = useCompany()
  const settings = useSettings().data

  const [viewing, setViewing] = useState<MyQuotation | null>(null)
  const [declining, setDeclining] = useState<MyQuotation | null>(null)
  const [answered, setAnswered] = useState<{ reference: string; accepted: boolean } | null>(null)
  const items = useQuotationItems(viewing?.id).data ?? []

  const quotations = quotationsQuery.data ?? []
  if (quotations.length === 0) return null

  const today = todayIso()
  const isOpen = (q: MyQuotation) => q.status === 'sent' && (!q.validUntil || q.validUntil >= today)

  function accept(q: MyQuotation) {
    if (
      !window.confirm(
        `Accept quotation ${q.reference} for ${currency(q.totalPrice)}? We will prepare your contract, and it appears here for you to sign.`,
      )
    ) {
      return
    }
    respond.mutate(
      { id: q.id, accept: true },
      { onSuccess: () => setAnswered({ reference: q.reference, accepted: true }) },
    )
  }

  function decline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!declining) return
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '')
    const reference = declining.reference
    respond.mutate(
      { id: declining.id, accept: false, reason },
      {
        onSuccess: () => {
          setDeclining(null)
          setAnswered({ reference, accepted: false })
        },
      },
    )
  }

  return (
    <Card style={{ marginBottom: 'var(--space-6)' }}>
      <CardHeader title="Your quotations" />
      <CardBody>
        {answered && (
          <p
            className="small"
            style={{
              marginBottom: 'var(--space-4)',
              padding: 'var(--space-3)',
              background: answered.accepted ? 'var(--success-bg)' : 'var(--ink-50)',
              color: answered.accepted ? 'var(--success-fg)' : undefined,
              borderRadius: 'var(--radius)',
            }}
          >
            {answered.accepted
              ? `Thank you — ${answered.reference} is accepted. We are preparing your contract; it will appear on this page for you to sign, and you will be notified.`
              : `Thank you for letting us know. Our team will be in touch about ${answered.reference} — we may be able to revise it.`}
          </p>
        )}

        <div className="stack stack--sm">
          {quotations.map((q) => {
            const open = isOpen(q)
            const expired = q.status === 'expired' || (q.status === 'sent' && !open)
            return (
              <div
                key={q.id}
                style={{
                  padding: 'var(--space-4)',
                  border: `1px solid ${open ? 'var(--brand-500)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                }}
              >
                <div className="row row--between row--wrap" style={{ gap: 'var(--space-3)' }}>
                  <div>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <code>{q.reference}</code>
                      <Badge
                        tone={expired ? 'neutral' : (QUOTATION_STATUS_TONE[q.status] ?? 'neutral')}
                      >
                        {expired ? 'Expired' : STATUS_TEXT[q.status]}
                      </Badge>
                    </div>
                    <div className="strong" style={{ marginTop: 'var(--space-2)' }}>
                      {q.systemKw} kWp {SYSTEM_TYPE_LABEL[q.systemType]} system ·{' '}
                      {currency(q.totalPrice)}
                    </div>
                    <div className="xs dim">
                      {q.panelCount ? `${q.panelCount} panels · ` : ''}
                      {q.batteryCount > 0 ? `${q.batteryCount} battery modules · ` : ''}
                      {q.validUntil ? `valid until ${date(q.validUntil)}` : ''}
                    </div>
                    {q.status === 'rejected' && q.rejectionReason && (
                      <div className="xs dim">Declined: {q.rejectionReason}</div>
                    )}
                    {expired && (
                      <div className="xs dim">
                        This offer has lapsed. Ask us for an updated quotation.
                      </div>
                    )}
                  </div>

                  <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
                    <Button variant="ghost" size="sm" onClick={() => setViewing(q)}>
                      View &amp; print
                    </Button>
                    {open && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={respond.isPending}
                          onClick={() => setDeclining(q)}
                        >
                          Decline…
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={respond.isPending}
                          onClick={() => accept(q)}
                        >
                          Accept
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {!declining && <FormError error={respond.error} />}
      </CardBody>

      <Modal
        open={declining !== null}
        onClose={() => {
          setDeclining(null)
          respond.reset()
        }}
        title={declining ? `Decline ${declining.reference}` : 'Decline'}
      >
        {declining && (
          <form className="stack" onSubmit={decline}>
            <div className="field">
              <label className="field__label" htmlFor="decline-reason">
                Could you tell us why?
              </label>
              <textarea
                id="decline-reason"
                name="reason"
                className="textarea"
                rows={3}
                required
                placeholder="Over budget, want a smaller system, going with another installer…"
              />
              <span className="field__hint">
                It helps us send you something that fits better, if you would like that.
              </span>
            </div>
            <FormError error={respond.error} />
            <Button type="submit" variant="primary" block disabled={respond.isPending}>
              {respond.isPending ? 'Sending…' : 'Decline this quotation'}
            </Button>
          </form>
        )}
      </Modal>

      <QuotationDocument
        open={viewing !== null}
        onClose={() => setViewing(null)}
        data={
          viewing
            ? {
                reference: viewing.reference,
                issuedAt: viewing.sentAt ?? new Date().toISOString(),
                validUntil: viewing.validUntil,
                customerName: user?.fullName ?? 'Customer',
                customerEmail: user?.email,
                systemKw: viewing.systemKw,
                systemType: viewing.systemType,
                panelCount: viewing.panelCount,
                batteryCount: viewing.batteryCount,
                totalPrice: viewing.totalPrice,
                discountPct: viewing.discountPct,
                items,
                split: {
                  downPayment: settingNum(settings, 'finance.down_payment_pct', 50),
                  delivery: settingNum(settings, 'finance.delivery_pct', 35),
                  commissioning: settingNum(settings, 'finance.commissioning_pct', 15),
                },
                warranty: {
                  panelYears: company.warrantyPanelYears,
                  inverterYears: company.warrantyInverterYears,
                  batteryYears: company.warrantyBatteryYears,
                  workmanshipYears: company.warrantyWorkmanshipYears,
                },
                company: {
                  name: company.name,
                  address: company.address,
                  email: company.email,
                  phone: company.phone,
                },
              }
            : null
        }
      />
    </Card>
  )
}
