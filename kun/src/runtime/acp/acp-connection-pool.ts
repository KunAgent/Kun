/**
 * ACP connection pool (docs/ade/03 §4.3): one agent process per
 * `${harnessId}:${credentialIdentity}` key hosts many ACP sessions.
 *
 * P6-03: the refcount/idle-release/exit-eviction mechanics delegate to the
 * shared `HarnessAgentPool` in `kun/src/session/harness-pool.ts`; this class
 * only renames the lease field to `connection` and restores the
 * `AcpConnectionExit` payload the connection's own `onExit` supplies.
 */
import {
  HarnessAgentPool,
  HARNESS_POOL_IDLE_RELEASE_MS
} from '../../session/harness-pool.js'
import type { AcpConnection, AcpConnectionExit } from './acp-connection.js'

export const ACP_POOL_IDLE_RELEASE_MS = HARNESS_POOL_IDLE_RELEASE_MS

export type AcpConnectionLease = {
  readonly key: string
  readonly connection: AcpConnection
  /** Idempotent; hands the reference back to the pool. */
  release(): void
}

export class AcpConnectionPool {
  private readonly pool: HarnessAgentPool<AcpConnection>

  constructor(options: { idleReleaseMs?: number } = {}) {
    this.pool = new HarnessAgentPool<AcpConnection>(options)
  }

  async acquire(
    key: string,
    factory: () => Promise<AcpConnection>
  ): Promise<AcpConnectionLease> {
    const lease = await this.pool.acquire(key, factory)
    return {
      key: lease.key,
      connection: lease.agent,
      release: () => lease.release()
    }
  }

  /** Only fires on unexpected process exit, not on pool-initiated closes. */
  onExit(
    key: string,
    listener: (exit: AcpConnectionExit) => void
  ): () => void {
    return this.pool.onExit(key, (exit) => listener(exit as AcpConnectionExit))
  }

  /** Drop the connection immediately (crash, protocol failure, cancel). */
  markUnhealthy(key: string): void {
    this.pool.markUnhealthy(key)
  }

  /**
   * Activity dormancy (docs/ade/06 §7.2): close the pooled connection hosting
   * this unit's ACP session — but only when no turn still leases it, so live
   * sibling sessions on the same agent process are never released with it.
   * Session bindings survive the close; the next turn resumes natively or
   * falls back to portable through the session coordinator.
   */
  releaseForUnit(unitId: string): void {
    this.pool.releaseForUnit(unitId)
  }

  async dispose(): Promise<void> {
    await this.pool.dispose()
  }
}
