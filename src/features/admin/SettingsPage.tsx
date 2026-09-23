import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { QueryState } from '@/components/ui/QueryState'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/app/auth/useAuth'
import { currency, dateTime } from '@/lib/format'
import { ROLE_LABEL } from '@/lib/labels'
import { useSettings, useUpdateSetting, type Setting } from '@/lib/queries/settings'

/* ============================================================================
   SettingsPage — business rules, editable by the people who own them.
   (/admin/settings)
   ----------------------------------------------------------------------------
   Every value here used to be a constant in a migration or a React file:
   discount authority, invoice due dates, lead scoring weights, installed cost
   per kW, the reorder point applied to new stock.

   Changing any of them meant a developer, a commit and a deploy. That is the
   wrong shape for a business — panel prices move with the exchange rate, a slow
   quarter is a reason to widen discount authority for a month, and a company
   that has to raise a ticket to change a threshold will simply stop changing it.

   PERMISSIONS ARE PER SETTING, NOT PER PAGE
   Each row declares which roles may edit it. The accountant owns pricing and
   payment terms, the inventory manager owns stock thresholds, sales owns lead
   scoring and support targets, the administrator owns everything.

   The database enforces that through the `settings_update` policy. Fields a
   role cannot change are shown read-only rather than hidden — seeing the
   company's discount limit is useful context for a sales rep even when they
   cannot move it.

   WHAT IS DELIBERATELY ABSENT
   The milestone sequence, the RLS policies, the audit log's immutability. Those
   are invariants the rest of the system depends on, not preferences, and
   exposing them here would let somebody switch off a guarantee by accident.
   ========================================================================== */

const CATEGORY_LABELS: Record<string, { label: string; blurb: string; icon: string }> = {
  company: {
    label: 'Company',
    icon: '🏢',
    blurb: 'Details shown on the website, quotations and documents.',
  },
  pricing: {
    label: 'Pricing & estimator',
    icon: '💰',
    blurb: 'What the estimator quotes and what a quotation costs out at.',
  },
  sales: {
    label: 'Sales',
    icon: '🤝',
    blurb: 'Discount authority, quotation validity and commission.',
  },
  scoring: {
    label: 'Lead scoring',
    icon: '🎯',
    blurb: 'How a prospect is scored out of 100. Tune it as you learn what converts.',
  },
  finance: {
    label: 'Finance',
    icon: '🧾',
    blurb: 'Payment stages, due dates and collections.',
  },
  inventory: {
    label: 'Inventory',
    icon: '📦',
    blurb: 'Reorder defaults and purchase approval limits.',
  },
  operations: {
    label: 'Operations',
    icon: '🔧',
    blurb: 'Maintenance intervals, crew loading and overtime warnings.',
  },
  support: {
    label: 'Support targets',
    icon: '⏱️',
    blurb: 'Response times by priority.',
  },
  warranty: { label: 'Warranty', icon: '🛡️', blurb: 'Coverage periods offered to customers.' },
}

const ORDER = [
  'company',
  'pricing',
  'sales',
  'scoring',
  'finance',
  'inventory',
  'operations',
  'support',
  'warranty',
]

export function SettingsPage() {
  const { user } = useAuth()
  const settingsQuery = useSettings()
  const updateSetting = useUpdateSetting()

  const [category, setCategory] = useState('company')
  /** Uncommitted edits, keyed by setting. Nothing saves until you press Save. */
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savedKey, setSavedKey] = useState<string | null>(null)

  // `?? []` would allocate a new array on every render and defeat the useMemo
  // below, re-grouping every setting on each keystroke in an input.
  const settings = useMemo(() => settingsQuery.data ?? [], [settingsQuery.data])

  const byCategory = useMemo(() => {
    const map: Record<string, Setting[]> = {}
    for (const s of settings) (map[s.category] ??= []).push(s)
    return map
  }, [settings])

  const visible = byCategory[category] ?? []

  function canEdit(setting: Setting) {
    return user ? setting.editableBy.includes(user.role) : false
  }

  function draftValue(setting: Setting) {
    return drafts[setting.key] ?? String(setting.value ?? '')
  }

  function isDirty(setting: Setting) {
    return drafts[setting.key] !== undefined && drafts[setting.key] !== String(setting.value ?? '')
  }

  function save(setting: Setting) {
    const raw = draftValue(setting)
    // Numbers are stored as JSON numbers, text as JSON strings — the column is
    // jsonb, so the distinction is preserved and setting_num() can cast it.
    const value = setting.valueType === 'text' ? raw : Number(raw)

    if (setting.valueType !== 'text' && !Number.isFinite(value as number)) return

    updateSetting.mutate(
      { key: setting.key, value, userId: user?.id ?? '' },
      {
        onSuccess: () => {
          setDrafts((d) => {
            const next = { ...d }
            delete next[setting.key]
            return next
          })
          setSavedKey(setting.key)
          window.setTimeout(() => setSavedKey(null), 2500)
        },
      },
    )
  }

  /* The three finance stage percentages must total 100, and the database
     rejects a contract where they do not. Warn here rather than letting
     somebody discover it when a contract fails to save. */
  const stageTotal =
    Number(settings.find((s) => s.key === 'finance.down_payment_pct')?.value ?? 0) +
    Number(settings.find((s) => s.key === 'finance.delivery_pct')?.value ?? 0) +
    Number(settings.find((s) => s.key === 'finance.commissioning_pct')?.value ?? 0)

  return (
    <>
      <PageHeader
        title="Business settings"
        description="Rules the company can change without a developer."
      />

      <Card style={{ marginBottom: 'var(--space-5)' }}>
        <CardBody>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.4rem' }} aria-hidden>
              ⚙️
            </span>
            <p className="small muted" style={{ maxWidth: '92ch' }}>
              These values are read by the application <strong>and by the database</strong>.
              Changing the discount limit here changes what the database will actually accept, not
              just what the screen shows. Fields you cannot edit are shown read-only, so everyone
              can see the rules they work under.
            </p>
          </div>
        </CardBody>
      </Card>

      <Tabs
        tabs={ORDER.filter((c) => byCategory[c]?.length).map((c) => ({
          value: c,
          label: `${CATEGORY_LABELS[c]?.icon ?? ''} ${CATEGORY_LABELS[c]?.label ?? c}`,
          count: byCategory[c]?.length,
        }))}
        active={category}
        onChange={setCategory}
      />

      <QueryState
        isLoading={settingsQuery.isLoading}
        error={settingsQuery.error as Error | null}
        isEmpty={settings.length === 0}
        emptyIcon="⚙️"
        emptyTitle="No settings found"
        emptyMessage="The settings table has not been seeded."
      >
        <Card>
          <CardHeader
            title={CATEGORY_LABELS[category]?.label ?? category}
            action={
              category === 'finance' && stageTotal !== 100 ? (
                <Badge tone="danger">Stages total {stageTotal}% — must be 100%</Badge>
              ) : undefined
            }
          />
          <CardBody>
            <p className="small muted" style={{ marginBottom: 'var(--space-5)' }}>
              {CATEGORY_LABELS[category]?.blurb}
            </p>

            <div className="stack">
              {visible.map((setting) => {
                const editable = canEdit(setting)
                const dirty = isDirty(setting)

                return (
                  <div
                    key={setting.key}
                    style={{
                      padding: 'var(--space-4)',
                      border: `1px solid ${dirty ? 'var(--brand-500)' : 'var(--border)'}`,
                      background: dirty ? 'var(--brand-50)' : 'var(--bg-surface)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <div
                      className="row row--between row--wrap"
                      style={{ alignItems: 'flex-start', gap: 'var(--space-4)' }}
                    >
                      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                        <div className="row">
                          <span className="small strong">{setting.label}</span>
                          {setting.isPublic && <Badge tone="info">Public</Badge>}
                          {savedKey === setting.key && <Badge tone="success">Saved</Badge>}
                        </div>

                        {setting.description && (
                          <p className="xs muted" style={{ marginTop: 'var(--space-1)' }}>
                            {setting.description}
                          </p>
                        )}

                        <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                          <code>{setting.key}</code>
                          {' · '}
                          {editable ? (
                            <>Editable by you</>
                          ) : (
                            <>
                              Editable by {setting.editableBy.map((r) => ROLE_LABEL[r]).join(', ')}
                            </>
                          )}
                        </p>
                      </div>

                      <div className="row" style={{ flexShrink: 0 }}>
                        {setting.valueType === 'text' ? (
                          <input
                            className="input"
                            style={{ width: 280 }}
                            value={draftValue(setting)}
                            disabled={!editable}
                            onChange={(e) =>
                              setDrafts({ ...drafts, [setting.key]: e.target.value })
                            }
                          />
                        ) : (
                          <>
                            <input
                              className="input"
                              type="number"
                              style={{ width: 120, textAlign: 'right' }}
                              value={draftValue(setting)}
                              disabled={!editable}
                              min={setting.minValue ?? undefined}
                              max={setting.maxValue ?? undefined}
                              step={setting.valueType === 'currency' ? 1000 : 'any'}
                              onChange={(e) =>
                                setDrafts({ ...drafts, [setting.key]: e.target.value })
                              }
                            />
                            {setting.unit && (
                              <span className="small dim" style={{ minWidth: 44 }}>
                                {setting.unit}
                              </span>
                            )}
                          </>
                        )}

                        {dirty && (
                          <>
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={updateSetting.isPending}
                              onClick={() => save(setting)}
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setDrafts((d) => {
                                  const next = { ...d }
                                  delete next[setting.key]
                                  return next
                                })
                              }
                            >
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Currency fields are easy to mistype by a factor of ten,
                        so the formatted value is echoed back. */}
                    {setting.valueType === 'currency' && !dirty && (
                      <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                        {currency(Number(setting.value ?? 0))}
                      </p>
                    )}

                    {(setting.minValue !== null || setting.maxValue !== null) && dirty && (
                      <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                        Allowed range: {setting.minValue ?? '—'} to {setting.maxValue ?? '—'}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {updateSetting.error && (
              <p
                className="small"
                style={{
                  marginTop: 'var(--space-4)',
                  padding: 'var(--space-3)',
                  background: 'var(--danger-bg)',
                  color: 'var(--danger-fg)',
                  borderRadius: 'var(--radius)',
                }}
                role="alert"
              >
                {(updateSetting.error as Error).message}
              </p>
            )}

            {visible.length > 0 && (
              <p className="xs dim" style={{ marginTop: 'var(--space-5)' }}>
                Last change in this section:{' '}
                {dateTime(
                  visible.reduce(
                    (latest, s) => (s.updatedAt > latest ? s.updatedAt : latest),
                    visible[0].updatedAt,
                  ),
                )}
              </p>
            )}
          </CardBody>
        </Card>
      </QueryState>
    </>
  )
}
