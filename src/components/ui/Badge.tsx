import type { ReactNode } from 'react'
import type { Tone } from '@/lib/labels'

/* ============================================================================
   Badge — the status pill used in every table, card and header.
   The `tone` always comes from a *_TONE map in src/lib/labels.ts, never from a
   hard-coded colour, so one status reads identically across all four portals.
   ========================================================================== */

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>
}
