/* ============================================================================
   HOURS WORKED — one rule for the field app and the payroll register
   ----------------------------------------------------------------------------
   A technician's hours are logged from the field app as shifts (clock-in to
   job completion). Both the technician's own account page and the payroll
   register turn those shifts into regular and overtime hours, and they must
   agree, so the rule lives here:

     · hours are counted per calendar day, in local (Philippine) time — a
       shift that starts at 7am Manila time is not split at 8am because that
       is midnight in UTC;
     · up to REGULAR_DAY_HOURS in a day are regular, the rest overtime — the
       ninth hour on a Tuesday is overtime even in a short week.
   ========================================================================== */

/** Hours over this in one day are overtime. */
export const REGULAR_DAY_HOURS = 8

export interface LoggedShift {
  clockIn: string
  hours: number
}

export function splitHours(shifts: LoggedShift[]): { regular: number; overtime: number } {
  const byDay = new Map<string, number>()
  for (const shift of shifts) {
    const d = new Date(shift.clockIn)
    if (Number.isNaN(d.getTime())) continue
    const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const hours = Number.isFinite(shift.hours) && shift.hours > 0 ? shift.hours : 0
    byDay.set(day, (byDay.get(day) ?? 0) + hours)
  }

  let regular = 0
  let overtime = 0
  for (const hours of byDay.values()) {
    regular += Math.min(hours, REGULAR_DAY_HOURS)
    overtime += Math.max(hours - REGULAR_DAY_HOURS, 0)
  }

  return { regular: Math.round(regular * 10) / 10, overtime: Math.round(overtime * 10) / 10 }
}
