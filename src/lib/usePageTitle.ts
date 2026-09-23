import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { ADMIN_NAV, CLIENT_NAV, FIELD_NAV, PUBLIC_NAV } from '@/app/navigation'

/* ============================================================================
   THE BROWSER TAB
   ----------------------------------------------------------------------------
   The tab said "code-for-solarbros" on every screen — the folder name Vite
   scaffolded the project with, which is not a thing anybody outside this
   repository has ever heard of.

   A static company name would be an improvement and still not much use. Tabs
   are how somebody with six of them open finds the one they want, and how a
   bookmark names itself. So each screen says where it is:

       Billing · SolarBros
       Leads & Pipeline · SolarBros

   The label is READ FROM THE NAVIGATION MAP rather than written again here.
   That map already names every destination for the sidebar, so a page renamed
   in the menu renames its tab at the same time, and a new page cannot ship with
   somebody else's title.
   ========================================================================== */

/** Every labelled destination in the app, longest path first. */
const ROUTES: { to: string; label: string }[] = [
  // ADMIN_NAV and CLIENT_NAV are grouped; FIELD_NAV and PUBLIC_NAV are flat.
  ...[...ADMIN_NAV, ...CLIENT_NAV].flatMap((group) =>
    group.items.map((item) => ({ to: item.to, label: item.label })),
  ),
  ...[...FIELD_NAV, ...PUBLIC_NAV].map((item) => ({ to: item.to, label: item.label })),
].sort((a, b) => b.to.length - a.to.length)

/** Pages with no menu entry of their own. */
const UNLISTED: Record<string, string> = {
  '/': 'Home',
  '/login': 'Sign in',
  '/register': 'Create an account',
  '/forgot-password': 'Reset your password',
  '/reset-password': 'Choose a new password',
  '/team': 'Staff sign-in',
  '/site-map': 'Site map',
}

function labelFor(pathname: string): string | null {
  if (UNLISTED[pathname]) return UNLISTED[pathname]

  /* Longest match first, so /admin/projects/<id> resolves to "Projects" rather
     than being swallowed by the /admin index entry. */
  const hit = ROUTES.find((route) => pathname === route.to || pathname.startsWith(`${route.to}/`))
  return hit?.label ?? null
}

/**
 * Keeps document.title in step with the route.
 *
 * Called once per layout rather than once per page: every screen already sits
 * inside exactly one layout, and doing it per page would be forty places to
 * forget.
 */
export function usePageTitle(companyName: string) {
  const { pathname } = useLocation()

  useEffect(() => {
    const name = companyName || 'SolarBros'
    const page = labelFor(pathname)
    document.title = page ? `${page} · ${name}` : name
  }, [pathname, companyName])
}
