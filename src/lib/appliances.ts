/* ============================================================================
   APPLIANCE CATALOGUE
   ----------------------------------------------------------------------------
   Powers the public estimator's appliance picker.

   WHY APPLIANCE-LEVEL INPUT BEATS ASKING FOR THE BILL
   A monthly bill is one number that hides everything useful. Two households
   paying PHP 8,000 can need completely different systems: one runs an aircon
   all night (needs batteries), the other runs a water pump and freezer during
   the day (needs panels, barely any battery). Only the appliance list tells us
   WHEN the energy is used, and "when" is what decides battery sizing.

   It is also the honest way to teach the customer. Ticking "Aircon 1HP, 6
   hours" and watching PHP 67 per day appear next to it does more to explain a
   bill than any paragraph of copy.

   NO IMAGE ASSETS ANYWHERE HERE - icons are emoji. The whole catalogue costs
   about 4 KB of JavaScript and zero network requests, which matters because
   this is the first page a prospect on mobile data ever loads.

   WARNING: wattages are typical Philippine retail figures for the UI phase.
   Have an engineer confirm them against the units SolarBros actually sees on
   site before launch.
   ========================================================================== */

export type ApplianceCategory = 'cooling' | 'kitchen' | 'water' | 'tech' | 'lighting' | 'other'

export interface ApplianceSpec {
  id: string
  name: string
  category: ApplianceCategory
  /** Nameplate draw of ONE unit, in watts, while it is actively running. */
  watts: number
  /** Sensible starting guess for hours switched on per day. */
  defaultHours: number
  /**
   * Fraction of "switched on" time the appliance actually draws full power.
   *
   * A refrigerator is plugged in 24 hours, but its compressor only runs about a
   * third of the time. Treating it as 24 hours at full draw would overstate its
   * consumption threefold and oversize the whole system. A value of 1 means
   * "draws full power the entire time it is on", which is true of a kettle or
   * a light bulb.
   */
  dutyCycle: number
  /** Can this model be an inverter / variable-speed type? Shows the toggle. */
  invertible?: boolean
  /** Plain-language aside shown under the appliance once it is selected. */
  note?: string
}

export const APPLIANCE_CATEGORIES: {
  id: ApplianceCategory
  label: string
  icon: string
  blurb: string
}[] = [
  {
    id: 'cooling',
    label: 'Cooling',
    icon: '❄️',
    blurb: 'Usually the biggest item on a Philippine electricity bill.',
  },
  { id: 'kitchen', label: 'Kitchen', icon: '🍳', blurb: 'Short bursts, but very high power.' },
  {
    id: 'water',
    label: 'Water & laundry',
    icon: '🚿',
    blurb: 'Pumps and heaters are power-hungry.',
  },
  { id: 'tech', label: 'TV, work & entertainment', icon: '💻', blurb: 'Small draw, long hours.' },
  {
    id: 'lighting',
    label: 'Lighting',
    icon: '💡',
    blurb: 'Tiny individually - they add up in number.',
  },
  { id: 'other', label: 'Other', icon: '🔌', blurb: 'Anything else that plugs into a wall.' },
]

export const APPLIANCES: ApplianceSpec[] = [
  /* ---------------------------------------------------------------- COOLING */
  {
    id: 'ac-05',
    name: 'Aircon 0.5 HP (window)',
    category: 'cooling',
    watts: 500,
    defaultHours: 6,
    dutyCycle: 1,
    invertible: true,
  },
  {
    id: 'ac-10',
    name: 'Aircon 1 HP',
    category: 'cooling',
    watts: 750,
    defaultHours: 6,
    dutyCycle: 1,
    invertible: true,
    note: 'A typical bedroom unit, and the single most expensive thing most homes run.',
  },
  {
    id: 'ac-15',
    name: 'Aircon 1.5 HP',
    category: 'cooling',
    watts: 1100,
    defaultHours: 6,
    dutyCycle: 1,
    invertible: true,
  },
  {
    id: 'ac-20',
    name: 'Aircon 2 HP',
    category: 'cooling',
    watts: 1500,
    defaultHours: 6,
    dutyCycle: 1,
    invertible: true,
  },
  {
    id: 'ac-25',
    name: 'Aircon 2.5 HP',
    category: 'cooling',
    watts: 1900,
    defaultHours: 6,
    dutyCycle: 1,
    invertible: true,
  },
  {
    id: 'ac-30',
    name: 'Aircon 3 HP (split type)',
    category: 'cooling',
    watts: 2200,
    defaultHours: 6,
    dutyCycle: 1,
    invertible: true,
  },
  {
    id: 'fan-stand',
    name: 'Electric fan',
    category: 'cooling',
    watts: 60,
    defaultHours: 8,
    dutyCycle: 1,
  },
  {
    id: 'fan-ceiling',
    name: 'Ceiling fan',
    category: 'cooling',
    watts: 75,
    defaultHours: 8,
    dutyCycle: 1,
  },

  /* ---------------------------------------------------------------- KITCHEN */
  {
    id: 'ref-2door',
    name: 'Refrigerator (2-door)',
    category: 'kitchen',
    watts: 150,
    defaultHours: 24,
    dutyCycle: 0.35,
    invertible: true,
    note: 'Plugged in all day, but the compressor only runs about a third of the time.',
  },
  {
    id: 'freezer',
    name: 'Chest freezer',
    category: 'kitchen',
    watts: 250,
    defaultHours: 24,
    dutyCycle: 0.4,
    invertible: true,
  },
  {
    id: 'rice',
    name: 'Rice cooker',
    category: 'kitchen',
    watts: 700,
    defaultHours: 1,
    dutyCycle: 1,
  },
  {
    id: 'microwave',
    name: 'Microwave / oven toaster',
    category: 'kitchen',
    watts: 1200,
    defaultHours: 1,
    dutyCycle: 1,
  },
  {
    id: 'induction',
    name: 'Electric / induction stove',
    category: 'kitchen',
    watts: 2000,
    defaultHours: 2,
    dutyCycle: 1,
    note: 'Very high draw. On its own it often decides how big the inverter has to be.',
  },
  {
    id: 'airfryer',
    name: 'Air fryer',
    category: 'kitchen',
    watts: 1500,
    defaultHours: 1,
    dutyCycle: 1,
  },
  {
    id: 'kettle',
    name: 'Electric kettle',
    category: 'kitchen',
    watts: 1500,
    defaultHours: 1,
    dutyCycle: 1,
  },
  {
    id: 'dispenser',
    name: 'Water dispenser (hot & cold)',
    category: 'kitchen',
    watts: 550,
    defaultHours: 24,
    dutyCycle: 0.25,
  },

  /* ------------------------------------------------------------------ WATER */
  {
    id: 'pump',
    name: 'Water pump (1 HP)',
    category: 'water',
    watts: 750,
    defaultHours: 2,
    dutyCycle: 1,
  },
  {
    id: 'heater',
    name: 'Water heater (shower)',
    category: 'water',
    watts: 3500,
    defaultHours: 1,
    dutyCycle: 1,
    note: 'Short use, enormous draw. Needs a big inverter for just a few minutes a day.',
  },
  {
    id: 'washer',
    name: 'Washing machine',
    category: 'water',
    watts: 500,
    defaultHours: 2,
    dutyCycle: 1,
    invertible: true,
  },
  {
    id: 'dryer',
    name: 'Clothes dryer',
    category: 'water',
    watts: 2500,
    defaultHours: 1,
    dutyCycle: 1,
  },

  /* ------------------------------------------------------------------- TECH */
  {
    id: 'tv',
    name: 'TV (LED, 43 inch)',
    category: 'tech',
    watts: 100,
    defaultHours: 5,
    dutyCycle: 1,
  },
  { id: 'laptop', name: 'Laptop', category: 'tech', watts: 90, defaultHours: 8, dutyCycle: 1 },
  {
    id: 'desktop',
    name: 'Desktop computer',
    category: 'tech',
    watts: 300,
    defaultHours: 8,
    dutyCycle: 1,
  },
  {
    id: 'router',
    name: 'Router / modem',
    category: 'tech',
    watts: 30,
    defaultHours: 24,
    dutyCycle: 1,
    note: 'Left on permanently. This is the kind of small load a battery has to carry all night.',
  },
  { id: 'cctv', name: 'CCTV system', category: 'tech', watts: 50, defaultHours: 24, dutyCycle: 1 },
  {
    id: 'iron',
    name: 'Electric iron',
    category: 'tech',
    watts: 1000,
    defaultHours: 1,
    dutyCycle: 1,
  },

  /* --------------------------------------------------------------- LIGHTING */
  {
    id: 'led',
    name: 'LED bulb',
    category: 'lighting',
    watts: 9,
    defaultHours: 6,
    dutyCycle: 1,
    note: 'Nine watts. You could run 83 of these on what one 1 HP aircon uses.',
  },
  {
    id: 'cfl',
    name: 'CFL / fluorescent tube',
    category: 'lighting',
    watts: 15,
    defaultHours: 6,
    dutyCycle: 1,
  },
  {
    id: 'incandescent',
    name: 'Incandescent bulb',
    category: 'lighting',
    watts: 45,
    defaultHours: 6,
    dutyCycle: 1,
    note: 'Five times an LED for the same light. Worth replacing before sizing a system.',
  },

  /* ------------------------------------------------------------------ OTHER */
  {
    id: 'ev',
    name: 'Electric vehicle charger',
    category: 'other',
    watts: 3500,
    defaultHours: 3,
    dutyCycle: 1,
  },
  {
    id: 'tools',
    name: 'Welding machine / power tools',
    category: 'other',
    watts: 2500,
    defaultHours: 1,
    dutyCycle: 1,
  },
]

/* ============================================================================
   REGIONS - peak sun hours
   ----------------------------------------------------------------------------
   "Peak sun hours" is how many hours of perfect noon sun a location effectively
   gets per day, once mornings, afternoons, clouds and the rainy season are
   averaged out. A 1 kW array in a 4.5-hour location makes about 4.5 kWh on an
   average day.

   The Philippines sits between roughly 4.2 and 5.0. The spread looks small, but
   it moves the panel count enough to matter on a quotation.
   ========================================================================== */

export interface Region {
  id: string
  label: string
  peakSunHours: number
  /** Typical residential rate, PHP per kWh, used as the starting figure. */
  ratePerKwh: number
}

export const REGIONS: Region[] = [
  { id: 'ncr', label: 'Metro Manila (NCR)', peakSunHours: 4.5, ratePerKwh: 13.5 },
  {
    id: 'calabarzon',
    label: 'CALABARZON (Cavite, Laguna, Batangas, Rizal, Quezon)',
    peakSunHours: 4.6,
    ratePerKwh: 13.0,
  },
  {
    id: 'central-luzon',
    label: 'Central Luzon (Bulacan, Pampanga, Nueva Ecija)',
    peakSunHours: 4.7,
    ratePerKwh: 12.5,
  },
  { id: 'ilocos', label: 'Ilocos Region', peakSunHours: 4.8, ratePerKwh: 12.0 },
  { id: 'cagayan', label: 'Cagayan Valley', peakSunHours: 4.6, ratePerKwh: 12.0 },
  { id: 'car', label: 'Cordillera (Baguio, Benguet)', peakSunHours: 4.3, ratePerKwh: 11.5 },
  { id: 'bicol', label: 'Bicol Region', peakSunHours: 4.2, ratePerKwh: 13.0 },
  { id: 'mimaropa', label: 'MIMAROPA (Mindoro, Palawan)', peakSunHours: 4.9, ratePerKwh: 15.0 },
  {
    id: 'w-visayas',
    label: 'Western Visayas (Iloilo, Bacolod)',
    peakSunHours: 4.8,
    ratePerKwh: 13.5,
  },
  { id: 'c-visayas', label: 'Central Visayas (Cebu, Bohol)', peakSunHours: 4.9, ratePerKwh: 14.0 },
  { id: 'e-visayas', label: 'Eastern Visayas (Leyte, Samar)', peakSunHours: 4.3, ratePerKwh: 13.0 },
  { id: 'zamboanga', label: 'Zamboanga Peninsula', peakSunHours: 4.8, ratePerKwh: 12.5 },
  {
    id: 'n-mindanao',
    label: 'Northern Mindanao (Cagayan de Oro)',
    peakSunHours: 4.7,
    ratePerKwh: 12.5,
  },
  { id: 'davao', label: 'Davao Region', peakSunHours: 4.7, ratePerKwh: 12.5 },
  { id: 'soccsksargen', label: 'SOCCSKSARGEN', peakSunHours: 4.9, ratePerKwh: 12.5 },
  { id: 'caraga', label: 'Caraga', peakSunHours: 4.4, ratePerKwh: 13.0 },
  { id: 'barmm', label: 'BARMM', peakSunHours: 4.8, ratePerKwh: 12.5 },
]

/* ============================================================================
   USAGE PATTERNS
   ----------------------------------------------------------------------------
   This is the question that decides how many batteries a household needs, and
   it is the one a bill-only estimator can never answer.

   Panels only make power while the sun is up. Energy used after dark has to
   come from somewhere - either the grid, or a battery the customer paid for. So
   the same daily consumption can mean a very different system depending on WHEN
   it happens.
   ========================================================================== */

export interface UsagePattern {
  id: 'day' | 'balanced' | 'night'
  label: string
  description: string
  /** Share of the day's energy consumed after sunset. Drives battery sizing. */
  nightShare: number
  popular?: boolean
}

export const USAGE_PATTERNS: UsagePattern[] = [
  {
    id: 'day',
    label: 'Mostly daytime',
    description:
      'Someone is home during the day - working from home, a homemaker, young children. Little is used after dark.',
    nightShare: 0.25,
  },
  {
    id: 'balanced',
    label: 'Both day and night',
    description:
      'Appliances run through the day and the aircon runs at night. The most common Philippine household.',
    nightShare: 0.5,
    popular: true,
  },
  {
    id: 'night',
    label: 'Mostly evenings',
    description:
      'Out at work all day, home after dark. Most of the electricity is used once the sun has already set.',
    nightShare: 0.75,
  },
]

/** Look up an appliance by id. */
export function findAppliance(id: string): ApplianceSpec | undefined {
  return APPLIANCES.find((a) => a.id === id)
}
