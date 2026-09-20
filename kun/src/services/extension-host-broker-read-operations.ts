import { z } from 'zod'
import {
  AgentCapacitySnapshotSchema, RoomListRequestSchema, RoomMessagesListRequestSchema,
  RoomTasksListRequestSchema, RoomEventsListRequestSchema
} from '@kun/extension-api'
import type { ExtensionHostBrokerOptions } from './extension-host-broker.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionBrokerError } from './extension-agent-service.js'
import type { JsonValue } from '../extensions/types.js'

const EmptyRequestSchema = z.strictObject({})

/** Read-only cross-surface projections; owned thread APIs keep their own policy. */
export async function dispatchExtensionRead(
  options: ExtensionHostBrokerOptions,
  principal: ExtensionPrincipal,
  method: string,
  params: JsonValue
): Promise<unknown> {
  if (method === 'agent.capacity') {
    EmptyRequestSchema.parse(params)
    return AgentCapacitySnapshotSchema.parse(await options.agent.capacity(principal))
  }
  // Check the scope even when a host has no Rooms composition available.
  if (!principal.permissions.includes('rooms.read')) {
    throw new ExtensionBrokerError('permission_denied', 'Missing extension permission: rooms.read')
  }
  const rooms = options.rooms
  if (!rooms) throw new ExtensionBrokerError('conflict', 'Room data is temporarily unavailable')
  switch (method) {
    case 'rooms.list': return rooms.list(principal, RoomListRequestSchema.parse(params))
    case 'rooms.listMessages': return rooms.listMessages(principal, RoomMessagesListRequestSchema.parse(params))
    case 'rooms.listTasks': return rooms.listTasks(principal, RoomTasksListRequestSchema.parse(params))
    case 'rooms.listEvents': return rooms.listEvents(principal, RoomEventsListRequestSchema.parse(params))
    default: throw new Error('Unsupported read-only extension method')
  }
}
