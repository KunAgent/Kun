import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { GROK_SUBSCRIPTION_MODEL_IDS } from '../shared/app-settings'
import {
  describeProviderProbeError,
  parseModelIds,
  probeModelProvider,
  providerProbeHeaders,
  resolveElectronSystemProxyUrl
} from './provider-connection'

const electronResolveProxy = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  session: { defaultSession: { resolveProxy: electronResolveProxy } }
}))

beforeEach(() => {
  electronResolveProxy.mockReset()
  electronResolveProxy.mockResolvedValue('DIRECT')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('providerProbeHeaders', () => {
  it('uses bearer auth for OpenAI-compatible formats', () => {
    expect(providerProbeHeaders('chat_completions', ' sk-test ')).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer sk-test'
    })
  })

  it('uses anthropic headers for the messages format', () => {
    expect(providerProbeHeaders('messages', 'sk-test')).toEqual({
      Accept: 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'sk-test'
    })
  })

  it('omits auth headers without a key', () => {
    expect(providerProbeHeaders('chat_completions', '')).toEqual({ Accept: 'application/json' })
    expect(providerProbeHeaders('messages', '')).toEqual({
      Accept: 'application/json',
      'anthropic-version': '2023-06-01'
    })
  })
})

describe('provider probe network transport', () => {
  it('uses the same Node transport as the model runtime when no proxy is configured', async () => {
    const nodeFetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'openai/gpt-5.4' }]
    }), { status: 200 }))
    vi.stubGlobal('fetch', nodeFetch)

    await expect(probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://zenmux.ai/api/v1',
      apiKey: 'sk-ai-v1-test',
      endpointFormat: 'chat_completions'
    })).resolves.toMatchObject({ ok: true, modelIds: ['openai/gpt-5.4'] })

    expect(nodeFetch).toHaveBeenCalledWith(
      'https://zenmux.ai/api/v1/models',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('surfaces the Node root cause when the runtime transport fails', async () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND zenmux.ai'), { code: 'ENOTFOUND' })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: dns })
    }))

    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://zenmux.ai/api/v1',
      apiKey: 'sk-ai-v1-test',
      endpointFormat: 'chat_completions'
    })
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.message).toContain('getaddrinfo ENOTFOUND zenmux.ai')
    }
  })

  it('suggests the resolved system proxy when it can reach the provider', async () => {
    electronResolveProxy.mockResolvedValue('PROXY 127.0.0.1:10808; DIRECT')
    const fetcher = vi.fn(async (_url: string | URL, _init: RequestInit | undefined, proxyUrl: string) => {
      if (!proxyUrl) throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
      return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-5.4' }] }), { status: 200 })
    })

    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://zenmux.ai/api/v1',
      apiKey: 'sk-ai-v1-test',
      endpointFormat: 'chat_completions'
    }, undefined, fetcher)

    expect(result).toMatchObject({
      ok: false,
      suggestedProxyUrl: 'http://127.0.0.1:10808/'
    })
    expect(fetcher).toHaveBeenLastCalledWith(
      'https://zenmux.ai/api/v1/models',
      expect.objectContaining({ method: 'GET' }),
      'http://127.0.0.1:10808/'
    )
  })

  it('parses SOCKS system proxy rules and ignores DIRECT fallbacks', async () => {
    electronResolveProxy.mockResolvedValue('SOCKS5 127.0.0.1:7891; DIRECT')
    await expect(resolveElectronSystemProxyUrl('https://zenmux.ai/api/v1/models'))
      .resolves.toBe('socks5://127.0.0.1:7891')
  })

  it('formats nested network causes without leaking a bare fetch failed message', () => {
    const tls = Object.assign(new Error('self-signed certificate'), {
      code: 'DEPTH_ZERO_SELF_SIGNED_CERT'
    })
    expect(describeProviderProbeError(new TypeError('fetch failed', { cause: tls }))).toBe(
      'fetch failed: self-signed certificate (DEPTH_ZERO_SELF_SIGNED_CERT)'
    )
  })
})

describe('probeModelProvider', () => {
  it('fetches the live ChatGPT subscription catalog including new model slugs', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ models: [
      { slug: 'gpt-6-astra', visibility: 'list', context_window: 272000 },
      { slug: 'gpt-reserve', visibility: 'hide' }
    ] })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      apiKey: JSON.stringify({
        kind: 'codex-oauth',
        accessToken: 'access',
        refreshToken: 'refresh',
        accountId: 'account',
        expiresAt: Date.now() + 60_000
      }),
      endpointFormat: 'responses'
    })

    expect(result).toMatchObject({ ok: true, modelIds: ['gpt-6-astra'] })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/chatgpt.com\/backend-api\/codex\/models\?client_version=/),
      expect.objectContaining({ headers: expect.objectContaining({
        Authorization: 'Bearer access', 'ChatGPT-Account-Id': 'account', originator: 'codex_cli_rs'
      }) })
    )
  })

  it('validates Grok subscription OAuth locally and returns its shared catalog', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://cli-chat-proxy.grok.com/v1',
      apiKey: JSON.stringify({
        kind: 'grok-oauth',
        accessToken: 'access',
        refreshToken: 'refresh',
        // Outside the 5-minute early-invalidation window so probe does not refresh.
        expiresAt: Date.now() + 60 * 60_000,
        email: 'user@x.ai'
      }),
      endpointFormat: 'responses'
    })

    expect(result).toEqual({ ok: true, latencyMs: 0, modelIds: [...GROK_SUBSCRIPTION_MODEL_IDS] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not treat a URL containing the Grok hostname as a subscription endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'remote-model' }] })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://attacker.example/cli-chat-proxy.grok.com/v1',
      apiKey: JSON.stringify({
        kind: 'grok-oauth',
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 60 * 60_000,
        email: 'user@x.ai'
      }),
      endpointFormat: 'responses'
    })

    expect(result).toMatchObject({ ok: true, modelIds: ['remote-model'] })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('rejects non-http base urls without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'ftp://example.com',
      apiKey: '',
      endpointFormat: 'chat_completions'
    })

    expect(result.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists deduplicated models from the versioned models endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [{ id: 'model-b' }, { id: ' model-a ' }, { id: 'model-b' }, { id: '' }] }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-x',
      endpointFormat: 'chat_completions'
    })

    expect(result).toEqual({
      ok: true,
      latencyMs: expect.any(Number),
      modelIds: ['model-b', 'model-a']
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('discovers Ollama Cloud models with bearer auth and preserves wire punctuation', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        object: 'list',
        data: [
          { id: 'gpt-oss:120b' },
          { id: 'qwen3.5:397b' },
          { id: 'gpt-oss:120b' }
        ]
      }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://ollama.com/v1',
      apiKey: 'ollama-secret',
      endpointFormat: 'chat_completions'
    })

    expect(result).toEqual({
      ok: true,
      latencyMs: expect.any(Number),
      modelIds: ['gpt-oss:120b', 'qwen3.5:397b']
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ollama.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ollama-secret'
        }
      })
    )
  })

  it('discovers provider/model ids for both ZenMux credential families', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        object: 'list',
        data: [
          { id: 'openai/gpt-5.4' },
          { id: 'anthropic/claude-sonnet-4.6' }
        ]
      }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    for (const apiKey of ['sk-ai-v1-api', 'sk-ss-v1-plan']) {
      await expect(probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://zenmux.ai/api/v1',
        apiKey,
        endpointFormat: 'chat_completions'
      })).resolves.toMatchObject({
        ok: true,
        modelIds: ['openai/gpt-5.4', 'anthropic/claude-sonnet-4.6']
      })
    }

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [index, apiKey] of ['sk-ai-v1-api', 'sk-ss-v1-plan'].entries()) {
      expect(fetchMock).toHaveBeenNthCalledWith(
        index + 1,
        'https://zenmux.ai/api/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`
          }
        })
      )
    }
  })

  it('parses top-level arrays and provider-specific models envelopes without changing wire IDs', () => {
    expect(parseModelIds(JSON.stringify([
      { id: 'MiniMaxAI/MiniMax-M3' },
      { id: 'model-b' },
      { id: 'MiniMaxAI/MiniMax-M3' }
    ]))).toEqual(['MiniMaxAI/MiniMax-M3', 'model-b'])
    expect(parseModelIds(JSON.stringify({ models: [{ id: 'Provider/Model-A' }] }))).toEqual(['Provider/Model-A'])
  })

  it('rejects unbounded or nested model payloads instead of recursively scanning them', () => {
    expect(parseModelIds(JSON.stringify({ response: { data: [{ id: 'hidden-model' }] } }))).toEqual([])
    expect(parseModelIds('x'.repeat(2_000_001))).toEqual([])
    expect(parseModelIds(JSON.stringify([{ id: 'x'.repeat(513) }, { id: 'ok' }]))).toEqual(['ok'])
  })

  it('fails clearly when the model list response exceeds the bounded body limit', async () => {
    const fetchMock = vi.fn(async () => new Response('x'.repeat(2_000_001), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-x',
      endpointFormat: 'chat_completions'
    })

    expect(result).toEqual({
      ok: false,
      message: 'Model list response exceeded the 2000000 byte limit.'
    })
  })

  it('reports http errors with status and body excerpt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))

    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'bad-key',
      endpointFormat: 'messages'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('401')
      expect(result.message).toContain('unauthorized')
    }
  })

  it('reports network failures as messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('socket hang up')
    }))

    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
      endpointFormat: 'responses'
    })

    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.message).toContain('Request to https://api.example.com/v1/models failed')
      expect(result.message).toContain('socket hang up')
    }
  })

  it('does not bypass an explicitly selected Provider proxy after a failure', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    const fetcher = vi.fn(async (_url: string | URL, _init: RequestInit | undefined, proxyUrl: string) => {
      if (proxyUrl) throw timeout
      return new Response('unauthorized', { status: 401 })
    })
    const settings = {
      provider: {
        proxy: { enabled: true, url: 'http://127.0.0.1:7890' },
        providers: []
      }
    } as unknown as AppSettingsV1

    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: true,
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      endpointFormat: 'chat_completions'
    }, settings, fetcher)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('timed out after 10s')
    }
    expect(fetcher.mock.calls.map((call) => call[2])).toEqual([
      'http://127.0.0.1:7890/'
    ])
  })

  it('does not probe /models for custom full endpoint providers', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeModelProvider({
      providerId: 'test-provider',
      useProxy: false,
      baseUrl: 'https://api.example.com/custom-path',
      apiKey: 'sk-x',
      endpointFormat: 'custom_endpoint'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('does not support /models probing')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
