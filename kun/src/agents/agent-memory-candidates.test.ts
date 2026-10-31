import { afterEach, expect, it, vi } from 'vitest'
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
it('saves a target-less reviewed candidate as a new memory only after explicit acceptance', async () => {
  const f = await fixture()
  const held: AgentMemoryCandidate = { id: 'held-candidate', phase: 'candidate', participantAgentId: f.agent.id,
    roomId: f.candidate.roomId, rootRequestId: f.candidate.rootRequestId, status: 'pending',
    candidate: { content: 'Reports should link every source inline.', type: 'preference', confidence: .9, importance: .7,
      observedAt: new Date().toISOString(), tags: [], sources: f.saved.memory.sources },
    action: 'create', captureScope: { conversationId: f.candidate.roomId },
    reason: "invalid-relation 'related' (candidate #0): comparisons quarantined; review required before this candidate can be saved",
    runId: 'memory-run', sourceMessageIds: f.candidate.sourceMessageIds }
  await f.store.commit({ requestId: 'held-candidate', checks: [{ kind: 'agent_memory_job', id: held.id, expectedRevision: null }],
    puts: [{ kind: 'agent_memory_job', id: held.id, roomId: held.roomId, value: held }] })
  const listed = await listAgentMemoryCandidates(f.service, f.agent.id)
  const entry = listed.candidates.find((item) => item.candidate.id === 'held-candidate')!
  expect(entry.target).toBeUndefined()
  await decideAgentMemoryCandidate(f.service, f.agent.id, 'held-candidate', {
    clientRequestId: 'accept-held', expectedRevision: entry.revision, decision: 'allow' })
  const records = await f.storage.list({ agent: { agentId: f.agent.id, manage: true } })
  expect(records).toHaveLength(2)
  const created = records.find((record) => record.content === 'Reports should link every source inline.')!
  expect(created.agentContext?.locked).toBe(true)
  // The pre-existing memory is untouched: approval did not supersede it.
  expect(records.find((record) => record.id === f.saved.memory.id)?.supersededAt).toBeFalsy()
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

it.each([
  { conversationId: 'origin-room', taskId: 'task-a', handoffId: 'handoff-a' },
  { conversationId: 'origin-room', handoffId: 'handoff-a' },
  { conversationId: 'origin-room' }
])('preserves targetless capture isolation and retries without duplicate memory: %j', async (captureScope) => {
  const f = await fixture()
  const held: AgentMemoryCandidate = { ...f.candidate, id: 'scoped', action: 'create',
    targetId: undefined, targetFingerprint: undefined, captureScope }
  await f.store.commit({ requestId: 'scoped', checks: [{ kind: 'agent_memory_job', id: held.id, expectedRevision: null }], puts: [{ kind: 'agent_memory_job', id: held.id, roomId: held.roomId, value: held }] })
  const forgotten = vi.spyOn(f.storage, 'isForgotten')
  await listAgentMemoryCandidates(f.service, f.agent.id)
  expect(forgotten.mock.calls.some(([record]) => record.agentContext?.sourceConversationId === captureScope.conversationId &&
    record.agentContext?.sourceTaskId === captureScope.taskId && record.agentContext?.sourceHandoffId === captureScope.handoffId)).toBe(true)
  forgotten.mockRestore()
  const input = { clientRequestId: 'accept-scoped', expectedRevision: 0, decision: 'allow' }
  await expect(decideAgentMemoryCandidate(f.service, f.agent.id, held.id, {
    ...input, clientRequestId: 'unexpected-target', expectedTargetFingerprint: f.saved.fingerprint
  })).rejects.toThrow('no valid target or capture scope')
  // Canonical memory persists, but the room-store acknowledgement fails once.
  const commit = f.store.commit.bind(f.store)
  const spy = vi.spyOn(f.store, 'commit').mockImplementationOnce(async () => { throw new Error('lost acknowledgement') })
  await expect(decideAgentMemoryCandidate(f.service, f.agent.id, held.id, input)).rejects.toThrow('lost acknowledgement')
  spy.mockImplementation(commit)
  await expect(decideAgentMemoryCandidate(f.service, f.agent.id, held.id, {
    ...input, clientRequestId: 'unexpected-target-after-write', expectedTargetFingerprint: f.saved.fingerprint
  })).rejects.toThrow('no valid target or capture scope')
  const result = await decideAgentMemoryCandidate(f.service, f.agent.id, held.id, input)
  expect(await decideAgentMemoryCandidate(f.service, f.agent.id, held.id, input)).toEqual(result)
  const accepted = await f.store.get<AgentMemoryCandidate>('agent_memory_job', held.id)
  expect(accepted?.value.memoryId).toBeTruthy()
  const created = await f.storage.getById(accepted!.value.memoryId!, { agent: { agentId: f.agent.id, manage: true } })
  expect(created?.agentContext).toMatchObject({ sourceConversationId: captureScope.conversationId,
    shared: false, locked: true })
  expect(created?.agentContext?.sourceTaskId).toBe(captureScope.taskId)
  expect(created?.agentContext?.sourceHandoffId).toBe(captureScope.handoffId)
  const matching = await f.storage.list({ agent: { agentId: f.agent.id, ...captureScope } })
  expect(matching.some((record) => record.id === created!.id)).toBe(true)
  const other = await f.storage.list({ agent: { agentId: f.agent.id, conversationId: held.roomId, taskId: 'other-task', handoffId: 'other-handoff' } })
  expect(other.some((record) => record.id === created!.id)).toBe(false)
  expect(await f.storage.list({ agent: { agentId: f.agent.id, manage: true } })).toHaveLength(2)
  spy.mockRestore()
})
it.each(['create', 'update', 'supersede'] as const)('rejects targetless %s without a trustworthy create scope', async (action) => {
  const f = await fixture()
  const held: AgentMemoryCandidate = { ...f.candidate, id: 'unsafe', action, targetId: undefined,
    ...(action === 'create' ? {} : { captureScope: { conversationId: f.candidate.roomId } }) }
  await f.store.commit({ requestId: 'unsafe', checks: [{ kind: 'agent_memory_job', id: held.id, expectedRevision: null }], puts: [{ kind: 'agent_memory_job', id: held.id, roomId: held.roomId, value: held }] })
  await expect(decideAgentMemoryCandidate(f.service, f.agent.id, held.id, {
    clientRequestId: 'unsafe-accept', expectedRevision: 0, decision: 'allow'
  })).rejects.toThrow('no valid target or capture scope')
  expect(await f.storage.list({ agent: { agentId: f.agent.id, manage: true } })).toHaveLength(1)
})
