import { describe, expect, it, vi } from 'vitest'
import { probeModelProvider } from './provider-connection'

vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: async () => 'DIRECT' } } }))
const request = {
  providerId: 'codex', useProxy: false,
  baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
  endpointFormat: 'custom_endpoint' as const,
  apiKey: JSON.stringify({ kind: 'codex-oauth', accessToken: 'access', refreshToken: 'refresh',
    accountId: 'account', expiresAt: Date.now() + 3600000 })
}

describe('Codex discovery', () => {
  it('uses the verified catalog version in both URL and headers to discover GPT-6', async () => {
    const fetcher = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(new URL(url).searchParams.get('client_version')).toBe('0.153.3')
      expect(new Headers(init?.headers).get('User-Agent')).toContain('codex_cli_rs/0.153.3')
      return new Response(JSON.stringify({ models: [
        { slug: 'gpt-6-astra', visibility: 'list', input_modalities: ['text', 'image'],
          context_window: 272000, use_responses_lite: true }
      ] }))
    })
    expect(await probeModelProvider(request, undefined, fetcher)).toMatchObject({
      ok: true, modelIds: ['gpt-6-astra'],
      modelProfiles: { 'gpt-6-astra': { responsesMode: 'lite', contextWindowTokens: 272000 } }
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([401, 403, 500])('reports HTTP %s instead of a successful static list', async (status) => {
    const result = await probeModelProvider(request, undefined,
      async () => new Response('unavailable', { status }))
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining(String(status)) })
  })
  it('handles full response endpoints and malformed model responses', async () => {
    const fetcher = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response('{}'))
    expect(await probeModelProvider(request, undefined, fetcher)).toMatchObject({ ok: false })
    expect(fetcher.mock.calls[0][0]).toMatch(/\/codex\/models\?client_version=/)
  })
  it('reports transport failures and rejects expired credentials before fetching', async () => {
    const fetcher = vi.fn(async () => { throw new Error('offline') })
    expect(await probeModelProvider(request, undefined, fetcher)).toMatchObject({
      ok: false, message: expect.stringContaining('offline')
    })
    fetcher.mockClear()
    const expired = { ...request, apiKey: JSON.stringify({ ...JSON.parse(request.apiKey), expiresAt: 1 }) }
    expect(await probeModelProvider(expired, undefined, fetcher)).toMatchObject({ ok: false })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
