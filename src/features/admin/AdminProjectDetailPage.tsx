import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DownloadButton } from '@/components/ui/DownloadButton'
import { Modal } from '@/components/ui/Modal'
import { TurnoverCertificate } from '@/components/ui/TurnoverCertificate'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Progress } from '@/components/ui/Progress'
import { Tabs } from '@/components/ui/Tabs'
import { Timeline } from '@/components/ui/Timeline'
import {
  useProject,
  useProjectGate,
  useUpdateMilestone,
  useProjectBom,
  useUpdateProjectStatus,
} from '@/lib/queries/operations'
import { currency, date, humanize } from '@/lib/format'
import {
  INVOICE_STATUS_TONE,
  PAYMENT_STAGE_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  SYSTEM_TYPE_LABEL,
} from '@/lib/labels'
import { useAllInvoices } from '@/lib/queries/inventory-finance'
import { useMyDocuments } from '@/lib/queries/client-portal'
import { useCompany } from '@/lib/queries/public-site'
import { useUploadProjectFile } from '@/lib/queries/storage'
import { FormError } from '@/components/ui/FormError'

/* ============================================================================
   AdminProjectDetailPage — the operational record for a single installation.
   ----------------------------------------------------------------------------
   THE HUB WHERE FIVE MODULES MEET. Tabs, rather than five separate pages,
   because a project engineer answering a question needs all of it at once:

     Milestones → Project Operations   (also drives the client's progress bar)
     Materials  → Inventory            (the BOM, and the stock it reserves)
     Finance    → Finance module       (staged invoices for this project)
     Documents  → Document vault       (the same files the client can see)
     Activity   → Audit log            (who changed what, and when)
   ========================================================================== */

type Tab = 'milestones' | 'materials' | 'finance' | 'documents' | 'activity'

export function AdminProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [tab, setTab] = useState<Tab>('milestones')
  const gateQuery = useProjectGate(projectId)
  const uploadFile = useUploadProjectFile()
  const updateMilestone = useUpdateMilestone()
  const fileInput = useRef<HTMLInputElement>(null)

  /* The Upload button had no handler, so a project's contracts, permits and
     inspection reports could only ever arrive through the database. The
     customer's Document Vault reads the same rows. */
  function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !projectId) return
    uploadFile.mutate({ file, projectId, kind: 'other', clientVisible: true })
    event.target.value = ''
  }

  /* Two dead buttons sat in this page's header. "Update status" is the one a
     coordinator reaches for when a job stalls waiting on a permit, and without
     it the project went on telling the customer "In progress" for weeks. */
  const updateStatus = useUpdateProjectStatus()
  const [changingStatus, setChangingStatus] = useState(false)
  const [certifying, setCertifying] = useState(false)
  const company = useCompany()

  const bomQuery = useProjectBom(projectId)
  const projectQuery = useProject(projectId)
  const invoicesQuery = useAllInvoices()
  const documentsQuery = useMyDocuments()
  const project = projectQuery.data

  if (!project) {
    return (
      <EmptyState
        icon="🔍"
        title="Project not found"
        message="This reference does not match any project record."
        action={
          <ButtonLink to="/admin/projects" variant="outline">
            Back to all projects
          </ButtonLink>
        }
      />
    )
  }

  const done = project.milestones.filter((m) => m.status === 'done').length
  const projectInvoices = (invoicesQuery.data ?? []).filter((i) => i.projectId === project.id)
  const projectDocs = (documentsQuery.data ?? []).filter((d) => d.projectId === project.id)
  /* The real bill of materials, from the quotation the contract was built on.
     Empty until a contract exists, which is an honest state for a project that
     has only just been created. */
  const bom = bomQuery.data ?? []
  const bomTotal = bom.reduce((sum, line) => sum + line.lineTotal, 0)

  return (
    <>
      <PageHeader
        title={project.clientName}
        description={project.address}
        breadcrumbs={[{ label: 'Projects', to: '/admin/projects' }, { label: project.reference }]}
        actions={
          <>
            <Badge tone={PROJECT_STATUS_TONE[project.status]}>
              {PROJECT_STATUS_LABEL[project.status]}
            </Badge>
            <Button
              variant="outline"
              disabled={project.status !== 'completed'}
              // Say why rather than greying out silently.
              title={
                project.status === 'completed'
                  ? undefined
                  : 'Available once the project is marked completed — a certificate that says the work is finished when it is not is worse than none'
              }
              onClick={() => setCertifying(true)}
            >
              Generate turnover certificate
            </Button>
            <Button variant="primary" onClick={() => setChangingStatus(true)}>
              Update status
            </Button>
          </>
        }
      />

      {/* ------------------------------------------- SUMMARY STRIP */}
      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <CardBody>
          <div className="grid grid--4">
            <div>
              <div className="small dim">Reference</div>
              <div className="strong">{project.reference}</div>
            </div>
            <div>
              <div className="small dim">System</div>
              <div className="strong">
                {project.systemKw} kW · {SYSTEM_TYPE_LABEL[project.systemType]}
              </div>
            </div>
            <div>
              <div className="small dim">Contract value</div>
              <div className="strong num">{currency(project.contractValue)}</div>
            </div>
            <div>
              <div className="small dim">Engineer</div>
              <div className="strong">{project.assignedEngineer}</div>
            </div>
          </div>

          <div className="grid grid--2" style={{ marginTop: 'var(--space-5)' }}>
            <Progress
              value={done / project.milestones.length}
              label={`Installation — ${done}/${project.milestones.length} milestones`}
              tone={project.status === 'completed' ? 'success' : 'brand'}
            />
            <Progress
              value={project.amountPaid / project.contractValue}
              label={`Collections — ${currency(project.amountPaid)} of ${currency(project.contractValue)}`}
              tone="success"
            />
          </div>
        </CardBody>
      </Card>

      <Tabs
        tabs={[
          { value: 'milestones' as Tab, label: 'Milestones' },
          { value: 'materials' as Tab, label: 'Materials & BOM', count: bom.length },
          { value: 'finance' as Tab, label: 'Finance', count: projectInvoices.length },
          { value: 'documents' as Tab, label: 'Documents', count: projectDocs.length },
          { value: 'activity' as Tab, label: 'Activity' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ------------------------------------------------ MILESTONES */}
      {tab === 'milestones' && (
        <>
          {/* THE SYNCHRONISE GATE
              Permitting and procurement run in parallel; physical work waits
              for both. Shown here as a status rather than only enforced as a
              refusal, because "why can't the crew start?" is otherwise a phone
              call to the engineer. The figures come from the same database
              function the trigger uses, so the screen cannot disagree with the
              rule it is describing. */}
          {gateQuery.data && !isComplete(gateQuery.data) && (
            <Card
              style={{
                marginBottom: 'var(--space-6)',
                borderColor:
                  gateQuery.data.permitsRejected > 0
                    ? 'var(--danger-solid)'
                    : 'var(--warning-solid)',
              }}
            >
              <CardHeader title="Before physical work can start" />
              <CardBody>
                <div className="grid grid--2">
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.25rem' }}>
                      {gateQuery.data.permitsReady
                        ? '✅'
                        : gateQuery.data.permitsRejected > 0
                          ? '⛔'
                          : '⏳'}
                    </span>
                    <div>
                      <div className="strong small">Permits</div>
                      <div className="xs dim">
                        {gateQuery.data.permitsTotal === 0
                          ? 'None tracked yet — add the applications this project needs.'
                          : `${gateQuery.data.permitsApproved} of ${gateQuery.data.permitsTotal} approved` +
                            (gateQuery.data.permitsRejected > 0
                              ? ` · ${gateQuery.data.permitsRejected} rejected`
                              : '')}
                      </div>
                    </div>
                  </div>

                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '1.25rem' }}>
                      {gateQuery.data.materialsReady ? '✅' : '⏳'}
                    </span>
                    <div>
                      <div className="strong small">Materials</div>
                      <div className="xs dim">
                        {gateQuery.data.reservations === 0
                          ? 'Nothing reserved against this project.'
                          : gateQuery.data.reservationsShort > 0
                            ? `${gateQuery.data.reservationsShort} of ${gateQuery.data.reservations} lines short — raise a purchase order.`
                            : `${gateQuery.data.reservations} lines held in the warehouse.`}
                      </div>
                    </div>
                  </div>
                </div>

                <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
                  Structural mounting is refused until both are clear. An administrator can override
                  it — reality does not always wait for paperwork — and the override is written to
                  the audit log so it can be found later.
                </p>
              </CardBody>
            </Card>
          )}

          <div className="grid grid--2" style={{ alignItems: 'start' }}>
            <Card>
              <CardHeader
                title="Installation milestones"
                action={<span className="xs dim">Updated from the field portal</span>}
              />
              <CardBody>
                <Timeline milestones={project.milestones} />

                {/* The office counterpart to the field portal's completion.
                    A project engineer needs to mark a stage BLOCKED when a
                    permit is refused or a delivery slips — the technician's app
                    only moves stages forward. The database enforces the ordering
                    and the synchronise gate either way, so this cannot be used
                    to skip ahead. */}
                <div className="stack stack--sm" style={{ marginTop: 'var(--space-5)' }}>
                  <span className="xs dim strong">UPDATE A STAGE</span>
                  {project.milestones.map((milestone) => (
                    <div key={milestone.key} className="row row--between">
                      <span className="small">{milestone.label}</span>
                      <select
                        className="select"
                        style={{ width: 'auto', fontSize: 'var(--text-xs)' }}
                        value={milestone.status}
                        /* `Milestone.id` is optional — the key alone is not
                           unique across projects, so an update needs the row
                           id and cannot proceed without one. */
                        disabled={updateMilestone.isPending || !milestone.id}
                        onChange={(e) =>
                          updateMilestone.mutate({
                            milestoneId: milestone.id!,
                            status: e.target.value as 'pending',
                          })
                        }
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In progress</option>
                        <option value="done">Done</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </div>
                  ))}
                  <FormError error={updateMilestone.error} />
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Schedule" />
              <CardBody>
                <div className="stack stack--sm">
                  <div className="row row--between">
                    <span className="muted">Start date</span>
                    <span className="strong">{date(project.startDate)}</span>
                  </div>
                  <div className="row row--between">
                    <span className="muted">Target turnover</span>
                    <span className="strong">{date(project.targetTurnover)}</span>
                  </div>
                  <div className="row row--between">
                    <span className="muted">Assigned engineer</span>
                    <span className="strong">{project.assignedEngineer}</span>
                  </div>
                </div>
                <div style={{ marginTop: 'var(--space-5)' }}>
                  <ButtonLink to="/admin/dispatch" variant="outline" block>
                    Open dispatch board →
                  </ButtonLink>
                </div>
              </CardBody>
            </Card>
          </div>
        </>
      )}

      {/* ------------------------------------------------- MATERIALS */}
      {tab === 'materials' && (
        <Card>
          <CardHeader
            title="Bill of Materials"
            action={<Badge tone="success">Stock reserved</Badge>}
          />
          <CardBody>
            <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
              Generated automatically from the contracted package. Signing the contract reserved
              these quantities in inventory so they cannot be sold to another project.
            </p>

            {bom.length === 0 ? (
              <p className="small muted">
                No bill of materials yet. One is built from the quotation when the contract is
                executed — until then there is nothing to reserve stock against.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="table__num">Qty</th>
                      <th className="table__num">Held</th>
                      <th className="table__num">Unit cost</th>
                      <th className="table__num">Line total</th>
                      <th>Stock status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bom.map((line, index) => {
                      /* The old check was `available >= 0`, which compares the
                         warehouse balance against zero rather than against what
                         this job needs — so all but an oversold item read
                         "Reserved". What matters is how much of THIS line the
                         warehouse actually managed to hold. */
                      const shortfall = line.quantity - line.quantityHeld

                      return (
                        <tr key={line.stockItemId ?? `line-${index}`}>
                          <td className="strong">{line.description}</td>
                          <td className="table__num">{line.quantity}</td>
                          <td className="table__num">{line.quantityHeld}</td>
                          <td className="table__num">{currency(line.unitPrice)}</td>
                          <td className="table__num strong">{currency(line.lineTotal)}</td>
                          <td>
                            {shortfall <= 0 ? (
                              <Badge tone="success">Reserved</Badge>
                            ) : (
                              <Badge tone="danger">Short {shortfall}</Badge>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    <tr>
                      <td colSpan={4} className="strong" style={{ textAlign: 'right' }}>
                        Material cost
                      </td>
                      <td className="table__num strong">{currency(bomTotal)}</td>
                      <td />
                    </tr>
                    <tr>
                      <td colSpan={4} className="strong" style={{ textAlign: 'right' }}>
                        Gross margin
                      </td>
                      <td
                        className="table__num strong"
                        style={{
                          color:
                            project.contractValue - bomTotal >= 0
                              ? 'var(--success-fg)'
                              : 'var(--danger-fg)',
                        }}
                      >
                        {currency(project.contractValue - bomTotal)}
                      </td>
                      <td>
                        <span className="small dim">
                          {project.contractValue > 0
                            ? `${Math.round(
                                ((project.contractValue - bomTotal) / project.contractValue) * 100,
                              )}%`
                            : '—'}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
                  Material cost only. Labour, permits, transport and warranty provision are not in
                  this figure, so the margin shown is gross and not what the job earns.
                </p>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* --------------------------------------------------- FINANCE */}
      {tab === 'finance' && (
        <Card>
          <CardHeader title="Staged invoices" />
          <CardBody>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Stage</th>
                    <th>Issued</th>
                    <th>Due</th>
                    <th className="table__num">Amount</th>
                    <th className="table__num">Paid</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {projectInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <code>{inv.number}</code>
                      </td>
                      <td>{PAYMENT_STAGE_LABEL[inv.stage]}</td>
                      <td>{date(inv.issuedAt)}</td>
                      <td>{date(inv.dueAt)}</td>
                      <td className="table__num">{currency(inv.amount)}</td>
                      <td className="table__num">{currency(inv.amountPaid)}</td>
                      <td>
                        <Badge tone={INVOICE_STATUS_TONE[inv.status]}>{humanize(inv.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------------- DOCUMENTS */}
      {tab === 'documents' && (
        <Card>
          <CardHeader
            title="Project documents"
            action={
              <>
                <input
                  ref={fileInput}
                  type="file"
                  onChange={handleUpload}
                  style={{ display: 'none' }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploadFile.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploadFile.isPending ? 'Uploading…' : 'Upload'}
                </Button>
              </>
            }
          />
          <CardBody>
            <FormError error={uploadFile.error} />
            <div className="stack stack--sm">
              {projectDocs.map((doc) => (
                <div key={doc.id} className="row row--between">
                  <span className="row">
                    <span>📄</span>
                    <span>
                      <span className="strong small">{doc.name}</span>
                      <span className="xs dim" style={{ display: 'block' }}>
                        {humanize(doc.kind)} · {date(doc.uploadedAt)}
                      </span>
                    </span>
                  </span>
                  {/* Staff need the same file the customer can already
                      fetch from their vault; this one did nothing at all. */}
                  <DownloadButton storagePath={doc.storagePath} />
                </div>
              ))}
            </div>
            <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
              These are the same files the client sees in their portal vault.
            </p>
          </CardBody>
        </Card>
      )}

      {/* -------------------------------------------------- ACTIVITY */}
      {tab === 'activity' && (
        <Card>
          <CardHeader title="Activity log" />
          <CardBody>
            <div className="stack">
              {project.milestones
                .filter((m) => m.completedAt)
                .reverse()
                .map((m) => (
                  <div key={m.key} className="row" style={{ alignItems: 'flex-start' }}>
                    <span>✅</span>
                    <div>
                      <div className="small strong">{m.label} marked complete</div>
                      <div className="xs dim">
                        {m.completedBy} · {m.completedAt && date(m.completedAt)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
            <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
              The full immutable trail, including financial changes and status overrides, is on the{' '}
              <strong>Audit Log</strong> page.
            </p>
          </CardBody>
        </Card>
      )}

      {/* --------------------------------------------- CHANGE STATUS */}
      <Modal
        open={changingStatus}
        onClose={() => setChangingStatus(false)}
        title={`Update ${project.reference}`}
      >
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            updateStatus.mutate(
              { id: project.id, status: String(form.get('status')) as typeof project.status },
              { onSuccess: () => setChangingStatus(false) },
            )
          }}
        >
          <div className="field">
            <label className="field__label" htmlFor="proj-status">
              Status
            </label>
            <select id="proj-status" name="status" className="select" defaultValue={project.status}>
              <option value="planning">Planning</option>
              <option value="in_progress">In progress</option>
              <option value="on_hold">On hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <span className="field__hint">
              The customer sees this on their own project page. Milestones are not affected — those
              have their own ordering rules.
            </span>
          </div>

          <FormError error={updateStatus.error} />

          <Button type="submit" variant="primary" block disabled={updateStatus.isPending}>
            {updateStatus.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </Modal>

      {/* ---------------------------------------- TURNOVER CERTIFICATE */}
      <TurnoverCertificate
        open={certifying}
        onClose={() => setCertifying(false)}
        data={{
          projectReference: project.reference,
          clientName: project.clientName,
          address: project.address,
          systemSize: project.systemKw,
          contractValue: project.contractValue,
          completedAt: project.targetTurnover,
          engineerName: project.assignedEngineer,
          warrantyPanelYears: company.warrantyPanelYears,
          warrantyInverterYears: company.warrantyInverterYears,
          warrantyWorkmanshipYears: company.warrantyWorkmanshipYears,
          company: {
            name: company.name,
            address: company.address,
            email: company.email,
            phone: company.phone,
          },
        }}
      />
    </>
  )
}

/** Both halves clear, so there is nothing left to explain. */
function isComplete(gate: { permitsReady: boolean; materialsReady: boolean }): boolean {
  return gate.permitsReady && gate.materialsReady
}
