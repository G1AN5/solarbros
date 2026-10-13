import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useAuth } from '@/app/auth/useAuth'
import { Badge } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DownloadButton } from '@/components/ui/DownloadButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { PhotoGrid } from '@/components/ui/PhotoGrid'
import { Progress } from '@/components/ui/Progress'
import { QueryState } from '@/components/ui/QueryState'
import { Tabs } from '@/components/ui/Tabs'
import { Timeline } from '@/components/ui/Timeline'
import { TurnoverCertificate } from '@/components/ui/TurnoverCertificate'
import { currency, date, humanize } from '@/lib/format'
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_TONE,
  APPOINTMENT_TYPE_LABEL,
  DOCUMENT_KIND_LABEL,
  INVOICE_STATUS_TONE,
  PAYMENT_STAGE_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  ROLE_LABEL,
  SYSTEM_TYPE_LABEL,
} from '@/lib/labels'
import { useStaff } from '@/lib/queries/admin'
import { useAllInvoices } from '@/lib/queries/inventory-finance'
import {
  useAddCrewMember,
  useAllAppointments,
  useProject,
  useProjectAssets,
  useProjectBom,
  useProjectCrew,
  useProjectDocuments,
  useProjectGate,
  useRemoveCrewMember,
  useSetDocumentVisibility,
  useSetProjectEngineer,
  useStaffNames,
  useUpdateMilestone,
  useUpdateProjectStatus,
} from '@/lib/queries/operations'
import { usePermits } from '@/lib/queries/procurement'
import { useCompany } from '@/lib/queries/public-site'
import { useUploadProjectFile } from '@/lib/queries/storage'
import type { DocumentKind } from '@/types/domain'

/* ============================================================================
   AdminProjectDetailPage — the operational record for a single installation.
   ----------------------------------------------------------------------------
   THE HUB WHERE THE MODULES MEET. Tabs, rather than separate pages, because a
   project engineer answering a question needs all of it at once:

     Milestones  → Project Operations   (also drives the customer's progress bar)
     Team        → who is responsible, who is on the crew, every visit
     Materials   → Inventory            (the BOM, and the stock it reserves)
     Finance     → Finance module       (staged invoices for this project)
     Documents   → Document vault       (the same files the customer can see)
     Photos      → what the crew photographed, and what the customer sees
     Equipment   → serial numbers scanned on site, and their warranties
     Activity    → who completed what, and when
   ========================================================================== */

type Tab =
  | 'milestones'
  | 'team'
  | 'materials'
  | 'finance'
  | 'documents'
  | 'photos'
  | 'equipment'
  | 'activity'

/** What the office uploads to a project. The customer's own uploads arrive as 'other'/'receipt'. */
const UPLOAD_KINDS: DocumentKind[] = [
  'contract',
  'permit',
  'survey_report',
  'inspection_report',
  'as_built',
  'turnover_certificate',
  'warranty_certificate',
  'invoice',
  'receipt',
  'other',
]

export function AdminProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('milestones')
  const company = useCompany()

  const projectQuery = useProject(projectId)
  const gateQuery = useProjectGate(projectId)
  const bomQuery = useProjectBom(projectId)
  const invoicesQuery = useAllInvoices()
  const documentsQuery = useProjectDocuments(projectId)
  const crewQuery = useProjectCrew(projectId)
  const assetsQuery = useProjectAssets(projectId)
  const permitsQuery = usePermits(projectId)
  const appointmentsQuery = useAllAppointments()
  const staffQuery = useStaff()

  const updateMilestone = useUpdateMilestone()
  const updateStatus = useUpdateProjectStatus()
  const setEngineer = useSetProjectEngineer()
  const addCrew = useAddCrewMember()
  const removeCrew = useRemoveCrewMember()
  const uploadFile = useUploadProjectFile()
  const setDocVisibility = useSetDocumentVisibility()

  const [changingStatus, setChangingStatus] = useState(false)
  const [certifying, setCertifying] = useState(false)
  const [uploadKind, setUploadKind] = useState<DocumentKind>('other')
  const [uploadVisible, setUploadVisible] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)

  const project = projectQuery.data
  const milestoneNames = useStaffNames(project?.milestones.map((m) => m.completedBy) ?? []).data

  // The team is the engineer's and the administrator's to change — the same
  // roles the database lets write `project_crew`.
  const managesTeam = user?.role === 'project_engineer' || user?.role === 'admin'

  if (projectQuery.isLoading || projectQuery.error) {
    return (
      <QueryState isLoading={projectQuery.isLoading} error={projectQuery.error as Error | null}>
        {null}
      </QueryState>
    )
  }

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

  const milestoneCount = project.milestones.length
  const done = project.milestones.filter((m) => m.status === 'done').length
  const projectInvoices = (invoicesQuery.data ?? []).filter((i) => i.projectId === project.id)
  const documents = documentsQuery.data ?? []
  const crew = crewQuery.data ?? []
  const assets = assetsQuery.data ?? []
  const permits = permitsQuery.data ?? []
  const visits = (appointmentsQuery.data ?? []).filter((a) => a.projectId === project.id)
  const staff = (staffQuery.data ?? []).filter((s) => s.isActive)
  const engineers = staff.filter((s) => s.role === 'project_engineer' || s.role === 'admin')
  const crewCandidates = staff.filter(
    (s) =>
      (s.role === 'technician' || s.role === 'project_engineer') &&
      !crew.some((c) => c.userId === s.id),
  )

  /* The real bill of materials, from the quotation the contract was built on.
     Empty until a contract exists, which is an honest state for a project that
     has only just been created. */
  const bom = bomQuery.data ?? []
  const bomTotal = bom.reduce((sum, line) => sum + line.lineTotal, 0)
  const shortLines = bom.filter((line) => line.quantity - line.quantityHeld > 0).length

  // The date the system was handed over — not the date it was meant to be.
  const lastCompletion = project.milestones
    .map((m) => m.completedAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop()
  const turnoverDate = project.actualTurnover ?? lastCompletion ?? new Date().toISOString()

  function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !projectId) return
    uploadFile.mutate({ file, projectId, kind: uploadKind, clientVisible: uploadVisible })
    event.target.value = ''
  }

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
                  : 'Available once the project is completed — a certificate that says the work is finished when it is not is worse than none'
              }
              onClick={() => setCertifying(true)}
            >
              Turnover certificate
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
              value={milestoneCount > 0 ? done / milestoneCount : 0}
              label={`Installation — ${done}/${milestoneCount} milestones`}
              tone={project.status === 'completed' ? 'success' : 'brand'}
            />
            <Progress
              value={project.contractValue > 0 ? project.amountPaid / project.contractValue : 0}
              label={`Collections — ${currency(project.amountPaid)} of ${currency(project.contractValue)}`}
              tone="success"
            />
          </div>
        </CardBody>
      </Card>

      <Tabs
        tabs={[
          { value: 'milestones' as Tab, label: 'Milestones' },
          { value: 'team' as Tab, label: 'Team & visits', count: visits.length },
          { value: 'materials' as Tab, label: 'Materials', count: bom.length },
          { value: 'finance' as Tab, label: 'Finance', count: projectInvoices.length },
          { value: 'documents' as Tab, label: 'Documents', count: documents.length },
          { value: 'photos' as Tab, label: 'Photos' },
          { value: 'equipment' as Tab, label: 'Equipment', count: assets.length },
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
                      <Link className="xs" to="/admin/permits">
                        Open permits →
                      </Link>
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
                            ? `${gateQuery.data.reservationsShort} of ${gateQuery.data.reservations} lines short — the inventory manager sees them under Purchasing, and they fill automatically when the stock is received.`
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
                action={<span className="xs dim">Updated from the field app</span>}
              />
              <CardBody>
                <Timeline milestones={project.milestones} />

                {/* The office counterpart to the field app's completion. A
                    project engineer needs to mark a stage BLOCKED when a permit
                    is refused or a delivery slips — the technician's app only
                    moves stages forward. The database enforces the ordering
                    and the synchronise gate either way, so this cannot be used
                    to skip ahead. */}
                {managesTeam && (
                  <div className="stack stack--sm" style={{ marginTop: 'var(--space-5)' }}>
                    <span className="xs dim strong">UPDATE A STAGE</span>
                    {project.milestones.map((milestone) => (
                      <div key={milestone.key} className="row row--between">
                        <span className="small">{milestone.label}</span>
                        <select
                          className="select"
                          style={{ width: 'auto', fontSize: 'var(--text-xs)' }}
                          value={milestone.status}
                          disabled={updateMilestone.isPending || !milestone.id}
                          onChange={(e) =>
                            updateMilestone.mutate({
                              milestoneId: milestone.id!,
                              status: e.target.value as 'pending',
                            })
                          }
                          aria-label={`Status of ${milestone.label}`}
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
                )}
              </CardBody>
            </Card>

            <div className="stack">
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
                    {project.actualTurnover && (
                      <div className="row row--between">
                        <span className="muted">Handed over</span>
                        <span className="strong">{date(project.actualTurnover)}</span>
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Permits"
                  action={
                    <Link className="xs" to="/admin/permits">
                      Manage →
                    </Link>
                  }
                />
                <CardBody>
                  {permits.length === 0 ? (
                    <p className="small muted">
                      None yet. The project engineer adds the applications this site needs on the
                      Permits page.
                    </p>
                  ) : (
                    <div className="stack stack--sm">
                      {permits.map((permit) => (
                        <div key={permit.id} className="row row--between">
                          <span className="small">{humanize(permit.permitType)}</span>
                          <Badge
                            tone={
                              permit.status === 'approved'
                                ? 'success'
                                : permit.status === 'rejected'
                                  ? 'danger'
                                  : 'warning'
                            }
                          >
                            {humanize(permit.status)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        </>
      )}

      {/* ------------------------------------------------- TEAM & VISITS */}
      {tab === 'team' && (
        <div className="grid grid--2" style={{ alignItems: 'start' }}>
          <Card>
            <CardHeader title="Project team" />
            <CardBody>
              <div className="stack">
                <div className="field">
                  <label className="field__label" htmlFor="proj-engineer">
                    Project engineer
                  </label>
                  {managesTeam ? (
                    <select
                      id="proj-engineer"
                      className="select"
                      value={project.assignedEngineerId ?? ''}
                      disabled={setEngineer.isPending}
                      onChange={(e) =>
                        setEngineer.mutate({
                          projectId: project.id,
                          engineerId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">Not assigned</option>
                      {engineers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.fullName} · {ROLE_LABEL[s.role]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="strong">{project.assignedEngineer}</div>
                  )}
                  <span className="field__hint">
                    The customer&rsquo;s main contact, named on their tracker. They are notified
                    when the project is assigned to them.
                  </span>
                </div>

                <div>
                  <div className="small strong" style={{ marginBottom: 'var(--space-2)' }}>
                    Crew
                  </div>
                  {crew.length === 0 ? (
                    <p className="small muted">
                      Nobody yet. Technicians join automatically when they are dispatched to one of
                      this project&rsquo;s visits, or add them here.
                    </p>
                  ) : (
                    <div className="stack stack--sm">
                      {crew.map((member) => (
                        <div key={member.userId} className="row row--between">
                          <span className="small">
                            <span className="strong">{member.fullName}</span>{' '}
                            <span className="dim">· {humanize(member.crewRole)}</span>
                          </span>
                          {managesTeam && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={removeCrew.isPending}
                              onClick={() =>
                                removeCrew.mutate({ projectId: project.id, userId: member.userId })
                              }
                            >
                              Remove
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {managesTeam && crewCandidates.length > 0 && (
                    <form
                      className="row"
                      style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}
                      onSubmit={(event) => {
                        event.preventDefault()
                        const form = new FormData(event.currentTarget)
                        const userId = String(form.get('member') ?? '')
                        if (!userId) return
                        addCrew.mutate({
                          projectId: project.id,
                          userId,
                          crewRole: String(form.get('crewRole') ?? 'technician'),
                        })
                        event.currentTarget.reset()
                      }}
                    >
                      <select name="member" className="select" defaultValue="" aria-label="Who">
                        <option value="" disabled>
                          Add someone…
                        </option>
                        {crewCandidates.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName} · {ROLE_LABEL[s.role]}
                          </option>
                        ))}
                      </select>
                      <select
                        name="crewRole"
                        className="select"
                        defaultValue="technician"
                        aria-label="As"
                      >
                        <option value="lead">Lead installer</option>
                        <option value="technician">Technician</option>
                        <option value="electrician">Electrician</option>
                        <option value="helper">Helper</option>
                      </select>
                      <Button type="submit" variant="outline" disabled={addCrew.isPending}>
                        Add
                      </Button>
                    </form>
                  )}
                </div>

                <FormError error={setEngineer.error ?? addCrew.error ?? removeCrew.error} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Visits"
              action={
                <Link className="xs" to="/admin/dispatch">
                  Dispatch board →
                </Link>
              }
            />
            <CardBody>
              {visits.length === 0 ? (
                <p className="small muted">
                  No visits booked against this project. Book the installation (and any survey or
                  inspection) from the dispatch board — choose this project as the subject.
                </p>
              ) : (
                <div className="stack stack--sm">
                  {visits.map((visit) => (
                    <div
                      key={visit.id}
                      style={{
                        padding: 'var(--space-3)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      <div className="row row--between">
                        <span className="small strong">{APPOINTMENT_TYPE_LABEL[visit.type]}</span>
                        <Badge tone={APPOINTMENT_STATUS_TONE[visit.status]}>
                          {APPOINTMENT_STATUS_LABEL[visit.status]}
                        </Badge>
                      </div>
                      <div className="xs dim">
                        {date(visit.date)} · {visit.timeSlot}
                        {visit.assignedTo.length > 0
                          ? ` · ${visit.assignedTo.join(', ')}`
                          : ' · no crew yet'}
                      </div>
                      {visit.status === 'completed' && visit.signoffName && (
                        <div className="xs dim">Signed off by {visit.signoffName}</div>
                      )}
                      {visit.cancelledReason && (
                        <div className="xs dim">Cancelled: {visit.cancelledReason}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------- MATERIALS */}
      {tab === 'materials' && (
        <Card>
          <CardHeader
            title="Bill of materials"
            action={
              bom.length > 0 ? (
                <Badge tone={shortLines > 0 ? 'warning' : 'success'}>
                  {shortLines > 0 ? `${shortLines} lines short` : 'All stock reserved'}
                </Badge>
              ) : undefined
            }
          />
          <CardBody>
            <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
              From the quotation the contract was signed on. Counter-signing reserved these
              quantities so they cannot go to another project; anything the warehouse could not
              cover is held as short and fills automatically when a purchase order is received.
            </p>

            {bom.length === 0 ? (
              <p className="small muted">
                No bill of materials. One comes from the quotation when the contract is executed.
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
                      // What matters is how much of THIS line the warehouse holds.
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
            {projectInvoices.length === 0 ? (
              <p className="small muted">
                No invoices yet. The down payment is raised when the contract is counter-signed; the
                delivery and commissioning stages when their milestones are completed.
              </p>
            ) : (
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
                          <Badge tone={INVOICE_STATUS_TONE[inv.status]}>
                            {humanize(inv.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------------- DOCUMENTS */}
      {tab === 'documents' && (
        <Card>
          <CardHeader title="Project documents" />
          <CardBody>
            <div
              className="row row--wrap"
              style={{
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
                paddingBottom: 'var(--space-4)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <select
                className="select"
                style={{ width: 'auto' }}
                value={uploadKind}
                onChange={(e) => setUploadKind(e.target.value as DocumentKind)}
                aria-label="What it is"
              >
                {UPLOAD_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {DOCUMENT_KIND_LABEL[kind]}
                  </option>
                ))}
              </select>
              <label className="row small" style={{ gap: 4 }}>
                <input
                  type="checkbox"
                  checked={uploadVisible}
                  onChange={(e) => setUploadVisible(e.target.checked)}
                />
                The customer can see it
              </label>
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
                {uploadFile.isPending ? 'Uploading…' : 'Upload a file'}
              </Button>
            </div>

            <FormError error={uploadFile.error ?? setDocVisibility.error} />

            {documents.length === 0 ? (
              <p className="small muted">No documents on this project yet.</p>
            ) : (
              <div className="stack stack--sm">
                {documents.map((doc) => (
                  <div key={doc.id} className="row row--between row--wrap">
                    <span className="row">
                      <span>📄</span>
                      <span>
                        <span className="strong small">{doc.name}</span>
                        <span className="xs dim" style={{ display: 'block' }}>
                          {DOCUMENT_KIND_LABEL[doc.kind as DocumentKind] ?? humanize(doc.kind)} ·{' '}
                          {date(doc.uploadedAt)}
                        </span>
                      </span>
                    </span>
                    <span className="row" style={{ gap: 'var(--space-2)' }}>
                      <label className="row xs" style={{ gap: 4 }}>
                        <input
                          type="checkbox"
                          checked={doc.clientVisible}
                          disabled={setDocVisibility.isPending}
                          onChange={(e) =>
                            setDocVisibility.mutate({ id: doc.id, visible: e.target.checked })
                          }
                        />
                        Customer sees it
                      </label>
                      <DownloadButton storagePath={doc.storagePath ?? undefined} />
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
              Files marked visible appear in the customer&rsquo;s document vault. Proof-of-payment
              uploads from the customer land here as receipts.
            </p>
          </CardBody>
        </Card>
      )}

      {/* --------------------------------------------------- PHOTOS */}
      {tab === 'photos' && (
        <Card>
          <CardHeader
            title="Site photos"
            action={<span className="xs dim">Taken in the field app, geotagged</span>}
          />
          <CardBody>
            <PhotoGrid projectId={project.id} manage />
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------------- EQUIPMENT */}
      {tab === 'equipment' && (
        <Card>
          <CardHeader
            title="Installed equipment"
            action={<span className="xs dim">Scanned on site by the crew</span>}
          />
          <CardBody>
            {assets.length === 0 ? (
              <p className="small muted">
                No serial numbers recorded yet. Technicians scan each panel, inverter and battery
                from the field app as they install it; each one starts its own warranty.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Serial number</th>
                      <th>Installed</th>
                      <th>Warranty until</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => (
                      <tr key={asset.id}>
                        <td className="small strong">{asset.productName}</td>
                        <td>
                          <code>{asset.serialNumber}</code>
                        </td>
                        <td className="small">
                          {asset.installedAt ? date(asset.installedAt) : '—'}
                        </td>
                        <td className="small">
                          {asset.warrantyExpiresAt ? date(asset.warrantyExpiresAt) : '—'}
                        </td>
                        <td>
                          <Badge
                            tone={
                              asset.status === 'installed'
                                ? 'success'
                                : asset.status === 'faulty'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {humanize(asset.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* -------------------------------------------------- ACTIVITY */}
      {tab === 'activity' && (
        <Card>
          <CardHeader title="Activity" />
          <CardBody>
            {project.milestones.every((m) => !m.completedAt) ? (
              <p className="small muted">Nothing completed yet.</p>
            ) : (
              <div className="stack">
                {project.milestones
                  .filter((m) => m.completedAt)
                  .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
                  .map((m) => (
                    <div key={m.key} className="row" style={{ alignItems: 'flex-start' }}>
                      <span>✅</span>
                      <div>
                        <div className="small strong">{m.label} completed</div>
                        <div className="xs dim">
                          {(m.completedBy && milestoneNames?.[m.completedBy]) ?? 'Team member'} ·{' '}
                          {m.completedAt && date(m.completedAt)}
                        </div>
                        {m.note && <div className="xs dim">{m.note}</div>}
                      </div>
                    </div>
                  ))}
              </div>
            )}
            <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
              The full trail, including financial changes and overrides, is on the{' '}
              <strong>Audit log</strong> page.
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
            const status = String(form.get('status')) as typeof project.status
            if (
              status === 'cancelled' &&
              !window.confirm(
                `Cancel ${project.reference}? Its reserved stock is released back to the warehouse and the customer is told.`,
              )
            ) {
              return
            }
            updateStatus.mutate(
              { id: project.id, status },
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
              The customer sees this on their tracker and is notified of a hold or a cancellation.
              Completing the final milestone completes the project on its own; milestones are not
              changed here.
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
          completedAt: turnoverDate,
          engineerName: project.assignedEngineer,
          warrantyPanelYears: company.warrantyPanelYears,
          warrantyInverterYears: company.warrantyInverterYears,
          warrantyWorkmanshipYears: company.warrantyWorkmanshipYears,
          warrantyBatteryYears:
            project.systemType === 'on_grid' ? undefined : company.warrantyBatteryYears,
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
