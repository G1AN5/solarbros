import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { HOME_FOR_ROLE } from './route-access'
import { useAuth } from './useAuth'
import type { UserRole } from '@/types/domain'

/* ============================================================================
   ProtectedRoute — the navigation guard wrapped around each portal's routes.
   ----------------------------------------------------------------------------
   Three checks, in order:

     1. Do we know yet?    Session restore is asynchronous. Redirecting while
                           the answer is still 'loading' throws a signed-in user
                           back to /login on every single page refresh. Wait.

     2. Signed in at all?  No: bounce to /login, remembering where they were
                           heading so sign-in can return them there.

     3. Role allowed here? No: send them to THEIR portal rather than a dead-end
                           403. A technician who taps an admin link lands on
                           /field, which is far more useful than an error.

   THIS IS UX ROUTING, NOT SECURITY.
   It decides what to render. It does not decide what anyone may read — that is
   enforced by Row Level Security in Postgres, and verified independently by
   `npm run verify:rls`. Someone who edits this file in their browser gains
   access to empty screens.
   ========================================================================== */

export function ProtectedRoute({ allow }: { allow: UserRole[] }) {
  const { user, status } = useAuth()
  const location = useLocation()

  // 1. Still resolving the session.
  if (status === 'loading') {
    return <AuthPending />
  }

  // 2. Genuinely signed out.
  if (status === 'unauthenticated' || !user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  // 3. Signed in, wrong portal.
  if (!allow.includes(user.role)) {
    return <Navigate to={HOME_FOR_ROLE[user.role]} replace />
  }

  return <Outlet />
}

/**
 * Shown for the fraction of a second while the session is restored.
 *
 * Deliberately plain: no spinner library, no layout shift, and no flash of the
 * word "loading" on a fast connection. It occupies the viewport so the page
 * behind it cannot render half-authenticated.
 */
function AuthPending() {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--text-muted)',
        fontSize: 'var(--text-sm)',
      }}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Checking your session</span>
      <span aria-hidden>☀</span>
    </div>
  )
}
