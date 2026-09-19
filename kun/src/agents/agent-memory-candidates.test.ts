import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { RoomService } from '../rooms/room-service.js'
import { FileMemoryStore } from '../memory/memory-store.js'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { AgentIdentityService } from './agent-identity-service.js'
import { AgentMemoryService } from './agent-memory-service.js'
import { openAgentConversation } from './agent-conversations.js'
import { decideAgentMemoryCandidate, listAgentMemoryCandidates } from './agent-memory-candidates.js'
import type { AgentMemoryCandidate } from './agent-memory-capture-types.js'

const resources: Array<{ dir: string; store: SqliteRoomStore }> = []
afterEach(async () => { for (const { dir, store } of resources.splice(0)) { await store.close(); await rm(dir, { recursive: true, force: true }) } })
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'agent-memory-candidate-'))
  const store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') }); resources.push({ dir, store })
  const agents = new AgentIdentityService(store, () => ({}))
  const rooms = new RoomService(store, () => {}); rooms.setAgentDirectory(agents)
  const storage = new FileMemoryStore({ rootDir: join(dir, 'memory'), config: MemoryCapabilityConfig.parse({ enabled: true }) })
  const service = new AgentMemoryService(agents, () => storage)
  const agent = (await agents.create({ clientRequestId: 'a', name: 'A' })).agent
  const room = (await openAgentConversation(agents, rooms, agent.id)).room
  const source = (await rooms.send(room.id, { clientRequestId: 'source', body: 'Reports have five bullet points.' })).message
  const saved = await service.create(agent.id, { clientRequestId: 'save', conversationId: room.id, sourceMessageIds: [source.id],
    content: 'Reports have five bullet points.', type: 'preference' })
  const candidate: AgentMemoryCandidate = { id: 'candidate', phase: 'candidate', participantAgentId: agent.id,
    roomId: room.id, rootRequestId: source.rootRequestId!, status: 'pending',
    candidate: { content: 'Reports have five linked bullet points.', type: 'preference', confidence: .9, importance: .7,
      observedAt: new Date().toISOString(), tags: [], sources: saved.memory.sources },
    action: 'update', targetId: saved.memory.id, targetFingerprint: saved.fingerprint,
    runId: 'memory-run', sourceMessageIds: [source.id] }
  await store.commit({ requestId: 'candidate', checks: [{ kind: 'agent_memory_job', id: candidate.id, expectedRevision: null }],
    puts: [{ kind: 'agent_memory_job', id: candidate.id, roomId: room.id, value: candidate }] })
  return { store, storage, service, agent, candidate, saved }
}
it('shows the old value and creates one protected new version only after explicit acceptance', async () => {
  const f = await fixture()
  const listed = await listAgentMemoryCandidates(f.service, f.agent.id)
  expect(listed.candidates[0].target?.content).toBe(f.saved.memory.content)
  const input = { clientRequestId: 'accept', expectedRevision: 0, decision: 'allow', expectedTargetFingerprint: f.saved.fingerprint }
  const result = await decideAgentMemoryCandidate(f.service, f.agent.id, f.candidate.id, input)
  expect(await decideAgentMemoryCandidate(f.service, f.agent.id, f.candidate.id, input)).toEqual(result)
  const records = await f.storage.list({ agent: { agentId: f.agent.id, manage: true } })
  expect(records).toHaveLength(2)
  const newer = records.find((record) => record.supersedes === f.saved.memory.id)!
  expect(newer.agentContext?.locked).toBe(true)
  expect(newer.content).toBe(f.candidate.candidate.content)
  expect(records.find((record) => record.id === f.saved.memory.id)?.supersededAt).toBeTruthy()
})
it('rejects another Agent and stale decisions without overwriting a user correction', async () => {
  const f = await fixture()
  await expect(decideAgentMemoryCandidate(f.service, 'other-agent', f.candidate.id, {
    clientRequestId: 'wrong', expectedRevision: 0, decision: 'allow', expectedTargetFingerprint: f.saved.fingerprint
  })).rejects.toThrow('not found')
  await f.service.edit(f.agent.id, f.saved.memory.id, { clientRequestId: 'correct', expectedFingerprint: f.saved.fingerprint,
    content: 'Reports have three concise bullet points.' })
  await expect(decideAgentMemoryCandidate(f.service, f.agent.id, f.candidate.id, {
    clientRequestId: 'stale', expectedRevision: 0, decision: 'allow', expectedTargetFingerprint: f.saved.fingerprint
  })).rejects.toThrow('changed')
  await decideAgentMemoryCandidate(f.service, f.agent.id, f.candidate.id, { clientRequestId: 'skip', expectedRevision: 0, decision: 'skip' })
  expect((await f.service.find(f.agent.id, f.saved.memory.id)).content).toContain('three concise')
})
