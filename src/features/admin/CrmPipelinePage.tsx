import { type FormEvent, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatTile } from '@/components/ui/StatTile'
import { Tabs } from '@/components/ui/Tabs'
import { currency, currencyCompact, humanize, relative } from '@/lib/format'
import { LEAD_STAGE_LABEL, LEAD_STAGE_TONE, PIPELINE_ORDER } from '@/lib/labels'
import { QueryState } from '@/components/ui/QueryState'
import { useCreateLead, useLeads, useUpdateLead, useUpdateLeadStage } from '@/lib/queries/crm'
import { usePricingConfig } from '@/lib/queries/settings'
import { systemPrice, type PricingConfig } from '@/lib/solar-estimator'
import type { Lead, LeadStage } from '@/types/domain'
import { Modal } from '@/components/ui/Modal'
import { FormError } from '@/components/ui/FormError'
import { datedFilename, downloadCsv } from '@/lib/csv'

/* ============================================================================
   CrmPipelinePage — Sales & CRM module.
   ----------------------------------------------------------------------------
   WHERE LEADS COME FROM (all three feed this one board):
     • public /estimator  → source 'estimator'      (anonymous, lower intent)
     • public /contact    → source 'quote_request'  (higher intent)
     • /portal/upgrade    → source 'referral'       (existing customer, highest)

   WHERE THEY GO:
     stage 'contract' → creates a Project (/admin/projects) and reserves stock
     stage 'site_visit' → creates an Appointment (/admin/dispatch)

   TWO VIEWS, ONE DATASET — a deliberate merge of two spec bullets that
   described the same thing ("pipeline view to drag-and-drop leads" and "lead
   scoring/pipeline view"):
     Board — spatial, good for daily standups and moving deals along
     Table — dense, good for sorting by score or filtering by rep

   DRAG-AND-DROP works on the board, using the browser's own HTML5 drag events
   rather than a library — 30-50 KB is a lot to pay for a gesture that ships
   with every browser. It is an ENHANCEMENT: native drag cannot be operated from
   a keyboard and does nothing at all by touch, so the "Move stage" button on
   each card is the route that always works, and is the one most people on a
   phone will use.
   ========================================================================== */

type View = 'board' | 'table'

/** Colour-code the lead score so a manager can triage at a glance. */
function scoreTone(score: number) {
  if (score >= 85) return 'success' as const
  if (score >= 70) return 'warning' as const
  return 'neutral' as const
}

/**
 * Rough deal value.
 *
 * Priced through the same function the public estimator uses, against the same
 * settings. It was `lead.estimatedKw * 60_000` — a rate that existed nowhere
 * else, so this board valued a lead at one figure, the analytics page valued it
 * at another, and neither matched the quotation the customer received. Hybrid
 * because that is what the great majority of these leads are quoted as; a lead
 * does not record a system type until it becomes an estimate.
 */
function estimatedValue(lead: Lead, pricing: PricingConfig) {
  return systemPrice(lead.estimatedKw, 'hybrid', pricing)
}

export function CrmPipelinePage() {
  const [view, setView] = useState<View>('board')
  const [owner, setOwner] = useState<string>('all')

  const leadsQuery = useLeads()
  const leads = leadsQuery.data ?? []

  const reps = Array.from(new Set(leads.map((l) => l.assignedTo)))
  const visible = owner === 'all' ? leads : leads.filter((l) => l.assignedTo === owner)

  /* Every peso figure on this board is priced from the pricing settings, so
     the value a rep sees here is the value the customer is quoted. */
  const pricing = usePricingConfig()

  /* The pipeline was READ-ONLY. Every lead in the business was listed with a
     score and a stage, and there was no way to move one — the row click opened
     an `alert()` saying a drawer "opens here". A sales screen you cannot sell
     from is a report, not a CRM. */
  const updateStage = useUpdateLeadStage()
  const createLead = useCreateLead()
  const [working, setWorking] = useState<Lead | null>(null)

  /* Stage could be moved but nothing else could be corrected. A lead is
     captured by somebody typing on a phone, so a wrong digit in the mobile
     number is the most common thing in the table — and a lead nobody can ring
     is not a lead. */
  const updateLead = useUpdateLead()
  const [editing, setEditing] = useState<Lead | null>(null)

  /* THE BOARD HAD NO DRAG AND DROP. It rendered columns and cards and nothing
     else — no `draggable`, no handlers — so the obvious gesture did nothing and
     looked broken rather than absent.

     Native HTML5 drag and drop rather than a library: @dnd-kit and
     react-beautiful-dnd are 30-50 KB for a gesture the browser already
     implements, on a page a sales rep opens all day.

     It is an ENHANCEMENT, not the only route. Native drag and drop is
     mouse-only and cannot be operated from a keyboard at all, so the "Move
     stage" action stays on every card and in the table view — that is the
     accessible path, and it is also the one that works on a phone. */
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<LeadStage | null>(null)

  function handleDrop(stage: LeadStage) {
    const id = draggingId
    setDraggingId(null)
    setDropTarget(null)
    if (!id) return

    const lead = leads.find((l) => l.id === id)
    // Dropping a card back where it started is not a change worth a round trip.
    if (!lead || lead.stage === stage) return

    updateStage.mutate({ id, stage })
  }

  function handleEditLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)

    const bill = String(form.get('monthlyBill') ?? '').trim()
    const kw = String(form.get('estimatedKw') ?? '').trim()

    updateLead.mutate(
      {
        id: editing.id,
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        phone: String(form.get('phone') ?? ''),
        location: String(form.get('location') ?? ''),
        address: String(form.get('address') ?? ''),
        monthlyBill: bill ? Number(bill) : null,
        estimatedKw: kw ? Number(kw) : null,
      },
      { onSuccess: () => setEditing(null) },
    )
  }
  const [adding, setAdding] = useState(false)

  const openValue = visible
    .filter((l) => l.stage !== 'installed' && l.stage !== 'lost')
    .reduce((sum, l) => sum + estimatedValue(l, pricing), 0)

  const columns: Column<Lead>[] = [
    {
      header: 'Lead',
      cell: (lead) => (
        <div>
          <div className="strong">{lead.name}</div>
          <div className="xs dim">{lead.location}</div>
        </div>
      ),
    },
    {
      header: 'Score',
      numeric: true,
      cell: (lead) => <Badge tone={scoreTone(lead.score)}>{lead.score}</Badge>,
    },
    {
      header: 'Stage',
      cell: (lead) => (
        <Badge tone={LEAD_STAGE_TONE[lead.stage]}>{LEAD_STAGE_LABEL[lead.stage]}</Badge>
      ),
    },
    { header: 'Source', cell: (lead) => <span className="small">{humanize(lead.source)}</span> },
    { header: 'Monthly bill', numeric: true, cell: (lead) => currency(lead.monthlyBill) },
    { header: 'Est. system', numeric: true, cell: (lead) => `${lead.estimatedKw} kW` },
    {
      header: 'Est. value',
      numeric: true,
      cell: (lead) => currency(estimatedValue(lead, pricing)),
    },
    { header: 'Owner', cell: (lead) => <span className="small">{lead.assignedTo}</span> },
    { header: 'Age', cell: (lead) => <span className="xs dim">{relative(lead.createdAt)}</span> },
    {
      header: '',
      cell: (lead) => (
        <div className="row">
          <Button variant="ghost" size="sm" onClick={() => setEditing(lead)}>
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWorking(lead)}>
            Move stage
          </Button>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Leads & pipeline"
        description="Every prospect from first touch to signed contract."
        actions={
          <>
            <select
              className="select"
              style={{ width: 'auto' }}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            >
              <option value="all">All representatives</option>
              {reps.map((rep) => (
                <option key={rep} value={rep}>
                  {rep}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(datedFilename('leads'), visible, [
                  { header: 'Name', value: (l) => l.name },
                  { header: 'Email', value: (l) => l.email },
                  { header: 'Phone', value: (l) => l.phone },
                  { header: 'Location', value: (l) => l.location },
                  { header: 'Stage', value: (l) => l.stage },
                  { header: 'Score', value: (l) => l.score },
                  { header: 'Source', value: (l) => l.source },
                  { header: 'Monthly bill', value: (l) => l.monthlyBill },
                  { header: 'Estimated kW', value: (l) => l.estimatedKw },
                  { header: 'Owner', value: (l) => l.assignedTo },
                  { header: 'Created', value: (l) => l.createdAt },
                ])
              }
            >
              Export CSV
            </Button>
            <Button variant="primary" onClick={() => setAdding(true)}>
              + Add lead
            </Button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile
          label="Open leads"
          value={String(visible.filter((l) => l.stage !== 'installed').length)}
        />
        <StatTile
          label="Pipeline value"
          value={currencyCompact(openValue)}
          /* Not weighted by probability, whatever the old caption said — it is
             the straight sum of every open lead at list price. */
          delta="Open leads at list price"
        />
        <StatTile
          /* Was "Contracts this month" with a hardcoded "+1 vs last month"
             underneath. Neither was true: the number counts leads sitting at
             the contract stage right now, whenever they got there, and nothing
             anywhere measured last month. A lead records when it was created,
             not when it changed stage, so the honest fix is to label the tile
             with what it actually counts rather than to invent the comparison. */
          label="At contract stage"
          value={String(visible.filter((l) => l.stage === 'contract').length)}
        />
        <StatTile
          label="Avg. lead score"
          value={String(
            Math.round(visible.reduce((s, l) => s + l.score, 0) / (visible.length || 1)),
          )}
        />
      </div>

      <div className="row row--between row--wrap" style={{ marginBottom: 'var(--space-4)' }}>
        <Tabs
          tabs={[
            { value: 'board' as View, label: '▦ Board' },
            { value: 'table' as View, label: '☰ Table' },
          ]}
          active={view}
          onChange={setView}
        />
      </div>

      {/* -------------------------------------------------- BOARD VIEW */}
      {view === 'board' && (
        <div className="kanban">
          {PIPELINE_ORDER.map((stage) => {
            const stageLeads = visible.filter((lead) => lead.stage === stage)
            const stageValue = stageLeads.reduce((sum, l) => sum + estimatedValue(l, pricing), 0)

            return (
              <div
                key={stage}
                className={`kanban__col${dropTarget === stage ? ' is-drop-target' : ''}`}
                /* preventDefault on dragOver is what marks an element as a
                   valid drop target. Without it the browser refuses the drop
                   and shows a "no entry" cursor, which is the single most
                   common reason hand-rolled drag and drop appears broken. */
                onDragOver={(event) => {
                  event.preventDefault()
                  if (dropTarget !== stage) setDropTarget(stage)
                }}
                onDragLeave={(event) => {
                  // Only clear when the pointer leaves the column itself, not
                  // when it crosses onto a card inside it.
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                    setDropTarget((current: LeadStage | null) =>
                      current === stage ? null : current,
                    )
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  handleDrop(stage)
                }}
              >
                <div className="kanban__col-head">
                  <span className="row">
                    <Badge tone={LEAD_STAGE_TONE[stage]}>{LEAD_STAGE_LABEL[stage]}</Badge>
                    <span className="dim">{stageLeads.length}</span>
                  </span>
                  <span className="xs dim num">{currencyCompact(stageValue)}</span>
                </div>

                {stageLeads.map((lead) => (
                  <article
                    key={lead.id}
                    className={`kanban__card${draggingId === lead.id ? ' is-dragging' : ''}`}
                    draggable
                    onDragStart={(event) => {
                      setDraggingId(lead.id)
                      event.dataTransfer.effectAllowed = 'move'
                      /* Firefox will not start a drag unless some data is set,
                         even when the id is tracked in React state. */
                      event.dataTransfer.setData('text/plain', lead.id)
                    }}
                    onDragEnd={() => {
                      setDraggingId(null)
                      setDropTarget(null)
                    }}
                  >
                    <div className="row row--between">
                      <span className="strong small">{lead.name}</span>
                      <Badge tone={scoreTone(lead.score)}>{lead.score}</Badge>
                    </div>
                    <div className="xs dim" style={{ marginTop: 4 }}>
                      📍 {lead.location}
                    </div>
                    <div className="xs dim">
                      ⚡ {lead.estimatedKw} kW · {currency(lead.monthlyBill)}/mo
                    </div>
                    <div
                      className="row row--between xs dim"
                      style={{
                        marginTop: 'var(--space-2)',
                        paddingTop: 'var(--space-2)',
                        borderTop: '1px solid var(--border)',
                      }}
                    >
                      <span>{lead.assignedTo}</span>
                      <span>{relative(lead.createdAt)}</span>
                    </div>

                    {/* The accessible equivalent of the drag. Native drag and
                        drop cannot be operated from a keyboard, and does not
                        work by touch at all — so this is not a fallback, it is
                        the route most people on this board will actually use. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      block
                      style={{ marginTop: 'var(--space-2)' }}
                      onClick={() => setWorking(lead)}
                    >
                      Move stage
                    </Button>
                  </article>
                ))}

                {stageLeads.length === 0 && (
                  <p className="xs dim center" style={{ padding: 'var(--space-4)' }}>
                    Drop a lead here
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* -------------------------------------------------- TABLE VIEW */}
      {view === 'table' && (
        <QueryState
          isLoading={leadsQuery.isLoading}
          error={leadsQuery.error as Error | null}
          emptyIcon="&#128100;"
          emptyTitle="No leads yet"
          emptyMessage="The public estimator and contact form feed this board."
        >
          <DataTable
            columns={columns}
            rows={[...visible].sort((a, b) => b.score - a.score)}
            rowKey={(lead) => lead.id}
            onRowClick={(lead) => setWorking(lead)}
          />
        </QueryState>
      )}

      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardBody>
          <h4>How lead scoring works</h4>
          <p className="small muted" style={{ marginTop: 'var(--space-2)', maxWidth: '80ch' }}>
            The 0–100 score weights monthly bill size, whether a roof area was supplied, source
            quality (a referral outranks an anonymous estimator submission), service-area proximity,
            and how quickly the prospect responded. Scores above 85 should be contacted the same
            day. The weighting lives in one place so sales management can tune it without a code
            change.
          </p>
        </CardBody>
      </Card>

      {/* ------------------------------------------------ MOVE A LEAD */}
      <Modal
        open={working !== null}
        onClose={() => setWorking(null)}
        title={working ? `${working.name} · ${working.location}` : 'Lead'}
      >
        {working && (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              updateStage.mutate(
                {
                  id: working.id,
                  stage: String(form.get('stage')) as Lead['stage'],
                  lostReason: String(form.get('lostReason') ?? ''),
                },
                { onSuccess: () => setWorking(null) },
              )
            }}
          >
            <div
              className="stack stack--sm"
              style={{
                padding: 'var(--space-3)',
                background: 'var(--ink-50)',
                borderRadius: 'var(--radius)',
              }}
            >
              <div className="row row--between">
                <span className="muted small">Score</span>
                <span className="small strong">{working.score}</span>
              </div>
              <div className="row row--between">
                <span className="muted small">Monthly bill</span>
                <span className="small strong">{currency(working.monthlyBill)}</span>
              </div>
              <div className="row row--between">
                <span className="muted small">Estimated system</span>
                <span className="small strong">{working.estimatedKw} kW</span>
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="lead-stage">
                Move to
              </label>
              <select id="lead-stage" name="stage" className="select" defaultValue={working.stage}>
                <option value="new">New</option>
                <option value="quoted">Quoted</option>
                <option value="site_visit">Site visit</option>
                <option value="contract">Contract</option>
                <option value="installed">Installed</option>
                <option value="lost">Lost</option>
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="lead-lost">
                If lost, why?
              </label>
              <input
                id="lead-lost"
                name="lostReason"
                className="input"
                placeholder="Price, timing, went with a competitor…"
              />
              <span className="field__hint">
                The database refuses to mark a lead lost without a reason — otherwise &ldquo;why did
                we lose it?&rdquo; is unanswerable at exactly the review meeting where it matters.
              </span>
            </div>

            <FormError error={updateStage.error} />

            <Button type="submit" variant="primary" block disabled={updateStage.isPending}>
              {updateStage.isPending ? 'Saving…' : 'Save'}
            </Button>
          </form>
        )}
      </Modal>

      {/* --------------------------------------------- ADD A WALK-IN */}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a lead by hand">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            createLead.mutate(
              {
                name: String(form.get('name') ?? ''),
                email: String(form.get('email') ?? ''),
                phone: String(form.get('phone') ?? ''),
                location: String(form.get('location') ?? ''),
                monthlyBill: form.get('bill') ? Number(form.get('bill')) : undefined,
                source: 'walk_in',
              },
              { onSuccess: () => setAdding(false) },
            )
          }}
        >
          <p className="small muted">
            For a walk-in or a referral. Anything that arrives through the website lands here on its
            own.
          </p>

          <div className="field">
            <label className="field__label" htmlFor="new-lead-name">
              Name
            </label>
            <input id="new-lead-name" name="name" className="input" required />
          </div>
          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="new-lead-email">
                Email
              </label>
              <input id="new-lead-email" name="email" className="input" type="email" required />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="new-lead-phone">
                Mobile
              </label>
              <input id="new-lead-phone" name="phone" className="input" />
            </div>
          </div>
          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="new-lead-location">
                Location
              </label>
              <input id="new-lead-location" name="location" className="input" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="field__label" htmlFor="new-lead-bill">
                Monthly bill
              </label>
              <input id="new-lead-bill" name="bill" className="input" type="number" min="0" />
            </div>
          </div>

          <FormError error={createLead.error} />

          <Button type="submit" variant="primary" block disabled={createLead.isPending}>
            {createLead.isPending ? 'Adding…' : 'Add lead'}
          </Button>
        </form>
      </Modal>

      {/* --------------------------------------------------- EDIT A LEAD */}
      <Modal
        open={editing !== null}
        onClose={() => {
          setEditing(null)
          updateLead.reset()
        }}
        title={editing ? `Edit · ${editing.name}` : 'Edit lead'}
      >
        {editing && (
          <form className="stack" onSubmit={handleEditLead}>
            <div className="field">
              <label className="field__label" htmlFor="lead-name">
                Name
              </label>
              <input
                id="lead-name"
                name="name"
                className="input"
                required
                defaultValue={editing.name}
              />
            </div>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="lead-email">
                  Email
                </label>
                <input
                  id="lead-email"
                  name="email"
                  className="input"
                  type="email"
                  required
                  defaultValue={editing.email}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="lead-phone">
                  Mobile
                </label>
                <input
                  id="lead-phone"
                  name="phone"
                  className="input"
                  placeholder="+63 9XX XXX XXXX"
                  defaultValue={editing.phone}
                />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="lead-location">
                Area
              </label>
              <input
                id="lead-location"
                name="location"
                className="input"
                defaultValue={editing.location}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="lead-address">
                Full address <span className="dim">(for the survey)</span>
              </label>
              <input id="lead-address" name="address" className="input" />
              <span className="field__hint">
                Leave blank to keep what is on file. The surveyor needs enough to find the roof.
              </span>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="lead-bill">
                  Monthly bill
                </label>
                <input
                  id="lead-bill"
                  name="monthlyBill"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={editing.monthlyBill || ''}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="field__label" htmlFor="lead-kw">
                  Estimated system
                </label>
                <input
                  id="lead-kw"
                  name="estimatedKw"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={editing.estimatedKw || ''}
                />
              </div>
            </div>

            <FormError error={updateLead.error} />

            <Button type="submit" variant="primary" block disabled={updateLead.isPending}>
              {updateLead.isPending ? 'Saving…' : 'Save changes'}
            </Button>

            <p className="xs dim">
              Stage and score are not edited here. Stage has its own action because moving it has
              consequences, and the score is recomputed by the database from the figures above.
            </p>
          </form>
        )}
      </Modal>
    </>
  )
}
