import type { ApprovalPolicy, ApprovalReviewer, SandboxMode } from '@shared/app-settings'
import type { RoomThreadSource, ThreadWorkbenchOrigin } from '@shared/rooms-api'
import type { KnowledgeBaseMount, ThreadGoal, ThreadTodoList } from './types'

export type NormalizedThread = {
  historyRefId?: string
  roomContext?: RoomThreadSource
  /** A bot Agent started this session on the user's behalf (host-written, immutable). */
  workbenchOrigin?: ThreadWorkbenchOrigin
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
  additionalWorkspaces?: string[]
  knowledgeBases?: KnowledgeBaseMount[]
  status?: string
  latestSeq?: number
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  approvalReviewer?: ApprovalReviewer
  /** Whether future model requests are retained for Agent Perspective. */
  modelRequestCaptureEnabled?: boolean
  /** Owning workspace mode; absent counts as 'code'. Immutable after create. */
  workspaceMode?: 'code' | 'ade'
  /** Persistent Kun-managed team policy; legacy ADE can omit it. */
  collaboration?: { enabled: boolean; everEnabled?: boolean }
  executionConfig?: import('@shared/ade-execution-config').AdeExecutionConfigSnapshot
  /** Optional provider id when this thread is pinned to a non-default provider. */
  providerId?: string
  /** Explicit harness identity inherited by new turns (01 §4). */
  harnessId?: string
  /** Host-managed task workspace bound to this thread (07 §5). */
  taskWorkspaceId?: string
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
  /** Host-written ADE worker binding (09 §3.1); absent for normal threads. */
  executionUnit?: {
    kind: 'worker'
    teamId: string
    managerThreadId: string
    label: string
    role?: string
    lifecycle: 'persistent' | 'ephemeral'
    taskWorkspaceId?: string
    control: 'manager' | 'user'
  }
  /** Legacy plan-build linkage retained for read-only history compatibility. */
  planBuildRunId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  forkedFromTurnId?: string
  goal?: ThreadGoal | null
  todos?: ThreadTodoList | null
}
