import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { testGraphConfig, testGraphPlan } from '../graph/graph-test-fixtures.test-support.js'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { ManagerRemoteThreadStore } from './remote-data-stores.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'
import { ManagerSharedDataStore } from './shared-data-store.js'
import { requiresAtomicReplace } from './shared-data-store-core.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function dataStore(): Promise<ManagerSharedDataStore> {
  const root = await mkdtemp(join(tmpdir(), 'kun-manager-data-'))
  roots.push(root)
  return ManagerSharedDataStore.create(join(root, 'data'))
}

describe('manager atomic JSON policy', () => {
  it('requires atomic replacement only for provider and credential registries', () => {
    const dataDir = '/tmp/kun-data'
    expect(requiresAtomicReplace(dataDir, join(dataDir, 'model-connections.v1.json'))).toBe(true)
    expect(requiresAtomicReplace(dataDir, join(dataDir, 'credentials', 'credentials.enc.json'))).toBe(true)
    expect(requiresAtomicReplace(dataDir, join(dataDir, 'extensions', 'accounts.json'))).toBe(true)
    expect(requiresAtomicReplace(dataDir, join(dataDir, 'extensions', 'provider-bindings.json'))).toBe(true)
    expect(requiresAtomicReplace(dataDir, join(dataDir, 'cache', 'models.json'))).toBe(false)
  })
})

describe('manager shared data store', () => {
  it('proxies the lock-free item text search so palette deep search works in shared mode', async () => {
    const store = await dataStore()
    const thread = createThreadRecord({
      id: 'thread-search', title: 'Search', workspace: '/tmp/workspace', model: 'test-model'
    })
    const turn = createTurnRecord({
      id: 'turn-search', threadId: thread.id, prompt: 'search', model: 'test-model'
    })
    const createdAt = '2026-08-15T00:00:00.000Z'
    await store.executeThread('upsert', { thread })
    await store.executeSession('appendItem', {
      threadId: thread.id,
      item: {
        id: 'msg-1', kind: 'user_message', turnId: turn.id, threadId: thread.id,
        role: 'user', status: 'completed', createdAt,
        text: 'Please rework the checkout flow end to end.'
      }
    })

    // The GUI's shared runtime reaches the store through this proxy. Before
    // `searchItemText` was allowlisted here it silently resolved to nothing,
    // so deep search returned no matches in the real app.
    await expect(store.executeSession('searchItemText', {
      threadId: thread.id, query: 'checkout'
    })).resolves.toBe('Please rework the checkout flow end to end.')
    await expect(store.executeSession('searchItemText', {
      threadId: thread.id, query: 'absent'
    })).resolves.toBeNull()
    await expect(store.executeSession('searchItemText', {
      threadId: thread.id, query: 'checkout', deadlineAtMs: Date.now() - 1
    })).resolves.toBeNull()
    await store.close()
  })


  it('serializes canonical thread mutations without changing the existing format', async () => {
    const store = await dataStore()
    const thread = createThreadRecord({
      id: 'thread-shared',
      title: 'Shared',
      workspace: '/tmp/workspace',
      model: 'test-model'
    })
    await store.executeThread('upsert', { thread })
    expect(await store.executeThread('get', { threadId: thread.id })).toMatchObject({
      id: thread.id,
      title: 'Shared'
    })
    await store.close()
  })

  it('serves stable workspace pages through the manager thread data plane', async () => {
    const store = await dataStore()
    for (const [index, createdAt] of [
      '2026-08-14T00:00:01.000Z',
      '2026-08-14T00:00:02.000Z',
      '2026-08-14T00:00:03.000Z'
    ].entries()) {
      const thread = createThreadRecord({
        id: `thread-page-${index + 1}`,
        title: `Page ${index + 1}`,
        workspace: '/tmp/page-workspace',
        model: 'test-model',
        createdAt
      })
      await store.executeThread('upsert', { thread })
    }

    const first = await store.executeThread('listPage', {
      workspace: '/tmp/page-workspace',
      limit: 2,
      includeArchived: true,
      includeSide: true
    }) as {
      threads: Array<{ id: string }>
      nextCursor?: string
      hasMore: boolean
      total?: number
    }
    expect(first.threads.map((thread) => thread.id)).toEqual(['thread-page-3', 'thread-page-2'])
    expect(first).toMatchObject({ hasMore: true, total: 3 })
    expect(first.nextCursor).toBeTruthy()

    const second = await store.executeThread('listPage', {
      workspace: '/tmp/page-workspace',
      limit: 2,
      cursor: first.nextCursor,
      includeArchived: true,
      includeSide: true
    }) as { threads: Array<{ id: string }>; hasMore: boolean; total?: number }
    expect(second.threads.map((thread) => thread.id)).toEqual(['thread-page-1'])
    expect(second).toMatchObject({ hasMore: false })
    expect(second.total).toBeUndefined()

    await expect(store.executeThread('list', { lean: true })).rejects.toThrow()
    await store.close()
  })

  it('forwards the timeline anchor option through the manager page read', async () => {
    const store = await dataStore()
    const threadId = 'thread-anchor-manager'
    const turnId = 'turn-anchor-manager'
    await store.executeSession('appendItem', {
      threadId,
      item: {
        id: 'user_active',
        turnId,
        threadId,
        role: 'user',
        status: 'completed',
        createdAt: 't0',
        kind: 'user_message',
        text: 'fix the pipeline'
      }
    })
    for (let index = 0; index < 9; index += 1) {
      await store.executeSession('appendItem', {
        threadId,
        item: {
          id: `process_${index}`,
          turnId,
          threadId,
          role: 'assistant',
          status: 'completed',
          createdAt: `t${index + 1}`,
          kind: 'assistant_text',
          text: `process ${index}`
        }
      })
    }
    const page = await store.executeSession('loadItemPage', {
      threadId,
      options: { anchorTurnId: turnId, maxItems: 5, maxBytes: 4 * 1024 * 1024 }
    }) as { items: Array<{ id: string }>; hasMore: boolean; nextCursor?: string }
    expect(page.items.map((item) => item.id)).toEqual([
      'user_active', 'process_5', 'process_6', 'process_7', 'process_8'
    ])
    expect(page).toMatchObject({ hasMore: true, nextCursor: 'process_5' })
    await store.close()
  })

  it('persists the current workspace-view composer context contract', async () => {
    const store = await dataStore()
    const thread = createThreadRecord({
      id: 'thread-workspace-view-context',
      title: 'Workspace view context',
      workspace: '/tmp/workspace',
      model: 'test-model'
    })
    const composerContext = {
      schemaVersion: 1 as const,
      id: 'workspace-tree',
      title: 'Workspace tree',
      summary: 'Selected workspace view',
      reference: { view: 'tree' },
      revision: 1,
      generation: 1,
      attachmentId: `workspace-view-context:${'a'.repeat(64)}`,
      provenance: {
        source: 'workspace-view' as const,
        workspaceId: 'b'.repeat(64)
      }
    }
    const turn = createTurnRecord({
      id: 'turn-workspace-view-context',
      threadId: thread.id,
      prompt: 'Use the workspace view',
      composerContexts: [composerContext]
    })
    const userItem = {
      id: 'item-workspace-view-context',
      turnId: turn.id,
      threadId: thread.id,
      role: 'user' as const,
      status: 'completed' as const,
      createdAt: '2026-08-14T00:00:00.000Z',
      kind: 'user_message' as const,
      text: 'Use the workspace view',
      composerContexts: [composerContext]
    }

    await store.executeThread('upsert', {
      thread: { ...thread, turns: [{ ...turn, items: [userItem] }] }
    })
    await store.executeSession('appendItem', { threadId: thread.id, item: userItem })

    await expect(store.executeThread('get', { threadId: thread.id })).resolves.toMatchObject({
      turns: [{ composerContexts: [composerContext] }]
    })
    await expect(store.executeSession('loadItems', { threadId: thread.id })).resolves.toEqual([
      expect.objectContaining({ composerContexts: [composerContext] })
    ])
    await store.close()
  })

  it('rejects unknown loadItemPage options through the strict manager schema', async () => {
    const store = await dataStore()
    await expect(store.executeSession('loadItemPage', {
      threadId: 'thread-strict',
      options: { before: 'x', maxItems: 5, maxBytes: 64, unexpectedKey: true }
    })).rejects.toThrow()
    await store.close()
  })

  it('allocates unique monotonic event sequences across concurrent runtime clients', async () => {
    const store = await dataStore()
    const threadId = 'thread-sequences'
    const sequences = await Promise.all(Array.from({ length: 100 }, () =>
      store.executeSession('allocateEventSeq', { threadId }) as Promise<number>
    ))
    expect([...sequences].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1)
    )
    await Promise.all(sequences.map((seq) => store.executeSession('appendEvent', {
      threadId,
      event: {
        kind: 'heartbeat',
        threadId,
        seq,
        timestamp: new Date(1_800_000_000_000 + seq).toISOString()
      }
    })))
    const persisted = await store.executeSession('loadEventsSince', {
      threadId,
      sinceSeq: 0
    }) as Array<{ seq: number }>
    expect(persisted).toHaveLength(100)
    expect(new Set(persisted.map((event) => event.seq)).size).toBe(100)
    await store.close()
  })

  it('rejects an unreserved duplicate event sequence', async () => {
    const store = await dataStore()
    const event = {
      kind: 'heartbeat' as const,
      threadId: 'thread-duplicate',
      seq: 1,
      timestamp: '2026-08-01T00:00:00.000Z'
    }
    await store.executeSession('appendEvent', { threadId: event.threadId, event })
    await expect(store.executeSession('appendEvent', {
      threadId: event.threadId,
      event: { ...event, timestamp: '2026-08-01T00:00:01.000Z' }
    })).rejects.toThrow(/high-water/u)
    await store.close()
  })

  it('settles open session items exactly once when a runtime owner lease expires', async () => {
    const store = await dataStore()
    const thread = createThreadRecord({
      id: 'thread-lease',
      title: 'Lease recovery',
      workspace: '/tmp/workspace',
      model: 'test-model'
    })
    const turn = createTurnRecord({
      id: 'turn-lease',
      threadId: thread.id,
      prompt: 'Continue the interrupted tool call',
      status: 'running'
    })
    await store.executeThread('upsert', {
      thread: { ...thread, status: 'running', turns: [turn] }
    })
    const createdAt = '2026-08-06T00:00:00.000Z'
    const items = [
      {
        id: 'call-open', kind: 'tool_call', turnId: turn.id, threadId: thread.id,
        role: 'assistant', status: 'running', createdAt,
        toolName: 'read_file', callId: 'call-1', toolKind: 'tool_call', arguments: {}
      },
      {
        id: 'result-open', kind: 'tool_result', turnId: turn.id, threadId: thread.id,
        role: 'tool', status: 'running', createdAt,
        toolName: 'read_file', callId: 'call-1', toolKind: 'tool_call', output: '', isError: false
      },
      {
        id: 'approval-open', kind: 'approval', turnId: turn.id, threadId: thread.id,
        role: 'tool', status: 'pending', createdAt,
        approvalId: 'approval-1', toolName: 'read_file', summary: 'Read a file'
      },
      {
        id: 'input-open', kind: 'user_input', turnId: turn.id, threadId: thread.id,
        role: 'tool', status: 'pending', createdAt,
        inputId: 'input-1', prompt: 'Choose', questions: []
      }
    ]
    for (const item of items) await store.executeSession('appendItem', { threadId: thread.id, item })

    const lease = {
      threadId: thread.id,
      turnId: turn.id,
      ownerFlavor: 'production' as const,
      ownerInstanceId: 'runtime-dead',
      acquiredAt: '2026-08-06T00:00:00.000Z',
      expiresAt: '2026-08-06T00:01:00.000Z'
    }
    expect(await store.reconcileExpiredLease(lease)).toBe(true)

    const recovered = await store.executeSession('loadItems', { threadId: thread.id }) as Array<{
      id: string
      kind: string
      status: string
      code?: string
    }>
    expect(recovered.map((item) => [item.id, item.status])).toEqual(expect.arrayContaining([
      ['call-open', 'failed'],
      ['result-open', 'failed'],
      ['approval-open', 'expired'],
      ['input-open', 'cancelled'],
      ['item_turn-lease_owner_lease_expired', 'failed']
    ]))
    expect(recovered.find((item) => item.id === 'item_turn-lease_owner_lease_expired')).toMatchObject({
      kind: 'error', code: 'owner_lease_expired'
    })
    const persisted = await store.executeThread('get', { threadId: thread.id }) as {
      turns: Array<{ status: string }>
    }
    expect(persisted.turns[0]?.status).toBe('failed')
    expect(await store.reconcileExpiredLease(lease)).toBe(false)
    const events = await store.executeSession('loadEventsSince', { threadId: thread.id, sinceSeq: 0 }) as Array<{
      kind: string
      code?: string
    }>
    expect(events.filter((event) => event.code === 'owner_lease_expired')).toHaveLength(1)
    await store.close()
  })

  it('serializes revisioned atomic JSON writes through the manager', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-manager-json-'))
    roots.push(root)
    const dataDir = join(root, 'data')
    const path = join(dataDir, 'extensions', 'registry.json')
    const store = await ManagerSharedDataStore.create(dataDir)
    expect(await store.readAtomicJson(path)).toEqual({ revision: 0, value: null })

    await store.writeAtomicJson({ path, expectedRevision: 0, value: { revision: 1 } })
    await expect(store.writeAtomicJson({
      path,
      expectedRevision: 0,
      value: { revision: 2 }
    })).rejects.toMatchObject({ currentRevision: 1 })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ revision: 1 })
    await store.deleteAtomicJson({ path, expectedRevision: 1 })
    expect(await store.readAtomicJson(path)).toEqual({ revision: 2, value: null })
    await store.close()
  })

  it('refuses atomic JSON access outside the canonical data directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-manager-json-boundary-'))
    roots.push(root)
    const store = await ManagerSharedDataStore.create(join(root, 'data'))
    await expect(store.readAtomicJson(join(root, 'outside.json'))).rejects.toThrow(/below/u)
    await store.close()
  })

  it('owns artifact writes and deduplicates content for both runtime flavors', async () => {
    const store = await dataStore()
    const first = await store.executeArtifact('put', {
      input: { content: 'shared artifact', source: 'tool', origin: 'production' }
    }) as { meta: { id: string }; deduped: boolean }
    const second = await store.executeArtifact('put', {
      input: { content: 'shared artifact', source: 'tool', origin: 'development' }
    }) as { meta: { id: string; origins?: string[] }; deduped: boolean }

    expect(first.deduped).toBe(false)
    expect(second.deduped).toBe(true)
    expect(second.meta.id).toBe(first.meta.id)
    expect(second.meta.origins).toEqual(['production', 'development'])
    expect(await store.executeArtifact('get', { id: first.meta.id })).toBe('shared artifact')
    await store.close()
  })

  it('serializes shared memory mutations through one manager-owned store', async () => {
    const store = await dataStore()
    const config = { enabled: true, scopes: ['user', 'workspace', 'project'], maxInjectedRecords: 8 }
    const created = await store.executeMemory('createWithId', {
      config,
      value: {
        id: 'mem_shared_test',
        input: {
          content: 'Use the shared data plane.',
          scope: 'workspace',
          workspace: '/tmp/shared-workspace'
        }
      }
    }) as { id: string }
    expect(created.id).toBe('mem_shared_test')

    const listed = await store.executeMemory('list', {
      config,
      value: { workspace: '/tmp/shared-workspace' }
    }) as Array<{ id: string }>
    expect(listed.map((record) => record.id)).toContain('mem_shared_test')
    await store.close()
  })

  it('owns Graph journals and snapshots for both runtime clients', async () => {
    const store = await dataStore()
    const config = testGraphConfig()
    await store.executeGraph('create', {
      config,
      value: {
        runId: 'run_manager_shared',
        threadId: 'thread_manager_shared',
        projectId: 'project_manager_shared',
        sourceTurnId: 'turn_manager_shared',
        plan: testGraphPlan(),
        commandId: 'command_manager_shared',
        idempotencyKey: 'manager-shared-create'
      }
    })
    const listed = await store.executeGraph('list', {
      config,
      value: { threadId: 'thread_manager_shared' }
    }) as Array<{ id: string }>
    expect(listed.map((run) => run.id)).toEqual(['run_manager_shared'])
    await store.close()
  })

  it('owns attachment content and scope mutations', async () => {
    const store = await dataStore()
    const config = DEFAULT_KUN_CAPABILITIES_CONFIG.attachments
    const created = await store.executeAttachment('create', {
      config,
      value: {
        name: 'shared.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('shared attachment').toString('base64'),
        documentText: 'shared attachment',
        threadId: 'thread_attachment'
      }
    }) as { id: string }
    const resolved = await store.executeAttachment('resolveContent', {
      config,
      value: { id: created.id, scope: { threadId: 'thread_attachment' } }
    }) as { dataBase64: string }
    expect(Buffer.from(resolved.dataBase64, 'base64').toString()).toBe('shared attachment')
    await store.close()
  })

  it('executes compare-and-swap thread writes through the manager HTTP data plane', async () => {
    // Regression: pruneThread() commits retention through upsertIfRevision, but
    // the router allowlist rejected the operation, so remote runtimes failed
    // after the history had already been archived (partial success). This test
    // drives the full path: remote client -> HTTP router -> shared data store.
    const store = await dataStore()
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state: new ServiceManagerState(),
      sharedData: store
    })
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
    try {
      const connection: ServiceManagerConnection = {
        discovery: {
          version: 1,
          protocolVersion: 3,
          instanceId: 'manager-a',
          pid: process.pid,
          startedAt: '2026-08-01T00:00:00.000Z',
          host: '127.0.0.1',
          port: server.port,
          baseUrl: `http://127.0.0.1:${server.port}`,
          managerToken: 'manager-secret',
          serviceVersion: '0.1.0',
          dataDir: '/tmp/kun-data',
          settingsPath: '/tmp/kun-settings.json'
        }
      }
      const remote = new ManagerRemoteThreadStore(connection)
      const thread = createThreadRecord({
        id: 'thread_remote_cas',
        title: 'Before retention',
        workspace: '/tmp/workspace',
        model: 'test-model'
      })
      const created = await remote.upsert(thread)

      const committed = await remote.upsertIfRevision(
        { ...thread, title: 'Retention applied' },
        created.revision ?? 0
      )
      expect(committed).toMatchObject({ applied: true })

      const stale = await remote.upsertIfRevision(
        { ...thread, title: 'Stale snapshot' },
        created.revision ?? 0
      )
      expect(stale).toMatchObject({ applied: false, revision: committed.revision })

      await expect(remote.get(thread.id)).resolves.toMatchObject({
        title: 'Retention applied',
        revision: committed.revision
      })
    } finally {
      await server.close()
      await store.close()
    }
  })
})
