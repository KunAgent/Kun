import type { ActivityRollupState } from './activity-rollup'

/**
 * Renderer-facing mirror of kun/src/contracts/activity.ts ActivityRow.
 * The wire shape is owned by the kun contract; keep field names aligned.
 */
export type ActivityUnitKind =
  | 'thread'
  | 'worker'
  | 'side-chat'
  | 'graph-attempt'
  | 'terminal-agent'

export type { ActivityRollupState as ActivityState }

export type ActivityRow = {
  unitId: string
  kind: ActivityUnitKind
  threadId: string
  parentThreadId?: string
  teamId?: string
  harnessId: string
  title: string
  workspace: {
    path: string
    kind: 'worktree' | 'local' | 'directory'
    branch?: string
  }
  state: ActivityRollupState
  waitingReason?: 'approval' | 'user_input' | 'question' | 'terminal_prompt'
  mainState: ActivityRollupState
  lastOutcome?: 'completed' | 'failed' | 'cancelled'
  children: { working: number; waiting: number; done: number; failed: number }
  phase?: 'investigating' | 'implementing' | 'verifying' | 'blocked' | 'compacting'
  progressNote?: string
  currentTool?: string
  lastMessagePreview?: string
  turnId?: string
  stateSince: string
  updatedAt: string
  provenance: 'runtime' | 'callback' | 'hook' | 'inferred' | 'restored'
  restoredUnconfirmed: boolean
  stalled: boolean
  visibility: 'active' | 'archived'
  residency: 'live' | 'dormant'
  acknowledgedAt?: string
  dismissedAt?: string
  pinned: boolean
}

export type ActivityChange = {
  unitId: string
  removed?: boolean
  row?: ActivityRow
}

export type ActivitySnapshotResponse = {
  cursor: string
  rows: ActivityRow[]
}

export type ActivityPollResponse =
  | { type: 'activity'; cursor: string; changes: ActivityChange[] }
  | { type: 'reset_required'; cursor: string; reason?: string }
