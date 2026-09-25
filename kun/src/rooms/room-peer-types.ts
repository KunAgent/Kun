import type { Room, RoomMessage, SendRoomMessage } from '../contracts/rooms.js'
import type { RoomStoredDocument } from './room-store.js'
import type { UsageSnapshot } from '../contracts/usage.js'

export const ROOM_PEER_LIMITS = { responses: 32, memberResponses: 8, triages: 128 } as const
export const ROOM_PEER_HOLD_LIMITS = { maxUpdates: 6, maxHolds: 2 } as const

export type RoomPeerRequestInput = {
  id: string
  roomId: string
  rootRequestId?: string
  collaborationProtocol?: 'legacy' | 'peer'
  peerLatestRequestId?: string
  sourceMessageId: string
  roomSnapshot: Room
  message: SendRoomMessage
  status: string
  cancellationRequested?: boolean
}

export type RoomPeerTopic = {
  roomId: string
  rootRequestId: string
  requestId: string
  sourceMessageId: string
  generation: number
  title: string
  publicationRevision: number
  status: 'active' | 'idle' | 'paused' | 'stopping' | 'stopped'
  pauseReason?: string
  responseCount: number
  triageCount: number
  memberResponses: Record<string, number>
  memberIds: string[]
  roomSnapshot: Room
  createdAt: string
  updatedAt: string
}

export type RoomPeerInboxItem = {
  roomId: string
  rootRequestId: string
  memberId: string
  generation: number
  sourceKind: 'message' | 'invitation' | 'task'
  sourceId: string
  sourceRevision: number
  causeId: string
  messageId?: string
  taskId?: string
  body: string
  authorMemberId?: string
  createdAt: string
}

export type RoomPeerActivation = {
  threadId: string
  turnId?: string
  admissionAttempted?: boolean
  usageSinceSeq?: number
  usageBaseline?: UsageSnapshot
  clientRequestId: string
  contextId: string
  seenItems: Array<{ id: string; sourceId: string; sourceRevision: number; seq: number }>
  seenThroughSeq: number
  basePublicationRevision: number
  holds?: number
  generation: number
  attempt: number
  phase: 'triage' | 'respond'
}

export type RoomPeerMemberState = {
  roomId: string
  rootRequestId: string
  memberId: string
  generation: number
  state: 'pending' | 'triaging' | 'responding' | 'idle' | 'failed' | 'recovery_required'
  seenInboxSeq: number
  handledInboxSeq: number
  activation?: RoomPeerActivation
  lastError?: string
  waitingReason?: string
  attempt?: number
  retryCount?: number
  retryAt?: string
  invitedByMemberId?: string
  updatedAt: string
}

export type RoomPeerUpdates = {
  topic: RoomStoredDocument<RoomPeerTopic>
  member: RoomStoredDocument<RoomPeerMemberState>
  items: RoomStoredDocument<RoomPeerInboxItem>[]
}

export type RoomPeerBeginInput = Pick<RoomPeerActivation,
  'threadId' | 'clientRequestId' | 'contextId' | 'attempt' | 'phase' | 'generation'> & {
  itemIds: string[]
  basePublicationRevision: number
}

export type RoomPeerPublishInput = {
  rootRequestId: string
  memberId: string
  clientRequestId: string
  activationClientRequestId: string
  body: string
  mentionMemberIds?: string[]
  inviteMemberIds?: string[]
  replyToMessageId?: string
}

export type RoomPeerPublishResult = {
  status: 'published' | 'duplicate' | 'stale' | 'stopped' | 'budget_exhausted'
  message?: RoomMessage
}

export type RoomPeerTopicSummary = RoomPeerTopic & {
  revision: number
  pendingCount: number
  requestStatus?: string
  members: Array<{
    memberId: string
    state: RoomPeerMemberState['state']
    pendingCount: number
    seenInboxSeq: number
    handledInboxSeq: number
    responseCount: number
    currentRunId?: string
    error?: string
    waitingReason?: string
    invitedByMemberId?: string
  }>
}
