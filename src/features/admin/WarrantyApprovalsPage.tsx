import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DownloadButton } from '@/components/ui/DownloadButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatTile } from '@/components/ui/StatTile'
import { date, humanize, relative } from '@/lib/format'
import { WARRANTY_STATUS_TONE } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import {
  type WarrantyRequestRow,
  useDocumentsByKind,
  useReviewWarrantyRequest,
  useWarrantyRequests,
} from '@/lib/queries/operations'
import { settingNum, useSettings } from '@/lib/queries/settings'
import { useNow } from '@/lib/use-now'
import { useAuth } from '@/app/auth/useAuth'

/* ============================================================================
   WarrantyApprovalsPage — review queue for client-submitted warranty requests.
   ----------------------------------------------------------------------------
   Two request types arrive from /portal/warranty:

     registration — the client confirms the installed hardware is theirs.
                    Usually auto-approvable: the serials already exist in the
                    asset registry from the technician's field scan.

     transfer     — the property was sold. Needs a HUMAN check of the proof of
                    sale, because approving it moves warranty entitlement to a
                    different person. Approval rewrites the asset registry's
                    owner and is written to the audit log.

   Approving a transfer is a privileged, hard-to-reverse action — hence the
   explicit two-button confirm rather than an inline toggle.
   ========================================================================== */

export function WarrantyApprovalsPage() {
  const { user } = useAuth()
  const requestsQuery = useWarrantyRequests()
  const review = useReviewWarrantyRequest()
  const requests = requestsQuery.data ?? []
  /* Approving a transfer moves warranty entitlement to a different person.
     Doing that without reading the proof of sale is not a review. */
  const proofs = useDocumentsByKind('proof_of_sale').data ?? {}

  const pending = requests.filter((r) => r.status === 'pending')
  const processed = requests.filter((r) => r.status !== 'pending')

  /* The review target is a setting, and was a typed "5-day SLA" that nothing
     measured. A request older than it is flagged. */
  const reviewDays = settingNum(useSettings().data, 'support.warranty_review_days', 5)
  const now = useNow()
  const overdue = (r: WarrantyRequestRow) =>
    (now - new Date(r.submittedAt).getTime()) / 86_400_000 > reviewDays
  const overdueCount = pending.filter(overdue).length

  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime()
  const approvedThisMonth = requests.filter(
    (r) =>
      r.status === 'approved' && r.reviewedAt && new Date(r.reviewedAt).getTime() >= monthStart,
  ).length

  const [rejecting, setRejecting] = useState<WarrantyRequestRow | null>(null)

  return (
    <>
      <PageHeader
        title="Warranty approvals"
        description="Review registrations and property-transfer requests from clients."
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile
          label="Pending review"
          value={String(pending.length)}
          delta={
            overdueCount
              ? `${overdueCount} past the ${reviewDays}-day target`
              : `${reviewDays}-day review target`
          }
          direction={overdueCount ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile
          label="Transfers"
          value={String(requests.filter((r) => r.type === 'transfer').length)}
        />
        <StatTile
          label="Registrations"
          value={String(requests.filter((r) => r.type === 'registration').length)}
        />
        <StatTile label="Approved this month" value={String(approvedThisMonth)} />
      </div>

      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <CardHeader
          title="Awaiting review"
          action={pending.length > 0 ? <Badge tone="warning">{pending.length}</Badge> : undefined}
        />
        <CardBody>
          <QueryState
            isLoading={requestsQuery.isLoading}
            error={requestsQuery.error as Error | null}
          >
            {pending.length === 0 ? (
              <EmptyState icon="✅" title="Queue is clear" message="No requests awaiting review." />
            ) : (
              <div className="stack">
                {pending.map((request) => {
                  const isTransfer = request.type === 'transfer'

                  return (
                    <div
                      key={request.id}
                      style={{
                        padding: 'var(--space-4)',
                        border: '1px solid var(--border)',
                        borderLeft: `3px solid ${isTransfer ? 'var(--warning-solid)' : 'var(--info-solid)'}`,
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      <div
                        className="row row--between row--wrap"
                        style={{ alignItems: 'flex-start' }}
                      >
                        <div>
                          <div className="row">
                            <Badge tone={isTransfer ? 'warning' : 'info'}>
                              {humanize(request.type)}
                            </Badge>
                            <span className="strong">{request.clientName}</span>
                            {overdue(request) && <Badge tone="danger">Overdue</Badge>}
                          </div>
                          <div className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                            {request.projectReference}
                          </div>
                          {request.transferToName && (
                            <div
                              className="small"
                              style={{
                                marginTop: 'var(--space-2)',
                                padding: 'var(--space-2) var(--space-3)',
                                background: 'var(--warning-bg)',
                                color: 'var(--warning-fg)',
                                borderRadius: 'var(--radius-sm)',
                              }}
                            >
                              ➜ Transfer to: <strong>{request.transferToName}</strong>
                              {[request.transferToEmail, request.transferToPhone]
                                .filter(Boolean)
                                .join(' · ') && (
                                <span>
                                  {' '}
                                  ·{' '}
                                  {[request.transferToEmail, request.transferToPhone]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </span>
                              )}
                              {request.expectedTransferDate && (
                                <span> · from {date(request.expectedTransferDate)}</span>
                              )}
                            </div>
                          )}
                          <div className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                            Submitted {relative(request.submittedAt)}
                          </div>
                        </div>

                        <div className="row">
                          {isTransfer && (
                            <DownloadButton
                              storagePath={proofs[request.projectId]?.storagePath}
                              label="View proof of sale"
                              missingHint="The customer has not uploaded a proof of sale — ask for one before approving a transfer"
                            />
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={review.isPending}
                            onClick={() => setRejecting(request)}
                          >
                            Reject…
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={review.isPending}
                            onClick={() =>
                              review.mutate({
                                id: request.id,
                                approve: true,
                                reviewerId: user?.id ?? '',
                              })
                            }
                          >
                            Approve
                          </Button>
                        </div>
                      </div>

                      {isTransfer && (
                        <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
                          ⚠ Approving reassigns warranty entitlement for every serialised unit on
                          this project. Verify the proof of sale first — this action is recorded in
                          the audit log.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </QueryState>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recently processed" />
        <CardBody>
          <FormError error={review.error} />
          {processed.length === 0 && <p className="small muted">Nothing decided yet.</p>}
          <div className="stack stack--sm">
            {processed.map((request) => (
              <div key={request.id} className="row row--between">
                <div>
                  <span className="small strong">{request.clientName}</span>
                  <span className="xs dim" style={{ display: 'block' }}>
                    {humanize(request.type)} · submitted {date(request.submittedAt)}
                    {request.reviewedAt ? ` · decided ${date(request.reviewedAt)}` : ''}
                  </span>
                  {request.reviewNotes && (
                    <span className="xs dim" style={{ display: 'block' }}>
                      {request.reviewNotes}
                    </span>
                  )}
                </div>
                <Badge tone={WARRANTY_STATUS_TONE[request.status]}>
                  {humanize(request.status)}
                </Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------------ REJECTING */}
      <Modal
        open={rejecting !== null}
        onClose={() => {
          setRejecting(null)
          review.reset()
        }}
        title={rejecting ? `Reject · ${rejecting.clientName}` : 'Reject'}
      >
        {rejecting && (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              review.mutate(
                {
                  id: rejecting.id,
                  approve: false,
                  reviewerId: user?.id ?? '',
                  notes: String(form.get('notes') ?? ''),
                },
                { onSuccess: () => setRejecting(null) },
              )
            }}
          >
            <div className="field">
              <label className="field__label" htmlFor="warranty-reject">
                Why
              </label>
              <textarea
                id="warranty-reject"
                name="notes"
                className="textarea"
                rows={3}
                required
                placeholder="The proof of sale does not name the new owner — please upload the deed of sale."
              />
              <span className="field__hint">
                The customer is told, and can submit again with what is missing.
              </span>
            </div>
            <FormError error={review.error} />
            <Button type="submit" variant="primary" block disabled={review.isPending}>
              {review.isPending ? 'Saving…' : 'Reject the request'}
            </Button>
          </form>
        )}
      </Modal>
    </>
  )
}
