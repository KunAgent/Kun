import { expect, it } from 'vitest'
import type { ModelClient, ModelRequest } from '../../ports/model-client.js'
import type { ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'
import { RoutePoolModelClient } from './route-pool-model-client.js'

it('retains the admitted stream target during an alias edit and resolves its next request with the new target', async () => {
  const seen: string[] = []
  const pool = (providerId: string): ModelRoutePoolConfig => ({ id: 'coding', name: 'Coding', modelId: 'route/coding',
    enabled: true, strategy: 'priority', targets: [{ id: 'selected', providerId, modelId: 'model', enabled: true, weight: 1 }],
    failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
    healthPolicy: { failureThreshold: 3, cooldownMs: 1000, halfOpenMaxAttempts: 1 } })
  let continueStream!: () => void
  const continued = new Promise<void>((accept) => { continueStream = accept })
  const direct: ModelClient = { provider: 'fixture', model: 'model', async *stream(request) {
    seen.push(request.providerId!)
    yield { kind: 'assistant_text_delta', text: request.providerId! }
    if (request.turnId === 'first') await continued
    yield { kind: 'completed', stopReason: 'stop' }
  } }
  const router = new RoutePoolModelClient(direct, [pool('one')], () => ({ id: 'model', inputModalities: ['text'],
    outputModalities: ['text'], messageParts: ['text'], supportsToolCalling: true }))
  const request = (turnId: string): ModelRequest => ({ threadId: 'thread', turnId, model: 'route/coding',
    prefix: [], history: [], tools: [], abortSignal: new AbortController().signal })
  const first = router.stream(request('first'))[Symbol.asyncIterator]()
  expect((await first.next()).value).toMatchObject({ kind: 'assistant_text_delta', text: 'one', route: { providerId: 'one' } })
  router.replacePools([pool('two')])
  continueStream()
  expect((await first.next()).value).toMatchObject({ kind: 'completed', route: { providerId: 'one' } })
  for await (const _chunk of router.stream(request('second'))) { /* Fully drain the next request. */ }
  expect(seen).toEqual(['one', 'two'])
})

it('never replays a request on a fallback after partial tool arguments have become visible', async () => {
  const seen: string[] = []
  const direct: ModelClient = { provider: 'fixture', model: 'model', async *stream(request) {
    seen.push(request.providerId!)
    if (request.providerId === 'one') {
      yield { kind: 'tool_call_delta', callId: 'read-call', toolName: 'read', argumentsDelta: '{"path":' }
      yield { kind: 'error', message: 'fixture transport failed after tool output',
        failure: { category: 'unavailable', httpStatus: 503, failoverAllowed: true } }
    } else {
      yield { kind: 'assistant_text_delta', text: 'duplicate request must never arrive here' }
      yield { kind: 'completed', stopReason: 'stop' }
    }
  } }
  const pool: ModelRoutePoolConfig = { id: 'tools', name: 'Tools', modelId: 'route/tools', enabled: true, strategy: 'priority',
    targets: ['one', 'two'].map((providerId) => ({ id: providerId, providerId, modelId: 'model', enabled: true, weight: 1 })),
    failurePolicy: { failoverHttpStatusCodes: [429, 503], failoverOnNetworkError: true, failoverOnTimeout: true, failoverOnAuthError: false },
    healthPolicy: { failureThreshold: 3, cooldownMs: 1000, halfOpenMaxAttempts: 1 } }
  const router = new RoutePoolModelClient(direct, [pool], () => ({ id: 'model', inputModalities: ['text'],
    outputModalities: ['text'], messageParts: ['text'], supportsToolCalling: true }))
  const chunks = []
  for await (const chunk of router.stream({ threadId: 'thread', turnId: 'tools', model: 'route/tools',
    prefix: [], history: [], tools: [], abortSignal: new AbortController().signal })) chunks.push(chunk)
  expect(chunks[0]).toMatchObject({ kind: 'tool_call_delta', argumentsDelta: '{"path":', route: { providerId: 'one' } })
  expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
  expect(seen).toEqual(['one'])
})
