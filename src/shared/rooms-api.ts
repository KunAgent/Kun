// Type-only aliases keep the desktop and HTTP contracts in sync without
// bundling runtime implementation code in the renderer.
export type { RoomContentReference, RoomAvatarReference, RoomContentResult,
  RoomContentOpenTarget, RoomLinkPreview, RoomPreviewImage } from '../../kun/src/contracts/room-content'
export type { RoomPoll, RoomPollInvitation, RoomMessageReactions,
  RoomMessageInteractions } from '../../kun/src/contracts/room-interactions'
export type { RoomReplyPage, RoomReplyPageInput } from '../../kun/src/contracts/room-replies'
export type { RoomNotificationPreference, RoomPreferenceDetail, RoomSearchQuery, RoomSearchHit,
  RoomSearchPage, RoomRepositoryChoice, RoomRunSummary, RoomRunSummaryQuery } from '../../kun/src/contracts/room-experience'
export type {
  RoomRunDetail, RoomRunAvailability, RoomRunContentPage, RoomRunItemsPage,
  RoomRunListPage, RoomMessageRunSource, RoomRunEvent
} from '../../kun/src/contracts/room-run-query'
export type {
  Room,
  RoomMember,
  RoomRepository,
  RoomMessage,
  SendRoomMessage
} from '../../kun/src/contracts/rooms'
export type { RoomTask } from '../../kun/src/contracts/room-tasks'
export type { RoomLatestMessage, RoomListEntry } from '../../kun/src/contracts/room-list'
export type {
  RoomDelivery,
  RoomReview
} from '../../kun/src/contracts/room-deliveries'
export type { CreateRoomRequest } from '../../kun/src/contracts/rooms-api'
export type { RoomPeerTopicSummary } from '../../kun/src/rooms/room-peer-types'
export type {
  RoomRule,
  RoomAgreementContext,
  RoomRecoveryInfo,
  RoomRequestOutcome,
  RoomIntegration,
  RoomCleanupPreview
} from '../../kun/src/contracts/rooms-product'

export type RoomThreadSource = {
  roomId: string
  taskId?: string
  memberId: string
  kind: 'coordination' | 'discussion' | 'execution' | 'review'
}

export const ROOM_ENDPOINTS = {
  list: '/v1/rooms',
  presets: '/v1/rooms/presets',
  attention: '/v1/rooms/attention',
  allEvents: '/v1/rooms/events',
  room: '/v1/rooms/{roomId}',
  messages: '/v1/rooms/{roomId}/messages',
  tasks: '/v1/rooms/{roomId}/tasks',
  task: '/v1/rooms/{roomId}/tasks/{taskId}',
  events: '/v1/rooms/{roomId}/events',
  rules: '/v1/rooms/{roomId}/rules',
  requests: '/v1/rooms/{roomId}/requests',
  search: '/v1/rooms/{roomId}/search',
  read: '/v1/rooms/{roomId}/read',
  recovery: '/v1/rooms/{roomId}/tasks/{taskId}/recovery',
  deliveries: '/v1/rooms/{roomId}/tasks/{taskId}/deliveries',
  integrations: '/v1/rooms/{roomId}/tasks/{taskId}/integrations',
  cleanup: '/v1/rooms/{roomId}/tasks/{taskId}/cleanup'
} as const

export const ROOM_TASK_ACTIONS = [
  'cancel',
  'retry',
  'accept',
  'apply',
  'review',
  'retry-review'
] as const
export type RoomTaskAction = (typeof ROOM_TASK_ACTIONS)[number]

export type { RoomRunRecord, RoomRunPhase, RoomRunStatus } from '../../kun/src/contracts/room-runs'

export type { AgentIdentity, AgentPage, AgentFeatures } from '../../kun/src/contracts/agent-identities'

export type { AgentHandoff } from '../../kun/src/contracts/agent-handoffs'

export type { OnboardingState, RoomUserProfileDetail } from '../../kun/src/contracts/room-onboarding'
export type { RoomSidebarEntry, RoomSidebarPage, RoomSidebarQuery } from '../../kun/src/contracts/room-sidebar'

export type { AgentModelBinding } from '../../kun/src/agents/agent-models'
export type AgentModelOptions = Awaited<ReturnType<typeof import('../../kun/src/agents/agent-models').agentModelOptions>>
export type AgentChatEntry = Awaited<ReturnType<typeof import('../../kun/src/agents/agent-chat-entry').chatEntryState>>
export type AgentDirectActivity = Awaited<ReturnType<typeof import('../../kun/src/agents/agent-direct-service').directActivity>>

export type { RoomPermissionRequest, RoomExecutionPolicy } from '../../kun/src/contracts/room-permissions'
export type RoomPermissionState = Awaited<ReturnType<typeof import('../../kun/src/agents/agent-permissions').agentPermissions>>
