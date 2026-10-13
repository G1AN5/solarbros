import { useRef, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Tabs } from '@/components/ui/Tabs'
import {
  useJobMaterials,
  useLogMaterials,
  useMyJobs,
  useProjectSerials,
  useScanSerial,
} from '@/lib/queries/field'
import { useStock } from '@/lib/queries/inventory-finance'
import { useCompany } from '@/lib/queries/public-site'
import { useProjectPhotoCategories, useUploadSitePhoto } from '@/lib/queries/storage'
import type { StockItem } from '@/types/domain'

/* ============================================================================
   FieldLoggingPage — Media & Hardware Logging.
   ----------------------------------------------------------------------------
   Three capture tools that all write back into the office systems:

     PHOTOS    → geotagged + timestamped, stored against the project.
                 Appear in the client's portal and in the inspection report.
                 Geotagging matters: it proves the photo was taken at the site
                 on the day claimed, which settles warranty disputes years on.

     SERIALS   → barcode scan of each panel / inverter / battery.
                 Creates rows in the ASSET REGISTRY (/admin/assets), which is
                 what makes warranty claims and recalls possible.

     MATERIALS → what was actually consumed on site.
                 Deducts from INVENTORY (/admin/inventory) — a real event tied
                 to a real job, not a monthly stock-take guess.

   All three must queue offline. A technician on a rural roof has no signal, and
   asking them to re-enter twenty serial numbers later guarantees it never
   happens.
   ========================================================================== */

type Tool = 'photos' | 'serials' | 'materials'

const PHOTO_CATEGORIES = [
  'Roof condition (before)',
  'Racking installed',
  'Panels mounted',
  'DC combiner / wiring',
  'Inverter installation',
  'AC connection point',
  'Completed system',
  'Site cleaned (after)',
]

export function FieldLoggingPage() {
  const stockQuery = useStock()
  const STOCK = stockQuery.data ?? []

  const [tool, setTool] = useState<Tool>('photos')
  const [scanInput, setScanInput] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [logged, setLogged] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  /* WHICH JOB IS THIS FOR?
     Every one of these three tools writes against a PROJECT — a serial number
     belongs to an installation, consumed stock is deducted against a job. The
     page had no job context at all, which is part of why none of it was wired:
     there was nothing to attach the writes to.

     The technician's assigned job for today supplies it. With several jobs they
     pick; with one it is chosen for them. */
  const jobs = useMyJobs().data ?? []
  const jobsWithProject = jobs.filter((job) => job.projectId)
  const [jobId, setJobId] = useState<string>('')
  const activeJob = jobsWithProject.find((j) => j.id === jobId) ?? jobsWithProject[0]

  const scanSerial = useScanSerial()
  const logMaterials = useLogMaterials()
  const uploadPhoto = useUploadSitePhoto()

  /* The real registry, not a hardcoded pair. This list used to show two
     invented serials and count them "2 of 14" forever. */
  const serials = useProjectSerials(activeJob?.projectId).data ?? []

  /* WHICH of the eight required photographs this capture is. The upload has
     always accepted a category and the page never sent one, so every photo was
     filed with `photo_category` null and the checklist below could not have
     been real even in principle. */
  const [photoCategory, setPhotoCategory] = useState(PHOTO_CATEGORIES[0])

  /* WHAT the serial belongs to. Every asset was filed as the literal string
     "Scanned on site", so the admin asset registry listed a column of identical
     product names and the customer's warranty page could not tell them whether
     a serial was their inverter or a panel. The technician knows what is in
     their hand; nothing was asking. */
  const [serialItemId, setSerialItemId] = useState('')
  const capturedCategories = useProjectPhotoCategories(activeJob?.projectId).data ?? []

  /* What this job is meant to use — its bill of materials as the warehouse
     holds it. Materials are logged against these, and anything else the crew
     had to use can be added from the catalogue below. */
  const materials = useJobMaterials(activeJob?.projectId).data ?? []
  const [extraItemId, setExtraItemId] = useState('')
  const [extraLines, setExtraLines] = useState<string[]>([])

  /* Only equipment that carries a serial is worth a serial. The list used to
     offer every catalogue line — mid clamps and metres of cable included —
     so a panel serial could be filed against a roll of wire. Items on this
     job's bill of materials come first. */
  const onThisJob = new Set(materials.filter((m) => m.isSerialised).map((m) => m.stockItemId))
  const serialisable = STOCK.filter((s) => s.isSerialised).sort(
    (a, b) => Number(onThisJob.has(b.id)) - Number(onThisJob.has(a.id)),
  )
  const serialsExpected = materials
    .filter((m) => m.isSerialised)
    .reduce((sum, m) => sum + m.planned, 0)

  /* The warranty term comes from the equipment, and the company's published
     terms — not a flat ten years for everything, which promised an inverter
     double the warranty it actually carries. */
  const company = useCompany()
  function warrantyYearsFor(item: StockItem | undefined): number {
    switch (item?.category) {
      case 'panel':
        return company.warrantyPanelYears
      case 'inverter':
      case 'charge_controller':
        return company.warrantyInverterYears
      case 'battery':
        return company.warrantyBatteryYears
      default:
        return company.warrantyWorkmanshipYears
    }
  }

  function addSerial(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = scanInput.trim()
    if (!trimmed || !activeJob?.projectId) return

    const serialItem = STOCK.find((s) => s.id === serialItemId)

    scanSerial.mutate(
      {
        serialNumber: trimmed,
        productName: serialItem?.name ?? 'Unspecified equipment',
        stockItemId: serialItem?.id,
        projectId: activeJob.projectId,
        clientId: activeJob.clientId,
        warrantyYears: warrantyYearsFor(serialItem),
      },
      {
        onSuccess: (result) => {
          setScanInput('')
          setLogged(
            result?.queued
              ? `Serial ${trimmed.toUpperCase()} saved on this phone — it will sync when you have signal`
              : `Serial ${trimmed.toUpperCase()} recorded`,
          )
        },
      },
    )
  }

  function submitMaterials() {
    if (!activeJob?.projectId) return
    const entries = Object.entries(quantities).filter(([, qty]) => qty > 0)
    if (entries.length === 0) return

    for (const [stockItemId, quantity] of entries) {
      const item = STOCK.find((s) => s.id === stockItemId)
      logMaterials.mutate({
        projectId: activeJob.projectId,
        stockItemId,
        itemName: item?.name ?? 'Material',
        quantity,
      })
    }
    setQuantities({})
    setExtraLines([])
    setLogged(`${entries.length} material line(s) logged`)
  }

  function handlePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file || !activeJob?.projectId) return

    /* Geolocation is requested but never waited on indefinitely — a technician
       inside a plant room may never get a fix, and the photo matters more than
       the coordinates. */
    navigator.geolocation?.getCurrentPosition(
      (position) => {
        uploadPhoto.mutate({
          file,
          projectId: activeJob.projectId!,
          appointmentId: activeJob.id,
          category: photoCategory,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        setLogged('Photo uploaded with location')
      },
      () => {
        uploadPhoto.mutate({
          file,
          projectId: activeJob.projectId!,
          appointmentId: activeJob.id,
          category: photoCategory,
        })
        setLogged('Photo uploaded (no location available)')
      },
      { timeout: 5000 },
    )
    event.target.value = ''
  }

  return (
    <div className="stack">
      <div>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Logging</h1>
        <p className="small muted">Photos, serial numbers and consumed materials.</p>
      </div>

      {jobsWithProject.length === 0 ? (
        /* EVERY CONTROL BELOW IS DISABLED IN THIS STATE, and previously
           nothing said so. A photo, a serial and a material line all have to
           attach to a project, so with no job assigned the buttons do nothing
           when tapped — which reads as the camera being broken rather than as
           there being no job. */
        <Card style={{ borderColor: 'var(--warning-solid)' }}>
          <CardBody>
            <p className="small strong">No job assigned to you today</p>
            <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
              Photos, serial numbers and materials are all recorded against a specific installation,
              so there is nothing to attach them to yet. The buttons below stay disabled until a job
              with a project is scheduled for you — ask the dispatcher to assign one, then pull to
              refresh.
            </p>
          </CardBody>
        </Card>
      ) : (
        jobsWithProject.length > 1 && (
          <div className="field">
            <label className="field__label" htmlFor="logJob">
              Logging against
            </label>
            <select
              id="logJob"
              className="select"
              value={activeJob?.id ?? ''}
              onChange={(e) => setJobId(e.target.value)}
            >
              {jobsWithProject.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.timeSlot} · {job.clientName}
                </option>
              ))}
            </select>
          </div>
        )
      )}

      {logged && (
        <Card style={{ borderColor: 'var(--success-solid)' }}>
          <CardBody>
            <div className="row row--between">
              <span className="small strong">✓ {logged}</span>
              <Button variant="ghost" size="sm" onClick={() => setLogged(null)}>
                Dismiss
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <FormError error={scanSerial.error ?? logMaterials.error ?? uploadPhoto.error} />

      <Tabs
        tabs={[
          { value: 'photos' as Tool, label: '📷 Photos' },
          { value: 'serials' as Tool, label: '🔢 Serials' },
          { value: 'materials' as Tool, label: '📦 Materials' },
        ]}
        active={tool}
        onChange={setTool}
      />

      {/* ---------------------------------------------------- PHOTOS */}
      {tool === 'photos' && (
        <div className="stack">
          <Card>
            <CardBody>
              {/* `capture="environment"` opens the rear camera straight away on a
                  phone rather than the photo library — one tap fewer on a roof. */}
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhoto}
                style={{ display: 'none' }}
              />
              {/* Chosen BEFORE the camera opens, because afterwards the
                   technician is holding a phone in one hand on a roof and the
                   answer is already known. */}
              <div className="field">
                <label className="field__label" htmlFor="photoCategory">
                  What is this a photo of?
                </label>
                <select
                  id="photoCategory"
                  className="select"
                  value={photoCategory}
                  onChange={(e) => setPhotoCategory(e.target.value)}
                >
                  {PHOTO_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                      {capturedCategories.includes(category) ? ' ✓' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                variant="primary"
                block
                size="lg"
                style={{ marginTop: 'var(--space-3)' }}
                disabled={!activeJob || uploadPhoto.isPending}
                onClick={() => photoInput.current?.click()}
              >
                {uploadPhoto.isPending ? 'Uploading…' : '📷 Take photo'}
              </Button>
              <p className="xs dim center" style={{ marginTop: 'var(--space-2)' }}>
                GPS coordinates and timestamp are embedded automatically.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-3)' }}>
                Required photos
              </h3>
              <div className="stack stack--sm">
                {PHOTO_CATEGORIES.map((category) => {
                  /* Read from the photographs actually on this project. It was
                     `index < 3` — the same three categories reported captured
                     on every job, on an empty database, forever. */
                  const captured = capturedCategories.includes(category)
                  return (
                    <div key={category} className="row row--between">
                      <span className="small">{category}</span>
                      {captured ? (
                        <Badge tone="success">✓ Captured</Badge>
                      ) : (
                        <Badge tone="neutral">Pending</Badge>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="xs dim" style={{ marginTop: 'var(--space-3)' }}>
                {capturedCategories.length} of {PHOTO_CATEGORIES.length} taken. Take all of them
                before you leave site — together they are the engineering inspection record, and the
                customer sees them in their project tracker.
              </p>
            </CardBody>
          </Card>
        </div>
      )}

      {/* --------------------------------------------------- SERIALS */}
      {tool === 'serials' && (
        <div className="stack">
          <Card>
            <CardBody>
              {/* Barcode scanning was a permanently disabled button labelled
                   "coming soon" — the largest control on the panel, doing
                   nothing. Typing a serial is not a fallback here, it is the
                   method: a phone camera decoding a scuffed label on a panel in
                   direct sunlight fails often enough that people give up on it,
                   and the keyboard always works. */}
              <form onSubmit={addSerial}>
                <div className="field">
                  <label className="field__label" htmlFor="serialItem">
                    Which piece of equipment?
                  </label>
                  <select
                    id="serialItem"
                    className="select"
                    value={serialItemId}
                    onChange={(e) => setSerialItemId(e.target.value)}
                  >
                    <option value="">Choose the equipment…</option>
                    {serialisable.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {onThisJob.has(item.id) ? ' · on this job' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="serial">
                    Serial number
                  </label>
                  <input
                    id="serial"
                    className="input"
                    placeholder="e.g. CS615-2026-118844"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  block
                  style={{ marginTop: 'var(--space-2)' }}
                  disabled={!activeJob || scanSerial.isPending}
                >
                  {scanSerial.isPending ? 'Recording…' : 'Add serial'}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <div className="row row--between" style={{ marginBottom: 'var(--space-3)' }}>
                <h3 style={{ fontSize: 'var(--text-base)' }}>Recorded on this job</h3>
                <Badge
                  tone={
                    serialsExpected > 0 && serials.length >= serialsExpected ? 'success' : 'brand'
                  }
                >
                  {serialsExpected > 0
                    ? `${serials.length} of ${serialsExpected}`
                    : `${serials.length} recorded`}
                </Badge>
              </div>

              <div className="stack stack--sm">
                {serials.length === 0 && (
                  <p className="small muted">Nothing scanned for this job yet.</p>
                )}
                {serials.map((serial, index) => (
                  <div key={serial.id} className="row row--between">
                    <span className="row">
                      <span className="dim small">{index + 1}.</span>
                      <code>{serial.serialNumber}</code>
                    </span>
                    <Badge tone="success">✓</Badge>
                  </div>
                ))}
              </div>

              <p
                className="small"
                style={{
                  marginTop: 'var(--space-4)',
                  padding: 'var(--space-3)',
                  background: 'var(--warning-bg)',
                  color: 'var(--warning-fg)',
                  borderRadius: 'var(--radius)',
                }}
              >
                ⚠ Every panel, inverter and battery must be scanned. A missing serial means the
                client cannot claim that unit's warranty later.
              </p>
            </CardBody>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------- MATERIALS */}
      {tool === 'materials' && (
        <div className="stack">
          <Card>
            <CardBody>
              <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-2)' }}>
                Log consumed materials
              </h3>
              <p className="xs dim" style={{ marginBottom: 'var(--space-4)' }}>
                Record what was actually used. This deducts from warehouse stock, so accuracy here
                keeps the inventory numbers honest. The list is this job&apos;s bill of materials.
              </p>

              {materials.length === 0 && (
                <p className="small muted" style={{ marginBottom: 'var(--space-3)' }}>
                  Nothing is reserved against this job yet. Add what you used from the catalogue
                  below.
                </p>
              )}

              <div className="stack stack--sm">
                {[
                  ...materials.map((m) => ({
                    id: m.stockItemId,
                    name: m.name,
                    detail: `${m.sku} · planned ${m.planned} ${m.unit}${
                      m.used > 0 ? ` · ${m.used} already logged` : ''
                    }`,
                    unit: m.unit,
                  })),
                  ...extraLines
                    .map((id) => STOCK.find((s) => s.id === id))
                    .filter((item): item is StockItem => Boolean(item))
                    .map((item) => ({
                      id: item.id,
                      name: item.name,
                      detail: `${item.sku} · not on the bill of materials`,
                      unit: item.unit,
                    })),
                ].map((line) => (
                  <div
                    key={line.id}
                    style={{
                      padding: 'var(--space-3)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <div className="small strong">{line.name}</div>
                    <div className="xs dim" style={{ marginBottom: 'var(--space-2)' }}>
                      {line.detail}
                    </div>
                    <div className="row">
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={quantities[line.id] ?? 0}
                        onChange={(e) =>
                          setQuantities((previous) => ({
                            ...previous,
                            [line.id]: Number(e.target.value),
                          }))
                        }
                        style={{ width: 90 }}
                        aria-label={`Quantity used of ${line.name}`}
                      />
                      <span className="small muted">{line.unit} used</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="field" style={{ marginTop: 'var(--space-4)' }}>
                <label className="field__label" htmlFor="extraItem">
                  Used something else?
                </label>
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  <select
                    id="extraItem"
                    className="select"
                    value={extraItemId}
                    onChange={(e) => setExtraItemId(e.target.value)}
                  >
                    <option value="">Choose from the catalogue…</option>
                    {STOCK.filter(
                      (item) =>
                        !materials.some((m) => m.stockItemId === item.id) &&
                        !extraLines.includes(item.id),
                    ).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!extraItemId}
                    onClick={() => {
                      setExtraLines((previous) => [...previous, extraItemId])
                      setExtraItemId('')
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>

              <Button
                variant="primary"
                block
                size="lg"
                style={{ marginTop: 'var(--space-4)' }}
                disabled={!activeJob || logMaterials.isPending}
                onClick={submitMaterials}
              >
                {logMaterials.isPending ? 'Logging…' : 'Submit material usage'}
              </Button>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Offline notice applies to all three tools. */}
      <Card>
        <CardBody>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span>⟳</span>
            <p className="xs dim">
              Serials and materials logged here are saved on your phone first and sent when you
              reconnect, so you can work through an installation with no signal. Photos are the
              exception: they are too large to hold on the phone, so take them once you have signal
              — the checklist above shows which are still missing.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
