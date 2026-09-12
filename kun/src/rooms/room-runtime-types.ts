import type { Room, RoomMember, SendRoomMessage } from '../contracts/rooms.js'
import type { RoomTask } from '../contracts/room-tasks.js'
import type { RoomDelivery } from '../contracts/room-deliveries.js'
import type { ThreadService } from '../services/thread-service.js'
import type { TurnService } from '../services/turn-service.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { UserInputGate } from '../ports/user-input-gate.js'
import type { RoomStore } from './room-store.js'
import type { RoomRepositoryObservation } from './task-workspace-service.js'
import type { SubagentProfileConfig } from '../contracts/capabilities-core.js'

export type RoomRequestState = {
  id: string
  roomId: string
  status: 'pending' | 'running' | 'completed' | 'needs_input' | 'failed'
  message: SendRoomMessage
  sourceMessageId: string
  roomSnapshot: Room
  threadId: string
  turnId?: string
  error?: string
  round?: number
  stage?: 'coordinate' | 'discuss'
  discussions?: Array<{ memberId: string; threadId: string; turnId?: string; response?: string }>
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
  rulesSnapshot?: unknown[]
}
export type RoomRuntimeDeps = {
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
  assertOwnership: () => Promise<void>
}
