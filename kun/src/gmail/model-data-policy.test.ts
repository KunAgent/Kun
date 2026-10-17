import { describe, expect, it, vi } from 'vitest'
import { GMAIL_CONVERSATION_RECIPIENT } from '../contracts/gmail.js'
import type { ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import type { ModelRoutePoolConfig } from '../contracts/model-route-pool.js'
import { LOCAL_MODEL_GATEWAY_PROVIDER_ID } from '../contracts/model-route-pool.js'
import { GoogleWorkspaceModelClient } from './model-data-policy.js'
import { CompatModelClient } from '../adapters/model/compat-model-client.js'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import { RoutePoolModelClient } from '../adapters/model/route-pool-model-client.js'

const request = (patch: Partial<ModelRequest> = {}): ModelRequest => ({ threadId: 'private-mail', turnId: 'turn',
  providerId: 'configured', model: 'arbitrary-model', tools: [], history: [], prefix: [], stream: false,
  maxRetryAttempts: 0, abortSignal: new AbortController().signal, ...patch })
const response = () => Response.json({ id: 'reply', model: 'arbitrary-model',
  choices: [{ message: { content: 'Email summary' }, finish_reason: 'stop' }] })
async function collect(stream: AsyncIterable<ModelStreamChunk>) {
  const result: ModelStreamChunk[] = []
  for await (const chunk of stream) result.push(chunk)
  return result
}
function controls(sensitive = true) {
  let sharing = true
  let revision = 1
  return { revoke() { sharing = false; revision += 1 },
    policy: { selection: async () => ({ model: 'auto', providerId: 'configured' }),
      dataState: async () => { const captured = revision; return { sensitive, sharingAllowed: sharing,
        assertSharingCurrent: () => { if (!sharing || captured !== revision) throw new Error('Mail permission revoked') } } } } }
}
function compatible(fetchImpl: typeof fetch, baseUrl = 'https://custom.provider.example/v1') {
  return new CompatModelClient({ apiKey: 'fixture-key', baseUrl, model: 'arbitrary-model', fetchImpl, retry: { maxAttempts: 0 } })
}
const pool: ModelRoutePoolConfig = { id: 'any-pool', name: 'Configured pool', modelId: 'auto', enabled: true,
  strategy: 'priority', targets: [
    { id: 'a', providerId: 'a', modelId: 'model-a', enabled: true, weight: 1 },
    { id: 'b', providerId: 'b', modelId: 'model-b', enabled: true, weight: 1 } ],
  failurePolicy: { failoverHttpStatusCodes: [503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: true },
  healthPolicy: { failureThreshold: 2, cooldownMs: 1000, halfOpenMaxAttempts: 1 } }
function routed(first: typeof fetch, second: typeof fetch) {
  const a = compatible(first, 'https://first.example/v1')
  const b = compatible(second, 'https://second.example/v1')
  const direct = new MultiProviderModelClient({ default: a, defaultProviderId: 'a', providers: new Map([['a', a], ['b', b]]), gatewayClients: new Map([['a', a], ['b', b]]) })
  return new RoutePoolModelClient(direct, [pool], (id) => ({ id, inputModalities: ['text'], outputModalities: ['text'],
    supportsToolCalling: true, messageParts: ['text'] }))
}

describe('model-neutral Gmail conversation permission', () => {
  it('allows arbitrary configured endpoints, auto and rotated API credentials without account evidence', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response())
    let key = 'first-fixture-key'
    const client = new CompatModelClient({ baseUrl: 'https://custom.endpoint.example/inference', endpointFormat: 'custom_endpoint',
      customEndpointProtocol: 'chat_completions', apiKey: '', model: 'auto', fetchImpl,
      resolveCredentials: async () => ({ apiKey: key, refreshable: false }) })
    const wrapped = new GoogleWorkspaceModelClient(client, { ...controls().policy, cloudProcessingEnabled: false })
    expect(await wrapped.availability('private-mail')).toMatchObject({ allowed: true, recipientBinding: GMAIL_CONVERSATION_RECIPIENT })
    await collect(wrapped.stream(request({ model: 'auto' })))
    key = 'second-fixture-key'
    await collect(wrapped.stream(request({ turnId: 'second-turn', model: 'auto' })))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://custom.endpoint.example/inference')
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer second-fixture-key')
  })

  for (const format of ['chat_completions', 'messages', 'responses'] as const) {
    it(`allows the configured ${format} protocol`, async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => format === 'messages'
        ? Response.json({ id: 'message', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Summary' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
        : format === 'responses' ? Response.json({ id: 'response', object: 'response', status: 'completed', model: 'arbitrary-model',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Summary' }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }) : response())
      const wrapped = new GoogleWorkspaceModelClient(new CompatModelClient({ baseUrl: 'https://configured.example/v1',
        apiKey: 'fixture-key', model: 'arbitrary-model', endpointFormat: format, fetchImpl }), controls().policy)
      const chunks = await collect(wrapped.stream(request()))
      expect(fetchImpl).toHaveBeenCalledOnce()
      expect(chunks.some((chunk) => chunk.kind === 'assistant_text_delta')).toBe(true)
    })
  }

  it('permits normal route-pool failover and the authorized gateway route', async () => {
    for (const providerId of [undefined, LOCAL_MODEL_GATEWAY_PROVIDER_ID]) {
      const first = vi.fn<typeof fetch>(async () => Response.json({ error: { message: 'Unavailable' } }, { status: 503 }))
      const second = vi.fn<typeof fetch>(async () => response())
      const wrapped = new GoogleWorkspaceModelClient(routed(first, second), controls().policy)
      const chunks = await collect(wrapped.stream(request({ providerId, model: 'auto',
        ...(providerId ? { gatewayRouting: { assertCurrent: () => undefined,
          allowedTargets: [{ providerId: 'a', modelId: 'model-a' }, { providerId: 'b', modelId: 'model-b' }] } } : {}) })))
      expect(first).toHaveBeenCalledOnce()
      expect(second).toHaveBeenCalledOnce()
      expect(chunks.some((chunk) => chunk.kind === 'assistant_text_delta')).toBe(true)
    }
  })

  it('blocks a fallback physical request after the private conversation grant is revoked', async () => {
    const gate = controls()
    const first = vi.fn<typeof fetch>(async () => { gate.revoke(); return Response.json({ error: {} }, { status: 503 }) })
    const second = vi.fn<typeof fetch>(async () => response())
    await collect(new GoogleWorkspaceModelClient(routed(first, second), gate.policy).stream(request({ providerId: undefined, model: 'auto' })))
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  })

  it('does not send mail without sharing or after a final asynchronous wire admission revokes it', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response())
    const denied = controls(); denied.revoke()
    await expect(collect(new GoogleWorkspaceModelClient(compatible(fetchImpl), denied.policy).stream(request()))).rejects.toThrow('Enable Gmail sharing')
    const gate = controls()
    const chunks = await collect(new GoogleWorkspaceModelClient(compatible(fetchImpl), gate.policy)
      .stream(request({ beforeWireDispatch: async () => gate.revoke() })))
    expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps ordinary conversations independent of Gmail and retains the external Agent boundary', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response())
    const ordinary = controls(false); ordinary.revoke()
    const wrapped = new GoogleWorkspaceModelClient(compatible(fetchImpl), ordinary.policy)
    await collect(wrapped.stream(request()))
    expect(fetchImpl).toHaveBeenCalledOnce()
    await expect(wrapped.assertGoogleWorkspaceDelegatedHistory('ordinary')).resolves.toBeUndefined()
    await expect(new GoogleWorkspaceModelClient(compatible(fetchImpl), controls().policy).assertGoogleWorkspaceDelegatedHistory('private-mail'))
      .rejects.toThrow('separate external Agent')
  })
})
