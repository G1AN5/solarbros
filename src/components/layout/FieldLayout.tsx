import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '@/app/auth/useAuth'
import { Avatar } from '@/components/ui/Avatar'
import { useOfflineQueue } from '@/lib/queries/field'
import { FIELD_NAV } from '@/app/navigation'
import { useCompany } from '@/lib/queries/public-site'
import { usePageTitle } from '@/lib/usePageTitle'

/* ============================================================================
   FieldLayout — mobile-first shell for the Field Technician Portal.
   ----------------------------------------------------------------------------
   Deliberately different from ConsoleLayout:
     • Bottom tab bar, not a side rail — thumbs reach the bottom of a phone.
     • Only four destinations, so nothing is buried in a menu.
     • Constrained to 520px even on desktop, so you can review the real mobile
       experience without opening dev-tools device emulation.

   The offline banner is a UI stub for the spec's requirement that technicians
   in low-signal areas keep working and sync later. The real implementation
   needs a service worker plus an IndexedDB write queue.
   ========================================================================== */

export function FieldLayout() {
  // Names the browser tab after the page, not after the folder Vite
  // scaffolded the project in.
  usePageTitle(useCompany().name)

  const { pending, isOnline } = useOfflineQueue()
  const { user } = useAuth()

  // Placeholder — replace with `useSyncStatus()` backed by the offline queue.

  return (
    <div className="shell--field">
      <header className="field-topbar">
        <div className="row row--between">
          <div>
            <div className="xs" style={{ color: 'var(--ink-400)' }}>
              Field Technician
            </div>
            <div style={{ fontWeight: 700 }}>{user?.fullName}</div>
          </div>
          <Avatar
            initials={user?.avatarInitials ?? '??'}
            url={user?.avatarUrl}
            name={user?.fullName}
          />
        </div>

        {(pending > 0 || !isOnline) && (
          <div
            className="xs"
            style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius)',
              background: 'rgba(245,158,11,0.15)',
              color: 'var(--brand-300)',
            }}
          >
            {pending > 0
              ? `⟳ ${pending} update${pending === 1 ? '' : 's'} saved on this phone — ` +
                (isOnline ? 'sending now.' : 'will send when you reconnect.')
              : '⚠ Offline. Your work is saved on this phone and will send itself.'}
          </div>
        )}
      </header>

      <main className="field-content">
        <Outlet />
      </main>

      <nav className="field-nav">
        {FIELD_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/field'}
            className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          >
            <span className="field-nav__icon" aria-hidden>
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
