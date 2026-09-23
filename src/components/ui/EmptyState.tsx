import type { ReactNode } from 'react'

/* ============================================================================
   EmptyState — shown when a list has no records yet.
   Always give the user the next action, never just "No data".
   ========================================================================== */

interface EmptyStateProps {
  icon?: string
  title: string
  message?: string
  action?: ReactNode
}

export function EmptyState({ icon = '📭', title, message, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden>
        {icon}
      </div>
      <h3 style={{ fontSize: 'var(--text-md)' }}>{title}</h3>
      {message && <p className="small">{message}</p>}
      {action && <div style={{ marginTop: 'var(--space-3)' }}>{action}</div>}
    </div>
  )
}
