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
  it('exports provider model profiles even when the runtime snapshot is stale', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const settings = createSettings('/tmp/fake-kun-child.js')
    const preset = getModelProviderPreset('gemini-cli-subscription')
    if (!preset) throw new Error('Gemini CLI subscription preset is missing')
    const geminiProvider = modelProviderPresetProfile(preset, '')
    settings.provider.providers.push(geminiProvider)
    settings.agents.kun = {
      ...settings.agents.kun,
      providerId: geminiProvider.id,
      model: 'gemini-2.5-flash',
      modelProfiles: {}
    }

    await module.syncGuiManagedKunConfig(tempRoot, settings.agents.kun, {
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
    expect(parsed.models.profiles['gemini-2.5-flash']).toMatchObject({
      contextWindowTokens: 1_048_576
    })
  })

  it('keeps same-id model profiles scoped to their provider in runtime config', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const settings = createSettings('/tmp/fake-kun-child.js')
    const profile = (
      endpointFormat: 'messages' | 'responses',
      contextWindowTokens: number
    ): ModelProviderModelProfileV1 => ({
      contextWindowTokens,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text'],
      endpointFormat
    })
    settings.provider.providers.push(
      {
        id: 'shared-a',
        name: 'Shared A',
        apiKey: 'sk-a',
        baseUrl: 'https://a.example/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        models: ['shared-model'],
        modelProfiles: { 'shared-model': profile('messages', 128_000) }
      },
      {
        id: 'shared-b',
        name: 'Shared B',
        apiKey: 'sk-b',
        baseUrl: 'https://b.example/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        models: ['shared-model'],
        modelProfiles: { 'shared-model': profile('responses', 256_000) }
      }
    )
    settings.agents.kun = {
      ...settings.agents.kun,
      providerId: 'shared-b',
      model: 'shared-model'
    }

    await module.syncGuiManagedKunConfig(tempRoot, resolveKunRuntimeSettings(settings), {
      appSettings: settings
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
    expect(parsed.models.profiles['shared-model']).toMatchObject({
      endpointFormat: 'responses',
      contextWindowTokens: 256_000
    })
    expect(parsed.serve.providers['shared-a'].modelProfiles['shared-model']).toMatchObject({
      endpointFormat: 'messages',
      contextWindowTokens: 128_000
    })
    expect(parsed.serve.providers['shared-b'].modelProfiles['shared-model']).toMatchObject({
      endpointFormat: 'responses',
      contextWindowTokens: 256_000
    })
  })

  it('creates GUI-managed config with attachments enabled for image paste/upload', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, defaultKunRuntimeSettings())

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.serve.storage).toMatchObject({ backend: 'hybrid' })
    expect(parsed.serve.tokenEconomy).toMatchObject({
      enabled: false,
      compressToolDescriptions: true,
      compressToolResults: true,
      conciseResponses: true,
      historyHygiene: {
        maxToolResultLines: 320,
        maxToolResultBytes: 32768,
        maxToolResultTokens: 8000,
        maxToolArgumentStringBytes: 8192,
        maxToolArgumentStringTokens: 2000,
        maxArrayItems: 80
      }
    })
    expect(parsed.serve.toolOutputLimits).toEqual({
      maxLines: DEFAULT_TOOL_OUTPUT_MAX_LINES,
      maxBytes: DEFAULT_TOOL_OUTPUT_MAX_BYTES
    })
    expect(parsed.contextCompaction).toMatchObject({
      defaultSoftThreshold: 192000,
      defaultHardThreshold: 217600,
      summaryMode: 'model'
    })
    expect(parsed.models.profiles['deepseek-v4-pro']).toMatchObject({
      contextWindowTokens: 1_000_000,
      contextCompaction: {
        softThreshold: 980_000,
        hardThreshold: 990_000
      }
    })
    expect(parsed.models.profiles['deepseek-v4-flash']).toMatchObject({
      aliases: ['deepseek-chat', 'deepseek-reasoner'],
      contextWindowTokens: 1_000_000,
      contextCompaction: {
        softThreshold: 980_000,
        hardThreshold: 990_000
      }
    })
    expect(parsed.runtime.streamIdleTimeoutMs).toBe(450000)
    expect(parsed.runtime.turnLimits).toMatchObject({
      maxConcurrentTurns: 256,
      maxWallTimeMs: 86400000
    })
    expect(parsed.runtime.toolStorm).toMatchObject({ enabled: true })
    expect(parsed.runtime.toolArgumentRepair).toMatchObject({ maxStringBytes: 524288 })
    expect(parsed.capabilities.attachments).toMatchObject({ enabled: true })
    expect(parsed.capabilities.memory).toMatchObject({ enabled: false })
    expect(parsed.capabilities.instructions).toMatchObject({ enabled: true })
    expect(parsed.capabilities.browserUse).toEqual({
      enabled: true,
      mode: 'public',
      approvalMode: 'auto-safe',
      maxTabs: 2,
      maxObservationActionsPerTurn: 30,
      maxInteractionActionsPerTurn: 12,
      maxSnapshotNodes: 250,
      maxSnapshotTextChars: 20000,
      maxImageDimension: 1280,
      idleTimeoutMs: 300000
    })
    // Subagents have no GUI enable toggle: they default ON so delegate_task + the
    // built-in profiles are always offered. maxParallel remains the live queue
    // concurrency control; there is no cumulative child-run limit.
    expect(parsed.capabilities.subagents).toMatchObject({
      enabled: true,
      useExistingAgents: true,
      maxParallel: 256
    })
    expect(parsed.capabilities.subagents).not.toHaveProperty('maxChildRuns')
    expect(parsed.capabilities.web).toMatchObject({ enabled: true, fetchEnabled: true })
    expect(parsed.capabilities.mcp.search).toMatchObject({ enabled: false, mode: 'auto' })
    expect(parsed.capabilities.imageGen).toEqual({
      enabled: false,
      protocol: 'openai-images',
      defaultResolution: '1K',
      quality: 'auto',
      timeoutMs: 180000
    })
    expect(parsed.capabilities.speechGen).toEqual({
      enabled: false,
      protocol: 'openai-speech',
      timeoutMs: 120000,
      format: 'mp3'
    })
    expect(parsed.capabilities.musicGen).toEqual({
      enabled: false,
      protocol: 'minimax-music',
      timeoutMs: 300000,
      format: 'mp3'
    })
    expect(parsed.capabilities.videoGen).toEqual({
      enabled: false,
      protocol: 'minimax-video',
      defaultDuration: 6,
      defaultResolution: '1080P',
      timeoutMs: 900000,
      pollIntervalMs: 10000
    })
  })

  it('exports per-model max output tokens into Kun model profiles', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, {
      ...defaultKunRuntimeSettings(),
      modelProfiles: {
        writer: {
          contextWindowTokens: 256_000,
          maxOutputTokens: 32_000,
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsToolCalling: true,
          messageParts: ['text']
        }
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
    expect(parsed.models.profiles.writer).toMatchObject({
      contextWindowTokens: 256_000,
      maxOutputTokens: 32_000
    })
  })

  it('writes explicit direct and proxied routes without cross-provider fallback', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const settings = createSettings('/tmp/fake-kun-child.js')
    settings.provider.proxy = { enabled: true, url: 'socks5://127.0.0.1:1080' }
    const deepseek = settings.provider.providers.find((provider) => provider.id === 'deepseek')!
    deepseek.useProxy = true
    settings.provider.providers = [
      ...settings.provider.providers,
      {
        id: 'custom',
        name: 'NewAPI',
        apiKey: 'sk-newapi',
        baseUrl: 'https://newapi.example/v1',
        endpointFormat: 'chat_completions',
        useProxy: false,
        retry: {
          maxAttempts: 0,
          initialDelayMs: 3000,
          httpStatusCodes: [429, 503]
        },
        models: ['glm-5.2'],
        modelProfiles: {}
      }
    ]
    settings.agents.kun = {
      ...settings.agents.kun,
      providerId: 'custom',
      model: 'glm-5.2'
    }

    await module.syncGuiManagedKunConfig(tempRoot, resolveKunRuntimeSettings(settings), {
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
    expect(parsed.serve).toMatchObject({
      baseUrl: 'https://newapi.example/v1',
      endpointFormat: 'chat_completions',
      model: 'glm-5.2',
      modelProxyUrl: 'socks5://127.0.0.1:1080'
    })
    expect(parsed.serve.providers?.custom).toMatchObject({
      apiKey: '',
      credentialSourceId: 'settings:provider:custom',
      baseUrl: 'https://newapi.example/v1',
      endpointFormat: 'chat_completions',
      useProxy: false,
      models: ['glm-5.2'],
      selectedModel: 'glm-5.2',
      modelProxyUrl: ''
    })
    expect(parsed.serve.providers?.deepseek).toMatchObject({
      useProxy: true,
      modelProxyUrl: 'socks5://127.0.0.1:1080'
    })
    expect(JSON.stringify(parsed)).not.toContain('sk-newapi')
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
  })

  it('projects Ollama Cloud through the protected HTTP Chat Completions provider path', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const settings = createSettings('/tmp/fake-kun-child.js')
    const preset = getModelProviderPreset('ollama')
    if (!preset) throw new Error('Ollama Cloud preset is missing')
    const ollama = modelProviderPresetProfile(preset, 'ollama-secret')
    settings.provider.providers.push(ollama)
    settings.agents.kun = {
      ...settings.agents.kun,
      providerId: ollama.id,
      model: 'gpt-oss:120b'
    }

    await module.syncGuiManagedKunConfig(tempRoot, resolveKunRuntimeSettings(settings), {
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
    expect(parsed.serve).toMatchObject({
      baseUrl: 'https://ollama.com/v1',
      endpointFormat: 'chat_completions',
      model: 'gpt-oss:120b'
    })
    expect(parsed.serve.providers.ollama).toMatchObject({
      apiKey: '',
      credentialSourceId: 'settings:provider:ollama',
      baseUrl: 'https://ollama.com/v1',
      endpointFormat: 'chat_completions'
    })
    expect(JSON.stringify(parsed)).not.toContain('ollama-secret')
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
  })

  it('writes the memory capability from the GUI memory toggle', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, {
      ...defaultKunRuntimeSettings(),
      memoryEnabled: true
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.memory).toMatchObject({ enabled: true })
  })

  it('writes the instructions capability from the GUI instructions toggle', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')

    await module.syncGuiManagedKunConfig(tempRoot, {
      ...defaultKunRuntimeSettings(),
      instructions: { enabled: false }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.instructions).toMatchObject({ enabled: false })
  })

  it('writes the image generation capability and omits cleared fields', async () => {
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
        defaultResolution: '2K' as const,
        defaultSize: '',
        quality: 'high' as const,
        timeoutMs: 240000
      }
    }

    await module.syncGuiManagedKunConfig(tempRoot, runtime)

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.imageGen).toEqual({
      enabled: true,
      protocol: 'openai-images',
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: 'sk-image-test',
      model: 'Kwai-Kolors/Kolors',
      defaultResolution: '2K',
      quality: 'high',
      timeoutMs: 240000
    })
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)

    // Clearing the key in GUI settings must remove it from config.json.
    await module.syncGuiManagedKunConfig(tempRoot, {
      ...runtime,
      imageGeneration: { ...runtime.imageGeneration, apiKey: '' }
    })
    const cleared = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect('apiKey' in cleared.capabilities.imageGen).toBe(false)
    expect('headers' in cleared.capabilities.imageGen).toBe(false)
  })

  it('persists only the Codex provider reference for image generation', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const codexCredentials = JSON.stringify({
      kind: 'codex-oauth',
      accessToken: 'codex-access-token',
      refreshToken: 'codex-refresh-token',
      expiresAt: Date.now() + 3600_000,
      accountId: 'acct_123',
      email: 'user@example.com'
    })

    await module.syncGuiManagedKunConfig(tempRoot, {
      ...defaultKunRuntimeSettings(),
      imageGeneration: {
        enabled: true,
        providerId: 'codex',
        protocol: 'codex-responses-image',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        apiKey: codexCredentials,
        model: 'gpt-image-2',
        defaultResolution: '1K',
        defaultSize: '',
        quality: 'medium',
        timeoutMs: 180000
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    expect(parsed.capabilities.imageGen).toMatchObject({
      enabled: true,
      providerId: 'codex',
      protocol: 'codex-responses-image',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-image-2',
      defaultResolution: '1K',
      quality: 'medium',
      timeoutMs: 180000
    })
    expect(parsed.capabilities.imageGen.apiKey).toBeUndefined()
    expect(parsed.capabilities.imageGen.headers).toBeUndefined()
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
  })

  it('persists only the Grok provider reference for direct Imagine requests', async () => {
    if (!tempRoot) throw new Error('temp root not initialized')
    const configPath = join(tempRoot, 'config.json')
    const module = await import('./kun-process')
    const grokCredentials = JSON.stringify({
      kind: 'grok-oauth',
      accessToken: 'grok-access-token',
      refreshToken: 'grok-refresh-token',
      expiresAt: Date.now() + 3600_000,
      email: 'grok@example.com'
    })
    const defaults = defaultKunRuntimeSettings()

    await module.syncGuiManagedKunConfig(tempRoot, {
      ...defaults,
      imageGeneration: {
        ...defaults.imageGeneration,
        enabled: true,
        providerId: 'grok-subscription',
        protocol: 'grok-imagine-image',
        baseUrl: 'https://api.x.ai/v1',
        apiKey: grokCredentials,
        model: 'grok-imagine-image-quality'
      },
      videoGeneration: {
        ...defaults.videoGeneration,
        enabled: true,
        providerId: 'grok-subscription',
        protocol: 'grok-imagine-video',
        baseUrl: 'https://api.x.ai/v1',
        apiKey: grokCredentials,
        model: 'grok-imagine-video-1.5-preview',
        defaultResolution: '480P'
      }
    })

    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as any
    for (const capability of [parsed.capabilities.imageGen, parsed.capabilities.videoGen]) {
      expect(capability.providerId).toBe('grok-subscription')
      expect(capability.apiKey).toBeUndefined()
      expect(capability.headers).toBeUndefined()
    }
    expect(parsed.capabilities.imageGen).toMatchObject({
      protocol: 'grok-imagine-image',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-imagine-image-quality'
    })
    expect(parsed.capabilities.videoGen).toMatchObject({
      protocol: 'grok-imagine-video',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-imagine-video-1.5-preview',
      defaultResolution: '480P'
    })
    expect(KunConfigSchema.safeParse(parsed).success).toBe(true)
  })

})
