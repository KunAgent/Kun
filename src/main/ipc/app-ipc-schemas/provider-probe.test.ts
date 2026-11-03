import { describe, expect, it } from 'vitest'
import type { ModelProviderProbeRequest } from '../../../shared/kun-gui-api'
import { MAX_URL_LENGTH } from './common'
import { providerProbePayloadSchema } from './runtime'

const request = {
  providerId: 'relay',
  baseUrl: 'https://relay.example/v1',
  apiKey: '',
  endpointFormat: 'chat_completions',
  useProxy: false
} satisfies ModelProviderProbeRequest

describe('provider probe IPC endpoints', () => {
  it('keeps requests without endpoint overrides compatible', () => {
    expect(providerProbePayloadSchema.parse(request)).toEqual(request)
  })

  it('preserves and trims all supported per-protocol overrides', () => {
    const endpoints = {
      chat_completions: 'https://relay.example/openai/v1',
      responses: 'https://relay.example/responses/v1',
      messages: 'https://relay.example/anthropic'
    }
    expect(providerProbePayloadSchema.parse({
      ...request,
      endpoints: Object.fromEntries(Object.entries(endpoints).map(([key, url]) => [key, ` ${url} `]))
    })).toEqual({ ...request, endpoints })
  })

  it('accepts partial and empty overrides for base URL fallback', () => {
    for (const endpoints of [{}, { messages: '  ' }, { responses: request.baseUrl }]) {
      expect(providerProbePayloadSchema.parse({ ...request, endpoints }).endpoints)
        .toEqual('messages' in endpoints ? { messages: '' } : endpoints)
    }
  })

  it.each([
    { label: 'unknown protocols', endpoints: { embeddings: request.baseUrl } },
    { label: 'non-string URLs', endpoints: { messages: 123 } },
    { label: 'overlong URLs', endpoints: { responses: 'x'.repeat(MAX_URL_LENGTH + 1) } },
    { label: 'null', endpoints: null },
    { label: 'arrays', endpoints: [] }
  ])('rejects $label', ({ endpoints }) => {
    expect(() => providerProbePayloadSchema.parse({ ...request, endpoints })).toThrow()
  })

  it('continues to reject unknown top-level fields', () => {
    expect(() => providerProbePayloadSchema.parse({ ...request, unknown: true })).toThrow()
  })
})
