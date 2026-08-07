import { describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import {
  KUN_AGENT_MODELS_URL,
  MODELS_DEV_CACHE_TTL_MS,
  MODELS_DEV_CATALOG_URL,
  MODELS_DEV_MAX_RESPONSE_BYTES,
  ModelsDevCatalogService,
  normalizeCatalogKeys,
  resolveCursorModelsDevCatalog,
  resolveModelsDevProvider
} from './models-dev-catalog'

function catalogBody(): string {
  return JSON.stringify({
    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek',
      api: 'https://api.deepseek.com',
      models: {
        'deepseek-chat': {
          id: 'deepseek-chat',
          name: 'DeepSeek Chat',
          description: 'General chat model',
          reasoning: false,
          tool_call: true,
          modalities: { input: ['text', 'image', 'unknown'], output: ['text'] },
          limit: { context: 128_000, output: 16_000 },
          cost: { input: 1, output: 2 }
        }
      }
    },
    'ollama-cloud': {
      id: 'ollama-cloud',
      name: 'Ollama Cloud',
      api: 'https://ollama.com/v1',
      models: {
        'gpt-oss:120b': {
          id: 'gpt-oss:120b',
          name: 'gpt-oss:120b',
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 131_072, output: 32_768 }
        },
        'catalog-only': {
          id: 'catalog-only',
          name: 'Catalog only',
          reasoning: false,
          tool_call: true,
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 64_000, output: 8_000 }
        }
      }
    },
    'opencode-go': {
      id: 'opencode-go',
      name: 'OpenCode Go',
      api: 'https://opencode.ai/zen/go/v1',
      models: {
        'mimo-v2.5': {
          id: 'mimo-v2.5',
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 131_072, output: 128_000 }
        }
      }
    },
    openai: {
      id: 'openai',
      name: 'OpenAI',
      models: {
        'gpt-5.5': {
          id: 'gpt-5.5',
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text', 'image'], output: ['text'] },
          limit: { context: 1_000_000, output: 128_000 }
        }
      }
    },
    anthropic: {
      id: 'anthropic',
      name: 'Anthropic',
      models: {
        'claude-sonnet-5': {
          id: 'claude-sonnet-5',
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text', 'image'], output: ['text'] },
          limit: { context: 1_000_000, output: 128_000 }
        }
      }
    },
    google: {
      id: 'google',
      name: 'Google',
      models: {
        'gemini-3.6-flash': {
          id: 'gemini-3.6-flash',
          reasoning: true,
          tool_call: true,
          modalities: { input: ['text', 'image', 'audio'], output: ['text'] },
          limit: { context: 1_048_576, output: 65_536 }
        }
      }
    },
    xai: {
      id: 'xai',
      name: 'xAI',
      models: {
        'grok-4.5': {
          id: 'grok-4.5',
          tool_call: true,
          modalities: { input: ['text', 'image'], output: ['text'] },
          limit: { context: 500_000, output: 64_000 }
        }
      }
    },
    moonshotai: {
      id: 'moonshotai',
      name: 'Moonshot AI',
      models: {
        'kimi-k2.5': {
          id: 'kimi-k2.5',
          tool_call: true,
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 256_000, output: 32_000 }
        }
      }
    },
    'future-provider': {
      id: 'future-provider',
      name: 'Future Provider',
      api: 'https://future.example/v1',
      models: {
        'future-model': {
          id: 'future-model',
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 64_000 }
        }
      }
    },
    'ambiguous-one': {
      id: 'ambiguous-one',
      name: 'Ambiguous One',
      api: 'https://ambiguous.example/v1',
      models: {}
    },
    'ambiguous-two': {
      id: 'ambiguous-two',
      name: 'Ambiguous Two',
      api: 'https://ambiguous.example/v1',
      models: {}
    }
  })
}

function kunAgentCatalogBody(): string {
  return JSON.stringify({
    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek',
      api: 'https://api.deepseek.com',
      models: {
        'deepseek-chat': {
          id: 'deepseek-chat',
          name: 'DeepSeek Chat (kun-agent)',
          reasoning: false,
          tool_call: true,
          modalities: { input: ['text'], output: ['text'] },
          limit: { context: 128_000, output: 16_000 }
        }
      }
    }
  })
}

function proxySettings(): AppSettingsV1 {
  return {
    provider: {
      proxy: { enabled: true, url: 'http://127.0.0.1:7890' }
    }
  } as unknown as AppSettingsV1
}

describe('resolveModelsDevProvider', () => {
  it.each([
    ['deepseek', 'https://api.deepseek.com/v1', 'deepseek', 'catalog'],
    ['longcat', 'https://api.longcat.chat/openai', 'longcat', 'catalog'],
    ['zhipu-coding-plan', 'https://example.invalid/custom', 'zhipuai-coding-plan', 'catalog'],
    ['zai-coding-plan', 'https://example.invalid/custom', 'zai-coding-plan', 'catalog'],
    ['kimi-code', 'https://api.kimi.com/coding/v1', 'kimi-for-coding', 'catalog'],
    ['opencode-go', 'https://opencode.ai/zen/go/v1', 'opencode-go', 'catalog'],
    ['moonshot-cn', 'https://api.moonshot.cn/v1', 'moonshotai-cn', 'catalog'],
    ['moonshot-global', 'https://api.moonshot.ai/v1', 'moonshotai', 'catalog'],
    ['xiaomi', 'https://api.xiaomimimo.com/v1', 'xiaomi', 'catalog'],
    ['xiaomi-token-plan', 'https://token-plan-cn.xiaomimimo.com/v1/', 'xiaomi-token-plan-cn', 'catalog'],
    ['xiaomi-token-plan', 'https://token-plan-sgp.xiaomimimo.com/v1', 'xiaomi-token-plan-sgp', 'catalog'],
    ['xiaomi-token-plan', 'https://token-plan-ams.xiaomimimo.com/v1', 'xiaomi-token-plan-ams', 'catalog'],
    ['minimax-token-plan', 'https://api.minimaxi.com/v1', 'minimax-cn-coding-plan', 'catalog'],
    ['minimax-token-plan', 'https://api.minimax.io/v1', 'minimax-coding-plan', 'catalog'],
    ['minimax-token-plan', 'https://api.minimax.io/anthropic', 'minimax-coding-plan', 'catalog'],
    ['minimax-token-plan', 'https://api.minimaxi.com/anthropic', 'minimax-cn-coding-plan', 'catalog'],
    ['minimax', 'https://api.minimaxi.com/v1', 'minimax-cn', 'catalog'],
    ['minimax', 'https://api.minimax.io/v1', 'minimax', 'catalog'],
    ['minimax', 'https://api.minimaxi.com/anthropic', 'minimax-cn', 'catalog'],
    ['minimax', 'https://api.minimax.io/anthropic', 'minimax', 'catalog'],
    ['aliyun', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'alibaba-cn', 'catalog'],
    ['aliyun', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'alibaba', 'catalog'],
    ['aliyun-token-plan', 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'alibaba-token-plan-cn', 'catalog'],
    ['aliyun-token-plan', 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', 'alibaba-token-plan', 'catalog'],
    ['tencentcloud-token-plan', 'https://api.lkeap.cloud.tencent.com/plan/v3', 'tencent-token-plan', 'catalog'],
    ['codex', 'https://chatgpt.com/backend-api/codex/responses', 'openai', 'enrichment-only'],
    ['claude-subscription', 'https://api.anthropic.com', 'anthropic', 'enrichment-only'],
    ['gemini-subscription', '', 'google', 'enrichment-only'],
    ['gemini-cli-subscription', '', 'google', 'enrichment-only'],
    ['ollama', 'https://ollama.com/v1', 'ollama-cloud', 'enrichment-only'],
    ['grok-subscription', 'https://cli-chat-proxy.grok.com/v1', 'xai', 'enrichment-only'],
    ['vercel-ai-gateway', 'https://ai-gateway.vercel.sh/v1', 'vercel', 'catalog']
  ])('maps %s deterministically', (providerId, baseUrl, providerKey, matchMode) => {
    expect(resolveModelsDevProvider({ providerId, baseUrl })).toEqual({ providerKey, matchMode })
  })

  it('uses exact unambiguous URLs for custom profile ids and refuses fuzzy matches', () => {
    expect(resolveModelsDevProvider({
      providerId: 'my-moonshot',
      baseUrl: 'https://api.moonshot.cn/v1/'
    })).toEqual({ providerKey: 'moonshotai-cn', matchMode: 'catalog' })
    expect(resolveModelsDevProvider({
      providerId: 'my-ollama-cloud-account',
      baseUrl: 'https://ollama.com/v1/'
    })).toEqual({ providerKey: 'ollama-cloud', matchMode: 'enrichment-only' })
    expect(resolveModelsDevProvider({
      providerId: 'looks-like-minimax',
      baseUrl: 'https://proxy.example/minimax'
    })).toBeNull()
    expect(resolveModelsDevProvider({
      providerId: 'volcengine-coding-plan',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3'
    })).toBeNull()
  })
})

describe('ModelsDevCatalogService', () => {
  it('uses the Ollama Cloud catalog only to enrich provider-confirmed models', async () => {
    const fetcher = vi.fn(async () => new Response(catalogBody(), { status: 200 }))
    const service = new ModelsDevCatalogService(fetcher)

    await expect(service.fetch({
      providerId: 'ollama',
      baseUrl: 'https://ollama.com/v1'
    })).resolves.toMatchObject({
      status: 'ok',
      providerKey: 'ollama-cloud',
      providerName: 'Ollama Cloud',
      matchMode: 'enrichment-only',
      models: [
        {
          id: 'gpt-oss:120b',
          reasoning: true,
          toolCalling: true,
          contextWindowTokens: 131_072,
          maxOutputTokens: 32_768
        },
        { id: 'catalog-only' }
      ]
    })
  })

  it('keeps OpenCode Go output limits in the catalog result', async () => {
    const fetcher = vi.fn(async () => new Response(catalogBody(), { status: 200 }))
    const service = new ModelsDevCatalogService(fetcher)
    await expect(service.fetch({
      providerId: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/v1'
    })).resolves.toMatchObject({
      status: 'ok',
      models: [{ id: 'mimo-v2.5', contextWindowTokens: 131_072, maxOutputTokens: 128_000 }]
    })
  })

  it('enriches Cursor models only from deterministic original providers', async () => {
    const fetcher = vi.fn(async () => new Response(catalogBody(), { status: 200 }))
    const service = new ModelsDevCatalogService(fetcher)
    const result = await service.fetch({
      providerId: 'cursor-subscription',
      baseUrl: '',
      modelHints: [
        { id: 'gpt-cursor-latest', aliases: ['gpt-5.5'] },
        { id: 'claude-sonnet-5' },
        { id: 'gemini-3.6-flash' },
        { id: 'grok-4.5' },
        { id: 'kimi-k2.5' },
        { id: 'composer-2.5' },
        { id: 'auto' }
      ]
    })

    expect(result).toMatchObject({
      status: 'ok',
      providerKey: 'cursor-mixed',
      matchMode: 'enrichment-only',
      models: [
        { id: 'gpt-cursor-latest', providerKey: 'openai', contextWindowTokens: 1_000_000 },
        { id: 'claude-sonnet-5', providerKey: 'anthropic', contextWindowTokens: 1_000_000 },
        {
          id: 'gemini-3.6-flash',
          providerKey: 'google',
          contextWindowTokens: 1_048_576,
          inputModalities: ['text', 'image', 'audio']
        },
        { id: 'grok-4.5', providerKey: 'xai', contextWindowTokens: 500_000 },
        { id: 'kimi-k2.5', providerKey: 'moonshotai', contextWindowTokens: 256_000 }
      ]
    })
    if (result.status === 'ok') {
      expect(result.models.map((model) => model.id)).not.toContain('composer-2.5')
      expect(result.models.map((model) => model.id)).not.toContain('auto')
    }
  })

  it('does not globally match Cursor-owned or unknown model ids', () => {
    const catalog = JSON.parse(catalogBody()) as Record<string, unknown>
    expect(resolveCursorModelsDevCatalog(catalog, [
      { id: 'auto', aliases: ['gpt-5.5'] },
      { id: 'composer-2.5', aliases: ['gpt-5.5'] },
      { id: 'unknown-model', aliases: ['claude-sonnet-5'] }
    ])).toEqual([])
  })

  it('sanitizes one matched provider and never sends provider credentials', async () => {
    const fetcher = vi.fn(async (
      _input: string | URL,
      _init: RequestInit | undefined,
      _proxyUrl: string
    ) => new Response(catalogBody(), {
      status: 200,
      headers: { etag: '"catalog-v1"' }
    }))
    const service = new ModelsDevCatalogService(fetcher)

    const result = await service.fetch({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com'
    }, proxySettings())

    expect(result).toEqual({
      status: 'ok',
      providerKey: 'deepseek',
      providerName: 'DeepSeek',
      matchMode: 'catalog',
      stale: false,
      source: 'models.dev',
      models: [{
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        description: 'General chat model',
        reasoning: false,
        toolCalling: true,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        contextWindowTokens: 128_000,
        maxOutputTokens: 16_000
      }]
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://models.dev/api.json',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' }
      }),
      'http://127.0.0.1:7890/'
    )
    const headers = fetcher.mock.calls[0]?.[1]?.headers
    expect(JSON.stringify(headers)).not.toContain('apiKey')
    expect(JSON.stringify(headers)).not.toContain('Authorization')
  })

  it('uses a unique exact catalog API URL as the custom-provider fallback', async () => {
    const fetcher = vi.fn(async () => new Response(catalogBody(), { status: 200 }))
    const service = new ModelsDevCatalogService(fetcher)
    await expect(service.fetch({
      providerId: 'custom-provider',
      baseUrl: 'https://future.example/v1/'
    })).resolves.toMatchObject({
      status: 'ok',
      providerKey: 'future-provider',
      models: [{ id: 'future-model', contextWindowTokens: 64_000 }]
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('refuses absent, ambiguous, and invalid custom provider matches', async () => {
    const fetcher = vi.fn(async () => new Response(catalogBody(), { status: 200 }))
    const service = new ModelsDevCatalogService(fetcher)
    await expect(service.fetch({
      providerId: 'custom-provider',
      baseUrl: 'https://missing.example/v1'
    })).resolves.toEqual({ status: 'unmapped', models: [] })
    await expect(service.fetch({
      providerId: 'custom-provider',
      baseUrl: 'https://ambiguous.example/v1'
    })).resolves.toEqual({ status: 'unmapped', models: [] })
    await expect(service.fetch({
      providerId: 'custom-provider',
      baseUrl: 'not-a-url'
    })).resolves.toEqual({ status: 'unmapped', models: [] })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reuses fresh cache and deduplicates concurrent loads', async () => {
    const fetcher = vi.fn(async () => new Response(catalogBody(), { status: 200 }))
    const service = new ModelsDevCatalogService(fetcher)
    const request = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }

    const [first, second] = await Promise.all([service.fetch(request), service.fetch(request)])
    const third = await service.fetch(request)

    expect(first.status).toBe('ok')
    expect(second.status).toBe('ok')
    expect(third.status).toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('revalidates a fresh cache when a manual refresh is requested', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(catalogBody(), {
        status: 200,
        headers: { etag: '"catalog-v1"' }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    const service = new ModelsDevCatalogService(fetcher)
    const request = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }

    await service.fetch(request)
    await service.fetch({ ...request, forceRefresh: true })

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({
      Accept: 'application/json',
      'If-None-Match': '"catalog-v1"'
    })
  })

  it('uses ETag conditional refresh after the freshness window', async () => {
    let now = 1_000
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(catalogBody(), {
        status: 200,
        headers: { etag: '"catalog-v1"' }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    const service = new ModelsDevCatalogService(fetcher, () => now)
    const request = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }

    await service.fetch(request)
    now += MODELS_DEV_CACHE_TTL_MS + 1
    const refreshed = await service.fetch(request)

    expect(refreshed.status).toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({
      Accept: 'application/json',
      'If-None-Match': '"catalog-v1"'
    })
  })

  it('falls back to stale cache when refresh fails', async () => {
    let now = 1_000
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(catalogBody(), { status: 200 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
    const service = new ModelsDevCatalogService(fetcher, () => now)
    const request = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }

    await service.fetch(request)
    now += MODELS_DEV_CACHE_TTL_MS + 1
    const stale = await service.fetch(request)

    expect(stale).toMatchObject({
      status: 'ok',
      stale: true,
      source: 'models.dev'
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('reports malformed, oversized, and timed-out first loads', async () => {
    const oversized = new ModelsDevCatalogService(vi.fn(async () => new Response('', {
      status: 200,
      headers: { 'content-length': String(MODELS_DEV_MAX_RESPONSE_BYTES + 1) }
    })))
    const malformed = new ModelsDevCatalogService(vi.fn(async () => new Response('{', { status: 200 })))
    const timeoutError = new Error('timed out')
    timeoutError.name = 'TimeoutError'
    const timedOut = new ModelsDevCatalogService(vi.fn(async () => { throw timeoutError }))
    const request = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }

    await expect(oversized.fetch(request)).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('byte limit')
    })
    await expect(malformed.fetch(request)).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('models.dev and the kun-agent.com fallback both failed')
    })
    await expect(timedOut.fetch(request)).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('both failed')
    })
  })

  it('falls back to the kun-agent catalog when models.dev times out', async () => {
    const timeoutError = new Error('timed out')
    timeoutError.name = 'TimeoutError'
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input) === MODELS_DEV_CATALOG_URL) throw timeoutError
      return new Response(kunAgentCatalogBody(), { status: 200 })
    })
    const service = new ModelsDevCatalogService(fetcher)

    const result = await service.fetch({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com'
    })

    expect(result).toMatchObject({
      status: 'ok',
      providerKey: 'deepseek',
      providerName: 'DeepSeek',
      matchMode: 'catalog',
      stale: false,
      source: 'kun-agent',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat (kun-agent)' }]
    })
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      MODELS_DEV_CATALOG_URL,
      KUN_AGENT_MODELS_URL
    ])
  })

  it('falls back to the kun-agent catalog when models.dev responds 5xx', async () => {
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input) === MODELS_DEV_CATALOG_URL) {
        return new Response('upstream exploded', { status: 500 })
      }
      return new Response(kunAgentCatalogBody(), { status: 200 })
    })
    const service = new ModelsDevCatalogService(fetcher)

    const result = await service.fetch({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com'
    })

    expect(result).toMatchObject({
      status: 'ok',
      source: 'kun-agent',
      stale: false
    })
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      MODELS_DEV_CATALOG_URL,
      KUN_AGENT_MODELS_URL
    ])
  })

  it('reports both sources when the kun-agent fallback also fails', async () => {
    const timeoutError = new Error('timed out')
    timeoutError.name = 'TimeoutError'
    const fetcher = vi.fn(async () => { throw timeoutError })
    const service = new ModelsDevCatalogService(fetcher)

    const result = await service.fetch({
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com'
    })

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.message).toContain('models.dev')
      expect(result.message).toContain('kun-agent.com')
    }
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('normalizes kun-agent provider keys onto models.dev keys', () => {
    const catalog = normalizeCatalogKeys({
      'deepseek-cn': { id: 'deepseek-cn', name: 'DeepSeek CN', models: {} }
    }, { 'deepseek-cn': 'deepseek' })
    expect(catalog.deepseek).toMatchObject({ id: 'deepseek-cn' })
    expect(catalog['deepseek-cn']).toBeUndefined()
    expect(resolveModelsDevProvider({ providerId: 'deepseek', baseUrl: '' })).toEqual({
      providerKey: 'deepseek',
      matchMode: 'catalog'
    })
  })

  it('revalidates the kun-agent fallback cache with its own ETag', async () => {
    let kunAgentCalls = 0
    const fetcher = vi.fn(async (
      input: string | URL,
      _init: RequestInit | undefined,
      _proxyUrl: string
    ) => {
      if (String(input) === MODELS_DEV_CATALOG_URL) throw new Error('offline')
      kunAgentCalls += 1
      if (kunAgentCalls === 1) {
        return new Response(kunAgentCatalogBody(), {
          status: 200,
          headers: { etag: '"kun-agent-v1"' }
        })
      }
      return new Response(null, { status: 304 })
    })
    const service = new ModelsDevCatalogService(fetcher)
    const request = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }

    const first = await service.fetch(request)
    const refreshed = await service.fetch({ ...request, forceRefresh: true })

    expect(first).toMatchObject({ status: 'ok', source: 'kun-agent', stale: false })
    expect(refreshed).toMatchObject({ status: 'ok', source: 'kun-agent', stale: false })
    expect(fetcher).toHaveBeenCalledTimes(4)
    const kunAgentCallsList = fetcher.mock.calls
      .map((call, index) => ({ index, url: String(call[0]) }))
      .filter((call) => call.url === KUN_AGENT_MODELS_URL)
    expect(kunAgentCallsList.map((call) => call.index)).toEqual([1, 3])
    expect(fetcher.mock.calls[3]?.[1]?.headers).toEqual({
      Accept: 'application/json',
      'If-None-Match': '"kun-agent-v1"'
    })
  })

  it('deduplicates concurrent loads across the fallback chain', async () => {
    const timeoutError = new Error('timed out')
    timeoutError.name = 'TimeoutError'
    const fetcher = vi.fn(async (input: string | URL) => {
      if (String(input) === MODELS_DEV_CATALOG_URL) throw timeoutError
      return new Response(kunAgentCatalogBody(), { status: 200 })
    })
    const service = new ModelsDevCatalogService(fetcher)
    const request = { providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' }

    const [first, second] = await Promise.all([service.fetch(request), service.fetch(request)])

    expect(first.status).toBe('ok')
    expect(second.status).toBe('ok')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      MODELS_DEV_CATALOG_URL,
      KUN_AGENT_MODELS_URL
    ])
  })
})
