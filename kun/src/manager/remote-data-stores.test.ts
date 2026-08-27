import { afterEach, describe, expect, it, vi } from 'vitest'
import { createThreadRecord, toThreadSummary } from '../domain/thread.js'
import type { ServiceManagerConnection } from './manager-client.js'
import {
  ManagerRemoteThreadStore,
  resolveManagerDataRequestTimeoutMs
} from './remote-data-stores.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function managerConnection(): ServiceManagerConnection {
  return {
    discovery: {
      version: 1,
      protocolVersion: 3,
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
    expect(resolveManagerDataRequestTimeoutMs('session', 'loadItems')).toBe(30_000)
    expect(resolveManagerDataRequestTimeoutMs('thread', 'get')).toBe(30_000)
  })
})

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
      workspace: thread.workspace,
      limit: 25,
      cursor: 'opaque-cursor',
      includeArchived: true,
      includeSide: true
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
