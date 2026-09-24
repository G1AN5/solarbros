import { useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { QueryState } from '@/components/ui/QueryState'
import { currency } from '@/lib/format'
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
import type { SystemType } from '@/types/domain'

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
}

export function PackagesEditor() {
  const packagesQuery = useAdminPackages()
  const savePackage = useSavePackage()
  const deletePackage = useDeletePackage()

  const [draft, setDraft] = useState(EMPTY_PACKAGE)
  const [editingId, setEditingId] = useState<string | null>(null)

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
              {(packagesQuery.data ?? []).map((pkg) => (
                <div key={pkg.id} className="row row--between">
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <span className="small strong">{pkg.name}</span>
                      {pkg.featured && <Badge tone="brand">Popular</Badge>}
                      {!pkg.isActive && <Badge tone="neutral">Hidden</Badge>}
                    </div>
                    <div className="xs dim">
                      {pkg.sizeKw} kWp · {currency(pkg.priceFrom)} · {pkg.segment}
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
