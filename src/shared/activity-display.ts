import type { ActivityRollupState } from './activity-rollup'

/** Done rows stop asking for review 30 minutes after acknowledgement. */
export const DONE_DECAY_MS = 30 * 60_000

export type ActivityDisplayRow = {
  state: ActivityRollupState
  kind: 'thread' | 'worker' | 'side-chat' | 'graph-attempt' | 'terminal-agent'
  workspace: { kind: 'worktree' | 'local' | 'directory' }
  stateSince: string
  acknowledgedAt?: string
  dismissedAt?: string
}

export type ActivityDisplayBucket = 'needs-you' | 'working' | 'review' | 'done' | 'idle'

/**
 * Single bucketing rule shared by desktop and phone (docs/ade/06 §10).
 */
export function displayBucket(row: ActivityDisplayRow, now: number): ActivityDisplayBucket {
  if (row.dismissedAt) return row.state === 'working' ? 'working' : 'idle'
  if (row.state === 'waiting') return 'needs-you'
  if (row.state === 'working' || row.state === 'initializing') return 'working'
  if (row.state === 'failed') return 'needs-you'
  if (row.state === 'done') {
    const reviewable = row.kind !== 'thread' || row.workspace.kind === 'worktree'
    if (now - Date.parse(row.stateSince) > DONE_DECAY_MS && row.acknowledgedAt) return 'idle'
    return reviewable ? 'review' : 'done'
  }
  return 'idle'
}
