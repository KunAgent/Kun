import { z } from 'zod'
import { Router } from '../server/router.js'
import { readJsonBody } from '../server/read-json-body.js'
import { jsonResponse } from '../server/response.js'
import {
  RoomDocumentKindSchema,
  RoomStoreCommitSchema,
  RoomStoreConflictError,
  RoomStoreListOptionsSchema,
  RoomListOptionsSchema
} from '../rooms/room-store.js'
import { RoomOutcomeQuerySchema } from '../rooms/room-store.js'
import { RoomSearchQuerySchema, RoomRunSummaryQuerySchema } from '../contracts/room-experience.js'
import type { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import {
  ManagerResourceFenceSchema,
  ResourceFenceStaleError,
  type ManagerResourceFence
} from './resource-lease-state.js'
import { authorizedAsync, validation } from './service-manager-router-auth.js'
import { MAX_MANAGER_DATA_BODY_BYTES, type ServiceManagerState } from './service-manager-state.js'
import { resourceFenceStale } from './service-manager-router-fenced-mutation.js'
import { isManagerPersistenceDegraded, managerPersistenceDegradedResponse } from './service-manager-router-persistence.js'

export const ROOM_COORDINATOR_RESOURCE = 'rooms-coordinator'
const Id = z.string().min(1).max(256)
const Operations = z.enum(['get', 'list', 'listRooms', 'replyPage', 'searchRooms', 'roomRepositories', 'runSummary',
  'commit', 'getRequest', 'events', 'latestEventSeq', 'eventScope', 'requestOutcomes', 'assertOwnership'])

export function addManagerRoomRoutes(router: Router, input: {
  managerToken: string
  state: ServiceManagerState
  roomStore: SqliteRoomStore
  statePersistence?: () => { degraded: boolean }
}): void {
  router.add('POST', '/v1/data/room/:operation', (request, context) => authorizedAsync(
    request, input.managerToken, async () => {
      const operation = Operations.safeParse(context.params.operation)
      if (!operation.success) return validation('invalid room-store operation')
      if (operation.data === 'commit' && isManagerPersistenceDegraded(input.statePersistence)) {
        return managerPersistenceDegradedResponse()
      }
      const body = await readJsonBody(request, MAX_MANAGER_DATA_BODY_BYTES)
      if (!body.ok) return body.response
      const assertCurrent = (fence: ManagerResourceFence): void => {
        if (fence.resource !== ROOM_COORDINATOR_RESOURCE ||
          input.state.registration(fence.ownerFlavor)?.instanceId !== fence.ownerInstanceId) {
          throw new ResourceFenceStaleError()
        }
        input.state.assertResource(fence)
      }
      try {
        let result: unknown
        switch (operation.data) {
          case 'replyPage': {
            const value = z.object({ roomId: Id, messageId: Id,
              beforeSeq: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(100).optional() }).strict().parse(body.value)
            result = await input.roomStore.replyPage(value); break
          }
          case 'searchRooms': result = await input.roomStore.searchRooms(RoomSearchQuerySchema.parse(body.value)); break
          case 'roomRepositories': z.object({}).strict().parse(body.value); result = await input.roomStore.roomRepositories(); break
          case 'runSummary': result = await input.roomStore.runSummary(RoomRunSummaryQuerySchema.parse(body.value)); break
          case 'latestEventSeq': result = await input.roomStore.latestEventSeq(); break
          case 'eventScope': result = await input.roomStore.eventScope(); break
          case 'requestOutcomes': result = await input.roomStore.requestOutcomes(RoomOutcomeQuerySchema.parse(body.value)); break
          case 'get': {
            const value = z.object({ kind: RoomDocumentKindSchema, id: Id }).strict().parse(body.value)
            result = await input.roomStore.get(value.kind, value.id)
            break
          }
          case 'list': {
            const value = z.object({ kind: RoomDocumentKindSchema, options: RoomStoreListOptionsSchema.optional() })
              .strict().parse(body.value)
            result = await input.roomStore.list(value.kind, value.options)
            break
          }
          case 'getRequest': {
            const value = z.object({ requestId: Id }).strict().parse(body.value)
            result = await input.roomStore.getRequest(value.requestId)
            break
          }
          case 'listRooms': {
            const value = z.object({ options: RoomListOptionsSchema.optional() }).strict().parse(body.value)
            result = await input.roomStore.listRooms(value.options)
            break
          }
          case 'events': {
            const value = z.object({ roomId: Id, sinceSeq: z.number().int().nonnegative().default(0),
              limit: z.number().int().min(1).max(1000).default(200) }).strict().parse(body.value)
            result = await input.roomStore.events(value.roomId, value.sinceSeq, value.limit)
            break
          }
          case 'commit': {
            const value = z.object({ input: RoomStoreCommitSchema, fence: ManagerResourceFenceSchema.optional() })
              .strict().parse(body.value)
            if (!value.fence && value.input.puts.some((put) => (put.kind.startsWith('peer_') ||
              ['agent_identity', 'agent_mapping', 'agent_bootstrap', 'agent_features', 'agent_handoff', 'agent_memory_job', 'agent_budget', 'agent_budget_claim', 'room_run', 'room_poll', 'room_reactions', 'room_avatar'].includes(put.kind)))) {
              throw new ResourceFenceStaleError()
            }
            if (value.fence) assertCurrent(value.fence)
            result = await input.roomStore.commit(value.input,
              value.fence ? () => assertCurrent(value.fence!) : undefined)
            break
          }
          case 'assertOwnership': {
            const value = z.object({ fence: ManagerResourceFenceSchema }).strict().parse(body.value)
            assertCurrent(value.fence)
            result = true
            break
          }
        }
        return jsonResponse({ result })
      } catch (error) {
        if (error instanceof z.ZodError) return validation('invalid room-store request', error.issues)
        if (error instanceof ResourceFenceStaleError) return resourceFenceStale()
        if (error instanceof RoomStoreConflictError) return jsonResponse({
          code: 'room_store_conflict', message: error.message, currentRevision: error.currentRevision
        }, 409)
        throw error
      }
    }
  ))
}
