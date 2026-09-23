import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/* ============================================================================
   PageHeader — the title block at the top of every console screen.
   Standardising it means all ~40 internal pages line up pixel-for-pixel.
   ========================================================================== */

interface Crumb {
  label: string
  to?: string
}

interface PageHeaderProps {
  title: string
  description?: string
  /** Optional trail, e.g. [{label:'Projects', to:'/admin/projects'}, {label:'SB-0142'}] */
  breadcrumbs?: Crumb[]
  /** Buttons / filters aligned to the right of the title. */
  actions?: ReactNode
}

export function PageHeader({ title, description, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="breadcrumb" aria-label="Breadcrumb">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.label}>
                {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : crumb.label}
                {i < breadcrumbs.length - 1 && <span aria-hidden> / </span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="page-header__title">{title}</h1>
        {description && <p className="page-header__desc">{description}</p>}
      </div>
      {actions && <div className="row row--wrap">{actions}</div>}
    </header>
  )
}
