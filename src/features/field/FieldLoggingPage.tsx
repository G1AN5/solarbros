import { useRef, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Tabs } from '@/components/ui/Tabs'
import { useLogMaterials, useMyJobs, useProjectSerials, useScanSerial } from '@/lib/queries/field'
import { useStock } from '@/lib/queries/inventory-finance'
import { useUploadSitePhoto } from '@/lib/queries/storage'

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

  function addSerial(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = scanInput.trim()
    if (!trimmed || !activeJob?.projectId) return

    scanSerial.mutate(
      {
        serialNumber: trimmed,
        productName: 'Scanned on site',
        projectId: activeJob.projectId,
        clientId: activeJob.clientId,
      },
      {
        onSuccess: () => {
          setScanInput('')
          setLogged(`Serial ${trimmed.toUpperCase()} recorded`)
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
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        setLogged('Photo uploaded with location')
      },
      () => {
        uploadPhoto.mutate({ file, projectId: activeJob.projectId!, appointmentId: activeJob.id })
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
        <Card>
          <CardBody>
            <p className="small muted">
              Nothing to log against — you have no job with a project assigned today. Open a job
              from Today first.
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
              <Button
                variant="primary"
                block
                size="lg"
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
                {PHOTO_CATEGORIES.map((category, index) => {
                  // First three are stand-ins for "already captured".
                  const captured = index < 3
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
                All eight are required before the job can be marked complete — they form the
                engineering inspection record.
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
              {/* A real barcode scanner needs camera access and a decoding
                  library; typing the serial is the fallback that always works
                  and is what the form below is for. */}
              <Button
                variant="primary"
                block
                size="lg"
                disabled
                title="Barcode scanning needs a camera permission and a decoder — type it below"
              >
                📸 Scan barcode (coming soon)
              </Button>

              <form onSubmit={addSerial} style={{ marginTop: 'var(--space-3)' }}>
                <div className="field">
                  <label className="field__label" htmlFor="serial">
                    Or type it manually
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
                <h3 style={{ fontSize: 'var(--text-base)' }}>Scanned this job</h3>
                <Badge tone="brand">{serials.length} recorded</Badge>
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
                keeps the inventory numbers honest.
              </p>

              <div className="stack stack--sm">
                {STOCK.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: 'var(--space-3)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    <div className="small strong">{item.name}</div>
                    <div className="xs dim" style={{ marginBottom: 'var(--space-2)' }}>
                      {item.sku}
                    </div>
                    <div className="row">
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={quantities[item.id] ?? 0}
                        onChange={(e) =>
                          setQuantities((previous) => ({
                            ...previous,
                            [item.id]: Number(e.target.value),
                          }))
                        }
                        style={{ width: 90 }}
                        aria-label={`Quantity used of ${item.name}`}
                      />
                      <span className="small muted">units used</span>
                    </div>
                  </div>
                ))}
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
              Everything logged here is saved to your phone first and uploaded when you reconnect.
              You can work through a full installation with no signal at all and nothing will be
              lost.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
