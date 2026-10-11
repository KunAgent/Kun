import { afterEach, expect, it, vi } from 'vitest'
const proxy = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../adapters/model/proxy-fetch.js', () => ({ createProxyFetch: () => proxy.fetch }))
import { latestHarnessVersion } from './harness-update-check.js'
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it('uses official identity-checked release metadata through an explicit proxy without launching an updater', async () => {
  vi.stubEnv('HTTPS_PROXY', 'http://proxy.invalid:8080')
  proxy.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ name: '@openai/codex', version: '1.2.3' })))
  expect(await latestHarnessVersion('codex', 'managed', { source: 'explicit-required' })).toBe('1.2.3')
  expect(proxy.fetch).toHaveBeenCalledWith('https://registry.npmjs.org/%40openai%2Fcodex/latest', expect.objectContaining({ redirect: 'error' }))
  proxy.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ name: 'unrelated-package', version: '1.2.3' })))
  await expect(latestHarnessVersion('codex', 'managed')).rejects.toThrow('identity mismatch')
  proxy.fetch.mockResolvedValueOnce(new Response('{}', { status: 503 }))
  await expect(latestHarnessVersion('codex', 'managed')).rejects.toThrow('503')
})
