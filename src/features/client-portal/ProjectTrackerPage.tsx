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
import { PhotoGrid } from '@/components/ui/PhotoGrid'
import { QueryState } from '@/components/ui/QueryState'
import { useMyProject } from '@/lib/queries/client-portal'
import { useProjectCrew, useStaffNames } from '@/lib/queries/operations'

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
  /* The crew, by name. A customer cannot read staff profiles, so the names
     come from the staff-names function rather than a join. */
  const crew = useProjectCrew(project?.id).data ?? []
  const crewNames = useStaffNames(crew.map((member) => member.userId)).data ?? {}

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
              <a
                className="btn btn--outline btn--sm"
                style={{ marginTop: 'var(--space-3)' }}
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Google Maps
              </a>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Your team" />
            <CardBody>
              <div className="stack stack--sm">
                <div className="row">
                  <span className="avatar">{initials(project.assignedEngineer)}</span>
                  <div>
                    <div className="small strong">{project.assignedEngineer}</div>
                    <div className="xs dim">Project engineer · your main contact</div>
                  </div>
                </div>
                {crew.map((member) => {
                  const name = crewNames[member.userId] ?? 'Crew member'
                  return (
                    <div key={member.userId} className="row">
                      <span className="avatar">{initials(name)}</span>
                      <div>
                        <div className="small strong">{name}</div>
                        <div className="xs dim">
                          {member.crewRole === 'lead'
                            ? 'Lead installer'
                            : member.crewRole.charAt(0).toUpperCase() + member.crewRole.slice(1)}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {crew.length === 0 && (
                  <p className="xs dim">
                    Your installation crew is listed here once they are scheduled.
                  </p>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Contract value" />
            <CardBody>
              <Progress
                value={project.contractValue > 0 ? project.amountPaid / project.contractValue : 0}
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

      {/* Site photos uploaded by the crew from the field app. */}
      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardHeader
          title="Site photos"
          action={<span className="small dim">Taken by our field team</span>}
        />
        <CardBody>
          <PhotoGrid projectId={project.id} />
        </CardBody>
      </Card>
    </>
  )
}

/** "Engineer Name" → "EN", for the avatar circle. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (
    (parts[0][0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')
  ).toUpperCase()
}
