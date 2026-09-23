import { Link, useRouteError } from 'react-router-dom'

import { ButtonLink } from '@/components/ui/Button'
import { useAuth } from '@/app/auth/useAuth'
import { HOME_FOR_ROLE } from '@/app/auth/route-access'

/* ============================================================================
   NotFoundPage — 404 and route-level error boundary.
   ----------------------------------------------------------------------------
   Serves both jobs: it is the `errorElement` on the root route AND the catch-all
   '*' route. The recovery link is role-aware — a signed-in technician is offered
   their field portal, not the marketing homepage.
   ========================================================================== */

export function NotFoundPage() {
  const error = useRouteError()
  const { user } = useAuth()

  const homePath = user ? HOME_FOR_ROLE[user.role] : '/'
  const homeLabel = user ? 'Back to your dashboard' : 'Back to the homepage'

  return (
    <div className="section">
      <div className="container container--narrow center">
        <div style={{ fontSize: '4rem' }}>🧭</div>

        <h1 style={{ marginBlock: 'var(--space-4)' }}>Page not found</h1>
        <p className="muted" style={{ maxWidth: '52ch', marginInline: 'auto' }}>
          The page you are looking for does not exist, has moved, or you may not have access to it.
        </p>

        {/* Error details are development-only — never leak stack traces to users. */}
        {import.meta.env.DEV && error != null && (
          <pre
            style={{
              marginTop: 'var(--space-6)',
              padding: 'var(--space-4)',
              background: 'var(--bg-raised)',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--text-xs)',
              textAlign: 'left',
              overflowX: 'auto',
            }}
          >
            {error instanceof Error ? error.message : JSON.stringify(error, null, 2)}
          </pre>
        )}

        <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--space-8)' }}>
          <ButtonLink to={homePath} variant="primary">
            {homeLabel}
          </ButtonLink>
          <ButtonLink to="/contact" variant="outline">
            Contact support
          </ButtonLink>
        </div>

        <p className="small dim" style={{ marginTop: 'var(--space-8)' }}>
          Reviewing the app?{' '}
          <Link to="/site-map" style={{ color: 'var(--text-brand)', fontWeight: 600 }}>
            See the full application map
          </Link>
        </p>
      </div>
    </div>
  )
}
