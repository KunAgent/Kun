import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RoomMessage } from '../../contracts/rooms.js'
import { RoomIdSchema } from '../../contracts/rooms.js'
import { RoomStoreConflictError } from '../../rooms/room-store.js'
import { isHiddenRoomGoogleApp } from '../../contracts/room-app-catalog.js'
import { dispatchRoomContinuation } from '../../rooms/room-continuation-dispatch.js'
import { markRoomAppConnectionResumed, roomAppConnectionMessage, setRoomAppConnectionStatus } from '../../rooms/room-app-connections.js'
import type { RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import type { ServerRuntime } from './server-runtime.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown) => void

async function requestBody(request: Request) {
  const body = await readJsonBody(request)
  if (!body.ok) throw new z.ZodError([{ code: 'custom', path: [], message: 'invalid app connection request body' }])
  return z.object({ clientRequestId: RoomIdSchema }).strict().parse(body.value)
}

export function registerRoomAppConnectionRoutes(add: Add, runtime: ServerRuntime): void {
  for (const action of ['complete', 'skip'] as const) {
    add('POST', `/v1/rooms/:roomId/app-connections/:messageId/${action}`, async (rooms, request, { params }) => {
      await requestBody(request)
      const room = await rooms.service.get(params.roomId)
      if (room.conversationKind !== 'user_agent') throw new RoomStoreConflictError('app connection requires a private Agent room')
      const messageId = RoomIdSchema.parse(params.messageId)
      const before = await roomAppConnectionMessage(rooms.deps.store, params.roomId, messageId)
      const serverId = before.row.value.appConnection!.serverId
      const hiddenGoogleApp = isHiddenRoomGoogleApp(serverId)
      if (action === 'complete') {
        if (hiddenGoogleApp && before.row.value.appConnection!.status === 'requested') {
          throw new RoomStoreConflictError('This app is unavailable in private Rooms; skip the connection to continue')
        }
        if (!hiddenGoogleApp && (!runtime.mcpConfig || !runtime.mcpOAuth || !runtime.toolDiagnostics)) {
          throw new RoomStoreConflictError('app connection status is unavailable')
        }
        if (!hiddenGoogleApp) {
          if (!runtime.mcpConfig!().servers[serverId]?.enabled) throw new RoomStoreConflictError('app is not enabled in Kun')
          const oauth = await runtime.mcpOAuth!()
          if (!oauth.some((item) => item.serverId === serverId && item.status === 'authorized')) {
            throw new RoomStoreConflictError('app authorization has not completed')
          }
          const tools = await runtime.toolDiagnostics!()
          if (!tools.mcpServers?.some((item) => item.id === serverId && item.status === 'connected')) {
            throw new RoomStoreConflictError('app tools are not connected yet')
          }
        }
      }
      let message = await rooms.exclusive(() => setRoomAppConnectionStatus(rooms.deps.store,
        params.roomId, messageId, action === 'complete' ? 'connected' : 'skipped'))
      if (!message.appConnection?.resumed) {
        const { run } = await roomAppConnectionMessage(rooms.deps.store, params.roomId, messageId)
        const prompt = hiddenGoogleApp
          ? `App ${serverId} is unavailable in this private Room. Continue the original task without its tools and explain any limitation.`
          : action === 'complete'
          ? `The user connected app ${serverId} through Kun. Continue the original task using its tools. Do not repeat completed external actions.`
          : `The user skipped connecting app ${serverId}. Continue the original task without that app. Do not claim access; explain any limitation.`
        const outcome = await dispatchRoomContinuation(rooms.deps.threadStore, {
          threadId: run.value.threadId!, sourceTurnId: run.value.turnId!,
          kind: 'app_connection', key: messageId, prompt
        })
        if (outcome === 'queued') message = await rooms.exclusive(() =>
          markRoomAppConnectionResumed(rooms.deps.store, params.roomId, messageId))
      }
      return { message: message as RoomMessage, resumed: message.appConnection?.resumed === true }
    })
  }
}
