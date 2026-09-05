import { z } from 'zod'
import {
  ThreadExecutionLeaseSchema,
  type RuntimeFlavor,
  type ThreadExecutionLease
} from '../contracts/runtime-flavor.js'
import {
  ThreadExecutionBusyError,
  type ThreadExecutionLeasePort
} from '../ports/thread-execution-lease.js'
import {
  requestManagerJson,
  requestManagerResponse,
  requireManagerJson
} from './manager-client-support.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { forgetTurnLease, rememberTurnLease } from './turn-mutation-context.js'

type ActiveRenewal = {
  lease: ThreadExecutionLease
  timer: ReturnType<typeof setInterval>
  retryTimer?: ReturnType<typeof setTimeout>
  deadlineTimer?: ReturnType<typeof setTimeout>
  renewing: boolean
  transientFailures: number
  deadlineGraceUsed: boolean
}

const HOST_RESUME_RENEWAL_GRACE_MS = 20_000
const LEASE_RELEASE_ATTEMPTS = 3
type LeaseClientState = 'open' | 'closing' | 'closed'

/**
 * Per-thread authority as seen by this runtime. `grace` means the local
 * deadline fired and this runtime unilaterally extended its own deadline to
 * renew; Manager may already have re-issued the lease to another runtime, so
 * side-effecting tool dispatch must pause until renewal resolves.
 */
export type ThreadLeaseAuthorityState = 'holder' | 'grace' | 'lost'

type AuthorityWaiter = {
  resolve: (state: 'holder' | 'lost') => void
}

export class ManagerThreadExecutionLeaseClient implements ThreadExecutionLeasePort {
  private readonly renewals = new Map<string, ActiveRenewal>()
  // Keep the last acquired fence even after renewal is authoritatively lost.
  // Turn cleanup may still race with async persistence. Those writes must carry
  // the stale token so Manager rejects them instead of silently accepting an
  // unfenced mutation.
  private readonly leasesByTurn = new Map<string, ThreadExecutionLease>()
  private readonly pendingAcquires = new Set<Promise<ThreadExecutionLease>>()
  private readonly pendingReleases = new Map<string, Promise<void>>()
  private readonly pendingTurnReleases = new Map<string, Promise<void>>()
  private onLeaseLost: ((lease: ThreadExecutionLease) => void) | undefined
  private state: LeaseClientState = 'open'
  private shutdownPromise: Promise<void> | undefined
  private readonly authorityByThread = new Map<string, ThreadLeaseAuthorityState>()
  private readonly authorityWaiters = new Map<string, AuthorityWaiter[]>()

  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly flavor: RuntimeFlavor,
    private readonly instanceId: string
  ) {}

  setLeaseLostHandler(handler: (lease: ThreadExecutionLease) => void): void {
    this.onLeaseLost = handler
  }

  authorityState(threadId: string): ThreadLeaseAuthorityState {
    return this.authorityByThread.get(threadId) ?? 'holder'
  }

  waitAuthorityResolution(threadId: string): Promise<'holder' | 'lost'> {
    const current = this.authorityState(threadId)
    if (current !== 'grace') return Promise.resolve(current)
    return new Promise<'holder' | 'lost'>((resolve) => {
      const waiters = this.authorityWaiters.get(threadId) ?? []
      waiters.push({ resolve })
      this.authorityWaiters.set(threadId, waiters)
    })
  }

  private setAuthority(threadId: string, state: ThreadLeaseAuthorityState): void {
    this.authorityByThread.set(threadId, state)
    if (state === 'grace') return
    const waiters = this.authorityWaiters.get(threadId)
    if (!waiters || waiters.length === 0) return
    this.authorityWaiters.delete(threadId)
    for (const waiter of waiters) waiter.resolve(state)
  }

  async acquire(threadId: string, turnId: string): Promise<ThreadExecutionLease> {
    if (this.state !== 'open') throw new Error('thread execution lease client is shutting down')
    const pending = this.acquireOpen(threadId, turnId)
    this.pendingAcquires.add(pending)
    try {
      return await pending
    } finally {
      this.pendingAcquires.delete(pending)
    }
  }

  private async acquireOpen(threadId: string, turnId: string): Promise<ThreadExecutionLease> {
    const releasing = this.pendingTurnReleases.get(threadTurnKey(threadId, turnId))
    if (releasing) await releasing
    if (this.state !== 'open') throw new Error('thread execution lease client is shutting down')
    const response = await requestManagerResponse(
      this.manager,
      `/v1/leases/threads/${encodeURIComponent(threadId)}/acquire`,
      {
        method: 'POST',
        body: { turnId, ownerFlavor: this.flavor, ownerInstanceId: this.instanceId }
      }
    )
    if (response.status === 409) {
      const body = await response.json().catch(() => null)
      const owner = z.object({ owner: ThreadExecutionLeaseSchema }).safeParse(body)
      if (owner.success) throw new ThreadExecutionBusyError(owner.data.owner)
    }
    const parsed = z.object({ lease: ThreadExecutionLeaseSchema }).parse(
      await requireManagerJson(response)
    )
    this.leasesByTurn.set(parsed.lease.turnId, parsed.lease)
    rememberTurnLease(parsed.lease)
    this.setAuthority(parsed.lease.threadId, 'holder')
    if (this.state !== 'open') {
      await this.release(parsed.lease.threadId, parsed.lease.turnId)
      throw new Error('thread execution lease client is shutting down')
    }
    this.startRenewal(parsed.lease)
    return parsed.lease
  }

  async release(threadId: string, turnId: string): Promise<void> {
    const lease = this.leasesByTurn.get(turnId)
    if (!lease || lease.threadId !== threadId) return
    const releaseKey = leaseGenerationKey(lease)
    const existing = this.pendingReleases.get(releaseKey)
    if (existing) return existing
    const turnKey = threadTurnKey(threadId, turnId)
    let pending: Promise<void>
    pending = this.releaseLease(lease).finally(() => {
      if (this.pendingReleases.get(releaseKey) === pending) {
        this.pendingReleases.delete(releaseKey)
      }
      if (this.pendingTurnReleases.get(turnKey) === pending) {
        this.pendingTurnReleases.delete(turnKey)
      }
    })
    this.pendingReleases.set(releaseKey, pending)
    this.pendingTurnReleases.set(turnKey, pending)
    return pending
  }

  private async releaseLease(lease: ThreadExecutionLease): Promise<void> {
    const { threadId, turnId } = lease
    this.stopRenewal(threadId, turnId, lease.fencingToken)
    let lastError: unknown
    for (let attempt = 1; attempt <= LEASE_RELEASE_ATTEMPTS; attempt += 1) {
      try {
        await requestManagerJson(
          this.manager,
          `/v1/leases/threads/${encodeURIComponent(threadId)}/release`,
          {
            method: 'POST',
            body: {
              turnId,
              ownerFlavor: this.flavor,
              ownerInstanceId: this.instanceId,
              fencingToken: lease.fencingToken
            }
          }
        )
        lastError = undefined
        break
      } catch (error) {
        lastError = error
      }
    }
    if (lastError !== undefined) throw lastError
    if (sameLeaseGeneration(this.leasesByTurn.get(turnId), lease)) {
      this.leasesByTurn.delete(turnId)
    }
    forgetTurnLease(lease)
    if (!this.renewals.has(threadId)) {
      this.setAuthority(threadId, 'lost')
    }
  }

  async owner(threadId: string): Promise<ThreadExecutionLease | null> {
    const body = await requestManagerJson(
      this.manager,
      `/v1/leases/threads/${encodeURIComponent(threadId)}`,
      {}
    )
    return z.object({ lease: ThreadExecutionLeaseSchema.nullable() }).parse(body).lease
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.state = 'closing'
    this.stopAllRenewals()
    this.shutdownPromise = this.finishShutdown()
    return this.shutdownPromise
  }

  private async finishShutdown(): Promise<void> {
    await Promise.allSettled([...this.pendingAcquires])
    const releases = new Set<Promise<void>>([...this.pendingReleases.values()])
    for (const lease of this.leasesByTurn.values()) {
      releases.add(this.release(lease.threadId, lease.turnId))
    }
    const results = await Promise.allSettled(releases)
    this.stopAllRenewals()
    this.state = 'closed'
    const errors = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : []
    )
    if (errors.length > 0) {
      throw new AggregateError(
        [...new Set(errors)],
        'one or more thread execution leases could not be released during shutdown'
      )
    }
  }

  private stopAllRenewals(): void {
    for (const renewal of this.renewals.values()) {
      clearInterval(renewal.timer)
      if (renewal.retryTimer) clearTimeout(renewal.retryTimer)
      if (renewal.deadlineTimer) clearTimeout(renewal.deadlineTimer)
    }
    this.renewals.clear()
  }

  private startRenewal(lease: ThreadExecutionLease): void {
    if (this.state !== 'open') return
    this.stopRenewal(lease.threadId)
    const timer = setInterval(() => void this.renew(lease.threadId), 5_000)
    timer.unref?.()
    const renewal: ActiveRenewal = {
      lease,
      timer,
      renewing: false,
      transientFailures: 0,
      deadlineGraceUsed: false
    }
    this.renewals.set(lease.threadId, renewal)
    this.armDeadline(renewal)
  }

  private async renew(threadId: string): Promise<void> {
    if (this.state !== 'open') return
    const current = this.renewals.get(threadId)
    if (!current || current.renewing) return
    if (current.retryTimer) {
      clearTimeout(current.retryTimer)
      current.retryTimer = undefined
    }
    current.renewing = true
    try {
      const response = await requestManagerResponse(
        this.manager,
        `/v1/leases/threads/${encodeURIComponent(threadId)}/renew`,
        {
          method: 'POST',
          body: {
            turnId: current.lease.turnId,
            ownerFlavor: this.flavor,
            ownerInstanceId: this.instanceId,
            fencingToken: current.lease.fencingToken
          }
        }
      )
      if (response.status === 409) {
        await response.body?.cancel().catch(() => undefined)
        this.loseRenewal(current.lease)
        return
      }
      const parsed = z.object({ lease: ThreadExecutionLeaseSchema }).parse(
        await requireManagerJson(response)
      )
      this.recordRenewal(current, parsed.lease)
    } catch (error) {
      this.recordTransientFailure(current, error)
    } finally {
      const latest = this.renewals.get(threadId)
      if (latest && sameLeaseGeneration(latest.lease, current.lease)) latest.renewing = false
    }
  }

  private recordRenewal(current: ActiveRenewal, lease: ThreadExecutionLease): void {
    if (this.state !== 'open') return
    const latest = this.renewals.get(current.lease.threadId)
    if (!latest || !sameLeaseGeneration(latest.lease, current.lease)) return
    if (latest.transientFailures > 0) {
      console.warn(
        `[kun] thread lease renewal recovered thread=${current.lease.threadId} ` +
        `turn=${current.lease.turnId} attempts=${latest.transientFailures + 1}`
      )
    }
    latest.lease = lease
    this.leasesByTurn.set(lease.turnId, lease)
    rememberTurnLease(lease)
    this.setAuthority(lease.threadId, 'holder')
    latest.transientFailures = 0
    latest.deadlineGraceUsed = false
    this.armDeadline(latest)
  }

  private recordTransientFailure(current: ActiveRenewal, error: unknown): void {
    if (this.state !== 'open') return
    const latest = this.renewals.get(current.lease.threadId)
    if (!latest || !sameLeaseGeneration(latest.lease, current.lease)) return
    latest.transientFailures += 1
    if (latest.transientFailures === 1 || latest.transientFailures % 3 === 0) {
      console.warn(
        `[kun] thread lease renewal delayed thread=${current.lease.threadId} ` +
        `turn=${current.lease.turnId} failures=${latest.transientFailures}: ` +
        `${error instanceof Error ? error.message : String(error)}`
      )
    }
    this.scheduleRenewalRetry(latest)
  }

  private loseRenewal(lease: ThreadExecutionLease): void {
    this.stopRenewal(lease.threadId, lease.turnId, lease.fencingToken)
    this.setAuthority(lease.threadId, 'lost')
    this.onLeaseLost?.(lease)
  }

  // Local hard deadline: Manager deletes the lease at expiresAt whether or not
  // this runtime can reach it, so renewal retries must not outlive expiresAt.
  private armDeadline(current: ActiveRenewal): void {
    if (current.deadlineTimer) clearTimeout(current.deadlineTimer)
    current.deadlineTimer = undefined
    const expiresAtMs = Date.parse(current.lease.expiresAt)
    if (!Number.isFinite(expiresAtMs)) return
    const { threadId, turnId } = current.lease
    current.deadlineTimer = setTimeout(
      () => this.expireRenewal(threadId, turnId, current.lease.fencingToken),
      Math.max(0, expiresAtMs - Date.now())
    )
    current.deadlineTimer.unref?.()
  }

  private expireRenewal(threadId: string, turnId: string, fencingToken: number): void {
    const current = this.renewals.get(threadId)
    if (
      !current ||
      current.lease.turnId !== turnId ||
      current.lease.fencingToken !== fencingToken
    ) return
    if (!current.deadlineGraceUsed) {
      current.deadlineGraceUsed = true
      // The local deadline fired before renewal completed. This runtime is no
      // longer provably the Manager-recognized owner: pause new side-effecting
      // tool dispatch until the renewal resolves (or fails).
      this.setAuthority(threadId, 'grace')
      current.lease = {
        ...current.lease,
        expiresAt: new Date(Date.now() + HOST_RESUME_RENEWAL_GRACE_MS).toISOString()
      }
      this.armDeadline(current)
      void this.renew(threadId)
      return
    }
    console.warn(
      `[kun] thread lease expired without renewal thread=${threadId} ` +
      `turn=${turnId} expiresAt=${current.lease.expiresAt}`
    )
    this.loseRenewal(current.lease)
  }

  private scheduleRenewalRetry(current: ActiveRenewal): void {
    if (this.state !== 'open') return
    if (current.retryTimer) return
    const retryMs = Math.min(500 * (2 ** Math.min(current.transientFailures - 1, 3)), 5_000)
    current.retryTimer = setTimeout(() => {
      current.retryTimer = undefined
      if (!sameLeaseGeneration(this.renewals.get(current.lease.threadId)?.lease, current.lease)) {
        return
      }
      void this.renew(current.lease.threadId)
    }, retryMs)
    current.retryTimer.unref?.()
  }

  private stopRenewal(threadId: string, turnId?: string, fencingToken?: number): void {
    const current = this.renewals.get(threadId)
    if (
      !current ||
      (turnId && current.lease.turnId !== turnId) ||
      (fencingToken !== undefined && current.lease.fencingToken !== fencingToken)
    ) return
    clearInterval(current.timer)
    if (current.retryTimer) clearTimeout(current.retryTimer)
    if (current.deadlineTimer) clearTimeout(current.deadlineTimer)
    this.renewals.delete(threadId)
  }
}

function sameLeaseGeneration(
  candidate: ThreadExecutionLease | undefined,
  expected: ThreadExecutionLease
): boolean {
  return Boolean(
    candidate &&
    candidate.threadId === expected.threadId &&
    candidate.turnId === expected.turnId &&
    candidate.ownerFlavor === expected.ownerFlavor &&
    candidate.ownerInstanceId === expected.ownerInstanceId &&
    candidate.fencingToken === expected.fencingToken
  )
}

function leaseGenerationKey(lease: ThreadExecutionLease): string {
  return `${lease.threadId}\0${lease.turnId}\0${lease.ownerInstanceId}\0${lease.fencingToken}`
}

function threadTurnKey(threadId: string, turnId: string): string {
  return `${threadId}\0${turnId}`
}
