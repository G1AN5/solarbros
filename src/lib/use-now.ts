import { useEffect, useState } from 'react'

/**
 * The current time, held as state and refreshed every `everyMs`.
 *
 * Reading the clock during render makes a component impure — two renders of
 * the same data disagree — so a page that judges "overdue" or "past its
 * target" against the time reads it from here instead.
 */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs)
    return () => window.clearInterval(id)
  }, [everyMs])

  return now
}
