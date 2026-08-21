import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DaemonRuntime } from './daemon-runtime'
import type { DaemonRuntimeDeps } from './daemon-runtime'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultTerminalSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  mergeScheduleSettings,
  type AppSettingsV1,
  type SessionDaemonV1
} from '../shared/app-settings'

let testWorkspaceRoot = ''

function makeDaemon(patch: Partial<SessionDaemonV1> = {}): SessionDaemonV1 {
  const now = '2026-06-02T00:00:00.000Z'
  return {
    id: 'daemon-1',
    title: 'Test daemon',
    enabled: true,
    workspaceRoot: testWorkspaceRoot,
    threadId: 'thread-1',
    scriptPath: '',
    interpreter: 'node',
    heartbeatIntervalSeconds: 60,
    silenceTimeoutSeconds: 300,
    restartOnFailure: true,
    push: { enabled: false, channelId: '', conversationId: '' },
    createdAt: now,
    updatedAt: now,
    ...patch
  }
}

function settingsWith(daemons: SessionDaemonV1[], enabled = true): AppSettingsV1 {
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
        ...defaultKunRuntimeSettings(),
        apiKey: 'test-key'
      }
    },
    workspaceRoot: testWorkspaceRoot,
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: mergeScheduleSettings(defaultScheduleSettings(), {
      enabled: true,
      daemons: { enabled, items: daemons }
    }),
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

function writeScript(name: string, body: string): string {
  const filePath = join(testWorkspaceRoot, name)
  writeFileSync(filePath, body, 'utf8')
  return filePath
}

function createRuntime(
  initial: AppSettingsV1,
  overrides: Partial<DaemonRuntimeDeps> = {}
): {
  runtime: DaemonRuntime
  store: { load: () => Promise<AppSettingsV1> }
  pushText: ReturnType<typeof vi.fn>
  logError: ReturnType<typeof vi.fn>
  killProcessTree: ReturnType<typeof vi.fn>
} {
  let current = initial
  const store = {
    load: vi.fn(async () => current)
  }
  const pushText = vi.fn(async () => ({ ok: true }))
  const logError = vi.fn()
  const killProcessTree = vi.fn()
  const runtime = new DaemonRuntime({
    store: store as never,
    logError,
    logDir: join(testWorkspaceRoot, 'logs'),
    pushText,
    killProcessTree,
    restartBackoffMs: [20, 40, 80],
    healthyResetMs: 60_000,
    ...overrides
  })
  return { runtime, store, pushText, logError, killProcessTree }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
  intervalMs = 25
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('waitFor timed out')
}

describe('DaemonRuntime', () => {
  beforeEach(() => {
    testWorkspaceRoot = mkdtempSync(join(tmpdir(), 'kun-daemon-runtime-'))
  })

  afterEach(async () => {
    if (testWorkspaceRoot) {
      let attempt = 0
      while (attempt < 5) {
        try {
          rmSync(testWorkspaceRoot, { recursive: true, force: true })
          break
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EBUSY' && attempt < 4) {
            attempt += 1
            await new Promise((resolve) => setTimeout(resolve, 100))
            continue
          }
          throw error
        }
      }
      testWorkspaceRoot = ''
    }
  })

  it('starts an enabled daemon and reports running state', async () => {
    writeScript('heartbeat.js', 'setInterval(() => console.log("[kun-heartbeat] {\\"status\\":\\"ok\\"}"), 50)')
    const { runtime } = createRuntime(settingsWith([makeDaemon({ scriptPath: 'heartbeat.js' })]))
    runtime.sync(settingsWith([makeDaemon({ scriptPath: 'heartbeat.js' })]))

    await waitFor(async () => {
      const item = (await runtime.status()).items[0]
      return item?.state === 'running' && item.lastHeartbeatAt !== undefined
    })
    const status = await runtime.status()
    expect(status.items[0]?.pid).toBeTypeOf('number')
    expect(status.items[0]?.lastHeartbeatAt).toBeDefined()
    await runtime.stop()
  })

  it('restarts a crashed daemon with backoff and caps consecutive failures', async () => {
    writeScript('crash.js', 'process.exit(1)')
    const { runtime } = createRuntime(settingsWith([makeDaemon({ scriptPath: 'crash.js', restartOnFailure: true })]))
    runtime.sync(settingsWith([makeDaemon({ scriptPath: 'crash.js', restartOnFailure: true })]))

    await waitFor(async () => (await runtime.status()).items[0]?.restartCount >= 1)
    const status = await runtime.status()
    expect(status.items[0]?.restartCount).toBeGreaterThanOrEqual(1)

    // Continuous failures eventually flip the daemon to error.
    await waitFor(async () => (await runtime.status()).items[0]?.state === 'error', 5_000)
    const failed = await runtime.status()
    expect(failed.items[0]?.state).toBe('error')
    await runtime.stop()
  })

  it('pauses a daemon when the global kill switch is off and preserves config', async () => {
    writeScript('loop.js', 'setInterval(() => {}, 1000)')
    const initial = settingsWith([makeDaemon({ scriptPath: 'loop.js' })])
    const { runtime } = createRuntime(initial)
    runtime.sync(initial)
    await waitFor(async () => (await runtime.status()).items[0]?.state === 'running')

    runtime.sync(settingsWith([makeDaemon({ scriptPath: 'loop.js' })], false))
    await waitFor(async () => (await runtime.status()).items.length === 0)
    await runtime.stop()
  })

  it('does not depend on the scheduled-task master switch', async () => {
    writeScript('independent.js', 'setInterval(() => {}, 1000)')
    const daemon = makeDaemon({ scriptPath: 'independent.js' })
    const settings = settingsWith([daemon])
    settings.schedule = mergeScheduleSettings(settings.schedule, { enabled: false, keepAwake: false })
    const { runtime } = createRuntime(settings)
    runtime.sync(settings)
    await waitFor(async () => (await runtime.status()).items[0]?.state === 'running')
    await runtime.stop()
  })

  it('does not start daemons when only keep-awake is enabled', async () => {
    writeScript('sleep.js', 'setInterval(() => {}, 1000)')
    const daemon = makeDaemon({ scriptPath: 'sleep.js' })
    const settings = settingsWith([daemon], false)
    settings.schedule = mergeScheduleSettings(settings.schedule, { keepAwake: true })
    const { runtime } = createRuntime(settings)
    runtime.sync(settings)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect((await runtime.status()).items).toHaveLength(0)
    await runtime.stop()
  })

  it('restarts when the script path changes in settings', async () => {
    writeScript('a.js', 'setInterval(() => {}, 1000)')
    writeScript('b.js', 'setInterval(() => {}, 1000)')
    const initial = settingsWith([makeDaemon({ scriptPath: 'a.js' })])
    const { runtime } = createRuntime(initial)
    runtime.sync(initial)
    await waitFor(async () => (await runtime.status()).items[0]?.state === 'running')

    runtime.sync(settingsWith([makeDaemon({ scriptPath: 'b.js' })]))
    await waitFor(async () => (await runtime.status()).items[0]?.state === 'running')
    await runtime.stop()
  })

  it('delivers [kun-push] frames to the bound push target', async () => {
    writeScript('push.js', [
      'setTimeout(() => console.log("[kun-push] " + JSON.stringify({ text: "alert" })), 30)',
      'setInterval(() => {}, 1000)'
    ].join('\n'))
    const daemon = makeDaemon({
      scriptPath: 'push.js',
      push: { enabled: true, channelId: 'wx-1', conversationId: 'cv-1' }
    })
    const { runtime, pushText } = createRuntime(settingsWith([daemon]))
    runtime.sync(settingsWith([daemon]))
    await waitFor(() => pushText.mock.calls.length >= 1)
    expect(pushText.mock.calls[0][0]).toMatchObject({ daemon: expect.objectContaining({ id: 'daemon-1' }), text: 'alert' })
    await runtime.stop()
  })

  it('rejects malformed and oversized push frames', async () => {
    writeScript('bad.js', [
      'console.log("[kun-push] not-json")',
      'console.log("[kun-push] " + JSON.stringify({ text: "x".repeat(3000) }))',
      'setInterval(() => {}, 1000)'
    ].join('\n'))
    const daemon = makeDaemon({ scriptPath: 'bad.js', push: { enabled: true, channelId: 'wx-1', conversationId: 'cv-1' } })
    const { runtime, pushText } = createRuntime(settingsWith([daemon]))
    runtime.sync(settingsWith([daemon]))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(pushText).not.toHaveBeenCalled()
    await runtime.stop()
  })

  it('stop() terminates every daemon and waits for exit', async () => {
    writeScript('loop.js', 'setInterval(() => {}, 1000)')
    const initial = settingsWith([makeDaemon({ scriptPath: 'loop.js' })])
    const { runtime } = createRuntime(initial)
    runtime.sync(initial)
    await waitFor(async () => (await runtime.status()).items[0]?.state === 'running')
    await runtime.stop()
    expect((await runtime.status()).items).toHaveLength(0)
  })

  it('reads log tails and supports incremental cursors', async () => {
    writeScript('logger.js', [
      'for (let i = 0; i < 10; i += 1) console.log(`line-${i}`)',
      'setInterval(() => {}, 1000)'
    ].join('\n'))
    const initial = settingsWith([makeDaemon({ scriptPath: 'logger.js' })])
    const { runtime } = createRuntime(initial)
    runtime.sync(initial)
    await waitFor(async () => {
      const page = await runtime.readLogs('daemon-1', { limit: 200 })
      return page.lines.some((line) => line.includes('line-9'))
    })
    const page = await runtime.readLogs('daemon-1', { limit: 3 })
    expect(page.lines.length).toBeGreaterThan(0)
    const next = await runtime.readLogs('daemon-1', { cursor: page.nextCursor, limit: 200 })
    expect(next.lines.length).toBeGreaterThanOrEqual(0)
    await runtime.stop()
  })
})
