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

type ActiveRenewal = {
  lease: ThreadExecutionLease
  timer: ReturnType<typeof setInterval>
  retryTimer?: ReturnType<typeof setTimeout>
  deadlineTimer?: ReturnType<typeof setTimeout>
  renewing: boolean
  transientFailures: number
}

export class ManagerThreadExecutionLeaseClient implements ThreadExecutionLeasePort {
  private readonly renewals = new Map<string, ActiveRenewal>()
  private onLeaseLost: ((lease: ThreadExecutionLease) => void) | undefined

  constructor(
    private readonly manager: ServiceManagerConnection,
    private readonly flavor: RuntimeFlavor,
    private readonly instanceId: string
  ) {}

  setLeaseLostHandler(handler: (lease: ThreadExecutionLease) => void): void {
    this.onLeaseLost = handler
  }

  async acquire(threadId: string, turnId: string): Promise<ThreadExecutionLease> {
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
    this.startRenewal(parsed.lease)
    return parsed.lease
  }

  async release(threadId: string, turnId: string): Promise<void> {
    this.stopRenewal(threadId, turnId)
    await requestManagerJson(
      this.manager,
      `/v1/leases/threads/${encodeURIComponent(threadId)}/release`,
      {
        method: 'POST',
        body: { turnId, ownerFlavor: this.flavor, ownerInstanceId: this.instanceId }
      }
    )
  }

  async owner(threadId: string): Promise<ThreadExecutionLease | null> {
    const body = await requestManagerJson(
      this.manager,
      `/v1/leases/threads/${encodeURIComponent(threadId)}`,
      {}
    )
    return z.object({ lease: ThreadExecutionLeaseSchema.nullable() }).parse(body).lease
  }

  shutdown(): void {
    for (const renewal of this.renewals.values()) {
      clearInterval(renewal.timer)
      if (renewal.retryTimer) clearTimeout(renewal.retryTimer)
      if (renewal.deadlineTimer) clearTimeout(renewal.deadlineTimer)
    }
    this.renewals.clear()
  }

  private startRenewal(lease: ThreadExecutionLease): void {
    this.stopRenewal(lease.threadId)
    const timer = setInterval(() => void this.renew(lease.threadId), 5_000)
    timer.unref?.()
    const renewal: ActiveRenewal = {
      lease,
      timer,
      renewing: false,
      transientFailures: 0
    }
    this.renewals.set(lease.threadId, renewal)
    this.armDeadline(renewal)
  }

  private async renew(threadId: string): Promise<void> {
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
            ownerInstanceId: this.instanceId
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
      if (latest?.lease.turnId === current.lease.turnId) latest.renewing = false
    }
  }

  private recordRenewal(current: ActiveRenewal, lease: ThreadExecutionLease): void {
    const latest = this.renewals.get(current.lease.threadId)
    if (latest?.lease.turnId !== current.lease.turnId) return
    if (latest.transientFailures > 0) {
      console.warn(
        `[kun] thread lease renewal recovered thread=${current.lease.threadId} ` +
        `turn=${current.lease.turnId} attempts=${latest.transientFailures + 1}`
      )
    }
    latest.lease = lease
    latest.transientFailures = 0
    this.armDeadline(latest)
  }

  private recordTransientFailure(current: ActiveRenewal, error: unknown): void {
    const latest = this.renewals.get(current.lease.threadId)
    if (latest?.lease.turnId !== current.lease.turnId) return
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
    this.stopRenewal(lease.threadId, lease.turnId)
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
      () => this.expireRenewal(threadId, turnId),
      Math.max(0, expiresAtMs - Date.now())
    )
    current.deadlineTimer.unref?.()
  }

  private expireRenewal(threadId: string, turnId: string): void {
    const current = this.renewals.get(threadId)
    if (!current || current.lease.turnId !== turnId) return
    console.warn(
      `[kun] thread lease expired without renewal thread=${threadId} ` +
      `turn=${turnId} expiresAt=${current.lease.expiresAt}`
    )
    this.loseRenewal(current.lease)
  }

  private scheduleRenewalRetry(current: ActiveRenewal): void {
    if (current.retryTimer) return
    const retryMs = Math.min(500 * (2 ** Math.min(current.transientFailures - 1, 3)), 5_000)
    current.retryTimer = setTimeout(() => {
      current.retryTimer = undefined
      void this.renew(current.lease.threadId)
    }, retryMs)
    current.retryTimer.unref?.()
  }

  private stopRenewal(threadId: string, turnId?: string): void {
    const current = this.renewals.get(threadId)
    if (!current || (turnId && current.lease.turnId !== turnId)) return
    clearInterval(current.timer)
    if (current.retryTimer) clearTimeout(current.retryTimer)
    if (current.deadlineTimer) clearTimeout(current.deadlineTimer)
    this.renewals.delete(threadId)
  }
}
