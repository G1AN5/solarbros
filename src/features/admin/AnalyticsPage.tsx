import { Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { Progress } from '@/components/ui/Progress'
import { StatTile } from '@/components/ui/StatTile'
import { BarChart } from '@/components/charts/BarChart'
import { FunnelChart } from '@/components/charts/FunnelChart'
import { currency, currencyCompact, number } from '@/lib/format'
import { LEAD_STAGE_LABEL, PIPELINE_ORDER } from '@/lib/labels'
import { useLeads } from '@/lib/queries/crm'
import { useAllAppointments, useAllTickets, useCrew, useProjects } from '@/lib/queries/operations'
import { settingNum, usePricingConfig, useSettings } from '@/lib/queries/settings'
import { systemPrice } from '@/lib/solar-estimator'
import { useAllInvoices, useStock } from '@/lib/queries/inventory-finance'

/* ============================================================================
   AnalyticsPage — the Executive Analytics Dashboard.
   ----------------------------------------------------------------------------
   "Aggregating data into high-level business intelligence reports" — this page
   reads from every other module and writes to none.

   CHART DESIGN NOTES
     • Charts use a validated blue palette (src/styles/viz.css), NOT the brand
       amber. Amber is reserved for interactive chrome; mixing them makes it
       impossible to tell a data mark from a button.
     • Revenue is a single-series bar chart — one series needs no legend, the
       card title names the measure.
     • The pipeline uses an ORDINAL ramp (one hue getting darker) because the
       stages are ordered. Categorical colours would imply they are unrelated.
     • No dual-axis charts anywhere. Two measures of different scale get two
       charts.

   BACKEND PLAN: these aggregates should be Postgres views or materialised
   views, refreshed on a schedule — never computed by pulling every row into
   the browser as the mock does here.
   ========================================================================== */

/* ----------------------------------------------------------------------------
   These two series used to be arrays of invented numbers, sitting under a
   heading that said "Executive dashboard". A made-up figure presented as a
   measurement is worse than a blank card: somebody makes a decision on it.

   They are computed from data this page already loads, so the honesty costs
   nothing. The comment about moving the aggregation into a Postgres view still
   stands - doing it in the browser means pulling every row down first, which
   stops scaling long before the business does.
   -------------------------------------------------------------------------- */

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * Money actually collected, by month.
 *
 * Collected and not invoiced: an invoice is a claim, and a revenue chart built
 * on claims flatters the business right up until the day the cash is needed.
 */
function revenueByMonth(invoices: { issuedAt: string; amountPaid: number }[]) {
  const now = new Date()
  const buckets: { label: string; value: number }[] = []

  for (let back = 7; back >= 0; back--) {
    const month = new Date(now.getFullYear(), now.getMonth() - back, 1)
    const total = invoices
      .filter((invoice) => {
        if (!invoice.issuedAt) return false
        const issued = new Date(invoice.issuedAt)
        return (
          issued.getFullYear() === month.getFullYear() && issued.getMonth() === month.getMonth()
        )
      })
      .reduce((sum, invoice) => sum + invoice.amountPaid, 0)

    buckets.push({ label: MONTH_LABELS[month.getMonth()], value: total })
  }

  return buckets
}

/**
 * How loaded each crew member is over the coming fortnight.
 *
 * Measured against `operations.max_jobs_per_crew_per_day`, which is the same
 * figure the dispatch board warns on — so the red bar here and the warning
 * there mean the same thing rather than two different opinions.
 */
function utilisation(
  crew: { id: string; fullName: string }[],
  appointments: { assignedTo: string[]; date: string; status: string }[],
  maxPerDay: number,
) {
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  const capacity = Math.max(1, maxPerDay * 10) // ten working days in a fortnight

  return crew
    .map((member) => {
      const jobs = appointments.filter(
        (appointment) =>
          appointment.status !== 'cancelled' &&
          appointment.date >= today &&
          appointment.date <= horizon &&
          appointment.assignedTo.includes(member.fullName),
      ).length

      return { name: member.fullName, jobs, utilisation: Math.min(1, jobs / capacity) }
    })
    .sort((a, b) => b.utilisation - a.utilisation)
}

export function AnalyticsPage() {
  const leadsQuery = useLeads()
  const projectsQuery = useProjects()
  const invoicesQuery = useAllInvoices()
  const stockQuery = useStock()
  const ticketsQuery = useAllTickets()
  const crewQuery = useCrew()
  const appointmentsQuery = useAllAppointments()
  const settings = useSettings().data

  const LEADS = leadsQuery.data ?? []
  const PROJECTS = projectsQuery.data ?? []
  const INVOICES = invoicesQuery.data ?? []
  const STOCK = stockQuery.data ?? []
  const TICKETS = ticketsQuery.data ?? []

  const revenueSeries = revenueByMonth(INVOICES)
  const crewLoad = utilisation(
    crewQuery.data ?? [],
    appointmentsQuery.data ?? [],
    settingNum(settings, 'operations.max_jobs_per_crew_per_day', 3),
  )

  // Pipeline counts, in the canonical stage order.
  const funnelStages = PIPELINE_ORDER.map((stage) => ({
    label: LEAD_STAGE_LABEL[stage],
    count: LEADS.filter((lead) => lead.stage === stage).length,
  }))

  const activeProjects = PROJECTS.filter((p) => p.status === 'in_progress').length
  /* Valued through the same function the estimator and the CRM board use, so
     the three agree. It was `estimatedKw * 60_000` — a rate that appeared
     nowhere else in the system, so the pipeline on this page disagreed with
     every quotation the business actually issued.

     The rate alone is not enough: a price is a base plus a rate per kWp, and
     multiplying by the rate on its own understates a small system by more than
     a hundred thousand pesos. */
  const pricing = usePricingConfig()
  const pipelineValue = LEADS.filter((l) => l.stage !== 'installed' && l.stage !== 'lost').reduce(
    (sum, l) => sum + systemPrice(l.estimatedKw, 'hybrid', pricing),
    0,
  )

  /* Money actually COLLECTED this calendar month. The tile used to read
     `currencyCompact(4_620_000)` — a fixed number, on a dashboard headed
     "Executive", that stayed at PHP 4.62M through a completely empty database.
     That is the most consequential kind of placeholder: nobody doubts a figure
     that has always been there. */
  const thisMonth = new Date()
  const revenueThisMonth = INVOICES.filter((invoice) => {
    if (!invoice.issuedAt) return false
    const issued = new Date(invoice.issuedAt)
    return (
      issued.getFullYear() === thisMonth.getFullYear() && issued.getMonth() === thisMonth.getMonth()
    )
  }).reduce((sum, invoice) => sum + invoice.amountPaid, 0)

  // Last month, for a comparison that is measured rather than asserted.
  const lastMonthDate = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 1)
  const revenueLastMonth = INVOICES.filter((invoice) => {
    if (!invoice.issuedAt) return false
    const issued = new Date(invoice.issuedAt)
    return (
      issued.getFullYear() === lastMonthDate.getFullYear() &&
      issued.getMonth() === lastMonthDate.getMonth()
    )
  }).reduce((sum, invoice) => sum + invoice.amountPaid, 0)

  const revenueDelta =
    revenueLastMonth > 0
      ? `${Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)}% vs last month`
      : 'No comparison yet'
  const overdue = INVOICES.filter((i) => i.status === 'overdue')
  const overdueTotal = overdue.reduce((sum, i) => sum + (i.amount - i.amountPaid), 0)
  const lowStock = STOCK.filter((s) => s.onHand - s.reserved < s.reorderPoint)
  const urgentTickets = TICKETS.filter((t) => t.priority === 'urgent' && t.status !== 'resolved')

  return (
    <>
      <PageHeader
        title="Executive dashboard"
        description="Business-wide performance across sales, operations, supply chain and finance."
        actions={
          /* Removed rather than left inert. Every figure on this page is a
             live total - open pipeline, outstanding receivables, stock below
             its reorder point - and none of them are period-scoped, so a range
             selector would change nothing however it was wired. The revenue
             chart carries its own eight-month window, which is stated on the
             card. Adding the control back belongs with a real date-scoped
             query, not before it. */
          <span className="xs dim">Live figures · revenue chart covers the last 8 months</span>
        }
      />

      {/* ---------------------------------------------------- KPI ROW */}
      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile
          label="Revenue this month"
          value={currencyCompact(revenueThisMonth)}
          delta={revenueDelta}
          direction="up"
        />
        <StatTile
          label="Open pipeline value"
          value={currencyCompact(pipelineValue)}
          delta={`${LEADS.filter((l) => l.stage !== 'installed').length} active leads`}
          direction="up"
        />
        <StatTile
          label="Active installations"
          value={String(activeProjects)}
          delta={`${PROJECTS.length} projects total`}
        />
        <StatTile
          label="Overdue receivables"
          value={currencyCompact(overdueTotal)}
          delta={`${overdue.length} invoice${overdue.length === 1 ? '' : 's'}`}
          direction="up"
          invertDelta
        />
      </div>

      {/* --------------------------------------- ATTENTION-REQUIRED STRIP
          Surfacing exceptions at the top saves managers hunting through four
          modules to find what is on fire. */}
      {(lowStock.length > 0 || urgentTickets.length > 0 || overdue.length > 0) && (
        <Card style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--warning-solid)' }}>
          <CardBody>
            <div className="row row--wrap" style={{ gap: 'var(--space-6)' }}>
              <span className="strong">⚠ Needs attention</span>
              {lowStock.length > 0 && (
                <ButtonLink to="/admin/inventory" variant="ghost" size="sm">
                  <Badge tone="danger">{lowStock.length}</Badge> items below reorder point
                </ButtonLink>
              )}
              {urgentTickets.length > 0 && (
                <ButtonLink to="/admin/tickets" variant="ghost" size="sm">
                  <Badge tone="danger">{urgentTickets.length}</Badge> urgent support tickets
                </ButtonLink>
              )}
              {overdue.length > 0 && (
                <ButtonLink to="/admin/finance" variant="ghost" size="sm">
                  <Badge tone="warning">{overdue.length}</Badge> overdue invoices
                </ButtonLink>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ------------------------------------------------- CHART ROW */}
      <div className="grid grid--2" style={{ alignItems: 'start', marginBottom: 'var(--space-6)' }}>
        <Card>
          <CardHeader
            title="Monthly revenue"
            action={<span className="xs dim">September is partial</span>}
          />
          <CardBody>
            <BarChart data={revenueSeries} format={currencyCompact} valueLabel="Collected" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Sales pipeline"
            action={
              <ButtonLink to="/admin/crm" variant="ghost" size="sm">
                Open CRM →
              </ButtonLink>
            }
          />
          <CardBody>
            <FunnelChart stages={funnelStages} />
            <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
              Percentages show stage-to-stage conversion. The biggest drop is where to focus
              coaching effort.
            </p>
          </CardBody>
        </Card>
      </div>

      {/* --------------------------------- UTILISATION + STOCK + PROJECTS */}
      <div className="grid" style={{ '--col-min': '320px' } as React.CSSProperties}>
        <Card>
          <CardHeader title="Technician utilisation" />
          <CardBody>
            <div className="stack">
              {crewLoad.length === 0 && <p className="small dim">No crew on the roster yet.</p>}
              {crewLoad.map((tech) => (
                <div key={tech.name}>
                  <div className="row row--between small" style={{ marginBottom: 4 }}>
                    <span className="strong">{tech.name}</span>
                    <span className="dim">{tech.jobs} jobs</span>
                  </div>
                  <Progress
                    value={tech.utilisation}
                    tone={tech.utilisation > 0.9 ? 'danger' : 'brand'}
                  />
                </div>
              ))}
            </div>
            <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
              Above 90% is flagged red — sustained overload predicts scheduling failures and
              burnout.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Stock turnaround"
            action={
              <ButtonLink to="/admin/inventory" variant="ghost" size="sm">
                Manage →
              </ButtonLink>
            }
          />
          <CardBody>
            <div className="stack stack--sm">
              {STOCK.slice(0, 5).map((item) => {
                const available = item.onHand - item.reserved
                const ratio = Math.min(available / Math.max(item.reorderPoint, 1), 1)
                return (
                  <div key={item.id}>
                    <div className="row row--between small" style={{ marginBottom: 4 }}>
                      <span>{item.name}</span>
                      <span className="num dim">{number(available)} free</span>
                    </div>
                    <Progress value={ratio} tone={ratio < 1 ? 'danger' : 'success'} />
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Active projects"
            action={
              <ButtonLink to="/admin/projects" variant="ghost" size="sm">
                All →
              </ButtonLink>
            }
          />
          <CardBody>
            <div className="stack">
              {PROJECTS.map((project) => {
                const done = project.milestones.filter((m) => m.status === 'done').length
                return (
                  <div key={project.id}>
                    <div className="row row--between small" style={{ marginBottom: 4 }}>
                      <span className="strong">{project.clientName}</span>
                      <span className="num dim">{currency(project.contractValue)}</span>
                    </div>
                    <Progress
                      value={done / project.milestones.length}
                      tone={project.status === 'completed' ? 'success' : 'brand'}
                    />
                    <div className="xs dim" style={{ marginTop: 2 }}>
                      {project.reference} · {done}/{project.milestones.length} milestones
                    </div>
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
