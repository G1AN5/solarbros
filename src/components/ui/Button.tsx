import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

/* ============================================================================
   Button
   One component covers every button in the app. `variant` picks the visual
   weight, `to` turns it into a router link (so a call-to-action can navigate
   without duplicating styles on an <a>).
   ========================================================================== */

/**
 * `light` is the outline style for DARK backgrounds (hero, sidebar, dark CTA
 * bands). Plain `outline` uses dark ink and vanishes on those surfaces.
 */
type Variant = 'primary' | 'dark' | 'outline' | 'light' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface BaseProps {
  variant?: Variant
  size?: Size
  block?: boolean
  children: ReactNode
  className?: string
}

interface ButtonProps
  extends BaseProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> {
  /** When present the button renders as a <Link> to this route instead. */
  to?: never
}

interface LinkProps extends BaseProps {
  to: string
}

function classes({ variant = 'primary', size = 'md', block, className }: BaseProps) {
  return [
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    block && 'btn--block',
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

export function Button({ children, ...props }: ButtonProps) {
  const { variant, size, block, className, ...rest } = props
  return (
    <button className={classes({ variant, size, block, className, children })} {...rest}>
      {children}
    </button>
  )
}

/** Same look as <Button>, but navigates. Use for every call-to-action. */
export function ButtonLink({ to, children, ...props }: LinkProps) {
  return (
    <Link to={to} className={classes({ ...props, children })}>
      {children}
    </Link>
  )
}
