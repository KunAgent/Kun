import { describe, expect, it, vi } from 'vitest'
import { CODEX_CLI_VERSION } from './provider-cli-identity.js'
import { CODEX_PROVIDER_VERSION_URL, createCodexProviderCatalogFetcher } from './codex-provider-catalog.js'

const headers = { Authorization: 'Bearer provider-secret', 'ChatGPT-Account-Id': 'provider-account',
  'user-agent': 'old-client' }
const metadata = (version = '0.161.0') => Response.json({ name: '@openai/codex', version })
const catalog = () => Response.json({ models: [{ slug: 'new-model', visibility: 'list' }] })
const options = { proxyUrl: '', headers, timeoutMs: 10_000 }
const versionOf = (url: string) => new URL(url).searchParams.get('client_version')

describe('independent ChatGPT provider catalog discovery', () => {
  it('uses public metadata without provider credentials and keeps catalog URL/UA consistent', async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit, proxy: string) => {
      expect(proxy).toBe('http://proxy.test:8080')
      const sent = new Headers(init.headers)
      if (url === CODEX_PROVIDER_VERSION_URL) {
        expect([...sent.keys()]).toEqual(['accept'])
        expect(init.redirect).toBe('error')
        return metadata()
      }
      expect(versionOf(url)).toBe('0.161.0')
      expect(sent.get('user-agent')).toMatch(/^codex_cli_rs\/0\.161\.0 /)
      expect(sent.get('authorization')).toBe('Bearer provider-secret')
      expect(sent.get('chatgpt-account-id')).toBe('provider-account')
      return catalog()
    })
    const result = await createCodexProviderCatalogFetcher()({ ...options, fetcher, proxyUrl: 'http://proxy.test:8080' })
    expect(result.response.ok).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('coalesces version lookups, caches them for a day, and fetches each account separately', async () => {
    let now = 1_000
    const discover = createCodexProviderCatalogFetcher(() => now)
    const fetcher = vi.fn(async (url: string) => url === CODEX_PROVIDER_VERSION_URL ? metadata() : catalog())
    await Promise.all([
      discover({ ...options, fetcher }),
      discover({ ...options, fetcher, headers: { Authorization: 'Bearer second-account' } })
    ])
    expect(fetcher.mock.calls.filter(([url]) => url === CODEX_PROVIDER_VERSION_URL)).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(3)
    now += 24 * 60 * 60_000
    await discover({ ...options, fetcher })
    expect(fetcher.mock.calls.filter(([url]) => url === CODEX_PROVIDER_VERSION_URL)).toHaveLength(2)
  })

  it.each([
    { name: 'another-package', version: '0.999.0' },
    { name: '@openai/codex', version: '0.999.0-beta.1' },
    { name: '@openai/codex', version: 'invalid' },
    { name: '@openai/codex', version: '0.1.0' }
  ])('keeps the bundled floor for untrusted, prerelease, invalid, or older metadata: %j', async (value) => {
    const fetcher = vi.fn(async (url: string) => url === CODEX_PROVIDER_VERSION_URL ? Response.json(value) : catalog())
    const result = await createCodexProviderCatalogFetcher()({ ...options, fetcher })
    expect(versionOf(result.url)).toBe(CODEX_CLI_VERSION)
  })

  it('keeps the last working version when later metadata lookup fails', async () => {
    let now = 0
    const discover = createCodexProviderCatalogFetcher(() => now)
    const fetcher = vi.fn(async (url: string) => url === CODEX_PROVIDER_VERSION_URL
      ? now === 0 ? metadata() : new Response('', { status: 503 }) : catalog())
    await discover({ ...options, fetcher })
    now += 24 * 60 * 60_000
    const result = await discover({ ...options, fetcher })
    expect(versionOf(result.url)).toBe('0.161.0')
    await discover({ ...options, fetcher })
    expect(fetcher.mock.calls.filter(([url]) => url === CODEX_PROVIDER_VERSION_URL)).toHaveLength(2)
    now += 5 * 60_000
    await discover({ ...options, fetcher })
    expect(fetcher.mock.calls.filter(([url]) => url === CODEX_PROVIDER_VERSION_URL)).toHaveLength(3)
  })

  it.each([400, 404, 422, 200])('retries incompatible candidate catalogs with the last good version (%s)', async (status) => {
    const discover = createCodexProviderCatalogFetcher()
    const fetcher = vi.fn(async (url: string) => {
      if (url === CODEX_PROVIDER_VERSION_URL) return metadata()
      return versionOf(url) === '0.161.0' ? new Response('{}', { status }) : catalog()
    })
    const result = await discover({ ...options, fetcher })
    expect(versionOf(result.url)).toBe(CODEX_CLI_VERSION)
    expect(result.response.ok).toBe(true)
    await discover({ ...options, fetcher })
    expect(fetcher.mock.calls.filter(([url]) => versionOf(url) === '0.161.0')).toHaveLength(1)
  })

  it.each([401, 403, 429, 500])('preserves account/rate-limit/server errors without a version retry (%s)', async (status) => {
    const fetcher = vi.fn(async (url: string) => url === CODEX_PROVIDER_VERSION_URL
      ? metadata() : new Response('unavailable', { status }))
    const result = await createCodexProviderCatalogFetcher()({ ...options, fetcher })
    expect(result.response.status).toBe(status)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('treats an empty account catalog as authoritative', async () => {
    const fetcher = vi.fn(async (url: string) => url === CODEX_PROVIDER_VERSION_URL
      ? metadata() : Response.json({ models: [] }))
    const result = await createCodexProviderCatalogFetcher()({ ...options, fetcher })
    expect(JSON.parse(result.text)).toEqual({ models: [] })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('continues discovery when the metadata service times out', async () => {
    const fetcher = vi.fn(async (url: string, _init: RequestInit) => {
      if (url !== CODEX_PROVIDER_VERSION_URL) return catalog()
      // Simulate the transport honoring the deadline without waiting on a real network.
      throw new DOMException('Version lookup timed out', 'TimeoutError')
    })
    const result = await createCodexProviderCatalogFetcher()({ ...options, fetcher })
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(versionOf(result.url)).toBe(CODEX_CLI_VERSION)
  })

  it('rejects oversized metadata and catalogs while keeping a bounded fallback', async () => {
    const fetcher = vi.fn(async (url: string) => url === CODEX_PROVIDER_VERSION_URL
      ? new Response('too big', { headers: { 'content-length': '256001' } })
      : new Response('too big', { headers: { 'content-length': '2000001' } }))
    const result = await createCodexProviderCatalogFetcher()({ ...options, fetcher })
    expect(result.truncated).toBe(true)
    expect(versionOf(result.url)).toBe(CODEX_CLI_VERSION)
  })
})
