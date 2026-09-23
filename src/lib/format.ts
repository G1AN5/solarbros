/* ============================================================================
   FORMATTERS
   Presentation-only helpers. Keeping them here (rather than inline in JSX)
   guarantees a peso amount looks identical on the client invoice, the admin
   finance table and the technician's materials list.
   ========================================================================== */

const peso = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
})

/** ₱1,234,567 — used for contract values, invoices and package pricing. */
export function currency(value: number): string {
  return peso.format(value)
}

/** ₱1.2M — compact form for KPI tiles where space is tight. */
export function currencyCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `₱${Math.round(value / 1_000)}k`
  return peso.format(value)
}

/** 1,234 */
export function number(value: number): string {
  return new Intl.NumberFormat('en-PH').format(value)
}

/** 12 Mar 2026 */
export function date(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** 12 Mar, 2:30 PM */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "3 days ago" — used in activity feeds and audit logs. */
export function relative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return date(iso)
}

/** 0.42 → "42%" */
export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/* --- Time-remaining helpers --------------------------------------------------
   `Date.now()` is impure, and calling it directly while rendering makes a
   component non-idempotent (React's rules-of-react lint flags this). We capture
   one timestamp when the module loads and measure against that.

   This is safe for the things we use it for — warranty periods measured in
   YEARS. If you ever need second-accurate "time ago" that updates live, drive
   it from state on an interval instead of reading the clock during render.  */

/** Wall-clock time when the app was loaded. */
export const APP_LOADED_AT = Date.now()

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

/** Fractional years from `from` until `iso`. Negative once the date has passed. */
export function yearsUntil(iso: string, from: number = APP_LOADED_AT): number {
  return (new Date(iso).getTime() - from) / MS_PER_YEAR
}

/** Whole days that `iso` is in the past. Negative if it is still in the future. */
export function daysSince(iso: string, from: number = APP_LOADED_AT): number {
  return Math.floor((from - new Date(iso).getTime()) / 86_400_000)
}

/** Turns a snake_case enum value into "Snake case" for display. */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
