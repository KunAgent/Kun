import { registerRoomPermissionRoutes } from './register-room-permission-routes.js'
import { registerAgentChatRoutes } from './register-agent-chat-routes.js'
import { registerRoomProfileRoutes } from './register-room-profile-routes.js'
import { registerAgentHandoffRoutes } from './register-agent-handoff-routes.js'
import { registerAgentIdentityRoutes } from './register-agent-identity-routes.js'
import { z } from 'zod'
import { RoomIdSchema } from '../../contracts/rooms.js'
import { RoomRuleRequestSchema, RoomTaskActionSchema } from '../../contracts/rooms-api.js'
import { RoomTaskStatusSchema } from '../../contracts/room-tasks.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RoomTaskExecution } from '../../rooms/room-runtime-types.js'
import { RoomStoreConflictError, RoomListOptionsSchema } from '../../rooms/room-store.js'
import { ServiceManagerHttpError, ServiceManagerTransportError } from '../../manager/usage-errors.js'
import type { Router, RouteContext } from '../router.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import { roomEventStream } from './room-event-stream.js'
import { roomCleanupPreview, cleanupRoomTask } from '../../rooms/room-cleanup.js'
import { roomGit } from '../../rooms/room-git.js'
import { roomRequestAction } from '../../rooms/room-request-actions.js'
import { roomHistoryPage } from '../../rooms/room-history.js'
import { registerRoomEvidenceRoutes } from './register-room-evidence-routes.js'
import { registerRoomRunRoutes } from './register-room-run-routes.js'
import { registerRoomExperienceRoutes } from './register-room-experience-routes.js'
import { registerRoomReplyRoutes } from './register-room-reply-routes.js'
import { registerRoomContentRoutes } from './register-room-content-routes.js'
import { registerRoomInteractionRoutes } from './register-room-interaction-routes.js'
import { registerRoomProposalRoutes } from './register-room-proposal-routes.js'
import type { RoomWorkspace } from '../../rooms/room-runtime-types.js'

const PageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.coerce.number().int().nonnegative().optional()
})
class RoomBodyError extends Error {
  constructor(readonly response: JsonResponse) { super('invalid room request body') }
}
async function body(request: Request): Promise<unknown> {
  const result = await readJsonBody(request)
  if (!result.ok) throw new RoomBodyError(result.response)
  return result.value
}
function pagination(request: Request) {
  const params = new URL(request.url).searchParams
  return PageSchema.parse({ limit: params.get('limit') ?? undefined, cursor: params.get('cursor') ?? undefined })
}

export function registerRoomRoutes(router: Router, runtime: ServerRuntime): void {
  type Handler = (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown
  const add = (method: string, path: string, handle: Handler): void => router.add(method, path, async (request, context) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    if (!runtime.rooms) return ERRORS.unavailable('rooms are not available')
    try {
      if (context.params.roomId) RoomIdSchema.parse(context.params.roomId)
      if (context.params.taskId) RoomIdSchema.parse(context.params.taskId)
      const result = await handle(runtime.rooms, request, context)
      return result instanceof Response ? result : jsonResponse(result)
    } catch (error) {
      if (error instanceof RoomBodyError) return error.response
      if (error instanceof z.ZodError) return ERRORS.validation('invalid room request', error.issues)
      if (error instanceof RoomStoreConflictError) return jsonResponse({ code: 'room_conflict',
        message: error.message, currentRevision: error.currentRevision }, 409)
      if (error instanceof ServiceManagerHttpError || error instanceof ServiceManagerTransportError) {
        return ERRORS.unavailable('room persistence is temporarily unavailable')
      }
      const message = error instanceof Error ? error.message : String(error)
      if (/not found$/i.test(message)) return ERRORS.notFound(message)
      return ERRORS.internal(message)
    }
  })

  registerRoomPermissionRoutes(add, runtime)
  registerAgentChatRoutes(add, runtime)
  registerRoomProfileRoutes(add, runtime)
  registerAgentIdentityRoutes(add)
  registerAgentHandoffRoutes(add)
  registerRoomEvidenceRoutes(add)
  registerRoomRunRoutes(add, runtime)
  registerRoomExperienceRoutes(add)
  registerRoomReplyRoutes(add)
  registerRoomContentRoutes(add, runtime)
  registerRoomInteractionRoutes(add)
  registerRoomProposalRoutes(add)
  add('GET', '/v1/rooms/:roomId/topics', (rooms, request, context) => {
    const page = pagination(request)
    return rooms.peerTopics(context.params.roomId, page.limit, page.cursor)
  })
  add('GET', '/v1/rooms/:roomId/topics/:rootRequestId/metrics', (rooms, request, context) => {
    RoomIdSchema.parse(context.params.rootRequestId)
    const page = pagination(request)
    return rooms.peerMetrics(context.params.roomId, context.params.rootRequestId, page.limit, page.cursor)
  })
  add('POST', '/v1/rooms/:roomId/topics/:rootRequestId/stop', async (rooms, request, context) => {
    RoomIdSchema.parse(context.params.rootRequestId)
    return rooms.stopPeerTopic(context.params.roomId, context.params.rootRequestId, await body(request))
  })
  add('GET', '/v1/rooms/presets', (rooms) => {
    const defaults = rooms.deps.model()
    const unsupportedProviderIds = rooms.deps.unsupportedProviderIds?.() ?? []
    const presets = new Map<string, Record<string, unknown>>([
      ['coordinator', { id: 'coordinator', name: 'Coordinator', description: 'Coordinate the room within the user goal.' }],
      ['developer', { id: 'developer', name: 'Developer', description: 'Implement and verify assigned repository tasks.' }],
      ['reviewer', { id: 'reviewer', name: 'Reviewer', description: 'Review an immutable delivery using read-only tools.' }]
    ])
    for (const [id, profile] of Object.entries(rooms.deps.profiles())) {
      presets.set(id, { id, name: profile.name ?? id, description: profile.description ?? '',
        model: profile.model ?? defaults.model, providerId: profile.providerId ?? defaults.providerId,
        toolPolicy: profile.toolPolicy, allowedTools: profile.allowedTools, blockedTools: profile.blockedTools,
        blockedMcpServers: profile.blockedMcpServers, blockedSkills: profile.blockedSkills, skillsEnabled: profile.skillsEnabled })
    }
    return { presets: [...presets.values()].map((preset) => {
      const available = !unsupportedProviderIds.includes(String(preset.providerId ?? defaults.providerId))
      return { ...preset, model: preset.model ?? defaults.model, providerId: preset.providerId ?? defaults.providerId,
        available, ...(available ? {} : { reason: '该执行引擎尚不支持 bot；请选择原生 API 模型。' }) }
    }), defaultModel: defaults, unsupportedProviderIds }
  })
  add('GET', '/v1/rooms/attention', (rooms) => rooms.product.attention())
  add('GET', '/v1/rooms/events', async (rooms, request) => {
    const params = new URL(request.url).searchParams
    if (params.get('latest') === 'true') return { cursor: await rooms.service.store.latestEventSeq?.() ?? 0,
      scopeId: await rooms.service.store.eventScope?.() }
    const sinceSeq = z.coerce.number().int().nonnegative().parse(params.get('since_seq') ?? 0)
    if (request.headers.get('accept')?.includes('text/event-stream')) return roomEventStream({ runtime, rooms, roomId: '*', request, sinceSeq })
    const events = await rooms.service.store.events('*', sinceSeq, 200)
    return { events, cursor: events.at(-1)?.seq ?? sinceSeq }
  })
  add('GET', '/v1/rooms', (rooms, request) => {
    const params = new URL(request.url).searchParams
    const archived = z.enum(['true', 'false']).parse(params.get('archived_only') ?? 'false')
    return rooms.listRooms(RoomListOptionsSchema.parse({ conversationKind: params.get('conversation_kind') ?? undefined, search: params.get('search') ?? undefined, limit: params.has('limit') ? Number(params.get('limit')) : undefined,
      cursor: params.get('cursor') ?? undefined, archivedOnly: archived === 'true',
      unreadOnly: z.enum(['true', 'false']).parse(params.get('unread_only') ?? 'false') === 'true',
      attentionOnly: z.enum(['true', 'false']).parse(params.get('attention_only') ?? 'false') === 'true',
      ids: params.get('room_ids')?.split(',') ?? undefined,
      repositoryRoot: params.get('repository_root') ?? undefined }))
  })
  add('POST', '/v1/rooms', async (rooms, request) => rooms.service.create(await body(request)))
  add('GET', '/v1/rooms/:roomId', async (rooms, _request, context) => ({ room: await rooms.service.get(context.params.roomId) }))
  add('PATCH', '/v1/rooms/:roomId', async (rooms, request, context) => {
    const input = await body(request)
    return rooms.exclusive(() => rooms.service.update(context.params.roomId, input))
  })
  add('GET', '/v1/rooms/:roomId/messages', async (rooms, request, context) => {
    const params = new URL(request.url).searchParams
    if (params.has('message_ids')) {
      const ids = [...new Set(z.array(RoomIdSchema).min(1).max(50).parse(params.get('message_ids')!.split(',')))]
      z.literal(undefined).parse(params.get('cursor') ?? undefined)
      await rooms.service.get(context.params.roomId)
      const rows = await Promise.all(ids.map((id) => rooms.service.store.list<import('../../contracts/rooms.js').RoomMessage>('message',
        { roomId: context.params.roomId, documentId: id, limit: 1 })))
      return { messages: rows.flat().map((row) => ({ ...row.value, messageSeq: row.seq })) }
    }
    const page = pagination(request)
    return rooms.messages(context.params.roomId, page.limit, page.cursor)
  })
  add('POST', '/v1/rooms/:roomId/messages', async (rooms, request, context) => {
    const input = await body(request)
    return rooms.exclusive(() => rooms.service.send(context.params.roomId, input))
  })
  add('GET', '/v1/rooms/:roomId/messages/:messageId', async (rooms, _request, { params }) => {
    const message = (await rooms.service.store.list<import('../../contracts/rooms.js').RoomMessage>('message',
      { roomId: params.roomId, documentId: RoomIdSchema.parse(params.messageId), limit: 1 }))[0]
    if (!message) throw new Error('message not found')
    return { message: { ...message.value, messageSeq: message.seq } }
  })
  add('GET', '/v1/rooms/:roomId/search', async (rooms, request, context) => {
    await rooms.service.get(context.params.roomId)
    const query = z.string().trim().min(2).max(200).parse(new URL(request.url).searchParams.get('q'))
    const page = pagination(request)
    const rows = await rooms.service.store.list<import('../../contracts/rooms.js').RoomMessage>('message', {
      roomId: context.params.roomId, search: query, limit: page.limit, beforeSeq: page.cursor })
    const messages = rows.filter((row) => row.value.presentationKind !== 'setup').map((row) => ({ ...row.value, messageSeq: row.seq }))
    return { messages, nextCursor: rows.length === page.limit ? String(rows.at(-1)!.seq) : undefined }
  })
  add('POST', '/v1/rooms/:roomId/read', async (rooms, request, context) => {
    const input = z.object({ seq: z.number().int().nonnegative(), clientRequestId: RoomIdSchema }).parse(await body(request))
    return (await rooms.product.read(context.params.roomId, input.seq, input.clientRequestId)).result
  })
  add('GET', '/v1/rooms/:roomId/requests', (rooms, request, context) =>
    rooms.product.requestPage(context.params.roomId, {
      ...pagination(request),
      attentionOnly: new URL(request.url).searchParams.get('attention_only') === 'true'
    }))
  add('GET', '/v1/rooms/:roomId/requests/:requestId', async (rooms, _request, { params }) => {
    const row = await rooms.service.store.get<import('../../rooms/room-runtime-types.js').RoomRequestState>('request', params.requestId)
    if (!row || row.roomId !== params.roomId) throw new Error('request not found')
    const context = await rooms.service.store.get('context', row.value.contextId ?? 'context-' + row.id)
    const compression = row.value.compressionId ? await rooms.service.store.get<import('../../rooms/room-rule-compression.js').RuleCompression>('rule_compression', row.value.compressionId) : null
    return { request: { ...row.value, revision: row.revision }, context: context?.value,
      compression: compression ? { status: compression.value.status, completed: compression.value.index,
        total: compression.value.units.length, error: compression.value.error } : undefined }
  })
  for (const action of ['continue', 'cancel', 'reconcile'] as const) add('POST', '/v1/rooms/:roomId/requests/:requestId/' + action, async (rooms, request, { params }) => {
    const input = await body(request)
    const result = await rooms.exclusive(() => roomRequestAction(rooms.deps, rooms.service, params.roomId, params.requestId, action, input))
    rooms.wake()
    return result
  })
  add('POST', '/v1/rooms/:roomId/requests/:requestId/retry', async (rooms, request, context) => {
    const input = RoomTaskActionSchema.parse(await body(request))
    const result = await rooms.exclusive(() => rooms.product.retryRequest(context.params.roomId, context.params.requestId, input.clientRequestId, input.expectedRevision))
    rooms.wake()
    return result
  })
  add('GET', '/v1/rooms/:roomId/tasks', async (rooms, request, context) => {
    const roomId = context.params.roomId
    await rooms.service.get(roomId)
    const page = pagination(request)
    const selected = new URL(request.url).searchParams.get('status')
    const status = selected ? z.array(RoomTaskStatusSchema).parse(selected.split(',')) : undefined
    const rows = await rooms.deps.store.list<RoomTaskExecution>('task', {
      roomId, limit: page.limit, beforeSeq: page.cursor, status,
      requestId: new URL(request.url).searchParams.get('request_id') ?? undefined,
      memberId: new URL(request.url).searchParams.get('member_id') ?? undefined,
      repositoryId: new URL(request.url).searchParams.get('repository_id') ?? undefined
    })
    return { tasks: rows.map((row) => ({ ...row.value.task, revision: row.revision })),
      nextCursor: rows.length === page.limit ? String(rows.at(-1)!.seq) : undefined }
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId', (rooms, request, context) =>
    rooms.taskDetail(context.params.roomId, context.params.taskId, new URL(request.url).searchParams.get('include_diff') !== 'false'))
  for (const action of ['cancel', 'retry', 'accept', 'apply', 'review', 'retry-review']) {
    add('POST', `/v1/rooms/:roomId/tasks/:taskId/${action}`, async (rooms, request, context) => {
      await rooms.action(context.params.roomId, context.params.taskId, action, await body(request))
      return rooms.taskDetail(context.params.roomId, context.params.taskId)
    })
  }
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/recovery', (rooms, _request, context) =>
    rooms.product.recovery(context.params.roomId, context.params.taskId))
  add('POST', '/v1/rooms/:roomId/tasks/:taskId/recover', async (rooms, request, context) => {
    const input = await body(request)
    return rooms.exclusive(() => rooms.product.recover(context.params.roomId, context.params.taskId, input))
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/deliveries', (rooms, request, context) =>
    rooms.product.deliveryPage(context.params.roomId, context.params.taskId, pagination(request), new URL(request.url).searchParams.get('summary_only') === 'true'))
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/deliveries/:deliveryId', (rooms, request, context) =>
    rooms.product.delivery(context.params.roomId, context.params.taskId, context.params.deliveryId, new URL(request.url).searchParams.get('include_diff') !== 'false'))
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/reviews', async (rooms, request, { params }) => {
    const page = await roomHistoryPage<import('../../contracts/room-deliveries.js').RoomReview>(rooms.service.store, 'review', {
      roomId: params.roomId, taskId: params.taskId, deliveryId: new URL(request.url).searchParams.get('delivery_id') ?? undefined
    }, pagination(request))
    return { reviews: page.items, nextCursor: page.nextCursor }
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/compare', async (rooms, request, { params }) => {
    const query = new URL(request.url).searchParams
    const before = await rooms.product.delivery(params.roomId, params.taskId, RoomIdSchema.parse(query.get('from')))
    const after = await rooms.product.delivery(params.roomId, params.taskId, RoomIdSchema.parse(query.get('to')))
    const task = await rooms.deps.store.get<RoomTaskExecution>('task', params.taskId)
    if (!task || task.roomId !== params.roomId) throw new Error('task not found')
    const workspaceRow = await rooms.deps.store.get<RoomWorkspace>('workspace', task.value.task.workspaceId)
    if (!workspaceRow || workspaceRow.roomId !== params.roomId || workspaceRow.taskId !== params.taskId) throw new Error('workspace not found')
    const workspace = workspaceRow.value
    return { diff: await roomGit(workspace.repository.root, ['diff', '--no-ext-diff', before.delivery.versionHash, after.delivery.versionHash]) }
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/integrations', async (rooms, request, { params }) => {
    const page = await roomHistoryPage<import('../../contracts/rooms-product.js').RoomIntegration>(rooms.service.store, 'integration',
      { roomId: params.roomId, taskId: params.taskId, summaryOnly: new URL(request.url).searchParams.get('summary_only') === 'true' }, pagination(request))
    return { integrations: page.items.map((value) => ({ ...value,
      approvals: value.threadId ? rooms.deps.approvals.pending(value.threadId) : [],
      userInputs: value.threadId ? rooms.deps.inputs.pending(value.threadId) : [] })), nextCursor: page.nextCursor }
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/integrations/:integrationId', async (rooms, _request, { params }) => {
    const row = await rooms.integrations.get(params.roomId, params.taskId, params.integrationId)
    return { integration: { ...row.value, revision: row.revision,
      approvals: row.value.threadId ? rooms.deps.approvals.pending(row.value.threadId) : [],
      userInputs: row.value.threadId ? rooms.deps.inputs.pending(row.value.threadId) : [] } }
  })
  add('POST', '/v1/rooms/:roomId/tasks/:taskId/integrations', async (rooms, request, { params }) => {
    const input = await body(request)
    return { integration: await rooms.exclusive(() => rooms.integrations.prepare(params.roomId, params.taskId, input)) }
  })
  for (const action of ['resolve', 'apply', 'cancel', 'open', 'validate']) add('POST', '/v1/rooms/:roomId/tasks/:taskId/integrations/:integrationId/' + action, async (rooms, request, { params }) => {
    const input = await body(request)
    return { integration: await rooms.exclusive(() => rooms.integrations.action(params.roomId, params.taskId, params.integrationId, action, input)) }
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/cleanup', (rooms, _request, { params }) =>
    roomCleanupPreview(rooms.deps, params.roomId, params.taskId))
  add('POST', '/v1/rooms/:roomId/tasks/:taskId/cleanup', async (rooms, request, { params }) => {
    const input = z.object({ clientRequestId: RoomIdSchema, expectedRevision: z.number().int().nonnegative(), token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await body(request))
    return rooms.exclusive(() => cleanupRoomTask(rooms.deps, params.roomId, params.taskId, input))
  })
  add('PATCH', '/v1/rooms/:roomId/rules/:ruleId', async (rooms, request, context) => {
    const input = await body(request)
    return (await rooms.product.updateRule(context.params.roomId, context.params.ruleId, input)).result
  })
  add('POST', '/v1/rooms/:roomId/rules/:ruleId/adopt', async (rooms, request, { params }) => {
    const input = z.object({ taskId: RoomIdSchema, expectedTaskRevision: z.number().int().nonnegative(),
      version: z.number().int().positive(), clientRequestId: RoomIdSchema, body: z.string().max(64000).optional() }).strict().parse(await body(request))
    return rooms.exclusive(() => rooms.product.adoptRule(params.roomId, params.ruleId, input))
  })
  add('GET', '/v1/rooms/:roomId/rules/:ruleId/versions', async (rooms, request, { params }) => {
    const rule = await rooms.service.store.get('rule', params.ruleId)
    if (!rule || rule.roomId !== params.roomId) throw new Error('rule not found')
    const page = pagination(request)
    const rows = await rooms.service.store.list('rule_version', {
      roomId: params.roomId, documentId: params.ruleId, limit: page.limit, beforeSeq: page.cursor
    })
    return { versions: rows.map((row) => row.value), nextCursor: rows.length === page.limit ? String(rows.at(-1)!.seq) : undefined }
  })
  add('GET', '/v1/rooms/:roomId/rules', async (rooms, request, context) => {
    await rooms.service.get(context.params.roomId)
    const page = await roomHistoryPage(rooms.service.store, 'rule', { roomId: context.params.roomId }, pagination(request))
    return { rules: page.items, nextCursor: page.nextCursor }
  })
  add('POST', '/v1/rooms/:roomId/rules', async (rooms, request, context) => {
    const input = RoomRuleRequestSchema.parse(await body(request))
    const result = await rooms.service.rule(context.params.roomId, input.messageId, input.clientRequestId)
    return { rule: result.result }
  })
  add('GET', '/v1/rooms/:roomId/events', async (rooms, request, context) => {
    const roomId = context.params.roomId
    await rooms.service.get(roomId)
    const params = new URL(request.url).searchParams
    const since = z.coerce.number().int().nonnegative().parse(
      params.get('since_seq') ?? request.headers.get('last-event-id') ?? '0')
    if (request.headers.get('accept')?.includes('text/event-stream')) {
      return roomEventStream({ runtime, rooms, roomId, request, sinceSeq: since })
    }
    const events = await rooms.service.store.events(roomId, since, pagination(request).limit)
    return { events, cursor: events.at(-1)?.seq ?? since }
  })
}
