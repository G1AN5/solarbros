import { type FormEvent, useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { FormError } from '@/components/ui/FormError'
import {
  APPLIANCES,
  APPLIANCE_CATEGORIES,
  REGIONS,
  USAGE_PATTERNS,
  findAppliance,
} from '@/lib/appliances'
import { currency, number as fmtNumber } from '@/lib/format'
import { SYSTEM_TYPE_LABEL } from '@/lib/labels'
import {
  describePeakLoad,
  estimateSolar,
  paymentOptions,
  type ApplianceLoad,
} from '@/lib/solar-estimator'
import { useSubmitEstimate } from '@/lib/queries/public-forms'
import { useCompany } from '@/lib/queries/public-site'
import { usePricingConfig, useSystemAssumptions } from '@/lib/queries/settings'

/* ============================================================================
   EstimatorPage - the appliance-based solar estimator.
   ----------------------------------------------------------------------------
   THE MOST IMPORTANT PAGE ON THE PUBLIC SITE. It is simultaneously the lead
   magnet, the qualification tool and the customer's first lesson in how solar
   is actually sized. Flow-diagram steps L1-A A3 through A7.

   WHY IT ASKS ABOUT APPLIANCES INSTEAD OF THE BILL
   A bill is one number that hides everything that matters. Two households both
   paying PHP 8,000 can need completely different systems depending on WHEN they
   use power. Listing appliances answers three questions a bill cannot:

       peak watts   -> how big the inverter has to be
       watt-hours   -> how many panels are needed
       night share  -> whether batteries are needed at all

   It also teaches. Ticking "Aircon 1 HP, 6 hours" and watching PHP 67 a day
   appear beside it explains a customer's bill better than any paragraph of
   marketing copy, and a customer who understands the number trusts the
   quotation built on it.

   TEACHING, NOT JUST CALCULATING
   Most people have never been told what a watt is. The page therefore carries a
   permanent, plain-English explainer with everyday analogies, and every result
   is shown with the reasoning that produced it rather than as a bare figure.

   PAYLOAD DISCIPLINE
   No images, no icon font, no chart library, no animation beyond colour
   transitions. Icons are emoji. Everything computes locally, so moving a slider
   costs zero network requests. This matters because it is often the first page
   a prospect loads on mobile data.

   TODO(backend): on submit, insert a `leads` row with the full appliance
   profile attached, then invoke the quotation Edge Function to email the PDF
   estimate. Flow-diagram step L1-A A8 to A9.
   ========================================================================== */

/** Hour presets. Free-typing an exact number is noise the customer does not have. */
const HOUR_CHOICES = [1, 2, 4, 6, 8, 12, 24]

interface CustomAppliance {
  id: string
  name: string
  watts: number
}

export function EstimatorPage() {
  const COMPANY = useCompany()

  /* --- The customer's answers -------------------------------------------- */
  const [loads, setLoads] = useState<Record<string, ApplianceLoad>>({})
  const [customs, setCustoms] = useState<CustomAppliance[]>([])
  const [pattern, setPattern] = useState<'day' | 'balanced' | 'night'>('balanced')
  const [regionId, setRegionId] = useState('ncr')
  const [monthlyBill, setMonthlyBill] = useState('')
  const [roofArea, setRoofArea] = useState('')
  const [search, setSearch] = useState('')
  const [showResults, setShowResults] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  /* Custom-appliance draft */
  const [customName, setCustomName] = useState('')
  const [customWatts, setCustomWatts] = useState('')

  const region = REGIONS.find((r) => r.id === regionId) ?? REGIONS[0]
  const [rate, setRate] = useState<number | null>(null)

  /* --- Derived ------------------------------------------------------------ */

  const activeLoads = useMemo(() => Object.values(loads).filter((l) => l.quantity > 0), [loads])

  /* Prices come from Business Settings, not from constants in the estimator.
     Until this line existed, an administrator could change "Price per kWp",
     save it, reload this page and still be quoted the old figure — the setting
     was real, the screen was real, and nothing downstream read it. */
  const pricing = usePricingConfig()

  /* Panel wattage, system efficiency, roof area per kW and service life are all
     settings too, and the estimator ignored every one of them in favour of its
     own constants. Switching panel supplier is a normal thing for this business
     to do; needing a developer for it is not. */
  const hardware = useSystemAssumptions()

  const result = useMemo(
    () =>
      estimateSolar({
        pricing,
        assumptions: hardware,
        appliances: activeLoads,
        usagePatternId: pattern,
        regionId,
        monthlyBill: monthlyBill ? Number(monthlyBill) : undefined,
        roofAreaSqm: roofArea ? Number(roofArea) : undefined,
        ratePerKwh: rate ?? undefined,
      }),
    [pricing, hardware, activeLoads, pattern, regionId, monthlyBill, roofArea, rate],
  )

  /* --- Sending the estimate to the CRM ------------------------------------ */

  const submit = useSubmitEstimate()

  function handleLeadSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    /* The whole appliance profile goes with the lead, not just the headline
       kilowatt figure. It is the most useful thing the visitor will ever give
       us: it tells the engineer what the household actually runs and when, so
       the site survey starts from real information instead of a blank sheet. */
    submit.mutate(
      {
        name: String(form.get('name') ?? ''),
        email: String(form.get('email') ?? ''),
        phone: String(form.get('phone') ?? ''),
        address: String(form.get('address') ?? ''),
        appliances: activeLoads,
        usagePattern: pattern,
        regionId,
        ratePerKwh: rate ?? region.ratePerKwh,
        roofAreaSqm: roofArea ? Number(roofArea) : undefined,
        statedMonthlyBill: monthlyBill ? Number(monthlyBill) : undefined,
        result,
      },
      { onSuccess: () => setSubmitted(true) },
    )
  }

  const visibleAppliances = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return APPLIANCES
    return APPLIANCES.filter((a) => a.name.toLowerCase().includes(term))
  }, [search])

  /* --- Mutations ---------------------------------------------------------- */

  function setQuantity(id: string, quantity: number, custom?: CustomAppliance) {
    setLoads((prev) => {
      const spec = findAppliance(id)
      const existing = prev[id]
      if (quantity <= 0) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      return {
        ...prev,
        [id]: {
          applianceId: id,
          quantity,
          hoursPerDay: existing?.hoursPerDay ?? spec?.defaultHours ?? 4,
          isInverterType: existing?.isInverterType ?? false,
          custom: custom ? { name: custom.name, watts: custom.watts } : existing?.custom,
        },
      }
    })
  }

  function patchLoad(id: string, patch: Partial<ApplianceLoad>) {
    setLoads((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev))
  }

  function addCustom(e: React.FormEvent) {
    e.preventDefault()
    const watts = Number(customWatts)
    if (!customName.trim() || !Number.isFinite(watts) || watts <= 0) return
    const entry: CustomAppliance = {
      id: `custom-${Date.now()}`,
      name: customName.trim(),
      watts,
    }
    setCustoms((prev) => [...prev, entry])
    setQuantity(entry.id, 1, entry)
    setCustomName('')
    setCustomWatts('')
  }

  /* --- Confirmation screen after the lead is captured --------------------- */

  if (submitted) {
    return (
      <div className="section">
        <div className="container container--narrow center">
          <div style={{ fontSize: '3rem' }}>📩</div>
          <h1 style={{ marginBlock: 'var(--space-4)' }}>Your estimate is on its way</h1>
          <p className="muted" style={{ maxWidth: '56ch', marginInline: 'auto' }}>
            We are preparing a detailed PDF with your appliance breakdown, the recommended system, a
            full bill of materials and financing options. A sales engineer will follow up within one
            business day to arrange a free site survey.
          </p>
          <p className="xs dim" style={{ marginTop: 'var(--space-8)' }}>
            Your appliance list has been saved with your enquiry, so you will not be asked for it
            again.
          </p>
        </div>
      </div>
    )
  }

  const hasSelection = activeLoads.length > 0

  return (
    <div className="section section--muted est-page">
      <div className="container">
        {/* ------------------------------------------------------ INTRO
            Compact on purpose. This is a TOOL page — the visitor came to use
            the calculator, and a full-height marketing headline would push it
            below the fold on a laptop and off the screen entirely on a phone.
            The persuading was done on the page that sent them here. */}
        <div className="section-head section-head--compact">
          <span className="eyebrow">Free · No obligation · About two minutes</span>
          <h1>What size solar system do you actually need?</h1>
          <p>
            Tell us what you run at home and we will size the system, price it, and show you how
            long it takes to pay for itself. No sales call required to see the numbers.
          </p>
        </div>

        {/* --------------------------------------- WHAT IS A WATT, REALLY */}
        <details className="est-explain" style={{ marginBottom: 'var(--space-8)' }}>
          <summary>First time buying solar? Start here — what a “watt” actually means</summary>
          <div className="est-explain__body">
            <div className="est-analogy">
              <div className="est-analogy__card">
                <div className="est-analogy__term">Watts (W) — how fast</div>
                <p className="est-analogy__body">
                  How quickly an appliance uses electricity <em>right now</em>. Think of the
                  speedometer in a car. A 9 W LED bulb sips. A 1,500 W kettle gulps. Nothing about
                  time — just the rate at this instant.
                </p>
              </div>
              <div className="est-analogy__card">
                <div className="est-analogy__term">Watt-hours (Wh) — how much</div>
                <p className="est-analogy__body">
                  How much electricity was actually used, once you account for how long it ran. That
                  is the distance travelled, not the speed. A fast appliance used briefly can cost
                  less than a slow one left on all day.
                </p>
              </div>
              <div className="est-analogy__card">
                <div className="est-analogy__term">Kilowatt-hours (kWh) — the bill</div>
                <p className="est-analogy__body">
                  1 kWh = 1,000 Wh. This is the only unit your electricity provider charges you for.
                  Every peso on your bill is a kWh multiplied by the rate.
                </p>
              </div>
            </div>

            <div className="est-worked">
              <strong>A worked example.</strong> A 1 HP aircon draws about{' '}
              <strong>750 watts</strong> while running. Leave it on for <strong>6 hours</strong> and
              it has used 750 × 6 = <strong>4,500 watt-hours</strong>, which is{' '}
              <strong>4.5 kWh</strong>. At {currency(region.ratePerKwh)} per kWh that is about{' '}
              <strong>{currency(4.5 * region.ratePerKwh)} for one night</strong> — roughly{' '}
              {currency(4.5 * region.ratePerKwh * 30)} a month, from one aircon.
            </div>

            <p className="small muted">
              <strong>Why both numbers matter to your quotation.</strong> Your highest instant draw
              (watts) decides how big the <em>inverter</em> must be, so nothing trips when the
              kettle and the aircon come on together. Your daily total (watt-hours) decides how many{' '}
              <em>panels</em> you need, because panels have all day to gather it. And how much you
              use <em>after dark</em> decides whether you need <em>batteries</em> at all — panels
              make nothing at night.
            </p>
          </div>
        </details>

        <div className="grid grid--2" style={{ alignItems: 'start', gap: 'var(--space-6)' }}>
          {/* ================================================== LEFT: INPUT */}
          <div className="stack">
            {/* ------------------------------------ STEP 1: APPLIANCES */}
            <Card>
              <CardHeader
                title="Step 1 · What do you run at home?"
                action={
                  hasSelection ? (
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        setLoads({})
                        setShowResults(false)
                      }}
                    >
                      Clear all
                    </button>
                  ) : undefined
                }
              />
              <CardBody>
                <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
                  Add the appliances you actually use, then set roughly how many hours a day each
                  one runs. Estimates are fine — we confirm everything during the free site survey.
                </p>

                <div className="est-search">
                  <span className="est-search__icon" aria-hidden>
                    🔍
                  </span>
                  <input
                    className="input"
                    placeholder="Search appliances (aircon, fridge, pump…)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search appliances"
                  />
                </div>

                {APPLIANCE_CATEGORIES.map((cat) => {
                  const items = visibleAppliances.filter((a) => a.category === cat.id)
                  if (items.length === 0) return null

                  return (
                    <section key={cat.id} className="est-cat">
                      <div className="est-cat__head">
                        <span aria-hidden>{cat.icon}</span>
                        <span className="est-cat__label">{cat.label}</span>
                        <span className="est-cat__blurb">{cat.blurb}</span>
                      </div>

                      <div className="est-grid">
                        {items.map((spec) => {
                          const load = loads[spec.id]
                          const qty = load?.quantity ?? 0
                          const on = qty > 0
                          const hours = load?.hoursPerDay ?? spec.defaultHours
                          const inverter = load?.isInverterType ?? false
                          const effWatts = inverter ? spec.watts * 0.5 : spec.watts
                          const dailyWh = effWatts * qty * hours * spec.dutyCycle

                          return (
                            <div key={spec.id} className={`est-appliance${on ? ' is-on' : ''}`}>
                              <div className="est-appliance__top">
                                <div className="est-appliance__id">
                                  <span className="est-appliance__icon" aria-hidden>
                                    {cat.icon}
                                  </span>
                                  <div style={{ minWidth: 0 }}>
                                    <div className="est-appliance__name">{spec.name}</div>
                                    <div className="est-appliance__watts">
                                      {fmtNumber(spec.watts)} W each
                                    </div>
                                  </div>
                                </div>

                                <div className="est-qty">
                                  <button
                                    type="button"
                                    className="est-qty__btn"
                                    onClick={() => setQuantity(spec.id, qty - 1)}
                                    disabled={qty === 0}
                                    aria-label={`Remove one ${spec.name}`}
                                  >
                                    −
                                  </button>
                                  <span className="est-qty__value">{qty}</span>
                                  <button
                                    type="button"
                                    className="est-qty__btn"
                                    onClick={() => setQuantity(spec.id, qty + 1)}
                                    aria-label={`Add one ${spec.name}`}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {/* Options only appear once the item matters. */}
                              {on && (
                                <div className="est-opts">
                                  {spec.invertible && (
                                    <div className="est-opt__row">
                                      <span className="est-opt__label">Type</span>
                                      <div className="est-chips">
                                        <button
                                          type="button"
                                          className={`est-chip est-chip--dark${!inverter ? ' is-on' : ''}`}
                                          onClick={() =>
                                            patchLoad(spec.id, { isInverterType: false })
                                          }
                                        >
                                          Standard
                                        </button>
                                        <button
                                          type="button"
                                          className={`est-chip${inverter ? ' is-on' : ''}`}
                                          onClick={() =>
                                            patchLoad(spec.id, { isInverterType: true })
                                          }
                                        >
                                          Inverter (−50%)
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  <div className="est-opt__row">
                                    <span className="est-opt__label">Hours per day</span>
                                    <span className="est-opt__energy">
                                      {fmtNumber(Math.round(dailyWh))} Wh/day ·{' '}
                                      {currency(
                                        Math.round(
                                          (dailyWh / 1000) * 30 * (rate ?? region.ratePerKwh),
                                        ),
                                      )}
                                      /month
                                    </span>
                                  </div>
                                  <div className="est-chips">
                                    {HOUR_CHOICES.map((h) => (
                                      <button
                                        key={h}
                                        type="button"
                                        className={`est-chip${hours === h ? ' is-on' : ''}`}
                                        onClick={() => patchLoad(spec.id, { hoursPerDay: h })}
                                      >
                                        {h === 24 ? 'All day' : `${h}h`}
                                      </button>
                                    ))}
                                  </div>

                                  {spec.note && <p className="est-opt__note">{spec.note}</p>}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  )
                })}

                {/* --------------------------------- CUSTOM APPLIANCES */}
                {customs.length > 0 && (
                  <section className="est-cat">
                    <div className="est-cat__head">
                      <span aria-hidden>✏️</span>
                      <span className="est-cat__label">Your own additions</span>
                    </div>
                    <div className="est-grid">
                      {customs.map((c) => {
                        const load = loads[c.id]
                        const qty = load?.quantity ?? 0
                        const hours = load?.hoursPerDay ?? 4
                        const dailyWh = c.watts * qty * hours

                        return (
                          <div key={c.id} className={`est-appliance${qty > 0 ? ' is-on' : ''}`}>
                            <div className="est-appliance__top">
                              <div className="est-appliance__id">
                                <span className="est-appliance__icon" aria-hidden>
                                  🔌
                                </span>
                                <div>
                                  <div className="est-appliance__name">{c.name}</div>
                                  <div className="est-appliance__watts">
                                    {fmtNumber(c.watts)} W each
                                  </div>
                                </div>
                              </div>
                              <div className="est-qty">
                                <button
                                  type="button"
                                  className="est-qty__btn"
                                  onClick={() => setQuantity(c.id, qty - 1, c)}
                                  disabled={qty === 0}
                                  aria-label={`Remove one ${c.name}`}
                                >
                                  −
                                </button>
                                <span className="est-qty__value">{qty}</span>
                                <button
                                  type="button"
                                  className="est-qty__btn"
                                  onClick={() => setQuantity(c.id, qty + 1, c)}
                                  aria-label={`Add one ${c.name}`}
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            {qty > 0 && (
                              <div className="est-opts">
                                <div className="est-opt__row">
                                  <span className="est-opt__label">Hours per day</span>
                                  <span className="est-opt__energy">
                                    {fmtNumber(Math.round(dailyWh))} Wh/day
                                  </span>
                                </div>
                                <div className="est-chips">
                                  {HOUR_CHOICES.map((h) => (
                                    <button
                                      key={h}
                                      type="button"
                                      className={`est-chip${hours === h ? ' is-on' : ''}`}
                                      onClick={() => patchLoad(c.id, { hoursPerDay: h })}
                                    >
                                      {h === 24 ? 'All day' : `${h}h`}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )}

                <form
                  onSubmit={addCustom}
                  style={{
                    marginTop: 'var(--space-4)',
                    padding: 'var(--space-4)',
                    border: '1px dashed var(--border-strong)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div className="est-opt__label" style={{ marginBottom: 'var(--space-3)' }}>
                    Something not on the list?
                  </div>
                  <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <input
                      className="input"
                      placeholder="Appliance name"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      style={{ flex: '2 1 160px' }}
                      aria-label="Custom appliance name"
                    />
                    <input
                      className="input"
                      type="number"
                      min={1}
                      placeholder="Watts"
                      value={customWatts}
                      onChange={(e) => setCustomWatts(e.target.value)}
                      style={{ flex: '1 1 90px' }}
                      aria-label="Custom appliance watts"
                    />
                    <Button type="submit" variant="outline">
                      Add
                    </Button>
                  </div>
                  <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                    The wattage is printed on the appliance itself, usually on a sticker at the back
                    or underneath.
                  </p>
                </form>
              </CardBody>
            </Card>

            {/* ------------------------------ STEP 2: WHEN DO YOU USE IT */}
            <Card>
              <CardHeader title="Step 2 · When do you use most of your electricity?" />
              <CardBody>
                <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
                  This is what decides whether you need batteries. Solar panels produce nothing
                  after sunset, so energy used at night has to come from either the grid or a
                  battery you paid for.
                </p>

                <div className="est-patterns">
                  {USAGE_PATTERNS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`est-pattern${pattern === p.id ? ' is-on' : ''}`}
                      onClick={() => setPattern(p.id)}
                    >
                      <div className="est-pattern__label">
                        {p.label}
                        {p.popular && (
                          <span className="badge badge--brand" style={{ fontSize: '10px' }}>
                            Most common
                          </span>
                        )}
                      </div>
                      <p className="est-pattern__desc">{p.description}</p>
                    </button>
                  ))}
                </div>
              </CardBody>
            </Card>

            {/* ----------------------------------- STEP 3: WHERE & CHECK */}
            <Card>
              <CardHeader title="Step 3 · Where are you, and how much do you pay?" />
              <CardBody>
                <div className="stack">
                  <div className="field">
                    <label className="field__label" htmlFor="region">
                      Region
                    </label>
                    <select
                      id="region"
                      className="select"
                      value={regionId}
                      onChange={(e) => {
                        setRegionId(e.target.value)
                        setRate(null)
                      }}
                    >
                      {REGIONS.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <span className="field__hint">
                      Sunlight varies across the country. Your area averages{' '}
                      <strong>{region.peakSunHours} hours</strong> of full-strength sun per day,
                      which is what each panel has to work with.
                    </span>
                  </div>

                  <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'start' }}>
                    <div className="field" style={{ flex: 1 }}>
                      <label className="field__label" htmlFor="rate">
                        Your rate (₱ per kWh)
                      </label>
                      <input
                        id="rate"
                        className="input"
                        type="number"
                        step="0.5"
                        min={1}
                        value={rate ?? region.ratePerKwh}
                        onChange={(e) => setRate(Number(e.target.value))}
                      />
                      <span className="field__hint">
                        Divide your bill total by the kWh shown on it.
                      </span>
                    </div>

                    <div className="field" style={{ flex: 1 }}>
                      <label className="field__label" htmlFor="bill">
                        Monthly bill <span className="dim">(optional)</span>
                      </label>
                      <input
                        id="bill"
                        className="input"
                        type="number"
                        min={0}
                        placeholder="e.g. 8000"
                        value={monthlyBill}
                        onChange={(e) => setMonthlyBill(e.target.value)}
                      />
                      <span className="field__hint">
                        Only used to sanity-check your appliance list.
                      </span>
                    </div>
                  </div>

                  <div className="field">
                    <label className="field__label" htmlFor="roof">
                      Usable roof area in m² <span className="dim">(optional)</span>
                    </label>
                    <input
                      id="roof"
                      className="input"
                      type="number"
                      min={0}
                      placeholder="e.g. 60"
                      value={roofArea}
                      onChange={(e) => setRoofArea(e.target.value)}
                    />
                    <span className="field__hint">
                      Unshaded area only. Each kW needs about 6 m². Leave blank if unsure.
                    </span>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* ================================================ RIGHT: OUTPUT */}
          <div className="stack est-sticky">
            {/* ------------------------------------- RUNNING TOTAL */}
            <div className="est-summary">
              <div className="est-summary__top">
                <div>
                  <div className="est-summary__figure">
                    {fmtNumber(result.peakLoadW)}
                    <span className="est-summary__unit">watts at once</span>
                  </div>
                  <div className="est-summary__sub">
                    {fmtNumber(result.dailyWh)} Wh per day · {result.applianceCount} appliance
                    {result.applianceCount === 1 ? '' : 's'} selected
                  </div>
                  <div className="est-summary__sub" style={{ color: 'var(--brand-300)' }}>
                    {describePeakLoad(result.peakLoadW)}
                  </div>
                </div>

                <Button
                  variant="primary"
                  size="lg"
                  disabled={!hasSelection}
                  onClick={() => setShowResults(true)}
                >
                  {showResults ? 'Updated ✓' : 'Calculate my system'}
                </Button>
              </div>

              <div className="est-summary__meta">
                <div>
                  <label>Estimated monthly usage</label>
                  <strong>{fmtNumber(result.monthlyKwh)} kWh</strong>
                </div>
                <div>
                  <label>That currently costs you</label>
                  <strong>{currency(result.currentMonthlyCost)}</strong>
                </div>
              </div>
            </div>

            {!hasSelection && (
              <Card>
                <CardBody className="center">
                  <div style={{ fontSize: '2rem' }}>👈</div>
                  <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
                    Start by adding an appliance. Most Philippine homes begin with an aircon, a
                    refrigerator and some lights.
                  </p>
                </CardBody>
              </Card>
            )}

            {/* Bill cross-check is useful even before results are revealed. */}
            {result.billCheck && result.billCheck.verdict !== 'close' && (
              <Card style={{ borderColor: 'var(--warning-solid)' }}>
                <CardBody>
                  <h4 style={{ fontSize: 'var(--text-base)' }}>
                    {result.billCheck.verdict === 'appliances_low'
                      ? 'Your list looks incomplete'
                      : 'Your list looks higher than your bill'}
                  </h4>
                  <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                    {result.billCheck.verdict === 'appliances_low' ? (
                      <>
                        Your appliances add up to about{' '}
                        {currency(result.billCheck.impliedMonthlyBill)} a month, but you told us you
                        pay {currency(result.billCheck.statedMonthlyBill)}. Something is probably
                        missing — a second fridge, a water pump, or an appliance running longer than
                        you think.
                      </>
                    ) : (
                      <>
                        Your appliances suggest about{' '}
                        {currency(result.billCheck.impliedMonthlyBill)} a month, which is more than
                        the {currency(result.billCheck.statedMonthlyBill)} you told us. Try lowering
                        the hours — most people overestimate how long the aircon really runs.
                      </>
                    )}
                  </p>
                </CardBody>
              </Card>
            )}

            {/* ------------------------------------------ THE RESULT */}
            {showResults && hasSelection && (
              <>
                <Card accent>
                  <CardBody>
                    <span className="eyebrow">Your recommendation</span>
                    <h2 className="est-headline" style={{ marginTop: 'var(--space-2)' }}>
                      A{' '}
                      <em>
                        {result.recommendedKw} kW {SYSTEM_TYPE_LABEL[result.systemType]}
                      </em>{' '}
                      system, from {currency(result.estimatedCost)}
                    </h2>

                    {/* "From X" on its own leaves the visitor guessing what is
                        and is not in the number — which is the question that
                        stops people asking for a quote. */}
                    <p className="small muted" style={{ marginTop: 'var(--space-2)' }}>
                      Supplied and installed: panels, inverter{' '}
                      {result.batteryCount > 0 ? ', batteries' : ''}, mounting, wiring, the design,
                      and the permit and net-metering paperwork. No monthly fee. The final price is
                      confirmed after a free survey of your roof.
                    </p>

                    <div className="est-steps">
                      <div className="est-step">
                        <span className="est-step__n">1</span>
                        <span>
                          Your appliances draw up to{' '}
                          <strong>{fmtNumber(result.peakLoadW)} W</strong> at once and use{' '}
                          <strong>{result.dailyKwh} kWh</strong> a day.
                        </span>
                      </div>
                      <div className="est-step">
                        <span className="est-step__n">2</span>
                        <span>
                          At {result.peakSunHours} sun-hours a day in {region.label.split(' (')[0]},
                          covering that needs about{' '}
                          <strong>{result.recommendedKw} kW of panels</strong> — {result.panelCount}{' '}
                          panels, roughly {result.roofAreaNeededSqm} m² of roof.
                        </span>
                      </div>
                      <div className="est-step">
                        <span className="est-step__n">3</span>
                        <span>
                          {result.batteryCount > 0 ? (
                            <>
                              You use a good share of your power after dark, so we included{' '}
                              <strong>
                                {result.batteryCount} batter
                                {result.batteryCount === 1 ? 'y' : 'ies'} ({result.batteryKwh} kWh)
                              </strong>{' '}
                              to carry you through the evening.
                            </>
                          ) : (
                            <>
                              You use most of your power while the sun is up, so{' '}
                              <strong>no batteries are needed</strong> — which keeps the price
                              considerably lower.
                            </>
                          )}
                        </span>
                      </div>
                      <div className="est-step est-step--accent">
                        <span className="est-step__n">4</span>
                        <span>
                          Expected to cover <strong>{Math.round(result.offsetShare * 100)}%</strong>{' '}
                          of your consumption, saving about{' '}
                          <strong>{currency(result.monthlySavings)} every month</strong>.
                        </span>
                      </div>
                    </div>

                    {result.roofLimited && (
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
                        ⚠ Your roof area is the limiting factor here, not your usage. We have sized
                        the largest system that fits. A site survey often finds more usable space
                        than people expect.
                      </p>
                    )}
                  </CardBody>
                </Card>

                {/* ------------------------------------- KEY NUMBERS */}
                <div className="est-metrics">
                  <div className="est-metric">
                    <div className="est-metric__label">Panels</div>
                    <div className="est-metric__value">{result.panelCount}</div>
                    <div className="est-metric__note">{hardware.panelWatts} W monocrystalline</div>
                  </div>
                  <div className="est-metric">
                    <div className="est-metric__label">Inverter</div>
                    <div className="est-metric__value">{result.inverterKw} kW</div>
                    <div className="est-metric__note">
                      Big enough if everything switches on together
                    </div>
                  </div>
                  <div className="est-metric">
                    <div className="est-metric__label">Batteries</div>
                    <div className="est-metric__value">{result.batteryCount || 'None'}</div>
                    <div className="est-metric__note">
                      {result.batteryCount
                        ? `${result.batteryKwh} kWh — covers your evening use`
                        : 'You draw from the grid after dark'}
                    </div>
                  </div>
                  <div className="est-metric">
                    <div className="est-metric__label">Solar output</div>
                    <div className="est-metric__value">{fmtNumber(result.monthlyKwhProduced)}</div>
                    <div className="est-metric__note">
                      kWh a month, against the {fmtNumber(result.monthlyKwh)} you use
                    </div>
                  </div>
                </div>

                {/* --------------------------------------------- ROI */}
                <div className="est-roi">
                  <div className="small strong" style={{ color: 'var(--success-fg)' }}>
                    PAYS FOR ITSELF IN
                  </div>
                  <div className="est-roi__value">
                    about {Math.round(result.paybackYears)} years
                  </div>
                  <p className="small" style={{ marginTop: 'var(--space-2)' }}>
                    Saving {currency(result.monthlySavings)} a month means{' '}
                    {currency(result.annualSavings)} a year. Over the panels&rsquo; 25-year warranty
                    that is roughly <strong>{currency(result.lifetimeSavings)}</strong> kept in your
                    pocket after the system has paid for itself.
                  </p>
                </div>

                {/* ------------------------------ WHERE IT ALL GOES */}
                <Card>
                  <CardHeader title="Where your electricity actually goes" />
                  <CardBody>
                    {result.breakdown.slice(0, 8).map((line, i) => (
                      <div key={line.applianceId} className="est-bar__row">
                        <div>
                          <div className="row row--between">
                            <span className="small strong">
                              {line.name}
                              {line.quantity > 1 && <span className="dim"> × {line.quantity}</span>}
                            </span>
                            <span className="xs dim">{Math.round(line.shareOfDaily * 100)}%</span>
                          </div>
                          <div className="est-bar__track">
                            <div
                              className={`est-bar__fill${i === 0 ? ' est-bar__fill--top' : ''}`}
                              style={{ width: `${Math.max(line.shareOfDaily * 100, 1)}%` }}
                            />
                          </div>
                        </div>
                        <span className="small strong num">{currency(line.monthlyCost)}</span>
                      </div>
                    ))}

                    {result.breakdown.length > 0 && (
                      <p className="xs dim" style={{ marginTop: 'var(--space-4)' }}>
                        Your biggest single cost is <strong>{result.breakdown[0].name}</strong> at{' '}
                        {currency(result.breakdown[0].monthlyCost)} a month. Reducing its hours is
                        the cheapest saving available to you — no equipment required.
                      </p>
                    )}
                  </CardBody>
                </Card>

                {/* --------------------------------- PAYMENT OPTIONS */}
                <Card>
                  <CardHeader title="Ways to pay" />
                  <CardBody>
                    <div className="stack stack--sm">
                      {paymentOptions(result.estimatedCost).map((opt) => (
                        <div key={opt.id} className="est-pay">
                          <div>
                            <div className="small strong">{opt.label}</div>
                            <div className="xs dim">{opt.note}</div>
                          </div>
                          <div className="est-pay__amount">
                            {opt.monthly ? `${currency(opt.monthly)}/mo` : currency(opt.total)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>

                {/* ------------------------------------ LEAD CAPTURE */}
                <Card accent>
                  <CardHeader title="Get the detailed quotation" />
                  <CardBody>
                    <p className="small muted" style={{ marginBottom: 'var(--space-4)' }}>
                      A full PDF with your appliance breakdown, the exact bill of materials, panel
                      layout and financing options — emailed free, no obligation.
                    </p>
                    <form className="stack" onSubmit={handleLeadSubmit}>
                      <input name="name" className="input" placeholder="Your name" required />
                      <input
                        name="email"
                        className="input"
                        type="email"
                        placeholder="you@email.com"
                        required
                      />
                      <input name="phone" className="input" placeholder="Mobile number" required />
                      <input
                        name="address"
                        className="input"
                        placeholder="Property address"
                        required
                      />

                      <FormError error={submit.error} />

                      <Button
                        type="submit"
                        variant="primary"
                        block
                        size="lg"
                        disabled={submit.isPending}
                      >
                        {submit.isPending ? 'Sending…' : 'Email me the full quotation'}
                      </Button>
                    </form>
                  </CardBody>
                </Card>

                {/* ------------------------------------- DISCLAIMER */}
                <p className="xs dim">
                  This estimate is based on the appliances and hours you entered, using{' '}
                  {hardware.panelWatts} W panels, {result.peakSunHours} peak sun hours and{' '}
                  {Math.round(hardware.performanceRatio * 100)}% system efficiency. Final pricing is
                  confirmed after a free on-site survey, which checks your roof structure, shading
                  and electrical panel. Prices hold for 5 days. {COMPANY.name} · {COMPANY.hours}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* The panel wattage and efficiency quoted in the copy above now come from the
   same settings the maths uses. They used to be two string constants here, so
   the disclaimer could keep promising 620 W panels at 80% efficiency long after
   the business had changed either one. */
