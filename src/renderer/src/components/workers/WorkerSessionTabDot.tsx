import type { ReactElement } from 'react'
import { useActivityStore } from '../../store/activity-store'
import { activityGlyph } from '../activity/activity-glyph'
import './workers-panel.css'

/** Live status dot in a worker tab; subscribes to that worker's row only. */
export function WorkerSessionTabDot({ workerId, active }: { workerId: string; active: boolean }): ReactElement {
  const tone = useActivityStore((s) => {
    const row = s.rows[workerId]
    return row ? activityGlyph(row).tone : 'muted'
  })
  return (
    <span
      className="ds-worker-tone ds-worker-tone-dot h-[7px] w-[7px] shrink-0 rounded-full"
      data-tone={tone}
      data-ring={active || undefined}
      data-worker-tab-dot={tone}
      aria-hidden
    />
  )
}
