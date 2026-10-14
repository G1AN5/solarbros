import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { QuotationDocument, type QuotationDocumentData } from '@/components/ui/QuotationDocument'
import { StatTile } from '@/components/ui/StatTile'
import { useAuth } from '@/app/auth/useAuth'
import { bomGaps, suggestBom } from '@/lib/bom'
import { currency, currencyCompact, date, humanize } from '@/lib/format'
import {
  CONTRACT_STATUS_LABEL,
  CONTRACT_STATUS_TONE,
  QUOTATION_STATUS_TONE,
  STOCK_CATEGORY_LABEL,
  SYSTEM_TYPE_LABEL,
} from '@/lib/labels'
import { useLeads, usePackages } from '@/lib/queries/crm'
import { useEnquiry } from '@/lib/queries/enquiries'
import { useStock } from '@/lib/queries/inventory-finance'
import { useCompany } from '@/lib/queries/public-site'
import {
  useApproveDiscount,
  useCancelContract,
  useContracts,
  useCounterSignContract,
  useCreateContract,
  useDiscardQuotation,
  useQuotationItems,
  useQuotations,
  useSaveQuotation,
  useSendQuotation,
  useSetQuotationStatus,
  type QuotationRow,
} from '@/lib/queries/sales'
import { settingNum, useSettings, useSystemAssumptions } from '@/lib/queries/settings'
import { QueryState } from '@/components/ui/QueryState'
import type { SystemType } from '@/types/domain'

/* ============================================================================
   QuotesPage — Quotations & the bill of materials.
   ----------------------------------------------------------------------------
   The chain it sits in:

     lead (Enquiries / CRM)  →  size the system  →  bill of materials  →
     quotation  →  sent  →  accepted (by the customer, or recorded for them)
                                     │
                              contract raised  →  customer signs  →
                              counter-signed   →  project, stock, invoice

   THE BILL OF MATERIALS IS A DRAFT YOU EDIT
   It used to be generated from a fixed recipe and could not be changed — and
   the recipe named SKUs the catalogue did not have, so hybrid quotations went
   out with no inverter and no batteries on them. It is now suggested from the
   catalogue (src/lib/bom.ts), with the reason for each quantity shown beside
   it, and every line can be changed, removed or added to. An engineer looking
   at a real roof knows things a rule does not.
   ========================================================================== */

interface DraftLine {
  stockItemId: string
  quantity: number
  rule?: string
}

export function QuotesPage() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const company = useCompany()

  const packagesQuery = usePackages()
  const leadsQuery = useLeads()
  const stockQuery = useStock()
  const quotationsQuery = useQuotations()
  const contractsQuery = useContracts()

  const PACKAGES = packagesQuery.data ?? []
  const STOCK = stockQuery.data ?? []
  // Only leads still in play. A lost lead is not quoted; an installed one has
  // its system already.
  const LEADS = (leadsQuery.data ?? []).filter((l) => l.stage !== 'lost' && l.stage !== 'installed')
  const quotations = quotationsQuery.data ?? []
  const contracts = contractsQuery.data ?? []

  const settings = useSettings().data
  const hardware = useSystemAssumptions()
  const labourPct = settingNum(settings, 'pricing.labour_overhead_pct', 18)
  const defaultMargin = settingNum(settings, 'pricing.default_margin_pct', 35)
  const discountAuthority = settingNum(settings, 'sales.discount_authority_pct', 10)
  const discountSetting = settings?.find((s) => s.key === 'sales.discount_enabled')
  const discountAllowed = discountSetting ? discountSetting.value !== false : true
  const quoteValidDays = settingNum(settings, 'sales.quotation_validity_days', 30)
  const batteriesIncluded = settingNum(settings, 'pricing.batteries_included', 3)
  const split = {
    downPayment: settingNum(settings, 'finance.down_payment_pct', 50),
    delivery: settingNum(settings, 'finance.delivery_pct', 35),
    commissioning: settingNum(settings, 'finance.commissioning_pct', 15),
  }

  /* --- What is being quoted ------------------------------------------------ */
  const [leadId, setLeadId] = useState<string>(() => searchParams.get('lead') ?? '')
  const [packageId, setPackageId] = useState<string>('')
  const [kwOverride, setKwOverride] = useState<number | null>(null)
  const [typeOverride, setTypeOverride] = useState<SystemType | null>(null)
  const [marginOverride, setMarginOverride] = useState<number | null>(null)
  const [discount, setDiscount] = useState(0)
  /** Null means "use the suggestion"; an edit takes a copy. */
  const [editedLines, setEditedLines] = useState<DraftLine[] | null>(null)
  const [addItemId, setAddItemId] = useState('')
  const [saved, setSaved] = useState<{ reference: string; status: string } | null>(null)

  const lead = LEADS.find((l) => l.id === leadId)
  const enquiry = useEnquiry(lead?.id).data
  const estimate = enquiry?.estimates[0]
  const pkg = PACKAGES.find((p) => p.id === packageId)

  const systemKw = kwOverride ?? pkg?.sizeKw ?? estimate?.recommendedKw ?? lead?.estimatedKw ?? 0
  const systemType: SystemType = typeOverride ?? pkg?.systemType ?? estimate?.systemType ?? 'hybrid'
  const margin = marginOverride ?? defaultMargin

  // Recomputed as the inputs change; the React Compiler memoises it.
  const suggestion = suggestBom({
    systemKw,
    systemType,
    stock: STOCK,
    panelWatts: hardware.panelWatts,
    batteryKwh: hardware.batteryKwh,
    batteriesIncluded,
  })

  /* A package with its own equipment list starts from that list — as long as
     it is still the package's size and type. Resizing it makes it a custom
     system, which the sizing rules draft instead. */
  const packageLines: DraftLine[] | null =
    pkg && pkg.bom.length > 0 && kwOverride === null && typeOverride === null
      ? pkg.bom.map((line) => ({ ...line }))
      : null
  const linesFrom = editedLines ? 'edited' : packageLines ? 'package' : 'rules'
  const lines: DraftLine[] = editedLines ?? packageLines ?? suggestion.lines
  const bom = lines
    .map((line) => {
      const item = STOCK.find((s) => s.id === line.stockItemId)
      if (!item) return null
      return {
        ...line,
        item,
        lineTotal: line.quantity * item.unitCost,
        available: item.onHand - item.reserved,
      }
    })
    .filter((line): line is NonNullable<typeof line> => line !== null)

  // Any change to what the system IS rebuilds the suggestion.
  function resize(change: () => void) {
    change()
    setEditedLines(null)
    setSaved(null)
  }

  function editLines(update: (current: DraftLine[]) => DraftLine[]) {
    setEditedLines(update(lines.map((l) => ({ ...l }))))
    setSaved(null)
  }

  /* The rules report what they could not fill. A list from a package or one
     edited by hand is checked for the essentials instead. */
  const bomWarnings =
    linesFrom === 'rules'
      ? suggestion.warnings
      : bom.length > 0
        ? bomGaps(
            systemType,
            bom.map((line) => line.item.category),
          )
        : []

  const materialCost = bom.reduce((sum, line) => sum + line.lineTotal, 0)
  const labourCost = materialCost * (labourPct / 100)
  const totalCost = materialCost + labourCost
  const listPrice = totalCost / (1 - margin / 100)
  const sellPrice = discountAllowed ? listPrice * (1 - discount / 100) : listPrice
  const anyShort = bom.some((line) => line.available < line.quantity)
  const needsApproval = discountAllowed && discount > discountAuthority && user?.role !== 'admin'
  const leadHasLiveContract = contracts.some(
    (c) =>
      c.status !== 'cancelled' &&
      quotations.find((q) => q.id === c.quotationId)?.leadId === lead?.id,
  )

  /* --- Actions ------------------------------------------------------------- */
  const saveQuotation = useSaveQuotation()
  const sendQuotation = useSendQuotation()
  const setQuotationStatus = useSetQuotationStatus()
  const approveDiscount = useApproveDiscount()
  const discardQuotation = useDiscardQuotation()
  const createContract = useCreateContract()
  const counterSign = useCounterSignContract()
  const cancelContract = useCancelContract()

  const [declining, setDeclining] = useState<QuotationRow | null>(null)
  const [printing, setPrinting] = useState<QuotationRow | null>(null)
  const printItems = useQuotationItems(printing?.id).data ?? []

  function handleSave() {
    if (!lead) return
    setSaved(null)
    saveQuotation.mutate(
      {
        leadId: lead.id,
        packageId: pkg?.id,
        systemKw,
        systemType,
        panelCount:
          bom.filter((l) => l.item.category === 'panel').reduce((s, l) => s + l.quantity, 0) ||
          undefined,
        batteryCount: bom
          .filter((l) => l.item.category === 'battery')
          .reduce((s, l) => s + l.quantity, 0),
        materialCost: Math.round(materialCost * 100) / 100,
        labourCost: Math.round(labourCost * 100) / 100,
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
      {
        onSuccess: (result) => {
          setSaved({ reference: result.reference, status: result.status })
          setDiscount(0)
        },
      },
    )
  }

  function raiseContract(q: QuotationRow) {
    createContract.mutate({ quotationId: q.id, leadId: q.leadId, contractValue: q.totalPrice })
  }

  function documentFor(q: QuotationRow): QuotationDocumentData {
    return {
      reference: q.reference,
      issuedAt: q.sentAt ?? q.createdAt,
      validUntil: q.validUntil,
      customerName: q.leadName,
      customerEmail: q.leadEmail,
      siteAddress: q.leadAddress,
      systemKw: q.systemKw,
      systemType: q.systemType,
      panelCount: q.panelCount,
      batteryCount: q.batteryCount,
      totalPrice: q.totalPrice,
      discountPct: q.discountPct,
      items: printItems,
      split,
      warranty: {
        panelYears: company.warrantyPanelYears,
        inverterYears: company.warrantyInverterYears,
        batteryYears: company.warrantyBatteryYears,
        workmanshipYears: company.warrantyWorkmanshipYears,
      },
      company: {
        name: company.name,
        address: company.address,
        email: company.email,
        phone: company.phone,
      },
    }
  }

  /* Quotations are written by Sales, engineers and administrators; the
     accountant opens this page for the contracts. Offering them buttons the
     database then refuses would read as a fault. */
  const writesQuotations =
    user?.role === 'sales' || user?.role === 'admin' || user?.role === 'project_engineer'

  const actionError =
    sendQuotation.error ??
    setQuotationStatus.error ??
    approveDiscount.error ??
    discardQuotation.error ??
    createContract.error

  if (packagesQuery.isLoading || stockQuery.isLoading || leadsQuery.isLoading) {
    return (
      <>
        <PageHeader title="Quotations & BOM" />
        <QueryState isLoading error={null}>
          {null}
        </QueryState>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Quotations & BOM"
        description="Size the system, check the bill of materials, price it and send it."
        actions={
          writesQuotations ? (
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saveQuotation.isPending || !lead || bom.length === 0}
            >
              {saveQuotation.isPending ? 'Saving…' : 'Save quotation'}
            </Button>
          ) : undefined
        }
      />

      {!writesQuotations && (
        <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
          Quotations are prepared and sent by Sales. From here you can raise a contract from an
          accepted quotation, counter-sign, and print any quotation.
        </p>
      )}

      <div className="grid grid--4" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile label="Material cost" value={currencyCompact(materialCost)} />
        <StatTile label="Labour & overhead" value={currencyCompact(labourCost)} />
        <StatTile
          label="Quoted price"
          value={currencyCompact(sellPrice)}
          delta={
            pkg && pkg.priceFrom > 0
              ? `${sellPrice >= pkg.priceFrom ? '+' : ''}${Math.round(
                  ((sellPrice - pkg.priceFrom) / pkg.priceFrom) * 100,
                )}% vs advertised ${currencyCompact(pkg.priceFrom)}`
              : undefined
          }
          direction="flat"
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
          <CardHeader title="1 · Who and what" />
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
                  onChange={(e) =>
                    resize(() => {
                      setLeadId(e.target.value)
                      setPackageId('')
                      setKwOverride(null)
                      setTypeOverride(null)
                    })
                  }
                >
                  <option value="" disabled>
                    Choose a lead…
                  </option>
                  {LEADS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} · {l.email}
                      {l.location ? ` · ${l.location}` : ''}
                    </option>
                  ))}
                </select>
                {leadHasLiveContract && (
                  <span className="field__hint" style={{ color: 'var(--danger-fg)' }}>
                    This customer already has a contract in progress. A new quotation can be saved,
                    but its contract will be refused until the current one is cancelled.
                  </span>
                )}
              </div>

              {/* What they told the estimator — the starting point for sizing. */}
              {estimate && (
                <div
                  className="small"
                  style={{
                    padding: 'var(--space-3)',
                    background: 'var(--ink-50)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div className="row row--between row--wrap">
                    <span>
                      Estimator recommended <strong>{estimate.recommendedKw} kWp</strong>{' '}
                      {estimate.systemType ? SYSTEM_TYPE_LABEL[estimate.systemType] : ''} from{' '}
                      {estimate.appliances.length} appliances ({estimate.monthlyKwh} kWh/month)
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        resize(() => {
                          setPackageId('')
                          setKwOverride(estimate.recommendedKw)
                          setTypeOverride(estimate.systemType)
                        })
                      }
                    >
                      Use this
                    </Button>
                  </div>
                </div>
              )}

              <div className="field">
                <label className="field__label" htmlFor="qpkg">
                  Start from a package <span className="dim">(optional)</span>
                </label>
                <select
                  id="qpkg"
                  className="select"
                  value={packageId}
                  onChange={(e) =>
                    resize(() => {
                      setPackageId(e.target.value)
                      setKwOverride(null)
                      setTypeOverride(null)
                    })
                  }
                >
                  <option value="">Custom size</option>
                  {PACKAGES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.sizeKw} kWp {SYSTEM_TYPE_LABEL[p.systemType]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field__label" htmlFor="qkw">
                    System size (kWp)
                  </label>
                  <input
                    id="qkw"
                    className="input"
                    type="number"
                    min={0.5}
                    step={0.1}
                    value={systemKw || ''}
                    onChange={(e) => resize(() => setKwOverride(Number(e.target.value) || 0))}
                  />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label className="field__label" htmlFor="qtype">
                    System type
                  </label>
                  <select
                    id="qtype"
                    className="select"
                    value={systemType}
                    onChange={(e) => resize(() => setTypeOverride(e.target.value as SystemType))}
                  >
                    <option value="on_grid">{SYSTEM_TYPE_LABEL.on_grid}</option>
                    <option value="hybrid">{SYSTEM_TYPE_LABEL.hybrid}</option>
                    <option value="off_grid">{SYSTEM_TYPE_LABEL.off_grid}</option>
                  </select>
                </div>
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
                  onChange={(e) => setMarginOverride(Number(e.target.value))}
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
                    style={{ color: needsApproval ? 'var(--warning-fg)' : undefined }}
                  >
                    {needsApproval
                      ? `Above your ${discountAuthority}% authority — it saves as "pending approval" and an administrator is notified to approve it before it can be sent.`
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
                {discount > 0 && discountAllowed && (
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

        {/* ------------------------------------------- BILL OF MATERIALS */}
        <Card>
          <CardHeader
            title="2 · Bill of materials"
            action={
              <Badge tone={anyShort ? 'warning' : 'success'}>
                {anyShort ? 'Some stock to order' : 'In stock'}
              </Badge>
            }
          />
          <CardBody>
            {/* Where the list came from, so nobody mistakes a package's
                standard list for one sized to this customer, or the reverse. */}
            {pkg && lead && (
              <p className="xs dim" style={{ marginBottom: 'var(--space-3)' }}>
                {linesFrom === 'package'
                  ? `Starting from the ${pkg.name} package's equipment list. Change anything this customer needs.`
                  : linesFrom === 'rules' && pkg.bom.length === 0
                    ? `The ${pkg.name} package has no equipment list yet, so this is drafted from the sizing rules. Lists are kept under Website Content → Packages.`
                    : linesFrom === 'rules'
                      ? `Resized from the ${pkg.name} package, so this is drafted from the sizing rules.`
                      : null}
              </p>
            )}

            {bomWarnings.length > 0 && (
              <div
                className="small"
                style={{
                  marginBottom: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  background: 'var(--warning-bg)',
                  color: 'var(--warning-fg)',
                  borderRadius: 'var(--radius)',
                }}
              >
                {bomWarnings.map((w) => (
                  <div key={w}>⚠ {w}</div>
                ))}
              </div>
            )}

            {bom.length === 0 ? (
              <p className="small muted">
                {lead
                  ? 'Enter a system size, or add items below.'
                  : 'Choose a lead to start a quotation.'}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="table__num">Qty</th>
                      <th className="table__num">Free</th>
                      <th className="table__num">Line total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {bom.map((line, index) => (
                      <tr key={`${line.stockItemId}-${index}`}>
                        <td>
                          <select
                            className="select"
                            style={{ fontSize: 'var(--text-xs)', minWidth: 160 }}
                            value={line.stockItemId}
                            onChange={(e) =>
                              editLines((current) =>
                                current.map((l, i) =>
                                  i === index
                                    ? { ...l, stockItemId: e.target.value, rule: undefined }
                                    : l,
                                ),
                              )
                            }
                            aria-label="Item"
                          >
                            {STOCK.filter((s) => s.category === line.item.category).map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                          {line.rule && <div className="xs dim">{line.rule}</div>}
                        </td>
                        <td className="table__num">
                          <input
                            className="input"
                            type="number"
                            min={1}
                            style={{ width: 72 }}
                            value={line.quantity}
                            onChange={(e) =>
                              editLines((current) =>
                                current.map((l, i) =>
                                  i === index
                                    ? { ...l, quantity: Math.max(1, Number(e.target.value) || 1) }
                                    : l,
                                ),
                              )
                            }
                            aria-label={`Quantity of ${line.item.name}`}
                          />
                        </td>
                        <td className="table__num">
                          <span
                            style={{
                              color:
                                line.available < line.quantity ? 'var(--danger-fg)' : undefined,
                            }}
                          >
                            {line.available}
                          </span>
                        </td>
                        <td className="table__num">{currency(line.lineTotal)}</td>
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              editLines((current) => current.filter((_, i) => i !== index))
                            }
                            aria-label={`Remove ${line.item.name}`}
                          >
                            ✕
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <select
                className="select"
                value={addItemId}
                onChange={(e) => setAddItemId(e.target.value)}
                aria-label="Add an item"
              >
                <option value="">Add an item from the catalogue…</option>
                {STOCK.map((s) => (
                  <option key={s.id} value={s.id}>
                    {STOCK_CATEGORY_LABEL[s.category]} · {s.name}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                disabled={!addItemId}
                onClick={() => {
                  editLines((current) => [...current, { stockItemId: addItemId, quantity: 1 }])
                  setAddItemId('')
                }}
              >
                Add
              </Button>
              {editedLines && (
                <Button variant="ghost" onClick={() => setEditedLines(null)}>
                  Reset
                </Button>
              )}
            </div>

            {anyShort && (
              <p className="small muted" style={{ marginTop: 'var(--space-3)' }}>
                Items in red are not all free in the warehouse. The quotation can still go out —
                when the contract is counter-signed the shortfall is held as &ldquo;short&rdquo; and
                listed under Purchasing for the inventory manager to order.
              </p>
            )}

            {saved && (
              <p
                className="small"
                style={{
                  marginTop: 'var(--space-4)',
                  padding: 'var(--space-3)',
                  background:
                    saved.status === 'pending_approval' ? 'var(--warning-bg)' : 'var(--success-bg)',
                  color:
                    saved.status === 'pending_approval' ? 'var(--warning-fg)' : 'var(--success-fg)',
                  borderRadius: 'var(--radius)',
                }}
              >
                Saved as <strong>{saved.reference}</strong>.{' '}
                {saved.status === 'pending_approval'
                  ? 'The discount needs an administrator’s approval — they have been notified. It can be sent once approved.'
                  : 'It is in the list below as a draft — send it when you are ready.'}
              </p>
            )}

            <FormError error={saveQuotation.error} />
          </CardBody>
        </Card>
      </div>

      {/* ============================================================
          THE PIPELINE
          Everything saved above, and what has to happen next to each. */}
      <Card style={{ marginTop: 'var(--space-6)' }}>
        <CardHeader
          title="Quotations"
          action={<span className="xs dim">{quotations.length} most recent</span>}
        />
        <CardBody>
          <FormError error={actionError} />
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
                        <div className="xs dim">v{q.version}</div>
                      </td>
                      <td>
                        <div className="strong small">{q.leadName}</div>
                        <div className="xs dim">{q.leadEmail}</div>
                      </td>
                      <td className="small">
                        {q.systemKw} kW {SYSTEM_TYPE_LABEL[q.systemType]}
                        {q.discountPct > 0 && (
                          <span className="xs dim">
                            {' '}
                            · {q.discountPct}% off{q.discountApproved ? ' (approved)' : ''}
                          </span>
                        )}
                      </td>
                      <td className="table__num">{currency(q.totalPrice)}</td>
                      <td>
                        <Badge tone={QUOTATION_STATUS_TONE[q.status] ?? 'neutral'}>
                          {q.status === 'pending_approval'
                            ? 'Awaiting approval'
                            : humanize(q.status)}
                        </Badge>
                        {q.rejectionReason && (
                          <div className="xs dim" style={{ maxWidth: '28ch' }}>
                            {q.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td className="small">{q.validUntil ? date(q.validUntil) : '—'}</td>
                      <td>
                        <div className="row row--wrap" style={{ gap: 4 }}>
                          {q.status === 'draft' && writesQuotations && (
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={sendQuotation.isPending}
                              onClick={() => sendQuotation.mutate({ id: q.id })}
                              title="Marks it sent and notifies the customer"
                            >
                              Send
                            </Button>
                          )}
                          {q.status === 'pending_approval' && user?.role === 'admin' && (
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={approveDiscount.isPending}
                              onClick={() => approveDiscount.mutate({ id: q.id, userId: user.id })}
                            >
                              Approve discount
                            </Button>
                          )}
                          {q.status === 'pending_approval' && user?.role !== 'admin' && (
                            <span className="xs dim">Waiting for an administrator</span>
                          )}
                          {q.status === 'sent' && writesQuotations && (
                            <>
                              <Button
                                variant="primary"
                                size="sm"
                                disabled={setQuotationStatus.isPending}
                                onClick={() =>
                                  setQuotationStatus.mutate({ id: q.id, status: 'accepted' })
                                }
                                title="Record that the customer said yes — by phone, email or in person"
                              >
                                Customer accepted
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setDeclining(q)}>
                                Declined…
                              </Button>
                            </>
                          )}
                          {q.status === 'accepted' && !q.hasContract && (
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={createContract.isPending}
                              onClick={() => raiseContract(q)}
                            >
                              Raise contract
                            </Button>
                          )}
                          {q.hasContract && <span className="xs dim">Contract raised</span>}
                          {q.status !== 'draft' && q.status !== 'pending_approval' && (
                            <Button variant="ghost" size="sm" onClick={() => setPrinting(q)}>
                              Print
                            </Button>
                          )}
                          {(q.status === 'draft' || q.status === 'pending_approval') && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => setPrinting(q)}>
                                Preview
                              </Button>
                              {writesQuotations && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={discardQuotation.isPending}
                                  onClick={() => {
                                    if (window.confirm(`Discard draft ${q.reference}?`)) {
                                      discardQuotation.mutate({ id: q.id })
                                    }
                                  }}
                                >
                                  Discard
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            emptyMessage="Raise one from an accepted quotation."
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
                  className="row row--between row--wrap"
                  style={{
                    padding: 'var(--space-3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    gap: 'var(--space-3)',
                    opacity: c.status === 'cancelled' ? 0.6 : 1,
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
                      {c.clientId ? c.clientName : 'No customer account yet'} ·{' '}
                      {currency(c.contractValue)} · {c.downPaymentPct}/{c.deliveryPct}/
                      {c.commissioningPct} split
                      {c.clientSignedAt
                        ? ` · signed by ${c.clientSignatureName} on ${date(c.clientSignedAt)}`
                        : c.status === 'awaiting_client'
                          ? ' · not yet signed by the customer'
                          : ''}
                    </div>
                    {!c.clientId && c.status === 'awaiting_client' && (
                      <div className="xs" style={{ color: 'var(--warning-fg)' }}>
                        The customer has been emailed to create an account with the address on their
                        enquiry — it is linked the moment they do, and appears on their dashboard to
                        sign.
                      </div>
                    )}
                  </div>

                  <div className="row" style={{ gap: 4 }}>
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
                    {(c.status === 'awaiting_client' || c.status === 'awaiting_company') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={cancelContract.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Withdraw ${c.reference}? The customer is told it is no longer active.`,
                            )
                          ) {
                            cancelContract.mutate({ id: c.id })
                          }
                        }}
                      >
                        Withdraw
                      </Button>
                    )}
                    {c.status === 'executed' && (
                      <Link className="btn btn--ghost btn--sm" to="/admin/projects">
                        Project running →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <FormError error={counterSign.error ?? cancelContract.error} />
          </QueryState>
        </CardBody>
      </Card>

      {/* --------------------------------------------- CUSTOMER DECLINED */}
      <Modal
        open={declining !== null}
        onClose={() => {
          setDeclining(null)
          setQuotationStatus.reset()
        }}
        title={declining ? `Declined · ${declining.reference}` : 'Declined'}
      >
        {declining && (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault()
              const reason = String(new FormData(event.currentTarget).get('reason') ?? '')
              setQuotationStatus.mutate(
                { id: declining.id, status: 'rejected', reason },
                { onSuccess: () => setDeclining(null) },
              )
            }}
          >
            <div className="field">
              <label className="field__label" htmlFor="decline-why">
                Why did they say no?
              </label>
              <input
                id="decline-why"
                name="reason"
                className="input"
                required
                placeholder="Price, timing, went with a competitor…"
              />
              <span className="field__hint">
                Kept on the quotation. A revised version can be built above at any time.
              </span>
            </div>
            <FormError error={setQuotationStatus.error} />
            <Button type="submit" variant="primary" block disabled={setQuotationStatus.isPending}>
              Record it
            </Button>
          </form>
        )}
      </Modal>

      <QuotationDocument
        open={printing !== null}
        onClose={() => setPrinting(null)}
        data={printing ? documentFor(printing) : null}
      />
    </>
  )
}
