import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1 } from '../shared/app-settings'
import { CHATGPT_SUBSCRIPTION_MODEL_IDS } from '../shared/app-settings'
import { parseModelIds, probeModelProvider, providerProbeHeaders } from './provider-connection'

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

describe('probeModelProvider', () => {
  it('validates ChatGPT subscription OAuth locally and returns its shared catalog', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeModelProvider({
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

    expect(result).toEqual({ ok: true, latencyMs: 0, modelIds: [...CHATGPT_SUBSCRIPTION_MODEL_IDS] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-http base urls without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeModelProvider({
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
      baseUrl: 'https://api.example.com/v1',
      apiKey: '',
      endpointFormat: 'responses'
    })

    expect(result).toEqual({ ok: false, message: 'socket hang up' })
  })

  it('identifies a broken configured proxy when direct connectivity works', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    const fetcher = vi.fn(async (_url: string | URL, _init: RequestInit | undefined, proxyUrl: string) => {
      if (proxyUrl) throw timeout
      return new Response('unauthorized', { status: 401 })
    })
    const settings = {
      provider: {
        proxy: { enabled: true, url: 'http://127.0.0.1:7890' }
      }
    } as unknown as AppSettingsV1

    const result = await probeModelProvider({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      endpointFormat: 'chat_completions'
    }, settings, fetcher)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('timed out after 10s')
      expect(result.message).toContain('configured model-request proxy failed')
      expect(result.message).toContain('direct connection reached the provider')
    }
    expect(fetcher.mock.calls.map((call) => call[2])).toEqual([
      'http://127.0.0.1:7890/',
      ''
    ])
  })

  it('does not probe /models for custom full endpoint providers', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeModelProvider({
      baseUrl: 'https://api.example.com/custom-path',
      apiKey: 'sk-x',
      endpointFormat: 'custom_endpoint'
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('does not support /models probing')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
