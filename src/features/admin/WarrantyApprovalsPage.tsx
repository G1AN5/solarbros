import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DownloadButton } from '@/components/ui/DownloadButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatTile } from '@/components/ui/StatTile'
import { date, humanize, relative } from '@/lib/format'
import { WARRANTY_STATUS_TONE } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import {
  useDocumentsByKind,
  useReviewWarrantyRequest,
  useWarrantyRequests,
} from '@/lib/queries/operations'
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
          delta="5-day SLA"
          direction={pending.length ? 'up' : 'flat'}
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
        <StatTile
          label="Approved this month"
          value={String(requests.filter((r) => r.status === 'approved').length)}
        />
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
                            onClick={() =>
                              review.mutate({
                                id: request.id,
                                approve: false,
                                reviewerId: user?.id ?? '',
                              })
                            }
                          >
                            Reject
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
          <div className="stack stack--sm">
            {processed.map((request) => (
              <div key={request.id} className="row row--between">
                <div>
                  <span className="small strong">{request.clientName}</span>
                  <span className="xs dim" style={{ display: 'block' }}>
                    {humanize(request.type)} · {date(request.submittedAt)}
                  </span>
                </div>
                <Badge tone={WARRANTY_STATUS_TONE[request.status]}>
                  {humanize(request.status)}
                </Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </>
  )
}
