/* ============================================================================
   FunnelChart — horizontal ordinal bars for the sales pipeline.
   ----------------------------------------------------------------------------
   Stages are ORDERED (New → Quoted → Site Visit → Contract → Installed), so the
   colour encoding is an *ordinal ramp* of one hue getting darker with progress —
   not five arbitrary categorical colours. Depth of colour = depth in the funnel.

   Each row also shows the step-to-step conversion rate, which is the number a
   sales manager actually acts on ("we lose 60% between Quoted and Site Visit").
   ========================================================================== */

export interface FunnelStage {
  label: string
  count: number
}

/** Validated ordinal ramp — see src/styles/viz.css for how these were checked. */
const RAMP = [
  'var(--viz-ordinal-1)',
  'var(--viz-ordinal-2)',
  'var(--viz-ordinal-3)',
  'var(--viz-ordinal-4)',
  'var(--viz-ordinal-5)',
]

export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const top = Math.max(...stages.map((s) => s.count), 1)

  return (
    <div>
      {stages.map((stage, i) => {
        const previous = i > 0 ? stages[i - 1].count : null
        const conversion =
          previous && previous > 0 ? Math.round((stage.count / previous) * 100) : null

        return (
          <div key={stage.label} className="funnel__row">
            <div className="funnel__label">{stage.label}</div>
            <div className="funnel__track">
              <div
                className="funnel__fill"
                style={{
                  width: `${(stage.count / top) * 100}%`,
                  // Ramp is indexed by stage position, so colour always follows
                  // the stage — never its current rank by volume.
                  background: RAMP[Math.min(i, RAMP.length - 1)],
                }}
              />
            </div>
            <div>
              <div className="funnel__value">{stage.count}</div>
              {conversion !== null && <div className="funnel__rate">{conversion}% ↓</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
