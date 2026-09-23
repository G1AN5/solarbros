import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

import { Logo } from './Logo'
import { useAuth } from '@/app/auth/useAuth'
import { ROLE_LABEL } from '@/lib/labels'
import { useConsoleSearch } from '@/lib/queries/search'
import type { NavGroup } from '@/app/navigation'
import { useCompany } from '@/lib/queries/public-site'
import { usePageTitle } from '@/lib/usePageTitle'

/* ============================================================================
   ConsoleLayout — the shared shell behind BOTH the Client Portal and the
   Enterprise Operations Hub.
   ----------------------------------------------------------------------------
   Why one component for two portals: they have identical ergonomics (persistent
   left rail, sticky topbar, scrolling content). Sharing the shell means a fix
   to focus handling or responsive behaviour lands in both at once. The only
   differences are passed in as props.

   Sidebar items are filtered by the signed-in user's role, using the `roles`
   field declared in src/app/navigation.ts.
   ========================================================================== */

interface ConsoleLayoutProps {
  /** Grouped sidebar destinations — CLIENT_NAV or ADMIN_NAV. */
  nav: NavGroup[]
  /** Small label under the logo, e.g. "Client Portal". */
  portalName: string
}

export function ConsoleLayout({ nav, portalName }: ConsoleLayoutProps) {
  // Names the browser tab after the page, not after the folder Vite
  // scaffolded the project in.
  usePageTitle(useCompany().name)

  const { user, signOut } = useAuth()

  /* The search box was a placeholder with a "⌘K command palette" comment and
     no handler - the most prominent control in the console, and the one most
     likely to be tried first in a walkthrough. It now searches the three
     things it always claimed to: projects, customers and tickets.

     Only in the operations hub. The customer portal has one project and a
     handful of tickets; a search box there would be answering a question
     nobody has. */
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchable = portalName !== 'Client Portal'
  const results = useConsoleSearch(searchable ? search : '')
  const hits = results.data ?? []

  function goTo(to: string) {
    setSearch('')
    setSearchOpen(false)
    navigate(to)
  }

  // Drop any group left with no visible items after role filtering, so we never
  // render an empty "Governance" heading for a sales rep.
  const visibleGroups = nav
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || (user && item.roles.includes(user.role))),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <div className="shell--console">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Logo inverse compact />
          <div>
            <div style={{ color: 'var(--white)', fontWeight: 700, fontSize: 'var(--text-sm)' }}>
              SolarBros
            </div>
            <div className="xs" style={{ color: 'var(--ink-500)' }}>
              {portalName}
            </div>
          </div>
        </div>

        <nav className="sidebar__nav">
          {visibleGroups.map((group) => (
            <div key={group.heading}>
              <div className="sidebar__group">{group.heading}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  // `end` keeps the index route from staying highlighted on
                  // every child page (e.g. /admin vs /admin/crm).
                  end={item.to === '/admin' || item.to === '/portal'}
                  className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}
                  title={item.description}
                >
                  <span className="sidebar__icon" aria-hidden>
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="row" style={{ marginBottom: 'var(--space-3)' }}>
            <span className="avatar">{user?.avatarInitials}</span>
            <div style={{ minWidth: 0 }}>
              <div className="small" style={{ color: 'var(--white)', fontWeight: 600 }}>
                {user?.fullName}
              </div>
              <div className="xs" style={{ color: 'var(--ink-500)' }}>
                {user && ROLE_LABEL[user.role]}
              </div>
            </div>
          </div>
          <button className="btn btn--light btn--sm btn--block" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="console-main">
        <header className="topbar">
          <div className="row">
            {searchable && (
              <div className="csearch">
                <input
                  className="input"
                  placeholder="Search projects, clients, tickets…"
                  style={{ width: 320, maxWidth: '50vw' }}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setSearchOpen(true)
                  }}
                  onFocus={() => setSearchOpen(true)}
                  /* Closed on a delay, not immediately: clicking a result
                     blurs the input first, and closing on blur would unmount
                     the row before the click landed on it. */
                  onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setSearchOpen(false)
                    if (event.key === 'Enter' && hits.length > 0) goTo(hits[0].to)
                  }}
                />

                {searchOpen && search.trim().length >= 2 && (
                  <div className="csearch__panel">
                    {results.isLoading && <div className="csearch__empty">Searching…</div>}
                    {!results.isLoading && hits.length === 0 && (
                      <div className="csearch__empty">Nothing matches “{search.trim()}”.</div>
                    )}
                    {hits.map((hit) => (
                      <button
                        key={`${hit.kind}-${hit.id}`}
                        type="button"
                        className="csearch__hit"
                        onClick={() => goTo(hit.to)}
                      >
                        <span className="csearch__kind">{hit.kind}</span>
                        <span>
                          <span className="strong small">{hit.title}</span>
                          {hit.subtitle && (
                            <span className="xs dim" style={{ display: 'block' }}>
                              {hit.subtitle}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="row">
            <button className="btn btn--ghost btn--sm" title="Notifications">
              ◉ <span className="sr-only">Notifications</span>
            </button>
            <span className="avatar">{user?.avatarInitials}</span>
          </div>
        </header>

        <main className="console-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
