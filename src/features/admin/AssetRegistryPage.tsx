import { type FormEvent, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatTile } from '@/components/ui/StatTile'
import { date, humanize, yearsUntil } from '@/lib/format'
import { QueryState } from '@/components/ui/QueryState'
import {
  type AssetWithProject,
  type RmaClaim,
  type RmaStatus,
  useAllAssets,
  useFileRma,
  useOpenRmaCount,
  useRmaClaims,
  useUpdateRma,
} from '@/lib/queries/inventory-finance'
import { datedFilename, downloadCsv } from '@/lib/csv'

const RMA_STATUS_LABEL: Record<RmaStatus, string> = {
  draft: 'Draft — not sent yet',
  filed: 'Filed with the manufacturer',
  under_assessment: 'Being assessed',
  approved: 'Approved',
  rejected: 'Rejected',
  replacement_received: 'Replacement received',
  closed: 'Closed',
}

const RMA_STATUS_TONE: Record<RmaStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  filed: 'info',
  under_assessment: 'warning',
  approved: 'success',
  rejected: 'danger',
  replacement_received: 'success',
  closed: 'neutral',
}

/* ============================================================================
   AssetRegistryPage — Warranty & Asset Registry module.
   ----------------------------------------------------------------------------
   Every serial-numbered unit SolarBros has ever installed, mapped to the client
   and project it sits on.

   WHY THIS REGISTRY EARNS ITS KEEP
     • RMA claims: a manufacturer will not honour a claim without the serial and
       the install date. Both are here.
     • Recalls: when a batch is recalled, one query finds every affected roof.
     • Warranty transfers: the new owner inherits these exact rows.
     • The client's /portal/warranty page is a filtered view of this table.

   The data originates in the FIELD: a technician scans each serial during
   installation. If that step is skipped, this registry has holes and warranty
   claims fail years later — which is why serial capture is a blocking item on
   the field checklist, not an optional one.
   ========================================================================== */

export function AssetRegistryPage() {
  const assetsQuery = useAllAssets()
  const assets = assetsQuery.data ?? []

  /* The search box filtered nothing and "File RMA" opened nothing, so a
     registry whose whole purpose is finding one serial among thousands could
     not be searched, and the claim it exists to support could not be raised. */
  const [search, setSearch] = useState('')
  const [claiming, setClaiming] = useState<AssetWithProject | null>(null)
  const fileRma = useFileRma()
  const [filed, setFiled] = useState<string | null>(null)

  /* "Under warranty" showed the total number of assets with the caption "All
     active", which is only true if nothing has ever expired. "Open RMA claims"
     was the literal string "0" - and claims can now actually be filed. */
  const underWarranty = assets.filter((a) => yearsUntil(a.warrantyExpiresAt) > 0)
  const openClaims = useOpenRmaCount().data ?? 0
  const claims = useRmaClaims().data ?? []
  const updateRma = useUpdateRma()
  const [progressing, setProgressing] = useState<RmaClaim | null>(null)

  const needle = search.trim().toLowerCase()
  const visible = needle
    ? assets.filter(
        (a) =>
          a.serialNumber.toLowerCase().includes(needle) ||
          a.productName.toLowerCase().includes(needle) ||
          a.clientName.toLowerCase().includes(needle) ||
          a.projectReference.toLowerCase().includes(needle),
      )
    : assets

  function handleFileRma(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!claiming) return
    const form = new FormData(event.currentTarget)

    fileRma.mutate(
      {
        assetId: claiming.id,
        manufacturer: String(form.get('manufacturer') ?? ''),
        faultDescription: String(form.get('fault') ?? ''),
      },
      { onSuccess: (result) => setFiled(result?.claim_reference ?? null) },
    )
  }

  function closeRma() {
    setClaiming(null)
    setFiled(null)
    fileRma.reset()
  }

  const expiringSoon = assets.filter((a) => {
    const yearsLeft = yearsUntil(a.warrantyExpiresAt)
    return yearsLeft > 0 && yearsLeft < 3
  })

  const columns: Column<AssetWithProject>[] = [
    {
      header: 'Serial number',
      cell: (a) => <code>{a.serialNumber}</code>,
    },
    { header: 'Product', cell: (a) => <span className="strong">{a.productName}</span> },
    {
      header: 'Project',
      // The query joins the project and client, so no second lookup is needed.
      cell: (a) => (
        <div>
          <div className="small strong">{a.clientName}</div>
          <div className="xs dim">{a.projectReference}</div>
        </div>
      ),
    },
    {
      header: 'Site',
      cell: (a) => (
        <span className="xs dim" style={{ maxWidth: '30ch', display: 'inline-block' }}>
          {a.siteAddress || '—'}
        </span>
      ),
    },
    { header: 'Installed', cell: (a) => date(a.installedAt) },
    { header: 'Term', numeric: true, cell: (a) => `${a.warrantyYears} yrs` },
    {
      header: 'Warranty',
      cell: (a) => {
        const yearsLeft = yearsUntil(a.warrantyExpiresAt)
        if (a.status && a.status !== 'installed') {
          return (
            <Badge tone={a.status === 'faulty' ? 'danger' : 'neutral'}>{humanize(a.status)}</Badge>
          )
        }
        return (
          <div>
            <Badge tone={yearsLeft > 3 ? 'success' : yearsLeft > 0 ? 'warning' : 'danger'}>
              {yearsLeft > 0 ? `${Math.floor(yearsLeft)} yrs left` : 'Expired'}
            </Badge>
            <div className="xs dim" style={{ marginTop: 2 }}>
              to {date(a.warrantyExpiresAt)}
            </div>
          </div>
        )
      },
    },
    {
      header: '',
      cell: (a) => (
        <Button variant="outline" size="sm" onClick={() => setClaiming(a)}>
          File RMA
        </Button>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Asset registry"
        description="Serialised hardware tracking across every installation."
        actions={
          <>
            <input
              className="input"
              placeholder="Scan or search a serial number…"
              style={{ width: 260 }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button
              variant="outline"
              onClick={() =>
                downloadCsv(datedFilename('asset-registry'), visible, [
                  { header: 'Serial', value: (a) => a.serialNumber },
                  { header: 'Product', value: (a) => a.productName },
                  { header: 'Customer', value: (a) => a.clientName },
                  { header: 'Project', value: (a) => a.projectReference },
                  { header: 'Site', value: (a) => a.siteAddress },
                  { header: 'Installed', value: (a) => a.installedAt },
                  { header: 'Warranty years', value: (a) => a.warrantyYears },
                  { header: 'Warranty expires', value: (a) => a.warrantyExpiresAt },
                ])
              }
            >
              Export CSV
            </Button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Registered units" value={String(assets.length)} />
        <StatTile
          label="Under warranty"
          value={String(underWarranty.length)}
          delta={
            assets.length - underWarranty.length > 0
              ? `${assets.length - underWarranty.length} expired`
              : 'None expired'
          }
          direction="flat"
        />
        <StatTile
          label="Expiring within 3 years"
          value={String(expiringSoon.length)}
          delta="Upsell opportunity"
        />
        <StatTile
          label="Open RMA claims"
          value={String(openClaims)}
          delta={openClaims > 0 ? 'With the manufacturer' : 'None outstanding'}
          direction={openClaims > 0 ? 'up' : 'flat'}
          invertDelta
        />
      </div>

      <QueryState
        isLoading={assetsQuery.isLoading}
        error={assetsQuery.error as Error | null}
        emptyIcon="&#128290;"
        emptyTitle="No serialised assets yet"
        emptyMessage="Rows appear here as technicians scan hardware during installation."
      >
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(a) => a.id}
          emptyMessage="No serialised assets registered yet."
        />
      </QueryState>

      {/* ------------------------------------------- CLAIMS IN FLIGHT */}
      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardHeader
          title="Warranty claims with manufacturers"
          action={<span className="xs dim">Recorded on the manufacturer&apos;s behalf</span>}
        />
        <CardBody>
          {claims.length === 0 ? (
            <p className="small muted">
              No claims. Open one from a unit above with &ldquo;File RMA&rdquo;.
            </p>
          ) : (
            <div className="stack stack--sm">
              {claims.map((claim) => (
                <div
                  key={claim.id}
                  className="row row--between row--wrap"
                  style={{
                    padding: 'var(--space-3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    gap: 'var(--space-3)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <code>{claim.reference}</code>
                      <Badge tone={RMA_STATUS_TONE[claim.status]}>
                        {RMA_STATUS_LABEL[claim.status]}
                      </Badge>
                    </div>
                    <div className="xs dim" style={{ marginTop: 2 }}>
                      {claim.productName} · <code>{claim.serialNumber}</code> · {claim.clientName}{' '}
                      {claim.projectReference && `(${claim.projectReference})`} ·{' '}
                      {claim.manufacturer}
                      {claim.externalReference ? ` · their ref ${claim.externalReference}` : ''}
                    </div>
                    <div className="xs dim">{claim.faultDescription}</div>
                    {claim.decisionNotes && (
                      <div className="xs" style={{ marginTop: 2 }}>
                        {claim.decisionNotes}
                      </div>
                    )}
                  </div>
                  {claim.status !== 'closed' && (
                    <Button variant="outline" size="sm" onClick={() => setProgressing(claim)}>
                      Record progress
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardBody>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.5rem' }}>📷</span>
            <div>
              <h4>Serials are captured in the field</h4>
              <p className="small muted" style={{ marginTop: 'var(--space-1)', maxWidth: '80ch' }}>
                Technicians scan each panel, inverter and battery barcode through the field portal
                during installation. Rows here are created automatically from those scans, which is
                why serial capture is a mandatory checklist item rather than an optional one — a
                missing serial means a warranty claim that cannot be filed in 2041.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ------------------------------------------ PROGRESS A CLAIM */}
      <Modal
        open={progressing !== null}
        onClose={() => {
          setProgressing(null)
          updateRma.reset()
        }}
        title={progressing ? `Claim ${progressing.reference}` : 'Claim'}
      >
        {progressing && (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              const form = new FormData(event.currentTarget)
              updateRma.mutate(
                {
                  id: progressing.id,
                  status: String(form.get('status')) as RmaStatus,
                  externalReference: String(form.get('reference') ?? ''),
                  decisionNotes: String(form.get('notes') ?? ''),
                },
                { onSuccess: () => setProgressing(null) },
              )
            }}
          >
            <div className="field">
              <label className="field__label" htmlFor="rma-status">
                Where it stands
              </label>
              <select
                id="rma-status"
                name="status"
                className="select"
                defaultValue={progressing.status}
              >
                {(Object.keys(RMA_STATUS_LABEL) as RmaStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {RMA_STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
              <span className="field__hint">
                &ldquo;Replacement received&rdquo; marks the original unit as replaced in the
                registry. Scan the new unit&apos;s serial from the field app when it is fitted.
              </span>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="rma-ref">
                Manufacturer&apos;s reference
              </label>
              <input
                id="rma-ref"
                name="reference"
                className="input"
                defaultValue={progressing.externalReference ?? ''}
                placeholder="Their case or RMA number"
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="rma-notes">
                Their decision, or what happened
              </label>
              <textarea
                id="rma-notes"
                name="notes"
                className="textarea"
                rows={3}
                defaultValue={progressing.decisionNotes ?? ''}
              />
            </div>
            <FormError error={updateRma.error} />
            <Button type="submit" variant="primary" block disabled={updateRma.isPending}>
              {updateRma.isPending ? 'Saving…' : 'Save'}
            </Button>
          </form>
        )}
      </Modal>

      {/* ------------------------------------------------- FILE AN RMA */}
      <Modal
        open={claiming !== null}
        onClose={closeRma}
        title={claiming ? `RMA · ${claiming.serialNumber}` : 'RMA claim'}
      >
        {filed ? (
          <div className="stack stack--sm">
            <div style={{ fontSize: '1.75rem' }}>📦</div>
            <h4 style={{ margin: 0 }}>Claim {filed} opened</h4>
            <p className="small muted">
              It is a draft until you send it to the manufacturer. They do not use this system, so
              record their reference and their decision here as they come back to you — the audit
              trail will show it was you who recorded it, not them.
            </p>
            <Button variant="outline" block onClick={closeRma}>
              Done
            </Button>
          </div>
        ) : (
          claiming && (
            <form className="stack" onSubmit={handleFileRma}>
              <div
                style={{
                  padding: 'var(--space-3)',
                  background: 'var(--ink-50)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <div className="small strong">{claiming.productName}</div>
                <div className="xs dim">
                  {claiming.serialNumber} · installed {date(claiming.installedAt)} ·{' '}
                  {claiming.clientName}
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="rma-mfr">
                  Manufacturer
                </label>
                <input id="rma-mfr" name="manufacturer" className="input" required />
                <span className="field__hint">
                  Who the claim goes to — the brand on the unit, not the distributor.
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="rma-fault">
                  Fault
                </label>
                <textarea id="rma-fault" name="fault" className="textarea" rows={4} required />
                <span className="field__hint">
                  Error codes, when it started and what was tried. A vague claim comes back with
                  questions and loses a fortnight.
                </span>
              </div>

              <FormError error={fileRma.error} />

              <Button type="submit" variant="primary" block disabled={fileRma.isPending}>
                {fileRma.isPending ? 'Opening…' : 'Open the claim'}
              </Button>
            </form>
          )
        )}
      </Modal>
    </>
  )
}
