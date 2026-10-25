import type { ContextSnapshotEvent, RuntimeEvent } from '../contracts/events.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type {
  ApprovalTurnItem,
  TurnItem,
  UserInputQuestionSchema,
  UserInputTurnItem
} from '../contracts/items.js'
import type { Turn } from '../contracts/turns.js'
import type { DelegationDiagnostics, ThreadDetail } from './client.js'
import type { z } from 'zod'
import type { ThreadUsageSummary, TurnTiming } from './turn-timing.js'

export type PendingApproval = {
  approvalId: string
  toolName: string
  summary: string
  turnId?: string
  itemId?: string
}

export type PendingUserInput = {
  inputId: string
  prompt: string
  questions: Array<z.infer<typeof UserInputQuestionSchema>>
  turnId?: string
  itemId?: string
}

export type ProjectedApprovalReview = {
  reviewId: string
  approvalId: string
  toolName: string
  summary: string
  turnId?: string
  status: 'in-progress' | 'approved' | 'denied' | 'timed-out' | 'failed-closed' | 'aborted'
  decision?: 'allow' | 'deny'
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
  rationale?: string
  startedAt: string
  completedAt?: string
}

export type ProjectedTurnActivity = {
  turnId: string
  phase: 'starting' | 'thinking' | 'responding' | 'tool' | 'retrying' | 'compacting' | 'waiting'
  label?: string
  toolName?: string
  /** Start of the current visible phase; resets when the phase/label changes. */
  startedAt: string
  /** Start of the parent turn; remains stable across model/tool/subagent phases. */
  turnStartedAt: string
  updatedAt: string
  attempt?: number
  maxAttempts?: number
}

export type ProjectedChildRun = {
  childId: string
  parentTurnId: string
  childSeq?: number
  label?: string
  prompt?: string
  profile?: string
  profileName?: string
  model?: string
  providerId?: string
  reasoningEffort?: string
  toolPolicy?: 'readOnly' | 'inherit'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted'
  text?: string
  detached?: boolean
  prefixReused?: boolean
  inheritedHistoryItems?: number
  toolInvocations?: number
  activity?: {
    phase: 'starting' | 'thinking' | 'responding' | 'tool' | 'retrying' | 'compacting' | 'waiting'
    label: string
    toolName?: string
    startedAt: string
    updatedAt: string
  }
  durationMs?: number
  queuedMs?: number
  totalTokens?: number
  cacheHitRate?: number | null
  costUsd?: number
  costCny?: number
  startedAt: string
  updatedAt: string
}

export type ThreadProjection = {
  thread: ThreadDetail
  items: TurnItem[]
  lastSeq: number
  runningTurnId?: string
  pendingApproval?: PendingApproval
  pendingUserInput?: PendingUserInput
  usage?: UsageSnapshot
  contextSnapshot?: ContextSnapshotEvent
  /** Average TTFT and tok/s per turn: settled turns' `modelTiming`, then live usage events. */
  turnTiming?: Record<string, TurnTiming>
  /** Thread usage totals read when the session opened; live `usage` supersedes them. */
  usageSummary?: ThreadUsageSummary
  lastError?: string
  activity?: ProjectedTurnActivity
  childRuns: ProjectedChildRun[]
  approvalReviews: ProjectedApprovalReview[]
}
