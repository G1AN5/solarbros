import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { Progress } from '@/components/ui/Progress'
import { StatTile } from '@/components/ui/StatTile'
import { currency, currencyCompact, date } from '@/lib/format'
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE, SYSTEM_TYPE_LABEL } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { useProjects } from '@/lib/queries/operations'
import type { Project } from '@/types/domain'
import { datedFilename, downloadCsv } from '@/lib/csv'

/* ============================================================================
   AdminProjectsPage — Project & Site Deployment module (list view).
   ----------------------------------------------------------------------------
   A project is created when a CRM lead reaches the 'contract' stage. From then
   on this table is operations' master list.

   The progress column reads the SAME milestone rows the technician updates in
   the field and the customer watches in their portal — one record, three
   audiences.
   ========================================================================== */

export function AdminProjectsPage() {
  const navigate = useNavigate()
  const projectsQuery = useProjects()
  const projects = projectsQuery.data ?? []

  const [statusFilter, setStatusFilter] = useState('all')
  const visible =
    statusFilter === 'all' ? projects : projects.filter((p) => p.status === statusFilter)

  const totalValue = projects.reduce((sum, p) => sum + p.contractValue, 0)
  const collected = projects.reduce((sum, p) => sum + p.amountPaid, 0)

  const columns: Column<Project>[] = [
    {
      header: 'Reference',
      cell: (p) => (
        <div>
          <code>{p.reference}</code>
          <div className="xs dim">{date(p.startDate)}</div>
        </div>
      ),
    },
    {
      header: 'Client',
      cell: (p) => (
        <div>
          <div className="strong">{p.clientName}</div>
          <div className="xs dim" style={{ maxWidth: '30ch' }}>
            {p.address}
          </div>
        </div>
      ),
    },
    {
      header: 'System',
      cell: (p) => (
        <div>
          <div className="strong">{p.systemKw} kW</div>
          <div className="xs dim">{SYSTEM_TYPE_LABEL[p.systemType]}</div>
        </div>
      ),
    },
    {
      header: 'Progress',
      cell: (p) => {
        const done = p.milestones.filter((m) => m.status === 'done').length
        return (
          <div style={{ minWidth: 140 }}>
            <Progress
              value={done / p.milestones.length}
              tone={p.status === 'completed' ? 'success' : 'brand'}
            />
            <div className="xs dim" style={{ marginTop: 4 }}>
              {done}/{p.milestones.length} milestones
            </div>
          </div>
        )
      },
    },
    {
      header: 'Status',
      cell: (p) => (
        <Badge tone={PROJECT_STATUS_TONE[p.status]}>{PROJECT_STATUS_LABEL[p.status]}</Badge>
      ),
    },
    { header: 'Engineer', cell: (p) => <span className="small">{p.assignedEngineer}</span> },
    { header: 'Contract', numeric: true, cell: (p) => currency(p.contractValue) },
    {
      header: 'Collected',
      numeric: true,
      cell: (p) => (
        <span className={p.amountPaid < p.contractValue ? 'muted' : 'strong'}>
          {currency(p.amountPaid)}
        </span>
      ),
    },
    { header: 'Target turnover', cell: (p) => date(p.targetTurnover) },
  ]

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every installation from contract signing through to final turnover."
        actions={
          <>
            {/* This filtered nothing. On a list that grows with every
                contract signed, "All statuses" was the only setting that ever
                did anything. */}
            <select
              className="select"
              style={{ width: 'auto' }}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="planning">Planning</option>
              <option value="in_progress">In progress</option>
              <option value="on_hold">On hold</option>
              <option value="completed">Completed</option>
            </select>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(datedFilename('projects'), visible, [
                  { header: 'Reference', value: (p) => p.reference },
                  { header: 'Customer', value: (p) => p.clientName },
                  { header: 'Address', value: (p) => p.address },
                  { header: 'System kW', value: (p) => p.systemKw },
                  { header: 'Type', value: (p) => p.systemType },
                  { header: 'Contract value', value: (p) => p.contractValue },
                  { header: 'Paid', value: (p) => p.amountPaid },
                  { header: 'Status', value: (p) => p.status },
                  { header: 'Engineer', value: (p) => p.assignedEngineer },
                  { header: 'Target turnover', value: (p) => p.targetTurnover },
                ])
              }
            >
              Export CSV
            </Button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Total projects" value={String(projects.length)} />
        <StatTile
          label="In progress"
          value={String(projects.filter((p) => p.status === 'in_progress').length)}
        />
        <StatTile label="Contract value" value={currencyCompact(totalValue)} />
        <StatTile
          label="Collected"
          value={currencyCompact(collected)}
          delta={`${Math.round((collected / totalValue) * 100)}% of contracted`}
          direction="up"
        />
      </div>

      <QueryState
        isLoading={projectsQuery.isLoading}
        error={projectsQuery.error as Error | null}
        emptyIcon="&#128203;"
        emptyTitle="No projects yet"
        emptyMessage="A project appears here as soon as a contract is executed."
      >
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(p) => p.id}
          onRowClick={(p) => navigate(`/admin/projects/${p.id}`)}
        />
      </QueryState>

      <p className="small dim" style={{ marginTop: 'var(--space-4)' }}>
        Click any row to open the full project record — milestones, assigned crew, bill of
        materials, documents and the invoice schedule.
      </p>
    </>
  )
}
