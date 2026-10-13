import { useState } from 'react'

import { ButtonLink } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import { usePackages } from '@/lib/queries/crm'
import { useCompany } from '@/lib/queries/public-site'
import { currency } from '@/lib/format'
import { SYSTEM_TYPE_LABEL } from '@/lib/labels'
import { PageBanner } from '@/components/layout/PageBanner'

/* ============================================================================
   PackagesPage — pricing, inclusions and system-type comparison.
   ----------------------------------------------------------------------------
   MERGES THREE SPEC ITEMS that were listed separately but are the same job:
     • "Service offerings/Packages Pricing (What's included)"
     • "Compare packages toggle/table view instead of just cards"
     • "System comparison table (on-grid vs hybrid vs off-grid)"

   Result: one page, a card ⇄ table view toggle, and a separate architecture
   comparison below. Keeping them together means a visitor decides "which
   package" and "which system type" in one place instead of bouncing pages.
   ========================================================================== */

type View = 'cards' | 'table'
type Segment = 'residential' | 'commercial'

/* Architecture comparison — independent of any specific package. */
const SYSTEM_COMPARISON = [
  { feature: 'Upfront cost', on_grid: 'Lowest', hybrid: 'Medium', off_grid: 'Highest' },
  { feature: 'Works during brownout', on_grid: false, hybrid: true, off_grid: true },
  { feature: 'Battery storage included', on_grid: false, hybrid: true, off_grid: true },
  {
    feature: 'Export surplus to grid (net-metering)',
    on_grid: true,
    hybrid: true,
    off_grid: false,
  },
  { feature: 'Utility connection required', on_grid: true, hybrid: true, off_grid: false },
  {
    feature: 'Typical payback',
    on_grid: '4–6 years',
    hybrid: '6–9 years',
    off_grid: 'N/A — replaces generator',
  },
  { feature: 'Maintenance', on_grid: 'Minimal', hybrid: 'Low', off_grid: 'Moderate' },
  {
    feature: 'Best for',
    on_grid: 'Stable grid, daytime usage',
    hybrid: 'Frequent outages',
    off_grid: 'Remote sites, farms',
  },
]

function Cell({ value }: { value: string | boolean }) {
  if (typeof value === 'boolean') {
    return value ? <span className="yes">✓ Yes</span> : <span className="no">— No</span>
  }
  return <span>{value}</span>
}

export function PackagesPage() {
  const packagesQuery = usePackages()
  const PACKAGES = packagesQuery.data ?? []
  const company = useCompany()

  const [view, setView] = useState<View>('cards')
  const [segment, setSegment] = useState<Segment>('residential')

  const visible = PACKAGES.filter((p) => p.segment === segment)

  return (
    <>
      <PageBanner
        eyebrow="Packages & pricing"
        title="Pick the system that fits"
        lead="Prices are complete installed costs — panels, inverter, mounting, wiring, permits, net-metering filing and commissioning. No surprise line items at handover."
        stats={[
          { value: 'No hidden fees', label: 'One quoted price' },
          // From Settings, like the home page — it said 25 here whatever the
          // company had actually published.
          { value: `${company.warrantyPanelYears} yrs`, label: 'Panel warranty' },
          { value: '3 days', label: 'Typical install' },
        ]}
      />

      <div className="section section--muted">
        <div className="container">
          {/* Segment + view controls in one row, per the spec's toggle request. */}
          <div className="row row--between row--wrap" style={{ marginBottom: 'var(--space-6)' }}>
            <Tabs
              tabs={[
                { value: 'residential' as Segment, label: 'Residential' },
                { value: 'commercial' as Segment, label: 'Commercial' },
              ]}
              active={segment}
              onChange={setSegment}
            />
            <div className="row">
              <span className="small muted">View as</span>
              <div className="row" style={{ gap: 2 }}>
                <button
                  className={`btn btn--sm ${view === 'cards' ? 'btn--dark' : 'btn--outline'}`}
                  onClick={() => setView('cards')}
                >
                  ▦ Cards
                </button>
                <button
                  className={`btn btn--sm ${view === 'table' ? 'btn--dark' : 'btn--outline'}`}
                  onClick={() => setView('table')}
                >
                  ☰ Table
                </button>
              </div>
            </div>
          </div>

          {/* ------------------------------------------------ CARD VIEW */}
          {view === 'cards' && (
            <div className="grid grid--2">
              {visible.map((pkg) => (
                <Card key={pkg.id} accent={pkg.featured}>
                  <div className={`pkg${pkg.featured ? ' pkg--featured' : ''}`}>
                    <div>
                      <span className="badge badge--neutral">
                        {SYSTEM_TYPE_LABEL[pkg.systemType]}
                      </span>
                      <h3 style={{ marginTop: 'var(--space-2)' }}>{pkg.name}</h3>
                      <p className="small muted">{pkg.idealFor}</p>
                    </div>
                    <div>
                      <div className="pkg__price">{currency(pkg.priceFrom)}</div>
                      <div className="small dim">{pkg.sizeKw} kWp array · fully installed</div>
                    </div>
                    <ul className="pkg__features">
                      {pkg.inclusions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <div style={{ marginTop: 'auto' }} className="stack stack--sm">
                      <ButtonLink
                        to="/booking"
                        variant={pkg.featured ? 'primary' : 'outline'}
                        block
                      >
                        Book a consultation
                      </ButtonLink>
                      <ButtonLink to="/estimator" variant="ghost" block>
                        Check my savings first
                      </ButtonLink>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* ----------------------------------------------- TABLE VIEW
            Same data, denser. Better when a visitor is comparing rather than
            browsing — which is exactly why the spec asked for both. */}
          {view === 'table' && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Package</th>
                    <th>System type</th>
                    <th className="table__num">Size</th>
                    <th className="table__num">Starting price</th>
                    <th>Ideal for</th>
                    <th>Key inclusions</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((pkg) => (
                    <tr key={pkg.id}>
                      <td className="strong">
                        {pkg.name}
                        {pkg.featured && (
                          <span className="badge badge--brand" style={{ marginLeft: 6 }}>
                            Popular
                          </span>
                        )}
                      </td>
                      <td>{SYSTEM_TYPE_LABEL[pkg.systemType]}</td>
                      <td className="table__num">{pkg.sizeKw} kWp</td>
                      <td className="table__num strong">{currency(pkg.priceFrom)}</td>
                      <td className="small muted">{pkg.idealFor}</td>
                      <td className="small muted">{pkg.inclusions.slice(0, 2).join(' · ')}</td>
                      <td>
                        <ButtonLink to="/booking" variant="outline" size="sm">
                          Enquire
                        </ButtonLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ---------------------------- SYSTEM ARCHITECTURE COMPARISON */}
          <div style={{ marginTop: 'var(--space-20)' }}>
            <div className="section-head">
              <span className="eyebrow">Which architecture?</span>
              <h2>On-grid vs hybrid vs off-grid</h2>
              <p>
                The single biggest decision, and the one that drives cost. Here is the honest
                comparison.
              </p>
            </div>

            <div className="table-wrap">
              <table className="table compare">
                <thead>
                  <tr>
                    <th style={{ minWidth: 200 }}>Feature</th>
                    <th>On-Grid</th>
                    <th>Hybrid</th>
                    <th>Off-Grid</th>
                  </tr>
                </thead>
                <tbody>
                  {SYSTEM_COMPARISON.map((row) => (
                    <tr key={row.feature}>
                      <td>{row.feature}</td>
                      <td>
                        <Cell value={row.on_grid} />
                      </td>
                      <td>
                        <Cell value={row.hybrid} />
                      </td>
                      <td>
                        <Cell value={row.off_grid} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Card accent className="center" style={{ marginTop: 'var(--space-12)' }}>
            <CardBody>
              <h3>Still not sure?</h3>
              <p
                className="muted"
                style={{ marginBlock: 'var(--space-3)', maxWidth: '56ch', marginInline: 'auto' }}
              >
                Run the estimator with your actual bill, or book a free consultation and we will
                recommend a size based on your real consumption.
              </p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <ButtonLink to="/estimator" variant="primary">
                  Run the estimator
                </ButtonLink>
                <ButtonLink to="/booking" variant="outline">
                  Request a personalised quote
                </ButtonLink>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
