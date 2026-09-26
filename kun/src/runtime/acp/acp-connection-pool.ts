/**
 * ACP connection pool (docs/ade/03 §4.3): one agent process per
 * `${harnessId}:${credentialIdentity}` key hosts many ACP sessions. Leases
 * are refcounted; a connection is closed after it has been idle (zero refs)
 * for `idleReleaseMs`. An unexpected process exit evicts the entry and fires
 * the key's `onExit` listeners so hosted session bindings can be marked
 * `native_state_unavailable`.
 */
import type { AcpConnection, AcpConnectionExit } from './acp-connection.js'

export const ACP_POOL_IDLE_RELEASE_MS = 10 * 60 * 1_000

export type AcpConnectionLease = {
  readonly key: string
  readonly connection: AcpConnection
  /** Idempotent; hands the reference back to the pool. */
  release(): void
}

type PoolEntry = {
  connection: AcpConnection
  refs: number
  idleTimer?: NodeJS.Timeout
  exitListeners: Set<(exit: AcpConnectionExit) => void>
  /** Pool-initiated close — onExit listeners do not fire for it. */
  closing: boolean
}

export class AcpConnectionPool {
  private readonly entries = new Map<string, PoolEntry>()
  private readonly pending = new Map<string, Promise<AcpConnectionLease>>()

  constructor(
    private readonly options: { idleReleaseMs?: number } = {}
  ) {}

  async acquire(
    key: string,
    factory: () => Promise<AcpConnection>
  ): Promise<AcpConnectionLease> {
    const inFlight = this.pending.get(key)
    if (inFlight) {
      return inFlight.then(
        () => this.acquire(key, factory),
        () => this.acquire(key, factory)
      )
    }
    const task = this.acquireLocked(key, factory).finally(() => {
      if (this.pending.get(key) === task) this.pending.delete(key)
    })
    this.pending.set(key, task)
    return task
  }

  /** Only fires on unexpected process exit, not on pool-initiated closes. */
  onExit(key: string, listener: (exit: AcpConnectionExit) => void): () => void {
    const entry = this.entries.get(key)
    if (!entry) return () => undefined
    entry.exitListeners.add(listener)
    return () => entry.exitListeners.delete(listener)
  }

  /** Drop the connection immediately (crash, protocol failure, cancel). */
  markUnhealthy(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    void this.closeEntry(key, entry)
  }

  async dispose(): Promise<void> {
    for (const [key, entry] of [...this.entries]) {
      await this.closeEntry(key, entry)
    }
  }

  private async acquireLocked(
    key: string,
    factory: () => Promise<AcpConnection>
  ): Promise<AcpConnectionLease> {
    const existing = this.entries.get(key)
    if (existing && !existing.connection.closed && !existing.closing) {
      existing.refs += 1
      this.clearIdle(existing)
      return this.lease(key, existing)
    }
    const connection = await factory()
    const entry: PoolEntry = {
      connection,
      refs: 1,
      exitListeners: new Set(),
      closing: false
    }
    this.entries.set(key, entry)
    connection.onExit((exit) => this.handleExit(key, entry, exit))
    return this.lease(key, entry)
  }

  private lease(key: string, entry: PoolEntry): AcpConnectionLease {
    let released = false
    const pool = this
    return {
      key,
      connection: entry.connection,
      release() {
        if (released) return
        released = true
        entry.refs -= 1
        if (entry.refs > 0 || entry.closing) return
        entry.idleTimer = setTimeout(() => {
          void pool.closeEntry(key, entry)
        }, pool.options.idleReleaseMs ?? ACP_POOL_IDLE_RELEASE_MS)
      }
    }
  }

  private clearIdle(entry: PoolEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }
  }

  private handleExit(key: string, entry: PoolEntry, exit: AcpConnectionExit): void {
    if (this.entries.get(key) !== entry || entry.closing) return
    this.entries.delete(key)
    this.clearIdle(entry)
    for (const listener of [...entry.exitListeners]) {
      listener(exit)
    }
  }

  private async closeEntry(key: string, entry: PoolEntry): Promise<void> {
    if (this.entries.get(key) !== entry) return
    this.entries.delete(key)
    this.clearIdle(entry)
    entry.closing = true
    await entry.connection.close().catch(() => undefined)
  }
}
