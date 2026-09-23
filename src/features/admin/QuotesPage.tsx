import { useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatTile } from '@/components/ui/StatTile'
import { useAuth } from '@/app/auth/useAuth'
import { currency, currencyCompact, date, humanize } from '@/lib/format'
import {
  CONTRACT_STATUS_LABEL,
  CONTRACT_STATUS_TONE,
  QUOTATION_STATUS_TONE,
  SYSTEM_TYPE_LABEL,
} from '@/lib/labels'
import { useLeads, usePackages } from '@/lib/queries/crm'
import { useStock } from '@/lib/queries/inventory-finance'
import {
  useCounterSignContract,
  useContracts,
  useCreateContract,
  useQuotations,
  useSaveQuotation,
  useSendQuotation,
  useSetQuotationStatus,
} from '@/lib/queries/sales'
import { settingNum, useSettings } from '@/lib/queries/settings'
import { QueryState } from '@/components/ui/QueryState'
import type { Package, StockItem } from '@/types/domain'

/* ============================================================================
   QuotesPage — Quotations & automated Bill of Materials.
   ----------------------------------------------------------------------------
   Implements the spec's "Automated Bill of Materials (BOM) & Real-Time Stock
   Reservation". The chain it sits in:

     lead (CRM)  →  pick a package  →  BOM generated  →  quotation PDF
                                             │
                                    contract signed
                                             │
                        ┌────────────────────┴────────────────────┐
                        ▼                                         ▼
              stock reserved (Inventory)            project created (Projects)

   The BOM is derived, not typed by hand. That is the point: a quote and the
   materials it commits can never drift apart, and margin is visible before the
   quote is sent rather than discovered afterwards.
   ========================================================================== */

/** Quantities per kW for each system type — the recipe behind the BOM. */
/*
 * Keyed on SKU rather than database id. Ids differ between environments; a SKU
 * is the same string in development, staging and production, so the recipe
 * survives a restore into a fresh project.
 */
const RECIPE: Record<string, { sku: string; perKw: number }[]> = {
  on_grid: [
    { sku: 'PNL-CS-620', perKw: 1.7 },
    { sku: 'RCK-RAIL-42', perKw: 3 },
    { sku: 'ACC-MC4-PR', perKw: 4 },
  ],
  hybrid: [
    { sku: 'PNL-CS-620', perKw: 1.7 },
    { sku: 'INV-DEYE-6K', perKw: 0.17 },
    { sku: 'BAT-PYL-5K', perKw: 0.35 },
    { sku: 'RCK-RAIL-42', perKw: 3 },
    { sku: 'ACC-MC4-PR', perKw: 4 },
  ],
  off_grid: [
    { sku: 'PNL-CS-620', perKw: 1.7 },
    { sku: 'INV-DEYE-6K', perKw: 0.17 },
    { sku: 'BAT-PYL-5K', perKw: 0.6 },
    { sku: 'CTL-MPPT-60', perKw: 0.15 },
    { sku: 'RCK-RAIL-42', perKw: 3 },
  ],
}

function buildBom(pkg: Package, stock: StockItem[]) {
  return (
    (RECIPE[pkg.systemType] ?? [])
      .map((line) => {
        const item = stock.find((s) => s.sku === line.sku)
        if (!item) return null
        const quantity = Math.ceil(line.perKw * pkg.sizeKw)
        return {
          item,
          quantity,
          lineTotal: quantity * item.unitCost,
          available: item.onHand - item.reserved,
        }
      })
      // A recipe line whose SKU is not in the catalogue is skipped rather than
      // crashing the page — the catalogue is edited independently of the recipe.
      .filter((line): line is NonNullable<typeof line> => line !== null)
  )
}

export function QuotesPage() {
  const packagesQuery = usePackages()
  const leadsQuery = useLeads()
  const stockQuery = useStock()

  const PACKAGES = packagesQuery.data ?? []
  const LEADS = leadsQuery.data ?? []
  const STOCK = stockQuery.data ?? []

  // Default to the featured package and the first lead once they arrive.
  const [packageId, setPackageId] = useState<string>('')
  const [leadId, setLeadId] = useState<string>('')
  const [discount, setDiscount] = useState(0)

  const { user } = useAuth()
  const settings = useSettings().data
  const labourPct = settingNum(settings, 'pricing.labour_overhead_pct', 18)

  /* The help text under this slider says the starting margin comes from
     Settings. It did not — it was `useState(35)`, a literal, and the setting
     beside it was read by nothing. Somebody moving the company's target margin
     would have changed a number on a screen and nothing else.

     `undefined` until the settings arrive, so the slider adopts the configured
     figure on first load instead of snapping from 35 to it; once the rep moves
     it, their choice stands for the rest of the quote. */
  const defaultMargin = settingNum(settings, 'pricing.default_margin_pct', 35)
  const [marginOverride, setMarginOverride] = useState<number | null>(null)
  const margin = marginOverride ?? defaultMargin
  const setMargin = setMarginOverride
  const discountAuthority = settingNum(settings, 'sales.discount_authority_pct', 10)
  /* A company that does not negotiate should not see a discount control at
     all — one sitting under a published price list invites every rep to use it.
     The database refuses a discount when this is off, so hiding the slider is
     a courtesy rather than the control. */
  const discountSetting = settings?.find((s) => s.key === 'sales.discount_enabled')
  const discountAllowed = discountSetting ? discountSetting.value !== false : true
  const quoteValidDays = settingNum(settings, 'sales.quotation_validity_days', 30)

  const quotationsQuery = useQuotations()
  const quotations = quotationsQuery.data ?? []
  const contractsQuery = useContracts()
  const contracts = contractsQuery.data ?? []

  const saveQuotation = useSaveQuotation()
  const sendQuotation = useSendQuotation()
  const setQuotationStatus = useSetQuotationStatus()
  const createContract = useCreateContract()
  const counterSign = useCounterSignContract()

  const [savedRef, setSavedRef] = useState<string | null>(null)

  const pkg =
    PACKAGES.find((p) => p.id === packageId) ?? PACKAGES.find((p) => p.featured) ?? PACKAGES[0]
  const lead = LEADS.find((l) => l.id === leadId) ?? LEADS[0]

  // Nothing can be quoted before the catalogue loads.
  if (packagesQuery.isLoading || stockQuery.isLoading) {
    return (
      <>
        <PageHeader title="Quotations &amp; BOM" />
        <QueryState isLoading error={null}>
          {null}
        </QueryState>
      </>
    )
  }

  if (!pkg || !lead) {
    return (
      <>
        <PageHeader title="Quotations &amp; BOM" />
        <QueryState
          isLoading={false}
          error={null}
          isEmpty
          emptyIcon="&#128203;"
          emptyTitle="Nothing to quote yet"
          emptyMessage="A quotation needs at least one lead and one package."
        >
          {null}
        </QueryState>
      </>
    )
  }

  const bom = buildBom(pkg, STOCK)

  const materialCost = bom.reduce((sum, line) => sum + line.lineTotal, 0)
  // Labour and overhead as a share of material cost. The percentage is a
  // setting, so finance can move it without waiting for a deploy.
  const labourCost = materialCost * (labourPct / 100)
  const totalCost = materialCost + labourCost
  const listPrice = totalCost / (1 - margin / 100)
  const sellPrice = discountAllowed ? listPrice * (1 - discount / 100) : listPrice

  /* HOW FAR IS THIS FROM THE ADVERTISED PRICE?
     The quote is built bottom-up from the bill of materials; the website
     advertises a top-down "from" price for the same package. Nothing was
     comparing the two, so a rep could send a quote 30% above the figure the
     customer had already read on the public site and only find out when the
     customer said so. */
  const publishedPrice = pkg.priceFrom
  const priceVariance = publishedPrice > 0 ? (sellPrice - publishedPrice) / publishedPrice : 0

  const anyShort = bom.some((line) => line.available < line.quantity)
  const needsApproval = discountAllowed && discount > discountAuthority

  function handleSaveDraft() {
    setSavedRef(null)
    saveQuotation.mutate(
      {
        leadId: lead.id,
        packageId: pkg.id,
        systemKw: pkg.sizeKw,
        systemType: pkg.systemType,
        panelCount: bom.find((l) => l.item.category === 'panel')?.quantity,
        batteryCount: bom.find((l) => l.item.category === 'battery')?.quantity ?? 0,
        materialCost,
        labourCost,
        marginPct: margin,
        discountPct: discountAllowed ? discount : 0,
        totalPrice: Math.round(sellPrice),
        validDays: quoteValidDays,
        lines: bom.map((line) => ({
          stockItemId: line.item.id,
          description: `${line.item.name} (${line.item.sku})`,
          quantity: line.quantity,
          unitPrice: line.item.unitCost,
        })),
      },
      { onSuccess: (result) => setSavedRef(result.reference) },
    )
  }

  /* Converting is one click for the rep and a chain of consequences in the
     database, so the quotation is marked accepted first and the contract raised
     from it — rather than the button doing something the audit trail cannot
     later explain. */
  function convertToContract(quotationId: string, leadId_: string, value: number) {
    setQuotationStatus.mutate(
      { id: quotationId, status: 'accepted' },
      {
        onSuccess: () => {
          const matchedLead = LEADS.find((l) => l.id === leadId_)
          createContract.mutate({
            quotationId,
            leadId: leadId_,
            // A lead only has a client account once they have been converted.
            // Until then the contract is raised unassigned and linked when the
            // customer's portal account is created.
            clientId: undefined,
            contractValue: value || Math.round(sellPrice),
          })
          void matchedLead
        },
      },
    )
  }

  return (
    <>
      <PageHeader
        title="Quotations & BOM"
        description="Build a quote from a package; the bill of materials and margin calculate themselves."
        actions={
          <Button variant="primary" onClick={handleSaveDraft} disabled={saveQuotation.isPending}>
            {saveQuotation.isPending ? 'Saving…' : 'Save quotation'}
          </Button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Material cost" value={currencyCompact(materialCost)} />
        <StatTile label="Labour & overhead" value={currencyCompact(labourCost)} />
        <StatTile
          label="Quoted price"
          value={currencyCompact(sellPrice)}
          /* Against the price this package is advertised at. Rising is bad
             here: it means the customer is being asked for more than the site
             led them to expect. */
          delta={
            publishedPrice > 0
              ? `${priceVariance >= 0 ? '+' : ''}${Math.round(priceVariance * 100)}% vs advertised ${currencyCompact(publishedPrice)}`
              : undefined
          }
          direction={Math.abs(priceVariance) < 0.05 ? 'flat' : priceVariance > 0 ? 'up' : 'down'}
          invertDelta
        />
        <StatTile
          label="Gross margin"
          value={currencyCompact(sellPrice - totalCost)}
          delta={`${margin}% target`}
          direction="up"
        />
      </div>

      <div className="grid grid--2" style={{ alignItems: 'start' }}>
        {/* --------------------------------------------- CONFIGURATION */}
        <Card>
          <CardHeader title="Quote configuration" />
          <CardBody>
            <div className="stack">
              <div className="field">
                <label className="field__label" htmlFor="qlead">
                  Lead
                </label>
                <select
                  id="qlead"
                  className="select"
                  value={leadId}
                  onChange={(e) => setLeadId(e.target.value)}
                >
                  {LEADS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} — {l.location} ({l.estimatedKw} kW)
                    </option>
                  ))}
                </select>
                <span className="field__hint">
                  Estimator submission suggests {lead.estimatedKw} kW from a{' '}
                  {currency(lead.monthlyBill)}/month bill.
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="qpkg">
                  Package
                </label>
                <select
                  id="qpkg"
                  className="select"
                  value={packageId}
                  onChange={(e) => setPackageId(e.target.value)}
                >
                  {PACKAGES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.sizeKw} kWp {SYSTEM_TYPE_LABEL[p.systemType]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="qmargin">
                  Target gross margin — {margin}%
                </label>
                <input
                  id="qmargin"
                  type="range"
                  min={10}
                  max={60}
                  value={margin}
                  onChange={(e) => setMargin(Number(e.target.value))}
                />
                <span className="field__hint">
                  The starting margin comes from Settings and can be changed per quote.
                </span>
              </div>

              {discountAllowed && (
                <div className="field">
                  <label className="field__label" htmlFor="qdiscount">
                    Discount — {discount}%
                  </label>
                  <input
                    id="qdiscount"
                    type="range"
                    min={0}
                    max={40}
                    value={discount}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                  />
                  <span
                    className="field__hint"
                    style={{ color: needsApproval ? 'var(--danger-fg)' : undefined }}
                  >
                    {needsApproval
                      ? `Above your ${discountAuthority}% authority — the database will hold this for administrator approval and write it to the audit log.`
                      : `You may discount up to ${discountAuthority}% without approval.`}
                  </span>
                </div>
              )}

              <hr />

              <div className="stack stack--sm">
                <div className="row row--between">
                  <span className="muted">Material cost</span>
                  <span className="num">{currency(materialCost)}</span>
                </div>
                <div className="row row--between">
                  <span className="muted">Labour &amp; overhead ({labourPct}%)</span>
                  <span className="num">{currency(labourCost)}</span>
                </div>
                <div className="row row--between">
                  <span className="muted">Total cost</span>
                  <span className="num strong">{currency(totalCost)}</span>
                </div>
                {discount > 0 && (
                  <>
                    <div className="row row--between">
                      <span className="muted">List price</span>
                      <span className="num">{currency(listPrice)}</span>
                    </div>
                    <div className="row row--between">
                      <span className="muted">Discount ({discount}%)</span>
                      <span className="num" style={{ color: 'var(--danger-fg)' }}>
                        −{currency(listPrice - sellPrice)}
                      </span>
                    </div>
                  </>
                )}
                <hr />
                <div className="row row--between">
                  <span className="strong">Quoted price</span>
                  <span
                    className="num strong"
                    style={{ fontSize: 'var(--text-xl)', color: 'var(--text-brand)' }}
                  >
                    {currency(sellPrice)}
                  </span>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* ------------------------------------------- GENERATED BOM */}
        <Card>
          <CardHeader
            title="Generated bill of materials"
            action={
              <Badge tone={anyShort ? 'danger' : 'success'}>
                {anyShort ? 'Stock shortfall' : 'Stock available'}
              </Badge>
            }
          />
          <CardBody>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="table__num">Qty</th>
                    <th className="table__num">Available</th>
                    <th className="table__num">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.map((line) => (
                    <tr key={line.item.id}>
                      <td>
                        <div className="strong small">{line.item.name}</div>
                        <div className="xs dim">{line.item.sku}</div>
                      </td>
                      <td className="table__num strong">{line.quantity}</td>
                      <td className="table__num">
                        <span
                          style={{
                            color: line.available < line.quantity ? 'var(--danger-fg)' : undefined,
                          }}
                        >
                          {line.available}
                        </span>
                      </td>
                      <td className="table__num">{currency(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {anyShort && (
              <p
                className="small"
                style={{
                  marginTop: 'var(--space-4)',
                  padding: 'var(--space-3)',
                  background: 'var(--danger-bg)',
                  color: 'var(--danger-fg)',
                  borderRadius: 'var(--radius)',
                }}
              >
                ⚠ One or more items have insufficient free stock. The quote can still be sent, but
                procurement must be raised before the contract is signed — otherwise the reservation
                will fail.
              </p>
            )}

            {savedRef && (
              <p
                className="small"
                style={{
                  marginTop: 'var(--space-4)',
                  padding: 'var(--space-3)',
                  background: 'var(--success-bg)',
                  color: 'var(--success-fg)',
                  borderRadius: 'var(--radius)',
                }}
              >
                Saved as <strong>{savedRef}</strong>. It is in the list below as a draft — send it
                when you are ready.
              </p>
            )}

            <FormError error={saveQuotation.error} />

            <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
              Saving records this bill of materials against the quotation, so the quote and the
              materials it commits can never drift apart. Stock is reserved later, when the contract
              is counter-signed.
            </p>
          </CardBody>
        </Card>
      </div>

      {/* ============================================================
          THE PIPELINE
          ------------------------------------------------------------
          Everything saved above, and what has to happen next to each
          one. Kept on the same screen as the builder because a rep who
          has to go looking for their drafts stops sending them. */}
      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardHeader
          title="Quotations"
          action={<span className="xs dim">{quotations.length} most recent</span>}
        />
        <CardBody>
          <QueryState
            isLoading={quotationsQuery.isLoading}
            error={quotationsQuery.error as Error | null}
            isEmpty={quotations.length === 0}
            emptyIcon="📄"
            emptyTitle="No quotations yet"
            emptyMessage="Build one above and save it."
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Customer</th>
                    <th>System</th>
                    <th className="table__num">Price</th>
                    <th>Status</th>
                    <th>Valid until</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {quotations.map((q) => (
                    <tr key={q.id}>
                      <td>
                        <code>{q.reference}</code>
                      </td>
                      <td className="strong small">{q.leadName}</td>
                      <td className="small">
                        {q.systemKw} kW {SYSTEM_TYPE_LABEL[q.systemType]}
                        {q.discountPct > 0 && (
                          <span className="xs dim"> · {q.discountPct}% off</span>
                        )}
                      </td>
                      <td className="table__num">{currency(q.totalPrice)}</td>
                      <td>
                        <Badge tone={QUOTATION_STATUS_TONE[q.status] ?? 'neutral'}>
                          {humanize(q.status)}
                        </Badge>
                      </td>
                      <td className="small">{q.validUntil ? date(q.validUntil) : '—'}</td>
                      <td>
                        {q.status === 'draft' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={sendQuotation.isPending}
                            onClick={() => sendQuotation.mutate({ id: q.id })}
                          >
                            Send
                          </Button>
                        )}
                        {q.status === 'sent' && !q.hasContract && (
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={createContract.isPending}
                            onClick={() => convertToContract(q.id, q.leadId, q.totalPrice)}
                          >
                            Customer accepted
                          </Button>
                        )}
                        {q.hasContract && <span className="xs dim">Contract raised</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <FormError error={sendQuotation.error ?? createContract.error} />
          </QueryState>
        </CardBody>
      </Card>

      {/* ------------------------------------------------- CONTRACTS */}
      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardHeader title="Contracts" />
        <CardBody>
          <QueryState
            isLoading={contractsQuery.isLoading}
            error={contractsQuery.error as Error | null}
            isEmpty={contracts.length === 0}
            emptyIcon="✍️"
            emptyTitle="No contracts yet"
            emptyMessage="Mark a sent quotation as accepted to raise one."
          >
            <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
              Counter-signing is the most consequential action in this application. It creates the
              project, reserves the warehouse stock against it and raises the down-payment invoice —
              all in one transaction, so none of it can half-happen.
            </p>

            <div className="stack stack--sm">
              {contracts.map((c) => (
                <div
                  key={c.id}
                  className="row row--between"
                  style={{
                    padding: 'var(--space-3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      <code>{c.reference}</code>
                      <Badge tone={CONTRACT_STATUS_TONE[c.status] ?? 'neutral'}>
                        {CONTRACT_STATUS_LABEL[c.status] ?? humanize(c.status)}
                      </Badge>
                    </div>
                    <div className="xs dim" style={{ marginTop: 2 }}>
                      {c.clientName} · {currency(c.contractValue)} · {c.downPaymentPct}/
                      {c.deliveryPct}/{c.commissioningPct} split
                      {c.clientSignedAt
                        ? ` · signed by ${c.clientSignatureName} on ${date(c.clientSignedAt)}`
                        : ' · not yet signed by the customer'}
                    </div>
                  </div>

                  {c.status === 'awaiting_company' && user && (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={counterSign.isPending}
                      onClick={() => counterSign.mutate({ contractId: c.id, userId: user.id })}
                    >
                      Counter-sign &amp; start the project
                    </Button>
                  )}
                  {c.status === 'awaiting_client' && (
                    <span className="xs dim">Waiting on the customer</span>
                  )}
                  {c.status === 'executed' && <span className="xs dim">Project running</span>}
                </div>
              ))}
            </div>

            <FormError error={counterSign.error} />
          </QueryState>
        </CardBody>
      </Card>
    </>
  )
}
