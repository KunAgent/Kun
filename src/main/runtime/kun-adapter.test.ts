import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
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
import { runtimeRequestViaHost } from './kun-adapter'

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
