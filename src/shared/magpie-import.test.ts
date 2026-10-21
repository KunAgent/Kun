import { describe, expect, it } from 'vitest'
import {
  isMagpieProviderImportLink,
  MAGPIE_TOKEN,
  magpieConnection,
  parseMagpieImportLink
} from './magpie-import'
import { isProviderImportLink, parseProviderImportLink } from './provider-import-link'

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function payload(gateway = 'http://127.0.0.1:3425', protocols?: Array<'openai-chat' | 'openai-responses' | 'anthropic-messages'>) {
  const selected = protocols ?? ['anthropic-messages', 'openai-responses', 'openai-chat']
  return {
    kind: 'custom',
    id: 'magpie',
    name: 'Magpie',
    auth: { method: 'apiKey', apiKey: MAGPIE_TOKEN },
    endpoints: selected.map((protocol) => ({
      protocol,
      baseUrl: protocol === 'anthropic-messages' ? gateway : `${gateway}/v1`,
      targets: ['kun'],
      modelsUrl: `${new URL(gateway).origin}/v1/models`
    }))
  }
}

function link(value: unknown = payload()): string {
  return `kun://provider/import?v=1&data=${encode(value)}`
}

describe('Magpie import contract', () => {
  it('accepts the local envelope and maps every Kun endpoint', () => {
    expect(isMagpieProviderImportLink(link())).toBe(true)
    expect(isProviderImportLink(link())).toBe(true)
    const parsed = parseMagpieImportLink(link())
    expect(parsed).toEqual({
      gatewayUrl: 'http://127.0.0.1:3425',
      protocols: ['openai-chat', 'openai-responses', 'anthropic-messages']
    })
    expect(magpieConnection(parsed)).toEqual({
      baseUrl: 'http://127.0.0.1:3425/v1',
      endpointFormat: 'chat_completions',
      chatBaseUrl: 'http://127.0.0.1:3425/v1',
      responsesBaseUrl: 'http://127.0.0.1:3425/v1',
      anthropicBaseUrl: 'http://127.0.0.1:3425'
    })
    expect(parseProviderImportLink(link())).toMatchObject({
      ok: true,
      draft: {
        presetId: 'magpie',
        name: 'Magpie',
        key: MAGPIE_TOKEN,
        chatBaseUrl: 'http://127.0.0.1:3425/v1',
        anthropicBaseUrl: 'http://127.0.0.1:3425',
        responsesBaseUrl: 'http://127.0.0.1:3425/v1',
        models: []
      }
    })
  })

  it('accepts loopback hosts and a subset of protocols', () => {
    for (const gateway of ['http://localhost:3425', 'http://[::1]:3425']) {
      const parsed = parseMagpieImportLink(link(payload(gateway, ['openai-chat'])))
      expect(parsed.gatewayUrl).toBe(gateway)
      expect(parsed.protocols).toEqual(['openai-chat'])
    }
  })

  it('rejects remote hosts, vendor keys, extra fields, and oversized links', () => {
    const remote = payload('http://10.0.0.8:3425')
    const vendorKey = payload()
    vendorKey.auth.apiKey = 'sk-live'
    const extra = { ...payload(), command: 'rm' }
    const wrongTarget = payload()
    wrongTarget.endpoints[2]!.targets = ['claude-code']
    const query = payload()
    query.endpoints[2]!.baseUrl = 'http://127.0.0.1:3425/v1?debug=1'
    expect(() => parseMagpieImportLink(link(remote))).toThrow(/local HTTP gateway/)
    expect(() => parseMagpieImportLink(link(vendorKey))).toThrow(/token/)
    expect(() => parseMagpieImportLink(link(extra))).toThrow(/provider/)
    expect(() => parseMagpieImportLink(link(wrongTarget))).toThrow(/endpoint/)
    expect(() => parseMagpieImportLink(link(query))).toThrow(/API path|local HTTP gateway/)
    expect(() => parseMagpieImportLink(`kun://provider/import?v=1&data=${'a'.repeat(8192)}`)).toThrow(/import/)
    expect(parseProviderImportLink(link(vendorKey)).ok).toBe(false)
  })
})
