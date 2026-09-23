import type { CSSProperties, ReactNode } from 'react'

import { useReveal } from '@/lib/useReveal'

/* ============================================================================
   Reveal — fades a section in as it scrolls into view.
   ----------------------------------------------------------------------------
   A wrapper rather than a hook call in every page, because the alternative is
   forty components each holding a ref they otherwise have no use for.

   `stagger` animates the CHILDREN in sequence instead of the block as a whole.
   Use it on a row of cards; not on a paragraph, where the words arriving one
   after another reads as a fault.

   Renders a plain <div>. If the animation never runs — reduced motion, an old
   browser, JavaScript still loading — the content is simply there, because
   `is-visible` is applied immediately in those cases rather than withheld.
   ========================================================================== */

interface RevealProps {
  children: ReactNode
  /** Animate each child in turn. For grids and card rows. */
  stagger?: boolean
  className?: string
  style?: CSSProperties
}

export function Reveal({ children, stagger, className, style }: RevealProps) {
  const ref = useReveal<HTMLDivElement>()

  const classes = ['reveal', stagger && 'reveal--stagger', className].filter(Boolean).join(' ')

  return (
    <div ref={ref} className={classes} style={style}>
      {children}
    </div>
  )
}
