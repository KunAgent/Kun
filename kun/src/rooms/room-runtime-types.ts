import type { Room, RoomMember, SendRoomMessage } from '../contracts/rooms.js'
import type { RoomTask } from '../contracts/room-tasks.js'
import type { RoomDelivery } from '../contracts/room-deliveries.js'
import type { RoomContextSnapshot } from '../contracts/rooms-product.js'
import type { ThreadService } from '../services/thread-service.js'
import type { TurnService } from '../services/turn-service.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { UserInputGate } from '../ports/user-input-gate.js'
import type { RoomStore } from './room-store.js'
import type { RoomRepositoryObservation } from './task-workspace-service.js'
import type { SubagentProfileConfig } from '../contracts/capabilities-core.js'
import type { ArtifactStore } from '../artifacts/artifact-store.js'

export type RoomRequestState = {
  handoffReturnId?: string
  taskParticipants?: RoomMember[]
  pollInvitation?: import('../contracts/room-interactions.js').RoomPollInvitation
  id: string
  roomId: string
  rootRequestId?: string
  collaborationProtocol?: 'legacy' | 'peer'
  peerLatestRequestId?: string
  peerCoordinationDone?: boolean
  status: 'pending' | 'running' | 'completed' | 'needs_input' | 'failed' | 'stopping' | 'cancelled' | 'recovery_required'
  message: SendRoomMessage
  sourceMessageId: string
  roomSnapshot: Room
  threadId: string
  turnId?: string
  admissionAttempted?: boolean
  error?: string
  round?: number
  stage?: 'coordinate' | 'discuss'
  stepAttempt?: number
  resultRepairs?: number
  repairInstruction?: string
  contextId?: string
  continuation?: number
  originalMessage?: SendRoomMessage
  originalSourceMessageId?: string
  clarification?: string
  cancellationRequested?: boolean
  previousDiscussions?: NonNullable<RoomRequestState['discussions']>
  discussionHistoryTruncated?: boolean
  compressionId?: string
  contextState?: 'compressing' | 'ready'
  summaryThreadId?: string
  ruleAdoption?: import('../contracts/rooms-product.js').RoomRule
  discussions?: Array<{ memberId: string; threadId: string; turnId?: string; admissionAttempted?: boolean; response?: string; error?: string; attempt?: number; round?: number; continuation?: number; sourceMessageId?: string; messageId?: string }>
  referencedTask?: { task: RoomTask; requirement: string; delivery?: RoomDelivery; diffExcerpt?: string }
}
export type RoomWorkspace = {
  id: string
  roomId: string
  taskId: string
  path: string
  branch: string
  baseRevision: string
  repository: RoomRepositoryObservation
  state: 'reserved' | 'ready'
}
export type RoomTaskExecution = {
  sharedMessageIds?: string[]
  task: RoomTask
  prompt: string
  attachmentIds: string[]
  dependencyTaskIds: string[]
  dependencyDeliveries?: Array<{ taskId: string; deliveryId: string; versionHash: string; summary: string }>
  turnId?: string
  attempt: number
  reworkRounds: number
  reviewer?: RoomMember
  reviewThreadId?: string
  reviewTurnId?: string
  completedReviewRunId?: string
  configuration: SubagentProfileConfig | null
  reviewerConfiguration?: SubagentProfileConfig | null
  reviewRequest?: { body: string; attachmentIds: string[] }
  reviewRepairs?: number
  recoveryResolved?: boolean
  abandoned?: boolean
  previousExecutionThreadIds?: string[]
  ruleAdoptions?: Array<{ ruleId: string; version: number; requestId: string; active: boolean }>
  rulesSnapshot?: unknown[]
  agreements?: import('../contracts/rooms-product.js').RoomAgreementContext
  contextSnapshot?: RoomContextSnapshot
}
export type RoomRuntimeDeps = {
  discussionFairness?: import('../agents/agent-discussion-fairness.js').AgentDiscussionFairness
  agentDirectory?: import('../agents/agent-identity-service.js').AgentIdentityService
  agentHandoffs?: import('../agents/agent-handoff-service.js').AgentHandoffService
  agentMemory?: import('../agents/agent-memory-service.js').AgentMemoryService
  memoryStore?: import('../memory/memory-store.js').MemoryStore
  memoryEnabled?: () => boolean
  validateAgentAvatars?: (members: RoomMember[]) => Promise<void>
  artifacts?: ArtifactStore
  store: RoomStore
  threads: ThreadService
  threadStore: ThreadStore
  turns: TurnService
  sessions: SessionStore
  approvals: ApprovalGate
  inputs: UserInputGate
  runTurn: (threadId: string, turnId: string) => Promise<unknown>
  dataDir: string
  model: () => { model: string; providerId?: string }
  profiles: () => Record<string, SubagentProfileConfig>
  peerModels?: {
    client: import('../ports/model-client.js').ModelClient
    roles: () => import('../config/kun-config.js').RolesConfig | undefined
  }
  assertOwnership: () => Promise<void>
  proveStopped?: (threadId: string, turnId?: string) => Promise<boolean>
  unsupportedProviderIds?: () => string[]
  backgroundExecutionActive?: (threadId: string) => boolean
  stopBackgroundExecution?: (threadId: string) => Promise<void>
}
