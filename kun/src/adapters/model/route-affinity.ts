import { createHash } from 'node:crypto'
import type { ModelRequest } from '../../ports/model-client.js'
import type { ModelRoutePoolConfig, ModelRouteTargetConfig } from '../../contracts/model-route-pool.js'

type Entry = { providerId: string; modelId: string; targetId: string; expiresAt: number }

export class RouteAffinity {
  private readonly entries = new Map<string, Entry>()
  constructor(private readonly now: () => number = Date.now, private readonly capacity = 4_000) {}
  clear(): void { this.entries.clear() }
  size(): number { return this.entries.size }

  prefer(pool: ModelRoutePoolConfig, request: ModelRequest, targets: ModelRouteTargetConfig[]): ModelRouteTargetConfig[] {
    const key = this.key(pool, request)
    const entry = key ? this.entries.get(key) : undefined
    if (!key || !entry) return targets
    const target = targets.find((candidate) => candidate.id === entry.targetId &&
      candidate.providerId === entry.providerId && candidate.modelId === entry.modelId)
    if (!target || entry.expiresAt <= this.now()) { this.entries.delete(key); return targets }
    this.entries.delete(key); this.entries.set(key, entry)
    return [target, ...targets.filter((candidate) => candidate !== target)]
  }

  committed(pool: ModelRoutePoolConfig, request: ModelRequest, target: ModelRouteTargetConfig): void {
    const key = this.key(pool, request)
    if (!key || !pool.affinity) return
    this.entries.delete(key)
    while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!)
    this.entries.set(key, { providerId: target.providerId, modelId: target.modelId, targetId: target.id,
      expiresAt: this.now() + pool.affinity.ttlMs })
  }

  private key(pool: ModelRoutePoolConfig, request: ModelRequest): string | undefined {
    const mode = pool.affinity?.mode ?? 'off'
    if (mode === 'off') return undefined
    const scope = request.gatewayRouting?.callerId ?? 'kun'
    const identity = request.gatewayRouting
      ? request.gatewayRouting.affinity?.[mode]
      : mode === 'turn' ? request.turnId : request.threadId
    return identity ? createHash('sha256').update(JSON.stringify([pool.id, mode, scope, identity])).digest('hex') : undefined
  }
}
