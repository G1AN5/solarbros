import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { relative } from '@/lib/format'
import {
  useMarkNotificationsRead,
  useMyNotifications,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  type NotificationPreferences,
} from '@/lib/queries/client-portal'
import { FormError } from '@/components/ui/FormError'

/* ============================================================================
   NotificationsPage — "Notification center (SMS/email alerts for milestones,
   appointment reminders)".
   ----------------------------------------------------------------------------
   ONE notifications table feeds three delivery channels. The row records which
   channel was used so support can answer "did you send me a text about this?".

   BACKEND PLAN
     • A Postgres trigger on `project_milestones` inserts a notification row
       whenever a milestone flips to 'done'.
     • A Supabase Edge Function (invoked by a webhook or pg_cron) picks up
       unsent rows and dispatches via Resend (email) and Semaphore/Twilio (SMS
       — Semaphore is the practical choice for Philippine numbers).
     • In-app delivery is just this page reading the same rows.

   Channel preferences below are stored per user so people can opt out of SMS
   without losing milestone emails.
   ========================================================================== */

const CHANNEL_ICON: Record<string, string> = {
  in_app: '🔔',
  email: '📧',
  sms: '💬',
}

export function NotificationsPage() {
  /* The Save button was inert and the table offered eighteen checkboxes across
     categories the schema does not have. These seven flags are the real ones —
     and they are LIVE: the milestone trigger reads `milestone_email` before it
     queues anything, so the preference was already being honoured with no way
     for a customer to set it. */
  const prefsQuery = useNotificationPreferences()
  const savePrefs = useUpdateNotificationPreferences()
  const [draft, setDraft] = useState<NotificationPreferences | null>(null)
  const [saved, setSaved] = useState(false)

  const prefs = draft ?? prefsQuery.data
  const dirty = draft !== null

  function toggle(key: keyof NotificationPreferences) {
    if (!prefs) return
    setSaved(false)
    setDraft({ ...prefs, [key]: !prefs[key] })
  }

  const notificationsQuery = useMyNotifications()
  const markAllRead = useMarkNotificationsRead()
  const notifications = notificationsQuery.data ?? []
  const unread = notifications.filter((n) => !n.read)

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Milestone alerts, appointment reminders and billing notices."
        breadcrumbs={[{ label: 'Portal', to: '/portal' }, { label: 'Notifications' }]}
        actions={
          <Button
            variant="outline"
            disabled={unread.length === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            {markAllRead.isPending ? 'Marking…' : 'Mark all as read'}
          </Button>
        }
      />

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        <Card>
          <CardHeader
            title="Recent"
            action={
              unread.length > 0 ? <Badge tone="danger">{unread.length} unread</Badge> : undefined
            }
          />
          <CardBody>
            <div className="stack">
              {notifications.map((note) => (
                <div
                  key={note.id}
                  style={{
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius)',
                    background: note.read ? 'transparent' : 'var(--brand-50)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div className="row row--between">
                    <span className="row">
                      <span aria-hidden>{CHANNEL_ICON[note.channel]}</span>
                      <span className="strong small">{note.title}</span>
                    </span>
                    <span className="xs dim">{relative(note.at)}</span>
                  </div>
                  <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                    {note.body}
                  </p>
                  <span className="xs dim">Sent via {note.channel.replace('_', '-')}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* -------------------------------------- CHANNEL PREFERENCES */}
        <Card>
          <CardHeader title="How we contact you" />
          <CardBody>
            <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
              Choose which channel each type of update reaches you on. Critical safety notices are
              always sent by SMS regardless of these settings.
            </p>

            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Update type</th>
                    <th className="center">In-app</th>
                    <th className="center">Email</th>
                    <th className="center">SMS</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      {
                        label: 'Installation milestones',
                        email: 'milestoneEmail',
                        sms: 'milestoneSms',
                      },
                      {
                        label: 'Appointments and visits',
                        email: 'appointmentEmail',
                        sms: 'appointmentSms',
                      },
                      { label: 'Invoices and payments', email: 'billingEmail', sms: 'billingSms' },
                      { label: 'Offers and news', email: 'marketingEmail', sms: null },
                    ] as const
                  ).map((row) => (
                    <tr key={row.label}>
                      <td className="small">{row.label}</td>
                      <td className="center">
                        {/* In-app is not a choice: it is the bell in this
                            portal, and silencing it would let a customer with
                            no email miss that their installation had finished. */}
                        <span className="xs dim" title="Always on">
                          Always
                        </span>
                      </td>
                      <td className="center">
                        <input
                          type="checkbox"
                          aria-label={`Email me about ${row.label}`}
                          checked={prefs?.[row.email] ?? false}
                          disabled={!prefs}
                          onChange={() => toggle(row.email)}
                        />
                      </td>
                      <td className="center">
                        {row.sms ? (
                          <input
                            type="checkbox"
                            aria-label={`Text me about ${row.label}`}
                            checked={prefs?.[row.sms] ?? false}
                            disabled={!prefs}
                            onChange={() => toggle(row.sms)}
                          />
                        ) : (
                          <span className="xs dim">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <FormError error={savePrefs.error} />

            <div className="row" style={{ marginTop: 'var(--space-4)' }}>
              <Button
                variant="primary"
                disabled={!dirty || savePrefs.isPending}
                onClick={() =>
                  prefs &&
                  savePrefs.mutate(prefs, {
                    onSuccess: () => {
                      setDraft(null)
                      setSaved(true)
                    },
                  })
                }
              >
                {savePrefs.isPending ? 'Saving…' : 'Save preferences'}
              </Button>
              {saved && (
                <span className="small" style={{ color: 'var(--success-fg)' }}>
                  ✓ Saved
                </span>
              )}
              {dirty && !savePrefs.isPending && <span className="xs dim">Unsaved changes</span>}
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
