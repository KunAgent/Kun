import { expect, it } from 'vitest'
import { RouteAffinity } from './route-affinity.js'
import type { ModelRequest } from '../../ports/model-client.js'
import type { ModelRoutePoolConfig } from '../../contracts/model-route-pool.js'

const targets = ['a', 'b'].map((id) => ({ id, providerId: id, modelId: 'model', enabled: true, weight: 1 }))
const pool = { id: 'route', affinity: { mode: 'session', ttlMs: 60_000 } } as ModelRoutePoolConfig
const request = (caller: string) => ({ threadId: 'thread', turnId: 'turn',
  gatewayRouting: { callerId: caller, allowedTargets: [], affinity: { session: 'same-session' } } }) as unknown as ModelRequest

it('keeps a committed account only within the verified caller and eligible target set', () => {
  const affinity = new RouteAffinity()
  affinity.committed(pool, request('one'), targets[1])
  expect(affinity.prefer(pool, request('one'), targets).map((entry) => entry.id)).toEqual(['b', 'a'])
  expect(affinity.prefer(pool, request('two'), targets).map((entry) => entry.id)).toEqual(['a', 'b'])
  expect(affinity.prefer(pool, request('one'), [targets[0]])).toEqual([targets[0]])
})

it('expires, bounds and clears affinity without retaining caller text', () => {
  let now = 0
  const affinity = new RouteAffinity(() => now, 2)
  for (const caller of ['one', 'two', 'three']) affinity.committed(pool, request(caller), targets[1])
  expect(affinity.size()).toBe(2)
  now = 60_001
  expect(affinity.prefer(pool, request('three'), targets)).toEqual(targets)
  affinity.clear()
  expect(affinity.size()).toBe(0)
})

it('does not guess session identity when a public caller supplies none', () => {
  const affinity = new RouteAffinity()
  const input = { ...request('one'), gatewayRouting: { allowedTargets: [], callerId: 'one' } }
  affinity.committed(pool, input, targets[1])
  expect(affinity.size()).toBe(0)
})
