import { Badge } from './Badge'
import { MILESTONE_STATUS_TONE } from '@/lib/labels'
import { dateTime, humanize } from '@/lib/format'
import type { Milestone } from '@/types/domain'

/* ============================================================================
   Timeline — renders the installation milestone sequence.
   ----------------------------------------------------------------------------
   THIS IS THE SHARED COMPONENT that keeps three screens honest with each other:

     • Client Portal → Project Tracker   (read-only, reassuring tone)
     • Admin        → Project detail     (read-only, operational tone)
     • Field Portal → Milestone Updater  (interactive, ticks stages off)

   Because they all render the same `Milestone[]`, a technician's update in the
   field is guaranteed to match what the customer sees on their progress bar.
   ========================================================================== */

interface TimelineProps {
  milestones: Milestone[]
  /** Field portal passes this to make each row tappable. */
  onToggle?: (key: Milestone['key']) => void
}

export function Timeline({ milestones, onToggle }: TimelineProps) {
  return (
    <ol className="timeline">
      {milestones.map((m) => {
        const modifier =
          m.status === 'done' ? 'done' : m.status === 'in_progress' ? 'active' : 'idle'

        return (
          <li
            key={m.key}
            className={`timeline__item timeline__item--${modifier}`}
            onClick={onToggle ? () => onToggle(m.key) : undefined}
            style={onToggle ? { cursor: 'pointer' } : undefined}
          >
            <span className="timeline__dot" aria-hidden />
            <div className="row row--between" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="timeline__title">{m.label}</div>
                {m.completedAt && (
                  <div className="timeline__meta">
                    Completed {dateTime(m.completedAt)}
                    {m.completedBy && ` · ${m.completedBy}`}
                  </div>
                )}
                {m.note && (
                  <div className="timeline__meta" style={{ marginTop: 4 }}>
                    {m.note}
                  </div>
                )}
              </div>
              <Badge tone={MILESTONE_STATUS_TONE[m.status]}>{humanize(m.status)}</Badge>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
