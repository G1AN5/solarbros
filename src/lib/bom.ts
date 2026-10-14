/* ============================================================================
   BILL OF MATERIALS — the first draft of what a system needs
   ----------------------------------------------------------------------------
   WHAT THIS REPLACED
   The quotation builder priced its bill of materials from a recipe keyed on
   SKUs: 'INV-DEYE-6K', 'BAT-PYL-5K', 'ACC-MC4-PR', 'CTL-MPPT-60'. None of
   those SKUs exist in the catalogue — the real ones are 'INV-DEYE-6',
   'BAT-51V-100', 'ACC-MC4', 'CHG-MPPT-60' — and a recipe line whose SKU was
   missing was silently skipped. So a 12 kWp HYBRID quotation went out with
   panels and rails on it and no inverter and no batteries, priced
   accordingly, and nothing on the screen said anything was missing.

   HOW THIS WORKS INSTEAD
   It reads the catalogue by CATEGORY and by what the item's name says it is,
   and sizes each line from the system:

     panels          kWp ÷ panel wattage (read from the name: "620W")
     inverter        the smallest one that can run the array, at up to 1.3×
                     DC-to-AC — read from the name: "8kW"
     batteries       the configured storage, in the module closest to the
                     configured size — read from the name: "5.12 kWh"
     charge control  off-grid only, one per 3 kWp
     racking         rails, clamps and feet per panel
     accessories     cable, connectors, combiner, distribution box, earthing

   It is a DRAFT. Every line is editable in the builder, and anything missing
   can be added — an engineer designing a roof knows things a rule does not.
   What it must never do again is leave out an inverter without saying so,
   which is why a category it cannot fill comes back as a warning.
   ========================================================================== */

import type { StockItem, SystemType } from '@/types/domain'

export interface BomDraftLine {
  stockItemId: string
  quantity: number
  /** Why this quantity — shown beside the line so the engineer can check it. */
  rule: string
}

export interface BomDraft {
  lines: BomDraftLine[]
  /** Categories the system needs that the catalogue could not supply. */
  warnings: string[]
  panelCount: number
  batteryCount: number
}

export interface BomInput {
  systemKw: number
  systemType: SystemType
  stock: StockItem[]
  panelWatts: number
  batteryKwh: number
  batteriesIncluded: number
}

/** "620W", "620 W" → 620. */
export function wattsInName(name: string): number | null {
  const match = name.match(/(\d{2,4})\s?W\b/i)
  return match ? Number(match[1]) : null
}

/** "8kW", "8 kW", "5.5kW" → 8 / 5.5. Never matches "kWh". */
export function kwInName(name: string): number | null {
  const match = name.match(/(\d+(?:\.\d+)?)\s?kW(?!h)/i)
  return match ? Number(match[1]) : null
}

/** "16 kWh", "5.12kWh" → 16 / 5.12. */
export function kwhInName(name: string): number | null {
  const match = name.match(/(\d+(?:\.\d+)?)\s?kWh/i)
  return match ? Number(match[1]) : null
}

function free(item: StockItem): number {
  return item.onHand - item.reserved
}

/** Prefer what is in stock, then what is cheaper — a stable, explainable order. */
function byPreference(a: StockItem, b: StockItem): number {
  return free(b) - free(a) || a.unitCost - b.unitCost || a.name.localeCompare(b.name)
}

function find(stock: StockItem[], category: StockItem['category'], pattern?: RegExp) {
  return stock
    .filter((s) => s.category === category && (!pattern || pattern.test(s.name)))
    .sort(byPreference)
}

export function suggestBom(input: BomInput): BomDraft {
  const { systemKw, systemType, stock } = input
  const lines: BomDraftLine[] = []
  const warnings: string[] = []

  if (!(systemKw > 0)) {
    return {
      lines,
      warnings: ['Enter a system size to build the bill of materials.'],
      panelCount: 0,
      batteryCount: 0,
    }
  }

  /* --- Panels ------------------------------------------------------------ */
  const panels = find(stock, 'panel')
  const preferredPanel = panels.find((p) => wattsInName(p.name) === input.panelWatts) ?? panels[0]
  let panelCount = 0
  if (preferredPanel) {
    const watts = wattsInName(preferredPanel.name) ?? input.panelWatts
    panelCount = Math.ceil((systemKw * 1000) / watts)
    lines.push({
      stockItemId: preferredPanel.id,
      quantity: panelCount,
      rule: `${systemKw} kWp ÷ ${watts} W per panel`,
    })
  } else {
    warnings.push('No panels in the catalogue — add them under Inventory.')
  }

  /* --- Inverter ---------------------------------------------------------- */
  const wantsHybrid = systemType !== 'on_grid'
  const inverters = find(stock, 'inverter')
  const suited = inverters.filter((inv) =>
    wantsHybrid ? /hybrid|off-?grid/i.test(inv.name) : /on-?grid|grid-?tie/i.test(inv.name),
  )
  const candidates = (suited.length > 0 ? suited : inverters)
    .map((inv) => ({ inv, kw: kwInName(inv.name) }))
    .sort((a, b) => (a.kw ?? Infinity) - (b.kw ?? Infinity))

  if (candidates.length > 0) {
    // An array can run up to 1.3× its inverter's AC rating — standard practice.
    const needKw = systemKw / 1.3
    const fits = candidates.find((c) => c.kw !== null && c.kw >= needKw)
    if (fits) {
      lines.push({
        stockItemId: fits.inv.id,
        quantity: 1,
        rule: `smallest ${wantsHybrid ? 'hybrid' : 'grid-tie'} inverter for ${systemKw} kWp (≥ ${needKw.toFixed(1)} kW)`,
      })
    } else {
      const largest =
        candidates.filter((c) => c.kw !== null).pop() ?? candidates[candidates.length - 1]
      const quantity = largest.kw ? Math.ceil(needKw / largest.kw) : 1
      lines.push({
        stockItemId: largest.inv.id,
        quantity,
        rule: largest.kw
          ? `${quantity} × ${largest.kw} kW to cover ${needKw.toFixed(1)} kW`
          : 'one inverter — size could not be read from its name',
      })
    }
    if (suited.length === 0) {
      warnings.push(
        `No ${wantsHybrid ? 'hybrid' : 'grid-tie'} inverter is named as such in the catalogue — check the inverter line.`,
      )
    }
  } else {
    warnings.push('No inverters in the catalogue — the quotation would have no inverter.')
  }

  /* --- Batteries --------------------------------------------------------- */
  let batteryCount = 0
  if (systemType !== 'on_grid') {
    const batteries = find(stock, 'battery')
      .map((b) => ({ b, kwh: kwhInName(b.name) }))
      .sort(
        (x, y) =>
          Math.abs((x.kwh ?? 999) - input.batteryKwh) - Math.abs((y.kwh ?? 999) - input.batteryKwh),
      )
    const modules = Math.max(input.batteriesIncluded, 1) * (systemType === 'off_grid' ? 2 : 1)
    const targetKwh = modules * input.batteryKwh

    if (batteries.length > 0) {
      const chosen = batteries[0]
      batteryCount = chosen.kwh ? Math.max(1, Math.ceil(targetKwh / chosen.kwh)) : modules
      lines.push({
        stockItemId: chosen.b.id,
        quantity: batteryCount,
        rule: `${targetKwh.toFixed(2)} kWh of storage${
          systemType === 'off_grid' ? ' (double for off-grid)' : ''
        }`,
      })
    } else {
      warnings.push('No batteries in the catalogue — a hybrid or off-grid system needs them.')
    }
  }

  /* --- Charge control (off-grid) ---------------------------------------- */
  if (systemType === 'off_grid') {
    const controller = find(stock, 'charge_controller')[0]
    if (controller) {
      lines.push({
        stockItemId: controller.id,
        quantity: Math.max(1, Math.ceil(systemKw / 3)),
        rule: 'one MPPT controller per 3 kWp',
      })
    } else {
      warnings.push('No charge controller in the catalogue — an off-grid system needs one.')
    }
  }

  /* --- Racking and balance of system ------------------------------------ */
  if (panelCount > 0) {
    const rule = (
      category: StockItem['category'],
      pattern: RegExp,
      quantity: number,
      why: string,
    ) => {
      const item = find(stock, category, pattern)[0]
      if (item && quantity > 0) lines.push({ stockItemId: item.id, quantity, rule: why })
    }

    const rows = Math.ceil(panelCount / 6)
    rule('racking', /rail/i, panelCount, 'one rail per panel')
    rule('racking', /mid\s?clamp/i, panelCount * 2, 'two mid clamps per panel')
    rule('racking', /end\s?clamp/i, rows * 4, 'four end clamps per row of six')
    rule('racking', /foot|feet|hook/i, panelCount * 2, 'two roof mounts per rail')
    rule('accessory', /dc\s?cable/i, 30 + panelCount * 3, '30 m run plus 3 m per panel')
    rule('accessory', /ac\s?cable/i, 20, '20 m to the distribution board')
    rule('accessory', /mc4/i, Math.ceil(panelCount / 2) + 2, 'a pair per string, plus spares')
    rule('accessory', /combiner|dc.*box/i, 1, 'one per system')
    rule('accessory', /ac.*(distribution|box)|distribution/i, 1, 'one per system')
    rule('accessory', /earth/i, 1, 'one per system')
  }

  // The same item twice (a name matching two rules) is merged, not doubled.
  const merged = new Map<string, BomDraftLine>()
  for (const line of lines) {
    const existing = merged.get(line.stockItemId)
    if (existing) existing.quantity += line.quantity
    else merged.set(line.stockItemId, { ...line })
  }

  return { lines: [...merged.values()], warnings, panelCount, batteryCount }
}

/* ============================================================================
   A PACKAGE'S OWN LIST
   ----------------------------------------------------------------------------
   A package can carry the equipment it is sold with (migration 0079). The
   quotation builder starts from that list instead of the rules above, and the
   same gaps are pointed out either way: a list somebody typed can leave out
   an inverter as easily as a rule could.
   ========================================================================== */

export interface PackageBomLine {
  stockItemId: string
  quantity: number
}

/**
 * The `bom` column as lines, whatever arrives — a database that has not had
 * 0079 yet sends nothing at all. Malformed entries are dropped, and an item
 * listed twice is one line with the quantities added.
 */
export function parsePackageBom(value: unknown): PackageBomLine[] {
  if (!Array.isArray(value)) return []
  const merged = new Map<string, number>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const { stock_item_id: id, quantity } = entry as Record<string, unknown>
    const qty = Number(quantity)
    if (typeof id !== 'string' || !id || !Number.isFinite(qty) || qty <= 0) continue
    merged.set(id, (merged.get(id) ?? 0) + qty)
  }
  return [...merged].map(([stockItemId, quantity]) => ({ stockItemId, quantity }))
}

/** The lines in the shape the `bom` column stores. */
export function serialisePackageBom(lines: PackageBomLine[]) {
  return parsePackageBom(
    lines.map((line) => ({ stock_item_id: line.stockItemId, quantity: line.quantity })),
  ).map((line) => ({ stock_item_id: line.stockItemId, quantity: line.quantity }))
}

/** What a system of this type cannot work without that the list does not have. */
export function bomGaps(
  systemType: SystemType,
  categories: Iterable<StockItem['category']>,
): string[] {
  const present = new Set(categories)
  const gaps: string[] = []
  if (!present.has('panel')) gaps.push('No panels on this bill of materials.')
  if (!present.has('inverter')) gaps.push('No inverter on this bill of materials.')
  if (systemType !== 'on_grid' && !present.has('battery')) {
    gaps.push('No batteries — a hybrid or off-grid system needs them.')
  }
  return gaps
}
