import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ModelRequest } from '../../ports/model-client.js'
import type { ModelRoutePoolConfig, ModelRouteTargetConfig } from '../../contracts/model-route-pool.js'

type Entry = { providerId: string; modelId: string; targetId: string; expiresAt: number }

const PERSISTED_ENTRIES = 512

/**
 * Keeps a conversation on the target that answered it while its affinity TTL
 * lasts. With a file, the latest entries survive a runtime restart, so an
 * update does not hand a conversation to another account while the vendor
 * still holds its prompt cache. Only hashed keys and target ids are stored.
 */
export class RouteAffinity {
  private readonly entries = new Map<string, Entry>()
  private file?: string
  private saveTimer?: ReturnType<typeof setTimeout>
  constructor(private readonly now: () => number = Date.now, private readonly capacity = 4_000) {}
  clear(): void { this.entries.clear(); this.scheduleSave() }
  size(): number { return this.entries.size }

  /** Loads persisted entries (dropping expired ones) and saves future commits to `file`. */
  persistTo(file: string): void {
    this.file = file
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; entries?: [string, Entry][] }
      if (saved.version !== 1 || !Array.isArray(saved.entries)) return
      for (const [key, entry] of saved.entries) {
        if (typeof key === 'string' && entry && typeof entry.targetId === 'string' && typeof entry.providerId === 'string' &&
          typeof entry.modelId === 'string' && typeof entry.expiresAt === 'number' && entry.expiresAt > this.now()) this.entries.set(key, entry)
      }
    } catch { /* first run or unreadable: start empty */ }
  }

  flush(): void {
    if (!this.file) return
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = undefined }
    const now = this.now()
    const entries = [...this.entries].filter(([, entry]) => entry.expiresAt > now).slice(-PERSISTED_ENTRIES)
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const temp = `${this.file}.${process.pid}.tmp`
      writeFileSync(temp, JSON.stringify({ version: 1, entries }), { mode: 0o600 })
      renameSync(temp, this.file)
    } catch { /* affinity is an optimization; a failed save never fails a request */ }
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return
    this.saveTimer = setTimeout(() => this.flush(), 1_000)
    this.saveTimer.unref?.()
  }

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
    this.scheduleSave()
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
