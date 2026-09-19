import { requestParsed } from './client-internals.js'
import {
  RoomEventsListRequestSchema,
  RoomEventsListResponseSchema,
  RoomListRequestSchema,
  RoomListResponseSchema,
  RoomMessagesListRequestSchema,
  RoomMessagesListResponseSchema,
  RoomTasksListRequestSchema,
  RoomTasksListResponseSchema,
  type RoomsApi
} from './rooms.js'
import type { HostTransport } from './services.js'

export function createRoomsApi(transport: HostTransport): RoomsApi {
  return {
    list: (request = {}) => requestParsed(
      transport, 'rooms.list', RoomListRequestSchema.parse(request), RoomListResponseSchema
    ),
    listMessages: (request) => requestParsed(
      transport, 'rooms.listMessages', RoomMessagesListRequestSchema.parse(request),
      RoomMessagesListResponseSchema
    ),
    listTasks: (request) => requestParsed(
      transport, 'rooms.listTasks', RoomTasksListRequestSchema.parse(request),
      RoomTasksListResponseSchema
    ),
    listEvents: (request) => requestParsed(
      transport, 'rooms.listEvents', RoomEventsListRequestSchema.parse(request),
      RoomEventsListResponseSchema
    )
  }
}
