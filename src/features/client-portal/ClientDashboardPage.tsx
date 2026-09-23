import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { Progress } from '@/components/ui/Progress'
import { StatTile } from '@/components/ui/StatTile'
import { useAuth } from '@/app/auth/useAuth'
import { currency, date, relative } from '@/lib/format'
import {
  APPOINTMENT_TYPE_LABEL,
  MILESTONE_ORDER,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
} from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { ContractSigningCard } from './ContractSigningCard'
import {
  useMyAppointments,
  useMyDocuments,
  useMyInvoices,
  useMyNotifications,
  useMyProject,
  useMyTickets,
} from '@/lib/queries/client-portal'

/* ============================================================================
   ClientDashboardPage — the customer's home screen.
   ----------------------------------------------------------------------------
   PURPOSE (straight from the spec): "providing transparency to reduce inbound
   customer service calls." Every tile answers a question a customer would
   otherwise phone about:

     "Where is my installation up to?"   → milestone progress + next step
     "How much do I still owe?"          → outstanding balance
     "When are you coming?"              → next appointment
     "Where's my receipt?"               → recent documents

   It aggregates from four modules but writes to none — it is purely a
   read-and-route surface.

   NOTE ON SCOPING: none of these queries filters by client id. Row Level
   Security already restricts every table to the signed-in customer's own rows,
   so everything that comes back is theirs by construction. Filtering again in
   the browser would imply the filter is the security boundary, which it is not.
   ========================================================================== */

export function ClientDashboardPage() {
  const { user } = useAuth()

  const projectQuery = useMyProject()
  const invoicesQuery = useMyInvoices()
  const appointmentsQuery = useMyAppointments()
  const ticketsQuery = useMyTickets()
  const notificationsQuery = useMyNotifications()
  const documentsQuery = useMyDocuments()

  const project = projectQuery.data

  // The dashboard is worthless without the project, so it gates on that one
  // query. The smaller panels below degrade to empty lists on their own.
  if (projectQuery.isLoading || projectQuery.error || !project) {
    return (
      <>
        <PageHeader
          title={`Welcome back, ${user?.fullName.split(' ')[0] ?? ''}`}
          description="Here is where your solar installation stands today."
        />
        {/* Before the project exists, this is the only thing the customer can
            act on — and it is what brings the project into being. It has to be
            above the gate, or somebody with a contract waiting sees "no
            installation yet" and no way to change that. */}
        <ContractSigningCard />

        <QueryState
          isLoading={projectQuery.isLoading}
          error={projectQuery.error as Error | null}
          isEmpty={!project}
          emptyIcon="🔆"
          emptyTitle="No installation yet"
          emptyMessage="Once your contract is signed and we have counter-signed it, your project tracker appears here."
        >
          {null}
        </QueryState>
      </>
    )
  }

  const invoices = invoicesQuery.data ?? []
  const documents = documentsQuery.data ?? []
  const notifications = notificationsQuery.data ?? []

  const doneCount = project.milestones.filter((m) => m.status === 'done').length
  const currentMilestone = project.milestones.find((m) => m.status === 'in_progress')
  const balance = project.contractValue - project.amountPaid

  // Everything returned is already scoped to this customer by RLS, so "next"
  // simply means the soonest upcoming visit.
  const nextAppointment = (appointmentsQuery.data ?? [])
    .filter((a) => a.status !== 'cancelled' && a.status !== 'completed')
    .sort((a, b) => a.date.localeCompare(b.date))[0]

  const openTickets = (ticketsQuery.data ?? []).filter(
    (t) => t.status !== 'resolved' && t.status !== 'closed',
  )
  const unread = notifications.filter((n) => !n.read)

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.fullName.split(' ')[0]}`}
        description="Here is where your solar installation stands today."
        actions={
          <ButtonLink to="/portal/tickets" variant="outline">
            Raise a support ticket
          </ButtonLink>
        }
      />

      <ContractSigningCard />

      {/* ------------------------------------------------ KPI ROW */}
      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile
          label="Installation progress"
          value={`${doneCount} of ${MILESTONE_ORDER.length}`}
          delta="Milestones complete"
        />
        <StatTile label="System size" value={`${project.systemKw} kW`} delta={project.reference} />
        <StatTile
          label="Outstanding balance"
          value={currency(balance)}
          delta={balance > 0 ? 'Next invoice due 8 Sep' : 'Fully paid'}
          direction={balance > 0 ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile
          label="Open tickets"
          value={String(openTickets.length)}
          delta={openTickets.length ? 'Being worked on' : 'Nothing outstanding'}
        />
      </div>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        {/* ------------------------------------- PROJECT STATUS CARD */}
        <Card>
          <CardHeader
            title="Your project"
            action={
              <Badge tone={PROJECT_STATUS_TONE[project.status]}>
                {PROJECT_STATUS_LABEL[project.status]}
              </Badge>
            }
          />
          <CardBody>
            <div className="stack">
              <div>
                <div className="small dim">{project.reference}</div>
                <div className="strong">{project.address}</div>
              </div>

              <Progress
                value={doneCount / MILESTONE_ORDER.length}
                label="Overall completion"
                tone={project.status === 'completed' ? 'success' : 'brand'}
              />

              {currentMilestone && (
                <div
                  style={{
                    padding: 'var(--space-3)',
                    background: 'var(--warning-bg)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div className="xs strong" style={{ color: 'var(--warning-fg)' }}>
                    CURRENTLY IN PROGRESS
                  </div>
                  <div className="strong">{currentMilestone.label}</div>
                  {currentMilestone.note && (
                    <p className="small" style={{ marginTop: 4, color: 'var(--warning-fg)' }}>
                      {currentMilestone.note}
                    </p>
                  )}
                </div>
              )}

              <div className="row row--between small">
                <span className="muted">Target turnover</span>
                <span className="strong">{date(project.targetTurnover)}</span>
              </div>
              <div className="row row--between small">
                <span className="muted">Assigned engineer</span>
                <span className="strong">{project.assignedEngineer}</span>
              </div>
            </div>
          </CardBody>
          <div className="card__footer">
            <ButtonLink to="/portal/project" variant="outline" block>
              View full milestone timeline →
            </ButtonLink>
          </div>
        </Card>

        <div className="stack">
          {/* ------------------------------------ NEXT APPOINTMENT */}
          <Card>
            <CardHeader title="Next appointment" />
            <CardBody>
              {nextAppointment ? (
                <div className="stack stack--sm">
                  <div className="row row--between">
                    <span className="strong">{APPOINTMENT_TYPE_LABEL[nextAppointment.type]}</span>
                    <Badge tone="brand">{nextAppointment.status}</Badge>
                  </div>
                  <div className="small muted">
                    {date(nextAppointment.date)} · {nextAppointment.timeSlot}
                  </div>
                  {nextAppointment.assignedTo.length > 0 && (
                    <div className="small muted">Team: {nextAppointment.assignedTo.join(', ')}</div>
                  )}
                  {nextAppointment.notes && <p className="small dim">{nextAppointment.notes}</p>}
                </div>
              ) : (
                <p className="small muted">No upcoming visits scheduled.</p>
              )}
            </CardBody>
            <div className="card__footer">
              <ButtonLink to="/portal/appointments" variant="ghost" block>
                Manage appointments
              </ButtonLink>
            </div>
          </Card>

          {/* ---------------------------------------- BILLING SNAPSHOT */}
          <Card>
            <CardHeader title="Billing" />
            <CardBody>
              <Progress
                value={project.amountPaid / project.contractValue}
                label={`${currency(project.amountPaid)} of ${currency(project.contractValue)} paid`}
                tone="success"
              />
              <div className="stack stack--sm" style={{ marginTop: 'var(--space-4)' }}>
                {invoices.map((inv) => (
                  <div key={inv.id} className="row row--between small">
                    <span className="muted">{inv.number}</span>
                    <span className="row">
                      <span className="num strong">{currency(inv.amount)}</span>
                      <Badge tone={inv.status === 'paid' ? 'success' : 'info'}>{inv.status}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            </CardBody>
            <div className="card__footer">
              <ButtonLink to="/portal/billing" variant="ghost" block>
                All invoices &amp; receipts
              </ButtonLink>
            </div>
          </Card>
        </div>
      </div>

      {/* --------------------------- RECENT ACTIVITY + DOCUMENTS */}
      <div className="grid grid--2" style={{ marginTop: 'var(--space-6)', alignItems: 'start' }}>
        <Card>
          <CardHeader
            title="Recent updates"
            action={
              unread.length > 0 ? <Badge tone="danger">{unread.length} new</Badge> : undefined
            }
          />
          <CardBody>
            <div className="stack">
              {notifications.slice(0, 4).map((note) => (
                <div key={note.id} className="row" style={{ alignItems: 'flex-start' }}>
                  <span style={{ opacity: note.read ? 0.3 : 1 }}>●</span>
                  <div>
                    <div className="small strong">{note.title}</div>
                    <div className="small muted">{note.body}</div>
                    <div className="xs dim">{relative(note.at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Recent documents" />
          <CardBody>
            <div className="stack stack--sm">
              {documents.map((doc) => (
                <Link key={doc.id} to="/portal/documents" className="row row--between">
                  <span className="row">
                    <span>📄</span>
                    <span className="small">{doc.name}</span>
                  </span>
                  <span className="xs dim">{date(doc.uploadedAt)}</span>
                </Link>
              ))}
            </div>
          </CardBody>
          <div className="card__footer">
            <ButtonLink to="/portal/documents" variant="ghost" block>
              Open document vault
            </ButtonLink>
          </div>
        </Card>
      </div>
    </>
  )
}
