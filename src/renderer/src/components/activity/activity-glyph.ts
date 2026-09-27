import type { ActivityRow } from '@shared/activity-row'
import { displayBucket } from '@shared/activity-display'

/**
 * Single ActivityStore→visual mapping (docs/ade/12 §3). Every surface —
 * Mission Control cards, the Workers panel, sidebar rows — resolves state
 * through here instead of re-deciding locally. Bucket comes from
 * `displayBucket` (06 §10); only the presentation lives here.
 */
export type ActivityGlyphTone =
  | 'running'
  | 'warning'
  | 'danger'
  | 'success'
  | 'muted'

export type ActivityGlyphMark = 'spinner' | 'question' | 'dot' | 'check' | 'clock'

export type ActivityGlyph = {
  tone: ActivityGlyphTone
  mark: ActivityGlyphMark
  /** i18n key under common:*. */
  labelKey: string
  /** Adds the "可能卡住" clock hint inside the row's own bucket (12 §3). */
  stalled: boolean
}

export function activityGlyph(row: ActivityRow, now: number = Date.now()): ActivityGlyph {
  const bucket = displayBucket(row, now)
  const stalled = row.stalled === true
  if (bucket === 'working') {
    return { tone: 'running', mark: 'spinner', labelKey: 'adeStatusWorking', stalled }
  }
  if (bucket === 'needs-you') {
    return row.state === 'failed'
      ? { tone: 'danger', mark: 'dot', labelKey: 'adeStatusFailed', stalled }
      : { tone: 'warning', mark: 'question', labelKey: 'adeStatusWaiting', stalled }
  }
  if (bucket === 'review') {
    return { tone: 'success', mark: 'check', labelKey: 'adeStatusReview', stalled }
  }
  if (bucket === 'done') {
    return { tone: 'success', mark: 'dot', labelKey: 'adeStatusDone', stalled }
  }
  return { tone: 'muted', mark: 'dot', labelKey: 'adeStatusIdle', stalled }
}
