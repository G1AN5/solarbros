/* ============================================================================
   SOLAR ESTIMATOR - sizing and savings maths
   ----------------------------------------------------------------------------
   Powers the public estimator, which is the single biggest lead source in the
   whole application. Pure functions only (no React, no network) so that:

     1. the identical logic can later run inside a Supabase Edge Function when
        generating the emailed PDF quotation, and
     2. it is trivially unit-testable with Vitest.

   THE TWO NUMBERS THAT DECIDE A SOLAR SYSTEM
   Customers think there is one number. There are two, and they size different
   pieces of hardware:

     PEAK LOAD (watts)      - the most you could draw at any single instant.
                              Sizes the INVERTER. If your kettle, aircon and
                              induction hob all switch on together, the inverter
                              must carry that or it trips.

     DAILY ENERGY (Wh/day)  - how much you get through in 24 hours.
                              Sizes the PANEL ARRAY. Panels have all day to
                              gather it, so this is about totals, not instants.

   And a third question decides the battery:

     NIGHT SHARE            - how much of that daily energy is used after
                              sunset, when the panels make nothing.

   A bill-only estimator can answer none of these properly. That is why the
   appliance picker exists.

   WHERE THE PRICES COME FROM
   Not from this file. Prices live in the `pricing.*` business settings and are
   passed in as `input.pricing`, so the owner changes them from the admin portal
   without a developer. The constants below are the fallback for tests and for
   the first paint before the settings arrive — they are not a second price list
   anybody is expected to keep in step.

   The ENGINEERING constants (panel wattage, performance ratio, depth of
   discharge) do live here, because those are physics and hardware, not
   commercial policy.
   ========================================================================== */

import { findAppliance, REGIONS, USAGE_PATTERNS } from './appliances'
import type { SystemType } from '@/types/domain'

/* ============================================================================
   HARDWARE ASSUMPTIONS
   ----------------------------------------------------------------------------
   Every one of these exists as a `pricing.*` setting and every one of them was
   ignored: the estimator read the constant beside it instead. Changing "System
   efficiency" in Business Settings from 80% to 75% did nothing to a single
   number on the public estimator — the same defect as the prices, on the
   figures that decide how many panels a customer is told they need.

   Passed in as `input.assumptions`. The constants below remain the fallback for
   tests and for the first paint before settings arrive.
   ========================================================================== */

export interface SystemAssumptions {
  /** Nameplate wattage of the standard panel SolarBros installs. */
  panelWatts: number
  /** Usable capacity of one battery module, kWh. */
  batteryKwh: number
  /**
   * System losses between the panel face and the wall socket: inverter
   * conversion, wiring resistance, dust, and heat derate. 0.8 is the figure the
   * industry uses for a well-installed rooftop array in a tropical climate.
   */
  performanceRatio: number
  /**
   * Headroom on the inverter above measured peak load. Motors (aircon
   * compressors, pumps) draw a surge several times their running watts for the
   * first fraction of a second, so sizing an inverter exactly to peak
   * guarantees nuisance trips.
   */
  inverterHeadroom: number
  /** Roof area consumed per kW of installed capacity, square metres. */
  sqmPerKw: number
  /** Expected service life used for the lifetime-savings figure, years. */
  lifetimeYears: number
}

export const DEFAULT_ASSUMPTIONS: SystemAssumptions = {
  panelWatts: 620,
  batteryKwh: 5.12,
  performanceRatio: 0.8,
  inverterHeadroom: 1.25,
  sqmPerKw: 6.0,
  lifetimeYears: 25,
}

/* Kept as named exports because other modules and tests import them, and
   because they are the documented defaults. */
export const PANEL_WATTS = DEFAULT_ASSUMPTIONS.panelWatts
export const BATTERY_KWH = DEFAULT_ASSUMPTIONS.batteryKwh
export const PERFORMANCE_RATIO = DEFAULT_ASSUMPTIONS.performanceRatio
export const SYSTEM_LIFETIME_YEARS = DEFAULT_ASSUMPTIONS.lifetimeYears

/**
 * Usable depth of discharge. Draining a lithium pack flat destroys it.
 *
 * NOT configurable, deliberately. This is a property of the cell chemistry, not
 * a commercial decision, and an owner who "optimised" it to 1.0 to make quotes
 * look cheaper would be selling batteries that fail early.
 */
const BATTERY_DOD = 0.9

/* ============================================================================
   WHAT A SYSTEM COSTS
   ----------------------------------------------------------------------------
   TWO PARTS, NOT ONE. A flat rate per kW is wrong at both ends of the range:
   it over-prices a small system, because the inverter, mounting, permits and a
   day of labour cost much the same whatever size the array is, and it
   under-prices nothing at all. Fitted against a published Philippine hybrid
   price list, a single rate is out by more than 20% on a 5 kW system while
   matching a 15 kW one — which is exactly the customer most likely to be
   comparing quotes.

   Base plus a rate per kWp reproduces that same list to within 2% across the
   whole 5-18 kW range.

   THESE ARE FALLBACKS. The real figures come from the `pricing.*` settings and
   are passed in by the caller. They exist so the engine can be unit-tested and
   so the page still renders sensibly before the settings have loaded — not as
   the values the business actually uses. */
export interface PricingConfig {
  /** Fixed cost of a job regardless of array size: inverter, mounting,
      switchgear, permits, labour. PHP. */
  baseCost: Record<SystemType, number>
  /** Marginal cost of each additional kWp of panels. PHP. */
  costPerKwp: Record<SystemType, number>
  /** Each battery module beyond what the base price includes. PHP. */
  costPerBattery: number
  /** Battery modules already covered by the base price. */
  batteriesIncluded: number
}

export const DEFAULT_PRICING: PricingConfig = {
  baseCost: {
    on_grid: 95_000,
    hybrid: 139_000,
    off_grid: 180_000,
  },
  costPerKwp: {
    on_grid: 32_000,
    hybrid: 38_800,
    off_grid: 46_000,
  },
  costPerBattery: 95_000,
  // A hybrid quote of this shape ships with a 16 kWh pack — roughly three
  // 5.12 kWh modules — already in the base price.
  batteriesIncluded: 3,
}

/**
 * What a system of a given size sells for.
 *
 * Exported because the estimator is not the only place that has to put a peso
 * figure on a kilowatt: the CRM values its pipeline, and the analytics page
 * reports it. Each of those had its own rate typed into its own file — 60,000
 * in the CRM, 60,000 again in analytics, 72,000 in the settings table — so the
 * same lead was worth three different amounts depending on which screen you
 * looked at. One function, one answer.
 */
export function systemPrice(
  kw: number,
  systemType: SystemType,
  pricing: PricingConfig = DEFAULT_PRICING,
  batteryCount = 0,
): number {
  const extraBatteries = Math.max(0, batteryCount - pricing.batteriesIncluded)
  return (
    pricing.baseCost[systemType] +
    kw * pricing.costPerKwp[systemType] +
    extraBatteries * pricing.costPerBattery
  )
}

/**
 * The array sizes SolarBros actually sells, kWp.
 *
 * These are the REAL sizes — panel count x 620 W — not the marketing names. The
 * "5kW Hybrid" is 8 panels, which is 4.96 kWp, and quoting the round name would
 * overstate production by nearly a percent before any other assumption is even
 * made. The ladder used to be [3, 4, 5, 6, 8, 10, ...], round numbers that
 * matched nothing in the catalogue, so the estimator could recommend a 3 kW
 * system the company does not sell and price it at a rate nobody quotes.
 *
 * Keep this in step with the `packages` table. The numbers above 18.6 kWp are
 * commercial jobs, which are surveyed and quoted individually rather than
 * picked off a price list.
 */
const ARRAY_SIZES = [4.96, 6.2, 8.68, 9.92, 12.4, 16.12, 18.6, 25, 30, 40, 50]

/**
 * Inverter sizes, kW. A SEPARATE ladder, because an inverter is a separate
 * piece of hardware sold in round ratings — there is no such thing as an
 * 8.68 kW inverter. Snapping the inverter to the array ladder was quietly
 * specifying equipment that cannot be bought.
 */
const INVERTER_SIZES = [3, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50]

/* --- Input & output shapes ---------------------------------------------------- */

/** One line in the customer's appliance list. */
export interface ApplianceLoad {
  /** Catalogue id, or a generated id for a custom appliance. */
  applianceId: string
  quantity: number
  hoursPerDay: number
  /** Inverter-type units average roughly half the energy of a fixed-speed one. */
  isInverterType?: boolean
  /** Present only for user-added custom appliances. */
  custom?: { name: string; watts: number }
}

export interface EstimatorInput {
  /**
   * Live prices from the `pricing.*` settings.
   *
   * Omitted falls back to DEFAULT_PRICING. That fallback is for tests and for
   * the first paint before settings arrive — NOT a second set of prices the
   * business is expected to keep in step. When the owner changes a figure in
   * Business Settings, this is how it reaches the public estimator.
   */
  pricing?: PricingConfig

  /**
   * Live hardware assumptions from the `pricing.*` settings. Omitted falls back
   * to DEFAULT_ASSUMPTIONS, for the same reason as `pricing` above.
   */
  assumptions?: SystemAssumptions

  appliances: ApplianceLoad[]
  usagePatternId: 'day' | 'balanced' | 'night'
  regionId: string
  /** Optional cross-check. Never used to size anything, only to compare. */
  monthlyBill?: number
  /** Optional cap. When supplied and too small, it limits the array. */
  roofAreaSqm?: number
  /** Optional override of the region's default tariff. */
  ratePerKwh?: number
}

export interface ApplianceBreakdown {
  applianceId: string
  name: string
  quantity: number
  /** Effective watts per unit after any inverter-type discount. */
  wattsEach: number
  /** Contribution to peak load, watts. */
  peakWatts: number
  /** Contribution to daily energy, watt-hours. */
  dailyWh: number
  /** What this line alone costs to run per month at the chosen tariff, PHP. */
  monthlyCost: number
  /** Share of the household's daily energy, 0-1. Drives the "biggest" callout. */
  shareOfDaily: number
}

export interface EstimatorResult {
  /* Demand */
  peakLoadW: number
  dailyWh: number
  dailyKwh: number
  monthlyKwh: number
  /**
   * What the household currently pays per month at the chosen tariff.
   *
   * Exposed here rather than recomputed in the UI. Multiplying a already
   * rounded monthlyKwh by the rate in a component produces a figure a few pesos
   * away from monthlySavings, and the page then shows "costs you X" beside
   * "saving you Y" where the two disagree at 100% offset.
   */
  currentMonthlyCost: number
  applianceCount: number
  breakdown: ApplianceBreakdown[]

  /* Recommended hardware */
  recommendedKw: number
  panelCount: number
  inverterKw: number
  batteryCount: number
  batteryKwh: number
  systemType: SystemType
  roofAreaNeededSqm: number
  roofLimited: boolean

  /* Production & money */
  monthlyKwhProduced: number
  offsetShare: number
  monthlySavings: number
  annualSavings: number
  estimatedCost: number
  paybackYears: number
  lifetimeSavings: number
  ratePerKwh: number
  peakSunHours: number

  /* Cross-check against the bill the customer typed, when they gave one */
  billCheck?: {
    statedMonthlyBill: number
    impliedMonthlyBill: number
    /** How far the appliance list is from the stated bill, as a fraction. */
    variance: number
    verdict: 'close' | 'appliances_low' | 'appliances_high'
  }
}

/* --- The calculation ---------------------------------------------------------- */

/**
 * Choose the architecture that fits how the household actually lives.
 *
 * On-grid is cheapest but dies in a brownout and stores nothing overnight.
 * Once a meaningful share of consumption happens after dark, a hybrid with
 * batteries stops being a luxury and starts being the only thing that answers
 * the customer's actual problem.
 */
function recommendSystemType(nightShare: number, dailyKwh: number): SystemType {
  if (nightShare >= 0.7 && dailyKwh > 6) return 'hybrid'
  if (nightShare >= 0.45) return 'hybrid'
  return 'on_grid'
}

/** Snap a raw kW figure up to the nearest size the company actually sells. */
function snapToPackage(kw: number): number {
  return ARRAY_SIZES.find((size) => size >= kw) ?? Math.ceil(kw / 10) * 10
}

/** Round an inverter rating up to one that exists. */
function snapToInverter(kw: number): number {
  return INVERTER_SIZES.find((size) => size >= kw) ?? Math.ceil(kw / 10) * 10
}

export function estimateSolar(input: EstimatorInput): EstimatorResult {
  const spec = input.assumptions ?? DEFAULT_ASSUMPTIONS
  const region = REGIONS.find((r) => r.id === input.regionId) ?? REGIONS[0]
  const pattern = USAGE_PATTERNS.find((p) => p.id === input.usagePatternId) ?? USAGE_PATTERNS[1]
  const ratePerKwh = input.ratePerKwh ?? region.ratePerKwh
  const peakSunHours = region.peakSunHours

  /* 1. Turn the appliance list into peak watts and daily watt-hours. ---------- */
  const rawBreakdown = input.appliances
    .filter((line) => line.quantity > 0)
    .map((line) => {
      const spec = findAppliance(line.applianceId)
      const name = line.custom?.name ?? spec?.name ?? 'Appliance'
      const baseWatts = line.custom?.watts ?? spec?.watts ?? 0
      const dutyCycle = line.custom ? 1 : (spec?.dutyCycle ?? 1)

      // An inverter-type unit modulates instead of switching fully on and off,
      // which cuts its energy use roughly in half over a day.
      const wattsEach = line.isInverterType ? baseWatts * 0.5 : baseWatts

      const peakWatts = wattsEach * line.quantity
      const dailyWh = peakWatts * line.hoursPerDay * dutyCycle

      return {
        applianceId: line.applianceId,
        name,
        quantity: line.quantity,
        wattsEach: Math.round(wattsEach),
        peakWatts: Math.round(peakWatts),
        dailyWh: Math.round(dailyWh),
        monthlyCost: Math.round((dailyWh / 1000) * 30 * ratePerKwh),
      }
    })

  const peakLoadW = rawBreakdown.reduce((sum, line) => sum + line.peakWatts, 0)
  const dailyWh = rawBreakdown.reduce((sum, line) => sum + line.dailyWh, 0)
  const dailyKwh = dailyWh / 1000
  const monthlyKwh = dailyKwh * 30

  const breakdown: ApplianceBreakdown[] = rawBreakdown
    .map((line) => ({ ...line, shareOfDaily: dailyWh > 0 ? line.dailyWh / dailyWh : 0 }))
    .sort((a, b) => b.dailyWh - a.dailyWh)

  const applianceCount = input.appliances
    .filter((l) => l.quantity > 0)
    .reduce((sum, l) => sum + l.quantity, 0)

  /* 2. Size the array from DAILY ENERGY. ------------------------------------- */
  // kW needed = daily kWh / (sun hours x system efficiency)
  const kwFromEnergy = dailyKwh / (peakSunHours * spec.performanceRatio)

  /* 3. Size the inverter from PEAK LOAD, then take the larger constraint. ----- */
  // Not every appliance runs at once in a real home, so applying the full peak
  // would oversell badly. 0.7 is a standard diversity factor for a household.
  const diversifiedPeakKw = ((peakLoadW * 0.7) / 1000) * spec.inverterHeadroom

  /* 4. Cap by roof area when the customer supplied one. ---------------------- */
  const kwFromRoof = input.roofAreaSqm ? input.roofAreaSqm / spec.sqmPerKw : Infinity
  const unconstrainedKw = Math.max(kwFromEnergy, diversifiedPeakKw)
  const roofLimited = kwFromRoof < unconstrainedKw

  const recommendedKw = Math.max(1, snapToPackage(Math.min(unconstrainedKw, kwFromRoof)))
  const inverterKw = snapToInverter(Math.max(recommendedKw, diversifiedPeakKw))

  /* 5. Battery sizing follows the night share. ------------------------------- */
  const systemType = recommendSystemType(pattern.nightShare, dailyKwh)
  const nightKwh = dailyKwh * pattern.nightShare
  const batteryCount =
    systemType === 'on_grid'
      ? 0
      : Math.max(1, Math.ceil(nightKwh / (spec.batteryKwh * BATTERY_DOD)))
  const batteryKwh = Number((batteryCount * spec.batteryKwh).toFixed(2))

  /* 6. Production and money. -------------------------------------------------- */
  const monthlyKwhProduced = recommendedKw * peakSunHours * 30 * spec.performanceRatio

  // Savings can never exceed what the household actually consumes: exporting
  // surplus under net metering credits at a lower rate, so we do not promise it.
  const offsetKwh = Math.min(monthlyKwhProduced, monthlyKwh)
  const offsetShare = monthlyKwh > 0 ? offsetKwh / monthlyKwh : 0

  // Round the monthly figure FIRST, then derive the annual one from it.
  // Rounding each independently lets the page show a monthly saving that does
  // not multiply up to the annual saving printed beside it - a small
  // inconsistency, but exactly the kind a sceptical customer spots and asks
  // about. Every downstream figure is built from these rounded values.
  const monthlySavings = Math.round(offsetKwh * ratePerKwh)
  const annualSavings = monthlySavings * 12

  /* Base + rate per kWp, plus only the battery modules beyond what the base
     already covers. Charging for every module on top of a base price that
     included three of them was double-counting the pack. */
  const estimatedCost = systemPrice(recommendedKw, systemType, input.pricing, batteryCount)

  const paybackYears = annualSavings > 0 ? estimatedCost / annualSavings : Infinity
  const lifetimeSavings = annualSavings * spec.lifetimeYears - estimatedCost

  /* 7. Cross-check against the stated bill, if there is one. ------------------ */
  let billCheck: EstimatorResult['billCheck']
  if (input.monthlyBill && input.monthlyBill > 0) {
    const impliedMonthlyBill = monthlyKwh * ratePerKwh
    const variance = (impliedMonthlyBill - input.monthlyBill) / input.monthlyBill
    billCheck = {
      statedMonthlyBill: input.monthlyBill,
      impliedMonthlyBill: Math.round(impliedMonthlyBill),
      variance: Number(variance.toFixed(2)),
      verdict:
        Math.abs(variance) <= 0.25 ? 'close' : variance < 0 ? 'appliances_low' : 'appliances_high',
    }
  }

  return {
    peakLoadW: Math.round(peakLoadW),
    dailyWh: Math.round(dailyWh),
    dailyKwh: Number(dailyKwh.toFixed(2)),
    monthlyKwh: Math.round(monthlyKwh),
    currentMonthlyCost: Math.round(monthlyKwh * ratePerKwh),
    applianceCount,
    breakdown,

    recommendedKw,
    panelCount: Math.ceil((recommendedKw * 1000) / spec.panelWatts),
    inverterKw,
    batteryCount,
    batteryKwh,
    systemType,
    roofAreaNeededSqm: Math.round(recommendedKw * spec.sqmPerKw),
    roofLimited,

    monthlyKwhProduced: Math.round(monthlyKwhProduced),
    offsetShare: Number(offsetShare.toFixed(2)),
    monthlySavings,
    annualSavings,
    estimatedCost: Math.round(estimatedCost),
    paybackYears: Number(paybackYears.toFixed(1)),
    lifetimeSavings: Math.round(lifetimeSavings),
    ratePerKwh,
    peakSunHours,

    billCheck,
  }
}

/* ============================================================================
   PLAIN-LANGUAGE HELPERS
   ----------------------------------------------------------------------------
   Turning watts into something a person can picture. These exist because the
   estimator has to teach as well as calculate - a customer who does not
   understand the number will not trust the quotation built on it.
   ========================================================================== */

/** How many LED bulbs the given peak draw is equivalent to. */
export function inLedBulbs(watts: number): number {
  return Math.round(watts / 9)
}

/**
 * Describe a peak load in terms of an everyday appliance, so the number stops
 * being abstract. Returns a short phrase to append after the figure.
 */
export function describePeakLoad(watts: number): string {
  if (watts <= 0) return 'nothing selected yet'
  if (watts < 300) return `about the same as ${inLedBulbs(watts)} LED bulbs`
  if (watts < 900) return 'roughly one bedroom aircon running'
  if (watts < 2000) return 'roughly a large aircon plus a rice cooker'
  if (watts < 4000) return 'roughly an induction hob and an aircon at the same time'
  if (watts < 8000) return 'a whole household running flat out'
  return 'a small commercial load'
}

/** Financing options shown beside the cash price. Illustrative terms only. */
export interface PaymentOption {
  id: string
  label: string
  note: string
  /** Monthly amount, or null when it is a single payment. */
  monthly: number | null
  total: number
}

export function paymentOptions(price: number): PaymentOption[] {
  const cardMonths = 36
  const cardRate = 0.0 // Promotional 0% is common on PH card instalments.
  const loanMonths = 60
  const loanAnnualRate = 0.05

  // Simple flat-interest approximation, which is how most PH lenders quote.
  const loanTotal = price * (1 + (loanAnnualRate * loanMonths) / 12)

  return [
    {
      id: 'cash',
      label: 'Cash or bank transfer',
      note: 'Paid in stages as work completes. Installation starts soonest.',
      monthly: null,
      total: Math.round(price),
    },
    {
      id: 'card',
      label: `Credit card instalment (${cardMonths} months)`,
      note: 'Subject to your card issuer. Promotional rate to be confirmed.',
      monthly: Math.round((price * (1 + cardRate)) / cardMonths),
      total: Math.round(price * (1 + cardRate)),
    },
    {
      id: 'loan',
      label: `Bank or in-house financing (${loanMonths} months)`,
      note: 'Indicative at 5% per year. Final terms come from the lender.',
      monthly: Math.round(loanTotal / loanMonths),
      total: Math.round(loanTotal),
    },
  ]
}
