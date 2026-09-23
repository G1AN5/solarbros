import type { ReactNode } from 'react'

/* ============================================================================
   PageBanner — the opening band on a public page.
   ----------------------------------------------------------------------------
   Every public page except the homepage used to begin with a bare heading on
   the same grey as the content beneath it. A prospect arriving from the nav got
   no sense of having landed anywhere, and the page read as one undifferentiated
   scroll from the header down.

   This reuses the hero's gradient and CSS grid deliberately, so the pages feel
   like one site rather than a set of unrelated templates — and, as with the
   hero, it is all drawn in CSS. Nothing here costs a download, which is the
   standing constraint on a site read over Philippine mobile data.
   ========================================================================== */

interface PageBannerProps {
  eyebrow?: string
  title: string
  lead?: string
  /** Figures worth leading with, shown along the bottom edge. */
  stats?: { value: string; label: string }[]
  /** Buttons, usually a single call to action. */
  actions?: ReactNode
}

export function PageBanner({ eyebrow, title, lead, stats, actions }: PageBannerProps) {
  return (
    <section className="page-banner">
      <div className="container">
        {eyebrow && <span className="page-banner__eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}

        {actions && (
          <div className="row row--wrap" style={{ marginTop: 'var(--space-6)' }}>
            {actions}
          </div>
        )}

        {stats && stats.length > 0 && (
          <div className="page-banner__stats">
            {stats.map((stat) => (
              <div key={stat.label} className="page-banner__stat">
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
