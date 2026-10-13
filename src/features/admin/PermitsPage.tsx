import { type FormEvent, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { StatTile } from '@/components/ui/StatTile'
import { useAuth } from '@/app/auth/useAuth'
import { currency, date, humanize } from '@/lib/format'
import { useProjects } from '@/lib/queries/operations'
import {
  type Permit,
  type PermitStatus,
  type PermitType,
  isWorkPermit,
  useCreatePermit,
  useCreatePermitSet,
  useDeletePermit,
  usePermits,
  useRecordPermitDecision,
} from '@/lib/queries/procurement'

/* ============================================================================
   PermitsPage — the external-approval track.
   ----------------------------------------------------------------------------
   Permitting runs in parallel with procurement after a contract is executed,
   and the installation cannot legally start until it clears.

   THE PROBLEM THIS SCREEN EXISTS TO SOLVE
   Paranaque City Hall does not have a login here. Neither does Meralco. If the
   workflow could only advance when the external body clicked something, every
   project would stall for ever — so a project engineer records the outcome on
   their behalf.

   That is a compromise, and the screen is built to be honest about it rather
   than to hide it. Every decision captures who entered it, when, and the
   reference number the authority issued; the database refuses an approval that
   does not (`permits_decision_needs_recorder`); and the audit entry is written
   at WARNING severity, not info.

   That severity is doing real work. It separates "the utility approved this"
   from "an employee asserted that the utility approved this". Both are ordinary
   entries in a working business. Only one of them is evidence, and six months
   later — in a dispute, or an audit — somebody needs to be able to tell which
   they are looking at.
   ========================================================================== */

const PERMIT_TYPE_LABEL: Record<PermitType, string> = {
  lgu_building: 'LGU building permit',
  electrical: 'Electrical permit',
  utility_interconnection: 'Utility interconnection',
  net_metering: 'Net-metering application',
  permission_to_operate: 'Permission to operate',
}

const PERMIT_TYPE_HINT: Record<PermitType, string> = {
  lgu_building: 'City or municipal hall. Usually the longest lead time. Needed before work starts.',
  electrical:
    'Signed off by a licensed electrical engineer, filed with the LGU. Needed before work starts.',
  utility_interconnection:
    'Meralco or the local distribution utility. Needed before the system is switched on.',
  net_metering: 'Required before the customer can export to the grid.',
  permission_to_operate: 'The final clearance. Nothing may be energised without it.',
}

const STATUS_TONE: Record<PermitStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  preparing: 'neutral',
  submitted: 'info',
  under_review: 'warning',
  approved: 'success',
  rejected: 'danger',
}

export function PermitsPage() {
  const { user } = useAuth()
  const permitsQuery = usePermits()
  const projectsQuery = useProjects()
  const allPermits = permitsQuery.data ?? []
  // Permits are for jobs still to be built; a finished or cancelled one needs none.
  const projects = (projectsQuery.data ?? []).filter(
    (p) => p.status !== 'cancelled' && p.status !== 'completed',
  )

  const createPermit = useCreatePermit()
  const createSet = useCreatePermitSet()
  const deletePermit = useDeletePermit()
  const recordDecision = useRecordPermitDecision()

  const [adding, setAdding] = useState(false)
  const [addingSet, setAddingSet] = useState(false)
  const [setResult, setSetResult] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<Permit | null>(null)
  const [projectFilter, setProjectFilter] = useState('')

  const permits = projectFilter
    ? allPermits.filter((p) => p.projectId === projectFilter)
    : allPermits

  const approved = permits.filter((p) => p.status === 'approved')
  const blocked = permits.filter((p) => p.status === 'rejected')
  const waiting = permits.filter((p) => p.status === 'submitted' || p.status === 'under_review')
  const unfiled = permits.filter((p) => p.status === 'preparing')
  const fees = permits.reduce((sum, p) => sum + (p.feeAmount ?? 0), 0)

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    createPermit.mutate(
      {
        projectId: String(form.get('project')),
        permitType: String(form.get('type')) as PermitType,
        authority: String(form.get('authority') ?? ''),
        feeAmount: form.get('fee') ? Number(form.get('fee')) : undefined,
      },
      { onSuccess: () => setAdding(false) },
    )
  }

  function handleAddSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    createSet.mutate(
      {
        projectId: String(form.get('project')),
        municipality: String(form.get('municipality') ?? ''),
        utility: String(form.get('utility') ?? ''),
        netMetering: form.get('netMetering') === 'on',
      },
      {
        onSuccess: (added) => {
          setAddingSet(false)
          setSetResult(
            added === 0
              ? 'That project already tracks every standard application.'
              : `${added} application${added === 1 ? '' : 's'} added — record each one as it is filed.`,
          )
        },
      },
    )
  }

  function handleDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!deciding || !user) return
    const form = new FormData(event.currentTarget)

    recordDecision.mutate(
      {
        permitId: deciding.id,
        status: String(form.get('status')) as PermitStatus,
        externalReference: String(form.get('reference') ?? ''),
        findings: String(form.get('findings') ?? ''),
        userId: user.id,
      },
      { onSuccess: () => setDeciding(null) },
    )
  }

  return (
    <>
      <PageHeader
        title="Permits & approvals"
        description="The external-approval track. Decisions are recorded on behalf of the issuing body, and marked as such."
        breadcrumbs={[{ label: 'Operations' }, { label: 'Permits' }]}
        actions={
          <>
            <Button variant="outline" onClick={() => setAdding(true)}>
              + One permit
            </Button>
            <Button variant="primary" onClick={() => setAddingSet(true)}>
              + Standard set for a project
            </Button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Approved" value={String(approved.length)} />
        <StatTile
          label="Awaiting a decision"
          value={String(waiting.length)}
          delta={
            waiting.length
              ? waiting.some((p) => isWorkPermit(p.permitType))
                ? 'Blocking installation'
                : 'Holding up commissioning'
              : unfiled.length
                ? `${unfiled.length} still to file`
                : 'Nothing outstanding'
          }
          direction={waiting.length || unfiled.length ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile label="Rejected" value={String(blocked.length)} />
        <StatTile label="Fees recorded" value={currency(fees)} />
      </div>

      {/* ------------------------------------------- THE HONEST NOTE */}
      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <CardBody>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.5rem' }}>🏛️</span>
            <div>
              <h4 style={{ margin: 0 }}>These are proxy entries</h4>
              <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                City halls and utilities do not have accounts here, so a project engineer records
                what they decided. Every decision is stored with who entered it, when, and the
                reference number the authority issued — and is written to the audit log at{' '}
                <strong>warning</strong> severity, so that a reader can tell an external decision
                apart from an employee&apos;s assertion of one. Enter the reference exactly as it
                appears on the document.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="All permits"
          action={
            <select
              className="select"
              style={{ width: 'auto', fontSize: 'var(--text-xs)' }}
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="Show permits for"
            >
              <option value="">Every project</option>
              {(projectsQuery.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.reference} — {p.clientName}
                </option>
              ))}
            </select>
          }
        />
        <CardBody>
          {setResult && (
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
              {setResult}
            </p>
          )}
          <FormError error={deletePermit.error} />
          <QueryState
            isLoading={permitsQuery.isLoading}
            error={permitsQuery.error as Error | null}
            isEmpty={permits.length === 0}
            emptyIcon="🏛️"
            emptyTitle="No permits tracked yet"
            emptyMessage="Add the applications a project needs, then record each decision as it comes back."
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Permit</th>
                    <th>Authority</th>
                    <th>Status</th>
                    <th>Reference</th>
                    <th>Recorded by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {permits.map((permit) => (
                    <tr key={permit.id}>
                      <td>
                        <code>{permit.projectReference}</code>
                      </td>
                      <td>
                        <div className="strong small">{PERMIT_TYPE_LABEL[permit.permitType]}</div>
                        <div className="xs dim">{PERMIT_TYPE_HINT[permit.permitType]}</div>
                      </td>
                      <td className="small">{permit.authority}</td>
                      <td>
                        <Badge tone={STATUS_TONE[permit.status]}>{humanize(permit.status)}</Badge>
                      </td>
                      <td className="small">
                        {permit.externalReference ? (
                          <code>{permit.externalReference}</code>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td className="xs">
                        {permit.recordedByName ? (
                          <>
                            {permit.recordedByName}
                            <span className="dim" style={{ display: 'block' }}>
                              {permit.recordedAt ? date(permit.recordedAt) : ''}
                            </span>
                          </>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          <Button variant="outline" size="sm" onClick={() => setDeciding(permit)}>
                            {permit.status === 'approved' || permit.status === 'rejected'
                              ? 'Amend'
                              : 'Record outcome'}
                          </Button>
                          {permit.status === 'preparing' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={deletePermit.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Remove the ${PERMIT_TYPE_LABEL[permit.permitType]} for ${permit.projectReference}?`,
                                  )
                                ) {
                                  deletePermit.mutate({ id: permit.id })
                                }
                              }}
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </QueryState>
        </CardBody>
      </Card>

      {/* ---------------------------------------------- ADD A PERMIT */}
      <Modal open={adding} onClose={() => setAdding(false)} title="Track a permit">
        <form className="stack" onSubmit={handleAdd}>
          <div className="field">
            <label className="field__label" htmlFor="permit-project">
              Project
            </label>
            <select id="permit-project" name="project" className="select" required defaultValue="">
              <option value="" disabled>
                Select a project…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.reference} — {p.clientName}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="permit-type">
              Permit type
            </label>
            <select id="permit-type" name="type" className="select" defaultValue="lgu_building">
              {(Object.keys(PERMIT_TYPE_LABEL) as PermitType[]).map((type) => (
                <option key={type} value={type}>
                  {PERMIT_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="permit-authority">
              Issuing authority
            </label>
            <input
              id="permit-authority"
              name="authority"
              className="input"
              required
              placeholder="e.g. Paranaque City Hall, Meralco"
            />
            <span className="field__hint">
              Name the office as it appears on the paperwork — this is what someone will check
              against later.
            </span>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="permit-fee">
              Fee <span className="dim">(optional)</span>
            </label>
            <input id="permit-fee" name="fee" className="input" type="number" min="0" step="0.01" />
          </div>

          <FormError error={createPermit.error} />

          <Button type="submit" variant="primary" block disabled={createPermit.isPending}>
            {createPermit.isPending ? 'Adding…' : 'Track this permit'}
          </Button>
        </form>
      </Modal>

      {/* ---------------------------------------- THE STANDARD SET */}
      <Modal
        open={addingSet}
        onClose={() => setAddingSet(false)}
        title="Standard permits for a project"
      >
        <form className="stack" onSubmit={handleAddSet}>
          <p className="small muted">
            Adds the building and electrical permits, the utility interconnection, net metering and
            permission to operate — each as &ldquo;preparing&rdquo;. Any the project already tracks
            are skipped.
          </p>
          <p className="small muted">
            The crew waits for the building and electrical permits. The utility&rsquo;s approvals
            come after it has inspected the installation, and hold up only the sign-off of
            commissioning.
          </p>
          <div className="field">
            <label className="field__label" htmlFor="set-project">
              Project
            </label>
            <select id="set-project" name="project" className="select" required defaultValue="">
              <option value="" disabled>
                Select a project…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.reference} — {p.clientName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="set-municipality">
              City or municipality
            </label>
            <input
              id="set-municipality"
              name="municipality"
              className="input"
              required
              placeholder="e.g. Paranaque City Hall"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="set-utility">
              Distribution utility
            </label>
            <input
              id="set-utility"
              name="utility"
              className="input"
              required
              defaultValue="Meralco"
            />
          </div>
          <label className="row small" style={{ gap: 'var(--space-2)' }}>
            <input type="checkbox" name="netMetering" defaultChecked />
            The customer will export to the grid (net metering)
          </label>
          <FormError error={createSet.error} />
          <Button type="submit" variant="primary" block disabled={createSet.isPending}>
            {createSet.isPending ? 'Adding…' : 'Add the applications'}
          </Button>
        </form>
      </Modal>

      {/* -------------------------------------------- RECORD OUTCOME */}
      <Modal
        open={deciding !== null}
        onClose={() => setDeciding(null)}
        title={deciding ? `Record outcome · ${PERMIT_TYPE_LABEL[deciding.permitType]}` : 'Record'}
      >
        {deciding && (
          <form className="stack" onSubmit={handleDecision}>
            <div
              style={{
                padding: 'var(--space-3)',
                background: 'var(--ink-50)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div className="small strong">{deciding.authority}</div>
              <div className="xs dim">
                {deciding.projectReference} · currently {humanize(deciding.status)}
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="permit-status">
                What happened?
              </label>
              <select
                id="permit-status"
                name="status"
                className="select"
                defaultValue={deciding.status}
              >
                <option value="preparing">Still preparing the application</option>
                <option value="submitted">Submitted to the authority</option>
                <option value="under_review">Under review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="permit-ref">
                Reference number from the authority
              </label>
              <input
                id="permit-ref"
                name="reference"
                className="input"
                defaultValue={deciding.externalReference ?? ''}
                placeholder="e.g. BP-2026-04821"
              />
              <span className="field__hint">
                Required for an approval or rejection. Without it nobody can verify the decision
                against the issuing body&apos;s own records.
              </span>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="permit-findings">
                Notes or findings <span className="dim">(optional)</span>
              </label>
              <textarea
                id="permit-findings"
                name="findings"
                className="textarea"
                rows={3}
                defaultValue={deciding.findings ?? ''}
                placeholder="Conditions attached, what needs correcting, who you spoke to…"
              />
            </div>

            <p className="xs dim">
              This will be recorded as entered by <strong>{user?.fullName}</strong> on behalf of{' '}
              {deciding.authority}, and written to the audit log as a proxy entry.
            </p>

            <FormError error={recordDecision.error} />

            <Button type="submit" variant="primary" block disabled={recordDecision.isPending}>
              {recordDecision.isPending ? 'Recording…' : 'Record this outcome'}
            </Button>
          </form>
        )}
      </Modal>
    </>
  )
}
