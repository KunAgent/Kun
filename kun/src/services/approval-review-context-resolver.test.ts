import { describe, expect, it } from 'vitest'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { createApprovalReviewModelContextResolver } from './approval-review-context-resolver.js'

describe('createApprovalReviewModelContextResolver', () => {
  it('refuses unresolved aliases and fences a captured client when configuration replaces it', () => {
    const original = modelClient('original')
    const clients = clientsFor({ account: original })
    const resolver = createApprovalReviewModelContextResolver({ selection: () => undefined, clients })
    expect(() => resolver({ model: 'route/coding', unresolvedGatewayAlias: true })).toThrow('first upstream')
    const context = resolver({ model: 'model', providerId: 'account', requestedGatewayAlias: 'route/coding' })
    clients.replace({ default: modelClient('default'), providers: new Map([['account', modelClient('replacement')]]) })
    expect(() => context.client.stream({ model: 'model', providerId: 'account', threadId: 'thread', turnId: 'turn',
      prefix: [], history: [], tools: [], abortSignal: new AbortController().signal })).toThrow('configuration changed')
  })
  it('inherits the exact acting route by default', () => {
    const fixed = modelClient('fixed-client')
    const resolver = createApprovalReviewModelContextResolver({
      selection: () => undefined,
      clients: clientsFor({ 'provider-b': fixed })
    })

    const context = resolver({
      model: 'model-b',
      providerId: 'provider-b',
      accountId: 'account-b'
    })

    expect(context).toEqual({
      source: 'inherit',
      route: { model: 'model-b', providerId: 'provider-b', accountId: 'account-b' },
      client: expect.objectContaining({ provider: 'fixed-client', model: 'fixed-client' })
    })
  })

  it('uses the fixed route without borrowing the acting route or credentials', () => {
    const fixed = modelClient('fixed-client')
    const defaultClient = modelClient('must-not-run')
    const resolver = createApprovalReviewModelContextResolver({
      selection: () => ({
        mode: 'fixed',
        providerId: 'provider-b',
        model: 'model-b',
        accountId: 'account-b'
      }),
      clients: clientsFor({ 'provider-b': fixed }, defaultClient)
    })

    const context = resolver({
      model: 'acting-model',
      providerId: 'provider-a',
      accountId: 'acting-account'
    })

    expect(context.source).toBe('fixed')
    expect(context.route).toEqual({
      model: 'model-b',
      providerId: 'provider-b',
      accountId: 'account-b'
    })
    expect(context.client).toMatchObject({ provider: 'fixed-client', model: 'fixed-client' })
    expect(context.client).not.toBe(defaultClient)
  })

  it('lets a complete fixed route review without an acting route', () => {
    const resolver = createApprovalReviewModelContextResolver({
      selection: () => ({ mode: 'fixed', providerId: 'provider-b', model: 'model-b' }),
      clients: clientsFor({ 'provider-b': modelClient('fixed-client') })
    })

    expect(resolver(undefined).route).toEqual({
      providerId: 'provider-b',
      model: 'model-b'
    })
  })

  it('rejects missing inherit routes, unknown fixed providers, and route-pool providers', () => {
    const inherit = createApprovalReviewModelContextResolver({
      selection: () => ({ mode: 'inherit' }),
      clients: clientsFor({})
    })
    expect(() => inherit(undefined)).toThrow('acting turn model route is unavailable')

    const unknown = createApprovalReviewModelContextResolver({
      selection: () => ({ mode: 'fixed', providerId: 'missing', model: 'model-b' }),
      clients: clientsFor({})
    })
    expect(() => unknown(undefined)).toThrow('unknown model provider: missing')

    const pooled = createApprovalReviewModelContextResolver({
      selection: () => ({ mode: 'fixed', providerId: 'route-gateway:local', model: 'model-b' }),
      clients: clientsFor({})
    })
    expect(() => pooled(undefined)).toThrow('route pools cannot provide')
  })

  it('refuses a third-party harness model through an unrelated provider', () => {
    const resolver = createApprovalReviewModelContextResolver({
      selection: () => ({ mode: 'inherit' }),
      clients: clientsFor({ codex: modelClient('codex-subscription') }),
      nativeRouteAllowed: () => false
    })
    expect(() => resolver({
      model: 'swe-2-high',
      source: { harnessId: 'devin', credentialMode: 'native-login' }
    })).toThrow('cannot be inherited for automatic review')
    expect(() => resolver({
      model: 'swe-2-high',
      providerId: 'codex',
      source: { harnessId: 'devin', credentialMode: 'native-login' }
    })).toThrow('cannot be inherited for automatic review')
  })

  it('inherits a native harness route only with an isolated review adapter', () => {
    const resolver = createApprovalReviewModelContextResolver({
      selection: () => ({ mode: 'inherit' }),
      clients: clientsFor({ 'claude-subscription': modelClient('claude-review') }),
      nativeRouteAllowed: (route) => route.providerId === 'claude-subscription'
    })
    const context = resolver({
      model: 'claude-sonnet-5',
      providerId: 'claude-subscription',
      source: { harnessId: 'claude-code', credentialMode: 'native-login' }
    })
    expect(context.source).toBe('inherit')
    expect(context.client).toMatchObject({ provider: 'claude-review' })
  })

  it('keeps Kun and resolved gateway routes on the existing inherit path', () => {
    const resolver = createApprovalReviewModelContextResolver({
      selection: () => ({ mode: 'inherit' }),
      clients: clientsFor({
        'provider-b': modelClient('kun-client'),
        'route-gateway:local': modelClient('gateway-client')
      }),
      nativeRouteAllowed: () => false
    })
    expect(resolver({ model: 'chat', providerId: 'provider-b', source: { harnessId: 'kun' } }).client)
      .toMatchObject({ provider: 'kun-client' })
    expect(() => resolver({
      model: 'route/coding',
      providerId: 'route-gateway:local',
      requestedGatewayAlias: 'route/coding',
      source: { harnessId: 'codex', credentialMode: 'kun-gateway' }
    })).not.toThrow()
  })

  it('keeps the fixed reviewer independent of third-party execution models', () => {
    const resolver = createApprovalReviewModelContextResolver({
      selection: () => ({ mode: 'fixed', providerId: 'provider-b', model: 'review-model' }),
      clients: clientsFor({ 'provider-b': modelClient('fixed-client') }),
      nativeRouteAllowed: () => false
    })
    const context = resolver({
      model: 'swe-2-high',
      providerId: 'codex',
      source: { harnessId: 'devin', credentialMode: 'native-login' }
    })
    expect(context.route).toEqual({ model: 'review-model', providerId: 'provider-b' })
    expect(context.client).toMatchObject({ provider: 'fixed-client' })
  })
})

function clientsFor(
  providers: Record<string, ModelClient>,
  defaultClient = modelClient('default-client')
): MultiProviderModelClient {
  return new MultiProviderModelClient({
    default: defaultClient,
    providers: new Map(Object.entries(providers))
  })
}

function modelClient(name: string): ModelClient {
  return {
    provider: name,
    model: name,
    async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }
}
