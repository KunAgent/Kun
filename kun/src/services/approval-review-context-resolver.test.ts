import { describe, expect, it } from 'vitest'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { createApprovalReviewModelContextResolver } from './approval-review-context-resolver.js'

describe('createApprovalReviewModelContextResolver', () => {
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
      client: fixed
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
    expect(context.client).toBe(fixed)
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
