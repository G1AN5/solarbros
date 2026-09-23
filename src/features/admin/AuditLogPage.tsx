import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatTile } from '@/components/ui/StatTile'
import { Tabs } from '@/components/ui/Tabs'
import { dateTime, relative } from '@/lib/format'
import { ROLE_LABEL } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { useAuditLog } from '@/lib/queries/admin'
import type { AuditEntryRow } from '@/lib/queries/admin'
import { datedFilename, downloadCsv } from '@/lib/csv'

/* ============================================================================
   AuditLogPage — immutable record of privileged actions.
   ----------------------------------------------------------------------------
   The spec calls for "immutable event logs recording critical actions
   (financial record changes, status overrides, payroll exports, data updates)".

   HOW TO MAKE IT ACTUALLY IMMUTABLE IN POSTGRES
     • The `audit_log` table gets an RLS policy allowing INSERT and SELECT only —
       no UPDATE, no DELETE, for anyone including admins.
     • Rows are written by database TRIGGERS on the audited tables, not by
       application code. Application code can be bypassed; a trigger cannot.
     • Revoke UPDATE and DELETE on the table from every role at the grant level
       as a second layer.
     • Retain for at least the statutory period (7 years for financial records
       under Philippine tax rules).

   An audit log an administrator can edit is not an audit log.
   ========================================================================== */

type Severity = 'all' | 'info' | 'warning' | 'critical'

const SEVERITY_TONE = {
  info: 'neutral',
  warning: 'warning',
  critical: 'danger',
} as const

export function AuditLogPage() {
  const [severity, setSeverity] = useState<Severity>('all')

  // The whole log is fetched once and filtered in memory. At this volume that
  // is cheaper than a round trip per tab, and it keeps the counts on the tabs
  // honest — a server-side filter would make every tab show its own total.
  const auditQuery = useAuditLog()
  const entries = auditQuery.data ?? []

  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()

  const rows = (
    severity === 'all' ? entries : entries.filter((entry) => entry.severity === severity)
  ).filter(
    (entry) =>
      !needle ||
      entry.actorName.toLowerCase().includes(needle) ||
      (entry.entity ?? '').toLowerCase().includes(needle) ||
      entry.action.toLowerCase().includes(needle),
  )
  const critical = entries.filter((e) => e.severity === 'critical')

  const columns: Column<AuditEntryRow>[] = [
    {
      header: 'When',
      cell: (entry) => (
        <div>
          <div className="small">{dateTime(entry.at)}</div>
          <div className="xs dim">{relative(entry.at)}</div>
        </div>
      ),
    },
    {
      header: 'Actor',
      cell: (entry) => (
        <div className="row">
          <span className="avatar">
            {entry.actorName
              .split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')}
          </span>
          <div>
            <div className="small strong">{entry.actorName}</div>
            <div className="xs dim">{entry.actorRole ? ROLE_LABEL[entry.actorRole] : 'system'}</div>
          </div>
        </div>
      ),
    },
    {
      header: 'Action',
      cell: (entry) => (
        <span style={{ maxWidth: '48ch', display: 'inline-block' }}>{entry.action}</span>
      ),
    },
    {
      header: 'Entity',
      cell: (entry) => (
        <div>
          <div className="small">{entry.entity}</div>
          <code className="xs">{entry.entityId}</code>
        </div>
      ),
    },
    {
      header: 'Severity',
      cell: (entry) => (
        <Badge tone={SEVERITY_TONE[entry.severity]}>{entry.severity.toUpperCase()}</Badge>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every privileged action, for compliance review."
        breadcrumbs={[{ label: 'Governance', to: '/admin/governance' }, { label: 'Audit log' }]}
        actions={
          <>
            {/* An audit log is searched when somebody is looking for one
                specific action, which is the only time anyone opens it. The
                box accepted typing and did nothing with it. */}
            <input
              className="input"
              placeholder="Search actor or entity…"
              style={{ width: 240 }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(datedFilename('audit-log'), rows, [
                  { header: 'When', value: (e) => e.at },
                  { header: 'Actor', value: (e) => e.actorName },
                  { header: 'Role', value: (e) => e.actorRole ?? '' },
                  { header: 'Action', value: (e) => e.action },
                  { header: 'Entity', value: (e) => e.entity },
                  { header: 'Entity id', value: (e) => e.entityId ?? '' },
                  { header: 'Severity', value: (e) => e.severity },
                ])
              }
            >
              Export for audit
            </Button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Events recorded" value={String(entries.length)} />
        <StatTile
          label="Critical events"
          value={String(critical.length)}
          delta="Require review"
          direction={critical.length ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile
          label="Unique actors"
          value={String(new Set(entries.map((e) => e.actorName)).size)}
        />
        <StatTile label="Retention" value="7 years" delta="Statutory minimum" />
      </div>

      <Tabs
        tabs={[
          { value: 'all' as Severity, label: 'All events', count: entries.length },
          { value: 'critical' as Severity, label: 'Critical', count: critical.length },
          { value: 'warning' as Severity, label: 'Warning' },
          { value: 'info' as Severity, label: 'Info' },
        ]}
        active={severity}
        onChange={setSeverity}
      />

      <QueryState isLoading={auditQuery.isLoading} error={auditQuery.error as Error | null}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(entry) => entry.id}
          emptyMessage="No events at this severity."
        />
      </QueryState>

      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardBody>
          <h4>What gets logged</h4>
          <div className="grid" style={{ marginTop: 'var(--space-4)' }}>
            <div>
              <Badge tone="danger">Critical</Badge>
              <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                Role changes, payroll exports, bulk data exports, deletion of any financial record,
                and permission-policy changes.
              </p>
            </div>
            <div>
              <Badge tone="warning">Warning</Badge>
              <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                Discount overrides beyond policy, manual stock adjustments, backdated milestone
                completions, and invoice amount edits.
              </p>
            </div>
            <div>
              <Badge tone="neutral">Info</Badge>
              <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                Routine operations: milestone completions, lead stage moves, appointment assignments
                and document uploads.
              </p>
            </div>
          </div>

          <p
            className="small"
            style={{
              marginTop: 'var(--space-5)',
              padding: 'var(--space-3)',
              background: 'var(--info-bg)',
              color: 'var(--info-fg)',
              borderRadius: 'var(--radius)',
            }}
          >
            ℹ️ Entries are written by database triggers, not by application code, and the table
            permits INSERT and SELECT only. Nobody — including administrators — can edit or delete
            an entry after the fact.
          </p>
        </CardBody>
      </Card>
    </>
  )
}
