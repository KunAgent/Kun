import type { ApprovalGate } from '../ports/approval-gate.js'
import type { ApprovalRequest } from '../domain/approval.js'

type PendingResolver = {
  resolve: (decision: 'allow' | 'deny') => void
  reject: (error: Error) => void
}

const DEFAULT_PENDING_TIMEOUT_MS = 10 * 60 * 1000

/**
 * In-memory approval gate. The HTTP layer posts decisions into
 * `decide`; the loop awaits the `request` promise to learn whether
 * the user allowed or denied the call.
 *
 * Pending approvals auto-expire after `pendingTimeoutMs` (default 10 min)
 * to prevent unbounded growth from abandoned requests. Resolved entries
 * are removed immediately since the event log is the source of truth.
 */
export class InMemoryApprovalGate implements ApprovalGate {
  private readonly approvals = new Map<string, ApprovalRequest>()
  private readonly resolvers = new Map<string, PendingResolver>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly pendingTimeoutMs: number

  constructor(options?: { pendingTimeoutMs?: number }) {
    this.pendingTimeoutMs =
      options?.pendingTimeoutMs ?? DEFAULT_PENDING_TIMEOUT_MS
  }

  request(approval: ApprovalRequest): Promise<'allow' | 'deny'> {
    this.approvals.set(approval.id, approval)
    const timer = setTimeout(
      () => this.expire(approval.id),
      this.pendingTimeoutMs
    )
    if (typeof timer.unref === 'function') timer.unref()
    this.timers.set(approval.id, timer)
    return new Promise<'allow' | 'deny'>((resolve, reject) => {
      this.resolvers.set(approval.id, { resolve, reject })
    })
  }

  decide(approvalId: string, decision: 'allow' | 'deny', reason?: string): boolean {
    const approval = this.approvals.get(approvalId)
    if (!approval) return false
    this.cleanupEntry(approvalId)
    const resolver = this.resolvers.get(approvalId)
    this.resolvers.delete(approvalId)
    resolver?.resolve(decision)
    return true
  }

  pending(threadId?: string): ApprovalRequest[] {
    return [...this.approvals.values()].filter(
      (approval) =>
        approval.status === 'pending' && (!threadId || approval.threadId === threadId)
    )
  }

  get(approvalId: string): ApprovalRequest | undefined {
    return this.approvals.get(approvalId)
  }

  /** Used by tests to simulate an external decision and tear down the promise. */
  resolve(approvalId: string, decision: 'allow' | 'deny', reason?: string): boolean {
    return this.decide(approvalId, decision, reason)
  }

  /**
   * Reject all pending approvals and clear timers. Call this on startup
   * to drain any state left over from a previous process, or during
   * graceful shutdown.
   */
  drainAllPending(reason = 'approval drained'): void {
    for (const approvalId of [...this.approvals.keys()]) {
      this.expire(approvalId, reason)
    }
  }

  private expire(approvalId: string, reason = 'approval expired'): void {
    const approval = this.approvals.get(approvalId)
    if (!approval) return
    this.cleanupEntry(approvalId)
    const resolver = this.resolvers.get(approvalId)
    this.resolvers.delete(approvalId)
    resolver?.reject(new Error(`${reason}: ${approvalId}`))
  }

  private cleanupEntry(approvalId: string): void {
    this.approvals.delete(approvalId)
    const timer = this.timers.get(approvalId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(approvalId)
    }
  }
}
