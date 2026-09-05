import type { GraphRuntimeConfig } from '../config/kun-config.js'
import type {
  FileGraphWriteCoordinator,
  GraphPathLease
} from './graph-write-coordinator.js'

export class GraphAttemptLeaseManager {
  private readonly leases = new Map<string, GraphPathLease>()
  private readonly heartbeats = new Map<string, { runId: string; timer: NodeJS.Timeout }>()

  constructor(private readonly options: {
    writes: FileGraphWriteCoordinator
    config: () => GraphRuntimeConfig
  }) {}

  track(attemptId: string, lease: GraphPathLease): void {
    this.leases.set(attemptId, lease)
  }

  startHeartbeat(input: {
    runId: string
    attemptId: string
    lease: GraphPathLease
    abort: AbortController
    onRenewalFailure: (error: unknown) => void
  }): void {
    const timer = setInterval(() => {
      void this.options.writes.renew(input.lease.leaseId).catch((error) => {
        this.stopHeartbeat(input.attemptId)
        input.abort.abort(new Error(`Graph write lease renewal failed: ${errorMessage(error)}`))
        input.onRenewalFailure(error)
      })
    }, Math.max(
      250,
      Math.min(60_000, Math.floor(this.options.config().writeIsolation.leaseTtlMs / 3))
    ))
    timer.unref?.()
    this.heartbeats.set(input.attemptId, { runId: input.runId, timer })
  }

  async integrate(attemptId: string): Promise<'applied' | 'conflict'> {
    const writeState = await this.options.writes.list()
    // Concurrent reviews can release the durable lease while this manager still
    // holds its acquisition snapshot, so persisted state is authoritative here.
    const persistedLease = writeState.leases.find((entry) => entry.attemptId === attemptId)
    const lease = persistedLease ?? this.leases.get(attemptId)
    if (
      lease?.state === 'released' &&
      (
        lease.releaseDisposition === 'accepted' ||
        writeState.worktrees.some((entry) =>
          entry.attemptId === attemptId &&
          (entry.state === 'accepted' || entry.state === 'cleaned'))
      )
    ) {
      this.stop(attemptId)
      return 'applied'
    }
    if (lease && !await this.options.writes.isActive(lease.leaseId)) {
      const latestState = await this.options.writes.list()
      const latestLease = latestState.leases.find((entry) => entry.attemptId === attemptId)
      const alreadyAccepted = latestLease?.state === 'released' &&
        (
          latestLease.releaseDisposition === 'accepted' ||
          latestState.worktrees.some((entry) =>
            entry.attemptId === attemptId &&
            (entry.state === 'accepted' || entry.state === 'cleaned'))
        )
      if (alreadyAccepted) {
        this.stop(attemptId)
        return 'applied'
      }
      return 'conflict'
    }
    let worktree
    try {
      worktree = await this.options.writes.captureWorktree(attemptId)
    } catch {
      return 'conflict'
    }
    if (worktree) {
      const integrated = await this.options.writes.integrate(attemptId)
      if (integrated.outcome !== 'applied') return 'conflict'
    }
    try {
      if (lease) await this.options.writes.release(lease.leaseId, 'accepted')
    } finally {
      this.stop(attemptId)
    }
    return 'applied'
  }

  async release(
    attemptId: string,
    disposition: 'failed' | 'cancelled'
  ): Promise<void> {
    const lease = this.leases.get(attemptId)
    try {
      if (lease) await this.options.writes.release(lease.leaseId, disposition)
    } finally {
      this.stop(attemptId)
    }
  }

  stopRunHeartbeats(runId: string): void {
    for (const [attemptId, heartbeat] of this.heartbeats) {
      if (heartbeat.runId === runId) this.stopHeartbeat(attemptId)
    }
  }

  stopAllHeartbeats(): void {
    for (const attemptId of this.heartbeats.keys()) this.stopHeartbeat(attemptId)
  }

  private stop(attemptId: string): void {
    this.stopHeartbeat(attemptId)
    this.leases.delete(attemptId)
  }

  private stopHeartbeat(attemptId: string): void {
    const heartbeat = this.heartbeats.get(attemptId)
    if (heartbeat) clearInterval(heartbeat.timer)
    this.heartbeats.delete(attemptId)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
