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
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_TONE,
  APPOINTMENT_TYPE_LABEL,
  MILESTONE_ORDER,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
} from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { ContractSigningCard } from './ContractSigningCard'
import { LeaveReviewCard } from './LeaveReviewCard'
import { MyQuotationsCard } from './MyQuotationsCard'
import {
  useMyAppointments,
  useMyDocuments,
  useMyInvoices,
  useMyNotifications,
  useMyProject,
  useMyTickets,
} from '@/lib/queries/client-portal'
import { useMyContracts, useMyQuotations } from '@/lib/queries/sales'
import type { Appointment, AppNotification } from '@/types/domain'

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

   BEFORE THERE IS A PROJECT
   Most of a customer's time with us is before installation: a survey, a
   quotation, a contract. The dashboard used to show "No installation yet" and
   nothing else for all of it — which is why one account looked full and
   another, further back in the process, looked empty. It now shows where they
   are in the journey and whatever is waiting on them.

   NOTE ON SCOPING: none of these queries filters by client id. Row Level
   Security already restricts every table to the signed-in customer's own rows,
   so everything that comes back is theirs by construction.
   ========================================================================== */

type StepState = 'done' | 'current' | 'todo'

interface JourneyStep {
  label: string
  detail: string
  state: StepState
}

export function ClientDashboardPage() {
  const { user } = useAuth()

  const projectQuery = useMyProject()
  const invoicesQuery = useMyInvoices()
  const appointmentsQuery = useMyAppointments()
  const ticketsQuery = useMyTickets()
  const notificationsQuery = useMyNotifications()
  const documentsQuery = useMyDocuments()
  const quotations = useMyQuotations().data ?? []
  const contracts = useMyContracts(user?.id).data ?? []

  const project = projectQuery.data
  const appointments = appointmentsQuery.data ?? []
  const notifications = notificationsQuery.data ?? []
  const unread = notifications.filter((n) => !n.read)
  const firstName = user?.fullName.split(' ')[0] ?? ''

  const upcoming = appointments
    .filter((a) => a.status !== 'cancelled' && a.status !== 'completed')
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeSlot.localeCompare(b.timeSlot))

  if (projectQuery.isLoading || projectQuery.error) {
    return (
      <>
        <PageHeader hero title={`Welcome back, ${firstName}`} />
        <QueryState isLoading={projectQuery.isLoading} error={projectQuery.error as Error | null}>
          {null}
        </QueryState>
      </>
    )
  }

  /* ======================================================================
     NO PROJECT YET — the journey so far, and what is waiting on them.
     ====================================================================== */
  if (!project) {
    const survey = appointments.find((a) => a.type === 'site_survey' && a.status !== 'cancelled')
    const surveyDone = appointments.some(
      (a) => a.type === 'site_survey' && a.status === 'completed',
    )
    const openQuote = quotations.find((q) => q.status === 'sent')
    const accepted = quotations.some((q) => q.status === 'accepted')
    const liveContract = contracts.find(
      (c) => c.status === 'awaiting_client' || c.status === 'awaiting_company',
    )
    const anything = appointments.length > 0 || quotations.length > 0 || contracts.length > 0

    const steps: JourneyStep[] = [
      {
        label: 'Enquiry',
        detail: anything ? 'Received — thank you' : 'Tell us about your home or business',
        state: anything ? 'done' : 'current',
      },
      {
        label: 'Site survey',
        detail: surveyDone
          ? 'Done'
          : survey
            ? `${APPOINTMENT_STATUS_LABEL[survey.status]} · ${date(survey.date)} ${survey.timeSlot}`
            : 'We measure the roof and check the wiring',
        state: surveyDone || quotations.length > 0 ? 'done' : survey ? 'current' : 'todo',
      },
      {
        label: 'Quotation',
        detail: accepted
          ? 'Accepted'
          : openQuote
            ? 'Waiting for your answer'
            : 'Prepared after the survey',
        state: accepted || liveContract ? 'done' : openQuote ? 'current' : 'todo',
      },
      {
        label: 'Contract',
        detail: liveContract
          ? liveContract.status === 'awaiting_client'
            ? 'Ready for you to sign'
            : 'Signed — we are counter-signing'
          : accepted
            ? 'Being prepared'
            : 'Signed here, online',
        state: liveContract ? 'current' : accepted ? 'current' : 'todo',
      },
      {
        label: 'Installation',
        detail: 'Your project tracker appears here',
        state: 'todo',
      },
    ]

    return (
      <>
        <PageHeader
          hero
          title={`Welcome, ${firstName}`}
          description="Where your solar journey stands, and anything waiting on you."
          actions={
            <ButtonLink to="/portal/appointments" variant="outline">
              Request a visit
            </ButtonLink>
          }
        />

        <JourneyCard steps={steps} />

        {/* The two things that move the journey forward. */}
        <ContractSigningCard />
        <MyQuotationsCard />

        <div className="grid grid--2" style={{ alignItems: 'start' }}>
          <VisitsCard upcoming={upcoming} />
          <UpdatesCard notifications={notifications} unread={unread.length} />
        </div>

        {!anything && (
          <Card style={{ marginTop: 'var(--space-6)' }}>
            <CardHeader title="Getting started" />
            <CardBody>
              <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
                Nothing is on file for this account yet. If you enquired before creating it, use the
                same email address — your enquiry, visits and quotations are attached to it
                automatically. Otherwise, start here:
              </p>
              <div className="row row--wrap" style={{ gap: 'var(--space-3)' }}>
                <ButtonLink to="/estimator" variant="primary">
                  Estimate my system
                </ButtonLink>
                <ButtonLink to="/booking" variant="outline">
                  Book a free survey
                </ButtonLink>
                <ButtonLink to="/contact" variant="ghost">
                  Ask a question
                </ButtonLink>
              </div>
            </CardBody>
          </Card>
        )}
      </>
    )
  }

  /* ======================================================================
     THE PROJECT IS RUNNING.
     ====================================================================== */
  const invoices = invoicesQuery.data ?? []
  const documents = documentsQuery.data ?? []

  const doneCount = project.milestones.filter((m) => m.status === 'done').length
  const currentMilestone = project.milestones.find((m) => m.status === 'in_progress')
  const balance = project.contractValue - project.amountPaid

  /* The soonest unpaid due date — it said "Next invoice due 8 Sep" for every
     customer, whatever they owed and whenever. */
  const nextDue = invoices
    .filter((i) => i.amount > i.amountPaid && i.dueAt)
    .map((i) => i.dueAt)
    .sort()[0]

  const openTickets = (ticketsQuery.data ?? []).filter(
    (t) => t.status !== 'resolved' && t.status !== 'closed',
  )

  return (
    <>
      <PageHeader
        hero
        title={`Welcome back, ${firstName}`}
        description="Here is where your solar installation stands today."
        actions={
          <ButtonLink to="/portal/tickets" variant="outline">
            Raise a support ticket
          </ButtonLink>
        }
      />

      <ContractSigningCard />

      {project.status === 'completed' && <LeaveReviewCard project={project} />}

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
          delta={
            balance <= 0
              ? 'Fully paid'
              : nextDue
                ? `Next payment due ${date(nextDue)}`
                : 'Invoiced as each stage is reached'
          }
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
                {/* Once handed over, the date it happened — not the one planned. */}
                <span className="muted">
                  {project.actualTurnover ? 'Handed over' : 'Target turnover'}
                </span>
                <span className="strong">
                  {date(project.actualTurnover ?? project.targetTurnover)}
                </span>
              </div>
              <div className="row row--between small">
                <span className="muted">Your engineer</span>
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
          <VisitsCard upcoming={upcoming} />

          {/* ---------------------------------------- BILLING SNAPSHOT */}
          <Card>
            <CardHeader title="Billing" />
            <CardBody>
              <Progress
                value={project.contractValue > 0 ? project.amountPaid / project.contractValue : 0}
                label={`${currency(project.amountPaid)} of ${currency(project.contractValue)} paid`}
                tone="success"
              />
              <div className="stack stack--sm" style={{ marginTop: 'var(--space-4)' }}>
                {invoices.length === 0 && (
                  <p className="small muted">
                    Your down-payment invoice appears here once the contract is counter-signed.
                  </p>
                )}
                {invoices.map((inv) => (
                  <div key={inv.id} className="row row--between small">
                    <span className="muted">{inv.number}</span>
                    <span className="row">
                      <span className="num strong">{currency(inv.amount)}</span>
                      <Badge
                        tone={
                          inv.status === 'paid'
                            ? 'success'
                            : inv.status === 'overdue'
                              ? 'danger'
                              : 'info'
                        }
                      >
                        {inv.status.replace('_', ' ')}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            </CardBody>
            <div className="card__footer">
              <ButtonLink to="/portal/billing" variant="ghost" block>
                Invoices, payment details &amp; receipts
              </ButtonLink>
            </div>
          </Card>
        </div>
      </div>

      {/* --------------------------- RECENT ACTIVITY + DOCUMENTS */}
      <div className="grid grid--2" style={{ marginTop: 'var(--space-6)', alignItems: 'start' }}>
        <UpdatesCard notifications={notifications} unread={unread.length} />

        <Card>
          <CardHeader title="Recent documents" />
          <CardBody>
            {documents.length === 0 ? (
              <p className="small muted">
                Your contract, permits and certificates appear here as they are issued.
              </p>
            ) : (
              <div className="stack stack--sm">
                {documents.slice(0, 5).map((doc) => (
                  <Link key={doc.id} to="/portal/documents" className="row row--between">
                    <span className="row">
                      <span>📄</span>
                      <span className="small">{doc.name}</span>
                    </span>
                    <span className="xs dim">{date(doc.uploadedAt)}</span>
                  </Link>
                ))}
              </div>
            )}
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

/* ----------------------------------------------------------------------------
   Pieces shared by both versions of the dashboard
   ---------------------------------------------------------------------------- */

function JourneyCard({ steps }: { steps: JourneyStep[] }) {
  return (
    <Card style={{ marginBottom: 'var(--space-6)' }}>
      <CardBody>
        <ol className="journey">
          {steps.map((step, index) => (
            <li key={step.label} className={`journey__step journey__step--${step.state}`}>
              <span className="journey__dot" aria-hidden="true">
                {step.state === 'done' ? '✓' : index + 1}
              </span>
              <span>
                <span className="journey__label">{step.label}</span>
                <span className="journey__detail">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  )
}

function VisitsCard({ upcoming }: { upcoming: Appointment[] }) {
  const next = upcoming[0]
  return (
    <Card>
      <CardHeader title="Next visit" />
      <CardBody>
        {next ? (
          <div className="stack stack--sm">
            <div className="row row--between">
              <span className="strong">{APPOINTMENT_TYPE_LABEL[next.type]}</span>
              <Badge tone={APPOINTMENT_STATUS_TONE[next.status]}>
                {APPOINTMENT_STATUS_LABEL[next.status]}
              </Badge>
            </div>
            <div className="small muted">
              {date(next.date)} · {next.timeSlot}
            </div>
            {next.assignedTo.length > 0 && (
              <div className="small muted">Team: {next.assignedTo.join(', ')}</div>
            )}
            {next.status === 'requested' && (
              <p className="xs dim">We will confirm the time and the team shortly.</p>
            )}
            {upcoming.length > 1 && (
              <p className="xs dim">
                and {upcoming.length - 1} more visit{upcoming.length === 2 ? '' : 's'} booked
              </p>
            )}
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
  )
}

function UpdatesCard({
  notifications,
  unread,
}: {
  notifications: AppNotification[]
  unread: number
}) {
  return (
    <Card>
      <CardHeader
        title="Recent updates"
        action={unread > 0 ? <Badge tone="danger">{unread} new</Badge> : undefined}
      />
      <CardBody>
        {notifications.length === 0 ? (
          <p className="small muted">Updates from our team appear here.</p>
        ) : (
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
        )}
      </CardBody>
      <div className="card__footer">
        <ButtonLink to="/portal/notifications" variant="ghost" block>
          All notifications
        </ButtonLink>
      </div>
    </Card>
  )
}
