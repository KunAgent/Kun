import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  acquireRuntimeRequestLease,
  bundledRuntimeBuildReplacementRequired,
  classifyBundledBuildReplacement,
  expectedKunRuntimeBuildId,
  getRuntimeAuthToken,
  kunRuntimeAdapter,
  resolveRuntimeRequestTimeoutMs,
  runtimeAuthHeaders,
  runtimeRequestViaHost,
  runtimeRequestViaLease
} from './kun-adapter'
import { buildRuntimeCapabilityManifest } from '../../../kun/src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../../../kun/src/loop/model-context-profile.js'
import { publishRuntimeDiscovery } from '../../../kun/src/server/runtime-discovery.js'
import { KUN_VERSION } from '../../../kun/src/version.js'

let server: Server | null = null

function settingsForPort(port: number): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(port),
        runtimeToken: 'usage-token'
      }
    },
    workspaceRoot: '/tmp',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void

function listen(handler: RequestHandler): Promise<number> {
  server = createServer(handler)
  return new Promise((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(0, '127.0.0.1', () => {
      const address = server?.address() as AddressInfo
      resolve(address.port)
    })
  })
}

async function reserveUnusedPort(): Promise<number> {
  const candidate = createServer()
  const port = await new Promise<number>((resolve, reject) => {
    candidate.once('error', reject)
    candidate.listen(0, '127.0.0.1', () => {
      resolve((candidate.address() as AddressInfo).port)
    })
  })
  await new Promise<void>((resolve, reject) => {
    candidate.close((error) => error ? reject(error) : resolve())
  })
  return port
}

afterEach(async () => {
  const current = server
  server = null
  if (!current) return
  await new Promise<void>((resolve, reject) => {
    current.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
})

describe('runtimeRequestViaHost', () => {
  it('keeps model connection long polls alive beyond their server wait window', () => {
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/model-connections/events?since_revision=62&wait_ms=25000',
      'GET'
    )).toBe(30_000)
    expect(resolveRuntimeRequestTimeoutMs('/v1/threads', 'GET')).toBe(15_000)
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/model-connections/events?since_revision=62&wait_ms=25000',
      'GET',
      40_000
    )).toBe(40_000)
  })

  it('keeps thread activity long polls alive beyond their server wait window', () => {
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/thread-activity/events?wait_ms=25000&cursor=cursor_1',
      'GET'
    )).toBe(30_000)
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/thread-activity/events?wait_ms=0',
      'GET'
    )).toBe(15_000)
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/thread-activity/events?wait_ms=25000',
      'GET',
      45_000
    )).toBe(45_000)
  })

  it('allows bounded thread timeline reads to finish cold storage scans', () => {
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/threads/thr_1/timeline?before=item_42&limit=300',
      'GET'
    )).toBe(120_000)
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/threads/thr_1/timeline',
      'GET',
      45_000
    )).toBe(45_000)
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/threads/thr_1/timeline',
      'POST'
    )).toBe(60_000)
  })

  it('allows the bounded provider quota scan to outlive the generic GET budget', () => {
    expect(resolveRuntimeRequestTimeoutMs('/v1/provider-quotas', 'GET')).toBe(120_000)
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/provider-quotas?refresh=true',
      'GET',
      45_000
    )).toBe(45_000)
    expect(resolveRuntimeRequestTimeoutMs('/v1/provider-quotas', 'POST')).toBe(60_000)
  })

  it('lets usage history aggregations outlive the generic GET budget', () => {
    const usagePath =
      '/v1/usage?group_by=day&from=2026-05-01&to=2026-08-24&timezone=Asia%2FShanghai'
    expect(resolveRuntimeRequestTimeoutMs(usagePath, 'GET')).toBe(120_000)
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/usage?group_by=model&from=2026-08-01&to=2026-08-24&timezone=UTC',
      'GET'
    )).toBe(120_000)
    expect(resolveRuntimeRequestTimeoutMs('/v1/usage?group_by=turn&thread_id=thr_1', 'GET')).toBe(120_000)
    expect(resolveRuntimeRequestTimeoutMs(usagePath, 'GET', 45_000)).toBe(45_000)
    // Runtime-cumulative usage is a cheap in-memory counter read; keep the
    // generic budget so status-style callers still fail fast.
    expect(resolveRuntimeRequestTimeoutMs('/v1/usage', 'GET')).toBe(15_000)
    expect(resolveRuntimeRequestTimeoutMs('/v1/usage?group_by=runtime', 'GET')).toBe(15_000)
    expect(resolveRuntimeRequestTimeoutMs(usagePath, 'POST')).toBe(60_000)
  })

  it('lets an on-demand session summary outlive the generic POST budget', () => {
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/threads/thr_1/summarize',
      'POST'
    )).toBe(120_000)
    expect(resolveRuntimeRequestTimeoutMs(
      '/v1/threads/thr_1/summarize',
      'POST',
      30_000
    )).toBe(30_000)
    expect(resolveRuntimeRequestTimeoutMs('/v1/threads/thr_1/fork', 'POST')).toBe(60_000)
  })

  it('forwards daily usage requests to the Kun runtime with bearer auth', async () => {
    let seenUrl = ''
    let seenAuthorization = ''
    let ensured = false
    const port = await listen((req, res) => {
      seenUrl = req.url ?? ''
      seenAuthorization = req.headers.authorization ?? ''
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({
        group_by: 'day',
        buckets: [],
        totals: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          turns: 0,
          cache_hit_tokens: 0,
          cache_miss_tokens: 0,
          cached_tokens: 0,
          cost_usd: 0,
          active_days: 0
        },
        date_range: { from: '2026-06-01', to: '2026-06-02', days: 2 },
        timezone: 'Asia/Shanghai'
      }))
    })

    const response = await runtimeRequestViaHost(
      settingsForPort(port),
      '/v1/usage?group_by=day&from=2026-06-01&to=2026-06-02&timezone=Asia%2FShanghai',
      { method: 'GET' },
      async () => {
        ensured = true
      }
    )

    expect(ensured).toBe(true)
    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual(expect.objectContaining({ group_by: 'day' }))
    expect(seenUrl).toBe('/v1/usage?group_by=day&from=2026-06-01&to=2026-06-02&timezone=Asia%2FShanghai')
    expect(seenAuthorization).toBe('Bearer usage-token')
  })

  it('acquires a cold-start lease after ensure and keeps its endpoint and token immutable', async () => {
    let seenAuthorization = ''
    let requestCount = 0
    const port = await listen((req, res) => {
      requestCount += 1
      seenAuthorization = req.headers.authorization ?? ''
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })
    const cold = settingsForPort(1)
    cold.agents.kun.runtimeToken = ''
    const ready = settingsForPort(port)
    ready.agents.kun.runtimeToken = 'lease-token-a'
    let ensureCalls = 0

    const lease = await acquireRuntimeRequestLease(cold, async () => {
      ensureCalls += 1
      return ready
    })
    ready.agents.kun.port = 2
    ready.agents.kun.runtimeToken = 'lease-token-b'

    const response = await runtimeRequestViaLease(lease, '/v1/approvals/approval-1', {
      method: 'POST',
      body: JSON.stringify({ decision: 'allow' }),
      headers: { Authorization: 'Bearer caller-controlled' }
    })

    expect(Object.isFrozen(lease)).toBe(true)
    expect(ensureCalls).toBe(1)
    expect(requestCount).toBe(1)
    expect(response.ok).toBe(true)
    expect(seenAuthorization).toBe('Bearer lease-token-a')
  })

  it('does not re-ensure or replay a leased non-idempotent request', async () => {
    let requestCount = 0
    const port = await listen((_req, res) => {
      requestCount += 1
      res.destroy()
    })
    const ready = settingsForPort(port)
    let ensureCalls = 0
    const lease = await acquireRuntimeRequestLease(ready, async () => {
      ensureCalls += 1
      return ready
    })

    await expect(runtimeRequestViaLease(lease, '/v1/approvals/approval-1', {
      method: 'POST',
      body: JSON.stringify({ decision: 'allow' })
    })).rejects.toBeInstanceOf(Error)

    expect(ensureCalls).toBe(1)
    expect(requestCount).toBe(1)
  })

  it('uses settings returned by ensureRuntime when the managed port changes', async () => {
    let seenUrl = ''
    const port = await listen((req, res) => {
      seenUrl = req.url ?? ''
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })

    const response = await runtimeRequestViaHost(
      settingsForPort(1),
      '/v1/threads?limit=1',
      { method: 'GET' },
      async () => settingsForPort(port)
    )

    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
    expect(seenUrl).toBe('/v1/threads?limit=1')
  })

  it('retries a stale endpoint after ensureRuntime returns a new runtime port', async () => {
    let seenMethod = ''
    const port = await listen((req, res) => {
      seenMethod = req.method ?? ''
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, retried: true }))
    })
    const stalePort = await reserveUnusedPort()
    let ensureCalls = 0

    const response = await runtimeRequestViaHost(
      settingsForPort(stalePort),
      '/v1/threads',
      { method: 'POST', body: JSON.stringify({ title: 'hello' }) },
      async () => {
        ensureCalls += 1
        return ensureCalls === 1 ? settingsForPort(stalePort) : settingsForPort(port)
      }
    )

    expect(ensureCalls).toBe(2)
    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ retried: true })
    expect(seenMethod).toBe('POST')
  })

  it('retries idempotent requests even when the runtime port stays the same', async () => {
    let requestCount = 0
    let ensureCalls = 0
    const port = await listen((_req, res) => {
      requestCount += 1
      if (requestCount === 1) {
        res.destroy()
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })

    const response = await runtimeRequestViaHost(
      settingsForPort(port),
      '/v1/usage?group_by=day',
      { method: 'GET' },
      async () => {
        ensureCalls += 1
        return settingsForPort(port)
      }
    )

    expect(requestCount).toBe(2)
    expect(ensureCalls).toBe(2)
    expect(response.ok).toBe(true)
    expect(JSON.parse(response.body)).toEqual({ ok: true })
  })

  it('propagates an internal request timeout without invoking runtime recovery', async () => {
    let requestCount = 0
    const port = await listen((_req, _res) => {
      requestCount += 1
      // Keep the response open until the internal request timeout aborts it.
    })
    let ensureCalls = 0

    await expect(runtimeRequestViaHost(
      settingsForPort(port),
      '/v1/attachments/att_123/content',
      { method: 'GET', timeoutMs: 25 },
      async () => {
        ensureCalls += 1
      }
    )).rejects.toMatchObject({ name: 'TimeoutError' })

    expect(ensureCalls).toBe(1)
    expect(requestCount).toBe(1)
  })

  it('does not ensure or send a request when the caller is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let ensureCalls = 0

    await expect(runtimeRequestViaHost(
      settingsForPort(1),
      '/v1/threads',
      { method: 'GET', signal: controller.signal },
      async () => {
        ensureCalls += 1
      }
    )).rejects.toMatchObject({ name: 'AbortError' })

    expect(ensureCalls).toBe(0)
  })

  it('aborts an in-flight request without invoking runtime recovery', async () => {
    let requestStarted!: () => void
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    const port = await listen((_req, _res) => {
      requestStarted()
      // Keep the response open until the caller aborts.
    })
    const controller = new AbortController()
    let ensureCalls = 0
    const request = runtimeRequestViaHost(
      settingsForPort(port),
      '/v1/threads',
      { method: 'GET', signal: controller.signal },
      async () => {
        ensureCalls += 1
      }
    )

    await started
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(ensureCalls).toBe(1)
  })
})

describe('kunRuntimeAdapter.resolveConnection', () => {
  it.each(['gui', 'tui'] as const)(
    'classifies a %s-owned Runtime as foreign even when its build differs',
    (ownerKind) => {
      const expectedBuildId = 'b'.repeat(64)

      expect(classifyBundledBuildReplacement({
        buildId: 'a'.repeat(64),
        clientOwnerKind: ownerKind
      }, expectedBuildId)).toEqual({
        state: 'foreign-owned',
        ownerKind,
        buildMatches: false
      })
      expect(classifyBundledBuildReplacement({
        buildId: expectedBuildId,
        clientOwnerKind: ownerKind
      }, expectedBuildId)).toEqual({
        state: 'foreign-owned',
        ownerKind,
        buildMatches: true
      })
    }
  )

  it('requires a packaged production build handoff only for a bundled build mismatch', () => {
    const expectedBuildId = 'b'.repeat(64)

    expect(bundledRuntimeBuildReplacementRequired({
      isPackaged: true,
      hasCustomBinary: false,
      runtimeFlavor: 'production',
      expectedBuildId,
      discoveredBuildId: 'a'.repeat(64)
    })).toBe(true)
    expect(bundledRuntimeBuildReplacementRequired({
      isPackaged: true,
      hasCustomBinary: false,
      runtimeFlavor: 'production',
      expectedBuildId,
      discoveredBuildId: expectedBuildId
    })).toBe(false)
    expect(bundledRuntimeBuildReplacementRequired({
      isPackaged: true,
      hasCustomBinary: true,
      runtimeFlavor: 'production',
      expectedBuildId,
      discoveredBuildId: 'a'.repeat(64)
    })).toBe(false)
    expect(bundledRuntimeBuildReplacementRequired({
      isPackaged: true,
      hasCustomBinary: false,
      runtimeFlavor: 'development',
      expectedBuildId,
      discoveredBuildId: 'a'.repeat(64)
    })).toBe(false)
  })

  it('compares development runtimes using their flavor-namespaced build identity', () => {
    const sourceBuildId = 'd'.repeat(64)

    expect(expectedKunRuntimeBuildId(sourceBuildId, 'development')).toMatch(/^[a-f0-9]{64}$/)
    expect(expectedKunRuntimeBuildId(sourceBuildId, 'development')).not.toBe(sourceBuildId)
    expect(expectedKunRuntimeBuildId(sourceBuildId, 'production')).toBe(sourceBuildId)
  })

  it('rejects an identity-less runtime before the GUI health fast path can reuse it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-adapter-build-identity-'))
    const dataDir = join(root, 'data')
    const packageRoot = join(root, 'kun-package')
    const entry = join(packageRoot, 'dist/cli/serve-entry.js')
    const expectedBuildId = 'b'.repeat(64)
    const startedAt = '2026-07-28T00:00:00.000Z'
    const instanceId = 'runtime-build-compatibility'
    const capabilities = buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('fixture')
    })
    let liveBuildId: string | undefined
    let activeTurnCount = 0

    try {
      await mkdir(join(packageRoot, 'dist/cli'), { recursive: true })
      await writeFile(entry, '', 'utf8')
      await writeFile(
        join(packageRoot, 'dist/runtime-build.json'),
        `${JSON.stringify({ version: 1, buildId: expectedBuildId })}\n`,
        'utf8'
      )
      const port = await listen((_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('x-kun-active-turn-count', String(activeTurnCount))
        res.end(JSON.stringify({
          instanceId,
          serviceVersion: KUN_VERSION,
          ...(liveBuildId ? { buildId: liveBuildId } : {}),
          launchMode: 'shared',
          host: '127.0.0.1',
          port,
          dataDir,
          model: 'fixture',
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          insecure: false,
          startedAt,
          pid: process.pid,
          capabilities
        }))
      })
      const publish = async (): Promise<void> => {
        await publishRuntimeDiscovery(dataDir, {
          instanceId,
          pid: process.pid,
          startedAt,
          host: '127.0.0.1',
          port,
          baseUrl: `http://127.0.0.1:${port}`,
          runtimeToken: 'secret',
          insecure: false,
          ...(liveBuildId ? { buildId: liveBuildId } : {}),
          launchMode: 'shared'
        })
      }
      const settings = settingsForPort(port)
      settings.agents.kun.dataDir = dataDir
      settings.agents.kun.binaryPath = packageRoot

      await publish()
      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(false)

      liveBuildId = expectedBuildId
      await publish()
      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(false)

      liveBuildId = 'a'.repeat(64)
      activeTurnCount = 1
      await publish()
      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(false)

      activeTurnCount = 0
      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(false)
    } finally {
      await kunRuntimeAdapter.stopAndWait()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps configured GUI endpoint and credentials when a foreign discovery is unresponsive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-adapter-live-unresponsive-'))
    const dataDir = join(root, 'data')
    const expectedBuildId = 'c'.repeat(64)
    const packageRoot = join(root, 'kun-package')
    const entry = join(packageRoot, 'dist/cli/serve-entry.js')
    const settings = settingsForPort(18900)
    settings.agents.kun.runtimeToken = ''
    settings.agents.kun.dataDir = dataDir
    settings.agents.kun.binaryPath = packageRoot
    try {
      await mkdir(join(packageRoot, 'dist/cli'), { recursive: true })
      await writeFile(entry, '', 'utf8')
      await writeFile(
        join(packageRoot, 'dist/runtime-build.json'),
        `${JSON.stringify({ version: 1, buildId: expectedBuildId })}\n`,
        'utf8'
      )
      await publishRuntimeDiscovery(dataDir, {
        instanceId: 'runtime-temporarily-unresponsive',
        pid: process.pid,
        startedAt: '2026-07-30T05:38:57.000Z',
        host: '127.0.0.1',
        port: 1,
        baseUrl: 'http://127.0.0.1:1',
        runtimeToken: 'secret',
        insecure: false,
        buildId: expectedBuildId,
        launchMode: 'shared'
      })

      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(false)
      expect(kunRuntimeAdapter.getBaseUrl(settings)).toBe('http://127.0.0.1:18900')
      expect(getRuntimeAuthToken(settings)).toBe('')
      expect(runtimeAuthHeaders(settings).get('Authorization')).toBeNull()
    } finally {
      await kunRuntimeAdapter.stopAndWait()
      await rm(root, { recursive: true, force: true })
    }
  })
})
