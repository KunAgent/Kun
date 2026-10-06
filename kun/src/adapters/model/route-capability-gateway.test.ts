import { describe, expect, it } from 'vitest'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { capabilitySupportsGatewayRequest, capabilitySupportsRequest, fittedMaxTokens } from './route-capability-contract.js'
import { RoutePoolModelClient } from './route-pool-model-client.js'

const capability: ModelCapabilityMetadata = { id: 'm', inputModalities: ['text'], outputModalities: ['text'], messageParts: ['text'],
  supportsToolCalling: true, contextWindowTokens: 200_000, maxOutputTokens: 32_000 }
const request = (patch: Partial<ModelRequest> = {}): ModelRequest => ({ threadId: 't', turnId: 'u', model: 'coding', prefix: [], history: [], tools: [],
  abortSignal: new AbortController().signal, maxTokens: 200_000, ...patch })
const gateway = { allowedTargets: [{ providerId: 'p', modelId: 'm' }] }

describe('gateway max_tokens is a ceiling', () => {
  it('fits an oversized budget to the target instead of excluding it', () => {
    // Kimi Code sends its whole context size as max_completion_tokens.
    expect(capabilitySupportsRequest(capability, request())).toBe(false)
    expect(capabilitySupportsGatewayRequest(capability, request({ gatewayRouting: gateway }))).toBe(true)
    expect(fittedMaxTokens(capability, request({ gatewayRouting: gateway }))).toBe(32_000)
    expect(fittedMaxTokens(capability, request({ maxTokens: 1_000 }))).toBe(1_000)
  })
  it('still refuses a target with no room left', () => {
    const full = request({ gatewayRouting: gateway, history: [{ id: 'h', kind: 'user_message', role: 'user', text: 'x'.repeat(820_000),
      threadId: 't', turnId: 'u', status: 'completed', createdAt: new Date(0).toISOString() }] })
    expect(capabilitySupportsGatewayRequest(capability, full)).toBe(false)
  })
  it('sends each target the budget it can honor', async () => {
    const seen: (number | undefined)[] = []
    const direct: ModelClient = { provider: 'p', model: 'm', async *stream(input: ModelRequest): AsyncIterable<ModelStreamChunk> {
      seen.push(input.maxTokens); yield { kind: 'completed', stopReason: 'stop' } } }
    const client = new RoutePoolModelClient(direct, [{ id: 'pool', name: 'Pool', modelId: 'coding', enabled: true, strategy: 'priority',
      targets: [{ id: 't', providerId: 'p', modelId: 'm', enabled: true, weight: 1 }],
      failurePolicy: { failoverHttpStatusCodes: [429], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
      healthPolicy: { failureThreshold: 3, cooldownMs: 1_000, halfOpenMaxAttempts: 1 } }], () => capability)
    for await (const _ of client.stream(request({ gatewayRouting: gateway }))) { /* drain */ }
    expect(seen).toEqual([32_000])
  })
})
