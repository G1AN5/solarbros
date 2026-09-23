import type { ReactNode } from 'react'

import { EmptyState } from './EmptyState'
import { Loader } from './Loader'

/* ============================================================================
   QueryState — one consistent treatment for loading, error and empty.
   ----------------------------------------------------------------------------
   Every screen that reads from the database hits the same three states, and
   handling them ad-hoc produces an application that feels different on every
   page: one spinner here, a blank screen there, an unhandled error somewhere
   else. This centralises the decision.

   THE LOADING TREATMENT WAITS BEFORE IT SAYS ANYTHING
   A spinner that appears for 80ms is worse than nothing — it reads as a glitch.
   So `Loader` stays invisible for 400ms and then fades in: fast queries never
   show it, and a slow one on mobile data gets moving reassurance rather than an
   empty panel that looks broken.

   ERRORS ARE SHOWN, NOT SWALLOWED
   A failed query usually means an RLS policy denied the read or the network
   dropped. Rendering an empty table in that case is actively misleading — the
   customer concludes they have no invoices. So the error is surfaced plainly,
   with the technical detail kept to development builds.
   ========================================================================== */

interface QueryStateProps {
  isLoading: boolean
  error?: Error | null
  /** True when the query succeeded but returned nothing. */
  isEmpty?: boolean
  /** Shown when `isEmpty`. Falls back to a generic message. */
  emptyTitle?: string
  emptyMessage?: string
  emptyIcon?: string
  /** What is being waited for. "Loading invoices…" beats "Loading…". */
  loadingLabel?: string
  /** Rendered once data is present. */
  children: ReactNode
}

export function QueryState({
  isLoading,
  error,
  isEmpty,
  emptyTitle = 'Nothing here yet',
  emptyMessage = 'There is nothing to show on this page at the moment.',
  emptyIcon = '📭',
  loadingLabel = 'Loading…',
  children,
}: QueryStateProps) {
  if (isLoading) {
    return <Loader label={loadingLabel} />
  }

  if (error) {
    return (
      <div
        style={{
          padding: 'var(--space-5)',
          background: 'var(--danger-bg)',
          color: 'var(--danger-fg)',
          borderRadius: 'var(--radius)',
        }}
        role="alert"
      >
        <strong>We could not load this.</strong>
        <p className="small" style={{ marginTop: 'var(--space-2)' }}>
          Please refresh the page. If it keeps happening, contact us and we will look into it.
        </p>
        {import.meta.env.DEV && (
          <pre
            className="xs"
            style={{ marginTop: 'var(--space-3)', whiteSpace: 'pre-wrap', opacity: 0.8 }}
          >
            {error.message}
          </pre>
        )}
      </div>
    )
  }

  if (isEmpty) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} />
  }

  return <>{children}</>
}
