import { describe, expect, it, vi } from 'vitest'
import {
  buildCompatRequestHeaders,
  classifyCompatHttpError,
  compatHttpFailureLog
} from './compat-http-diagnostics.js'

describe('compat HTTP diagnostics', () => {
  it('builds protocol-specific headers without changing configured overrides', () => {
    expect(buildCompatRequestHeaders({
      apiKey: 'secret', stream: true, endpointFormat: 'messages',
      configuredHeaders: { 'x-project': 'p' }
    })).toMatchObject({
      Authorization: 'Bearer secret', 'x-api-key': 'secret',
      'anthropic-version': '2023-06-01', 'x-project': 'p'
    })
  })

  it('omits every auth header for an anonymous (empty-key) request', () => {
    const headers = buildCompatRequestHeaders({
      apiKey: '', stream: true, endpointFormat: 'chat_completions'
    })
    expect(headers).not.toHaveProperty('Authorization')
    expect(headers).not.toHaveProperty('x-api-key')
  })

  it('keeps provider guidance on 404 errors', async () => {
    await expect(classifyCompatHttpError({
      status: 404, text: 'not found', baseUrl: 'https://example.test', fetchImpl: vi.fn()
    })).resolves.toMatchObject({ code: 'http_404', message: expect.stringContaining('Endpoint format') })
  })

  it('redacts credentials and bounds response bodies in logs', () => {
    const log = compatHttpFailureLog({
      provider: 'compat', status: 500, model: 'm', configuredModel: 'm',
      baseUrl: 'https://user:secret@example.test/v1?api_key=secret',
      requestUrl: 'https://user:secret@example.test/v1?token=secret',
      endpointFormat: 'chat_completions', configuredEndpointFormat: 'chat_completions',
      body: 'x'.repeat(2_000)
    })
    expect(JSON.stringify(log)).not.toContain('user:secret')
    expect(JSON.stringify(log)).not.toContain('token=secret')
    expect(String(log.responseBody)).toHaveLength(1_003)
  })
})
