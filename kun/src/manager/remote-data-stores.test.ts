import { afterEach, describe, expect, it, vi } from 'vitest'
import { createThreadRecord, toThreadSummary } from '../domain/thread.js'
import type { ServiceManagerConnection } from './manager-client.js'
import {
  ManagerRemoteArtifactStore,
  ManagerRemoteAttachmentStore,
  ManagerRemoteGraphRunStore,
  ManagerRemoteMemoryStore,
  ManagerRemoteSessionStore,
  ManagerRemoteThreadStore,
  resolveManagerDataRequestTimeoutMs
} from './remote-data-stores.js'
import { USAGE_QUERY_TIMEOUT_MS } from './usage-query-executor.js'
import { runWithTurnMutationFence } from './turn-mutation-context.js'
import {
  AttachmentsCapabilityConfig,
  MemoryCapabilityConfig
} from '../contracts/capabilities.js'
import { DEFAULT_GRAPH_RUNTIME_CONFIG } from '../config/kun-config.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function managerConnection(): ServiceManagerConnection {
  return {
    discovery: {
      version: 1,
      protocolVersion: 5,
      instanceId: 'manager-read-compatibility',
      pid: process.pid,
      startedAt: '2026-08-14T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18700,
      baseUrl: 'http://127.0.0.1:18700',
      managerToken: 'manager-secret',
      serviceVersion: '0.1.0',
      dataDir: '/tmp/kun-data',
      settingsPath: '/tmp/kun-settings.json'
    }
  }
}

function legacyHalfBoundThread() {
  return createThreadRecord({
    id: 'thr_legacy_half_bound',
    title: 'Legacy plan build',
    workspace: '/tmp/legacy-plan-build',
    model: 'test-model',
    planBuildRunId: 'run-legacy-1'
  })
}

function stubManagerResult(result: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ result }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )))
}

describe('resolveManagerDataRequestTimeoutMs', () => {
  it('allows cold timeline scans to outlive ordinary manager data requests', () => {
    expect(resolveManagerDataRequestTimeoutMs('session', 'highestSeq')).toBe(120_000)
    expect(resolveManagerDataRequestTimeoutMs('session', 'loadItemPage')).toBe(120_000)
    expect(resolveManagerDataRequestTimeoutMs('session', 'aggregateUsage')).toBe(30_000)
    expect(USAGE_QUERY_TIMEOUT_MS).toBeLessThan(
      resolveManagerDataRequestTimeoutMs('session', 'aggregateUsage')
    )
    expect(resolveManagerDataRequestTimeoutMs('session', 'loadItems')).toBe(30_000)
    expect(resolveManagerDataRequestTimeoutMs('thread', 'get')).toBe(30_000)
  })
})

describe('ManagerRemoteSessionStore live items', () => {
  it('attaches the exact turn fence to semantic mutations', async () => {
    let requestBody = ''
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body ?? '')
      return new Response(JSON.stringify({ result: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const store = new ManagerRemoteSessionStore(managerConnection())
    const fence = {
      threadId: 'thread-fenced',
      turnId: 'turn-fenced',
      ownerFlavor: 'production' as const,
      ownerInstanceId: 'runtime-fenced',
      fencingToken: 7
    }
    await runWithTurnMutationFence(fence, () => store.appendItem(fence.threadId, {
      id: 'item-fenced',
      turnId: fence.turnId,
      threadId: fence.threadId,
      role: 'assistant',
      status: 'completed',
      createdAt: '2026-08-29T00:00:00.000Z',
      kind: 'assistant_text',
      text: 'late result'
    }))

    expect(JSON.parse(requestBody)).toEqual({
      value: expect.objectContaining({ threadId: fence.threadId }),
      turnFence: fence
    })
  })

  it('does not attach a parent turn fence to a cross-thread item mutation', async () => {
    let requestBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ result: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const store = new ManagerRemoteSessionStore(managerConnection())
    const parentFence = {
      threadId: 'thread-parent',
      turnId: 'turn-parent',
      ownerFlavor: 'production' as const,
      ownerInstanceId: 'runtime-parent',
      fencingToken: 3
    }
    await runWithTurnMutationFence(parentFence, () => store.appendItem('thread-side', {
      id: 'item-side',
      turnId: 'turn-side',
      threadId: 'thread-side',
      role: 'assistant',
      status: 'completed',
      createdAt: '2026-08-29T00:00:00.000Z',
      kind: 'assistant_text',
      text: 'side result'
    }))

    expect(requestBody).toEqual({
      value: expect.objectContaining({ threadId: 'thread-side' })
    })
  })

  it('forwards checkpoint and finalization operations without changing their payloads', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ result: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    const store = new ManagerRemoteSessionStore(managerConnection())
    const item = {
      id: 'assistant_remote_live',
      turnId: 'turn_remote_live',
      threadId: 'thread_remote_live',
      role: 'assistant' as const,
      status: 'running' as const,
      createdAt: '2026-08-29T00:00:00.000Z',
      kind: 'assistant_text' as const,
      text: 'live'
    }

    await store.checkpointLiveItem(item.threadId, item, 9)
    await store.finalizeLiveItem(item.threadId, { ...item, status: 'completed' })

    expect(requests.map((request) => request.url)).toEqual([
      expect.stringContaining('/v1/data/session/checkpointLiveItem'),
      expect.stringContaining('/v1/data/session/finalizeLiveItem')
    ])
    expect(requests.map((request) => request.body)).toEqual([
      { value: { threadId: item.threadId, item, representedSeq: 9 } },
      { value: { threadId: item.threadId, item: { ...item, status: 'completed' } } }
    ])
  })
})

describe('non-fenced Manager stores', () => {
  it('preserves their original request bodies without the thread/session envelope', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, body: JSON.parse(String(init?.body)) })
      const result = url.includes('/memory/') ? [] : null
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }))
    await new ManagerRemoteArtifactStore(managerConnection()).get('artifact-1')
    await new ManagerRemoteMemoryStore(
      managerConnection(),
      MemoryCapabilityConfig.parse({})
    ).list()
    await new ManagerRemoteGraphRunStore(
      managerConnection(),
      () => DEFAULT_GRAPH_RUNTIME_CONFIG
    ).get('graph_run_12345678')
    await new ManagerRemoteAttachmentStore(
      managerConnection(),
      AttachmentsCapabilityConfig.parse({})
    ).get('attachment-1')

    expect(requests.map((entry) => entry.body)).toEqual([
      { id: 'artifact-1' },
      { config: MemoryCapabilityConfig.parse({}), value: {} },
      { config: DEFAULT_GRAPH_RUNTIME_CONFIG, value: { runId: 'graph_run_12345678' } },
      { config: AttachmentsCapabilityConfig.parse({}), value: { id: 'attachment-1' } }
    ])
  })

  it('iterates bounded manager event pages without materializing the backlog', async () => {
    const requestBodies: unknown[] = []
    const pages = [
      { events: [event(1), event(2)], nextCursor: 'v1:1:2:200', hasMore: true, eventBytes: 200 },
      { events: [event(3)], hasMore: false, eventBytes: 100 }
    ]
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ result: pages.shift() }), {
        status: 200, headers: { 'content-type': 'application/json' }
      })
    }))
    const store = new ManagerRemoteSessionStore(managerConnection())
    const seen: number[] = []
    for await (const runtimeEvent of store.iterateEventsSince('thread_remote_pages', 0)) {
      seen.push(runtimeEvent.seq)
    }

    expect(seen).toEqual([1, 2, 3])
    expect(requestBodies).toMatchObject([
      { value: { threadId: 'thread_remote_pages', options: { sinceSeq: 0 } } },
      { value: {
        threadId: 'thread_remote_pages',
        options: { sinceSeq: 2, cursor: 'v1:1:2:200' }
      } }
    ])
  })
})

function event(seq: number) {
  return {
    kind: 'heartbeat' as const,
    seq,
    timestamp: `2026-08-29T00:00:0${seq}.000Z`,
    threadId: 'thread_remote_pages'
  }
}

describe('ManagerRemoteThreadStore legacy read compatibility', () => {
  it('forwards workspace keyset pages through the dedicated manager operation', async () => {
    const thread = createThreadRecord({
      id: 'thr_page_remote',
      title: 'Remote page',
      workspace: '/tmp/remote-page',
      model: 'test-model'
    })
    let requestUrl = ''
    let requestBody = ''
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input)
      requestBody = String(init?.body ?? '')
      return new Response(JSON.stringify({
        result: {
          threads: [toThreadSummary(thread)],
          hasMore: false,
          total: 1
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const store = new ManagerRemoteThreadStore(managerConnection())

    await expect(store.listPage({
      workspace: thread.workspace,
      limit: 25,
      cursor: 'opaque-cursor',
      includeArchived: true,
      includeSide: true
    })).resolves.toMatchObject({
      threads: [{ id: thread.id }],
      hasMore: false,
      total: 1
    })
    expect(requestUrl).toContain('/v1/data/thread/listPage')
    expect(JSON.parse(requestBody)).toEqual({
      value: {
        workspace: thread.workspace,
        limit: 25,
        cursor: 'opaque-cursor',
        includeArchived: true,
        includeSide: true
      }
    })
  })

  it('preserves thread-index progress returned by manager listPage', async () => {
    stubManagerResult({
      threads: [],
      hasMore: false,
      indexStatus: {
        status: 'running',
        indexed: 12,
        total: 40
      }
    })
    const store = new ManagerRemoteThreadStore(managerConnection())

    await expect(store.listPage()).resolves.toEqual({
      threads: [],
      hasMore: false,
      indexStatus: {
        status: 'running',
        indexed: 12,
        total: 40
      }
    })
  })

  it('preserves a half-bound plan-build thread on full and metadata reads', async () => {
    const thread = legacyHalfBoundThread()
    stubManagerResult(thread)
    const store = new ManagerRemoteThreadStore(managerConnection())

    await expect(store.get(thread.id)).resolves.toMatchObject({
      id: thread.id,
      planBuildRunId: 'run-legacy-1'
    })
    await expect(store.getMetadata(thread.id)).resolves.toMatchObject({
      id: thread.id,
      planBuildRunId: 'run-legacy-1'
    })
  })

  it('allows legacy plan-build metadata to round-trip on ordinary upserts', async () => {
    const thread = legacyHalfBoundThread()
    stubManagerResult(thread)
    const store = new ManagerRemoteThreadStore(managerConnection())

    await expect(store.upsert(thread)).resolves.toMatchObject({
      id: thread.id,
      planBuildRunId: 'run-legacy-1'
    })
  })
})
