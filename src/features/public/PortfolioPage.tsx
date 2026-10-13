import { useState } from 'react'

import { ButtonLink } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { MediaCover } from '@/components/ui/MediaCover'
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

          <div className="grid">
            {visible.map((item) => (
              <Card key={item.id} interactive className="portfolio-item">
                <MediaCover path={item.coverPath} alt={item.title} />
                <CardBody>
                  <div className="row row--between">
                    <h4>{item.title}</h4>
                    <span className="badge badge--brand">{item.systemSize}</span>
                  </div>
                  <p className="small muted" style={{ marginTop: 'var(--space-1)' }}>
                    {item.location}
                  </p>
                  <p className="xs dim" style={{ marginTop: 'var(--space-2)' }}>
                    {item.segment} · Completed {item.year}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>

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
