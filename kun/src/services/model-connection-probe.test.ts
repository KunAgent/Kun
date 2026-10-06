import { afterEach, expect, it, vi } from 'vitest'
import { probeModels } from './model-connection-probe.js'
import { CODEX_CLI_VERSION } from '../adapters/model/provider-cli-identity.js'
import { CODEX_PROVIDER_VERSION_URL } from '../adapters/model/codex-provider-catalog.js'

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
    }) }), ''
  )
})

it('requests the current catalog and keeps listed GPT-6.1 subscription models', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    if (url === CODEX_PROVIDER_VERSION_URL) return Response.json({ name: '@openai/codex', version: '0.161.0' })
    expect(new URL(url).searchParams.get('client_version')).toBe('0.161.0')
    return Response.json({ models: [
      { slug: 'gpt-6.1-sol', visibility: 'list' },
      { slug: 'gpt-6-sol', visibility: 'list' },
      { slug: 'gpt-6-luna', visibility: 'list', supported_in_api: false },
      { slug: 'gpt-6-hidden', visibility: 'hide' }
    ] })
  }))
  await expect(probeModels(input)).resolves.toEqual(['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna'])
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

it('probes /models on the per-format endpoint override', async () => {
  const fetcher = vi.fn(async () => Response.json({ data: [{ id: 'claude-x' }] }))
  vi.stubGlobal('fetch', fetcher)
  await expect(probeModels({
    kind: 'http',
    baseUrl: 'https://relay.example.com/v1',
    endpointFormat: 'messages',
    endpoints: { messages: 'https://relay.example.com/anthropic' },
    apiKey: 'sk-x',
    fallbackModels: [],
    proxyUrl: ''
  })).resolves.toEqual(['claude-x'])
  expect(fetcher).toHaveBeenCalledWith(
    'https://relay.example.com/anthropic/v1/models',
    expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'sk-x' }) })
  )
})
