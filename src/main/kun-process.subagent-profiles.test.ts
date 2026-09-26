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
  defaultTerminalSettings, defaultRemoteAccessSettings,
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
    remote: defaultRemoteAccessSettings(),
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

describe('subagentProfilesForRuntime', () => {
  it('drops blank fields and legacy partial routing so the profile inherits a coherent pair', async () => {
    const module = await import('./kun-process')
    // Built-in profiles store an empty `name` (the GUI localizes the label) and
    // the user picked a model on one of them. The runtime schema marks every
    // optional string `.min(1)`, so a forwarded empty string used to throw and
    // strand the runtime at "无法连接到本地运行时".
    const config = module.subagentProfilesForRuntime({
      enabled: true,
      profiles: [
        {
          id: 'general',
          enabled: true,
          name: '',
          mode: 'subagent',
          toolPolicy: 'inherit',
          model: 'deepseek-v4',
          description: '   '
        }
      ]
    })

    expect(config.profiles.general).toBeDefined()
    expect('name' in config.profiles.general).toBe(false)
    expect('description' in config.profiles.general).toBe(false)
    expect(config.profiles.general.model).toBeUndefined()
    expect(config.profiles.general.providerId).toBeUndefined()
    expect(config.useExistingAgents).toBe(true)
  })

  it('preserves the parent-generated delegation mode', async () => {
    const module = await import('./kun-process')
    const legacySettings = {
      enabled: true,
      useExistingAgents: false,
      maxChildRuns: 1,
      profiles: []
    }
    const config = module.subagentProfilesForRuntime(legacySettings)

    expect(config.useExistingAgents).toBe(false)
    expect(config).not.toHaveProperty('maxChildRuns')
  })

  it('removes provider-only legacy routing without dropping the rest of the profile', async () => {
    const module = await import('./kun-process')
    const config = module.subagentProfilesForRuntime({
      enabled: true,
      profiles: [
        {
          id: 'custom',
          enabled: true,
          name: 'Safe reviewer',
          mode: 'subagent',
          toolPolicy: 'readOnly',
          providerId: 'openai',
          blockedTools: ['write']
        }
      ]
    })

    expect(config.profiles.custom).toMatchObject({
      name: 'Safe reviewer',
      toolPolicy: 'readOnly',
      blockedTools: ['write']
    })
    expect(config.profiles.custom.model).toBeUndefined()
    expect(config.profiles.custom.providerId).toBeUndefined()
  })

  it('keeps a non-empty name', async () => {
    const module = await import('./kun-process')
    const config = module.subagentProfilesForRuntime({
      enabled: true,
      profiles: [
        { id: 'custom', enabled: true, name: '我的代理', mode: 'subagent', toolPolicy: 'inherit' }
      ]
    })
    expect(config.profiles.custom.name).toBe('我的代理')
  })

  it('preserves legacy disabled builtin overrides while dropping disabled custom profiles', async () => {
    const module = await import('./kun-process')
    const config = module.subagentProfilesForRuntime({
      enabled: true,
      profiles: [
        {
          id: 'general',
          enabled: false,
          name: '',
          mode: 'subagent',
          toolPolicy: 'readOnly',
          model: 'review-model',
          providerId: 'provider-a',
          blockedSkills: ['unsafe-skill']
        },
        {
          id: 'custom-disabled',
          enabled: false,
          name: 'Disabled custom',
          mode: 'subagent',
          toolPolicy: 'readOnly'
        },
        {
          id: 'component-designer',
          enabled: false,
          name: '',
          mode: 'subagent',
          toolPolicy: 'inherit'
        },
        {
          id: 'security-auditor',
          enabled: false,
          name: '',
          mode: 'subagent',
          toolPolicy: 'readOnly',
          model: 'security-model'
        }
      ]
    })

    expect(config.profiles.general).toMatchObject({
      model: 'review-model',
      providerId: 'provider-a',
      toolPolicy: 'readOnly',
      blockedSkills: ['unsafe-skill']
    })
    expect(config.profiles['component-designer']).toBeDefined()
    expect(config.profiles['security-auditor']).toMatchObject({ toolPolicy: 'readOnly' })
    expect(config.profiles['security-auditor'].model).toBeUndefined()
    expect(config.profiles['security-auditor'].providerId).toBeUndefined()
    expect(config.profiles['custom-disabled']).toBeUndefined()
  })
})
