import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'

import { ButtonLink } from '@/components/ui/Button'
import { Logo } from '@/components/layout/Logo'
import { PUBLIC_NAV } from '@/app/navigation'
import { useCompany } from '@/lib/queries/public-site'
import { usePageTitle } from '@/lib/usePageTitle'

/* ============================================================================
   PublicLayout — shell for the unauthenticated marketing site.
   Header (sticky) → routed page content → footer.
   The "Client Login" button is the single bridge from public site to portals.
   ========================================================================== */

export function PublicLayout() {
  // Names the browser tab after the page, not after the folder Vite
  // scaffolded the project in.
  usePageTitle(useCompany().name)

  const COMPANY = useCompany()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="shell--public">
      <header className="pub-header">
        <div className="container pub-header__inner">
          <Link to="/" aria-label={`${COMPANY.name} home`}>
            <Logo />
          </Link>

          <nav className="pub-nav">
            {PUBLIC_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'is-active' : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="row pub-header__actions">
            {/* Entry point to every authenticated portal. */}
            <ButtonLink to="/login" variant="ghost" size="sm">
              Client Login
            </ButtonLink>
            <ButtonLink to="/estimator" variant="primary" size="sm">
              Free Estimate
            </ButtonLink>
          </div>

          {/* MOBILE MENU BUTTON
              The nav was simply hidden below 900px with nothing to replace it,
              so a visitor on a phone could reach neither Packages nor Book a
              Visit — on a site whose traffic is overwhelmingly mobile. */}
          <button
            type="button"
            className="pub-burger"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden>{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>

        {/* Rendered only when open rather than hidden with CSS, so its links
            are not in the tab order of every page for keyboard users. */}
        {menuOpen && (
          <nav id="mobile-nav" className="pub-mobile-nav">
            {PUBLIC_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => (isActive ? 'is-active' : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
            <div className="pub-mobile-nav__actions" onClick={() => setMenuOpen(false)}>
              <ButtonLink to="/login" variant="outline" block>
                Client Login
              </ButtonLink>
              <ButtonLink to="/estimator" variant="primary" block>
                Get a free estimate
              </ButtonLink>
            </div>
          </nav>
        )}
      </header>

      <main>
        <Outlet />
      </main>

      <footer className="pub-footer">
        <div className="container">
          <div className="grid" style={{ '--col-min': '190px' } as React.CSSProperties}>
            <div>
              <Logo inverse />
              <p className="small" style={{ marginTop: 'var(--space-3)', color: 'var(--ink-400)' }}>
                {COMPANY.tagline}
              </p>
              <p className="small" style={{ marginTop: 'var(--space-3)', color: 'var(--ink-400)' }}>
                {COMPANY.address}
                <br />
                {COMPANY.phone} · {COMPANY.email}
                <br />
                {COMPANY.hours}
              </p>
            </div>

            <div>
              <h4>Explore</h4>
              {PUBLIC_NAV.map((item) => (
                <Link key={item.to} to={item.to}>
                  {item.label}
                </Link>
              ))}
            </div>

            <div>
              <h4>Service Areas</h4>
              {COMPANY.serviceAreas.map((area) => (
                <span
                  key={area}
                  className="small"
                  style={{ display: 'block', paddingBlock: 4, color: 'var(--ink-400)' }}
                >
                  {area}
                </span>
              ))}
            </div>

            <div>
              <h4>Legal</h4>
              <Link to="/legal/privacy">Privacy Policy</Link>
              <Link to="/legal/terms">Terms of Service</Link>
              <Link to="/legal/warranty">Warranty Terms</Link>
            </div>
          </div>

          <div className="pub-footer__bottom row row--between row--wrap">
            <span>
              © {new Date().getFullYear()} {COMPANY.name}. All rights reserved.
            </span>
            <span>{COMPANY.facebook}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
