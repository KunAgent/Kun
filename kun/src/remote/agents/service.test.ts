import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { FileMemoryStore } from '../../memory/memory-store.js'
import { MemoryCapabilityConfig } from '../../contracts/capabilities.js'
import { openAgentConversation } from '../../agents/agent-conversations.js'
import { RemoteAgents, AgentParamSchemas } from './service.js'
import { localCaller } from '../runtime/local-call.js'
import { RemoteReceipts } from '../requests/receipts.js'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { hasOperation } from '@kun/remote-protocol'
import { RoomSchema, RoomMessageSchema } from '../../contracts/rooms.js'
import { putRoomDocument } from '../../rooms/room-service.js'
async function fixture() {
  const f = await remoteFixture()
  f.rooms.deps.memoryStore = new FileMemoryStore({ rootDir: join(f.root, 'memory'), config: MemoryCapabilityConfig.parse({ enabled: true }) })
  const agents = new RemoteAgents(f.runtime, localCaller(f.router, f.runtime)), receipts = new RemoteReceipts(f.rooms)
  const expiresAt = Date.now() + 60000
  const call = async (method: keyof typeof AgentParamSchemas, raw: unknown, id?: string, deviceId?: string) => {
    const p = AgentParamSchemas[method].parse(raw), envelope = f.envelope(method, raw, id, deviceId) as any
    envelope.call.expiresAt = expiresAt
    if (['agent.get', 'agent.memory.list', 'agent.commitments.list'].includes(method)) return agents.dispatch(method, p, envelope) as Promise<any>
    return receipts.execute(envelope, () => agents.dispatch(method, p, envelope)) as Promise<any>
  }
  return { ...f, agents, call, receipts }
}
describe('Personal Agent control', () => {
  it('uses real identity service CAS, stable requests, and strips account/config fields from its projection', async () => {
    const f = await fixture()
    try {
      const created = await f.call('agent.create', { name: 'Phone helper', instructions: 'Help the owner' }, 'create-once')
      const agent = created.result.agent
      expect(created.status).toBe('applied')
      expect((await f.call('agent.create', { name: 'Phone helper', instructions: 'Help the owner' }, 'create-once')).result.agent.id).toBe(agent.id)
      const results = await Promise.all([
        f.call('agent.update', { agentId: agent.id, expectedRevision: 0, title: 'Phone A' }, 'edit-a', 'phone-a'),
        f.call('agent.update', { agentId: agent.id, expectedRevision: 0, title: 'Phone B' }, 'edit-b', 'phone-b')
      ])
      expect(results.filter((entry) => entry.status === 'applied')).toHaveLength(1)
      expect(results.find((entry) => entry.error)?.error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })
      await f.rooms.agents.update(agent.id, { clientRequestId: 'desktop-secret-reference', expectedRevision: 1,
        modelRef: { providerId: 'provider-a', model: 'model-a', accountId: 'private-keychain-reference' },
        capabilityOverrides: { allowedTools: ['private-tool'], blockedTools: [] } })
      const profile = await f.call('agent.get', { agentId: agent.id })
      expect(profile.agent.modelRef).toEqual({ providerId: 'provider-a', model: 'model-a' })
      expect(JSON.stringify(profile)).not.toContain('private-keychain-reference')
      expect(profile.agent.capabilityOverrides).toBeUndefined()
      expect(profile.agent.allowedRepositoryRoots).toBeUndefined()
      for (const field of ['workbench', 'capabilityOverrides', 'allowedRepositoryRoots', 'executor', 'clientRequestId'])
        expect(() => AgentParamSchemas['agent.update'].parse({ agentId: agent.id, expectedRevision: 2, [field]: {} })).toThrow()
    } finally { await f.close() }
  })
  it('accepts only a current ready model reference and never copies raw connection credentials', async () => {
    const f = await fixture()
    try {
      f.runtime.modelConnections = { snapshot: async () => ({ providers: [{ id: 'allowed', name: 'Allowed', kind: 'http',
        configured: true, models: ['model-a'], credentialStatus: 'ready', apiKey: 'fixture-private-key' },
      { id: 'disabled', name: 'Disabled', kind: 'http', configured: true, enabled: false, models: ['model-b'] }] }) } as any
      const created = await f.call('agent.create', { name: 'Models', modelRef: { providerId: 'allowed', model: 'model-a' } })
      const agent = created.result.agent
      const profile = await f.call('agent.get', { agentId: agent.id })
      expect(profile.modelChoices).toEqual([{ providerId: 'allowed', model: 'model-a', label: 'Allowed' }])
      expect(JSON.stringify(profile)).not.toContain('fixture-private-key')
      const invalid = await f.call('agent.update', { agentId: agent.id, expectedRevision: 0, modelRef: { providerId: 'disabled', model: 'model-b' } })
      expect(invalid.error).toEqual({ code: 'MODEL_NOT_AVAILABLE', definitive: true })
      expect(() => AgentParamSchemas['agent.update'].parse({ agentId: agent.id, expectedRevision: 0,
        modelRef: { providerId: 'allowed', model: 'model-a', accountId: 'forged' } })).toThrow()
    } finally { await f.close() }
  })
  it('records local evidence-backed memory and rejects stale edits, forged sources and shared/erase fields', async () => {
    const f = await fixture()
    try {
      const agent = (await f.call('agent.create', { name: 'Memory helper' })).result.agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const source = (await f.rooms.service.send(room.id, { clientRequestId: 'source', body: 'Please remember concise reports' })).message
      const created = await f.call('agent.memory.update', { agentId: agent.id, action: 'create', roomId: room.id,
        sourceMessageIds: [source.id], content: 'Reports should be concise', type: 'preference' }, 'remember-once')
      expect(created.status).toBe('applied')
      const memory = created.result.memory
      const edited = await f.call('agent.memory.update', { agentId: agent.id, action: 'edit', memoryId: memory.id,
        expectedFingerprint: memory.fingerprint, content: 'Reports should be concise and specific' })
      expect(edited.result.memory.content).toContain('specific')
      expect((await f.call('agent.memory.update', { agentId: agent.id, action: 'forget', memoryId: memory.id,
        expectedFingerprint: memory.fingerprint })).error).toEqual({ code: 'REVISION_CONFLICT', definitive: true })
      expect((await f.call('agent.memory.update', { agentId: agent.id, action: 'create', roomId: room.id,
        sourceMessageIds: ['not-a-real-message'], content: 'Invented evidence' })).error.code).toBe('INVALID_REQUEST')
      const page = await f.call('agent.memory.list', { agentId: agent.id })
      expect(page.memories[0].fingerprint).toBe(edited.result.memory.fingerprint)
      expect(page.memories[0].agentContext).toBeUndefined()
      expect(() => AgentParamSchemas['agent.memory.update'].parse({ agentId: agent.id, action: 'edit', memoryId: memory.id,
        expectedFingerprint: memory.fingerprint, sharedProjectRoots: [f.root] })).toThrow()
      const forgotten = await f.call('agent.memory.update', { agentId: agent.id, action: 'forget', memoryId: memory.id,
        expectedFingerprint: edited.result.memory.fingerprint })
      expect(forgotten.result).toEqual({ memoryId: memory.id, forgotten: true })
      expect((await f.call('agent.memory.list', { agentId: agent.id })).memories).toEqual([])
    } finally { await f.close() }
  })
  it('creates commitments only from real private user messages, checks revisions/evidence and keeps cancellation separate from execution', async () => {
    const f = await fixture()
    try {
      const agent = (await f.call('agent.create', { name: 'Work helper' })).result.agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const source = (await f.rooms.service.send(room.id, { clientRequestId: 'work-source', body: 'Track the booking and confirm it' })).message
      const created = await f.call('agent.commitments.act', { agentId: agent.id, action: 'create', roomId: room.id,
        sourceMessageId: source.id, objective: 'Booking', acceptance: 'Confirmation received' })
      const work = created.result.commitment
      expect(work.authorization.kind).toBe('user_message')
      const missing = await f.call('agent.commitments.act', { agentId: agent.id, action: 'update', commitmentId: work.id,
        expectedRevision: 0, status: 'completed' })
      expect(missing.error).toEqual({ code: 'INVALID_REQUEST', definitive: true })
      const completed = await f.call('agent.commitments.act', { agentId: agent.id, action: 'update', commitmentId: work.id,
        expectedRevision: 0, status: 'completed', acceptanceEvidence: [{ summary: 'Owner confirmed booking' }] })
      expect(completed.result.commitment.revision).toBe(1)
      expect((await f.call('agent.commitments.act', { agentId: agent.id, action: 'cancel', commitmentId: work.id,
        expectedRevision: 0 })).error.code).toBe('REVISION_CONFLICT')
      const page = await f.call('agent.commitments.list', { agentId: agent.id })
      expect(page.commitments[0].status).toBe('completed')
      expect((await f.rooms.service.get(room.id)).conversationKind).toBe('user_agent')
    } finally { await f.close() }
  })
  it('keeps archive semantics explicit, rejects active work and advertises real feature availability', async () => {
    const f = await fixture()
    try {
      const agent = (await f.call('agent.create', { name: 'Archive helper' })).result.agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const archived = await f.call('agent.archive', { agentId: agent.id, expectedRevision: 0 })
      expect(archived.result.agent.archived).toBe(true)
      expect((await f.rooms.service.get(room.id)).id).toBe(room.id)
      await f.call('agent.restore', { agentId: agent.id, expectedRevision: 1 })
      await f.rooms.exclusive(() => f.rooms.service.send(room.id, { clientRequestId: 'active-work', body: 'Work on this' }))
      expect((await f.call('agent.archive', { agentId: agent.id, expectedRevision: 2 })).error.code).toBe('TASK_BUSY')
      expect(f.agents.supports('agent.delete')).toBe(false)
      const catalog = { capabilities: [], capabilityDescriptors: await f.agents.descriptors() }
      expect(hasOperation(catalog as any, 'agent.memory.update')).toBe(true)
      f.rooms.deps.memoryStore = undefined
      expect(hasOperation({ capabilities: [], capabilityDescriptors: await f.agents.descriptors() } as any, 'agent.memory.update')).toBe(false)
    } finally { await f.close() }
  })
  it('recovers an Agent created before settlement loss by reading the original service receipt without dispatching again', async () => {
    const f = await fixture()
    try {
      const commit = f.store.commit.bind(f.store), creates = vi.spyOn(f.rooms.agents, 'create')
      let lost = false
      const write = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
        if (!lost && input.requestId.endsWith('-settle')) { lost = true; throw new Error('fixture-settlement-lost') }
        return commit(input)
      })
      await expect(f.call('agent.create', { name: 'Recover helper' }, 'lost-agent')).rejects.toThrow('fixture-settlement-lost')
      const scope = f.envelope('request.get', { requestId: 'lost-agent' }) as any
      const receipt = (await f.receipts.get(scope, 'lost-agent'))!
      expect(receipt.status).toBe('reconciliation_required')
      const restarted = new RemoteAgents(f.runtime, localCaller(f.router, f.runtime))
      const recovered = await restarted.recover(scope, receipt) as any
      expect(recovered.agent.name).toBe('Recover helper')
      expect(creates).toHaveBeenCalledOnce()
      write.mockRestore(); creates.mockRestore()
    } finally { await f.close() }
  })
  it('recovers memory and commitment effects from stable runtime identities after lost remote settlement', async () => {
    const f = await fixture()
    try {
      const agent = (await f.call('agent.create', { name: 'Recovery records' })).result.agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const source = (await f.rooms.service.send(room.id, { clientRequestId: 'recovery-source', body: 'Remember my preference and track this outcome' })).message
      const commit = f.store.commit.bind(f.store)
      let fail = true
      const write = vi.spyOn(f.store, 'commit').mockImplementation(async (input) => {
        if (fail && input.requestId.endsWith('-settle')) { fail = false; throw new Error('fixture-settlement-lost') }
        return commit(input)
      })
      await expect(f.call('agent.memory.update', { agentId: agent.id, action: 'create', roomId: room.id,
        sourceMessageIds: [source.id], content: 'Concise reports' }, 'memory-lost')).rejects.toThrow('fixture-settlement-lost')
      const scope = f.envelope('request.get', { requestId: 'memory-lost' }) as any
      const memory = await f.agents.recover(scope, (await f.receipts.get(scope, 'memory-lost'))!) as any
      expect(memory.memory.content).toBe('Concise reports')
      expect((await f.call('agent.memory.list', { agentId: agent.id })).memories).toHaveLength(1)
      fail = true
      await expect(f.call('agent.commitments.act', { agentId: agent.id, action: 'create', roomId: room.id,
        sourceMessageId: source.id, objective: 'Deliver report', acceptance: 'Owner confirms' }, 'work-lost')).rejects.toThrow('fixture-settlement-lost')
      const work = await f.agents.recover(scope, (await f.receipts.get(scope, 'work-lost'))!) as any
      expect(work.commitment.objective).toBe('Deliver report')
      expect((await f.call('agent.commitments.list', { agentId: agent.id })).commitments).toHaveLength(1)
      write.mockRestore()
    } finally { await f.close() }
  })
  it('rejects group and another Agent sources and binds list cursors to the Agent and filters', async () => {
    const f = await fixture()
    try {
      const agent = (await f.call('agent.create', { name: 'Source owner' })).result.agent
      const other = (await f.call('agent.create', { name: 'Other owner' })).result.agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const source = (await f.rooms.service.send(room.id, { clientRequestId: 'private-source', body: 'Remember these report preferences' })).message
      const group = RoomSchema.parse({ ...room, id: 'group-room', conversationKind: 'group' })
      await putRoomDocument(f.store, 'room', group.id, group.id, group, null)
      const message = RoomMessageSchema.parse({ ...source, id: 'group-source', roomId: group.id })
      await putRoomDocument(f.store, 'message', message.id, group.id, message, null)
      for (const [agentId, roomId, messageId] of [[agent.id, group.id, message.id], [other.id, room.id, source.id]]) {
        expect((await f.call('agent.memory.update', { agentId, action: 'create', roomId,
          sourceMessageIds: [messageId], content: 'Not a private source' })).error.code).toBe('INVALID_REQUEST')
        expect((await f.call('agent.commitments.act', { agentId, action: 'create', roomId,
          sourceMessageId: messageId, objective: 'Task', acceptance: 'Evidence' })).error.code).toBe('INVALID_REQUEST')
      }
      for (let n = 0; n < 3; n++) await f.call('agent.memory.update', { agentId: agent.id, action: 'create',
        roomId: room.id, sourceMessageIds: [source.id], content: 'Preference number ' + n })
      const page = await f.call('agent.memory.list', { agentId: agent.id, limit: 1 })
      const older = await f.call('agent.memory.list', { agentId: agent.id, limit: 1, cursor: page.nextCursor })
      expect(page.hasMore).toBe(true)
      expect(older.memories[0].id).not.toBe(page.memories[0].id)
      await expect(f.call('agent.memory.list', { agentId: other.id, limit: 1, cursor: page.nextCursor })).rejects.toThrow('INVALID_CURSOR')
      await expect(f.call('agent.memory.list', { agentId: agent.id, includeDeleted: true, cursor: page.nextCursor })).rejects.toThrow('INVALID_CURSOR')
    } finally { await f.close() }
  })
  it('paginates large commitment evidence by bytes without clipping or skipping accepted records', async () => {
    const f = await fixture()
    try {
      const agent = (await f.call('agent.create', { name: 'Large board' })).result.agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const source = (await f.rooms.service.send(room.id, { clientRequestId: 'board-source', body: 'Track all of these deliverables' })).message
      for (let n = 0; n < 5; n++) {
        const work = (await f.call('agent.commitments.act', { agentId: agent.id, action: 'create', roomId: room.id,
          sourceMessageId: source.id, objective: 'Deliverable ' + n, acceptance: 'Reviewed' })).result.commitment
        await f.call('agent.commitments.act', { agentId: agent.id, action: 'update', commitmentId: work.id,
          expectedRevision: 0, status: 'completed', acceptanceEvidence: Array.from({ length: 30 }, (_, i) => ({ summary: String(i) + 'x'.repeat(3998) })) })
      }
      const first = await f.call('agent.commitments.list', { agentId: agent.id, limit: 50 })
      expect(first.hasMore).toBe(true)
      const second = await f.call('agent.commitments.list', { agentId: agent.id, limit: 50, cursor: first.nextCursor })
      const combined = [...first.commitments, ...second.commitments]
      expect(new Set(combined.map((item: any) => item.id)).size).toBe(5)
      expect(combined).toHaveLength(5)
      expect(combined.every((item: any) => item.acceptanceEvidence.length === 30)).toBe(true)
      expect(second.hasMore).toBe(false)
    } finally { await f.close() }
  })
  it('retains a long-lived commitment when its original private conversation is archived', async () => {
    const f = await fixture()
    try {
      const agent = (await f.call('agent.create', { name: 'Long-lived work' })).result.agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const source = (await f.rooms.service.send(room.id, { clientRequestId: 'long-source', body: 'Track this beyond the current conversation' })).message
      const work = (await f.call('agent.commitments.act', { agentId: agent.id, action: 'create', roomId: room.id,
        sourceMessageId: source.id, objective: 'Long running outcome', acceptance: 'Confirmed' })).result.commitment
      const current = (await f.store.get('room', room.id))!
      await putRoomDocument(f.store, 'room', room.id, room.id, { ...(current.value as object), archivedAt: new Date().toISOString() }, current)
      expect((await f.call('agent.commitments.list', { agentId: agent.id })).commitments[0].id).toBe(work.id)
      expect((await f.call('agent.commitments.act', { agentId: agent.id, action: 'cancel', commitmentId: work.id,
        expectedRevision: 0 })).result.commitment.status).toBe('cancelled')
    } finally { await f.close() }
  })
})
