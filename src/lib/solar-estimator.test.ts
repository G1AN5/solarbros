import { describe, expect, it } from 'vitest'

import { describePeakLoad, estimateSolar, paymentOptions, systemPrice } from './solar-estimator'
import type { ApplianceLoad, EstimatorInput } from './solar-estimator'

/* ============================================================================
   Tests for the solar estimator.
   ----------------------------------------------------------------------------
   This function sits at the top of the sales funnel - a wrong number here means
   a wrong quotation emailed to a real prospect. It is pure (no React, no
   network), which makes it both the easiest and the most valuable thing in the
   codebase to test.
   ========================================================================== */

/** A modest household: one aircon, a fridge, a TV and some lights. */
const TYPICAL: ApplianceLoad[] = [
  { applianceId: 'ac-10', quantity: 1, hoursPerDay: 6 },
  { applianceId: 'ref-2door', quantity: 1, hoursPerDay: 24 },
  { applianceId: 'tv', quantity: 1, hoursPerDay: 5 },
  { applianceId: 'led', quantity: 8, hoursPerDay: 6 },
]

function run(overrides: Partial<EstimatorInput> = {}) {
  return estimateSolar({
    appliances: TYPICAL,
    usagePatternId: 'balanced',
    regionId: 'ncr',
    ...overrides,
  })
}

describe('estimateSolar - demand calculation', () => {
  it('computes peak load as the sum of every appliance running at once', () => {
    const r = estimateSolar({
      appliances: [{ applianceId: 'ac-10', quantity: 2, hoursPerDay: 6 }],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    // Two 750 W units.
    expect(r.peakLoadW).toBe(1500)
  })

  it('computes daily energy as watts x hours', () => {
    const r = estimateSolar({
      appliances: [{ applianceId: 'ac-10', quantity: 1, hoursPerDay: 6 }],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    // 750 W x 6 h = 4,500 Wh.
    expect(r.dailyWh).toBe(4500)
    expect(r.dailyKwh).toBe(4.5)
  })

  it('applies the duty cycle so a fridge is not counted at full draw for 24 h', () => {
    const r = estimateSolar({
      appliances: [{ applianceId: 'ref-2door', quantity: 1, hoursPerDay: 24 }],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    // 150 W x 24 h x 0.35 duty = 1,260 Wh, not the naive 3,600 Wh.
    expect(r.dailyWh).toBe(1260)
  })

  it('halves the energy of an inverter-type unit', () => {
    const fixed = estimateSolar({
      appliances: [{ applianceId: 'ac-10', quantity: 1, hoursPerDay: 6 }],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    const inverter = estimateSolar({
      appliances: [{ applianceId: 'ac-10', quantity: 1, hoursPerDay: 6, isInverterType: true }],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    expect(inverter.dailyWh).toBe(fixed.dailyWh / 2)
  })

  it('supports custom appliances that are not in the catalogue', () => {
    const r = estimateSolar({
      appliances: [
        {
          applianceId: 'custom-1',
          quantity: 2,
          hoursPerDay: 3,
          custom: { name: 'Aquarium pump', watts: 200 },
        },
      ],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    expect(r.peakLoadW).toBe(400)
    expect(r.dailyWh).toBe(1200)
    expect(r.breakdown[0].name).toBe('Aquarium pump')
  })

  it('ranks the breakdown by daily energy, biggest first', () => {
    const r = run()
    const energies = r.breakdown.map((b) => b.dailyWh)
    expect(energies).toEqual([...energies].sort((a, b) => b - a))
    // The aircon should dominate a typical Philippine household.
    expect(r.breakdown[0].applianceId).toBe('ac-10')
  })

  it('returns an empty, zeroed result when nothing is selected', () => {
    const r = estimateSolar({ appliances: [], usagePatternId: 'balanced', regionId: 'ncr' })
    expect(r.peakLoadW).toBe(0)
    expect(r.dailyWh).toBe(0)
    expect(r.breakdown).toEqual([])
    expect(r.monthlySavings).toBe(0)
  })
})

describe('estimateSolar - system sizing', () => {
  it('scales the recommended system with consumption', () => {
    const small = estimateSolar({
      appliances: [{ applianceId: 'led', quantity: 4, hoursPerDay: 5 }],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    const large = estimateSolar({
      appliances: [{ applianceId: 'ac-30', quantity: 4, hoursPerDay: 10 }],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    expect(large.recommendedKw).toBeGreaterThan(small.recommendedKw)
    expect(large.panelCount).toBeGreaterThan(small.panelCount)
  })

  it('never recommends less than 1 kW', () => {
    const r = estimateSolar({
      appliances: [{ applianceId: 'led', quantity: 1, hoursPerDay: 1 }],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    expect(r.recommendedKw).toBeGreaterThanOrEqual(1)
  })

  it('caps the array by roof area and flags why', () => {
    const big: ApplianceLoad[] = [{ applianceId: 'ac-30', quantity: 4, hoursPerDay: 10 }]
    const unconstrained = estimateSolar({
      appliances: big,
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    const constrained = estimateSolar({
      appliances: big,
      usagePatternId: 'balanced',
      regionId: 'ncr',
      roofAreaSqm: 20,
    })
    expect(constrained.recommendedKw).toBeLessThan(unconstrained.recommendedKw)
    expect(constrained.roofLimited).toBe(true)
    expect(unconstrained.roofLimited).toBe(false)
  })

  it('recommends batteries for an evening-heavy household and none for a day one', () => {
    const day = run({ usagePatternId: 'day' })
    const night = run({ usagePatternId: 'night' })

    expect(day.systemType).toBe('on_grid')
    expect(day.batteryCount).toBe(0)

    expect(night.systemType).toBe('hybrid')
    expect(night.batteryCount).toBeGreaterThan(0)
    expect(night.batteryKwh).toBeGreaterThan(0)
  })

  it('needs more battery capacity the more energy is used after dark', () => {
    const balanced = run({ usagePatternId: 'balanced' })
    const night = run({ usagePatternId: 'night' })
    expect(night.batteryCount).toBeGreaterThanOrEqual(balanced.batteryCount)
  })

  it('sizes the inverter at least as large as the array', () => {
    const r = run()
    expect(r.inverterKw).toBeGreaterThanOrEqual(r.recommendedKw)
  })

  it('produces more from the same array in a sunnier region', () => {
    const bicol = run({ regionId: 'bicol' }) // 4.2 peak sun hours
    const palawan = run({ regionId: 'mimaropa' }) // 4.9 peak sun hours
    expect(palawan.peakSunHours).toBeGreaterThan(bicol.peakSunHours)
  })
})

describe('estimateSolar - money', () => {
  it('never promises savings larger than the household actually consumes', () => {
    const r = run({ roofAreaSqm: 500 }) // deliberately huge roof
    expect(r.monthlySavings).toBeLessThanOrEqual(Math.ceil(r.monthlyKwh * r.ratePerKwh))
    expect(r.offsetShare).toBeLessThanOrEqual(1)
  })

  it('keeps the derived figures internally consistent', () => {
    const r = run()
    expect(r.annualSavings).toBe(r.monthlySavings * 12)
    expect(r.paybackYears).toBeGreaterThan(0)
    expect(r.lifetimeSavings).toBe(Math.round(r.annualSavings * 25 - r.estimatedCost))
    expect(r.panelCount).toBeGreaterThan(0)
  })

  it('prices a hybrid above an on-grid system of similar size', () => {
    const day = run({ usagePatternId: 'day' }) // on-grid, no batteries
    const night = run({ usagePatternId: 'night' }) // hybrid, with batteries
    expect(night.estimatedCost).toBeGreaterThan(day.estimatedCost)
  })

  it('reports a current cost that agrees with the savings at full offset', () => {
    // A large roof means production covers everything, so "what you pay now"
    // and "what you would save" must be the same number on screen. Rounding
    // each figure separately used to make them differ by a few pesos.
    const r = run({ roofAreaSqm: 400 })
    expect(r.offsetShare).toBe(1)
    expect(r.currentMonthlyCost).toBe(r.monthlySavings)
  })

  it('honours a custom tariff over the region default', () => {
    const base = run()
    const pricey = run({ ratePerKwh: 20 })
    expect(pricey.ratePerKwh).toBe(20)
    expect(pricey.monthlySavings).toBeGreaterThan(base.monthlySavings)
  })
})

describe('estimateSolar - bill cross-check', () => {
  it('is omitted when the customer gives no bill', () => {
    expect(run().billCheck).toBeUndefined()
  })

  it('reports agreement when the appliance list matches the stated bill', () => {
    const rough = run()
    const stated = Math.round(rough.monthlyKwh * rough.ratePerKwh)
    const r = run({ monthlyBill: stated })
    expect(r.billCheck?.verdict).toBe('close')
  })

  it('flags when the appliance list cannot explain a much larger bill', () => {
    const r = run({ monthlyBill: 40_000 })
    expect(r.billCheck?.verdict).toBe('appliances_low')
  })

  it('flags when the appliance list implies far more than the stated bill', () => {
    const r = run({ monthlyBill: 500 })
    expect(r.billCheck?.verdict).toBe('appliances_high')
  })
})

describe('plain-language helpers', () => {
  it('describes a peak load in everyday terms', () => {
    expect(describePeakLoad(0)).toContain('nothing')
    expect(describePeakLoad(90)).toContain('LED bulbs')
    expect(describePeakLoad(750)).toContain('aircon')
    expect(typeof describePeakLoad(9000)).toBe('string')
  })

  it('offers a cash option plus instalment options that cost more in total', () => {
    const options = paymentOptions(500_000)
    const cash = options.find((o) => o.id === 'cash')!
    const loan = options.find((o) => o.id === 'loan')!

    expect(cash.monthly).toBeNull()
    expect(cash.total).toBe(500_000)
    expect(loan.monthly).toBeGreaterThan(0)
    expect(loan.total).toBeGreaterThan(cash.total)
  })
})
/* ============================================================================
   THE PRICE MODEL AGAINST THE REAL PRICE LIST
   ----------------------------------------------------------------------------
   The whole point of base + rate per kWp is that it reproduces what the market
   actually charges. If somebody later "simplifies" it back to a single rate, or
   edits a default without re-fitting, these are the tests that notice.

   Tolerance is 2.5%. Tighter would fail on ordinary rounding of the settings;
   looser would let a 40,000-peso error through on a residential quote.
   ========================================================================== */

describe('the published hybrid range', () => {
  // kWp and price as published. kWp is panel count x 620 W, not the round name.
  const PUBLISHED: [number, number][] = [
    [4.96, 337_000],
    [6.2, 378_000],
    [8.68, 467_000],
    [9.92, 533_000],
    [12.4, 614_000],
    [16.12, 760_000],
    [18.6, 866_000],
  ]

  it.each(PUBLISHED)('prices a %s kWp hybrid within 2.5%% of PHP %s', (kwp, published) => {
    const modelled = systemPrice(kwp, 'hybrid')
    const error = Math.abs(modelled - published) / published
    expect(error).toBeLessThan(0.025)
  })

  it('charges more per kWp for off-grid than hybrid, and hybrid than on-grid', () => {
    // Not a fitted figure, an ordering that must hold whatever the settings say:
    // storage and charge control are not free.
    expect(systemPrice(10, 'off_grid')).toBeGreaterThan(systemPrice(10, 'hybrid'))
    expect(systemPrice(10, 'hybrid')).toBeGreaterThan(systemPrice(10, 'on_grid'))
  })

  it('does not charge twice for the batteries already in the base price', () => {
    // Three modules are included, so three modules cost nothing extra and a
    // fourth costs exactly one module.
    const three = systemPrice(10, 'hybrid', undefined, 3)
    const none = systemPrice(10, 'hybrid', undefined, 0)
    const four = systemPrice(10, 'hybrid', undefined, 4)

    expect(three).toBe(none)
    expect(four - three).toBeGreaterThan(0)
  })

  it('reads prices from the caller rather than its own constants', () => {
    /* The bug this guards: an administrator edits the price in Business
       Settings, saves, and the public estimator quotes the old figure because
       it was reading a module-level constant. */
    const dearer = estimateSolar({
      appliances: [{ applianceId: 'ac-30', quantity: 2, hoursPerDay: 8 }],
      usagePatternId: 'night',
      regionId: 'ncr',
      pricing: {
        baseCost: { on_grid: 1, hybrid: 1_000_000, off_grid: 1 },
        costPerKwp: { on_grid: 1, hybrid: 1, off_grid: 1 },
        costPerBattery: 0,
        batteriesIncluded: 99,
      },
    })

    expect(dearer.systemType).toBe('hybrid')
    expect(dearer.estimatedCost).toBeGreaterThan(900_000)
  })
})

describe('hardware that can actually be bought', () => {
  it('recommends an array size from the published range', () => {
    const SELLABLE = [4.96, 6.2, 8.68, 9.92, 12.4, 16.12, 18.6, 25, 30, 40, 50]
    const r = estimateSolar({
      appliances: [{ applianceId: 'ac-30', quantity: 2, hoursPerDay: 8 }],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    expect(SELLABLE).toContain(r.recommendedKw)
  })

  it('specifies an inverter in a rating that exists', () => {
    /* An inverter is separate hardware sold in round kW. Snapping it to the
       array ladder produced specifications like "8.68 kW inverter", which
       cannot be ordered. */
    const r = estimateSolar({
      appliances: [{ applianceId: 'ac-30', quantity: 2, hoursPerDay: 8 }],
      usagePatternId: 'balanced',
      regionId: 'ncr',
    })
    expect(Number.isInteger(r.inverterKw)).toBe(true)
  })
})
