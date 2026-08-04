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
  getRuntimeAuthToken,
  kunRuntimeAdapter,
  resolveRuntimeRequestTimeoutMs,
  runtimeAuthHeaders,
  runtimeRequestViaHost
} from './kun-adapter'
import { buildRuntimeCapabilityManifest } from '../../../kun/src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../../../kun/src/loop/model-context-profile.js'
import { publishRuntimeDiscovery } from '../../../kun/src/server/runtime-discovery.js'

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

  it('lets caller-pinned Authorization override settings runtimeToken (#1084 contract)', async () => {
    // Protected approval mints consent with the post-ensure live token and pins
    // Authorization on the POST so runtimeAuthHeaders(settings) cannot reintroduce
    // a stale settings token (token-A) after ensure resolved token-B.
    let seenAuthorization = ''
    let postCount = 0
    let ensureCalls = 0
    const port = await listen((req, res) => {
      if ((req.method ?? 'GET').toUpperCase() === 'POST') {
        postCount += 1
        seenAuthorization = req.headers.authorization ?? ''
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })

    const base = settingsForPort(port)
    const settings: AppSettingsV1 = {
      ...base,
      agents: {
        kun: {
          ...base.agents.kun,
          runtimeToken: 'token-A'
        }
      }
    }

    const response = await runtimeRequestViaHost(
      settings,
      '/v1/approvals/approval-1',
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'allow' }),
        headers: {
          Authorization: 'Bearer token-B'
        }
      },
      async (current) => {
        // Stub ensure: do not rotate the settings token.
        ensureCalls += 1
        return current
      }
    )

    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
    expect(ensureCalls).toBe(1)
    expect(postCount).toBe(1)
    expect(seenAuthorization).toBe('Bearer token-B')
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
    let ensureCalls = 0

    const response = await runtimeRequestViaHost(
      settingsForPort(1),
      '/v1/threads',
      { method: 'POST', body: JSON.stringify({ title: 'hello' }) },
      async () => {
        ensureCalls += 1
        return ensureCalls === 1 ? settingsForPort(1) : settingsForPort(port)
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
          serviceVersion: '0.1.0',
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
      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(true)

      liveBuildId = 'a'.repeat(64)
      activeTurnCount = 1
      await publish()
      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(true)

      activeTurnCount = 0
      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(false)
    } finally {
      await kunRuntimeAdapter.stopAndWait()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retains the discovered endpoint when its live process misses a probe', async () => {
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

      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(true)
      expect(kunRuntimeAdapter.getBaseUrl(settings)).toBe('http://127.0.0.1:1')
      expect(getRuntimeAuthToken(settings)).toBe('secret')
      expect(runtimeAuthHeaders(settings).get('Authorization')).toBe('Bearer secret')
    } finally {
      await kunRuntimeAdapter.stopAndWait()
      await rm(root, { recursive: true, force: true })
    }
  })
})
