import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer, type AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureLogger } from './logger'
import {
  defaultClawSettings,
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_MAX_LINES,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  getModelProviderPreset,
  modelProviderPresetProfile,
  resolveKunRuntimeSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1,
  type ModelProviderModelProfileV1
} from '../shared/app-settings'
import { KunConfigSchema } from '../../kun/src/config/kun-config.js'
import {
  configureManagerAtomicJsonClient,
  isManagerAtomicJsonPath
} from '../../kun/src/extensions/atomic-json.js'
import {
  ManagerResourceLeaseClient,
  ManagerRevisionedDocumentClient
} from '../../kun/src/manager/manager-client.js'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/deepseek-gui-test-app',
    getPath: () => '/tmp/deepseek-gui-test-user-data'
  }
}))

let tempRoot: string | null = null
let testKunPort = 18899

function createSettings(binaryPath: string): AppSettingsV1 {
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
        ...defaultKunRuntimeSettings(testKunPort),
        binaryPath,
        autoStart: true
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
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

function writeScript(name: string, content: string): string {
  if (!tempRoot) throw new Error('temp root not initialized')
  const path = join(tempRoot, name)
  writeFileSync(path, content, 'utf8')
  return path
}

async function readKunLog(): Promise<string> {
  if (!tempRoot) throw new Error('temp root not initialized')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const logFile = readdirSync(tempRoot).find((entry) => entry.startsWith('kun-') && entry.endsWith('.log'))
    if (logFile) return readFileSync(join(tempRoot, logFile), 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Expected a kun log file to be created')
}

function canBindTestPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    let settled = false
    const settle = (available: boolean): void => {
      if (settled) return
      settled = true
      server.removeAllListeners('error')
      resolve(available)
    }
    server.unref()
    server.once('error', () => settle(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => settle(true))
    })
  })
}

function allocateTestPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('failed to allocate a test port'))
      })
    })
  })
}

beforeEach(async () => {
  tempRoot = mkdtempSync(join(tmpdir(), 'kun-process-'))
  testKunPort = await allocateTestPort()
  configureLogger({ dir: tempRoot, enabled: true, retentionDays: 7 })
})
afterEach(async () => {
  const module = await import('./kun-process')
  await module.stopKunChildAndWait()
  configureLogger({ dir: '', enabled: true, retentionDays: DEFAULT_LOG_RETENTION_DAYS })
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  }
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  configureManagerAtomicJsonClient(null)
})

describe('Manager-owned Main data plane', () => {
  it('configures Main Registry consumers with the shared Manager endpoint', async () => {
    vi.stubEnv('KUN_MANAGER_BASE_URL', 'http://inherited.invalid')
    vi.stubEnv('KUN_MANAGER_TOKEN', 'inherited-child-value')
    vi.stubEnv('KUN_MANAGER_DATA_DIR', '/tmp/inherited-manager-data')
    const module = await import('./kun-process')
    const manager = {
      discovery: {
        baseUrl: 'http://127.0.0.1:17777',
        managerToken: 'manager-secret',
        dataDir: '/tmp/kun-manager-data'
      }
    } as Parameters<typeof module.configureKunManagerDataPlaneForCurrentProcess>[0]

    module.configureKunManagerDataPlaneForCurrentProcess(manager)

    expect(process.env.KUN_MANAGER_BASE_URL).toBe('http://inherited.invalid')
    expect(process.env.KUN_MANAGER_TOKEN).toBe('inherited-child-value')
    expect(process.env.KUN_MANAGER_DATA_DIR).toBe('/tmp/inherited-manager-data')
    expect(isManagerAtomicJsonPath('/tmp/kun-manager-data/model-connections.v1.json')).toBe(true)
    const child = spawnSync(process.execPath, [
      '-e',
      'process.stdout.write(String(process.env.KUN_MANAGER_TOKEN || ""))'
    ], { encoding: 'utf8' })
    expect(child.stdout).toBe('inherited-child-value')
    expect(child.stdout).not.toContain(manager.discovery.managerToken)
  })

  it('rebinds existing Main document clients after the Manager restarts', async () => {
    const module = await import('./kun-process')
    const managerOne = {
      discovery: {
        baseUrl: 'http://127.0.0.1:17771',
        managerToken: 'manager-one-token',
        dataDir: '/tmp/kun-manager-rebind',
        settingsPath: '/tmp/kun-settings.json'
      }
    } as Parameters<typeof module.configureKunManagerDataPlaneForCurrentProcess>[0]
    const managerTwo = {
      discovery: {
        ...managerOne.discovery,
        baseUrl: 'http://127.0.0.1:17772',
        managerToken: 'manager-two-token'
      }
    } as Parameters<typeof module.configureKunManagerDataPlaneForCurrentProcess>[0]
    const binding = module.configureKunManagerDataPlaneForCurrentProcess(managerOne)
    expect(module.getKunServiceManagerBinding()).toBe(binding)
    const existingClient = new ManagerRevisionedDocumentClient(binding, 'settings')
    const existingLeaseClient = new ManagerResourceLeaseClient(
      binding,
      'production',
      'main-one'
    )
    module.configureKunManagerDataPlaneForCurrentProcess(managerTwo)
    expect(module.getKunServiceManagerBinding()).toBe(binding)
    expect(module.getKunServiceManagerBinding()?.discovery).toBe(managerTwo.discovery)
    const requests: Array<{ url: string; authorization: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        authorization: String((init?.headers as Record<string, string> | undefined)?.authorization ?? '')
      })
      const url = String(input)
      if (url.includes('/v1/documents/')) {
        return Response.json({ snapshot: { revision: 2, value: null } })
      }
      if (url.endsWith('/release')) return Response.json({ released: true })
      const now = Date.now()
      return Response.json({
        acquired: true,
        lease: {
          resource: 'main-registry',
          ownerFlavor: 'production',
          ownerInstanceId: 'main-one',
          fencingToken: 1,
          acquiredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 10_000).toISOString()
        }
      })
    }))

    await expect(existingClient.read()).resolves.toEqual({ revision: 2, value: null })
    await expect(existingLeaseClient.maintain({
      resource: 'main-registry',
      onAcquired: () => undefined,
      onLost: () => undefined
    })).resolves.toBe(true)
    await existingLeaseClient.shutdown()
    expect(requests[0]).toEqual({
      url: 'http://127.0.0.1:17772/v1/documents/settings',
      authorization: 'Bearer manager-two-token'
    })
    expect(requests).toHaveLength(3)
    expect(requests.every((request) =>
      request.url.startsWith('http://127.0.0.1:17772/') &&
      request.authorization === 'Bearer manager-two-token')).toBe(true)
  })

  it('selects a custom Manager data directory from settings without writing settings', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const settingsPath = join(tempRoot, 'custom-data-dir-settings.json')
    const customDataDir = join(tempRoot, 'custom-runtime-data')
    writeFileSync(settingsPath, JSON.stringify({
      version: 1,
      agents: { kun: { dataDir: customDataDir } }
    }))
    const before = readFileSync(settingsPath, 'utf8')
    const module = await import('./kun-process')

    await expect(module.resolveKunManagerDataDirFromSettings(settingsPath)).resolves.toBe(customDataDir)
    expect(readFileSync(settingsPath, 'utf8')).toBe(before)
  })

  it('fails closed when selecting Manager data from a newer settings schema', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const settingsPath = join(tempRoot, 'future-settings.json')
    writeFileSync(settingsPath, JSON.stringify({
      version: 2,
      agents: { kun: { dataDir: join(tempRoot, 'future-runtime-data') } }
    }))
    const module = await import('./kun-process')

    await expect(module.resolveKunManagerDataDirFromSettings(settingsPath)).rejects.toMatchObject({
      code: 'settings_schema_newer',
      storedVersion: 2
    })
  })

  it('safely hands a healthy old Manager from the default data directory to custom authority', async () => {
    const module = await import('./kun-process')
    const oldManager = {
      discovery: {
        instanceId: 'manager-one',
        pid: 12345,
        baseUrl: 'http://127.0.0.1:17771',
        managerToken: 'manager-one-token',
        dataDir: '/tmp/default-runtime-data',
        settingsPath: '/tmp/kun-settings.json'
      }
    } as Parameters<typeof module.handoffExistingKunServiceManagerForDataDir>[0]
    const inspect = vi.fn(async () => null)
    const stop = vi.fn(async () => true)
    const shutdown = vi.fn(async () => undefined)
    const waitForExit = vi.fn(async () => true)

    await module.handoffExistingKunServiceManagerForDataDir(
      oldManager,
      '/tmp/custom-runtime-data',
      '/tmp/kun-settings.json',
      {
        inspect: inspect as never,
        stop: stop as never,
        shutdown,
        waitForExit
      }
    )

    expect(inspect).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledTimes(2)
    expect(shutdown).toHaveBeenCalledOnce()
    expect(waitForExit).toHaveBeenCalledWith(12345, 15_000)
  })

  it('replaces a mismatched Manager build even when canonical paths already match', async () => {
    const module = await import('./kun-process')
    const oldManager = {
      discovery: {
        instanceId: 'manager-old-build',
        pid: 12346,
        baseUrl: 'http://127.0.0.1:17773',
        managerToken: 'manager-old-token',
        dataDir: '/tmp/runtime-data',
        settingsPath: '/tmp/kun-settings.json'
      }
    } as Parameters<typeof module.handoffExistingKunServiceManagerForDataDir>[0]
    const inspect = vi.fn(async () => null)
    const stop = vi.fn(async () => true)
    const shutdown = vi.fn(async () => undefined)
    const waitForExit = vi.fn(async () => true)

    await module.handoffExistingKunServiceManagerForDataDir(
      oldManager,
      '/tmp/runtime-data',
      '/tmp/kun-settings.json',
      {
        inspect: inspect as never,
        stop: stop as never,
        shutdown,
        waitForExit,
        force: true
      }
    )

    expect(inspect).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledTimes(2)
    expect(shutdown).toHaveBeenCalledOnce()
    expect(waitForExit).toHaveBeenCalledWith(12346, 15_000)
  })

  it('reuses a matching Manager when canonical paths already match', async () => {
    const module = await import('./kun-process')
    const manager = {
      discovery: {
        instanceId: 'manager-current-build',
        pid: 12347,
        baseUrl: 'http://127.0.0.1:17774',
        managerToken: 'manager-current-token',
        dataDir: '/tmp/runtime-data',
        settingsPath: '/tmp/kun-settings.json'
      }
    } as Parameters<typeof module.handoffExistingKunServiceManagerForDataDir>[0]
    const inspect = vi.fn(async () => null)
    const shutdown = vi.fn(async () => undefined)

    await module.handoffExistingKunServiceManagerForDataDir(
      manager,
      '/tmp/runtime-data',
      '/tmp/kun-settings.json',
      { inspect: inspect as never, shutdown }
    )

    expect(inspect).not.toHaveBeenCalled()
    expect(shutdown).not.toHaveBeenCalled()
  })
})

describe('startKunChild', () => {
  it('waits for the explicit Kun ready marker before resolving', async () => {
    const script = writeScript(
      'ready-child.js',
      [
        "const http = require('node:http')",
        `const port = ${testKunPort}`,
        "const server = http.createServer((req, res) => {",
        "  res.setHeader('content-type', 'application/json')",
        "  res.end(JSON.stringify({ service: 'kun', mode: 'serve', status: 'ok' }))",
        "})",
        "server.listen(port, '127.0.0.1', () => {",
        "  setTimeout(() => {",
        "    process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port }) + '\\n')",
        "  }, 50)",
        "})",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    const module = await import('./kun-process')
    await expect(module.startKunChild(createSettings(script))).resolves.toBeUndefined()
    expect(module.isKunChildRunning()).toBe(true)
    await module.stopKunChildAndWait()
    const logText = await readKunLog()
    expect(logText).toContain('KUN_READY')
    expect(logText).toContain(`ready marker received on port ${testKunPort}`)
  })

  it('removes inherited Browser Use bridge authority when the feature is disabled', async () => {
    const previousUrl = process.env.KUN_BROWSER_USE_BRIDGE_URL
    const previousToken = process.env.KUN_BROWSER_USE_BRIDGE_TOKEN
    const previousSigningKey = process.env.KUN_BROWSER_USE_APPROVAL_SIGNING_KEY
    process.env.KUN_BROWSER_USE_BRIDGE_URL = 'http://127.0.0.1:65535'
    process.env.KUN_BROWSER_USE_BRIDGE_TOKEN = 'inherited-secret-token'
    process.env.KUN_BROWSER_USE_APPROVAL_SIGNING_KEY = 'inherited-signing-secret'
    const script = writeScript(
      'disabled-browser-use-env-child.js',
      [
        "const http = require('node:http')",
        `const port = ${testKunPort}`,
        "process.stdout.write('BRIDGE_URL=' + String(process.env.KUN_BROWSER_USE_BRIDGE_URL) + '\\n')",
        "process.stdout.write('BRIDGE_TOKEN=' + String(process.env.KUN_BROWSER_USE_BRIDGE_TOKEN) + '\\n')",
        "process.stdout.write('BRIDGE_SIGNING_KEY=' + String(process.env.KUN_BROWSER_USE_APPROVAL_SIGNING_KEY) + '\\n')",
        "const server = http.createServer((_req, res) => {",
        "  res.setHeader('content-type', 'application/json')",
        "  res.end(JSON.stringify({ service: 'kun', mode: 'serve', status: 'ok' }))",
        "})",
        "server.listen(port, '127.0.0.1', () => {",
        "  process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port }) + '\\n')",
        "})",
        "setInterval(() => {}, 1_000)"
      ].join('\n')
    )
    try {
      const module = await import('./kun-process')
      await module.startKunChild(createSettings(script))
      await module.stopKunChildAndWait()
      const logText = await readKunLog()
      expect(logText).toContain('BRIDGE_URL=undefined')
      expect(logText).toContain('BRIDGE_TOKEN=undefined')
      expect(logText).toContain('BRIDGE_SIGNING_KEY=undefined')
      expect(logText).not.toContain('inherited-secret-token')
      expect(logText).not.toContain('inherited-signing-secret')
    } finally {
      if (previousUrl === undefined) delete process.env.KUN_BROWSER_USE_BRIDGE_URL
      else process.env.KUN_BROWSER_USE_BRIDGE_URL = previousUrl
      if (previousToken === undefined) delete process.env.KUN_BROWSER_USE_BRIDGE_TOKEN
      else process.env.KUN_BROWSER_USE_BRIDGE_TOKEN = previousToken
      if (previousSigningKey === undefined) {
        delete process.env.KUN_BROWSER_USE_APPROVAL_SIGNING_KEY
      } else {
        process.env.KUN_BROWSER_USE_APPROVAL_SIGNING_KEY = previousSigningKey
      }
    }
  })

  it('does not settle on the ready marker until the /health endpoint responds', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const healthSignalPath = join(tempRoot, 'allow-health')
    const script = writeScript(
      'marker-without-health-child.js',
      [
        "const http = require('node:http')",
        "const { existsSync } = require('node:fs')",
        `const healthSignalPath = ${JSON.stringify(healthSignalPath)}`,
        `const port = ${testKunPort}`,
        // Emit the ready marker right away but serve no /health yet: the
        // marker alone must NOT be enough to settle the launch.
        "process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port }) + '\\n')",
        'let served = false',
        'setInterval(() => {',
        '  if (served || !existsSync(healthSignalPath)) return',
        '  served = true',
        "  const server = http.createServer((req, res) => {",
        "    res.setHeader('content-type', 'application/json')",
        "    res.end(JSON.stringify({ service: 'kun', mode: 'serve', status: 'ok' }))",
        "  })",
        "  server.listen(port, '127.0.0.1')",
        '}, 10)',
        'setInterval(() => {}, 1_000)'
      ].join('\n')
    )
    const module = await import('./kun-process')
    let resolved = false
    const start = module.startKunChild(createSettings(script)).then(() => {
      resolved = true
    })

    // The marker has been emitted but /health is not up yet. The child is
    // spawned and alive, yet the launch must stay PENDING for the whole
    // window (the startup timeout is far larger, so it cannot mask this).
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(resolved).toBe(false)

    // Bring /health online; the parallel probe now settles the launch.
    writeFileSync(healthSignalPath, 'ok', 'utf8')
    await start
    expect(resolved).toBe(true)
    expect(module.isKunChildRunning()).toBe(true)

    await module.stopKunChildAndWait()
  })

  it('shares the startup promise while Kun is spawned but not ready', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const readySignalPath = join(tempRoot, 'allow-ready')
    const script = writeScript(
      'delayed-ready-child.js',
      [
        "const http = require('node:http')",
        "const { existsSync } = require('node:fs')",
        `const readySignalPath = ${JSON.stringify(readySignalPath)}`,
        `const port = ${testKunPort}`,
        'let sentReady = false',
        // Only stand up the /health server once the signal exists so the
        // parallel health probe cannot settle the launch before then.
        'setInterval(() => {',
        '  if (sentReady || !existsSync(readySignalPath)) return',
        '  sentReady = true',
        "  const server = http.createServer((req, res) => {",
        "    res.setHeader('content-type', 'application/json')",
        "    res.end(JSON.stringify({ service: 'kun', mode: 'serve', status: 'ok' }))",
        "  })",
        "  server.listen(port, '127.0.0.1', () => {",
        "    process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port }) + '\\n')",
        "  })",
        '}, 10)',
        'setInterval(() => {}, 1_000)'
      ].join('\n')
    )
    const module = await import('./kun-process')
    const settings = createSettings(script)
    const first = module.startKunChild(settings)

    for (let attempt = 0; attempt < 100 && !module.isKunChildRunning(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(module.isKunChildRunning()).toBe(true)

    let secondResolved = false
    const second = module.startKunChild(settings).then(() => {
      secondResolved = true
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(secondResolved).toBe(false)

    writeFileSync(readySignalPath, 'ready', 'utf8')
    await first
    await second
    expect(secondResolved).toBe(true)
  })

  it('rejects when the child exits before reporting ready', async () => {
    const script = writeScript(
      'exit-child.js',
      [
        "process.stderr.write('bind failed on port 18899\\n')",
        'setTimeout(() => process.exit(23), 20)'
      ].join('\n')
    )
    const module = await import('./kun-process')
    await expect(module.startKunChild(createSettings(script))).rejects.toThrow(
      /Kun exited during startup with code 23[\s\S]*bind failed on port 18899/
    )
    expect(module.isKunChildRunning()).toBe(false)
    await module.stopKunChildAndWait()
    const logText = await readKunLog()
    expect(logText).toContain('bind failed on port 18899')
    expect(logText).toContain('exited with code 23')
  })
})

describe('startKunSharedRuntime', () => {
  it('refuses to start a second writer beside an unpublished GUI-private runtime', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const body = JSON.stringify({ dataDir: tempRoot })
    const server = createServer((socket) => {
      socket.once('data', () => {
        socket.end([
          'HTTP/1.1 200 OK',
          'Content-Type: application/json',
          `Content-Length: ${Buffer.byteLength(body)}`,
          'Connection: close',
          '',
          body
        ].join('\r\n'))
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(testKunPort, '127.0.0.1', resolve)
    })
    try {
      const module = await import('./kun-process')
      const settings = createSettings('/tmp/unused-kun-entry.js')
      settings.agents.kun.dataDir = tempRoot

      await expect(module.startKunSharedRuntime(settings)).rejects.toThrow(
        'older GUI-private Kun runtime'
      )
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('resolveKunStartupTimeoutMs', () => {
  it('gives Windows the larger default and other platforms a smaller one', async () => {
    const { resolveKunStartupTimeoutMs } = await import('./kun-process')
    expect(resolveKunStartupTimeoutMs('win32', {})).toBe(90_000)
    expect(resolveKunStartupTimeoutMs('darwin', {})).toBe(60_000)
    expect(resolveKunStartupTimeoutMs('linux', {})).toBe(60_000)
  })

  it('honors a valid KUN_STARTUP_TIMEOUT_MS override on every platform', async () => {
    const { resolveKunStartupTimeoutMs } = await import('./kun-process')
    expect(resolveKunStartupTimeoutMs('win32', { KUN_STARTUP_TIMEOUT_MS: '120000' })).toBe(120_000)
    expect(resolveKunStartupTimeoutMs('linux', { KUN_STARTUP_TIMEOUT_MS: ' 30000 ' })).toBe(30_000)
  })

  it('clamps an out-of-range override to the 15s–10min bounds', async () => {
    const { resolveKunStartupTimeoutMs } = await import('./kun-process')
    expect(resolveKunStartupTimeoutMs('linux', { KUN_STARTUP_TIMEOUT_MS: '1000' })).toBe(15_000)
    expect(resolveKunStartupTimeoutMs('linux', { KUN_STARTUP_TIMEOUT_MS: '99999999' })).toBe(600_000)
  })

  it('falls back to the platform default when the override is not a finite number', async () => {
    const { resolveKunStartupTimeoutMs } = await import('./kun-process')
    expect(resolveKunStartupTimeoutMs('win32', { KUN_STARTUP_TIMEOUT_MS: 'soon' })).toBe(90_000)
    expect(resolveKunStartupTimeoutMs('darwin', { KUN_STARTUP_TIMEOUT_MS: '' })).toBe(60_000)
    expect(resolveKunStartupTimeoutMs('darwin', { KUN_STARTUP_TIMEOUT_MS: '   ' })).toBe(60_000)
  })
})

describe('waitForKunStartupSettled', () => {
  it('resolves immediately when no launch is in flight', async () => {
    const module = await import('./kun-process')
    let resolved = false
    await Promise.race([
      module.waitForKunStartupSettled().then(() => {
        resolved = true
      }),
      new Promise((resolve) => setTimeout(resolve, 50))
    ])
    expect(resolved).toBe(true)
  })

  it('does not resolve until an in-flight launch settles', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const readySignalPath = join(tempRoot, 'allow-ready-settled')
    const script = writeScript(
      'settled-delayed-child.js',
      [
        "const http = require('node:http')",
        "const { existsSync } = require('node:fs')",
        `const readySignalPath = ${JSON.stringify(readySignalPath)}`,
        `const port = ${testKunPort}`,
        'let sentReady = false',
        // Only stand up the /health server once the signal exists so the
        // parallel health probe cannot settle the launch before then.
        'setInterval(() => {',
        '  if (sentReady || !existsSync(readySignalPath)) return',
        '  sentReady = true',
        "  const server = http.createServer((req, res) => {",
        "    res.setHeader('content-type', 'application/json')",
        "    res.end(JSON.stringify({ service: 'kun', mode: 'serve', status: 'ok' }))",
        "  })",
        "  server.listen(port, '127.0.0.1', () => {",
        "    process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port }) + '\\n')",
        "  })",
        '}, 10)',
        'setInterval(() => {}, 1_000)'
      ].join('\n')
    )
    const module = await import('./kun-process')
    const settings = createSettings(script)
    const start = module.startKunChild(settings)

    for (let attempt = 0; attempt < 100 && !module.isKunChildRunning(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(module.isKunChildRunning()).toBe(true)

    let settled = false
    const settledPromise = module.waitForKunStartupSettled().then(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(settled).toBe(false)

    writeFileSync(readySignalPath, 'ready', 'utf8')
    await start
    await settledPromise
    expect(settled).toBe(true)

    await module.stopKunChildAndWait()
  })
})
