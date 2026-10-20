import { describe, expect, it, vi } from 'vitest'
import { AnalyticsTransport } from './transport'
describe('analytics transport', () => {
  it('uses a fixed origin and never follows redirects with credentials', async () => {
    const fetcher = vi.fn(async () => Response.json({ schemaVersion: 1, policyVersion: 'product-analytics-v1', collectionEnabled: false, guidanceEnabled: false }))
    const transport = new AnalyticsTransport(fetcher as typeof fetch)
    await transport.config()
    expect(fetcher.mock.calls[0]).toEqual(['https://api-kun-server.com/api/product-experience/v1/config', expect.objectContaining({ redirect: 'error', credentials: 'omit' })])
    await expect(transport.request('https://evil.test', 'GET', {})).rejects.toThrow('analytics_path')
  })
  it('honors the server retry delay', async () => {
    const transport = new AnalyticsTransport(async () => new Response(null, { status: 429, headers: { 'Retry-After': '120' } }))
    await expect(transport.config()).rejects.toMatchObject({ status: 429, retryMs: 120000 })
  })
})
