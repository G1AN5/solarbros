import { describe, expect, it } from 'vitest'

import { ADMIN_NAV } from '@/app/navigation'
import { HOME_FOR_ROLE, landingsAreReachable, rolesFor } from '../route-access'
import { STAFF_ROLES, type UserRole } from '@/types/domain'

/* ============================================================================
   PER-PAGE ACCESS RULES
   ----------------------------------------------------------------------------
   Two failures are being guarded against here, and neither one throws at
   runtime — they present as a blank browser tab, which is the hardest kind of
   bug to attribute.

   1. AN INFINITE REDIRECT.
      A wrong role is bounced to HOME_FOR_ROLE[role]. If that landing page is
      itself a page the role may not open, it bounces again, forever. This is a
      live hazard rather than a theoretical one: /admin renders Analytics, which
      only admin, accountant and sales may read, and two staff roles used to be
      sent there. Before per-page guards existed that was harmless because
      nothing stopped them. Adding the guard is what turns it into a loop.

   2. A PAGE WITH NO RULE.
      `rolesFor` throws rather than defaulting, because both defaults are wrong:
      "all staff" silently opens a new page to everyone, and "nobody" ships a
      page that looks broken. This asserts every real route has an answer.
   ========================================================================== */

/** Every path the router guards, mirroring the children list in router.tsx. */
const GUARDED_PATHS = [
  '/admin',
  '/admin/crm',
  '/admin/quotes',
  '/admin/projects',
  '/admin/projects/:projectId',
  '/admin/dispatch',
  '/admin/tickets',
  '/admin/permits',
  '/admin/inventory',
  '/admin/purchasing',
  '/admin/assets',
  '/admin/warranty',
  '/admin/finance',
  '/admin/hr',
  '/admin/content',
  '/admin/settings',
  '/admin/governance',
  '/admin/audit',
  '/admin/outbox',
]

describe('landing pages', () => {
  it('sends every staff role somewhere that role may actually open', () => {
    expect(landingsAreReachable()).toBe(true)
  })

  /* Named individually so a failure says WHICH role is looping, rather than
     leaving somebody to work it out from a single false. */
  for (const role of STAFF_ROLES) {
    it(`does not bounce ${role} off their own landing page`, () => {
      expect(rolesFor(HOME_FOR_ROLE[role])).toContain(role)
    })
  }

  it('sends a client and a technician out of the staff hub entirely', () => {
    expect(HOME_FOR_ROLE.client).toBe('/portal')
    expect(HOME_FOR_ROLE.technician).toBe('/field')
  })
})

describe('rolesFor', () => {
  it('has a rule for every guarded route', () => {
    for (const path of GUARDED_PATHS) {
      expect(() => rolesFor(path)).not.toThrow()
      expect(rolesFor(path).length).toBeGreaterThan(0)
    }
  })

  it('refuses to guess at a path nobody has declared', () => {
    // The alternative is a default, and both possible defaults are wrong:
    // one opens the page to everybody, the other to nobody.
    expect(() => rolesFor('/admin/something-new')).toThrow(/No access rule/)
  })

  it('matches what the sidebar advertises, so the link and the door agree', () => {
    for (const item of ADMIN_NAV.flatMap((group) => group.items)) {
      expect(rolesFor(item.to)).toEqual(item.roles ?? STAFF_ROLES)
    }
  })

  it('keeps the privileged pages to administrators', () => {
    for (const path of ['/admin/governance', '/admin/audit', '/admin/outbox']) {
      expect(rolesFor(path)).toEqual(['admin'])
    }
  })

  it('does not let a sales rep open payroll or the audit log', () => {
    // The exact case that prompted this work.
    expect(rolesFor('/admin/hr')).not.toContain('sales')
    expect(rolesFor('/admin/audit')).not.toContain('sales')
  })

  it('gives a detail page the same rule as the list it belongs to', () => {
    expect(rolesFor('/admin/projects/:projectId')).toEqual(rolesFor('/admin/projects'))
  })

  it('never grants a page to a role that cannot reach the hub', () => {
    const outsiders: UserRole[] = ['client', 'technician']
    for (const path of GUARDED_PATHS) {
      for (const role of outsiders) {
        expect(rolesFor(path)).not.toContain(role)
      }
    }
  })
})
