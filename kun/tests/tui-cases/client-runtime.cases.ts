import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRuntimeCapabilityManifest } from '../../src/contracts/capabilities.js'
import { ThreadSchema } from '../../src/contracts/threads.js'
import { publishRuntimeDiscovery } from '../../src/server/runtime-discovery.js'
import { KunTuiClient, TuiClientError, resolveTuiConnection } from '../../src/tui/client.js'
import { testTuiGraphRun } from '../../src/tui/graph-mode.test-support.js'
import type { TuiOptions } from '../../src/tui/options.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function runtimeInfo(overrides: Record<string, unknown> = {}) {
  return {
    host: '127.0.0.1',
    port: 18899,
    dataDir: '/tmp/kun-data',
    model: 'model-a',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    insecure: false,
    instanceId: 'gui-runtime',
    serviceVersion: '0.1.0',
    launchMode: 'gui',
    startedAt: '2026-07-22T00:00:00.000Z',
    pid: process.pid,
    capabilities: buildRuntimeCapabilityManifest({
      model: {
        id: 'model-a',
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text']
      }
    }),
    ...overrides
  }
}

function thread(overrides: Record<string, unknown> = {}) {
  return ThreadSchema.parse({
    id: 'thr_1',
    title: 'Terminal thread',
    workspace: '/tmp/project',
    model: 'model-a',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    relation: 'primary',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    turns: [],
    ...overrides
  })
}

function options(overrides: Partial<TuiOptions> = {}): TuiOptions {
  return {
    runtimeToken: 'runtime-secret',
    dataDir: '/tmp/kun-data',
    workspace: '/tmp/project',
    continueLatest: false,
    noStart: false,
    help: false,
    ...overrides
  }
}

function modelSnapshot(revision = 1) {
  return {
    schemaVersion: 1 as const,
    revision,
    providers: [{
      id: 'provider-a', accountId: 'account:provider-a', name: 'Provider A',
      kind: 'http' as const, authType: 'api-key' as const,
      baseUrl: 'https://example.com/v1', endpointFormat: 'chat_completions' as const,
      useProxy: false, configured: true, models: ['model-a'], selectedModel: 'model-a'
    }],
    defaultProviderId: 'provider-a',
    defaultAccountId: 'account:provider-a',
    defaultModel: 'model-a',
    proxy: { enabled: false, url: '' },
    routePools: [],
    localModelGateway: { enabled: false }
  }
}

describe('KunTuiClient runtime and graph APIs', () => {
  it('loads and validates the provider quota snapshot', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(new URL(String(input)).pathname).toBe('/v1/provider-quotas')
      return Response.json({
        entries: [{
          providerId: 'deepseek',
          providerName: 'DeepSeek',
          status: 'available',
          metrics: [{
            id: 'balance',
            label: 'Account balance',
            unit: 'CNY',
            remaining: 40.76
          }]
        }],
        refreshedAt: '2026-07-28T01:31:00.000Z'
      })
    }) as unknown as typeof fetch
    const client = new KunTuiClient({
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'runtime-secret',
      fetch: fetchImpl
    })

    await expect(client.providerQuotas()).resolves.toMatchObject({
      entries: [{ providerId: 'deepseek', status: 'available' }]
    })
  })

  it('sends typed thread, turn, approval, and user-input requests', async () => {
    const calls: Array<{ path: string; method: string; body?: unknown; headers: Headers }> = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(String(url))
      calls.push({
        path: parsed.pathname,
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
        headers: new Headers(init?.headers)
      })
      if (parsed.pathname === '/v1/threads') return Response.json(thread(), { status: 201 })
      if (parsed.pathname.endsWith('/turns')) {
        return Response.json({ threadId: 'thr_1', turnId: 'turn_1', userMessageItemId: 'item_1' }, { status: 202 })
      }
      if (parsed.pathname.startsWith('/v1/approvals/')) {
        return Response.json({ approvalId: 'appr_1', decision: 'allow', status: 'allowed' })
      }
      return Response.json({ inputId: 'input_1', status: 'submitted', answers: [] })
    }) as unknown as typeof fetch
    const client = new KunTuiClient({ baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'runtime-secret', fetch: fetchImpl })

    await client.createThread({ title: 'Terminal thread', workspace: '/tmp/project', model: 'model-a', mode: 'agent' })
    await client.startTurn('thr_1', { prompt: 'hello' })
    await client.decideApproval('appr_1', 'allow')
    await client.resolveUserInput('input_1', [{ id: 'q1', label: 'answer', value: 'answer' }])

    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ['POST', '/v1/threads'],
      ['POST', '/v1/threads/thr_1/turns'],
      ['POST', '/v1/approvals/appr_1'],
      ['POST', '/v1/user-inputs/input_1']
    ])
    expect(calls.every((call) => call.headers.get('authorization') === 'Bearer runtime-secret')).toBe(true)
    expect(calls[2].headers.get('x-kun-approval-consent')).toMatch(/^v1\./)
  })

  it('accepts attachment metadata produced by the current GUI runtime', async () => {
    const sourceSha256 = 'a'.repeat(64)
    const fetchImpl = vi.fn(async () => Response.json({
      attachment: {
        id: 'att_current_gui',
        name: 'clipboard.png',
        kind: 'image',
        mimeType: 'image/png',
        byteSize: 16,
        hash: sourceSha256,
        width: 1,
        height: 1,
        sourceSha256,
        threadIds: [],
        workspaces: ['/tmp/project'],
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z'
      }
    }, { status: 201 })) as unknown as typeof fetch
    const client = new KunTuiClient({
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'runtime-secret',
      fetch: fetchImpl
    })

    await expect(client.uploadAttachment({
      name: 'clipboard.png',
      mimeType: 'image/png',
      dataBase64: 'iVBORw0KGgo='
    })).resolves.toMatchObject({
      attachment: {
        id: 'att_current_gui',
        sourceSha256
      }
    })

    await expect(client.getAttachment('att_current_gui')).resolves.toMatchObject({
      attachment: {
        id: 'att_current_gui',
        name: 'clipboard.png'
      }
    })
    expect(fetchImpl).toHaveBeenLastCalledWith(
      'http://127.0.0.1:18899/v1/attachments/att_current_gui',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('uses authenticated Graph availability, run, and steering routes', async () => {
    const run = testTuiGraphRun()
    const calls: Array<{ url: URL; method: string; body?: Record<string, unknown> }> = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsed = new URL(String(url))
      calls.push({
        url: parsed,
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string'
          ? { body: JSON.parse(init.body) as Record<string, unknown> }
          : {})
      })
      if (parsed.pathname === '/v1/graphs/diagnostics') {
        return Response.json({ enabled: true })
      }
      if (parsed.pathname === '/v1/graphs') {
        return Response.json({
          runs: [{
            id: run.id,
            threadId: run.threadId,
            projectId: run.projectId,
            sourceTurnId: run.sourceTurnId,
            status: run.status,
            currentRevision: run.currentRevision,
            lastEventSeq: run.lastEventSeq,
            title: run.plans.at(-1)?.title ?? '',
            goal: run.plans.at(-1)?.goal ?? '',
            nodeCount: Object.keys(run.nodes).length,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt
          }]
        })
      }
      return Response.json(run)
    }) as unknown as typeof fetch
    const client = new KunTuiClient({
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'runtime-secret',
      fetch: fetchImpl
    })

    await expect(client.graphAvailability()).resolves.toMatchObject({ enabled: true })
    await expect(client.listGraphRuns('thr_1')).resolves.toEqual([run])
    await expect(client.getGraphRun(run.id)).resolves.toEqual(run)
    await expect(client.steerGraphRun(run.id, 'Focus on Windows parity.')).resolves.toEqual(run)

    expect(calls.map((call) => [call.method, call.url.pathname])).toEqual([
      ['GET', '/v1/graphs/diagnostics'],
      ['GET', '/v1/graphs'],
      ['GET', '/v1/graphs/run_1'],
      ['GET', '/v1/graphs/run_1'],
      ['POST', '/v1/graphs/run_1/steer']
    ])
    expect(calls[1]?.url.searchParams.get('thread_id')).toBe('thr_1')
    expect(calls[4]?.body).toMatchObject({
      target: { kind: 'run' },
      text: 'Focus on Windows parity.'
    })
    expect(String(calls[4]?.body?.commandId)).toMatch(/^tui_steer_/u)
  })

  it('hydrates the newest non-terminal Graph summary before a newer terminal run', async () => {
    const active = testTuiGraphRun({
      id: 'run_active',
      updatedAt: '2026-07-26T00:00:04.000Z'
    })
    const terminal = testTuiGraphRun({
      id: 'run_terminal',
      status: 'completed',
      updatedAt: '2026-07-26T00:00:08.000Z'
    })
    const hydrated: string[] = []
    const summary = (run: typeof active) => ({
      id: run.id,
      threadId: run.threadId,
      projectId: run.projectId,
      sourceTurnId: run.sourceTurnId,
      status: run.status,
      currentRevision: run.currentRevision,
      lastEventSeq: run.lastEventSeq,
      title: run.plans.at(-1)?.title ?? '',
      goal: run.plans.at(-1)?.goal ?? '',
      nodeCount: Object.keys(run.nodes).length,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt
    })
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url))
      if (parsed.pathname === '/v1/graphs') {
        return parsed.searchParams.has('cursor')
          ? Response.json({ runs: [summary(active)] })
          : Response.json({ runs: [summary(terminal)], nextCursor: 'page_2' })
      }
      hydrated.push(parsed.pathname)
      return Response.json(active)
    }) as unknown as typeof fetch
    const client = new KunTuiClient({
      baseUrl: 'http://127.0.0.1:18899',
      runtimeToken: 'runtime-secret',
      fetch: fetchImpl
    })

    await expect(client.listGraphRuns(active.threadId)).resolves.toEqual([active])
    expect(hydrated).toEqual(['/v1/graphs/run_active'])
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('cursor=page_2'),
      expect.anything()
    )
  })
})
