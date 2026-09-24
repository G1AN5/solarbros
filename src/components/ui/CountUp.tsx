import { useEffect, useRef, useState } from 'react'

/* ============================================================================
   CountUp — a number that counts to itself when it first comes into view.
   ----------------------------------------------------------------------------
   Used on the trust strip, where four static figures sat doing nothing. A
   number that arrives draws the eye to it once, which is the entire job of
   that strip.

   IT FAILS OPEN, like the reveal animation next to it. If IntersectionObserver
   is missing or throws, the final value is shown immediately — the worst case
   is a number that did not animate, never a blank space where a statistic
   should be.

   `prefers-reduced-motion` skips the animation entirely rather than shortening
   it. Somebody who has asked for less movement does not want a faster version
   of the movement.
   ========================================================================== */

interface CountUpProps {
  to: number
  /** Rendered after the number, e.g. "+" or " yrs". */
  suffix?: string
  /** Milliseconds. Long enough to read, short enough not to be waited on. */
  duration?: number
}

export function CountUp({ to, suffix = '', duration = 1400 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  /* Both reasons to skip the animation are decided HERE rather than by setting
     state inside the effect: starting at 0 and immediately setting it back to
     `to` is a wasted render, and the lint rule that forbids it is right. */
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return to
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const noObserver = typeof IntersectionObserver === 'undefined'
    return reduced || noObserver ? to : 0
  })

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // Whatever was decided above, the effect does nothing in those cases.
    if (typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    let started = false

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || started) return
        started = true
        observer.disconnect()

        const start = performance.now()
        const step = (now: number) => {
          const progress = Math.min((now - start) / duration, 1)
          /* Ease-out cubic: fast at first, settling at the end. A linear count
             reads like a loading spinner rather than a figure arriving. */
          const eased = 1 - Math.pow(1 - progress, 3)
          setValue(Math.round(to * eased))
          if (progress < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
      },
      { threshold: 0.4 },
    )

    observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [to, duration])

  return (
    <span ref={ref}>
      {value.toLocaleString()}
      {suffix}
    </span>
  )
}
