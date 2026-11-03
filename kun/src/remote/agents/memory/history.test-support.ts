import { join } from 'node:path'
import { FileMemoryStore } from '../../../memory/memory-store.js'
import { MemoryCapabilityConfig } from '../../../contracts/capabilities.js'
import { openAgentConversation } from '../../../agents/agent-conversations.js'
import type { AgentMemoryCandidate } from '../../../agents/agent-memory-capture-types.js'
import { remoteFixture } from '../../testing/runtime.test-support.js'
import { RemoteAgents, AgentParamSchemas, AGENT_READ_METHODS } from '../service.js'
import { RemoteReceipts } from '../../requests/receipts.js'
import { localCaller } from '../../runtime/local-call.js'
import { Envelope } from '../../contracts.js'

export async function agentHistoryFixture() {
  const f = await remoteFixture()
  const storage = new FileMemoryStore({ rootDir: join(f.root, 'memory'), config: MemoryCapabilityConfig.parse({ enabled: true }) })
  f.rooms.deps.memoryStore = storage
  const agents = new RemoteAgents(f.runtime, localCaller(f.router, f.runtime)), receipts = new RemoteReceipts(f.rooms)
  const agent = (await f.rooms.agents.create({ clientRequestId: 'identity', name: 'Memory owner' })).agent
  const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
  const source = (await f.rooms.service.send(room.id, { clientRequestId: 'source', body: 'Please remember my report preferences.' })).message
  const saved = await f.rooms.agentMemory.create(agent.id, { clientRequestId: 'save', conversationId: room.id,
    sourceMessageIds: [source.id], content: 'Report 😀 preferences '.repeat(40), type: 'preference' })
  const candidate: AgentMemoryCandidate = { id: 'candidate', phase: 'candidate', participantAgentId: agent.id,
    roomId: room.id, rootRequestId: source.rootRequestId!, status: 'pending',
    candidate: { content: 'Proposed 😀 report detail '.repeat(100), type: 'preference', confidence: .9, importance: .7,
      observedAt: new Date().toISOString(), tags: [], sources: saved.memory.sources },
    action: 'update', targetId: saved.memory.id, targetFingerprint: saved.fingerprint,
    runId: 'memory-run', sourceMessageIds: [source.id], reason: 'user_locked' }
  async function seed(value: AgentMemoryCandidate) {
    await f.store.commit({ requestId: 'seed-' + value.id, checks: [{ kind: 'agent_memory_job', id: value.id, expectedRevision: null }],
      puts: [{ kind: 'agent_memory_job', id: value.id, roomId: value.roomId, value }] })
  }
  await seed(candidate)
  async function call(method: keyof typeof AgentParamSchemas, raw: unknown, id?: string, deviceId?: string) {
    const params = AgentParamSchemas[method].parse(raw), envelope = Envelope.parse(f.envelope(method, raw, id, deviceId))
    if (AGENT_READ_METHODS.has(method)) return agents.dispatch(method, params, envelope) as Promise<any>
    return receipts.execute(envelope, () => agents.dispatch(method, params, envelope)) as Promise<any>
  }
  return { ...f, storage, agents, receipts, agent, room, source, saved, candidate, seed, call,
    candidateParams: { agentId: agent.id, candidateId: candidate.id, expectedRevision: 0 },
    memoryParams: { agentId: agent.id, memoryId: saved.memory.id, expectedFingerprint: saved.fingerprint } }
}
