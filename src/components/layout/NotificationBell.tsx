import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { HOME_FOR_ROLE, rolesFor } from '@/app/auth/route-access'
import { useAuth } from '@/app/auth/useAuth'
import { relative } from '@/lib/format'
import { useMarkNotificationsRead, useMyNotifications } from '@/lib/queries/client-portal'
import type { AppNotification, UserRole } from '@/types/domain'

/* ============================================================================
   NotificationBell — what has happened that needs this person.
   ----------------------------------------------------------------------------
   The topbar had a "◉" button with no handler. Customers at least had a
   notifications page; staff had nothing, so every message addressed to them —
   a customer signed a contract, a payment needs verifying, a ticket was
   assigned to you — was written to the database and read by nobody.

   Each notification carries the table and row it is about, so the bell opens
   the screen where the person can act on it rather than just reporting it.
   ========================================================================== */

/** Whether this role may open an office page — the same rule the router guards with. */
function mayOpen(role: UserRole, path: string): boolean {
  const pattern = path.startsWith('/admin/projects/') ? '/admin/projects/:projectId' : path
  try {
    return rolesFor(pattern).includes(role)
  } catch {
    return false
  }
}

/** Where a notification about this kind of record is acted on, per audience. */
function destination(role: UserRole, note: AppNotification): string {
  const entity = note.entity ?? ''
  const id = note.entityId ?? ''

  if (role === 'client') {
    switch (entity) {
      case 'projects':
        return '/portal/project'
      case 'invoices':
      case 'payments':
        return '/portal/billing'
      case 'appointments':
        return '/portal/appointments'
      case 'tickets':
        return '/portal/tickets'
      case 'warranty_requests':
        return '/portal/warranty'
      case 'documents':
        return '/portal/documents'
      default:
        return '/portal'
    }
  }

  if (role === 'technician') {
    return entity === 'appointments' && id ? `/field/jobs/${id}` : '/field'
  }

  /* The same record is acted on in different places by different roles — a
     visit request is the dispatch board for an engineer and the enquiries
     inbox for sales; a short project is purchasing for the warehouse. The
     first page on the list that this role may open wins, so the bell never
     sends anybody to a page they are then bounced off. */
  const candidates: Record<string, string[]> = {
    leads: ['/admin/enquiries', '/admin/crm'],
    appointments: ['/admin/dispatch', '/admin/enquiries'],
    quotations: ['/admin/quotes'],
    contracts: ['/admin/quotes'],
    projects: [
      id ? `/admin/projects/${id}` : '/admin/projects',
      '/admin/purchasing',
      '/admin/finance',
    ],
    invoices: ['/admin/finance'],
    payments: ['/admin/finance'],
    commissions: ['/admin/finance', '/admin'],
    documents: ['/admin/finance', '/admin/projects'],
    tickets: ['/admin/tickets'],
    warranty_requests: ['/admin/warranty'],
    purchase_orders: ['/admin/purchasing'],
    reviews: ['/admin/content'],
  }

  return (candidates[entity] ?? []).find((path) => mayOpen(role, path)) ?? HOME_FOR_ROLE[role]
}

export function NotificationBell({ inverse = false }: { inverse?: boolean }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const notificationsQuery = useMyNotifications()
  const markRead = useMarkNotificationsRead()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const notifications = notificationsQuery.data ?? []
  const unread = notifications.filter((n) => !n.read).length

  // Close on a click outside, and on Escape, like any other menu.
  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null

  function openNote(note: AppNotification) {
    if (!user) return
    if (!note.read) markRead.mutate({ id: note.id })
    setOpen(false)
    navigate(destination(user.role, note))
  }

  return (
    <div className="bell" ref={root}>
      <button
        type="button"
        className="bell__button"
        style={inverse ? { background: 'transparent', color: 'var(--white)' } : undefined}
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        🔔
        {unread > 0 && <span className="bell__count">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="bell__panel" role="menu">
          <div className="bell__head">
            <span className="strong small">Notifications</span>
            <span className="row" style={{ gap: 'var(--space-2)' }}>
              {unread > 0 && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={markRead.isPending}
                  onClick={() => markRead.mutate(undefined)}
                >
                  Mark all read
                </button>
              )}
              {user.role === 'client' && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setOpen(false)
                    navigate('/portal/notifications')
                  }}
                >
                  See all
                </button>
              )}
            </span>
          </div>

          {notificationsQuery.isLoading && <div className="csearch__empty">Loading…</div>}
          {!notificationsQuery.isLoading && notifications.length === 0 && (
            <div className="csearch__empty">Nothing yet. You will see updates here.</div>
          )}

          {notifications.slice(0, 20).map((note) => (
            <button
              key={note.id}
              type="button"
              role="menuitem"
              className={`bell__item${note.read ? '' : ' is-unread'}`}
              onClick={() => openNote(note)}
            >
              <div className="small strong">{note.title}</div>
              <div className="xs muted" style={{ marginTop: 2 }}>
                {note.body}
              </div>
              <div className="xs dim" style={{ marginTop: 4 }}>
                {relative(note.at)}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
