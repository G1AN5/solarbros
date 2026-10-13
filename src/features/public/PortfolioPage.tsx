import { useState } from 'react'

import { ButtonLink } from '@/components/ui/Button'
import { PortfolioCard } from '@/components/ui/PortfolioCard'
import { usePortfolio } from '@/lib/queries/content'
import { PageBanner } from '@/components/layout/PageBanner'

/* ============================================================================
   PortfolioPage — gallery of completed installations.
   ----------------------------------------------------------------------------
   NOTE ON A DELIBERATE SEPARATION: this is CURATED MARKETING CONTENT, not a
   view of the operational `projects` table. Staff choose which installations to
   showcase, with approved photos and client consent. Wiring this directly to
   live project records would leak customer addresses and contract values onto
   the public internet.

   Backend plan: a separate `portfolio_items` table, editable by marketing via
   the CMS, with images in a public Supabase Storage bucket.
   ========================================================================== */

const SEGMENTS = ['All', 'Residential', 'Commercial', 'Industrial', 'Hospitality', 'Agricultural']

export function PortfolioPage() {
  const portfolioQuery = usePortfolio()
  const PORTFOLIO = portfolioQuery.data ?? []

  const [filter, setFilter] = useState('All')

  const visible = filter === 'All' ? PORTFOLIO : PORTFOLIO.filter((item) => item.segment === filter)

  return (
    <>
      <PageBanner
        eyebrow="Portfolio"
        title="Projects we have delivered"
        lead="Residential rooftops through to 80kW industrial arrays — across Metro Manila and the surrounding provinces."
      />

      <div className="section section--muted">
        <div className="container">
          {/* Filter row sits above the gallery, one row, no dropdown diving. */}
          <div
            className="row row--wrap"
            style={{ justifyContent: 'center', marginBottom: 'var(--space-8)' }}
          >
            {SEGMENTS.map((segment) => (
              <button
                key={segment}
                className={`btn btn--sm ${filter === segment ? 'btn--dark' : 'btn--outline'}`}
                onClick={() => setFilter(segment)}
              >
                {segment}
              </button>
            ))}
          </div>

          {visible.length > 0 ? (
            <div className="gallery">
              {visible.map((item) => (
                <PortfolioCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            /* A filter with nothing in it said nothing at all — an empty band
               under the buttons, which reads as a broken page. */
            <p className="muted center" style={{ marginInline: 'auto' }}>
              {portfolioQuery.isLoading
                ? 'Loading projects…'
                : filter === 'All'
                  ? 'Completed projects will appear here soon.'
                  : `No ${filter.toLowerCase()} projects to show yet — see all projects instead.`}
            </p>
          )}

          <div className="center" style={{ marginTop: 'var(--space-12)' }}>
            <p className="muted" style={{ marginBottom: 'var(--space-4)' }}>
              Want a system like these on your roof?
            </p>
            <ButtonLink to="/booking" variant="primary" size="lg">
              Book a free site survey
            </ButtonLink>
          </div>
        </div>
      </div>
    </>
  )
}
