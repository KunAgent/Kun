import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  normalizeAppSettings,
  resolveKunRuntimeSettings
} from '../../shared/app-settings'
import { KunConfigSchema } from '../../../kun/src/config/kun-config.js'
import {
  RuntimeConfigApplyRequest,
  type RuntimeConfigApplyRequest as RuntimeConfigApplyPayload
} from '../../../kun/src/contracts/runtime-config.js'
import { applyRuntimeConfig } from '../../../kun/src/server/routes/runtime-config.js'
import type { ServerRuntime } from '../../../kun/src/server/routes/server-runtime.js'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  buildManagedRuntimeHotApplyBody,
  classifyManagedRuntimeHotApplyResponse,
  syncGuiManagedKunConfig
} from './kun-runtime-config-service'
import {
  imageGenConfigForRuntime,
  musicGenConfigForRuntime,
  speechGenConfigForRuntime,
  videoGenConfigForRuntime
} from './kun-runtime-capability-config'

describe('Kun runtime config service', () => {
  it('projects canonical runtime fields into a hot-apply body without restart-only config', async () => {
    const runtime = {
      ...defaultKunRuntimeSettings(),
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      model: 'model-next',
      approvalPolicy: 'never' as const,
      sandboxMode: 'read-only' as const,
      approvalReviewer: 'agent' as const,
      runtimeTuning: {
        ...defaultKunRuntimeSettings().runtimeTuning,
        maxConcurrentTurns: 32
      },
      llmDebug: { defaultThreadCaptureEnabled: true }
    }
    const base = normalizeAppSettings({} as AppSettingsV1)
    const settings = normalizeAppSettings({
      ...base,
      provider: defaultModelProviderSettings(),
      agents: { kun: runtime }
    })
    const body = buildManagedRuntimeHotApplyBody(settings, KunConfigSchema.parse({
      serve: {
        host: '127.0.0.1',
        port: 18899,
        dataDir: '/tmp/kun-data',
        runtimeToken: 'runtime-token',
        insecure: false,
        storage: { backend: 'hybrid' },
        providers: {}
      },
      runtime: {
        turnLimits: {
          maxConcurrentTurns: runtime.runtimeTuning.maxConcurrentTurns
        },
        llmDebug: {
          enabled: false,
          defaultThreadCaptureEnabled: true
        }
      }
    }), {
      bridgeUrl: 'http://127.0.0.1:23456',
      bridgeToken: 'b'.repeat(43),
      approvalSigningKey: 's'.repeat(43)
    })

    expect(body.serve).toMatchObject({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      model: resolveKunRuntimeSettings(settings).model,
      approvalPolicy: 'never',
      sandboxMode: 'read-only',
      approvalReviewer: 'agent',
      providers: {}
    })
    expect(body.modelSelection).toBeUndefined()
    expect(body.serve).not.toHaveProperty('host')
    expect(body.serve).not.toHaveProperty('port')
    expect(body.serve).not.toHaveProperty('dataDir')
    expect(body.serve).not.toHaveProperty('runtimeToken')
    expect(body.serve).not.toHaveProperty('insecure')
    expect(body.serve).not.toHaveProperty('storage')
    expect(body.serve?.localModelGateway).toEqual({ enabled: false })
    expect(body.serve?.localModelGateway).not.toHaveProperty('name')
    expect(body.runtime?.turnLimits?.maxConcurrentTurns).toBe(32)
    expect(body.runtime?.llmDebug).toEqual({
      enabled: false,
      defaultThreadCaptureEnabled: true
    })
    expect(body.browserUseHostBinding).toEqual({
      bridgeUrl: 'http://127.0.0.1:23456',
      bridgeToken: 'b'.repeat(43),
      approvalSigningKey: 's'.repeat(43)
    })
    expect(RuntimeConfigApplyRequest.safeParse(body).success).toBe(true)

    const received: RuntimeConfigApplyPayload[] = []
    const serverRuntime: Pick<ServerRuntime, 'applyConfig'> = {
      applyConfig: async (request) => {
        received.push(request)
        return { ok: true as const }
      }
    }
    const response = await applyRuntimeConfig(
      serverRuntime as ServerRuntime,
      new Request('http://127.0.0.1/v1/runtime/config/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    )

    expect(response).not.toBeInstanceOf(Response)
    if (response instanceof Response) throw new Error('expected JSON response')
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true })
    expect(received).toHaveLength(1)
    const applied = received[0]!
    expect(applied).toEqual(body)
    expect(applied.serve).not.toHaveProperty('host')
    expect(applied.serve).not.toHaveProperty('port')
    expect(applied.serve).not.toHaveProperty('dataDir')
    expect(applied.serve).not.toHaveProperty('runtimeToken')
    expect(applied.serve).not.toHaveProperty('insecure')
    expect(applied.serve).not.toHaveProperty('storage')
    expect(applied.browserUseHostBinding).toEqual(body.browserUseHostBinding)
  })

  it('strictly rejects non-loopback or weak Browser Use host bindings', () => {
    expect(RuntimeConfigApplyRequest.safeParse({
      browserUseHostBinding: {
        bridgeUrl: 'http://localhost:23456',
        bridgeToken: 'b'.repeat(43),
        approvalSigningKey: 's'.repeat(43)
      }
    }).success).toBe(false)
    expect(RuntimeConfigApplyRequest.safeParse({
      browserUseHostBinding: {
        bridgeUrl: 'http://127.0.0.1:23456/path',
        bridgeToken: 'short',
        approvalSigningKey: 's'.repeat(43)
      }
    }).success).toBe(false)
    expect(RuntimeConfigApplyRequest.safeParse({ browserUseHostBinding: null }).success).toBe(true)
  })

  it('does not let ordinary GUI hot apply overwrite the registry-owned shared default', () => {
    const provider = defaultModelProviderSettings()
    const deepseek = provider.providers.find((candidate) => candidate.id === 'deepseek')!
    const model = deepseek.models[1]!
    const base = normalizeAppSettings({} as AppSettingsV1)
    const settings = normalizeAppSettings({
      ...base,
      provider,
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: deepseek.id,
          model
        }
      }
    })
    const body = buildManagedRuntimeHotApplyBody(settings, KunConfigSchema.parse({
      serve: {
        host: '127.0.0.1',
        port: 18899,
        dataDir: '/tmp/kun-data',
        runtimeToken: 'runtime-token',
        insecure: false,
        storage: { backend: 'hybrid' },
        providers: {}
      }
    }))

    expect(body.modelSelection).toBeUndefined()
  })

  it('maps conversation visualization settings into persisted and hot-applied config', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-config-visualization-'))
    const base = normalizeAppSettings({} as AppSettingsV1)
    const project = async (enabled?: boolean): Promise<RuntimeConfigApplyPayload> => {
      const defaults = defaultKunRuntimeSettings()
      const runtime = enabled === undefined
        ? defaults
        : {
            ...defaults,
            lab: {
              ...defaults.lab,
              conversationVisualization: { enabled }
            }
          }
      const settings = normalizeAppSettings({
        ...base,
        provider: defaultModelProviderSettings(),
        agents: { kun: runtime }
      })
      const config = await syncGuiManagedKunConfig(dataDir, runtime)
      return buildManagedRuntimeHotApplyBody(settings, config)
    }

    try {
      expect((await project(true)).lab?.conversationVisualization).toEqual({ enabled: true })
      expect((await project()).lab?.conversationVisualization).toEqual({ enabled: false })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('persists only provider ids for Registry-backed media capabilities', () => {
    const defaults = defaultKunRuntimeSettings()
    const capabilities = {
      imageGen: imageGenConfigForRuntime({
        ...defaults.imageGeneration,
        enabled: true,
        providerId: 'media-provider',
        apiKey: 'image-plaintext',
        baseUrl: 'https://media.example/v1',
        model: 'image-model'
      }, {}),
      speechGen: speechGenConfigForRuntime({
        ...defaults.textToSpeech,
        enabled: true,
        providerId: 'media-provider',
        apiKey: 'speech-plaintext',
        baseUrl: 'https://media.example/v1',
        model: 'speech-model'
      }, {}),
      musicGen: musicGenConfigForRuntime({
        ...defaults.musicGeneration,
        enabled: true,
        providerId: 'media-provider',
        apiKey: 'music-plaintext',
        baseUrl: 'https://media.example/v1',
        model: 'music-model'
      }, {}),
      videoGen: videoGenConfigForRuntime({
        ...defaults.videoGeneration,
        enabled: true,
        providerId: 'media-provider',
        apiKey: 'video-plaintext',
        baseUrl: 'https://media.example/v1',
        model: 'video-model'
      }, {})
    }

    expect(capabilities).toMatchObject({
      imageGen: { providerId: 'media-provider' },
      speechGen: { providerId: 'media-provider' },
      musicGen: { providerId: 'media-provider' },
      videoGen: { providerId: 'media-provider' }
    })
    expect(capabilities.imageGen).not.toHaveProperty('apiKey')
    expect(capabilities.speechGen).not.toHaveProperty('apiKey')
    expect(capabilities.musicGen).not.toHaveProperty('apiKey')
    expect(capabilities.videoGen).not.toHaveProperty('apiKey')
    expect(JSON.stringify(capabilities)).not.toContain('plaintext')
  })

  it('persists the GUI new-thread capture default while keeping the facility available', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-config-llm-debug-'))
    const runtime = {
      ...defaultKunRuntimeSettings(),
      approvalPolicy: 'on-request' as const,
      sandboxMode: 'workspace-write' as const,
      approvalReviewer: 'agent' as const,
      llmDebug: { defaultThreadCaptureEnabled: true }
    }
    try {
      await syncGuiManagedKunConfig(dataDir, runtime)
      const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'))
      expect(config.runtime.llmDebug).toEqual({
        enabled: true,
        defaultThreadCaptureEnabled: true
      })
      expect(config.serve).toMatchObject({
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalReviewer: 'agent'
      })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('classifies compatibility fallback, success, restart, and failure responses', () => {
    expect(classifyManagedRuntimeHotApplyResponse(404, false, '')).toMatchObject({
      result: 'restart_required'
    })
    expect(classifyManagedRuntimeHotApplyResponse(200, true, '{"ok":true}')).toEqual({
      result: 'applied', message: ''
    })
    expect(classifyManagedRuntimeHotApplyResponse(
      409, false, '{"code":"restart_required","message":"process field changed"}'
    )).toEqual({ result: 'restart_required', message: 'process field changed' })
    expect(classifyManagedRuntimeHotApplyResponse(500, false, 'broken')).toEqual({
      result: 'failed', message: 'broken'
    })
  })

  it('projects provider catalogs when callers pass appSettings without schedule MCP', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-config-providers-'))
    const base = normalizeAppSettings({} as AppSettingsV1)
    const defaultProvider = defaultModelProviderSettings().providers[0]!
    const settings = normalizeAppSettings({
      ...base,
      provider: {
        ...defaultModelProviderSettings(),
        providers: [
          { ...defaultProvider, models: ['deepseek-v4-pro', 'deepseek-v4-flash'] },
          {
            ...defaultProvider,
            id: 'kimi-code',
            name: 'Kimi Code',
            baseUrl: 'https://api.kimi.com/coding/v1',
            models: ['kimi-for-coding', 'kimi-for-coding-highspeed']
          }
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: 'kimi-code',
          model: 'kimi-for-coding'
        }
      }
    })
    try {
      await syncGuiManagedKunConfig(dataDir, resolveKunRuntimeSettings(settings), { appSettings: settings })
      const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'))
      expect(config.serve.providers.deepseek.models).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
      expect(config.serve.providers['kimi-code'].models).toEqual([
        'k3',
        'kimi-for-coding',
        'kimi-for-coding-highspeed'
      ])
      expect(config.serve.providers['kimi-code'].modelCapabilities.k3.reasoning).toEqual({
        supportedEfforts: ['low', 'high', 'max'],
        defaultEffort: 'high',
        requestProtocol: 'openai-chat-completions'
      })
      expect(config.serve.credentialSourceId).toBeUndefined()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('projects catalog pricing into provider modelCapabilities and model profiles', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-config-pricing-'))
    const base = normalizeAppSettings({} as AppSettingsV1)
    const defaultProvider = defaultModelProviderSettings().providers[0]!
    const pricing = {
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 4,
      cacheReadUsdPerMillion: 0.1
    }
    const settings = normalizeAppSettings({
      ...base,
      provider: {
        ...defaultModelProviderSettings(),
        providers: [{
          ...defaultProvider,
          models: ['openai-model'],
          modelProfiles: {
            'openai-model': {
              inputModalities: ['text'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              messageParts: ['text'],
              pricing
            }
          }
        }]
      }
    })
    try {
      await syncGuiManagedKunConfig(dataDir, resolveKunRuntimeSettings(settings), { appSettings: settings })
      const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'))
      expect(config.serve.providers.deepseek.modelCapabilities['openai-model'].pricing)
        .toEqual(pricing)
      expect(config.models.profiles['openai-model'].pricing).toEqual(pricing)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

})
