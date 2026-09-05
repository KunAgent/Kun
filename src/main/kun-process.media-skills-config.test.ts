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

describe('syncGuiManagedKunConfig', () => {
  it('forwards the selected Volcano Ark media gateway without persisting its key', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const defaults = defaultKunRuntimeSettings()

    await module.syncGuiManagedKunConfig(tempRoot, {
      ...defaults,
      imageGeneration: {
        ...defaults.imageGeneration,
        enabled: true,
        providerId: 'volcengine-agent-plan',
        protocol: 'volcengine-ark-image',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        apiKey: 'agent-plan-key',
        model: 'doubao-seedream-5.0-lite',
        defaultResolution: '4K'
      },
      videoGeneration: {
        ...defaults.videoGeneration,
        enabled: true,
        providerId: 'volcengine-agent-plan',
        protocol: 'volcengine-ark-video',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        apiKey: 'agent-plan-key',
        model: 'doubao-seedance-2.0',
        defaultDuration: 15,
        defaultResolution: '4K'
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.imageGen).toMatchObject({
      enabled: true,
      providerId: 'volcengine-agent-plan',
      protocol: 'volcengine-ark-image',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      model: 'doubao-seedream-5.0-lite',
      defaultResolution: '4K'
    })
    expect(parsed.capabilities.videoGen).toMatchObject({
      enabled: true,
      providerId: 'volcengine-agent-plan',
      protocol: 'volcengine-ark-video',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
      model: 'doubao-seedance-2.0',
      defaultDuration: 15,
      defaultResolution: '4K'
    })
    expect(parsed.capabilities.imageGen.apiKey).toBeUndefined()
    expect(parsed.capabilities.videoGen.apiKey).toBeUndefined()
    expect(parsed.capabilities.imageGen.headers).toBeUndefined()
    expect(parsed.capabilities.videoGen.headers).toBeUndefined()
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
  })

  it('replaces stale GUI-managed model profile fields while preserving compaction overrides', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    writeFileSync(configPath, JSON.stringify({
      models: {
        profiles: {
          'gpt-5.5': {
            contextWindowTokens: 128000,
            maxOutputTokens: 16000,
            inputModalities: ['text', 'image'],
            outputModalities: ['text'],
            supportsToolCalling: true,
            messageParts: ['text', 'image_url'],
            endpointFormat: 'responses',
            contextCompaction: { softThreshold: 900000 }
          },
          'user-model': {
            contextWindowTokens: 96000,
            endpointFormat: 'messages',
            contextCompaction: { softThreshold: 86000 }
          }
        }
      }
    }), 'utf8')

    await module.syncGuiManagedKunConfig(tempRoot, {
      ...defaultKunRuntimeSettings(),
      modelProfiles: {
        'gpt-5.5': {
          contextWindowTokens: 1_000_000,
          inputModalities: ['text', 'image'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text', 'image_url']
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.models.profiles['gpt-5.5']).toMatchObject({
      contextWindowTokens: 1_000_000,
      inputModalities: ['text', 'image'],
      contextCompaction: { softThreshold: 900000 }
    })
    expect(parsed.models.profiles['gpt-5.5'].endpointFormat).toBeUndefined()
    expect(parsed.models.profiles['gpt-5.5'].maxOutputTokens).toBeUndefined()
    expect(parsed.models.profiles['user-model']).toMatchObject({
      contextWindowTokens: 96000,
      endpointFormat: 'messages',
      contextCompaction: { softThreshold: 86000 }
    })
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
  })

  it('keeps the config stable across repeated syncs with imageGen configured', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const runtime = {
      ...defaultKunRuntimeSettings(),
      imageGeneration: {
        enabled: true,
        providerId: '',
        protocol: 'openai-images' as const,
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-image-test',
        model: 'Kwai-Kolors/Kolors',
        defaultResolution: '1K' as const,
        defaultSize: '1024x1024',
        quality: 'auto' as const,
        timeoutMs: 180000
      }
    }

    await module.syncGuiManagedKunConfig(tempRoot, runtime)
    const firstText = readFileSync(configPath, 'utf8')
    const firstMtime = statSync(configPath).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 25))

    // If the capability sanitizer strips imageGen from the existing config,
    // every sync rewrites the file and restarts Kun in a loop.
    await module.syncGuiManagedKunConfig(tempRoot, runtime)
    expect(readFileSync(configPath, 'utf8')).toBe(firstText)
    expect(statSync(configPath).mtimeMs).toBe(firstMtime)
  })

  it('writes media generation capabilities and omits cleared optional fields', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const runtime = {
      ...defaultKunRuntimeSettings(),
      textToSpeech: {
        enabled: true,
        providerId: '',
        protocol: 'minimax-t2a' as const,
        baseUrl: 'https://api.minimax.io',
        apiKey: 'sk-tts-test',
        model: 'speech-2.8-hd',
        voice: 'male-qn-qingse',
        format: 'mp3',
        timeoutMs: 120000
      },
      musicGeneration: {
        enabled: true,
        providerId: '',
        protocol: 'minimax-music' as const,
        baseUrl: 'https://api.minimax.io',
        apiKey: 'sk-music-test',
        model: 'music-2.6',
        format: 'mp3',
        timeoutMs: 300000
      },
      videoGeneration: {
        enabled: true,
        providerId: '',
        protocol: 'minimax-video' as const,
        baseUrl: 'https://api.minimax.io',
        apiKey: 'sk-video-test',
        model: 'MiniMax-Hailuo-2.3',
        defaultDuration: 6,
        defaultResolution: '1080P',
        timeoutMs: 900000,
        pollIntervalMs: 10000
      }
    }

    await module.syncGuiManagedKunConfig(tempRoot, runtime)

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.speechGen).toEqual({
      enabled: true,
      protocol: 'minimax-t2a',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-tts-test',
      model: 'speech-2.8-hd',
      voice: 'male-qn-qingse',
      format: 'mp3',
      timeoutMs: 120000
    })
    expect(parsed.capabilities.musicGen).toEqual({
      enabled: true,
      protocol: 'minimax-music',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-music-test',
      model: 'music-2.6',
      format: 'mp3',
      timeoutMs: 300000
    })
    expect(parsed.capabilities.videoGen).toEqual({
      enabled: true,
      protocol: 'minimax-video',
      baseUrl: 'https://api.minimax.io',
      apiKey: 'sk-video-test',
      model: 'MiniMax-Hailuo-2.3',
      defaultDuration: 6,
      defaultResolution: '1080P',
      timeoutMs: 900000,
      pollIntervalMs: 10000
    })
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)

    await module.syncGuiManagedKunConfig(tempRoot, {
      ...runtime,
      textToSpeech: { ...runtime.textToSpeech, apiKey: '', voice: '' }
    })
    const cleared = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect('apiKey' in cleared.capabilities.speechGen).toBe(false)
    expect('voice' in cleared.capabilities.speechGen).toBe(false)
  })

  it('adds the built-in schedule MCP server to Kun runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const settings = createSettings('/tmp/fake-kun-child.js')
    settings.schedule.internal.port = 19788
    settings.schedule.internal.secret = 'top-secret'

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      scheduleMcp: {
        settings,
        launch: {
          appPath: '/tmp/deepseek-gui-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.gui_schedule).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: '/tmp/electron',
      args: [
        '/tmp/deepseek-gui-test-app/out/main/claw-schedule-mcp-node-entry.js',
        '--gui-schedule-mcp-server',
        '--base-url',
        'http://127.0.0.1:19788',
        '--secret',
        'top-secret',
        '--workflow-base-url',
        'http://127.0.0.1:18799'
      ],
      env: {
        ELECTRON_RUN_AS_NODE: '1'
      },
      trustScope: 'user'
    })
  })

  it('adds GUI project and configured global skill roots to Kun runtime capabilities', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const settings = createSettings('/tmp/fake-kun-child.js')
    const workspaceRoot = join(tempRoot, 'workspace')
    const extraRoot = join(tempRoot, 'extra-skills')
    settings.workspaceRoot = workspaceRoot
    settings.claw.skills.extraDirs = [extraRoot]
    mkdirSync(join(workspaceRoot, '.codex', 'skills'), { recursive: true })

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      scheduleMcp: {
        settings,
        launch: {
          appPath: '/tmp/deepseek-gui-test-app',
          execPath: '/tmp/electron',
          isPackaged: false
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.skills.enabled).toBe(true)
    expect(parsed.capabilities.skills.legacySkillMd).toBe(true)
    expect(parsed.capabilities.skills.roots).toEqual(expect.arrayContaining([
      join(workspaceRoot, '.codex', 'skills')
    ]))
    expect(parsed.capabilities.skills.globalRoots).toEqual(expect.arrayContaining([
      extraRoot
    ]))
  })

  it('re-enables skills when roots are discovered despite a persisted enabled:false', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    // Simulate a config whose skills capability was persisted with the schema
    // default enabled:false (there is no user-facing disable toggle).
    writeFileSync(configPath, JSON.stringify({
      capabilities: { skills: { enabled: false, roots: [], legacySkillMd: true } }
    }), 'utf8')
    const module = await import('./kun-process')
    const settings = createSettings('/tmp/fake-kun-child.js')
    const workspaceRoot = join(tempRoot, 'workspace')
    settings.workspaceRoot = workspaceRoot
    mkdirSync(join(workspaceRoot, '.codex', 'skills'), { recursive: true })

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      scheduleMcp: {
        settings,
        launch: { appPath: '/tmp/deepseek-gui-test-app', execPath: '/tmp/electron', isPackaged: false }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.skills.enabled).toBe(true)
    expect(parsed.capabilities.skills.roots).toEqual(expect.arrayContaining([
      join(workspaceRoot, '.codex', 'skills')
    ]))
  })

  it('drops stale Codex plugin cache roots but keeps hand-added manual roots', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    // A version directory left behind by a plugin upgrade and a root a user
    // added by hand to the Kun config file.
    const staleRoot = join(homedir(), '.codex', 'plugins', 'cache', 'gmail', '0.0.0-stale', 'skills')
    const manualRoot = join(tempRoot, 'manual', 'skills')
    writeFileSync(configPath, JSON.stringify({
      capabilities: { skills: { enabled: true, roots: [staleRoot, manualRoot], legacySkillMd: true } }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.skills.roots).not.toContain(staleRoot)
    expect(parsed.capabilities.skills.roots).toContain(manualRoot)
  })

  it('writes the current bundled skill root and replaces a stale app path', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const bundledRoot = join(tempRoot, 'current-app', 'bundled-skills')
    writeFileSync(configPath, JSON.stringify({
      capabilities: {
        skills: {
          enabled: true,
          roots: [],
          globalRoots: [],
          builtinRoots: [join(tempRoot, 'old-app', 'bundled-skills')]
        }
      }
    }), 'utf8')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      builtinSkillsRoot: bundledRoot
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.skills.builtinRoots).toEqual([bundledRoot])
    expect(parsed.capabilities.skills.enabled).toBe(true)
  })

  it('forwards GUI disabledSkillIds into the runtime skills capability', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const settings = createSettings('/tmp/fake-kun-child.js')
    settings.disabledSkillIds = ['gmail', 'vercel-agent']

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings(), {
      scheduleMcp: {
        settings,
        launch: { appPath: '/tmp/deepseek-gui-test-app', execPath: '/tmp/electron', isPackaged: false }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.skills.disabledIds).toEqual(['gmail', 'vercel-agent'])
  })

})
