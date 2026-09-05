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
vi.mock('../../kun/src/manager/manager-discovery.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../kun/src/manager/manager-discovery.js')>()),
  defaultKunControlDir: () => join(tempRoot ?? tmpdir(), 'manager-control')
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
        autoStart: true, dataDir: join(tempRoot ?? tmpdir(), 'runtime-data')
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

describe('reclaimKunPort', () => {
  it('reports a port as unavailable when another listener owns it', async () => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    try {
      const address = server.address() as AddressInfo
      const module = await import('./kun-process')

      await expect(module.reclaimKunPort(address.port)).resolves.toEqual({
        ok: false,
        message: `port ${address.port} is in use`
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('allows non-positive ports so Kun can request an ephemeral port', async () => {
    const module = await import('./kun-process')

    await expect(module.reclaimKunPort(0)).resolves.toEqual({ ok: true })
  })

  it('resolves the next available fallback port when the preferred port is unavailable', async () => {
    let server: ReturnType<typeof createServer> | null = null
    let preferredPort = 0
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = createServer()
      await new Promise<void>((resolve, reject) => {
        candidate.once('error', reject)
        candidate.listen(0, '127.0.0.1', () => resolve())
      })
      const address = candidate.address() as AddressInfo
      if (address.port < 65_535 && await canBindTestPort(address.port + 1)) {
        server = candidate
        preferredPort = address.port
        break
      }
      await new Promise<void>((resolve) => candidate.close(() => resolve()))
    }
    if (!server || preferredPort <= 0) {
      throw new Error('Could not find consecutive test ports')
    }
    try {
      const module = await import('./kun-process')

      const resolved = await module.resolveAvailableKunPort(preferredPort)

      expect(resolved).toEqual({
        port: preferredPort + 1,
        changed: true,
        message: `port ${preferredPort} is in use`
      })
      await expect(module.reclaimKunPort(resolved.port)).resolves.toEqual({ ok: true })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('keeps the configured endpoint when the currently managed Kun child owns it', async () => {
    const probe = createServer()
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(0, '127.0.0.1', () => resolve())
    })
    const preferredPort = (probe.address() as AddressInfo).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))

    const script = writeScript(
      'serve-entry-current-child.js',
      [
        "const http = require('node:http')",
        `const port = ${preferredPort}`,
        "const server = http.createServer((req, res) => {",
        "  res.setHeader('content-type', 'application/json')",
        "  res.end(JSON.stringify({ service: 'kun', mode: 'serve', status: 'ok' }))",
        "})",
        "server.listen(port, '127.0.0.1', () => {",
        "  process.stdout.write('KUN_READY ' + JSON.stringify({ service: 'kun', mode: 'serve', port }) + '\\n')",
        "})",
        'setInterval(() => {}, 1_000)'
      ].join('\n')
    )
    const module = await import('./kun-process')
    const settings = createSettings(script)
    settings.agents.kun.port = preferredPort

    await module.startKunChild(settings)
    const resolved = await module.resolveAvailableKunPort(preferredPort)

    expect(resolved).toEqual({ port: preferredPort, changed: false })
    expect(module.isKunChildRunning()).toBe(true)
    expect(await readKunLog()).not.toContain(`killing stale kun process holding port ${preferredPort}`)
  })
})

describe('resolveKunDataDir', () => {
  it('expands Windows-style home-relative data directories', async () => {
    const module = await import('./kun-process')

    expect(module.resolveKunDataDir({ dataDir: '~\\deepseek\\kun' })).toBe(join(homedir(), 'deepseek', 'kun'))
  })

  it('does not expand non-home tilde prefixes', async () => {
    const module = await import('./kun-process')

    expect(module.resolveKunDataDir({ dataDir: '~other\\kun' })).toBe('~other\\kun')
  })

  it('rejects the canonical legacy directory before managed config writes', async () => {
    const module = await import('./kun-process')
    const legacyDataDir = join(homedir(), '.deepseekgui', 'kun')

    expect(() => module.resolveKunDataDir({ dataDir: legacyDataDir }))
      .toThrow(/migration is required/)
    await expect(module.syncGuiManagedKunConfig(
      legacyDataDir,
      defaultKunRuntimeSettings()
    )).rejects.toThrow(/migration is required/)
  })
})

describe('parseListeningPidsFromNetstat', () => {
  it('extracts the listening TCP PIDs for the port across IPv4/IPv6, ignoring everything else', async () => {
    const { parseListeningPidsFromNetstat } = await import('./kun-process')
    const targetPort = 18899
    const otherPort = targetPort + 1
    const output = [
      '',
      'Active Connections',
      '',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1010',
      `  TCP    127.0.0.1:${targetPort}         0.0.0.0:0              LISTENING       6789`,
      `  TCP    [::1]:${targetPort}             [::]:0                 LISTENING       6789`,
      `  TCP    127.0.0.1:${targetPort}         127.0.0.1:51000        ESTABLISHED     7000`,
      `  TCP    127.0.0.1:${otherPort}         0.0.0.0:0              LISTENING       8000`,
      `  UDP    0.0.0.0:${targetPort}           *:*                                    9000`,
      `  TCP    127.0.0.1:${targetPort}         0.0.0.0:0              LISTENING       ${process.pid}`,
      ''
    ].join('\r\n')

    // Dedups IPv4+IPv6 rows for the same PID; excludes the :135 listener, the
    // ESTABLISHED row, the different TCP port, the UDP row, and our own PID.
    expect(parseListeningPidsFromNetstat(output, targetPort)).toEqual([6789])
  })

  it('returns no PIDs when nothing listens on the port', async () => {
    const { parseListeningPidsFromNetstat } = await import('./kun-process')
    const output = '  TCP    127.0.0.1:18899         0.0.0.0:0              LISTENING       6789'

    expect(parseListeningPidsFromNetstat(output, 9999)).toEqual([])
  })
})

describe('terminateVerifiedPid', () => {
  it('does not signal a process when the caller can no longer verify its identity', async () => {
    const { terminateVerifiedPid } = await import('./kun-process-ports')
    const kill = vi.spyOn(process, 'kill')

    await expect(terminateVerifiedPid(
      987_654,
      async () => false,
      async () => false
    )).resolves.toBe(false)

    expect(kill).not.toHaveBeenCalled()
  })

})

describe('processIdentity', () => {
  it.runIf(process.platform === 'win32')(
    'reads a complete identity through Windows PowerShell 5.1',
    async () => {
      const { processIdentity } = await import('./kun-process-ports')

      const identity = await processIdentity(process.pid)

      expect(identity).toMatchObject({
        pid: process.pid,
        executablePath: expect.any(String),
        commandLine: expect.any(String),
        startedAtMs: expect.any(Number)
      })
    }
  )
})
