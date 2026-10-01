import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { LocalTool } from '../adapters/tool/local-tool-host.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { ROOM_APP_CATALOG, canonicalRoomAppId, isHiddenRoomGoogleApp } from '../contracts/room-app-catalog.js'
import { RoomMessageSchema, type Room, type RoomMessage } from '../contracts/rooms.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { agentStableId } from '../agents/agent-identity-service.js'
import { roomPeerStoreBinding } from './room-peer-tools.js'
import { roomRunId, attachRoomRunPublication } from './room-run-recording.js'
import { roomRunSegmentMessageId } from './room-run-segments.js'
import type { RoomStoreCommit } from './room-store.js'
import { ROOM_AX_TOOL_DESCRIPTIONS } from './room-ax-surfaces.js'

export const ROOM_IM_APPS = { 'im.feishu': 'Feishu / Lark', 'im.weixin': 'WeChat (Tencent channel)' } as const
export const isRoomImApp = (id: string): id is keyof typeof ROOM_IM_APPS => Object.hasOwn(ROOM_IM_APPS, id)

export const LIST_ROOM_APPS_TOOL_NAME = 'list_room_apps'
export const REQUEST_APP_CONNECTION_TOOL_NAME = 'request_app_connection'
export const ROOM_APP_TOOL_NAMES = [LIST_ROOM_APPS_TOOL_NAME, REQUEST_APP_CONNECTION_TOOL_NAME] as const

type AppAccess = { servers: Record<string, { enabled: boolean; oauth?: { enabled?: boolean } }>; statuses: Record<string, string> }
const accessBindings = new WeakMap<ThreadStore, () => AppAccess>()
export function bindRoomAppAccess(threads: ThreadStore, access: () => AppAccess): void {
  accessBindings.set(threads, access)
}

const RequestInput = z.object({
  serverId: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
  reason: z.string().trim().min(1).max(300)
}).strict()
const meta = {
  toolKind: 'tool_call' as const, policy: 'auto' as const, sideEffect: 'read-only' as const,
  effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
  shouldAdvertise: (context: { roomAgent?: boolean; roomStepKind?: string }) =>
    context.roomAgent === true && context.roomStepKind === 'conversation'
}
const fail = (error: unknown) => ({ isError: true, output: { error: error instanceof Error ? error.message : String(error) } })

export function roomAppConnectionTools(threads: ThreadStore): LocalTool[] {
  return [
    LocalToolHost.defineTool({
      name: LIST_ROOM_APPS_TOOL_NAME, description: ROOM_AX_TOOL_DESCRIPTIONS.list_room_apps,
      ...meta, inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: async (_args, context) => {
        try {
          const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
          if (thread?.roomContext?.kind !== 'conversation') throw new Error('private Agent conversation required')
          const access = accessBindings.get(threads)?.()
          if (!access) throw new Error('app connection inventory unavailable')
          return { output: { messagingChannels: Object.entries(ROOM_IM_APPS).map(([id, name]) => ({ id, name, setup: 'official_qr', control: 'verified_owner_only' })), suggested: Object.entries(ROOM_APP_CATALOG).map(([id, app]) => ({ id, name: app.name })),
            configured: Object.entries(access.servers).filter(([id]) => !isHiddenRoomGoogleApp(id))
              .map(([id, server]) => ({ id, enabled: server.enabled,
              oauth: Boolean(server.oauth && server.oauth.enabled !== false),
              status: access.statuses[id] ?? 'not_connected' })) } }
        } catch (error) { return fail(error) }
      }
    }),
    LocalToolHost.defineTool({
      name: REQUEST_APP_CONNECTION_TOOL_NAME, description: ROOM_AX_TOOL_DESCRIPTIONS.request_app_connection,
      ...meta,
      inputSchema: z.toJSONSchema(RequestInput, { unrepresentable: 'any' }) as Record<string, unknown>,
      execute: async (args, context) => {
        try {
          const input = RequestInput.parse(args)
          const serverId = canonicalRoomAppId(input.serverId)
          if (isHiddenRoomGoogleApp(serverId)) throw new Error('This app is unavailable in private Rooms')
          const access = accessBindings.get(threads)?.(), store = roomPeerStoreBinding(threads)
          if (!access || !store) throw new Error('app connection service unavailable')
          if (!isRoomImApp(serverId) && !Object.hasOwn(ROOM_APP_CATALOG, serverId) && !access.servers[serverId]) {
            throw new Error('App is not in the built-in catalog or configured in Kun')
          }
          if (access.statuses[serverId] === 'connected') return { output: { connected: true, serverId } }
          if (access.servers[serverId]?.enabled === false) throw new Error('App is disabled in Kun')
          if (access.servers[serverId] && (!access.servers[serverId].oauth || access.servers[serverId].oauth.enabled === false)) {
            throw new Error('This MCP app has no OAuth flow configured; ask the user to manage it in Plugins')
          }
          const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
          const scope = thread?.roomContext
          if (!thread || scope?.kind !== 'conversation' || !scope.participantAgentId) {
            throw new Error('private Agent conversation required')
          }
          if (scope.blockedProviderIds.includes(`mcp:${serverId}`) || scope.blockedProviderIds.includes(serverId)) {
            throw new Error('App is blocked for this Agent')
          }
          const turn = thread.turns.find((item) => item.id === context.turnId)
          if (!turn || turn.status !== 'running' || !turn.clientRequestId || !context.activeToolCallId) {
            throw new Error('active Agent turn and tool call required')
          }
          const runId = roomRunId(scope.roomId, turn.clientRequestId)
          const run = await store.get<RoomRunRecord>('room_run', runId)
          if (!run || run.value.threadId !== thread.id || run.value.turnId !== turn.id || run.value.memberId !== scope.memberId) {
            throw new Error('conversation run binding unavailable')
          }
          const room = await store.get<Room>('room', scope.roomId)
          if (!room || room.value.archivedAt || room.value.conversationKind !== 'user_agent') {
            throw new Error('private Agent room unavailable')
          }
          const member = room.value.members.find((item) => item.id === scope.memberId)
          if (!member || !member.enabled || member.removedAt || member.participantAgentId !== scope.participantAgentId) {
            throw new Error('Agent is not active in this room')
          }
          const prior = (await store.list<RoomMessage>('message', { roomId: scope.roomId, originRunId: runId, limit: 50 }))
            .find((item) => item.value.appConnection?.serverId === serverId)
          if (prior) return { output: { requested: true, messageId: prior.id, serverId } }
          const messageId = roomRunSegmentMessageId(runId, context.activeToolCallId)
          const existing = await store.get<RoomMessage>('message', messageId)
          if (existing) {
            if (existing.roomId !== scope.roomId || existing.value.appConnection?.serverId !== serverId) throw new Error('connection card identity mismatch')
            return { output: { requested: true, messageId, serverId } }
          }
          const message = RoomMessageSchema.parse({ id: messageId, roomId: scope.roomId, messageSeq: 1,
            authorKind: 'member', authorMemberId: scope.memberId, authorLabelSnapshot: '',
            originItemId: context.activeToolCallId, presentationKind: 'app_connection',
            appConnection: { serverId, status: 'requested', resumed: false },
            body: input.reason, bodyRevision: 0, mentionMemberIds: [], attachmentIds: [],
            status: 'final', createdAt: new Date().toISOString() })
          const commit: RoomStoreCommit = { requestId: agentStableId('room-app-card', runId, context.activeToolCallId),
            checks: [{ kind: 'message', id: messageId, expectedRevision: null }],
            puts: [{ kind: 'message', id: messageId, roomId: scope.roomId, value: message }],
            events: [{ roomId: scope.roomId, kind: 'message.created', payload: { id: messageId } }] }
          await attachRoomRunPublication(store, commit, message, runId)
          await store.commit(commit)
          return { output: { requested: true, messageId, serverId,
            instruction: 'A connection card is visible to the user. Finish this turn; Kun will continue after the user connects or skips.' } }
        } catch (error) { return fail(error) }
      }
    })
  ]
}
