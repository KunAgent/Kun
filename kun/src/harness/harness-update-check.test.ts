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

it('checks Antigravity releases without running the native updater', async () => {
  vi.stubEnv('HTTPS_PROXY', 'http://proxy.invalid:8080')
  const release = { url: 'https://api.github.com/repos/google-antigravity/antigravity-cli/releases/123',
    tag_name: '1.5.9', draft: false, prerelease: false }
  proxy.fetch.mockResolvedValueOnce(new Response(JSON.stringify(release)))
  expect(await latestHarnessVersion('antigravity', 'native')).toBe('1.5.9')
  expect(proxy.fetch).toHaveBeenCalledWith('https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest',
    expect.objectContaining({ redirect: 'error' }))
  for (const patch of [{ url: 'https://api.github.com/repos/other/cli/releases/123' }, { draft: true }, { prerelease: true }]) {
    proxy.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...release, ...patch })))
    await expect(latestHarnessVersion('antigravity', 'native')).rejects.toThrow('identity mismatch')
  }
  proxy.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...release, tag_name: 'invalid-version' })))
  await expect(latestHarnessVersion('antigravity', 'native')).rejects.toThrow('invalid version')
})
