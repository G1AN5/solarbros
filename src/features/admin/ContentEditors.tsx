import { useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { QueryState } from '@/components/ui/QueryState'
import { bomGaps, suggestBom, type PackageBomLine } from '@/lib/bom'
import { currency } from '@/lib/format'
import { STOCK_CATEGORY_LABEL } from '@/lib/labels'
import {
  useAdminFaqs,
  useAdminPackages,
  useDeleteFaq,
  useDeletePackage,
  useLegalDocuments,
  useSaveFaq,
  useSaveLegalDocument,
  useSavePackage,
  type EditableFaq,
  type EditablePackage,
  type LegalSection,
} from '@/lib/queries/cms'
import { useStock } from '@/lib/queries/inventory-finance'
import { settingNum, useSettings, useSystemAssumptions } from '@/lib/queries/settings'
import type { StockCategory, SystemType } from '@/types/domain'

/* ============================================================================
   THE THREE EDITORS THAT WERE MISSING
   ----------------------------------------------------------------------------
   Packages, the FAQ and the legal pages. The database has allowed staff to
   write all three since the schema was built; there was simply no screen, so
   the only way to add a package or fix an answer was to open the SQL editor.

   ONE FORM, TWO JOBS. Each editor uses the same form for adding and editing —
   picking a row fills it, "Cancel" empties it. Two separate forms would be two
   places for a field to go missing.
   ========================================================================== */

const SYSTEM_TYPES: SystemType[] = ['on_grid', 'hybrid', 'off_grid']

const EMPTY_PACKAGE = {
  name: '',
  systemType: 'hybrid' as SystemType,
  sizeKw: 6.2,
  priceFrom: 378000,
  segment: 'residential' as 'residential' | 'commercial',
  featured: false,
  idealFor: '',
  inclusions: '',
  isActive: true,
  sortOrder: 0,
  bom: [] as PackageBomLine[],
}

/* ============================================================================
   WHAT THE PACKAGE IS MADE OF
   ----------------------------------------------------------------------------
   The equipment a package is sold with, as catalogue items and quantities.
   Choosing the package in the quotation builder starts the bill of materials
   from this list (still editable for the customer in front of you), and from
   the quotation on it is what gets reserved, bought, installed and scanned.

   "Fill from the sizing rules" drafts it the way the builder would; the
   price line below shows what the list costs at the usual margin, against
   the "from" price the website advertises.
   ========================================================================== */

function PackageBomEditor({
  lines,
  onChange,
  systemType,
  sizeKw,
  priceFrom,
}: {
  lines: PackageBomLine[]
  onChange: (lines: PackageBomLine[]) => void
  systemType: SystemType
  sizeKw: number
  priceFrom: number
}) {
  const stock = useStock().data ?? []
  const settings = useSettings().data
  const hardware = useSystemAssumptions()
  const [addItemId, setAddItemId] = useState('')

  const rows = lines.map((line) => ({
    ...line,
    item: stock.find((s) => s.id === line.stockItemId),
  }))
  const materialCost = rows.reduce(
    (sum, row) => sum + (row.item ? row.item.unitCost * row.quantity : 0),
    0,
  )
  const labourPct = settingNum(settings, 'pricing.labour_overhead_pct', 18)
  const margin = settingNum(settings, 'pricing.default_margin_pct', 35)
  const pricedAt = (materialCost * (1 + labourPct / 100)) / (1 - margin / 100)
  const gaps =
    lines.length > 0
      ? bomGaps(
          systemType,
          rows.flatMap((row) => (row.item ? [row.item.category] : [])),
        )
      : []

  function fillFromRules() {
    const draft = suggestBom({
      systemKw: sizeKw,
      systemType,
      stock,
      panelWatts: hardware.panelWatts,
      batteryKwh: hardware.batteryKwh,
      batteriesIncluded: settingNum(settings, 'pricing.batteries_included', 3),
    })
    onChange(draft.lines.map(({ stockItemId, quantity }) => ({ stockItemId, quantity })))
  }

  return (
    <div className="pkg-bom">
      <div className="row row--between row--wrap" style={{ gap: 'var(--space-2)' }}>
        <span className="field__label" style={{ margin: 0 }}>
          Equipment list (bill of materials)
        </span>
        <span className="row" style={{ gap: 'var(--space-2)' }}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={stock.length === 0 || !(sizeKw > 0)}
            onClick={() => {
              if (
                lines.length === 0 ||
                window.confirm('Replace the list with one drafted from the sizing rules?')
              ) {
                fillFromRules()
              }
            }}
          >
            Fill from the sizing rules
          </Button>
          {lines.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>
              Clear
            </Button>
          )}
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="xs dim" style={{ margin: 0 }}>
          Nothing listed. Until there is, quoting this package drafts the equipment from the sizing
          rules each time.
        </p>
      ) : (
        <div className="stack stack--sm">
          {rows.map((row, index) => (
            <div key={`${row.stockItemId}-${index}`} className="pkg-bom__line">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="small strong">{row.item?.name ?? 'No longer in the catalogue'}</div>
                <div className="xs dim">
                  {row.item
                    ? `${STOCK_CATEGORY_LABEL[row.item.category]} · ${row.item.sku} · ${currency(row.item.unitCost)} per ${row.item.unit}`
                    : 'Skipped when quoting. Remove it, or add its replacement.'}
                </div>
              </div>
              <input
                className="input"
                type="number"
                min={0.01}
                step="any"
                value={row.quantity}
                onChange={(e) => {
                  const quantity = Number(e.target.value)
                  onChange(
                    lines.map((line, i) =>
                      i === index ? { ...line, quantity: quantity > 0 ? quantity : 1 } : line,
                    ),
                  )
                }}
                style={{ width: 84 }}
                aria-label={`Quantity of ${row.item?.name ?? 'this item'}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
                aria-label={`Remove ${row.item?.name ?? 'this item'}`}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <select
          className="select"
          value={addItemId}
          onChange={(e) => setAddItemId(e.target.value)}
          aria-label="Add an item to the package"
        >
          <option value="">Add an item from the catalogue…</option>
          {(Object.keys(STOCK_CATEGORY_LABEL) as StockCategory[]).map((category) => {
            const items = stock.filter(
              (s) => s.category === category && !lines.some((l) => l.stockItemId === s.id),
            )
            return items.length > 0 ? (
              <optgroup key={category} label={STOCK_CATEGORY_LABEL[category]}>
                {items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ) : null
          })}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={!addItemId}
          onClick={() => {
            onChange([...lines, { stockItemId: addItemId, quantity: 1 }])
            setAddItemId('')
          }}
        >
          Add
        </Button>
      </div>

      {gaps.length > 0 && (
        <div className="pkg-bom__warning small">
          {gaps.map((gap) => (
            <div key={gap}>⚠ {gap}</div>
          ))}
        </div>
      )}

      {materialCost > 0 && (
        <p className="xs dim" style={{ margin: 0 }}>
          Equipment {currency(materialCost)}. With labour ({labourPct}%) at the usual {margin}%
          margin it prices at about <strong>{currency(pricedAt)}</strong>
          {priceFrom > 0 &&
            `; the website says from ${currency(priceFrom)}${
              pricedAt > priceFrom * 1.05 ? ', so the advertised price may be too low' : ''
            }`}
          .
        </p>
      )}
    </div>
  )
}

export function PackagesEditor() {
  const packagesQuery = useAdminPackages()
  const savePackage = useSavePackage()
  const deletePackage = useDeletePackage()

  const [draft, setDraft] = useState(EMPTY_PACKAGE)
  const [editingId, setEditingId] = useState<string | null>(null)
  const packages = packagesQuery.data ?? []
  const bomSupported = packages.length === 0 || packages.some((pkg) => pkg.bom !== null)

  function startEdit(pkg: EditablePackage) {
    setEditingId(pkg.id)
    setDraft({
      name: pkg.name,
      systemType: pkg.systemType,
      sizeKw: pkg.sizeKw,
      priceFrom: pkg.priceFrom,
      segment: pkg.segment,
      featured: pkg.featured,
      idealFor: pkg.idealFor ?? '',
      // One inclusion per line is the only editor anybody needs for a short
      // list, and it is impossible to get wrong.
      inclusions: pkg.inclusions.join('\n'),
      isActive: pkg.isActive,
      sortOrder: pkg.sortOrder,
      bom: pkg.bom ?? [],
    })
  }

  function reset() {
    setEditingId(null)
    setDraft(EMPTY_PACKAGE)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    savePackage.mutate(
      {
        ...(editingId ? { id: editingId } : {}),
        name: draft.name,
        systemType: draft.systemType,
        sizeKw: Number(draft.sizeKw),
        priceFrom: Number(draft.priceFrom),
        segment: draft.segment,
        featured: draft.featured,
        idealFor: draft.idealFor,
        inclusions: draft.inclusions.split('\n'),
        isActive: draft.isActive,
        sortOrder: Number(draft.sortOrder),
        // Sent only where the database can keep it (migration 0079).
        ...(bomSupported ? { bom: draft.bom } : {}),
      },
      { onSuccess: reset },
    )
  }

  return (
    <div className="grid grid--2" style={{ alignItems: 'start' }}>
      <Card>
        <CardHeader
          title={editingId ? 'Edit package' : 'Add a package'}
          action={
            editingId && (
              <Button variant="ghost" size="sm" onClick={reset}>
                Cancel
              </Button>
            )
          }
        />
        <CardBody>
          <FormError error={savePackage.error ?? deletePackage.error} />

          <form onSubmit={handleSubmit} className="stack">
            <div className="field">
              <label className="field__label" htmlFor="pkgName">
                Name
              </label>
              <input
                id="pkgName"
                className="input"
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. 6kW Hybrid"
              />
            </div>

            <div className="grid grid--2">
              <div className="field">
                <label className="field__label" htmlFor="pkgType">
                  System type
                </label>
                <select
                  id="pkgType"
                  className="select"
                  value={draft.systemType}
                  onChange={(e) => setDraft({ ...draft, systemType: e.target.value as SystemType })}
                >
                  {SYSTEM_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.replace('_', '-')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="pkgSegment">
                  Segment
                </label>
                <select
                  id="pkgSegment"
                  className="select"
                  value={draft.segment}
                  onChange={(e) =>
                    setDraft({ ...draft, segment: e.target.value as 'residential' | 'commercial' })
                  }
                >
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                </select>
              </div>
            </div>

            <div className="grid grid--2">
              <div className="field">
                <label className="field__label" htmlFor="pkgSize">
                  Array size (kWp)
                </label>
                <input
                  id="pkgSize"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0.1"
                  required
                  value={draft.sizeKw}
                  onChange={(e) => setDraft({ ...draft, sizeKw: Number(e.target.value) })}
                />
                {/* The real figure, not the marketing name — everything
                    downstream sizes against it. */}
                <p className="xs dim" style={{ marginTop: 'var(--space-1)' }}>
                  Panel count × panel watts. A “6kW” of 10 × 620 W is 6.2.
                </p>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="pkgPrice">
                  Price from (PHP)
                </label>
                <input
                  id="pkgPrice"
                  className="input"
                  type="number"
                  step="1000"
                  min="0"
                  required
                  value={draft.priceFrom}
                  onChange={(e) => setDraft({ ...draft, priceFrom: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="pkgIdeal">
                Ideal for
              </label>
              <input
                id="pkgIdeal"
                className="input"
                maxLength={160}
                value={draft.idealFor}
                onChange={(e) => setDraft({ ...draft, idealFor: e.target.value })}
                placeholder="e.g. The most common choice for a Filipino family home."
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="pkgInclusions">
                What is included — one per line
              </label>
              <textarea
                id="pkgInclusions"
                className="textarea"
                rows={5}
                value={draft.inclusions}
                onChange={(e) => setDraft({ ...draft, inclusions: e.target.value })}
                placeholder={
                  '10 × 620W bifacial panels\n16 kWh battery storage\nDesign, permits and installation'
                }
              />
            </div>

            {bomSupported ? (
              <PackageBomEditor
                lines={draft.bom}
                onChange={(bom) => setDraft({ ...draft, bom })}
                systemType={draft.systemType}
                sizeKw={Number(draft.sizeKw)}
                priceFrom={Number(draft.priceFrom)}
              />
            ) : (
              <p className="xs dim">
                Equipment lists for packages need the latest database update (migration 0079). Run{' '}
                <code>npx supabase db push</code>, then reload this page.
              </p>
            )}

            <div className="grid grid--2">
              <div className="field">
                <label className="field__label" htmlFor="pkgOrder">
                  Position on the page
                </label>
                <input
                  id="pkgOrder"
                  className="input"
                  type="number"
                  value={draft.sortOrder}
                  onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                />
              </div>
              <div className="stack stack--sm" style={{ justifyContent: 'flex-end' }}>
                <label className="row" style={{ gap: 'var(--space-2)' }}>
                  <input
                    type="checkbox"
                    checked={draft.featured}
                    onChange={(e) => setDraft({ ...draft, featured: e.target.checked })}
                  />
                  <span className="small">Mark as “Most popular”</span>
                </label>
                <label className="row" style={{ gap: 'var(--space-2)' }}>
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                  />
                  <span className="small">Show on the website</span>
                </label>
              </div>
            </div>

            <Button type="submit" variant="primary" disabled={savePackage.isPending}>
              {savePackage.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Add package'}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Published range" />
        <CardBody>
          <QueryState
            isLoading={packagesQuery.isLoading}
            error={packagesQuery.error as Error | null}
            isEmpty={(packagesQuery.data?.length ?? 0) === 0}
            emptyTitle="No packages yet"
            emptyMessage="Add one and it appears on the public packages page immediately."
          >
            <div className="stack stack--sm">
              {packages.map((pkg) => (
                <div key={pkg.id} className="row row--between">
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <span className="small strong">{pkg.name}</span>
                      {pkg.featured && <Badge tone="brand">Popular</Badge>}
                      {!pkg.isActive && <Badge tone="neutral">Hidden</Badge>}
                    </div>
                    <div className="xs dim">
                      {pkg.sizeKw} kWp · {currency(pkg.priceFrom)} · {pkg.segment}
                      {pkg.bom &&
                        (pkg.bom.length > 0
                          ? ` · ${pkg.bom.length} item${pkg.bom.length === 1 ? '' : 's'} listed`
                          : ' · no equipment list')}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 'var(--space-2)' }}>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(pkg)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deletePackage.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove “${pkg.name}” from the website?`)) {
                          deletePackage.mutate(pkg.id)
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </QueryState>
        </CardBody>
      </Card>
    </div>
  )
}

/* ========================================================================== */

const EMPTY_FAQ = {
  question: '',
  answer: '',
  category: 'General',
  sortOrder: 0,
  published: true,
}

export function FaqEditor() {
  const faqsQuery = useAdminFaqs()
  const saveFaq = useSaveFaq()
  const deleteFaq = useDeleteFaq()

  const [draft, setDraft] = useState(EMPTY_FAQ)
  const [editingId, setEditingId] = useState<string | null>(null)

  function startEdit(faq: EditableFaq) {
    setEditingId(faq.id)
    setDraft({
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      sortOrder: faq.sortOrder,
      published: faq.published,
    })
  }

  function reset() {
    setEditingId(null)
    setDraft(EMPTY_FAQ)
  }

  return (
    <div className="grid grid--2" style={{ alignItems: 'start' }}>
      <Card>
        <CardHeader
          title={editingId ? 'Edit question' : 'Add a question'}
          action={
            editingId && (
              <Button variant="ghost" size="sm" onClick={reset}>
                Cancel
              </Button>
            )
          }
        />
        <CardBody>
          <FormError error={saveFaq.error ?? deleteFaq.error} />

          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              saveFaq.mutate(
                { ...(editingId ? { id: editingId } : {}), ...draft },
                { onSuccess: reset },
              )
            }}
          >
            <div className="field">
              <label className="field__label" htmlFor="faqQ">
                Question
              </label>
              <input
                id="faqQ"
                className="input"
                required
                maxLength={200}
                value={draft.question}
                onChange={(e) => setDraft({ ...draft, question: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="faqA">
                Answer
              </label>
              <textarea
                id="faqA"
                className="textarea"
                rows={6}
                required
                value={draft.answer}
                onChange={(e) => setDraft({ ...draft, answer: e.target.value })}
              />
            </div>

            <div className="grid grid--2">
              <div className="field">
                <label className="field__label" htmlFor="faqCat">
                  Category
                </label>
                <input
                  id="faqCat"
                  className="input"
                  maxLength={40}
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  placeholder="Savings, Systems, Process…"
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="faqOrder">
                  Position
                </label>
                <input
                  id="faqOrder"
                  className="input"
                  type="number"
                  value={draft.sortOrder}
                  onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                />
              </div>
            </div>

            <label className="row" style={{ gap: 'var(--space-2)' }}>
              <input
                type="checkbox"
                checked={draft.published}
                onChange={(e) => setDraft({ ...draft, published: e.target.checked })}
              />
              <span className="small">Show on the website</span>
            </label>

            <Button type="submit" variant="primary" disabled={saveFaq.isPending}>
              {saveFaq.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Add question'}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Published questions" />
        <CardBody>
          <QueryState
            isLoading={faqsQuery.isLoading}
            error={faqsQuery.error as Error | null}
            isEmpty={(faqsQuery.data?.length ?? 0) === 0}
            emptyTitle="No questions yet"
            emptyMessage="The FAQ section is hidden on the home page until there is at least one."
          >
            <div className="stack stack--sm">
              {(faqsQuery.data ?? []).map((faq) => (
                <div key={faq.id} className="row row--between">
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <span className="small strong">{faq.question}</span>
                      {!faq.published && <Badge tone="neutral">Hidden</Badge>}
                    </div>
                    <div className="xs dim">{faq.category}</div>
                  </div>
                  <div className="row" style={{ gap: 'var(--space-2)' }}>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(faq)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deleteFaq.isPending}
                      onClick={() => {
                        if (window.confirm('Delete this question?')) deleteFaq.mutate(faq.id)
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </QueryState>
        </CardBody>
      </Card>
    </div>
  )
}

/* ========================================================================== */

export function LegalEditor() {
  const legalQuery = useLegalDocuments()
  const saveLegal = useSaveLegalDocument()

  const [slug, setSlug] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [sections, setSections] = useState<LegalSection[]>([])

  const documents = legalQuery.data ?? []
  const current = documents.find((d) => d.slug === slug)

  function open(documentSlug: string) {
    const doc = documents.find((d) => d.slug === documentSlug)
    if (!doc) return
    setSlug(doc.slug)
    setTitle(doc.title)
    // Copied, not referenced, so cancelling leaves the original untouched.
    setSections(doc.sections.map((s) => ({ ...s })))
  }

  function updateSection(index: number, patch: Partial<LegalSection>) {
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  return (
    <div className="stack">
      <Card>
        <CardHeader title="Legal pages" />
        <CardBody>
          <p className="small muted">
            These are the pages linked in the footer. They were built into the application code,
            which meant publishing wording from your lawyer required a developer — on the one kind
            of text nobody should be paraphrasing. Editing here publishes immediately.
          </p>

          <FormError error={saveLegal.error} />

          <div
            className="row row--wrap"
            style={{ gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}
          >
            {documents.map((doc) => (
              <Button
                key={doc.slug}
                variant={doc.slug === slug ? 'primary' : 'outline'}
                size="sm"
                onClick={() => open(doc.slug)}
              >
                {doc.title}
              </Button>
            ))}
          </div>
        </CardBody>
      </Card>

      {current && (
        <Card>
          <CardHeader
            title={`Editing: ${current.title}`}
            action={
              <Button variant="ghost" size="sm" onClick={() => setSlug(null)}>
                Close
              </Button>
            }
          />
          <CardBody>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault()
                saveLegal.mutate({ slug: current.slug, title, sections })
              }}
            >
              <div className="field">
                <label className="field__label" htmlFor="legalTitle">
                  Page title
                </label>
                <input
                  id="legalTitle"
                  className="input"
                  required
                  maxLength={120}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              {sections.map((section, index) => (
                <Card key={index}>
                  <CardBody>
                    <div className="field">
                      <label className="field__label" htmlFor={`sh-${index}`}>
                        Section heading
                      </label>
                      <input
                        id={`sh-${index}`}
                        className="input"
                        maxLength={120}
                        value={section.heading}
                        onChange={(e) => updateSection(index, { heading: e.target.value })}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label className="field__label" htmlFor={`sb-${index}`}>
                        Text
                      </label>
                      <textarea
                        id={`sb-${index}`}
                        className="textarea"
                        rows={5}
                        value={section.body}
                        onChange={(e) => updateSection(index, { body: e.target.value })}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      style={{ marginTop: 'var(--space-2)' }}
                      onClick={() => setSections((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove this section
                    </Button>
                  </CardBody>
                </Card>
              ))}

              <div className="row" style={{ gap: 'var(--space-2)' }}>
                <Button
                  variant="outline"
                  onClick={() => setSections((prev) => [...prev, { heading: '', body: '' }])}
                >
                  Add a section
                </Button>
                <Button type="submit" variant="primary" disabled={saveLegal.isPending}>
                  {saveLegal.isPending ? 'Publishing…' : 'Publish changes'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
