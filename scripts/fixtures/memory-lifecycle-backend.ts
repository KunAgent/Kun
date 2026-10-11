import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentIdentityService } from '../../kun/src/agents/agent-identity-service'
import { AgentMemoryService } from '../../kun/src/agents/agent-memory-service'
import { listAgentMemoryCandidates, decideAgentMemoryCandidate } from '../../kun/src/agents/agent-memory-candidates'
import { openAgentConversation } from '../../kun/src/agents/agent-conversations'
import { RoomService } from '../../kun/src/rooms/room-service'
import { SqliteRoomStore } from '../../kun/src/rooms/room-store-sqlite'
import { memoryRecordPath } from '../../kun/src/memory/memory-canonical-files'
import { FileMemoryStore } from '../../kun/src/memory/memory-store'
import { MemoryCapabilityConfig } from '../../kun/src/contracts/capabilities'
import { canonicalMemoryHash } from '../../kun/src/memory/memory-record-normalizer'
import { memoryInjectionReceipt } from '../../kun/src/memory/memory-injection-receipt'
import { listMemories, createMemory, updateMemory } from '../../kun/src/server/routes/memory'
import { memoryHistory, memoryLifecycle } from '../../kun/src/server/routes/memory-lifecycle'
import { jsonResponse, type JsonResponse } from '../../kun/src/server/response'

/** A dedicated temporary database; never points at application userData or a real account. */
export async function createMemorySmokeBackend(root: string) {
  const projectRoot = join(root, 'fixture-project')
  await mkdir(projectRoot, { recursive: true })
  const config = MemoryCapabilityConfig.parse({ enabled: true })
  let rooms = new SqliteRoomStore({ path: join(root, 'fixture-rooms.sqlite') })
  let storage = new FileMemoryStore({ rootDir: join(root, 'fixture-memory'), config })
  let agents = new AgentIdentityService(rooms, () => ({}))
  let service = new AgentMemoryService(agents, () => storage)
  const conversations = new RoomService(rooms, () => {}); conversations.setAgentDirectory(agents)
  const agent = (await agents.create({ clientRequestId: 'native-fixture-agent', name: 'Fixture Agent' })).agent
  const room = (await openAgentConversation(agents, conversations, agent.id)).room
  const message = (await conversations.send(room.id, { clientRequestId: 'fixture-source',
    body: 'Use the repository test command and retain the exact build receipt before marking work complete.' })).message
  const createInput = { clientRequestId: 'fixture-memory', conversationId: room.id,
    sourceMessageIds: [message.id], content: 'Run tests before marking work complete.', type: 'fact' }
  const initial = await service.create(agent.id, createInput)
  await service.edit(agent.id, initial.memory.id, { clientRequestId: 'fixture-history-2', expectedFingerprint: initial.fingerprint,
    content: 'Run tests and retain the build result.' })
  const previous = await service.find(agent.id, initial.memory.id)
  await service.edit(agent.id, initial.memory.id, { clientRequestId: 'fixture-history-3', expectedFingerprint: canonicalMemoryHash(previous), content: message.body })
  const memory = await service.find(agent.id, initial.memory.id)
  const project = await storage.createWithId('project-fixture-fact', { scope: 'project', project: projectRoot,
    content: 'The repository uses npm test for verification.', type: 'fact', sources: [{ id: 'project-fixture-source', kind: 'user', trust: 'explicit-user' }] })
  await rooms.commit({ requestId: 'fixture-pending-candidate', checks: [{ kind: 'agent_memory_job', id: 'candidate-fixture-build', expectedRevision: null }], puts: [{ kind: 'agent_memory_job', id: 'candidate-fixture-build', roomId: room.id,
    value: { id: 'candidate-fixture-build', phase: 'candidate', participantAgentId: agent.id, roomId: room.id, rootRequestId: 'fixture-root',
      status: 'pending', action: 'update', targetId: memory.id, targetFingerprint: canonicalMemoryHash(memory), runId: 'fixture-run', sourceMessageIds: [message.id],
      candidate: { content: 'Always use a cached test result, even after source changes.', type: 'fact', confidence: .6, importance: .5,
        observedAt: new Date().toISOString(), tags: [], sources: [{ id: 'fixture-inference', kind: 'inference', trust: 'inferred', excerpt: 'Unverified proposed optimization.' }] } } }] })
  const receipt = memoryInjectionReceipt([memory], memory.content)
  let conflictOnNextEdit = false
  const calls: Array<{ path: string; method: string; body?: unknown; status: number }> = []
  const bootstrap = async () => ({ agentId: agent.id, memoryId: memory.id, projectRoot, projectId: project.id,
    project: await storage.getById(project.id, { project: projectRoot }), receipt, originalContent: memory.content })

  async function dispatch(path: string, method = 'GET', body?: string) {
    const url = new URL(path, 'http://isolated-fixture.invalid')
    const input = body ? JSON.parse(body) : undefined
    const request = new Request(url, { method, ...(body ? { body, headers: { 'content-type': 'application/json' } } : {}) })
    if (url.pathname === '/__fixture/bootstrap' && method === 'GET') return jsonResponse(await bootstrap())
    const prefix = '/v1/agents/' + encodeURIComponent(agent.id)
    if (url.pathname === prefix + '/memories' && method === 'GET') return jsonResponse(await service.list(agent.id, {
      includeDeleted: url.searchParams.get('include_deleted') === 'true', cursor: url.searchParams.get('cursor') ?? undefined
    }))
    if (url.pathname === prefix + '/conversations' && method === 'GET') return jsonResponse({ conversations: [room] })
    if (url.pathname === prefix + '/memory-candidates' && method === 'GET') return jsonResponse(await listAgentMemoryCandidates(service, agent.id))
    if (url.pathname === prefix + '/memory-work' && method === 'GET') return jsonResponse({ jobs: await rooms.list('agent_memory_job', { participantAgentId: agent.id, phase: 'capture' }) })
    if (url.pathname === prefix + '/memory-candidates/candidate-fixture-build/decision' && method === 'POST') {
      return jsonResponse(await decideAgentMemoryCandidate(service, agent.id, 'candidate-fixture-build', input))
    }
    const memoryPath = prefix + '/memories/' + encodeURIComponent(memory.id)
    if (url.pathname === memoryPath + '/history' && method === 'GET') return jsonResponse(await storage.history(memory.id, { agent: { agentId: agent.id, manage: true } }))
    if (url.pathname === memoryPath && method === 'GET') {
      const current = await service.find(agent.id, memory.id)
      return jsonResponse({ memory: { ...current, history: [] }, fingerprint: canonicalMemoryHash(current) })
    }
    if (url.pathname === memoryPath && method === 'PATCH') {
      if (conflictOnNextEdit) {
        conflictOnNextEdit = false
        const concurrent = await service.find(agent.id, memory.id)
        await service.edit(agent.id, memory.id, { clientRequestId: 'fixture-concurrent-editor',
          expectedFingerprint: canonicalMemoryHash(concurrent), locked: false })
      }
      return jsonResponse(await service.edit(agent.id, memory.id, input))
    }
    if (url.pathname === '/v1/memory' && method === 'GET') return listMemories(storage, request)
    if (url.pathname === '/v1/memory' && method === 'POST') return createMemory(storage, request)
    const generic = url.pathname.match(/^\/v1\/memory\/([^/]+)(?:\/(history|lifecycle))?$/)
    if (generic) {
      const id = decodeURIComponent(generic[1])
      if (generic[2] === 'history' && method === 'GET') return memoryHistory(storage, id, request)
      if (generic[2] === 'lifecycle' && method === 'POST') return memoryLifecycle(storage, id, request)
      if (!generic[2] && method === 'PATCH') return updateMemory(storage, id, request)
    }
    return jsonResponse({ error: { message: 'Route is outside the isolated fixture boundary.' } }, 404)
  }
  return {
    bootstrap,
    concurrentEditOnNextSave: () => { conflictOnNextEdit = true },
    async request(path: string, method = 'GET', body?: string) {
      let result: JsonResponse | Response
      try { result = await dispatch(path, method, body) }
      catch (error) { result = jsonResponse({ error: { message: String(error) } }, 409) }
      const text = result instanceof Response ? await result.text() : result.body
      calls.push({ path, method, body: body ? JSON.parse(body) : undefined, status: result.status })
      return { ok: result.status >= 200 && result.status < 300, status: result.status, body: text }
    },
    async snapshot() {
      // A fresh file reader proves the renderer result reached canonical persistence.
      const fresh = new FileMemoryStore({ rootDir: join(root, 'fixture-memory'), config })
      return { memory: await fresh.getById(memory.id, { agent: { agentId: agent.id, manage: true } }).catch(() => null),
        project: await fresh.getById(project.id, { project: projectRoot }),
        candidates: await rooms.list('agent_memory_job', { phase: 'candidate' }),
        calls: [...calls], sourceMessageRetained: Boolean(await rooms.get('message', message.id)) }
    },
    async verifyErasure() {
      const replayRecreated = await service.create(agent.id, createInput).then(() => true, () => false)
      const fileExists = await access(memoryRecordPath(join(root, 'fixture-memory'), memory.id)).then(() => true, () => false)
      const retainedHistory = await storage.history(memory.id, { agent: { agentId: agent.id, manage: true } }).then(() => true, () => false)
      return { fileExists, retainedHistory, replayRecreated,
        unrelatedProjectRetained: Boolean(await storage.getById(project.id, { project: projectRoot })),
        sourceConversationRetained: Boolean(await rooms.get('room', room.id)),
        sourceMessageRetained: Boolean(await rooms.get('message', message.id)) }
    },
    async reopen() {
      await rooms.close()
      rooms = new SqliteRoomStore({ path: join(root, 'fixture-rooms.sqlite') })
      storage = new FileMemoryStore({ rootDir: join(root, 'fixture-memory'), config })
      agents = new AgentIdentityService(rooms, () => ({})); service = new AgentMemoryService(agents, () => storage)
    },
    close: () => rooms.close()
  }
}
