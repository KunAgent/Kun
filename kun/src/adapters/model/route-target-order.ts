import type { ModelRoutePoolConfig, ModelRouteTargetConfig } from '../../contracts/model-route-pool.js'
import type { RoutePoolHealthStore, RuntimeHealth } from './route-pool-health-store.js'

/** Pure ordering, used by execution and preview. Only execution advances the cursor. */
export function orderRouteTargets(pool: ModelRoutePoolConfig, targets: ModelRouteTargetConfig[],
  health: RoutePoolHealthStore, counts: ReadonlyMap<string, number>, cursor: number): ModelRouteTargetConfig[] {
  if (pool.strategy === 'priority') return [...targets]
  if (pool.strategy === 'least-latency') return [...targets].sort((a, b) =>
    (health.state(pool.id, a.id).ewmaLatencyMs ?? -1) - (health.state(pool.id, b.id).ewmaLatencyMs ?? -1))
  if (pool.strategy === 'least-used') return [...targets].sort((a, b) =>
    (counts.get(`${pool.id}:${a.id}`) ?? 0) - (counts.get(`${pool.id}:${b.id}`) ?? 0))
  if (pool.strategy === 'adaptive') return [...targets].sort((a, b) =>
    adaptiveScore(health.state(pool.id, b.id)) - adaptiveScore(health.state(pool.id, a.id)))
  if (!targets.length) return []
  if (pool.strategy === 'round-robin') {
    const offset = cursor % targets.length
    return [...targets.slice(offset), ...targets.slice(0, offset)]
  }
  const wheel = targets.flatMap((target) => Array.from({ length: target.weight }, () => target))
  const first = wheel[cursor % wheel.length]
  return [first, ...targets.filter((target) => target.id !== first.id)]
}

function adaptiveScore(state: RuntimeHealth): number {
  const total = state.successes + state.failures
  return total === 0 ? Number.MAX_SAFE_INTEGER : state.successes / total * 10_000 -
    Math.log1p(state.ewmaLatencyMs ?? 1_000) * 100 - state.consecutiveFailures * 1_000
}
