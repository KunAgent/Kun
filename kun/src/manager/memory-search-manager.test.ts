import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { buildMemoryReadTools } from '../adapters/tool/memory-read-tools.js'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { ManagerRemoteMemoryStore } from './remote-memory-store.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'
import { ManagerSharedDataStore } from './shared-data-store.js'

it('preserves tool policy through HTTP validation and backing retrieval without changing injection policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-memory-search-manager-'))
  const dataDir = join(root, 'data')
  const owner = await ManagerSharedDataStore.create(dataDir)
  const startedAt = new Date().toISOString()
  const server = await startNodeHttpServer({
    router: buildServiceManagerRouter({
      managerToken: 'test-token', instanceId: 'search-test', startedAt,
      state: new ServiceManagerState(), sharedData: owner
    }), host: '127.0.0.1', port: 0
  })
  const connection: ServiceManagerConnection = { discovery: {
    version: 1, protocolVersion: 6, instanceId: 'search-test', pid: process.pid,
    startedAt, host: '127.0.0.1', port: server.port, baseUrl: `http://127.0.0.1:${server.port}`,
    managerToken: 'test-token', serviceVersion: '0.4.4', dataDir, settingsPath: join(root, 'settings.json')
  } }
  const runtimePolicy = MemoryCapabilityConfig.parse({ enabled: true, maxInjectedRecords: 1 })
  const store = new ManagerRemoteMemoryStore(connection, runtimePolicy)
  const context: ToolHostContext = {
    threadId: 'thread', turnId: 'turn', workspace: join(root, 'workspace'), approvalPolicy: 'auto',
    abortSignal: new AbortController().signal, awaitApproval: async () => 'allow',
    memoryPolicy: { enabled: true, scopes: ['workspace'] }
  }
  const tools = buildMemoryReadTools(store)
  const execute = (name: string, args: Record<string, unknown>, ctx = context) =>
    tools.find((tool) => tool.name === name)!.execute(args, ctx)
  const search = async (args: Record<string, unknown>, ctx = context) => {
    const result = await execute('memory_search', { query: 'recorder', ...args }, ctx)
    expect(result.isError).not.toBe(true)
    return (result.output as { memories: Array<{ id: string }> }).memories
  }
  try {
    for (let index = 0; index < 22; index += 1) {
      await store.createWithId(`mem_workspace_${index}`, {
        content: `recorder workspace reference ${index}`, scope: 'workspace', workspace: context.workspace
      })
    }
    const directive = await store.createWithId('mem_directive', {
      content: 'recorder should retain source links', authority: 'directive', scope: 'workspace', workspace: context.workspace
    })
    const user = await store.createWithId('mem_user', { content: 'recorder user reference', scope: 'user' })
    const foreign = await store.createWithId('mem_foreign', {
      content: 'recorder foreign workspace reference', scope: 'workspace', workspace: join(root, 'other')
    })
    await store.createWithId('mem_agent', { content: 'recorder private agent reference', scope: 'user',
      agentContext: { schemaVersion: 1, agentId: 'private-agent', sourceConversationId: 'private' } })
    // Old protocol-6 Managers retain this strict shape; no schema relaxation is needed.
    const invalid = await fetch(`${connection.discovery.baseUrl}/v1/data/memory/retrieve`, {
      method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ config: runtimePolicy, value: { query: 'recorder', limit: 3, policy: runtimePolicy } })
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'validation_error' })
    const initial = await store.retrieve({ query: 'recorder', workspace: context.workspace, limit: 20 })
    expect(initial).toHaveLength(1)
    expect(initial[0]!.authority).toBe('reference')
    const before = await store.diagnostics()
    expect(before.lastRetrieval).toBeDefined()

    const results = await search({ limit: 3 })
    expect(results).toHaveLength(3)
    expect(results.map((record) => record.id)).not.toContain(user.id)
    expect(results.map((record) => record.id)).not.toContain(foreign.id)
    expect(await search({ limit: 100 })).toHaveLength(20)
    expect(await search({ authority: 'directive' })).toEqual([expect.objectContaining({ id: directive.id })])
    expect(await search({ scope: 'user' })).toEqual([])
    expect(await search({}, { ...context, memoryPolicy: { enabled: true, scopes: [] } })).toEqual([])
    expect((await store.diagnostics()).lastRetrieval).toEqual(before.lastRetrieval)

    const listed = await execute('memory_list', { limit: 20 })
    const listedIds = (listed.output as { memories: Array<{ id: string }> }).memories.map((record) => record.id)
    expect(listedIds).toHaveLength(20)
    expect(listedIds).toContain(directive.id)
    expect(listedIds).not.toContain(user.id)
    expect(listedIds).not.toContain(foreign.id)
    expect((await execute('memory_read', { id: directive.id })).isError).not.toBe(true)
    expect((await execute('memory_read', { id: user.id })).isError).toBe(true)
    expect((await execute('memory_read', { id: foreign.id })).isError).toBe(true)

    const ordinary = await store.retrieve({ query: 'recorder', workspace: context.workspace, limit: 20 })
    expect(ordinary).toEqual(initial)
    expect(runtimePolicy.maxInjectedRecords).toBe(1)
    expect(await store.retrieve({ query: 'recorder', limit: 20,
      policy: MemoryCapabilityConfig.parse({ enabled: false }) })).toEqual([])
    expect(await store.retrieve({ query: 'recorder', limit: 20,
      policy: MemoryCapabilityConfig.parse({ enabled: true, scopes: ['user'], maxInjectedRecords: 5 }) }))
      .toEqual([expect.objectContaining({ id: user.id })])
  } finally {
    await server.close()
    await owner.close()
    await rm(root, { recursive: true, force: true })
  }
})
