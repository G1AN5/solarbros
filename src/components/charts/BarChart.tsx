import { useState } from 'react'

/* ============================================================================
   BarChart — single-series vertical bars for change-over-time.
   ----------------------------------------------------------------------------
   Hand-built with CSS rather than a charting library: zero dependencies, fully
   responsive, and small enough to read in one sitting. Swap for Recharts/visx
   only if you genuinely need brushing, zoom or multi-axis work.

   Design decisions baked in here:
     • ONE series → no legend needed; the card title names the measure.
     • 2px gap between bars so adjacent marks never visually merge.
     • 4px rounded top, square base — the bar reads as anchored to zero.
     • Hover tooltip rather than a label on every bar (avoids label soup).
     • Y-axis starts at zero. Truncated bar baselines misrepresent magnitude.
   ========================================================================== */

export interface BarDatum {
  label: string
  value: number
}

interface BarChartProps {
  data: BarDatum[]
  /** Formats the value for the tooltip and y-axis, e.g. currencyCompact. */
  format: (value: number) => string
  /** Describes what the numbers are, shown above the value in the tooltip. */
  valueLabel?: string
}

export function BarChart({ data, format, valueLabel = 'Value' }: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null)

  // Scale to a "nice" ceiling above the max so bars never touch the top edge.
  const max = Math.max(...data.map((d) => d.value), 1)
  const ceiling = max * 1.15

  // Four gridlines, matching the 25% repeating background in viz.css.
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => format(ceiling * f))

  return (
    <div className="chart">
      {hovered !== null && (
        <div
          className="chart__tooltip"
          style={{
            left: `calc(56px + ${((hovered + 0.5) / data.length) * 100}% )`,
            top: 0,
          }}
        >
          <div className="chart__tooltip-label">
            {data[hovered].label} · {valueLabel}
          </div>
          <div className="chart__tooltip-value">{format(data[hovered].value)}</div>
        </div>
      )}

      <div className="chart__plot">
        <div className="chart__yaxis" aria-hidden>
          {ticks.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>

        <div>
          <div className="chart__bars">
            {data.map((d, i) => (
              <div
                key={d.label}
                className="chart__bar-slot"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                title={`${d.label}: ${format(d.value)}`}
              >
                <div className="chart__bar" style={{ height: `${(d.value / ceiling) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="chart__xaxis" aria-hidden>
            {data.map((d) => (
              <span key={d.label} className="chart__xlabel">
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Accessible alternative to the visual chart — screen readers and
          keyboard users get the same numbers as a plain table. */}
      <table className="sr-only">
        <caption>{valueLabel} by period</caption>
        <thead>
          <tr>
            <th>Period</th>
            <th>{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
