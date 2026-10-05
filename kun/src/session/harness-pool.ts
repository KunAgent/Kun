/**
 * Generic agent-process pool (P6-03, generalized from `acp-connection-pool.ts`):
 * one process per `${harnessId}:${credentialIdentity}` key hosts many sessions.
 * Leases are refcounted; a connection is closed after it has been idle for
 * `idleReleaseMs`. An unexpected process exit evicts the entry and fires the
 * key's `onExit` listeners so hosted session bindings can be rebased.
 */
import { raceProbeAbort } from '../harness/probe-abort.js'

export const HARNESS_POOL_IDLE_RELEASE_MS = 10 * 60 * 1_000

export type HarnessPoolAdmission = {
  signal?: AbortSignal
  /** Checked under the acquisition lock, including reuse after a pending connect. */
  validate?: () => Promise<unknown>
}

async function validateAdmission(admission: HarnessPoolAdmission): Promise<void> {
  admission.signal?.throwIfAborted()
  await admission.validate?.()
  admission.signal?.throwIfAborted()
}

export type PooledAgentExit = { code: number | null; signal: string | null }

/** Minimal pooled-connection surface; `HarnessAgent` satisfies this. */
export type PooledAgent = {
  readonly closed: boolean
  close(): Promise<void>
  onExit(listener: (exit: PooledAgentExit) => void): void
  sessionThreadIds(): readonly string[]
}

export type HarnessAgentLease<T extends PooledAgent> = {
  readonly key: string
  readonly agent: T
  /** Idempotent; hands the reference back to the pool. */
  release(): void
}

type PoolEntry<T extends PooledAgent> = {
  agent: T
  refs: number
  /** An aborted turn failed to settle; do not admit another session here. */
  unhealthy: boolean
  idleTimer?: NodeJS.Timeout
  exitListeners: Set<(exit: PooledAgentExit) => void>
  /** Pool-initiated close — onExit listeners do not fire for it. */
  closing: boolean
}

export class HarnessAgentPool<T extends PooledAgent> {
  private readonly entries = new Map<string, PoolEntry<T>>()
  private readonly pending = new Map<string, Promise<HarnessAgentLease<T>>>()

  constructor(
    private readonly options: { idleReleaseMs?: number } = {}
  ) {}

  async acquire(
    key: string,
    factory: () => Promise<T>,
    admission: HarnessPoolAdmission = {}
  ): Promise<HarnessAgentLease<T>> {
    admission.signal?.throwIfAborted()
    const inFlight = this.pending.get(key)
    if (inFlight) {
      // Cancellation must not leave a continuation that acquires/spawns later.
      await raceProbeAbort(inFlight.catch(() => undefined), admission.signal)
      return this.acquire(key, factory, admission)
    }
    const task = this.acquireLocked(key, factory, admission).finally(() => {
      if (this.pending.get(key) === task) this.pending.delete(key)
    })
    this.pending.set(key, task)
    return task
  }

  /** Only fires on unexpected process exit, not on pool-initiated closes. */
  onExit(key: string, listener: (exit: PooledAgentExit) => void): () => void {
    const entry = this.entries.get(key)
    if (!entry) return () => undefined
    entry.exitListeners.add(listener)
    return () => entry.exitListeners.delete(listener)
  }

  /**
   * Quarantine an unhealthy process. Close immediately with at most one
   * active lease; otherwise preserve sibling turns and close after release.
   */
  markUnhealthy(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.unhealthy = true
    if (entry.refs <= 1) void this.closeEntry(key, entry)
  }

  /**
   * Activity dormancy (docs/ade/06 §7.2): close the pooled connection hosting
   * this unit's session — but only when no turn still leases it, so live
   * sibling sessions on the same agent process are never released with it.
   * Session bindings survive the close; the next turn resumes natively or
   * falls back to portable through the session coordinator.
   */
  releaseForUnit(unitId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.refs !== 0 || entry.closing) continue
      if (!entry.agent.sessionThreadIds().includes(unitId)) continue
      void this.closeEntry(key, entry)
    }
  }

  /** Retire only idle processes superseded by an executable upgrade. */
  async retireIdlePrefix(prefix: string, keep: string): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (key !== keep && key.startsWith(prefix) && entry.refs === 0 && !entry.closing) await this.closeEntry(key, entry)
    }
  }

  async dispose(): Promise<void> {
    for (const [key, entry] of [...this.entries]) {
      await this.closeEntry(key, entry)
    }
  }

  private async acquireLocked(
    key: string,
    factory: () => Promise<T>,
    admission: HarnessPoolAdmission
  ): Promise<HarnessAgentLease<T>> {
    await validateAdmission(admission)
    const existing = this.entries.get(key)
    if (existing?.unhealthy && existing.refs > 0) {
      throw new Error(`harness process is draining after an interrupted turn: ${key}`)
    }
    if (existing?.unhealthy) {
      await this.closeEntry(key, existing)
      await validateAdmission(admission)
    }
    if (existing && !existing.unhealthy && !existing.agent.closed && !existing.closing) {
      existing.refs += 1
      this.clearIdle(existing)
      return this.lease(key, existing)
    }
    const agent = await factory()
    try {
      await validateAdmission(admission)
    } catch (error) {
      // This process has no other leases. Never publish a stale connection.
      await agent.close().catch(() => undefined)
      throw error
    }
    const entry: PoolEntry<T> = {
      agent,
      refs: 1,
      unhealthy: false,
      exitListeners: new Set(),
      closing: false
    }
    this.entries.set(key, entry)
    agent.onExit((exit) => this.handleExit(key, entry, exit))
    return this.lease(key, entry)
  }

  private lease(key: string, entry: PoolEntry<T>): HarnessAgentLease<T> {
    let released = false
    const pool = this
    return {
      key,
      agent: entry.agent,
      release() {
        if (released) return
        released = true
        entry.refs -= 1
        if (entry.refs > 0 || entry.closing) return
        if (entry.unhealthy) {
          void pool.closeEntry(key, entry)
          return
        }
        entry.idleTimer = setTimeout(() => {
          void pool.closeEntry(key, entry)
        }, pool.options.idleReleaseMs ?? HARNESS_POOL_IDLE_RELEASE_MS)
      }
    }
  }

  private clearIdle(entry: PoolEntry<T>): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }
  }

  private handleExit(key: string, entry: PoolEntry<T>, exit: PooledAgentExit): void {
    if (this.entries.get(key) !== entry || entry.closing) return
    this.entries.delete(key)
    this.clearIdle(entry)
    for (const listener of [...entry.exitListeners]) {
      listener(exit)
    }
  }

  private async closeEntry(key: string, entry: PoolEntry<T>): Promise<void> {
    if (this.entries.get(key) !== entry) return
    this.entries.delete(key)
    this.clearIdle(entry)
    entry.closing = true
    await entry.agent.close().catch(() => undefined)
  }
}
