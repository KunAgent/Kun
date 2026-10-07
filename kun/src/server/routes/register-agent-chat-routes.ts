import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import type { ServerRuntime } from './server-runtime.js'
import { readJsonBody } from '../read-json-body.js'
import { AgentModelRef } from '../../contracts/agent-identities.js'
import { chatEntryState, quickCreateAgent, CHAT_ENTRY_ID, QuickAgentRequest } from '../../agents/agent-chat-entry.js'
import { startAgentSetupTurn } from '../../agents/agent-setup.js'
import { agentModelOptions, agentFastModel, assertAgentModel, assertExplicitAgentModel } from '../../agents/agent-models.js'
import { updateDirectModel } from '../../agents/agent-direct-model.js'
import { externalAgentBinding } from '../../agents/agent-external.js'
import { codingAgentCatalog, prepareCodingAgent, resolveCodingAgentExecutor, saveCodingAgent } from '../../agents/agent-coding-agents.js'
import { directActivity, directFiles, controlDirectRequest, updateDirectWorkspace } from '../../agents/agent-direct-service.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown>) => void
const Id = z.string().min(1).max(128)
async function body(request: Request) { const result = await readJsonBody(request); if (!result.ok) throw new Error('Invalid request'); return result.value }
export function registerAgentChatRoutes(add: Add, runtime: ServerRuntime) {
  if (runtime.rooms) {
    runtime.rooms.deps.modelSnapshot = runtime.modelConnections ? () => runtime.modelConnections!.snapshot() : undefined
    runtime.rooms.service.setDirectModelResolver(async (room) => {
      const member = room.members.find((value) => value.id === room.defaultMemberId)!
      const agent = await runtime.rooms!.agents.active(member.participantAgentId!)
      if (room.privateWorkspace && agent.allowedRepositoryRoots && !agent.allowedRepositoryRoots.includes(room.privateWorkspace)) throw new Error('Project is outside this Agent\'s allowed directories')
      // An external coding Agent always runs its own pinned engine route.
      if (agent.executor) return externalAgentBinding(agent.executor)
      const resolved = await agentModelOptions(runtime.rooms!.deps, agent)
      const main = room.privateModelRef ?? resolved.main
      const fast = room.privateModelRef ? agentFastModel(runtime.rooms!.deps, agent, main) : resolved.fast
      if (fast?.providerId) member.fastModelRef = { ...fast, providerId: fast.providerId,
        accountId: fast.accountId ?? resolved.options.find((option) => option.providerId === fast.providerId)?.accountId }
      return main
    })
    const rooms = runtime.rooms
    rooms.agents.setExecutorValidator((executor) => resolveCodingAgentExecutor(rooms.workbench.harnesses, executor))
  }
  add('GET', '/v1/agents/coding-agents', (rooms) => codingAgentCatalog(rooms.workbench.harnesses))
  add('POST', '/v1/agents/coding-agents', async (rooms, request) => {
    const prepared = await prepareCodingAgent(rooms.workbench.harnesses, await body(request))
    return rooms.exclusive(() => saveCodingAgent(rooms.agents, prepared))
  })
  add('GET', '/v1/agents/chat-entry', (rooms) => chatEntryState(rooms.agents))
  add('POST', '/v1/agents/chat-entry', async (rooms, request) => {
    const input = z.object({ clientRequestId: Id, action: z.enum(['initialize', 'seen']) }).strict().parse(await body(request))
    return rooms.exclusive(async () => {
      if (input.action === 'initialize') await quickCreateAgent(rooms.agents, { clientRequestId: input.clientRequestId }, true)
      else {
        const row = await rooms.deps.store.get('agent_bootstrap', CHAT_ENTRY_ID)
        if (row) await rooms.deps.store.commit({ requestId: 'chat-entry-seen:' + input.clientRequestId,
          checks: [{ kind: 'agent_bootstrap', id: CHAT_ENTRY_ID, expectedRevision: row.revision }],
          puts: [{ kind: 'agent_bootstrap', id: CHAT_ENTRY_ID, value: { ...(row.value as object), seen: true } }] })
      }
      return chatEntryState(rooms.agents)
    })
  })
  add('GET', '/v1/agents/creation-models', (rooms) => agentModelOptions(rooms.deps))
  add('GET', '/v1/agents/creation-requests/:requestId', async (rooms, _request, { params }) => {
    const id = Id.parse(params.requestId)
    return rooms.exclusive(async () => {
      const request = await rooms.deps.store.getRequest('agent-quick:' + id)
      return { created: request?.result ?? null }
    })
  })
  add('POST', '/v1/agents/quick-create', async (rooms, request) => {
    const input = await body(request)
    return rooms.exclusive(async () => {
      const created = await quickCreateAgent(rooms.agents, input, false, (model) => assertExplicitAgentModel(rooms.deps, model))
      await startAgentSetupTurn({
        service: rooms.service, store: rooms.deps.store, agents: rooms.agents, wake: () => rooms.wake(),
        created, clientRequestId: QuickAgentRequest.parse(input).clientRequestId
      })
      return created
    })
  })
  add('GET', '/v1/agents/:agentId/models', async (rooms, request, { params }) => {
    const agent = await rooms.agents.get(params.agentId)
    return { agent, ...await agentModelOptions(rooms.deps, agent, new URL(request.url).searchParams.get('room_id') ?? undefined) }
  })
  add('PUT', '/v1/agents/:agentId/models', async (rooms, request, { params }) => {
    const input = z.object({ clientRequestId: Id, expectedRevision: z.number().int().nonnegative(),
      modelRef: AgentModelRef.nullable(), fastModelRef: AgentModelRef.nullable() }).strict().parse(await body(request))
    return rooms.exclusive(async () => {
      if (input.modelRef) await assertExplicitAgentModel(rooms.deps, input.modelRef)
      if (input.fastModelRef) {
        await assertAgentModel(rooms.deps, input.fastModelRef, true)
        await assertExplicitAgentModel(rooms.deps, input.fastModelRef)
      }
      const { agent } = await rooms.agents.update(params.agentId, input)
      return { agent, ...await agentModelOptions(rooms.deps, agent) }
    })
  })
  add('PUT', '/v1/rooms/:roomId/direct/model', async (rooms, request, { params }) => {
    const input = z.object({ clientRequestId: Id, expectedRevision: z.number().int().nonnegative(),
      modelRef: AgentModelRef }).strict().parse(await body(request))
    return rooms.exclusive(async () => ({ room: await updateDirectModel(rooms, params.roomId, input) }))
  })
  add('GET', '/v1/rooms/:roomId/direct', (rooms, _request, { params }) => directActivity(rooms, params.roomId))
  add('GET', '/v1/rooms/:roomId/files', (rooms, request, { params }) => directFiles(rooms, params.roomId, Object.fromEntries(new URL(request.url).searchParams)))
  add('POST', '/v1/rooms/:roomId/direct/context', async (rooms, request, { params }) => {
    const input = z.object({ clientRequestId: Id, expectedRevision: z.number().int().nonnegative(),
      action: z.enum(['workspace', 'reset']), path: z.string().min(1).max(4096).nullable().optional() }).strict().parse(await body(request))
    return rooms.exclusive(async () => ({ room: await updateDirectWorkspace(rooms, params.roomId, input) }))
  })
  add('POST', '/v1/rooms/:roomId/direct/:requestId', async (rooms, request, { params }) => {
    const input = z.object({ clientRequestId: Id, expectedRevision: z.number().int().nonnegative(), action: z.enum(['stop', 'retry']) }).strict().parse(await body(request))
    return rooms.exclusive(() => controlDirectRequest(rooms, params.roomId, params.requestId, input))
  })
}
