import { describe, expect, it } from 'vitest'

import { kwhInName, kwInName, suggestBom, wattsInName } from '../bom'
import type { StockItem } from '@/types/domain'

/* The starter catalogue from migration 0069, as the builder receives it.
   These tests exist because the previous recipe referred to SKUs that were
   not in this list and silently dropped the inverter and the batteries. */
function item(
  sku: string,
  name: string,
  category: StockItem['category'],
  unitCost: number,
  unit = 'pc',
  onHand = 0,
): StockItem {
  return {
    id: sku,
    sku,
    name,
    category,
    brand: '',
    onHand,
    reserved: 0,
    reorderPoint: 0,
    unitCost,
    unit,
    isSerialised: ['panel', 'inverter', 'battery'].includes(category),
  }
}

const CATALOGUE: StockItem[] = [
  item('PNL-CS-620', 'Canadian Solar 620W Bifacial', 'panel', 9800),
  item('PNL-JA-620', 'JA Solar 620W Bifacial', 'panel', 9500),
  item('INV-DEYE-6', 'Deye 6kW Hybrid Inverter', 'inverter', 62000),
  item('INV-DEYE-8', 'Deye 8kW Hybrid Inverter', 'inverter', 78000),
  item('INV-DEYE-12', 'Deye 12kW Hybrid Inverter', 'inverter', 104000),
  item('INV-SOLIS-5', 'Solis 5kW On-Grid Inverter', 'inverter', 42000),
  item('BAT-51V-314', '51.2V 314Ah LiFePO4 Battery (16 kWh)', 'battery', 148000),
  item('BAT-51V-100', '51.2V 100Ah LiFePO4 Battery (5.12 kWh)', 'battery', 52000),
  item('RCK-RAIL-42', 'Aluminium Mounting Rail 4.2m', 'racking', 1450),
  item('RCK-CLAMP-M', 'Mid Clamp 35mm', 'racking', 85),
  item('RCK-CLAMP-E', 'End Clamp 35mm', 'racking', 95),
  item('RCK-FOOT-L', 'L-Foot Roof Mount', 'racking', 140),
  item('ACC-DC-6', 'Solar DC Cable 6mm² (per metre)', 'accessory', 95, 'm'),
  item('ACC-AC-14', 'AC Cable 14mm² (per metre)', 'accessory', 180, 'm'),
  item('ACC-MC4', 'MC4 Connector Pair', 'accessory', 160, 'pair'),
  item('ACC-DCBOX', 'DC Combiner Box with SPD', 'accessory', 4800),
  item('ACC-ACBOX', 'AC Distribution Box with Breaker', 'accessory', 3900),
  item('ACC-EARTH', 'Earthing Rod and Clamp Set', 'accessory', 1250, 'set'),
  item('CHG-MPPT-60', 'MPPT Charge Controller 60A', 'charge_controller', 18500),
]

const BASE = { stock: CATALOGUE, panelWatts: 620, batteryKwh: 5.12, batteriesIncluded: 3 }

function qty(draft: ReturnType<typeof suggestBom>, sku: string) {
  return draft.lines.find((l) => l.stockItemId === sku)?.quantity ?? 0
}

describe('reading sizes out of catalogue names', () => {
  it('reads panel watts, inverter kW and battery kWh', () => {
    expect(wattsInName('Canadian Solar 620W Bifacial')).toBe(620)
    expect(kwInName('Deye 12kW Hybrid Inverter')).toBe(12)
    expect(kwInName('Solis 5kW On-Grid Inverter')).toBe(5)
    expect(kwhInName('51.2V 100Ah LiFePO4 Battery (5.12 kWh)')).toBe(5.12)
  })

  it('never mistakes kWh for kW', () => {
    expect(kwInName('51.2V 314Ah LiFePO4 Battery (16 kWh)')).toBeNull()
  })
})

describe('suggestBom', () => {
  it('gives a hybrid system an inverter and batteries — the lines the old recipe dropped', () => {
    const draft = suggestBom({ ...BASE, systemKw: 12.4, systemType: 'hybrid' })

    expect(draft.panelCount).toBe(20) // 12,400 W ÷ 620 W
    expect(qty(draft, 'INV-DEYE-12')).toBe(1) // needs ≥ 9.5 kW
    expect(qty(draft, 'BAT-51V-100')).toBe(3) // 3 × 5.12 kWh
    expect(draft.batteryCount).toBe(3)
    expect(draft.warnings).toEqual([])
  })

  it('uses the cheaper of two equivalent panels', () => {
    const draft = suggestBom({ ...BASE, systemKw: 6.2, systemType: 'hybrid' })
    expect(qty(draft, 'PNL-JA-620')).toBe(10)
    expect(qty(draft, 'PNL-CS-620')).toBe(0)
  })

  it('prefers a panel that is actually in stock', () => {
    const stocked = CATALOGUE.map((s) => (s.sku === 'PNL-CS-620' ? { ...s, onHand: 40 } : s))
    const draft = suggestBom({ ...BASE, stock: stocked, systemKw: 6.2, systemType: 'hybrid' })
    expect(qty(draft, 'PNL-CS-620')).toBe(10)
  })

  it('gives an on-grid system a grid-tie inverter and no batteries', () => {
    const draft = suggestBom({ ...BASE, systemKw: 5, systemType: 'on_grid' })

    expect(qty(draft, 'INV-SOLIS-5')).toBe(1)
    expect(draft.batteryCount).toBe(0)
    expect(draft.lines.some((l) => l.stockItemId.startsWith('BAT'))).toBe(false)
  })

  it('doubles storage and adds charge control off-grid', () => {
    const draft = suggestBom({ ...BASE, systemKw: 6, systemType: 'off_grid' })

    expect(qty(draft, 'BAT-51V-100')).toBe(6)
    expect(qty(draft, 'CHG-MPPT-60')).toBe(2)
  })

  it('covers a system bigger than any one inverter with several', () => {
    const draft = suggestBom({ ...BASE, systemKw: 30, systemType: 'hybrid' })
    // 30 ÷ 1.3 = 23.1 kW → two 12 kW units
    expect(qty(draft, 'INV-DEYE-12')).toBe(2)
  })

  it('sizes racking and balance of system from the panel count', () => {
    const draft = suggestBom({ ...BASE, systemKw: 6.2, systemType: 'hybrid' })

    expect(qty(draft, 'RCK-RAIL-42')).toBe(10)
    expect(qty(draft, 'RCK-CLAMP-M')).toBe(20)
    expect(qty(draft, 'RCK-CLAMP-E')).toBe(8) // two rows of up to six
    expect(qty(draft, 'ACC-DC-6')).toBe(60) // 30 + 3 × 10
    expect(qty(draft, 'ACC-MC4')).toBe(7)
    expect(qty(draft, 'ACC-DCBOX')).toBe(1)
    expect(qty(draft, 'ACC-ACBOX')).toBe(1)
    expect(qty(draft, 'ACC-EARTH')).toBe(1)
  })

  it('says so when the catalogue cannot supply what the system needs', () => {
    const noInverters = CATALOGUE.filter((s) => s.category !== 'inverter')
    const draft = suggestBom({ ...BASE, stock: noInverters, systemKw: 8, systemType: 'hybrid' })
    expect(draft.warnings.join(' ')).toMatch(/inverter/i)
  })

  it('refuses to size nothing', () => {
    const draft = suggestBom({ ...BASE, systemKw: 0, systemType: 'hybrid' })
    expect(draft.lines).toEqual([])
    expect(draft.warnings).toHaveLength(1)
  })
})
