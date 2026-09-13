import { agentOnboardingState, updateAgentOnboarding } from '../../agents/agent-onboarding.js'
import { listAgentMemoryCandidates, decideAgentMemoryCandidate } from '../../agents/agent-memory-candidates.js'
import { agentDirectoryPage } from '../../agents/agent-directory-query.js'
import { AgentMemoryPage } from '../../agents/agent-memory-service.js'
import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import { ParticipantAgentId, AgentFeaturesSchema } from '../../contracts/agent-identities.js'
import { openAgentConversation } from '../../agents/agent-conversations.js'
import { readJsonBody } from '../read-json-body.js'
import { DEFAULT_AGENT_TEMPLATES, DIAGNOSTICIAN_AGENT_TEMPLATE } from '../../agents/agent-defaults.js'

type Add = (method: string, path: string, handle: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown> | unknown) => void
async function body(request: Request) {
  const parsed = await readJsonBody(request)
  if (!parsed.ok) throw new z.ZodError([{ code: 'custom', path: [], message: 'invalid request body' }])
  return parsed.value
}
export function registerAgentIdentityRoutes(add: Add): void {
  add('GET', '/v1/agents/onboarding', (rooms) => rooms.exclusive(() => agentOnboardingState(rooms.agents)))
  add('POST', '/v1/agents/onboarding', async (rooms, request) => {
    const input = await body(request)
    return rooms.exclusive(() => updateAgentOnboarding(rooms.agents, input))
  })
  add('POST', '/v1/agents/default-members', (rooms) => rooms.exclusive(async () => ({ members: await rooms.agents.defaultMembers([]) })))
  add('GET', '/v1/agents/templates', () => ({ templates: [...DEFAULT_AGENT_TEMPLATES, DIAGNOSTICIAN_AGENT_TEMPLATE] }))
  add('GET', '/v1/agents/features', async (rooms) => {
    const row = await rooms.deps.store.get('agent_features', 'features')
    return { features: await rooms.agents.features(), revision: row?.revision ?? null,
      initializing: !await rooms.deps.store.get('agent_bootstrap', 'identities-v1') }
  })
  add('PUT', '/v1/agents/features', async (rooms, request) => {
    const input = z.object({ clientRequestId: ParticipantAgentId, expectedRevision: z.number().int().nonnegative().nullable(),
      features: AgentFeaturesSchema }).strict().parse(await body(request))
    return rooms.exclusive(() => rooms.agents.updateFeatures(input))
  })
  add('GET', '/v1/agents', (rooms, request) => {
    const params = new URL(request.url).searchParams
    return agentDirectoryPage(rooms.agents, { limit: params.get('limit') ?? undefined, cursor: params.get('cursor') ?? undefined,
      search: params.get('search') ?? undefined, archivedOnly: z.enum(['true', 'false']).parse(params.get('archived_only') ?? 'false') === 'true' })
  })
  add('POST', '/v1/agents', async (rooms, request) => {
    const input = await body(request)
    return rooms.exclusive(() => rooms.agents.create(input))
  })
  add('GET', '/v1/agents/:agentId', async (rooms, _request, { params }) =>
    ({ agent: await rooms.agents.get(ParticipantAgentId.parse(params.agentId)) }))
  add('PATCH', '/v1/agents/:agentId', async (rooms, request, { params }) => {
    const id = ParticipantAgentId.parse(params.agentId), input = await body(request)
    return rooms.exclusive(() => rooms.agents.update(id, input))
  })
  add('GET', '/v1/agents/:agentId/runs', async (rooms, request, { params }) => {
    const id = ParticipantAgentId.parse(params.agentId), query = new URL(request.url).searchParams
    await rooms.agents.get(id)
    const cursor = query.has('cursor') ? z.coerce.number().int().nonnegative().parse(query.get('cursor')) : undefined
    const rows = await rooms.deps.store.list('room_run', { participantAgentId: id, beforeSeq: cursor, limit: 31, summaryOnly: true })
    return { runs: rows.slice(0, 30).map((row) => row.value), nextCursor: rows.length > 30 ? String(rows[29].seq) : undefined }
  })
  add('GET', '/v1/agents/:agentId/conversations', async (rooms, request, { params }) => {
    const id = ParticipantAgentId.parse(params.agentId), query = new URL(request.url).searchParams
    await rooms.agents.get(id)
    const cursor = query.has('cursor') ? z.coerce.number().int().nonnegative().parse(query.get('cursor')) : undefined
    const rows = await rooms.deps.store.list('room', { participantAgentId: id, beforeSeq: cursor, limit: 31 })
    return { conversations: rows.slice(0, 30).map((row) => row.value), nextCursor: rows.length > 30 ? String(rows[29].seq) : undefined }
  })
  add('GET', '/v1/agents/:agentId/memory-candidates', async (rooms, request, { params }) => {
    const id = ParticipantAgentId.parse(params.agentId), query = new URL(request.url).searchParams
    const cursor = query.has('cursor') ? z.coerce.number().int().nonnegative().parse(query.get('cursor')) : undefined
    return listAgentMemoryCandidates(rooms.agentMemory, id, cursor)
  })
  add('POST', '/v1/agents/:agentId/memory-candidates/:candidateId/decision', async (rooms, request, { params }) => {
    const id = ParticipantAgentId.parse(params.agentId), candidateId = ParticipantAgentId.parse(params.candidateId), input = await body(request)
    return rooms.exclusive(() => decideAgentMemoryCandidate(rooms.agentMemory, id, candidateId, input))
  })
  add('GET', '/v1/agents/:agentId/memory-work', async (rooms, _request, { params }) => {
    const id = ParticipantAgentId.parse(params.agentId)
    await rooms.agents.get(id)
    const rows = await rooms.deps.store.list<import('../../agents/agent-memory-capture-types.js').AgentMemoryCapture>('agent_memory_job', {
      participantAgentId: id, phase: 'capture', status: ['pending', 'running', 'deferred', 'failed'], limit: 50, summaryOnly: true })
    return { jobs: rows.map((row) => ({ id: row.id, roomId: row.roomId, status: row.value.status,
      attempts: row.value.attempts, error: row.value.error, runId: row.value.runId })) }
  })
  add('GET', '/v1/agents/:agentId/memories', (rooms, request, { params }) => {
    const query = new URL(request.url).searchParams
    return rooms.agentMemory.list(ParticipantAgentId.parse(params.agentId), AgentMemoryPage.parse({
      limit: query.get('limit') ?? undefined, cursor: query.get('cursor') ?? undefined,
      includeDeleted: z.enum(['true', 'false']).parse(query.get('include_deleted') ?? 'false') === 'true' }))
  })
  add('POST', '/v1/agents/:agentId/memories', async (rooms, request, { params }) => {
    const id = ParticipantAgentId.parse(params.agentId), input = await body(request)
    return rooms.exclusive(() => rooms.agentMemory.create(id, input))
  })
  add('PATCH', '/v1/agents/:agentId/memories/:memoryId', async (rooms, request, { params }) => {
    const id = ParticipantAgentId.parse(params.agentId), memoryId = ParticipantAgentId.parse(params.memoryId), input = await body(request)
    return rooms.exclusive(() => rooms.agentMemory.edit(id, memoryId, input))
  })
  add('POST', '/v1/agents/:agentId/conversation', async (rooms, _request, { params }) => {
    const id = ParticipantAgentId.parse(params.agentId)
    return rooms.exclusive(() => openAgentConversation(rooms.agents, rooms.service, id))
  })
}
