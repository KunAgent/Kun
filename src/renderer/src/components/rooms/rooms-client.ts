import type {
  CreateRoomRequest,
  Room,
  RoomDelivery,
  RoomMessage,
  RoomReview,
  RoomRequestOutcome,
  RoomTask,
  RoomTaskAction,
  SendRoomMessage
} from '@shared/rooms-api'
import { rendererRuntimeClient } from '../../agent/runtime-client'

export type RoomInput = Omit<CreateRoomRequest, 'clientRequestId'>
export type RoomRepositoryInput = NonNullable<RoomInput['repositories']>[number]
export type RoomPatch = Partial<RoomInput> & {
  pinned?: boolean
  archived?: boolean
}
export type RoomTaskDetail = {
  approvals?: Array<{ id: string; toolName: string; summary: string }>
  userInputs?: RoomUserInput[]
  task: RoomTask
  controlThreadId?: string
  delivery?: RoomDelivery
  workspace?: { path: string; branch?: string }
  diff?: string
  reviews: RoomReview[]
}
export type RoomListEntry = Room & {
  latestMessageSeq?: number
  readSeq?: number
  runningCount?: number
  attentionCount?: number
}
export type RoomUserInput = {
  id: string
  prompt: string
  questions: Array<{
    id: string
    question: string
    options: Array<{ label: string; description: string }>
    selectionMode?: 'single' | 'multiple'
    minSelections?: number
    maxSelections?: number
  }>
}
export type RoomPreset = {
  id: string
  name: string
  description?: string
  model?: string
  providerId?: string
  toolPolicy?: string
  allowedTools?: string[]
  blockedTools?: string[]
  blockedMcpServers?: string[]
  blockedSkills?: string[]
  skillsEnabled?: boolean
  available?: boolean
  reason?: string
}
export type RoomPresetCatalog = {
  presets: RoomPreset[]
  defaultModel?: { model: string; providerId?: string }
  unsupportedProviderIds?: string[]
}
export type RoomRequestEntry = {
  id: string
  revision: number
  status: string
  sourceMessageId: string
  message: { body: string }
  error?: string
  outcome?: RoomRequestOutcome
}
export type RoomRule = {
  id: string
  messageId: string
  body: string
  version: number
  active?: boolean
  revision?: number
}
export type RoomPage<T> = { nextCursor?: string | null } & T

export const roomPath = (id: string): string =>
  `/v1/rooms/${encodeURIComponent(id)}`
export const roomTaskPath = (task: Pick<RoomTask, 'roomId' | 'id'>): string =>
  `${roomPath(task.roomId)}/tasks/${encodeURIComponent(task.id)}`
export const roomRequestId = (): string => crypto.randomUUID()

export async function roomsRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const result = await rendererRuntimeClient.runtimeRequest(
    path,
    method,
    body === undefined ? undefined : JSON.stringify(body),
    { signal, priority: method === 'GET' ? 'background' : 'foreground' }
  )
  let value: { error?: { message?: string } | string; message?: string } = {}
  try {
    value = JSON.parse(result.body)
  } catch {
    throw new Error(`Invalid Rooms response (${result.status})`)
  }
  if (!result.ok) {
    throw new Error(
      typeof value.error === 'string'
        ? value.error
        : (value.error?.message ??
            value.message ??
            `Rooms request failed (${result.status})`)
    )
  }
  return value as T
}

export const roomsClient = {
  list: (
    archived: boolean,
    cursor?: string,
    signal?: AbortSignal,
    search = ''
  ) =>
    roomsRequest<RoomPage<{ rooms: RoomListEntry[] }>>(
      `/v1/rooms?limit=50&archived_only=${archived}&search=${encodeURIComponent(search)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      'GET',
      undefined,
      signal
    ),
  get: (id: string, signal?: AbortSignal) =>
    roomsRequest<{ room: Room }>(roomPath(id), 'GET', undefined, signal),
  create: (input: RoomInput, clientRequestId: string) =>
    roomsRequest<{ room: Room }>('/v1/rooms', 'POST', {
      ...input,
      clientRequestId
    }),
  update: (room: Room, patch: RoomPatch, clientRequestId = roomRequestId()) =>
    roomsRequest<{ room: Room }>(roomPath(room.id), 'PATCH', {
      ...patch,
      expectedRevision: room.revision,
      clientRequestId
    }),
  messages: (id: string, cursor?: string, signal?: AbortSignal) =>
    roomsRequest<RoomPage<{ messages: RoomMessage[] }>>(
      `${roomPath(id)}/messages?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      'GET',
      undefined,
      signal
    ),
  send: (id: string, input: SendRoomMessage) =>
    roomsRequest<{ message: RoomMessage }>(
      `${roomPath(id)}/messages`,
      'POST',
      input
    ),
  tasks: (
    id: string,
    signal?: AbortSignal,
    cursor?: string,
    filters?: { status?: string; memberId?: string; repositoryId?: string }
  ) =>
    roomsRequest<RoomPage<{ tasks: RoomTask[] }>>(
      `${roomPath(id)}/tasks?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}${filters?.status ? `&status=${encodeURIComponent(filters.status)}` : ''}${filters?.memberId ? `&member_id=${encodeURIComponent(filters.memberId)}` : ''}${filters?.repositoryId ? `&repository_id=${encodeURIComponent(filters.repositoryId)}` : ''}`,
      'GET',
      undefined,
      signal
    ),
  task: (id: string, taskId: string, signal?: AbortSignal) =>
    roomsRequest<RoomTaskDetail>(
      `${roomPath(id)}/tasks/${encodeURIComponent(taskId)}`,
      'GET',
      undefined,
      signal
    ),
  act: (task: RoomTask, action: RoomTaskAction, clientRequestId: string) =>
    roomsRequest<RoomTaskDetail>(
      `${roomPath(task.roomId)}/tasks/${encodeURIComponent(task.id)}/${action}`,
      'POST',
      { expectedRevision: task.revision, clientRequestId }
    ),
  presets: () => roomsRequest<RoomPresetCatalog>('/v1/rooms/presets'),
  rules: (id: string, signal?: AbortSignal) =>
    roomsRequest<{ rules: RoomRule[] }>(
      `${roomPath(id)}/rules`,
      'GET',
      undefined,
      signal
    ),
  pinMessage: (id: string, messageId: string, clientRequestId: string) =>
    roomsRequest<{ rule: RoomRule }>(`${roomPath(id)}/rules`, 'POST', {
      messageId,
      clientRequestId
    })
}

export function mergeRoomMessages(
  existing: RoomMessage[],
  incoming: RoomMessage[]
): RoomMessage[] {
  const byId = new Map(existing.map((message) => [message.id, message]))
  for (const message of incoming) {
    const current = byId.get(message.id)
    if (!current || message.bodyRevision >= current.bodyRevision)
      byId.set(message.id, message)
  }
  return Array.from(byId.values()).sort((a, b) => a.messageSeq - b.messageSeq)
}
