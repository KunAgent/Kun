import { afterEach, expect, it, vi } from 'vitest'
import { probeModels } from './model-connection-probe.js'
import { CODEX_CLI_VERSION } from '../adapters/model/provider-cli-identity.js'

afterEach(() => vi.unstubAllGlobals())

const input = {
  kind: 'http' as const,
  baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
  endpointFormat: 'custom_endpoint' as const,
  apiKey: 'test-token',
  headers: { 'ChatGPT-Account-Id': 'test-account', originator: 'codex_cli_rs' },
  fallbackModels: ['gpt-5.5'],
  proxyUrl: ''
}

it('discovers Codex models through the registry custom endpoint path', async () => {
  const fetcher = vi.fn(async () => Response.json({ models: [
    { slug: 'gpt-6-astra', visibility: 'list' },
    { slug: 'gpt-5.3-codex-spark', visibility: 'list', supported_in_api: false },
    { slug: 'hidden', visibility: 'hide' },
    { slug: 'gpt-6-astra', visibility: 'list' }
  ] }))
  vi.stubGlobal('fetch', fetcher)
  expect(await probeModels(input)).toEqual(['gpt-6-astra', 'gpt-5.3-codex-spark'])
  expect(fetcher).toHaveBeenCalledWith(
    `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLI_VERSION}`,
    expect.objectContaining({ headers: expect.objectContaining({
      authorization: 'Bearer test-token', 'ChatGPT-Account-Id': 'test-account'
    }) })
  )
})

it('does not report configured models as a successful discovery on API failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })))
  await expect(probeModels(input)).rejects.toThrow('HTTP 401')
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] })))
  await expect(probeModels(input)).rejects.toThrow('invalid model catalog')
})

it('keeps the configured-model behavior for other custom inference endpoints', async () => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  expect(await probeModels({ ...input, baseUrl: 'https://example.com/inference' })).toEqual(['gpt-5.5'])
  expect(fetcher).not.toHaveBeenCalled()
})
