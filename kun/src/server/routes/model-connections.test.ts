import { describe, expect, it, vi } from 'vitest'
import type { ModelConnectionRegistry } from '../../services/model-connection-registry.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import {
  commitModelCredential,
  fenceModelCredential,
  probeModelConnection,
  replaceModelCredential
} from './model-connections.js'

const snapshot = {
  schemaVersion: 1 as const,
  revision: 4,
  providers: [],
  proxy: { enabled: false, url: '' },
  routePools: [],
  failover: [],
  localModelGateway: { enabled: false }
}

function request(method: string, body: unknown): Request {
  return new Request('http://127.0.0.1/v1/model-connections/deepseek/credential', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('model connection credential routes', () => {
  it('keeps legacy PUT replacement compatible when no operation token is supplied', async () => {
    const replaceCredential = vi.fn(async () => snapshot)
    const prepareCredential = vi.fn()
    const registry = { replaceCredential, prepareCredential } as unknown as ModelConnectionRegistry
    const body = { expectedRevision: 3, credential: 'legacy-secret' }

    const response = await replaceModelCredential(registry, 'deepseek', request('PUT', body))

    expect(response.status).toBe(200)
    expect(replaceCredential).toHaveBeenCalledWith('deepseek', body)
    expect(prepareCredential).not.toHaveBeenCalled()
  })

  it('routes tokenized PUT through prepare and requires an explicit commit', async () => {
    const prepareCredential = vi.fn(async () => snapshot)
    const fenceCredential = vi.fn(async () => snapshot)
    const commitPreparedCredential = vi.fn(async () => ({ ...snapshot, revision: 5 }))
    const replaceCredential = vi.fn()
    const registry = {
      prepareCredential,
      fenceCredential,
      commitPreparedCredential,
      replaceCredential
    } as unknown as ModelConnectionRegistry
    const operationToken = 'credential:22222222-2222-4222-8222-222222222222:2'
    const prepared = {
      expectedRevision: 4,
      credential: 'final-secret',
      operationToken
    }

    const fenceResponse = await fenceModelCredential(
      registry,
      'deepseek',
      request('POST', { expectedRevision: 4, operationToken })
    )

    const prepareResponse = await replaceModelCredential(
      registry,
      'deepseek',
      request('PUT', prepared)
    )
    const commit = { expectedRevision: 4, operationToken }
    const commitResponse = await commitModelCredential(
      registry,
      'deepseek',
      request('POST', commit)
    )

    expect(fenceResponse.status).toBe(200)
    expect(prepareResponse.status).toBe(200)
    expect(commitResponse.status).toBe(200)
    expect(fenceCredential).toHaveBeenCalledWith('deepseek', { expectedRevision: 4, operationToken })
    expect(prepareCredential).toHaveBeenCalledWith('deepseek', prepared)
    expect(commitPreparedCredential).toHaveBeenCalledWith('deepseek', commit)
    expect(replaceCredential).not.toHaveBeenCalled()
  })
})

describe('probeModelConnection inference mode', () => {
  const profile = {
    id: 'p1',
    label: 'Provider One',
    kind: 'http',
    authType: 'api-key',
    baseUrl: 'https://api.example.com/v1',
    endpointFormat: 'chat_completions',
    useProxy: false,
    configured: true,
    credentialStatus: 'configured',
    models: ['m1'],
    selectedModel: 'm1'
  } as const

  const probeSnapshot = () => ({
    schemaVersion: 1 as const,
    proxyRoutingVersion: 1 as const,
    revision: 1,
    providers: [{ ...profile }],
    routePools: [],
    failover: [],
    localModelGateway: { enabled: false },
    proxy: { enabled: false, url: '' }
  })

  const probeRegistry = () => ({
    snapshot: async () => probeSnapshot()
  }) as unknown as ModelConnectionRegistry

  const fakeClient = (
    name: string,
    handler: (request: ModelRequest) => AsyncIterable<ModelStreamChunk>,
    seen: { requests: ModelRequest[] }
  ): ModelClient => ({
    provider: name,
    model: 'm1',
    stream(request: ModelRequest) {
      seen.requests.push(request)
      return handler(request)
    }
  })

  const probeRequest = (): Request => new Request('http://kun.test/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'inference' })
  })

  const errorStream = async function* (): AsyncIterable<ModelStreamChunk> {
    yield { kind: 'error', message: 'HTTP 401', code: 'http_error' }
  }

  const contentStream = async function* (): AsyncIterable<ModelStreamChunk> {
    yield { kind: 'assistant_text_delta', text: 'hi' }
    yield { kind: 'completed', stopReason: 'stop' as const }
  }

  it('hits the direct provider client, never the routed pool', async () => {
    const directSeen = { requests: [] as ModelRequest[] }
    const routedSeen = { requests: [] as ModelRequest[] }
    const runtime = {
      modelConnections: probeRegistry(),
      directModelClient: fakeClient('direct', contentStream, directSeen),
      modelClient: fakeClient('routed', errorStream, routedSeen)
    }
    const response = await probeModelConnection(runtime, 'p1', probeRequest())
    const body = JSON.parse(response.body) as { ok: boolean; providerId: string; model: string }
    expect(body.ok).toBe(true)
    expect(body.providerId).toBe('p1')
    expect(body.model).toBe('m1')
    expect(routedSeen.requests).toHaveLength(0)
    expect(directSeen.requests).toHaveLength(1)
    const request = directSeen.requests[0]
    expect(request.providerId).toBe('p1')
    expect(request.maxRetryAttempts).toBe(0)
    expect(request.reasoningEffort).toBe('off')
    expect(request.maxTokens).toBe(16)
  })

  it('gives concurrent probes distinct turn ids', async () => {
    const seen = { requests: [] as ModelRequest[] }
    const runtime = {
      modelConnections: probeRegistry(),
      directModelClient: fakeClient('direct', contentStream, seen)
    }
    const [a, b] = await Promise.all([
      probeModelConnection(runtime, 'p1', probeRequest()),
      probeModelConnection(runtime, 'p1', probeRequest())
    ])
    expect((JSON.parse(a.body) as { ok: boolean }).ok).toBe(true)
    expect((JSON.parse(b.body) as { ok: boolean }).ok).toBe(true)
    expect(seen.requests).toHaveLength(2)
    expect(seen.requests[0].turnId).not.toBe(seen.requests[1].turnId)
  })

  it('aborts the upstream request when the caller disconnects', async () => {
    const caller = new AbortController()
    let upstreamAborted = false
    const seen = { requests: [] as ModelRequest[] }
    const hanging = async function* (request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      await new Promise<void>((resolve) => {
        request.abortSignal.addEventListener('abort', () => {
          upstreamAborted = true
          resolve()
        }, { once: true })
      })
      yield { kind: 'error', message: 'aborted by caller', code: 'aborted' }
    }
    const request = new Request('http://kun.test/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'inference' }),
      signal: caller.signal
    })
    const runtime = {
      modelConnections: probeRegistry(),
      directModelClient: fakeClient('direct', hanging, seen)
    }
    const pending = probeModelConnection(runtime, 'p1', request)
    await new Promise((resolve) => setTimeout(resolve, 20))
    caller.abort()
    const response = await pending
    const body = JSON.parse(response.body) as { ok: boolean }
    expect(body.ok).toBe(false)
    expect(upstreamAborted).toBe(true)
  })

  it('reports provider failures without passing through failover health', async () => {
    const seen = { requests: [] as ModelRequest[] }
    const routedSeen = { requests: [] as ModelRequest[] }
    const runtime = {
      modelConnections: probeRegistry(),
      directModelClient: fakeClient('direct', errorStream, seen),
      // A routed pool that could silently succeed through an alternative —
      // the probe must not use it.
      modelClient: fakeClient('routed', contentStream, routedSeen)
    }
    const response = await probeModelConnection(runtime, 'p1', probeRequest())
    const body = JSON.parse(response.body) as { ok: boolean; message?: string }
    expect(body.ok).toBe(false)
    expect(body.message).toBe('HTTP 401')
    expect(routedSeen.requests).toHaveLength(0)
  })
})
