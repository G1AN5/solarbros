import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import { HOME_FOR_ROLE } from './route-access'
import { useAuth } from './useAuth'
import type { UserRole } from '@/types/domain'

/* ============================================================================
   RequireRole — the per-page half of the navigation guard.
   ----------------------------------------------------------------------------
   `ProtectedRoute` asks "may you be in this portal at all?". This asks "may you
   be on this page?", which is the question that was never asked: every staff
   role shared /admin, so the answer was always yes.

   A wrong role is REDIRECTED to their own landing page rather than shown a 403.
   Somebody who follows a stale link from a colleague has made no mistake worth
   a red screen, and "you do not have permission" tells them nothing they can
   act on. Landing them where their work is does.

   No session checks here. This only ever renders inside `ProtectedRoute`, which
   has already established that somebody is signed in — repeating it would mean
   two places to keep in step for no gain.
   ========================================================================== */

export function RequireRole({ allow, children }: { allow: UserRole[]; children: ReactNode }) {
  const { user } = useAuth()

  // Defensive: ProtectedRoute has established this, but rendering a privileged
  // page on a null user would be the worst possible way to be wrong.
  if (!user) return null

  if (!allow.includes(user.role)) {
    return <Navigate to={HOME_FOR_ROLE[user.role]} replace />
  }

  return <>{children}</>
}
