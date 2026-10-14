/* ============================================================================
   THE ON-SITE CHECKLIST, AS THE VISIT RECORD CARRIES IT
   ----------------------------------------------------------------------------
   Closing a job writes one line into the visit's notes:

     Checklist 10/12 completed on site. Not done: <item>; <item>.

   The ticks themselves are kept on the technician's phone only until then,
   and are cleared when the job closes. Reopening a finished job therefore
   showed 0/12 while its record said 12/12.

   Reading that line back gives a closed job its ticks again, from the same
   text the office and the customer read. There is no second copy to drift.
   Both directions live here so one is always the inverse of the other.
   ========================================================================== */

/** The line written onto the visit when the job is closed. */
export function checklistSummary(items: readonly string[], checked: ReadonlySet<number>): string {
  const missed = items.filter((_, index) => !checked.has(index))
  return (
    `Checklist ${items.length - missed.length}/${items.length} completed on site.` +
    (missed.length > 0 ? ` Not done: ${missed.join('; ')}.` : '')
  )
}

const SUMMARY = /Checklist (\d+)\/(\d+) completed on site\.(?: Not done: (.*)\.)?/g

/**
 * The ticks a closed job's notes record, or null when the notes hold no
 * checklist line that matches this list. The checklist can be reworded
 * between a job closing and someone reopening it; a record that no longer
 * lines up is better shown as text than as the wrong ticks.
 */
export function parseChecklistSummary(
  notes: string | null | undefined,
  items: readonly string[],
): Set<number> | null {
  if (!notes) return null

  // The last line wins. A visit closed, reopened by the office and closed
  // again carries one line per closing.
  let last: RegExpExecArray | null = null
  for (const match of notes.matchAll(SUMMARY)) last = match
  if (!last) return null

  const done = Number(last[1])
  const total = Number(last[2])
  if (total !== items.length) return null

  const notDone = new Set(last[3] ? last[3].split('; ') : [])
  const checked = new Set<number>()
  items.forEach((item, index) => {
    if (!notDone.has(item)) checked.add(index)
  })

  return checked.size === done ? checked : null
}
