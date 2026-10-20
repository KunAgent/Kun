import { z } from 'zod'
import { RuntimeFlavorSchema, type RuntimeFlavor } from '../contracts/runtime-flavor.js'
import { FENCE_FLOOR_KEY } from './service-manager-state-fence-floor.js'

export const RESOURCE_LEASE_TTL_MS = 10_000
/** How often a lease holder renews, or a waiting instance retries acquisition. */
export const RESOURCE_LEASE_TICK_MS = 3_000
export const RESOURCE_COMMIT_TTL_MS = 10_000

export type ManagerResourceFence = {
  resource: string
  ownerFlavor: RuntimeFlavor
  ownerInstanceId: string
  fencingToken: number
}

export type ManagerResourceLease = ManagerResourceFence & {
  acquiredAt: string
  expiresAt: string
  commitId?: string
  commitExpiresAt?: string
}

export const ManagerResourceFenceSchema = z.object({
  resource: z.string().min(1).max(512),
  ownerFlavor: RuntimeFlavorSchema,
  ownerInstanceId: z.string().min(1).max(256),
  fencingToken: z.number().int().positive()
}).strict()

export const ManagerResourceLeaseSchema = ManagerResourceFenceSchema.extend({
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  commitId: z.string().min(1).max(256).optional(),
  commitExpiresAt: z.string().datetime().optional()
}).strict()

export const LegacyManagerResourceLeaseSchema = ManagerResourceLeaseSchema.omit({
  fencingToken: true
})

export class ResourceFenceStaleError extends Error {
  constructor() {
    super('resource lease fencing token is no longer current')
    this.name = 'ResourceFenceStaleError'
  }
}

export class ManagerResourceLeaseRegistry {
  private readonly leases = new Map<string, ManagerResourceLease>()
  private readonly highWater = new Map<string, number>()
  /** Highest token of every retired resource; see FENCE_FLOOR_KEY. */
  private floor = 0

  static restore(input: {
    leases: readonly (ManagerResourceLease | z.infer<typeof LegacyManagerResourceLeaseSchema>)[]
    highWater?: Readonly<Record<string, number>>
  }): ManagerResourceLeaseRegistry {
    const registry = new ManagerResourceLeaseRegistry()
    for (const [resource, token] of Object.entries(input.highWater ?? {})) {
      if (resource === FENCE_FLOOR_KEY) registry.floor = Math.max(registry.floor, token)
      else registry.highWater.set(resource, token)
    }
    for (const value of input.leases) {
      const fencingToken = 'fencingToken' in value ? value.fencingToken : 1
      const lease = ManagerResourceLeaseSchema.parse({ ...value, fencingToken })
      registry.leases.set(lease.resource, lease)
      registry.highWater.set(
        lease.resource,
        Math.max(fencingToken, registry.highWater.get(lease.resource) ?? 0)
      )
    }
    return registry
  }

  acquire(
    input: Omit<ManagerResourceFence, 'fencingToken'>,
    now = new Date(),
    preserveExisting = false
  ): {
    acquired: boolean
    lease: ManagerResourceLease
  } {
    const existing = this.leases.get(input.resource)
    const expired = !preserveExisting && existing && Date.parse(existing.expiresAt) <= now.getTime()
    const commitActive = Boolean(existing?.commitId && existing.commitExpiresAt &&
      Date.parse(existing.commitExpiresAt) > now.getTime())
    const sameOwner = existing?.ownerFlavor === input.ownerFlavor &&
      existing.ownerInstanceId === input.ownerInstanceId
    const productionPreemptsDevelopment =
      (input.resource === 'desktop-host' || input.resource === 'desktop-background-services') &&
      input.ownerFlavor === 'production' && existing?.ownerFlavor === 'development'
    if (existing && commitActive && expired) return { acquired: false, lease: existing }
    if (existing && !expired && !sameOwner && !productionPreemptsDevelopment) {
      return { acquired: false, lease: existing }
    }
    if (existing && !expired && sameOwner) return { acquired: true, lease: existing }
    const fencingToken = (this.highWater.get(input.resource) ?? this.floor) + 1
    const lease = ManagerResourceLeaseSchema.parse({
      ...input,
      fencingToken,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RESOURCE_LEASE_TTL_MS).toISOString()
    })
    this.leases.set(input.resource, lease)
    this.highWater.set(input.resource, fencingToken)
    return { acquired: true, lease }
  }

  renew(
    fence: ManagerResourceFence,
    now = new Date(),
    ignoreExpiry = false
  ): ManagerResourceLease | null {
    if (!this.validate(fence, now, ignoreExpiry)) return null
    const existing = this.leases.get(fence.resource)!
    const lease = ManagerResourceLeaseSchema.parse({
      ...existing,
      expiresAt: new Date(now.getTime() + RESOURCE_LEASE_TTL_MS).toISOString()
    })
    this.leases.set(fence.resource, lease)
    return lease
  }

  beginCommit(
    fence: ManagerResourceFence,
    commitId: string,
    commitExpiresAt: string,
    now = new Date(),
    ignoreExpiry = false
  ): ManagerResourceLease | null {
    if (!this.validate(fence, now, ignoreExpiry)) return null
    const existing = this.leases.get(fence.resource)!
    if (existing.commitId && existing.commitId !== commitId && existing.commitExpiresAt &&
      Date.parse(existing.commitExpiresAt) > now.getTime()) return null
    const lease = ManagerResourceLeaseSchema.parse({
      ...existing,
      commitId,
      commitExpiresAt
    })
    this.leases.set(fence.resource, lease)
    return lease
  }

  renewCommit(
    fence: ManagerResourceFence,
    commitId: string,
    commitExpiresAt: string,
    now = new Date(),
    ignoreExpiry = false
  ): ManagerResourceLease | null {
    const existing = this.leases.get(fence.resource)
    if (!existing || existing.commitId !== commitId ||
      !this.validateCommit(fence, commitId, now, ignoreExpiry)) return null
    const lease = ManagerResourceLeaseSchema.parse({ ...existing, commitExpiresAt })
    this.leases.set(fence.resource, lease)
    return lease
  }

  endCommit(fence: ManagerResourceFence, commitId: string): boolean {
    const existing = this.leases.get(fence.resource)
    if (!existing || existing.fencingToken !== fence.fencingToken ||
      existing.ownerFlavor !== fence.ownerFlavor ||
      existing.ownerInstanceId !== fence.ownerInstanceId ||
      existing.commitId !== commitId) return false
    const { commitId: _commitId, commitExpiresAt: _commitExpiresAt, ...lease } = existing
    this.leases.set(fence.resource, ManagerResourceLeaseSchema.parse(lease))
    return true
  }

  validate(fence: ManagerResourceFence, now = new Date(), ignoreExpiry = false): boolean {
    const existing = this.leases.get(fence.resource)
    return Boolean(existing && (ignoreExpiry || Date.parse(existing.expiresAt) > now.getTime()) &&
      existing.ownerFlavor === fence.ownerFlavor &&
      existing.ownerInstanceId === fence.ownerInstanceId &&
      existing.fencingToken === fence.fencingToken)
  }

  validateCommit(
    fence: ManagerResourceFence,
    commitId: string,
    now = new Date(),
    ignoreExpiry = false
  ): boolean {
    const existing = this.leases.get(fence.resource)
    return Boolean(existing && existing.ownerFlavor === fence.ownerFlavor &&
      existing.ownerInstanceId === fence.ownerInstanceId &&
      existing.fencingToken === fence.fencingToken &&
      existing.commitId === commitId && existing.commitExpiresAt &&
      (ignoreExpiry || Date.parse(existing.commitExpiresAt) > now.getTime()))
  }

  release(fence: ManagerResourceFence): boolean {
    const existing = this.leases.get(fence.resource)
    if (!existing || existing.ownerFlavor !== fence.ownerFlavor ||
      existing.ownerInstanceId !== fence.ownerInstanceId ||
      existing.fencingToken !== fence.fencingToken ||
      Boolean(existing.commitId && existing.commitExpiresAt &&
        Date.parse(existing.commitExpiresAt) > Date.now())) return false
    return this.leases.delete(fence.resource)
  }

  expireStale(now = new Date()): boolean {
    let changed = false
    for (const [resource, lease] of this.leases) {
      const commitActive = Boolean(lease.commitId && lease.commitExpiresAt &&
        Date.parse(lease.commitExpiresAt) > now.getTime())
      if (Date.parse(lease.expiresAt) > now.getTime() || commitActive) continue
      this.leases.delete(resource)
      changed = true
    }
    return changed
  }

  expireOwners(ownerKeys: ReadonlySet<string>): boolean {
    let changed = false
    for (const [resource, lease] of this.leases) {
      if (!ownerKeys.has(`${lease.ownerFlavor}:${lease.ownerInstanceId}`)) continue
      this.leases.delete(resource)
      changed = true
    }
    return changed
  }

  extendLiveDeadlines(deltaMs: number, aliveAtMs: number): boolean {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return false
    let changed = false
    for (const [resource, lease] of this.leases) {
      const expiresAtMs = Date.parse(lease.expiresAt)
      const commitExpiresAtMs = lease.commitExpiresAt
        ? Date.parse(lease.commitExpiresAt)
        : undefined
      const leaseWasAlive = Number.isFinite(expiresAtMs) && expiresAtMs > aliveAtMs
      const commitWasAlive = commitExpiresAtMs !== undefined &&
        Number.isFinite(commitExpiresAtMs) && commitExpiresAtMs > aliveAtMs
      if (!leaseWasAlive && !commitWasAlive) continue
      this.leases.set(resource, ManagerResourceLeaseSchema.parse({
        ...lease,
        ...(leaseWasAlive
          ? { expiresAt: new Date(expiresAtMs + deltaMs).toISOString() }
          : {}),
        ...(commitWasAlive
          ? { commitExpiresAt: new Date(commitExpiresAtMs + deltaMs).toISOString() }
          : {})
      }))
      changed = true
    }
    return changed
  }

  snapshot(): ManagerResourceLease[] {
    return [...this.leases.values()]
  }

  /**
   * Folds the high water of resources without a lease into the floor. Every
   * data mutex, Registry file and thread binding is its own resource, so the
   * map otherwise grows with each name ever locked and is rewritten on every
   * state change.
   */
  retireIdleFences(): void {
    for (const [resource, token] of this.highWater) {
      if (this.leases.has(resource)) continue
      if (token > this.floor) this.floor = token
      this.highWater.delete(resource)
    }
  }

  highWaterSnapshot(): Record<string, number> {
    const snapshot = Object.fromEntries(this.highWater)
    return this.floor > 0 ? { [FENCE_FLOOR_KEY]: this.floor, ...snapshot } : snapshot
  }
}
