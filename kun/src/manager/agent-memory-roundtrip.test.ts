import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ManagerSharedDataStore } from './shared-data-store.js'
import { ManagerRemoteMemoryStore } from './remote-data-stores.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { AgentMemoryOwnershipSchema } from '../memory/agent-memory-scope.js'

const bridge = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('./remote-data-store-request.js', () => ({ callManagerStore: bridge.call }))
const roots: string[] = []
afterEach(async () => { bridge.call.mockReset(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

it('preserves Agent visibility across the real Manager store, remote validation and reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-manager-agent-memory-')); roots.push(root)
  let shared = await ManagerSharedDataStore.create(root)
  bridge.call.mockImplementation(async (_connection, entity, operation, value) => {
    expect(entity).toBe('memory')
    return shared.executeMemory(operation, value)
  })
  const remote = new ManagerRemoteMemoryStore({} as ServiceManagerConnection,
    MemoryCapabilityConfig.parse({ enabled: true }))
  const owner = AgentMemoryOwnershipSchema.parse({ schemaVersion: 1, agentId: 'agent', sourceConversationId: 'private' })
  try {
    await remote.createWithId('mem_agent', { content: 'Reports need source links.', scope: 'user', agentContext: owner })
    expect(await remote.list({ all: true })).toEqual([])
    await expect(remote.getById('mem_agent')).rejects.toThrow('not found')
    expect((await remote.list({ agent: { agentId: 'agent', conversationId: 'private' }, limit: 1 }))).toHaveLength(1)
    expect(await remote.retrieve({ query: 'Reports source links', agent: { agentId: 'other', conversationId: 'private' }, limit: 8 })).toEqual([])
    const before = bridge.call.mock.calls.length
    await remote.getById('mem_agent', { agent: { agentId: 'agent', manage: true } })
    expect(bridge.call.mock.calls.length - before).toBe(1)
    await remote.update('mem_agent', { agentContext: { ...owner, sharedConversationIds: ['group'] } },
      { agent: { agentId: 'agent', manage: true } })
    await shared.close()
    shared = await ManagerSharedDataStore.create(root)
    expect((await remote.retrieve({ query: 'Reports source links', agent: { agentId: 'agent', conversationId: 'group' }, limit: 8 }))).toHaveLength(1)
    await remote.update('mem_agent', { agentContext: owner }, { agent: { agentId: 'agent', manage: true } })
    expect(await remote.retrieve({ query: 'Reports source links', agent: { agentId: 'agent', conversationId: 'group' }, limit: 8 })).toEqual([])
    await expect(remote.purge('mem_agent')).rejects.toThrow('not found')
    await remote.delete('mem_agent', { agent: { agentId: 'agent', manage: true } })
    expect(await remote.retrieve({ query: 'Reports source links', agent: { agentId: 'agent', conversationId: 'private' }, limit: 8 })).toEqual([])
  } finally { await shared.close() }
})
