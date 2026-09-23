/* ============================================================================
   Loader / Skeleton
   ----------------------------------------------------------------------------
   THE DELAY IS THE DESIGN.
   A spinner that appears the instant a request starts flashes on every fast
   load and reads as a glitch. One that never appears leaves a visitor on
   Philippine mobile data staring at a blank panel wondering whether the site is
   broken — and leaving.

   So `.loader` is invisible for its first 400ms and then fades in, done purely
   in the CSS animation. No timers, no extra state, no re-render when it
   appears: a component that sets a `showSpinner` flag on a timeout re-renders
   the whole subtree for the privilege.

   Both announce themselves to screen readers via `role="status"`, so a
   non-visual user is told something is happening at the same moment everyone
   else can see it.
   ========================================================================== */

interface LoaderProps {
  /** Says what is being waited for. Vague beats absent; specific beats vague. */
  label?: string
  /** Reserves half the viewport — for a whole page or route. */
  page?: boolean
  /** For dark sections, where the default ring disappears. */
  invert?: boolean
}

export function Loader({ label = 'Loading…', page = false, invert = false }: LoaderProps) {
  return (
    <div
      className={`loader${page ? ' loader--page' : ' loader--inline'}${invert ? ' loader--invert' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="loader__ring" aria-hidden />
      <span className="loader__label">{label}</span>
    </div>
  )
}

/* ============================================================================
   SKELETONS
   ----------------------------------------------------------------------------
   Better than a spinner wherever the SHAPE of what is coming is already known.
   The layout does not jump when the content lands, because the space was
   already the right size — and a page that reflows under someone's thumb as
   they reach for a button is worse than a slightly longer wait.
   ========================================================================== */

export function SkeletonText({ lines = 3, width = '100%' }: { lines?: number; width?: string }) {
  return (
    <div style={{ width }} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="skeleton skeleton--text"
          /* The last line short, the way real paragraphs end. A block of
             identical bars reads as a loading graphic; this reads as text
             arriving. */
          style={{ width: i === lines - 1 ? '62%' : '100%' }}
        />
      ))}
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="card" style={{ padding: 'var(--space-5)' }} aria-hidden>
      <div className="skeleton skeleton--title" />
      <SkeletonText lines={3} />
    </div>
  )
}

/** A grid of placeholder cards, matching a real card grid's shape. */
export function SkeletonGrid({ count = 3 }: { count?: number }) {
  return (
    <>
      <span className="sr-only" role="status">
        Loading
      </span>
      <div className="grid grid--3">
        {Array.from({ length: count }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </>
  )
}
