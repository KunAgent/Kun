import { describe, expect, it, vi } from 'vitest'
import type { AgentObservabilitySpan } from './agent-observability.js'
import {
  OtlpHttpJsonAgentObservabilitySink,
  parseOtlpHeaders,
  resolveOtlpTracesEndpoint
} from './otlp-http-json-sink.js'

describe('OtlpHttpJsonAgentObservabilitySink', () => {
  it('exports valid OTLP JSON without adding content fields', async () => {
    const calls: Array<Parameters<typeof globalThis.fetch>> = []
    const fetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      calls.push([input, init])
      return new Response(null, { status: 200 })
    })
    const sink = new OtlpHttpJsonAgentObservabilitySink({
      endpoint: 'https://collector.example/v1/traces',
      headers: { authorization: 'Bearer token' },
      fetch
    })

    sink.emit(span())
    await sink.flush()

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = calls[0]!
    expect(url).toBe('https://collector.example/v1/traces')
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer token'
    })
    const payload = JSON.parse(String(init?.body))
    const exported = payload.resourceSpans[0].scopeSpans[0].spans[0]
    expect(exported).toMatchObject({
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
      kind: 1,
      status: { code: 1 }
    })
    expect(exported.attributes).toContainEqual({
      key: 'gen_ai.usage.input_tokens',
      value: { intValue: '42' }
    })
    expect(JSON.stringify(payload)).not.toContain('prompt')
    expect(JSON.stringify(payload)).not.toContain('secret')
  })

  it('uses signal endpoint as-is and appends the traces path to common endpoints', () => {
    expect(resolveOtlpTracesEndpoint({ tracesEndpoint: 'https://a.test/custom' })).toBe('https://a.test/custom')
    expect(resolveOtlpTracesEndpoint({ commonEndpoint: 'https://a.test/otel/' })).toBe('https://a.test/otel/v1/traces')
    expect(resolveOtlpTracesEndpoint({})).toBe('http://localhost:4318/v1/traces')
  })

  it('parses percent-encoded standard OTLP headers', () => {
    expect(parseOtlpHeaders('api-key=hello%20world,x-tenant=kun')).toEqual({
      'api-key': 'hello world',
      'x-tenant': 'kun'
    })
  })

  it('does not retry a permanently rejected batch', async () => {
    const fetch: typeof globalThis.fetch = vi.fn(async () => new Response(null, { status: 400 }))
    const sink = new OtlpHttpJsonAgentObservabilitySink({ fetch })

    sink.emit(span())
    await sink.flush()
    await sink.flush()

    expect(fetch).toHaveBeenCalledOnce()
  })
})

function span(): AgentObservabilitySpan {
  return {
    schemaUrl: 'https://opentelemetry.io/schemas/1.37.0',
    traceId: '1'.repeat(32),
    spanId: '2'.repeat(16),
    name: 'kun.turn',
    kind: 'internal',
    startTimeUnixNano: '1000000',
    endTimeUnixNano: '2000000',
    durationMs: 1,
    status: { code: 'OK' },
    attributes: {
      'gen_ai.usage.input_tokens': 42,
      'kun.cache.hit_rate': 0.5
    }
  }
}
