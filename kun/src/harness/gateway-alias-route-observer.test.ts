import { describe, expect, it, vi } from 'vitest'
import { observeHarnessAliasRoute } from './gateway-alias-route-observer.js'
import { harnessGatewayStream } from '../server/routes/harness-gateway-stream.js'
import type { ActingTurnModelRoute } from '../contracts/turns.js'
import type { HarnessTokenGrant } from './harness-token-service.js'
import type { ModelStreamChunk } from '../ports/model-client.js'

describe('Agent alias acting source', () => {
  it('persists the first concrete upstream before tools are exposed, without substituting later targets', async () => {
    const acting: ActingTurnModelRoute = { model: 'route/coding', unresolvedGatewayAlias: true }
    const save = vi.fn(async () => undefined)
    const onResolvedRoute = observeHarnessAliasRoute(acting, 'route/coding', save)
    const route = { routePoolId: 'coding', requestedModelId: 'route/coding', providerId: 'one', modelId: 'model-a', targetId: 'one' }
    async function* source(): AsyncIterable<ModelStreamChunk> {
      yield { kind: 'tool_call_complete', callId: 'call', toolName: 'lookup', arguments: {}, route }
      yield { kind: 'completed', stopReason: 'tool_calls', route }
    }
    const iterator = harnessGatewayStream(source(), { onResolvedRoute } as HarnessTokenGrant)[Symbol.asyncIterator]()
    expect((await iterator.next()).value).toMatchObject({ kind: 'tool_call_complete' })
    expect(acting).toMatchObject({ providerId: 'one', model: 'model-a', requestedGatewayAlias: 'route/coding' })
    expect(acting.unresolvedGatewayAlias).toBeUndefined()
    await onResolvedRoute({ ...route, providerId: 'two', modelId: 'model-b' })
    expect(save).toHaveBeenCalledTimes(1)
    expect(acting.providerId).toBe('one')
    await iterator.return?.()
  })
})
