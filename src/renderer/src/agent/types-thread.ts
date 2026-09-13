import type { ApprovalPolicy, ApprovalReviewer, SandboxMode } from '@shared/app-settings'
import type { RoomThreadSource } from '@shared/rooms-api'
import type { KnowledgeBaseMount, ThreadGoal, ThreadTodoList } from './types'

export type NormalizedThread = {
  historyRefId?: string
  roomContext?: RoomThreadSource
  id: string
  title: string
  /** Durable product surface that owns this thread. Absent for legacy Code threads. */
  agentSurface?: 'code' | 'write' | 'design'
  /** Immutable task mode derived from the first accepted turn. */
  lockedTaskSurface?: 'code' | 'write' | 'design'
  /** Immutable runtime-owned profile for a Design task. */
  designProfile?: import('./design-task-profile').DesignTaskProfile
  designCloneOperation?: {
    operationId: string
    kind: 'fork' | 'resume'
    sourceId: string
  }
  /** Whether the title is auto/provisional (true) vs user-set/locked (false); absent = legacy. */
  titleAuto?: boolean
  updatedAt: string
  model: string
  mode: string
  workspace?: string
  knowledgeBases?: KnowledgeBaseMount[]
  status?: string
  latestSeq?: number
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  /** Whether future model requests are retained for Agent Perspective. */
  modelRequestCaptureEnabled?: boolean
  /** Optional provider id when this thread is pinned to a non-default provider. */
  providerId?: string
  /** Optional subagent profile id this thread is bound to (primary-agent persona). */
  agentId?: string
  /** Optional persona systemPrompt snapshot applied to every ModelRequest on this thread. */
  systemPrompt?: string
  archived?: boolean
  pinned?: boolean
  preview?: string
  summary?: string // Whole-conversation summary shown as the list subtitle.
  latestTurnId?: string
  latestTurnStatus?: string
  relation?: 'primary' | 'fork' | 'side'
  parentThreadId?: string
  /** Legacy plan-build linkage retained for read-only history compatibility. */
  planBuildRunId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: ThreadGoal | null
  todos?: ThreadTodoList | null
}
