/* ============================================================================
   CSV EXPORT
   ----------------------------------------------------------------------------
   "Export CSV" appeared as a button on six screens and did nothing on all six.
   It is not a decorative feature: an accountant reconciling against a bank
   statement, or anyone asked for figures by an auditor, works in a spreadsheet.
   Without it they retype from the screen, which is slow and wrong.

   Done in the browser rather than server-side. The data is already loaded and
   already filtered to what the user can see, so a round trip would only add
   latency and a second place for the row-level rules to be got wrong.

   ESCAPING IS THE WHOLE PROBLEM
   Philippine addresses contain commas ("Km. 16 West Service Road, Paranaque"),
   notes contain quotes and newlines, and any of those will silently shift every
   column after it. RFC 4180 says: wrap the field in quotes and double any quote
   inside it.
   ========================================================================== */

/** One column: a header, and how to get its value out of a row. */
export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | null | undefined
}

function escapeCell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return ''
  const text = String(raw)

  /* A leading =, +, - or @ makes Excel treat the cell as a formula. A supplier
     name beginning "-" is harmless; a note beginning "=cmd|..." is a known
     spreadsheet injection vector, and the file is opened by an accountant on a
     Windows machine. Prefixing a tab neutralises it without changing what a
     human reads. */
  const guarded = /^[=+\-@\t\r]/.test(text) ? `\t${text}` : text

  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

/** U+FEFF, as an escape. A literal BOM in source is invisible in a diff. */
const BYTE_ORDER_MARK = '\uFEFF'

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((col) => escapeCell(col.header)).join(',')
  const body = rows.map((row) => columns.map((col) => escapeCell(col.value(row))).join(','))
  // CRLF, which is what RFC 4180 specifies and what Excel on Windows expects.
  return [header, ...body].join('\r\n')
}

/**
 * Build the file and hand it to the browser.
 *
 * The BOM is not optional. Without it, Excel on Windows reads the file as the
 * system codepage and every peso sign becomes mojibake — on a document whose
 * entire purpose is money.
 */
export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  const csv = toCsv(rows, columns)
  const blob = new Blob([BYTE_ORDER_MARK + csv], { type: 'text/csv;charset=utf-8;' })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Released on the next tick; revoking immediately can cancel the download in
  // some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** `leads-2026-09-07.csv` — sortable, and obvious which day it came from. */
export function datedFilename(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`
}
