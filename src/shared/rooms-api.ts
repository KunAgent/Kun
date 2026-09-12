// Type-only aliases keep the desktop and HTTP contracts in sync without
// bundling runtime implementation code in the renderer.
export type {
  Room,
  RoomMember,
  RoomRepository,
  RoomMessage,
  SendRoomMessage
} from '../../kun/src/contracts/rooms'
export type { RoomTask } from '../../kun/src/contracts/room-tasks'
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
