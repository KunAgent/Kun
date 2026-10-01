import type { ActivityRollupState } from './activity-rollup'

/** Routine completed rows may leave the foreground after acknowledgement. */
export const DONE_DECAY_MS = 30 * 60_000

export type ActivityReviewStatus =
  | 'pending' | 'needs_changes' | 'passed' | 'waived' | 'rejected' | 'stale' | 'unknown'

export type ActivityDisplayRow = {
  state: ActivityRollupState
  kind: 'thread' | 'worker' | 'side-chat' | 'graph-attempt' | 'terminal-agent'
  workspace: { kind: 'worktree' | 'local' | 'directory' }
  stateSince: string
  acknowledgedAt?: string
  dismissedAt?: string
  restoredUnconfirmed?: boolean
  lastOutcome?: 'completed' | 'failed' | 'cancelled'
  /** Explicit quality state when available; missing legacy rows use the kind/workspace heuristic. */
  reviewRequired?: boolean
  reviewStatus?: ActivityReviewStatus
}

export type ActivityDisplayBucket = 'needs-you' | 'working' | 'review' | 'done' | 'idle'

/**
 * Single bucketing rule shared by desktop and phone (docs/ade/06 §10).
 */
export function displayBucket(row: ActivityDisplayRow, now: number): ActivityDisplayBucket {
  // Recovered facts await runtime confirmation before they drive actionable UI.
  if (row.restoredUnconfirmed) return 'idle'
  const reviewable = row.reviewRequired ??
    (row.kind !== 'thread' || row.workspace.kind === 'worktree')
  const reviewOpen = reviewable &&
    (row.reviewRequired === true || row.lastOutcome !== 'cancelled') &&
    !['passed', 'waived', 'rejected'].includes(row.reviewStatus ?? 'pending')
  // Reading or dismissing a card must not resolve a quality requirement.
  if (row.state === 'done' && reviewOpen) return 'review'
  if (row.dismissedAt) return row.state === 'working' ? 'working' : 'idle'
  if (row.state === 'waiting') return 'needs-you'
  if (row.state === 'working' || row.state === 'initializing') return 'working'
  if (row.state === 'failed') return 'needs-you'
  if (row.state === 'done') {
    if (now - Date.parse(row.stateSince) > DONE_DECAY_MS && row.acknowledgedAt) return 'idle'
    return 'done'
  }
  return 'idle'
}
