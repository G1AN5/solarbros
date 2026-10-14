import { describe, expect, it } from 'vitest'

import { checklistSummary, parseChecklistSummary } from '../checklist'

const ITEMS = ['Panels cleaned', 'Connections torque-checked', 'Client briefed']

describe('checklistSummary', () => {
  it('records a full checklist without a "not done" list', () => {
    expect(checklistSummary(ITEMS, new Set([0, 1, 2]))).toBe('Checklist 3/3 completed on site.')
  })

  it('names what was not done', () => {
    expect(checklistSummary(ITEMS, new Set([1]))).toBe(
      'Checklist 1/3 completed on site. Not done: Panels cleaned; Client briefed.',
    )
  })
})

describe('parseChecklistSummary', () => {
  it('reads back exactly what checklistSummary wrote', () => {
    for (const ticks of [[], [0], [1], [0, 2], [0, 1, 2]]) {
      const line = checklistSummary(ITEMS, new Set(ticks))
      expect([...(parseChecklistSummary(line, ITEMS) ?? [])].sort()).toEqual(ticks)
    }
  })

  it('finds the line among the other notes on the visit', () => {
    const notes =
      'Gate code 1234. Dog on site.\n\nChecklist 2/3 completed on site. Not done: Client briefed.'
    expect(parseChecklistSummary(notes, ITEMS)).toEqual(new Set([0, 1]))
  })

  it('uses the last line when the visit was closed twice', () => {
    const notes =
      'Checklist 1/3 completed on site. Not done: Panels cleaned; Client briefed.\n\n' +
      'Checklist 3/3 completed on site.'
    expect(parseChecklistSummary(notes, ITEMS)).toEqual(new Set([0, 1, 2]))
  })

  it('returns null when there is no line, or it belongs to a different list', () => {
    expect(parseChecklistSummary(null, ITEMS)).toBeNull()
    expect(parseChecklistSummary('Customer asked for a call back.', ITEMS)).toBeNull()
    expect(parseChecklistSummary('Checklist 4/4 completed on site.', ITEMS)).toBeNull()
  })

  it('returns null rather than the wrong ticks when an item was reworded', () => {
    const notes = 'Checklist 2/3 completed on site. Not done: Panels washed.'
    expect(parseChecklistSummary(notes, ITEMS)).toBeNull()
  })
})
