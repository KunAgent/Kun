import { z } from 'zod'
import {
  RoomListRequestSchema, RoomListResponseSchema,
  RoomMessagesListRequestSchema, RoomMessagesListResponseSchema,
  RoomTasksListRequestSchema, RoomTasksListResponseSchema,
  RoomEventsListRequestSchema, RoomEventsListResponseSchema,
  type RoomListRequest, type RoomListResponse,
  type RoomMessagesListRequest, type RoomMessagesListResponse,
  type RoomTasksListRequest, type RoomTasksListResponse,
  type RoomEventsListRequest, type RoomEventsListResponse
} from '@kun/extension-api'
import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { RoomRuntime } from '../rooms/room-runtime.js'
import type { RoomTaskExecution } from '../rooms/room-runtime-types.js'
import { RoomListOptionsSchema, type RoomStore } from '../rooms/room-store.js'
import type { ExtensionPrincipal } from './extension-agent-service-contracts.js'
import { ExtensionBrokerError } from './extension-agent-service-event-usage.js'
import {
  projectRoomEvent, projectRoomMessage, projectRoomSummary, projectRoomTask,
  type ExtensionRoomAttachments
} from './extension-rooms-service-projection.js'

export const EXTENSION_ROOMS_PERMISSION = 'rooms.read'
// Leave room for the RPC envelope under its 1 MiB default message limit.
export const EXTENSION_ROOM_MESSAGE_PAGE_BYTES = 512 * 1024
export type ExtensionRoomsOperation = 'list' | 'listMessages' | 'listTasks' | 'listEvents'
export type ExtensionRoomsAuthorizationRequest = Readonly<{
  operation: ExtensionRoomsOperation
  permission: typeof EXTENSION_ROOMS_PERMISSION
}>
export interface ExtensionRoomsAuthorizer {
  authorize(principal: ExtensionPrincipal, request: ExtensionRoomsAuthorizationRequest): Promise<void> | void
}
type RoomSource = Pick<RoomRuntime, 'service'>
export type ExtensionRoomsServiceOptions = {
  rooms: RoomSource | (() => RoomSource | undefined)
  attachments?: ExtensionRoomAttachments | (() => ExtensionRoomAttachments | undefined)
  authorizer?: ExtensionRoomsAuthorizer
}

function parseRequest<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new ExtensionBrokerError('validation_error', 'Invalid rooms request')
  return parsed.data
}

/** Read-only extension projections over the same Manager-backed store as room routes. */
export class ExtensionRoomsService {
  constructor(private readonly options: ExtensionRoomsServiceOptions) {}

  async list(principal: ExtensionPrincipal, input: RoomListRequest = {}): Promise<RoomListResponse> {
    await this.authorize(principal, 'list')
    const request = parseRequest(RoomListRequestSchema, input)
    const pageOptions = parseRequest(RoomListOptionsSchema, request)
    return this.read(async (store) => {
      const page = await store.listRooms(pageOptions)
      return RoomListResponseSchema.parse({
        items: await Promise.all(page.rooms.map((row) => projectRoomSummary(store, row.value))),
        page: { hasMore: Boolean(page.nextCursor), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
      })
    })
  }

  async listMessages(
    principal: ExtensionPrincipal, input: RoomMessagesListRequest
  ): Promise<RoomMessagesListResponse> {
    await this.authorize(principal, 'listMessages')
    const request = parseRequest(RoomMessagesListRequestSchema, input)
    return this.read(async (store) => {
      await this.room(store, request.roomId)
      const rows = await store.list<RoomMessage>('message', {
        roomId: request.roomId, beforeSeq: request.cursor === undefined ? undefined : Number(request.cursor),
        limit: request.limit + 1
      })
      const attachments = typeof this.options.attachments === 'function'
        ? this.options.attachments() : this.options.attachments
      const items: RoomMessagesListResponse['items'] = []
      let bytes = 1024
      let lastSeq: number | undefined
      for (const row of rows.slice(0, request.limit)) {
        const message = await projectRoomMessage(row.value, attachments)
        const messageBytes = Buffer.byteLength(JSON.stringify(message), 'utf8') + 1
        if (bytes + messageBytes > EXTENSION_ROOM_MESSAGE_PAGE_BYTES) break
        items.push(message)
        bytes += messageBytes
        lastSeq = row.seq
      }
      return RoomMessagesListResponseSchema.parse({
        items: items.reverse(),
        page: this.page(rows.length, items.length, lastSeq)
      })
    })
  }

  async listTasks(principal: ExtensionPrincipal, input: RoomTasksListRequest): Promise<RoomTasksListResponse> {
    await this.authorize(principal, 'listTasks')
    const request = parseRequest(RoomTasksListRequestSchema, input)
    return this.read(async (store) => {
      const room = await this.room(store, request.roomId)
      const rows = await store.list<RoomTaskExecution>('task', {
        roomId: request.roomId, status: request.status,
        beforeSeq: request.cursor === undefined ? undefined : Number(request.cursor), limit: request.limit + 1
      })
      const visible = rows.slice(0, request.limit)
      return RoomTasksListResponseSchema.parse({
        items: visible.map((row) => projectRoomTask(row.value, room)),
        page: this.page(rows.length, request.limit, visible.at(-1)?.seq)
      })
    })
  }

  async listEvents(principal: ExtensionPrincipal, input: RoomEventsListRequest): Promise<RoomEventsListResponse> {
    await this.authorize(principal, 'listEvents')
    const request = parseRequest(RoomEventsListRequestSchema, input)
    return this.read(async (store) => {
      await this.room(store, request.roomId)
      const rows = await store.events(request.roomId, request.after, request.limit + 1)
      const visible = rows.slice(0, request.limit)
      return RoomEventsListResponseSchema.parse({
        items: visible.flatMap((row) => {
          const event = projectRoomEvent(row)
          return event ? [event] : []
        }),
        cursor: visible.at(-1)?.seq ?? request.after,
        hasMore: rows.length > request.limit
      })
    })
  }

  private page(count: number, limit: number, lastSeq?: number) {
    const hasMore = count > limit
    return { hasMore, ...(hasMore && lastSeq !== undefined ? { nextCursor: String(lastSeq) } : {}) }
  }

  private async room(store: RoomStore, roomId: string): Promise<Room> {
    const row = await store.get<Room>('room', roomId)
    if (!row) throw new ExtensionBrokerError('not_found', 'Room not found')
    return row.value
  }

  private async authorize(principal: ExtensionPrincipal, operation: ExtensionRoomsOperation): Promise<void> {
    // A custom policy can narrow access, but never bypass the manifest permission.
    if (!principal.permissions.includes(EXTENSION_ROOMS_PERMISSION)) {
      throw new ExtensionBrokerError('permission_denied', `Missing permission: ${EXTENSION_ROOMS_PERMISSION}`)
    }
    try {
      await this.options.authorizer?.authorize(principal, { operation, permission: EXTENSION_ROOMS_PERMISSION })
    } catch (error) {
      if (error instanceof ExtensionBrokerError) throw error
      throw new ExtensionBrokerError('permission_denied', 'Rooms access denied')
    }
  }

  private async read<T>(operation: (store: RoomStore) => Promise<T>): Promise<T> {
    try {
      const rooms = typeof this.options.rooms === 'function' ? this.options.rooms() : this.options.rooms
      if (!rooms) throw new ExtensionBrokerError('conflict', 'Room data is temporarily unavailable')
      return await operation(rooms.service.store)
    } catch (error) {
      if (error instanceof ExtensionBrokerError) throw error
      // Manager/storage errors may include local paths, endpoint credentials or raw documents.
      throw new ExtensionBrokerError('conflict', 'Room data is temporarily unavailable')
    }
  }
}
