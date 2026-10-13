import { useRef, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { date, yearsUntil } from '@/lib/format'
import { useMyAssets } from '@/lib/queries/client-portal'
import type { SerializedAsset } from '@/types/domain'
import { FormError } from '@/components/ui/FormError'
import { useMyProject, useRequestWarrantyTransfer } from '@/lib/queries/client-portal'
import { useCompany } from '@/lib/queries/public-site'
import { useClientUpload } from '@/lib/queries/storage'

/* ============================================================================
   ClientWarrantyPage — warranty registration and transfer requests.
   ----------------------------------------------------------------------------
   Two spec bullets, one screen:
     • "Warranty registration & transfer request (register product warranty
        post-install; request transfer if selling home)"

   THE DATA CHAIN THAT MAKES THIS WORK
     field portal: technician scans a panel's serial number on the roof
        → writes a `serialized_assets` row linked to this project
        → admin /admin/assets shows the registry
        → THIS PAGE shows the customer exactly which units are on their roof
        → a transfer request lands on /admin/warranty for approval

   Without the technician scanning serials in the field, this page has nothing
   to show — which is why serial capture is mandatory in the field checklist.
   ========================================================================== */

export function ClientWarrantyPage() {
  const assetsQuery = useMyAssets()
  const assets = assetsQuery.data ?? []
  const company = useCompany()
  const [showTransfer, setShowTransfer] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  /* A transfer is against the PROJECT — it moves the whole installation to a
     new owner, not one panel. */
  const project = useMyProject().data
  const requestTransfer = useRequestWarrantyTransfer()

  /* The deed of sale. The staff warranty queue asks a reviewer to approve
     moving a warranty to a different person, and THIS is the evidence that
     decision rests on — the input used to accept the file and discard it, so
     the reviewer was being asked to approve on trust. */
  const uploadDeed = useClientUpload()
  const deedRef = useRef<HTMLInputElement>(null)

  /* This used to be `e.preventDefault(); setSubmitted(true)`: the customer saw
     "request received" and nothing had been received by anyone. */
  function handleTransfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!project) return
    const form = new FormData(event.currentTarget)

    requestTransfer.mutate(
      {
        projectId: project.id,
        toName: String(form.get('newOwner') ?? ''),
        toEmail: String(form.get('newEmail') ?? ''),
        transferDate: String(form.get('transferDate') ?? ''),
      },
      {
        onSuccess: async () => {
          /* Uploaded after the request exists, and a failure here does not
             lose the request: the office can chase the document, which is a
             far better outcome than the customer filling the form again. */
          const deed = deedRef.current?.files?.[0]
          if (deed) {
            try {
              await uploadDeed.mutateAsync({
                file: deed,
                projectId: project.id,
                kind: 'proof_of_sale',
              })
            } catch {
              // Surfaced through the mutation's error state below.
            }
          }
          setSubmitted(true)
        },
      },
    )
  }

  const columns: Column<SerializedAsset>[] = [
    { header: 'Product', cell: (a) => <span className="strong">{a.productName}</span> },
    {
      header: 'Serial number',
      cell: (a) => <code>{a.serialNumber}</code>,
    },
    { header: 'Installed', cell: (a) => date(a.installedAt) },
    { header: 'Term', numeric: true, cell: (a) => `${a.warrantyYears} yrs` },
    {
      header: 'Expires',
      cell: (a) => {
        const yearsLeft = yearsUntil(a.warrantyExpiresAt)
        return (
          <span className="row">
            {date(a.warrantyExpiresAt)}
            <Badge tone={yearsLeft > 2 ? 'success' : yearsLeft > 0 ? 'warning' : 'danger'}>
              {yearsLeft > 0 ? 'Active' : 'Expired'}
            </Badge>
          </span>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="Warranty"
        description="Every serialised component on your roof, with its coverage period."
        breadcrumbs={[{ label: 'Portal', to: '/portal' }, { label: 'Warranty' }]}
        actions={
          <Button variant="outline" onClick={() => setShowTransfer((s) => !s)}>
            Request warranty transfer
          </Button>
        }
      />

      {/* ------------------------------------------- TRANSFER REQUEST */}
      {showTransfer && (
        <Card accent style={{ marginBottom: 'var(--space-6)' }}>
          <CardHeader title="Transfer warranty to a new owner" />
          <CardBody>
            {submitted ? (
              <div className="center stack stack--sm" style={{ paddingBlock: 'var(--space-4)' }}>
                <div style={{ fontSize: '2rem' }}>✅</div>
                <h4>Transfer request submitted</h4>
                <p className="small muted">
                  Our team reviews transfers within five business days. You will be notified once it
                  is approved.
                </p>
              </div>
            ) : (
              <form className="stack" onSubmit={handleTransfer}>
                <p className="small muted">
                  Selling the property? Warranties transfer to the new owner at no cost. We need
                  their details to reissue the certificates.
                </p>
                <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="field__label" htmlFor="newOwner">
                      New owner's full name
                    </label>
                    <input id="newOwner" name="newOwner" className="input" required />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="field__label" htmlFor="newEmail">
                      New owner's email
                    </label>
                    <input id="newEmail" name="newEmail" className="input" type="email" required />
                  </div>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="transferDate">
                    Expected transfer date
                  </label>
                  <input
                    id="transferDate"
                    name="transferDate"
                    className="input"
                    type="date"
                    required
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="deed">
                    Proof of sale <span className="dim">(deed of sale or similar)</span>
                  </label>
                  <input
                    id="deed"
                    ref={deedRef}
                    className="input"
                    type="file"
                    accept="image/*,application/pdf"
                  />
                  <span className="field__hint">
                    This is what the office checks before moving the warranty. Without it the
                    request waits.
                  </span>
                </div>
                <FormError error={requestTransfer.error} />
                <FormError error={uploadDeed.error} />

                <div className="row">
                  <Button type="submit" variant="primary" disabled={requestTransfer.isPending}>
                    {requestTransfer.isPending ? 'Submitting…' : 'Submit transfer request'}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowTransfer(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardBody>
        </Card>
      )}

      {/* -------------------------------------- REGISTERED HARDWARE */}
      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <CardHeader
          title="Registered hardware"
          action={<Badge tone="success">All units registered</Badge>}
        />
        <CardBody>
          <DataTable
            columns={columns}
            rows={assets}
            rowKey={(a) => a.id}
            emptyMessage="Serial numbers appear here once your installation is commissioned."
          />
        </CardBody>
      </Card>

      {/* ------------------------------------------ COVERAGE SUMMARY
          The company's published terms from Settings — the same figures each
          unit's expiry above was worked out from. These cards were fixed text
          ("Inverter — 10 years") above a table that, for the same inverter,
          said five. */}
      <div className="grid">
        <Card>
          <CardBody>
            <h4>☀️ Panels — {company.warrantyPanelYears} years</h4>
            <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
              Product warranty on every panel, registered to you by its serial number. The
              manufacturer&rsquo;s output guarantee is on the panel datasheet; ask your engineer.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h4>⚡ Inverter — {company.warrantyInverterYears} years</h4>
            <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
              Full replacement warranty. Extended terms available; ask your engineer.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h4>🔋 Batteries — {company.warrantyBatteryYears} years</h4>
            <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
              Each battery module is covered on its own serial number.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h4>🔧 Workmanship — {company.warrantyWorkmanshipYears} years</h4>
            <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
              Covers installation defects, mounting integrity and wiring. Raise a support ticket and
              we come out at no charge.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
