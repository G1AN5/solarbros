import { Card } from './Card'

/* ============================================================================
   StatTile — a single KPI number.
   Used on the Executive Analytics dashboard, the client dashboard and the
   summary rows above operational tables.
   ========================================================================== */

interface StatTileProps {
  label: string
  value: string
  /** Period-over-period change, e.g. "+12.4% vs last month". */
  delta?: string
  /** Controls the delta colour. 'up' is not always good — see `invertDelta`. */
  direction?: 'up' | 'down' | 'flat'
  /**
   * For metrics where rising is BAD (overdue invoices, stockouts), pass true so
   * an upward delta renders red instead of green.
   */
  invertDelta?: boolean
}

export function StatTile({ label, value, delta, direction = 'flat', invertDelta }: StatTileProps) {
  let tone: 'up' | 'down' | 'flat' = direction
  if (invertDelta && direction === 'up') tone = 'down'
  else if (invertDelta && direction === 'down') tone = 'up'

  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : ''

  return (
    <Card>
      <div className="stat">
        <div className="stat__label">{label}</div>
        <div className="stat__value">{value}</div>
        {delta && (
          <div className={`stat__delta stat__delta--${tone}`}>
            {arrow} {delta}
          </div>
        )}
      </div>
    </Card>
  )
}
