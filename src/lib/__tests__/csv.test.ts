import { describe, expect, it } from 'vitest'

import { toCsv, type CsvColumn } from '../csv'

/* ============================================================================
   CSV ESCAPING
   ----------------------------------------------------------------------------
   Every failure here is silent. A comma in an address does not throw — it
   shifts every column after it by one, and the accountant reconciling the file
   sees a status where a balance should be and has no reason to suspect the
   export rather than the data.

   Philippine addresses are full of commas ("Km. 16 West Service Road,
   Paranaque"), customer notes contain quotes, and a pasted note can contain a
   newline. All three have to survive.
   ========================================================================== */

interface Row {
  name: string
  note: string
  amount: number | null
}

const columns: CsvColumn<Row>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Note', value: (r) => r.note },
  { header: 'Amount', value: (r) => r.amount },
]

describe('toCsv', () => {
  it('writes a header row and one row per record', () => {
    const csv = toCsv([{ name: 'Grace', note: 'ok', amount: 100 }], columns)
    expect(csv.split('\r\n')).toEqual(['Name,Note,Amount', 'Grace,ok,100'])
  })

  it('quotes a field containing a comma', () => {
    // The one that actually happens: every address in Metro Manila.
    const csv = toCsv(
      [{ name: 'SolarBros', note: 'Km. 16 West Service Road, Paranaque', amount: 1 }],
      columns,
    )
    expect(csv).toContain('"Km. 16 West Service Road, Paranaque"')
  })

  it('doubles a quote inside a field', () => {
    const csv = toCsv([{ name: 'X', note: 'He said "it is fine"', amount: 1 }], columns)
    expect(csv).toContain('"He said ""it is fine"""')
  })

  it('quotes a field containing a newline', () => {
    const csv = toCsv([{ name: 'X', note: 'line one\nline two', amount: 1 }], columns)
    expect(csv).toContain('"line one\nline two"')
    // Three lines of text, but still exactly two CSV records.
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('writes an empty cell for null and undefined', () => {
    const csv = toCsv([{ name: 'X', note: '', amount: null }], columns)
    expect(csv.split('\r\n')[1]).toBe('X,,')
  })

  it('neutralises a value that Excel would run as a formula', () => {
    /* A note beginning "=" is executed by Excel on open. This is a real
       injection vector, and the file is opened by an accountant on Windows.
       A leading tab stops it being parsed as a formula and is invisible to a
       reader. */
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      const csv = toCsv([{ name: 'X', note: dangerous, amount: 1 }], columns)
      expect(csv).toContain(`\t${dangerous}`)
    }
  })

  it('handles an empty result set without producing a broken file', () => {
    // A filter that matches nothing still gives a file with usable headers,
    // rather than zero bytes that Excel refuses to open.
    expect(toCsv([], columns)).toBe('Name,Note,Amount')
  })

  it('uses CRLF, which is what RFC 4180 and Excel expect', () => {
    const csv = toCsv(
      [
        { name: 'A', note: '', amount: 1 },
        { name: 'B', note: '', amount: 2 },
      ],
      columns,
    )
    expect(csv).toContain('\r\n')
  })
})
