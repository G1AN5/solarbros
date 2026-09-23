import { useEffect, useRef } from 'react'

/* ============================================================================
   SCROLL REVEAL
   ----------------------------------------------------------------------------
   Adds `is-visible` when the element first scrolls into view, which the
   `.reveal` styles in motion.css animate against.

   WHY IntersectionObserver AND NOT A SCROLL LISTENER
   A scroll handler runs on every frame of every scroll for the life of the
   page, on the main thread, whether anything is near the viewport or not. The
   observer is handled off-thread by the browser and tells us once. On a long
   marketing page with twenty revealed sections that is the difference between
   smooth scrolling and a phone that heats up.

   IT ONLY EVER FIRES ONCE
   The element is unobserved as soon as it appears. Content that fades out again
   when scrolled past, and back in when scrolled to, is irritating rather than
   elegant — and it means somebody re-reading a paragraph watches it flicker.

   IT FAILS OPEN
   If IntersectionObserver is missing, or the user has asked for reduced motion,
   the class is applied immediately. The failure mode of a reveal must be
   "visible", never "invisible" — a bug here would hide the entire page and
   look like a blank site rather than a missing animation.
   ========================================================================== */

export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReduced || typeof IntersectionObserver === 'undefined') {
      element.classList.add('is-visible')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      },
      {
        /* Fires a little before the element reaches the viewport, so the
           animation is already settling by the time it is properly on screen.
           Revealing exactly at the edge means the reader watches it move. */
        rootMargin: '0px 0px -12% 0px',
        threshold: 0.05,
      },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return ref
}
