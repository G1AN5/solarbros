import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Tabs } from '@/components/ui/Tabs'
import { date as fmtDate } from '@/lib/format'
import {
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_STATUS_TONE,
  APPOINTMENT_TYPE_LABEL,
} from '@/lib/labels'
import {
  localToday,
  useJobMaterials,
  useLoggableJobs,
  useLogMaterials,
  useProjectSerials,
  useScanSerial,
  type LoggableJob,
} from '@/lib/queries/field'
import { useStock } from '@/lib/queries/inventory-finance'
import { useCompany } from '@/lib/queries/public-site'
import { usePhotoCategories, useUploadSitePhoto } from '@/lib/queries/storage'
import type { AppointmentType, StockItem } from '@/types/domain'

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

/* What to photograph depends on the visit. A survey records the roof and the
   electrics before anything is designed; an installation records each stage
   of the build; a service visit records what was found and what was done. */
const PHOTO_CATEGORIES: Record<AppointmentType, string[]> = {
  installation: [
    'Roof condition (before)',
    'Racking installed',
    'Panels mounted',
    'DC combiner / wiring',
    'Inverter installation',
    'AC connection point',
    'Completed system',
    'Site cleaned (after)',
  ],
  site_survey: [
    'Roof overview',
    'Roof structure and condition',
    'Shading and obstructions',
    'Main electrical panel',
    'Utility meter',
    'Proposed inverter location',
    'Cable route',
  ],
  maintenance: [
    'System before servicing',
    'Panels after cleaning',
    'Inverter display or error log',
    'Connections checked',
    'Anything needing attention',
  ],
  repair: [
    'Fault as found',
    'Part replaced (serial visible)',
    'Repair completed',
    'System running after repair',
  ],
  virtual_consultation: ['Site photo'],
}

/** "14 Oct" — the job list is read on a phone, where the year is noise. */
function shortDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString('en-PH', {
    day: 'numeric',
    month: 'short',
  })
}

export function FieldLoggingPage() {
  const stockQuery = useStock()
  const STOCK = stockQuery.data ?? []

  const [tool, setTool] = useState<Tool>('photos')
  const [scanInput, setScanInput] = useState('')
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [logged, setLogged] = useState<string | null>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)
  /** Waiting up to five seconds for a position before a photo is sent. */
  const [locatingPhoto, setLocatingPhoto] = useState(false)
  /** Gallery photos go up one after another; this is how far along they are. */
  const [galleryProgress, setGalleryProgress] = useState<{ done: number; total: number } | null>(
    null,
  )

  /* WHICH JOB IS THIS FOR?
     Every photo, serial and material line is filed against a visit, and
     through it the customer's project. The page used to choose silently from
     TODAY's jobs that had a project, and said which only when there were two:
     a technician could not tell whose job they were logging, and could not
     log a site survey or yesterday's installation at all.

     It now lists this technician's recent and coming visits, finished ones
     included, and always says which one is being logged. Opened from a job
     (?job=…), it starts on that job; otherwise on the job in hand. */
  const [searchParams] = useSearchParams()
  const jobsQuery = useLoggableJobs()
  const jobs = jobsQuery.data ?? []
  const [jobId, setJobId] = useState<string>(() => searchParams.get('job') ?? '')
  const today = localToday()
  const activeJob: LoggableJob | undefined =
    jobs.find((j) => j.id === jobId) ??
    jobs.find((j) => j.date === today && j.status !== 'completed') ??
    jobs.find((j) => j.date === today) ??
    jobs.find((j) => j.date < today) ??
    jobs[jobs.length - 1]
  /** Serials and materials belong to an installation; a survey has none yet. */
  const hasProject = Boolean(activeJob?.projectId)

  const upcoming = jobs.filter((j) => j.date > today).reverse()
  const todays = jobs.filter((j) => j.date === today)
  const earlier = jobs.filter((j) => j.date < today)

  const scanSerial = useScanSerial()
  const logMaterials = useLogMaterials()
  const uploadPhoto = useUploadSitePhoto()

  /* The real registry, not a hardcoded pair. This list used to show two
     invented serials and count them "2 of 14" forever. */
  const serials = useProjectSerials(activeJob?.projectId).data ?? []

  /* WHICH of the required photographs this capture is. The upload has always
     accepted a category and the page never sent one, so every photo was filed
     with `photo_category` null and the checklist below could not have been
     real even in principle. The list depends on the kind of visit. */
  const categories = PHOTO_CATEGORIES[activeJob?.type ?? 'installation']
  const [chosenCategory, setPhotoCategory] = useState('')
  const photoCategory = categories.includes(chosenCategory) ? chosenCategory : categories[0]

  /* WHAT the serial belongs to. Every asset was filed as the literal string
     "Scanned on site", so the admin asset registry listed a column of identical
     product names and the customer's warranty page could not tell them whether
     a serial was their inverter or a panel. The technician knows what is in
     their hand; nothing was asking. */
  const [serialItemId, setSerialItemId] = useState('')
  /* An installation's photos are counted across all of its visits — a two-day
     build is one set. Any other visit counts its own. */
  const capturedCategories =
    usePhotoCategories(
      activeJob?.type === 'installation' && activeJob.projectId
        ? { projectId: activeJob.projectId }
        : { appointmentId: activeJob?.id },
    ).data ?? []

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

    const projectId = activeJob.projectId
    /* Cleared and confirmed once every line has gone through. Before, the
       form cleared and said "logged" while the writes were still in flight,
       so a refused line vanished from the form with a success message. */
    void Promise.allSettled(
      entries.map(([stockItemId, quantity]) =>
        logMaterials.mutateAsync({
          projectId,
          stockItemId,
          itemName: STOCK.find((s) => s.id === stockItemId)?.name ?? 'Material',
          quantity,
        }),
      ),
    ).then((results) => {
      // Only the refused lines stay in the form, so sending it again cannot
      // log the others twice.
      const failed = new Set(
        entries.filter((_, index) => results[index].status === 'rejected').map(([id]) => id),
      )
      setQuantities((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([id]) => failed.has(id))),
      )
      if (failed.size === 0) {
        setExtraLines([])
        setLogged(`${entries.length} material line(s) logged`)
      } else if (failed.size < entries.length) {
        setLogged(
          `${entries.length - failed.size} of ${entries.length} material lines logged — the rest are still in the form`,
        )
      }
    })
  }

  /* TAKE A PHOTO: one picture, just taken, so where the phone is now is where
     it was taken — the location goes with it. */
  function handleCamera(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    const job = activeJob
    if (!file || !job) return
    const category = photoCategory

    /* "Uploaded" is said once it has been — it used to be said as the upload
       began, so a failed one still announced itself as done. */
    const send = (position?: { latitude: number; longitude: number }) => {
      setLocatingPhoto(false)
      uploadPhoto.mutate(
        { file, projectId: job.projectId ?? null, appointmentId: job.id, category, ...position },
        {
          onSuccess: () =>
            setLogged(
              position
                ? `Photo uploaded with location · ${category}`
                : `Photo uploaded (no location available) · ${category}`,
            ),
        },
      )
    }

    /* Geolocation is requested but never waited on indefinitely — a technician
       inside a plant room may never get a fix, and the photo matters more than
       the coordinates. A browser without it still uploads (it used to do
       nothing at all). */
    if (!navigator.geolocation) {
      send()
      return
    }
    setLocatingPhoto(true)
    navigator.geolocation.getCurrentPosition(
      (position) =>
        send({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      () => send(),
      { timeout: 5000 },
    )
  }

  /* UPLOAD FROM THE GALLERY: pictures taken earlier, often with the phone's
     own camera while there was no signal. Where the phone is now is not where
     they were taken, so they go up without a location rather than with a
     wrong one. Several can be chosen at once; they are sent one at a time. */
  async function handleGallery(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    const job = activeJob
    if (files.length === 0 || !job) return
    const category = photoCategory

    let sent = 0
    setGalleryProgress({ done: 0, total: files.length })
    for (const file of files) {
      try {
        await uploadPhoto.mutateAsync({
          file,
          projectId: job.projectId ?? null,
          appointmentId: job.id,
          category,
        })
        sent += 1
      } catch {
        // Shown under the buttons by FormError; the rest still go up.
      }
      setGalleryProgress({ done: sent, total: files.length })
    }
    setGalleryProgress(null)

    if (sent === files.length) {
      setLogged(
        `${sent} photo${sent === 1 ? '' : 's'} uploaded from the gallery · ${category} (no location attached)`,
      )
    } else if (sent > 0) {
      setLogged(`${sent} of ${files.length} photos uploaded — choose the others again to retry`)
    }
  }

  const photoBusy = locatingPhoto || uploadPhoto.isPending || galleryProgress !== null

  return (
    <div className="stack">
      <div>
        <h1 style={{ fontSize: 'var(--text-xl)' }}>Logging</h1>
        <p className="small muted">Photos, serial numbers and consumed materials.</p>
      </div>

      {!activeJob ? (
        /* EVERY CONTROL BELOW IS DISABLED IN THIS STATE, and says why. With
           nothing to attach them to, the buttons would otherwise do nothing
           when tapped — which reads as the camera being broken. */
        <Card style={{ borderColor: 'var(--warning-solid)' }}>
          <CardBody>
            {jobsQuery.isLoading ? (
              <p className="small muted">Loading your jobs…</p>
            ) : (
              <>
                <p className="small strong">No jobs assigned to you</p>
                <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                  Photos, serial numbers and materials are recorded against one of your visits —
                  from the last two months or the week ahead. Ask the dispatcher to assign you to
                  the job, then reopen this page.
                </p>
              </>
            )}
          </CardBody>
        </Card>
      ) : (
        /* WHOSE JOB THIS IS, always on screen — the customer, the visit and
           the project the photos and serials will be filed under. */
        <Card className="log-job">
          <CardBody>
            <label className="field__label" htmlFor="logJob">
              Logging for
            </label>
            <select
              id="logJob"
              className="select"
              value={activeJob.id}
              onChange={(e) => {
                setJobId(e.target.value)
                setLogged(null)
              }}
            >
              {(
                [
                  ['Today', todays],
                  ['Coming up', upcoming],
                  ['Earlier', earlier],
                ] as const
              ).map(([label, group]) =>
                group.length > 0 ? (
                  <optgroup key={label} label={label}>
                    {group.map((job) => (
                      <option key={job.id} value={job.id}>
                        {shortDay(job.date)} · {job.clientName} · {APPOINTMENT_TYPE_LABEL[job.type]}
                        {job.status === 'completed' ? ' ✓' : ''}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>

            <div className="log-job__summary">
              <div className="strong">{activeJob.clientName || 'Customer'}</div>
              <div className="small">
                {APPOINTMENT_TYPE_LABEL[activeJob.type]} · {fmtDate(activeJob.date)},{' '}
                {activeJob.timeSlot}
              </div>
              {activeJob.address && <div className="xs dim">📍 {activeJob.address}</div>}
              <div className="row row--wrap" style={{ gap: 'var(--space-2)' }}>
                <Badge tone={APPOINTMENT_STATUS_TONE[activeJob.status]}>
                  {APPOINTMENT_STATUS_LABEL[activeJob.status]}
                </Badge>
                {activeJob.projectReference ? (
                  <Badge tone="neutral">Project {activeJob.projectReference}</Badge>
                ) : (
                  <Badge tone="warning">No project yet</Badge>
                )}
                <Link
                  to={`/field/jobs/${activeJob.id}`}
                  className="xs"
                  style={{ marginLeft: 'auto' }}
                >
                  Open the job →
                </Link>
              </div>
            </div>
          </CardBody>
        </Card>
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
              {/* Two ways in, said plainly. `capture="environment"` opens the
                  rear camera straight away; without it the phone offers the
                  gallery, for pictures already taken. There used to be only
                  the camera, and no way to send a photo taken earlier. */}
              <input
                ref={cameraInput}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleCamera}
                style={{ display: 'none' }}
              />
              <input
                ref={galleryInput}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => void handleGallery(e)}
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
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                      {capturedCategories.includes(category) ? ' ✓' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="photo-pick">
                <Button
                  variant="primary"
                  size="lg"
                  disabled={!activeJob || photoBusy}
                  onClick={() => cameraInput.current?.click()}
                >
                  📷 Take a photo
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  disabled={!activeJob || photoBusy}
                  onClick={() => galleryInput.current?.click()}
                >
                  🖼️ Upload from gallery
                </Button>
              </div>
              <p className="xs dim center" style={{ marginTop: 'var(--space-2)' }}>
                {locatingPhoto
                  ? 'Finding your location…'
                  : galleryProgress
                    ? `Uploading ${Math.min(galleryProgress.done + 1, galleryProgress.total)} of ${galleryProgress.total}…`
                    : uploadPhoto.isPending
                      ? 'Uploading…'
                      : 'A photo taken here is filed with your location and the time. Photos from the gallery are filed with the time only.'}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-3)' }}>
                Required photos
              </h3>
              <div className="stack stack--sm">
                {categories.map((category) => {
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
                {categories.filter((c) => capturedCategories.includes(c)).length} of{' '}
                {categories.length} taken.{' '}
                {activeJob?.type === 'site_survey'
                  ? 'Together they are what the quotation is designed from — the office sees them on the enquiry, and on the project once there is one.'
                  : 'Take all of them before you leave site — together they are the engineering inspection record, and the customer sees them in their project tracker.'}
              </p>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Serials and materials are an installation's — what was fitted and
          what it used. A visit with no project has neither yet. */}
      {(tool === 'serials' || tool === 'materials') && activeJob && !hasProject && (
        <Card>
          <CardBody>
            <p className="small strong">
              {tool === 'serials' ? 'Serial numbers' : 'Materials'} are recorded against an
              installation
            </p>
            <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
              This {APPOINTMENT_TYPE_LABEL[activeJob.type].toLowerCase()} for{' '}
              {activeJob.clientName || 'the customer'} has no project yet, so there is nothing to
              file them under. Photos can still be taken — use the Photos tab.
            </p>
          </CardBody>
        </Card>
      )}

      {/* --------------------------------------------------- SERIALS */}
      {tool === 'serials' && hasProject && (
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

              {/* A warning while anything is unscanned; a plain confirmation
                  once everything on the bill of materials is. It used to warn
                  at twelve of twelve. */}
              {serialsExpected > 0 && serials.length >= serialsExpected ? (
                <p className="small muted" style={{ marginTop: 'var(--space-4)' }}>
                  ✓ Every serialised unit on this job is recorded — the customer can claim each
                  one&rsquo;s warranty.
                </p>
              ) : (
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
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------- MATERIALS */}
      {tool === 'materials' && hasProject && (
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
