import { ADMIN_NAV } from '@/app/navigation'
import { STAFF_ROLES, type UserRole } from '@/types/domain'

/* ============================================================================
   PER-PAGE ACCESS, DERIVED FROM THE MENU
   ----------------------------------------------------------------------------
   Until now `/admin` was gated once, for staff as a whole. The `roles` field on
   each navigation item only decided whether a LINK was drawn — so a sales rep
   who typed /admin/hr, /admin/audit or /admin/governance got the page. The data
   was empty, because RLS refuses it, but the screen opened, and a screen that
   opens is a screen somebody will report as a bug or mistake for access.

   WHY THIS IS DERIVED AND NOT A SECOND LIST
   The obvious fix is an `allow` array on every route. That works on the day it
   is written and drifts forever after: somebody widens a menu entry, forgets
   the route, and the two disagree with no error. The menu is already the
   documented RBAC matrix, so the guard reads from it. One edit, both effects.

   THIS IS STILL NOT THE SECURITY BOUNDARY.
   It decides what RENDERS. Row Level Security decides what a request may read,
   and it is enforced in Postgres where a tampered browser cannot reach it. A
   determined person who edits this file in devtools gains a set of empty
   screens. Both layers exist because they answer different questions: this one
   keeps honest people out of the wrong room, RLS keeps everybody's data safe.
   ========================================================================== */

/** Every menu destination, mapped to the roles the menu says may open it. */
const FROM_NAV: Record<string, UserRole[]> = Object.fromEntries(
  ADMIN_NAV.flatMap((group) => group.items).map((item) => [item.to, item.roles ?? STAFF_ROLES]),
)

/**
 * Routes with no menu entry of their own.
 *
 * A detail page is reached by clicking a row, so it never appears in a sidebar
 * — and would therefore fall through to "everyone" if the map were read
 * literally. Each one inherits from the list page it belongs to.
 */
const UNLISTED: Record<string, UserRole[]> = {
  '/admin/projects/:projectId': FROM_NAV['/admin/projects'] ?? STAFF_ROLES,
}

/**
 * Which roles may open a path.
 *
 * Deliberately throws on an unknown path rather than defaulting. A default of
 * "all staff" silently opens a new page to everyone the moment somebody adds a
 * route and forgets the menu entry; a default of "nobody" ships a page that
 * cannot be reached and looks like a permissions bug. Failing loudly during
 * development is the only option that cannot be mistaken for working.
 */
export function rolesFor(path: string): UserRole[] {
  const found = FROM_NAV[path] ?? UNLISTED[path]

  if (!found) {
    throw new Error(
      `No access rule for "${path}". Add it to ADMIN_NAV, or to UNLISTED in route-access.ts if it has no menu entry.`,
    )
  }

  return found
}

/* ============================================================================
   WHERE EACH ROLE LANDS
   ----------------------------------------------------------------------------
   Every value here MUST be a page that role may actually open. Sending someone
   to a page they are then bounced off is an infinite redirect, and this is a
   live example rather than a hypothetical one: /admin renders Analytics, which
   is limited to admin, accountant and sales. Before per-page guards existed,
   sending an inventory manager to /admin was harmless because nothing stopped
   them. The moment the guard works, that same line becomes a loop.

   `landingsAreReachable` below is asserted by a unit test for exactly that
   reason — it is a two-line mistake with a whole-portal consequence.
   ========================================================================== */

export const HOME_FOR_ROLE: Record<UserRole, string> = {
  client: '/portal',
  technician: '/field',

  // Staff go to the page they actually work in, not a dashboard half of them
  // are not allowed to read.
  sales: '/admin/crm',
  project_engineer: '/admin/projects',
  inventory_manager: '/admin/inventory',
  accountant: '/admin/finance',
  admin: '/admin',
}

/** True when every staff role's landing page is one that role may open. */
export function landingsAreReachable(): boolean {
  return STAFF_ROLES.every((role) => rolesFor(HOME_FOR_ROLE[role]).includes(role))
}
