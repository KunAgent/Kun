import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HybridMemoryStore } from '../adapters/hybrid/hybrid-memory-store.js'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import type { MemoryStore } from '../memory/memory-store.js'
import { AgentMemoryOwnershipSchema } from '../memory/agent-memory-scope.js'

const stores: Array<{ store: MemoryStore; root: string }> = []
const policy = MemoryCapabilityConfig.parse({ enabled: true, scopes: ['user', 'workspace', 'project'] })
async function fixture(fallback: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'kun-agent-memory-'))
  const store = new HybridMemoryStore({ dataDir: root, config: policy,
    ...(fallback ? { databaseFactory: () => { throw new Error('forced filesystem fallback') } } : {}) })
  await store.ready()
  stores.push({ store, root })
  return store
}
afterEach(async () => {
  for (const { store, root } of stores.splice(0)) {
    await store.shutdown?.(); await rm(root, { recursive: true, force: true })
  }
})
describe.each([false, true])('agent memory ownership (fallback=%s)', (fallback) => {
  it('filters ownership and conversation before ranking, pagination, and all-record listing', async () => {
    const store = await fixture(fallback)
    await store.create({ scope: 'user', content: 'deploy procedure global legacy' })
    const add = (agentId: string, sourceConversationId: string, shared = false, sourceHandoffId?: string) =>
      store.create({ scope: 'user', content: 'deploy procedure evidence ' + agentId + ' ' + sourceConversationId + ' ' + shared + ' ' + sourceHandoffId, agentContext: AgentMemoryOwnershipSchema.parse({
        schemaVersion: 1, agentId, sourceConversationId, shared, sourceHandoffId }) })
    const allowed = await add('ada', 'private')
    const common = await add('ada', 'private', true)
    await add('ada', 'other-room')
    await add('bea', 'private')
    const peer = await add('ada', 'pair', false, 'handoff-one')
    expect((await store.list({ all: true })).map((memory) => memory.agentContext)).toEqual([undefined])
    expect((await store.retrieve({ query: 'deploy procedure', agent: { agentId: 'ada', conversationId: 'private' }, limit: 8 }))
      .map((record) => record.id).sort()).toEqual([allowed.id, common.id].sort())
    expect((await store.list({ agent: { agentId: 'ada', conversationId: 'private' }, limit: 1 }))).toHaveLength(1)
    expect((await store.list({ agent: { agentId: 'ada', conversationId: 'pair', handoffId: 'handoff-two' } }))
      .map((record) => record.id)).toEqual([common.id])
    expect((await store.list({ agent: { agentId: 'ada', conversationId: 'pair', handoffId: 'handoff-one' } }))
      .map((record) => record.id).sort()).toEqual([peer.id, common.id].sort())
  })

  it('rejects unauthorized reads and mutations by ID and honors explicit sharing/revocation', async () => {
    const store = await fixture(fallback)
    const owner = AgentMemoryOwnershipSchema.parse({ schemaVersion: 1, agentId: 'ada', sourceConversationId: 'private' })
    const memory = await store.createWithId!('mem_owned', { scope: 'user', content: 'a durable preference', agentContext: owner })
    await expect(store.getById!(memory.id)).rejects.toThrow('not found')
    await expect(store.update(memory.id, { content: 'overwrite' })).rejects.toThrow('not found')
    await expect(store.delete(memory.id, { agent: { agentId: 'bea', manage: true } })).rejects.toThrow('not found')
    await expect(store.purge!(memory.id)).rejects.toThrow('not found')
    await expect(store.createWithId!(memory.id, { scope: 'user', content: 'forge ownership' })).rejects.toThrow('another scope')
    await expect(store.update(memory.id, { agentContext: { ...owner, shared: true } },
      { agent: { agentId: 'ada', conversationId: 'private' } })).rejects.toThrow('ownership')
    const access = { agent: { agentId: 'ada', manage: true } }
    await store.update(memory.id, { agentContext: { ...owner, sharedConversationIds: ['allowed-room'] } }, access)
    expect(await store.getById!(memory.id, { agent: { agentId: 'ada', conversationId: 'allowed-room' } })).toBeTruthy()
    await store.update(memory.id, { agentContext: owner }, access)
    await expect(store.getById!(memory.id, { agent: { agentId: 'ada', conversationId: 'allowed-room' } })).rejects.toThrow('not found')
    await store.delete(memory.id, access)
    expect(await store.list(access)).toEqual([])
    const replay = await store.createWithId!(memory.id, { scope: 'user', content: memory.content, agentContext: owner })
    expect(replay.deletedAt).toBeTruthy()
  })
})
