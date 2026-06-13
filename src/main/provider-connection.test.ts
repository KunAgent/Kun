import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeModelProvider, providerProbeHeaders } from './provider-connection'

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
