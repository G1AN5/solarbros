import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { StatTile } from '@/components/ui/StatTile'
import { Tabs } from '@/components/ui/Tabs'
import { relative } from '@/lib/format'
import { useDispatchNotifications, useOutbox } from '@/lib/queries/notifications'
import { settingText, useSettings } from '@/lib/queries/settings'

/* ============================================================================
   OutboxPage — every message the system has queued, and whether it went.
   ----------------------------------------------------------------------------
   Outbound messaging is the part of a system that fails silently. Nobody
   notices that appointment confirmations stopped until a customer turns up on
   the wrong day, and by then the only evidence is a provider dashboard somebody
   has to find the password for.

   So this shows the queue in plain terms: what was sent, what failed and why,
   what it would have said, and how many attempts it took. With simulation on it
   also makes the whole notification flow demonstrable with no provider account
   at all — which is what the outbox was designed for back in migration 0001.
   ========================================================================== */

type Filter = 'all' | 'queued' | 'sent' | 'failed' | 'skipped'

const STATUS_TONE = {
  queued: 'warning',
  sent: 'success',
  failed: 'danger',
  skipped: 'neutral',
} as const

const CHANNEL_ICON = { in_app: '🔔', email: '✉️', sms: '💬' } as const

export function OutboxPage() {
  const [filter, setFilter] = useState<Filter>('all')
  const outbox = useOutbox(filter === 'all' ? undefined : filter)
  const dispatch = useDispatchNotifications()
  const settings = useSettings().data

  const simulating = settingText(settings, 'notifications.simulate_delivery', 'true') !== 'false'

  const messages = outbox.data ?? []
  const counts = {
    queued: messages.filter((m) => m.deliveryStatus === 'queued').length,
    sent: messages.filter((m) => m.deliveryStatus === 'sent').length,
    failed: messages.filter((m) => m.deliveryStatus === 'failed').length,
    skipped: messages.filter((m) => m.deliveryStatus === 'skipped').length,
  }

  return (
    <>
      <PageHeader
        title="Notification outbox"
        description="Every email, SMS and in-app message the system has raised, and what happened to it."
        breadcrumbs={[{ label: 'Governance' }, { label: 'Outbox' }]}
        actions={
          <Button variant="primary" onClick={() => dispatch.mutate()} disabled={dispatch.isPending}>
            {dispatch.isPending ? 'Dispatching…' : 'Send queued messages now'}
          </Button>
        }
      />

      {/* SIMULATION IS THE DEFAULT, and saying so plainly matters. An outbox
          full of "sent" that never left the building is worse than useless if
          nobody realises. */}
      <Card
        style={{
          marginBottom: 'var(--space-6)',
          borderColor: simulating ? 'var(--warning-solid)' : 'var(--success-solid)',
        }}
      >
        <CardBody>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.5rem' }}>{simulating ? '🧪' : '📡'}</span>
            <div>
              <h4 style={{ margin: 0 }}>
                {simulating ? 'Simulation is on — nothing is actually sent' : 'Live delivery'}
              </h4>
              <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                {simulating
                  ? 'Messages below are marked sent and recorded exactly as they would be, but nothing leaves the building. The whole flow can be demonstrated without a provider account. Turn simulation off in Settings once real credentials are configured — and only then.'
                  : 'Messages are going to real customers through Resend and Semaphore. Email and SMS can each be switched off separately in Settings without touching the rest of the system.'}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {dispatch.data && (
        <Card style={{ marginBottom: 'var(--space-6)' }}>
          <CardBody>
            <span className="small">
              Last run: claimed <strong>{dispatch.data.claimed}</strong>, sent{' '}
              <strong>{dispatch.data.sent}</strong>, failed <strong>{dispatch.data.failed}</strong>,
              skipped <strong>{dispatch.data.skipped}</strong>
              {dispatch.data.requeued > 0 && (
                <> · requeued {dispatch.data.requeued} from an unfinished run</>
              )}
              {dispatch.data.simulated && <span className="dim"> · simulated</span>}
            </span>
          </CardBody>
        </Card>
      )}

      <FormError error={dispatch.error} />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Queued" value={String(counts.queued)} />
        <StatTile label="Sent" value={String(counts.sent)} />
        <StatTile
          label="Failed"
          value={String(counts.failed)}
          delta={counts.failed ? 'Needs attention' : 'None'}
          direction={counts.failed ? 'up' : 'flat'}
          invertDelta
        />
        <StatTile label="Skipped" value={String(counts.skipped)} />
      </div>

      <Tabs
        tabs={[
          { value: 'all' as Filter, label: 'All' },
          { value: 'queued' as Filter, label: 'Queued' },
          { value: 'sent' as Filter, label: 'Sent' },
          { value: 'failed' as Filter, label: 'Failed' },
          { value: 'skipped' as Filter, label: 'Skipped' },
        ]}
        active={filter}
        onChange={setFilter}
      />

      <Card>
        <CardHeader title="Messages" />
        <CardBody>
          <QueryState
            isLoading={outbox.isLoading}
            error={outbox.error as Error | null}
            isEmpty={messages.length === 0}
            emptyIcon="📭"
            emptyTitle="Nothing here"
            emptyMessage="Messages appear as milestones complete, visits are assigned and invoices are raised."
          >
            <div className="stack stack--sm">
              {messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    padding: 'var(--space-3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div className="row row--between">
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <span aria-hidden>{CHANNEL_ICON[message.channel]}</span>
                      <span className="strong small">{message.title}</span>
                      <Badge tone={STATUS_TONE[message.deliveryStatus]}>
                        {message.deliveryStatus}
                      </Badge>
                    </div>
                    <span className="xs dim">{relative(message.createdAt)}</span>
                  </div>

                  <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                    {message.body}
                  </p>

                  <div className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                    to {message.recipientName ?? 'unknown'}
                    {message.toEmail ? ` · ${message.toEmail}` : ''}
                    {message.toPhone ? ` · ${message.toPhone}` : ''}
                    {message.attempts > 0 ? ` · ${message.attempts} attempt(s)` : ''}
                    {message.providerMessageId ? ` · ${message.providerMessageId}` : ''}
                  </div>

                  {message.deliveryError && (
                    <p
                      className="xs"
                      style={{
                        marginTop: 'var(--space-2)',
                        padding: 'var(--space-2)',
                        background: 'var(--danger-bg)',
                        color: 'var(--danger-fg)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {message.deliveryError}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </QueryState>
        </CardBody>
      </Card>
    </>
  )
}
