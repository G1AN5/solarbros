import { Link, Outlet } from 'react-router-dom'

import { Logo } from './Logo'
import { SolarMark } from '@/components/ui/SolarMark'
import { useCompany } from '@/lib/queries/public-site'
import { usePageTitle } from '@/lib/usePageTitle'

/* ============================================================================
   AuthLayout — split-screen shell for every sign-in and registration page.
   ----------------------------------------------------------------------------
   Left: the brand panel, carrying the same gradient, grid texture and solar
   mark as the marketing hero — a customer who clicks "sign in" from the website
   should not feel handed over to a different company at the door.

   Right: the form, on a near-white surface with a faint warm wash so it reads
   as the same material rather than a plain white rectangle bolted on.

   The aside collapses away below 860px. On a phone the form is the entire job,
   and a decorative panel above it just pushes the password field off screen.
   ========================================================================== */

export function AuthLayout() {
  // Names the browser tab after the page, not after the folder Vite
  // scaffolded the project in.
  usePageTitle(useCompany().name)

  const COMPANY = useCompany()

  return (
    <div className="shell--auth">
      <aside className="shell--auth__aside">
        {/* Decoration, behind everything, bleeding off the corner. */}
        <div className="shell--auth__mark">
          <SolarMark size={180} />
        </div>

        <Link to="/">
          <Logo inverse />
        </Link>

        <div>
          <h2 style={{ fontSize: 'var(--text-3xl)', maxWidth: '16ch' }}>
            Track your solar installation, every step.
          </h2>
          <p style={{ color: 'var(--ink-300)', marginTop: 'var(--space-4)', maxWidth: '44ch' }}>
            Watch milestones update live from the field, download your documents, and raise service
            requests — without picking up the phone.
          </p>
        </div>

        <div className="row" style={{ gap: 'var(--space-8)' }}>
          <div>
            <div
              style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--brand-400)' }}
            >
              {COMPANY.homesPowered.toLocaleString()}+
            </div>
            <div className="small" style={{ color: 'var(--ink-400)' }}>
              Homes powered
            </div>
          </div>
          <div>
            <div
              style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--brand-400)' }}
            >
              {COMPANY.warrantyPanelYears}yr
            </div>
            <div className="small" style={{ color: 'var(--ink-400)' }}>
              Panel warranty
            </div>
          </div>
        </div>
      </aside>

      <main className="shell--auth__main">
        <div className="shell--auth__form">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
