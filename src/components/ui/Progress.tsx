/* ============================================================================
   Progress — a horizontal completion bar.
   Used for: project milestone completion, payment collected vs contract value,
   and stock level vs reorder point.
   ========================================================================== */

interface ProgressProps {
  /** 0 to 1. */
  value: number
  tone?: 'brand' | 'success' | 'danger'
  label?: string
}

export function Progress({ value, tone = 'brand', label }: ProgressProps) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100)
  const fillClass = tone === 'brand' ? 'progress__fill' : `progress__fill progress__fill--${tone}`

  return (
    <div>
      {label && (
        <div className="row row--between small muted" style={{ marginBottom: 6 }}>
          <span>{label}</span>
          <span className="num strong">{pct}%</span>
        </div>
      )}
      <div
        className="progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={fillClass} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
