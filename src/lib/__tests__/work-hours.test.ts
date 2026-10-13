import { describe, expect, it } from 'vitest'

import { REGULAR_DAY_HOURS, splitHours } from '../work-hours'

describe('splitHours', () => {
  it('counts up to the regular day as regular and the rest as overtime', () => {
    const result = splitHours([{ clockIn: '2026-10-12T08:00:00', hours: 10 }])
    expect(result).toEqual({ regular: REGULAR_DAY_HOURS, overtime: 2 })
  })

  it('adds two shifts on the same day before splitting', () => {
    const result = splitHours([
      { clockIn: '2026-10-12T08:00:00', hours: 5 },
      { clockIn: '2026-10-12T14:00:00', hours: 4.5 },
    ])
    expect(result).toEqual({ regular: 8, overtime: 1.5 })
  })

  it('keeps separate days separate — a long week of short days has no overtime', () => {
    const result = splitHours([
      { clockIn: '2026-10-12T08:00:00', hours: 7 },
      { clockIn: '2026-10-13T08:00:00', hours: 7 },
      { clockIn: '2026-10-14T08:00:00', hours: 7 },
    ])
    expect(result).toEqual({ regular: 21, overtime: 0 })
  })

  it('ignores missing or negative hours rather than subtracting them', () => {
    const result = splitHours([
      { clockIn: '2026-10-12T08:00:00', hours: Number.NaN },
      { clockIn: '2026-10-12T09:00:00', hours: -3 },
      { clockIn: 'not a date', hours: 4 },
    ])
    expect(result).toEqual({ regular: 0, overtime: 0 })
  })
})
