import type { ApprovalGate } from '../ports/approval-gate.js'
import type { ApprovalRequest } from '../domain/approval.js'
import { expireApprovalRequest, resolveApprovalRequest } from '../domain/approval.js'

type PendingResolver = {
  resolve: (decision: 'allow' | 'deny') => void
  reject: (error: Error) => void
}

type ReservedDecision = {
  decision: 'allow' | 'deny'
  reason?: string
}

/**
 * In-memory approval gate. The HTTP layer posts decisions into
 * `decide`; the loop awaits the `request` promise to learn whether
 * the user allowed or denied the call.
 */
export class InMemoryApprovalGate implements ApprovalGate {
  private readonly approvals = new Map<string, ApprovalRequest>()
  private readonly resolvers = new Map<string, PendingResolver>()
  private readonly reservations = new Map<string, ReservedDecision>()
  private readonly deferredExpirations = new Map<string, string | undefined>()

  request(approval: ApprovalRequest): Promise<'allow' | 'deny'> {
    if (this.approvals.has(approval.id)) {
      throw new Error(`duplicate approval id: ${approval.id}`)
    }
    this.approvals.set(approval.id, approval)
    return new Promise<'allow' | 'deny'>((resolve, reject) => {
      this.resolvers.set(approval.id, { resolve, reject })
    })
  }

  decide(approvalId: string, decision: 'allow' | 'deny', reason?: string): boolean {
    if (!this.reserveDecision(approvalId, decision, reason)) return false
    return this.commitDecision(approvalId)
  }

  reserveDecision(approvalId: string, decision: 'allow' | 'deny', reason?: string): boolean {
    const approval = this.approvals.get(approvalId)
    if (!approval || approval.status !== 'pending' || this.reservations.has(approvalId)) {
      return false
    }
    this.reservations.set(approvalId, { decision, ...(reason ? { reason } : {}) })
    return true
  }

  commitDecision(approvalId: string): boolean {
    const approval = this.approvals.get(approvalId)
    const reserved = this.reservations.get(approvalId)
    if (!approval || approval.status !== 'pending' || !reserved) return false
    const resolved = resolveApprovalRequest(approval, reserved.decision, reserved.reason)
    this.approvals.set(approvalId, resolved)
    this.reservations.delete(approvalId)
    this.deferredExpirations.delete(approvalId)
    const resolver = this.resolvers.get(approvalId)
    this.resolvers.delete(approvalId)
    resolver?.resolve(reserved.decision)
    return true
  }

  rollbackDecision(approvalId: string): boolean {
    if (!this.reservations.delete(approvalId)) return false
    if (this.deferredExpirations.has(approvalId)) {
      const reason = this.deferredExpirations.get(approvalId)
      this.deferredExpirations.delete(approvalId)
      this.expireNow(approvalId, reason)
    }
    return true
  }

  expire(approvalId: string, reason?: string): boolean {
    const approval = this.approvals.get(approvalId)
    if (!approval || approval.status !== 'pending') return false
    if (this.reservations.has(approvalId)) {
      this.deferredExpirations.set(approvalId, reason)
      return true
    }
    return this.expireNow(approvalId, reason)
  }

  private expireNow(approvalId: string, reason?: string): boolean {
    const approval = this.approvals.get(approvalId)
    if (!approval || approval.status !== 'pending') return false
    this.approvals.set(approvalId, expireApprovalRequest(approval, reason))
    const resolver = this.resolvers.get(approvalId)
    this.resolvers.delete(approvalId)
    resolver?.resolve('deny')
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
}
