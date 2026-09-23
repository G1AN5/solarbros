import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { Progress } from '@/components/ui/Progress'
import { Timeline } from '@/components/ui/Timeline'
import { currency, date } from '@/lib/format'
import {
  MILESTONE_ORDER,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  SYSTEM_TYPE_LABEL,
} from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { useMyProject } from '@/lib/queries/client-portal'

/* ============================================================================
   ProjectTrackerPage — the customer's live installation timeline.
   ----------------------------------------------------------------------------
   THIS IS THE PORTAL'S FLAGSHIP SCREEN. It exists so customers stop phoning to
   ask "what's happening?".

   The data flows STRAIGHT from the field: when a technician taps a milestone
   complete in /field, that write updates the same `project_milestones` rows
   this page reads. The <Timeline> component is literally shared between the
   two, so the customer's view and the technician's view can never disagree.

   Read-only by design — customers observe, they don't edit.
   ========================================================================== */

export function ProjectTrackerPage() {
  const projectQuery = useMyProject()
  const project = projectQuery.data

  // The tracker IS the project, so there is nothing to show without it.
  if (projectQuery.isLoading || projectQuery.error || !project) {
    return (
      <QueryState
        isLoading={projectQuery.isLoading}
        error={projectQuery.error as Error | null}
        isEmpty={!project}
        emptyIcon="🔆"
        emptyTitle="No installation yet"
        emptyMessage="Your project tracker appears here once your contract is signed."
      >
        {null}
      </QueryState>
    )
  }
  const doneCount = project.milestones.filter((m) => m.status === 'done').length

  return (
    <>
      <PageHeader
        title="Project tracker"
        description="Updated live as our engineers complete each stage on site."
        breadcrumbs={[{ label: 'Portal', to: '/portal' }, { label: 'Project tracker' }]}
        actions={
          <Badge tone={PROJECT_STATUS_TONE[project.status]}>
            {PROJECT_STATUS_LABEL[project.status]}
          </Badge>
        }
      />

      {/* Summary bar — the facts a customer double-checks most often. */}
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
              <div className="small dim">Started</div>
              <div className="strong">{date(project.startDate)}</div>
            </div>
            <div>
              <div className="small dim">Target turnover</div>
              <div className="strong">{date(project.targetTurnover)}</div>
            </div>
          </div>

          <div style={{ marginTop: 'var(--space-5)' }}>
            <Progress
              value={doneCount / MILESTONE_ORDER.length}
              label={`${doneCount} of ${MILESTONE_ORDER.length} milestones complete`}
              tone={project.status === 'completed' ? 'success' : 'brand'}
            />
          </div>
        </CardBody>
      </Card>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        {/* --------------------------------------------- THE TIMELINE */}
        <Card>
          <CardHeader title="Installation milestones" />
          <CardBody>
            <Timeline milestones={project.milestones} />
          </CardBody>
        </Card>

        <div className="stack">
          <Card>
            <CardHeader title="Installation address" />
            <CardBody>
              <p>{project.address}</p>
              <div
                style={{
                  marginTop: 'var(--space-4)',
                  height: 160,
                  background:
                    'repeating-linear-gradient(45deg, var(--ink-100), var(--ink-100) 12px, var(--ink-200) 12px, var(--ink-200) 24px)',
                  borderRadius: 'var(--radius)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                🗺️ Site location map
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Your team" />
            <CardBody>
              <div className="stack stack--sm">
                <div className="row">
                  <span className="avatar">PC</span>
                  <div>
                    <div className="small strong">{project.assignedEngineer}</div>
                    <div className="xs dim">Project Engineer · your main contact</div>
                  </div>
                </div>
                <div className="row">
                  <span className="avatar">RD</span>
                  <div>
                    <div className="small strong">Ramon Dizon</div>
                    <div className="xs dim">Lead Installation Technician</div>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Contract value" />
            <CardBody>
              <Progress
                value={project.amountPaid / project.contractValue}
                label={`${currency(project.amountPaid)} of ${currency(project.contractValue)}`}
                tone="success"
              />
              <p className="small muted" style={{ marginTop: 'var(--space-3)' }}>
                Remaining balance:{' '}
                <strong>{currency(project.contractValue - project.amountPaid)}</strong>
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Site photos uploaded by technicians via the field portal. */}
      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardHeader
          title="Site photos"
          action={<span className="small dim">Uploaded by our field team</span>}
        />
        <CardBody>
          <div className="grid" style={{ '--col-min': '160px' } as React.CSSProperties}>
            {['Roof survey', 'Racking installed', 'Panels mounted', 'DC combiner box'].map(
              (label) => (
                <div key={label}>
                  <div
                    className="portfolio-item__media"
                    style={{ height: 120, borderRadius: 'var(--radius)' }}
                  >
                    Photo
                  </div>
                  <div className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                    {label}
                  </div>
                </div>
              ),
            )}
          </div>
        </CardBody>
      </Card>
    </>
  )
}
