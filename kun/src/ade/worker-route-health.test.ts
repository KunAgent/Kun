import { describe, expect, it } from 'vitest'
import type { DispatchRecord, TeamRecord } from '../contracts/ade.js'
import type { ChildRunRecord } from '../delegation/delegation-runtime-contracts.js'
import { routeUnusableFailure, sameWorkerRoute, workerRouteHealth, type WorkerRouteHealthStores } from './worker-route-health.js'

const NOW = Date.parse('2026-10-23T07:00:00.000Z')
const SPARK = { harnessId: 'kun', providerId: 'codex', model: 'gpt-5.3-codex-spark' } as const
const ASTRA = { harnessId: 'kun', providerId: 'codex', model: 'gpt-6-astra' } as const

function stores(input: {
  workers: Array<{ workerId: string; route: { harnessId: string; providerId?: string; model: string } }>
  dispatches: Array<Pick<DispatchRecord, 'workerId' | 'state' | 'updatedAt'> & { failureReason?: string }>
  failures?: Record<string, ChildRunRecord['failure']>
}): WorkerRouteHealthStores {
  return {
    teams: { get: async () => ({ workers: input.workers }) as unknown as TeamRecord },
    dispatches: { list: async () => input.dispatches as DispatchRecord[] },
    childRuns: { get: async (id: string) => ({ failure: input.failures?.[id] }) as ChildRunRecord }
  }
}

describe('workerRouteHealth', () => {
  it('counts failures per model, not per engine', async () => {
    const health = stores({
      workers: [{ workerId: 'w1', route: SPARK }, { workerId: 'w2', route: ASTRA }],
      dispatches: [
        { workerId: 'w1', state: 'failed', updatedAt: '2026-10-23T06:47:16.000Z' },
        { workerId: 'w1', state: 'failed', updatedAt: '2026-10-23T06:47:17.000Z' }
      ]
    })
    expect(await workerRouteHealth(health, 'team', SPARK, NOW)).toEqual({ failures: 2 })
    expect(await workerRouteHealth(health, 'team', ASTRA, NOW)).toEqual({ failures: 0 })
  })

  it('marks a route unusable when its model was refused, until it succeeds again', async () => {
    const refused = { source: 'model' as const, code: 'http_400', category: 'model_not_found' as const, httpStatus: 400 }
    const failed = { workerId: 'w1', state: 'failed' as const, updatedAt: '2026-10-23T06:47:16.000Z',
      failureReason: "The 'gpt-5.3-codex-spark' model is not supported" }
    const health = await workerRouteHealth(stores({
      workers: [{ workerId: 'w1', route: SPARK }], dispatches: [failed], failures: { w1: refused }
    }), 'team', SPARK, NOW)
    expect(health).toEqual({ failures: 1, unusable: "The 'gpt-5.3-codex-spark' model is not supported" })

    const recovered = await workerRouteHealth(stores({
      workers: [{ workerId: 'w1', route: SPARK }, { workerId: 'w2', route: SPARK }],
      dispatches: [failed, { workerId: 'w2', state: 'completed', updatedAt: '2026-10-23T06:55:00.000Z' }],
      failures: { w1: refused }
    }), 'team', SPARK, NOW)
    expect(recovered).toEqual({ failures: 1 })
  })

  it('forgets failures older than an hour', async () => {
    const health = stores({
      workers: [{ workerId: 'w1', route: SPARK }],
      dispatches: [{ workerId: 'w1', state: 'failed', updatedAt: '2026-10-23T05:30:00.000Z' }],
      failures: { w1: { source: 'model', category: 'model_not_found' } }
    })
    expect(await workerRouteHealth(health, 'team', SPARK, NOW)).toEqual({ failures: 0 })
  })
})

describe('route identity and refusal facts', () => {
  it('treats provider and model as part of the route', () => {
    expect(sameWorkerRoute(SPARK, { ...SPARK })).toBe(true)
    expect(sameWorkerRoute(SPARK, ASTRA)).toBe(false)
    expect(sameWorkerRoute(SPARK, { ...SPARK, providerId: 'openai' })).toBe(false)
  })

  it('only trusts model-side refusals', () => {
    expect(routeUnusableFailure({ source: 'model', category: 'authentication' })).toBe(true)
    expect(routeUnusableFailure({ source: 'model', category: 'request' })).toBe(false)
    expect(routeUnusableFailure({ source: 'runtime', code: 'runtime_restart' })).toBe(false)
    expect(routeUnusableFailure(undefined)).toBe(false)
  })
})
