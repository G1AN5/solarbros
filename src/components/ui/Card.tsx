import type { CSSProperties, ReactNode } from 'react'

/* ============================================================================
   Card — the universal content container.
   Compose it: <Card><CardHeader/><CardBody/><CardFooter/></Card>
   ========================================================================== */

interface CardProps {
  children: ReactNode
  /** Adds a hover lift — use only when the whole card is clickable. */
  interactive?: boolean
  /** Amber outline for the "recommended"/highlighted card in a set. */
  accent?: boolean
  className?: string
  /** Escape hatch for one-off layout tweaks (grid span, max-width). */
  style?: CSSProperties
}

export function Card({ children, interactive, accent, className, style }: CardProps) {
  const cls = ['card', interactive && 'card--interactive', accent && 'card--accent', className]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  action,
  id,
}: {
  title: ReactNode
  action?: ReactNode
  /** Anchor target, so a button elsewhere on the page can scroll here. */
  id?: string
}) {
  return (
    <div className="card__header" id={id}>
      <div className="card__title">{title}</div>
      {action}
    </div>
  )
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['card__body', className].filter(Boolean).join(' ')}>{children}</div>
}

export function CardFooter({ children }: { children: ReactNode }) {
  return <div className="card__footer">{children}</div>
}
