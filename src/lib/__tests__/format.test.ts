import { describe, expect, it } from 'vitest'

import { timeLeft } from '../format'

/** 13 October 2026, mid-afternoon, local time. */
const AFTERNOON = new Date(2026, 9, 13, 15, 0).getTime()

describe('timeLeft', () => {
  it('reads a term registered today as the whole term', () => {
    expect(timeLeft('2031-10-13', AFTERNOON)).toBe('5 yrs left')
    expect(timeLeft('2027-10-13', AFTERNOON)).toBe('1 yr left')
  })

  it('gives years and months when the term is part-way through', () => {
    expect(timeLeft('2029-04-20', AFTERNOON)).toBe('2 yrs 6 mo left')
    expect(timeLeft('2029-04-12', AFTERNOON)).toBe('2 yrs 5 mo left')
  })

  it('counts months under a year rather than saying zero years', () => {
    expect(timeLeft('2027-06-13', AFTERNOON)).toBe('8 mo left')
    expect(timeLeft('2026-11-01', AFTERNOON)).toBe('under a month left')
  })
})
