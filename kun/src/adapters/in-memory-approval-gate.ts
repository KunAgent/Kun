import type { ApprovalGate } from '../ports/approval-gate.js'
import type { ApprovalRequest, ApprovalResolution } from '../domain/approval.js'
import { expireApprovalRequest, resolveApprovalRequest, manualApprovalResolution } from '../domain/approval.js'
import { approvalChoiceIsValid, type ApprovalChoice } from '../contracts/approval-choice.js'

type PendingResolver = {
  resolve: (resolution: ApprovalResolution) => void
  reject: (error: Error) => void
}

type ReservedDecision = {
  decision: 'allow' | 'deny'
  reason?: string
  choice?: ApprovalChoice
}

/**
 * In-memory approval gate. The HTTP layer posts decisions into
 * `decide`; the loop awaits the `request` promise to learn whether
 * the user allowed or denied the call.
 */
export class InMemoryApprovalGate implements ApprovalGate {
  private readonly resolvedCapacity: number
  private readonly approvals = new Map<string, ApprovalRequest>()
  private readonly resolvers = new Map<string, PendingResolver>()
  private readonly reservations = new Map<string, ReservedDecision>()
  private readonly deferredExpirations = new Map<string, string | undefined>()

  constructor(options: { resolvedCapacity?: number } = {}) {
    this.resolvedCapacity = Math.max(1, Math.floor(options.resolvedCapacity ?? 1_024))
  }

  request(approval: ApprovalRequest): Promise<'allow' | 'deny'> {
    return this.requestResolution(approval).then((resolution) => resolution.decision)
  }

  requestResolution(approval: ApprovalRequest): Promise<ApprovalResolution> {
    if (this.approvals.has(approval.id)) {
      throw new Error(`duplicate approval id: ${approval.id}`)
    }
    this.approvals.set(approval.id, approval)
    return new Promise<ApprovalResolution>((resolve, reject) => {
      this.resolvers.set(approval.id, { resolve, reject })
    })
  }

  decide(approvalId: string, decision: 'allow' | 'deny', reason?: string, choice?: ApprovalChoice): boolean {
    if (!this.reserveDecision(approvalId, decision, reason, choice)) return false
    return this.commitDecision(approvalId)
  }

  reserveDecision(approvalId: string, decision: 'allow' | 'deny', reason?: string, choice?: ApprovalChoice): boolean {
    const approval = this.approvals.get(approvalId)
    if (!approval || approval.status !== 'pending' || this.reservations.has(approvalId)) {
      return false
    }
    if (!approvalChoiceIsValid(approval.action?.permissionOptions, decision, choice)) return false
    this.reservations.set(approvalId, { decision, ...(reason ? { reason } : {}), ...(choice ? { choice } : {}) })
    return true
  }

  commitDecision(approvalId: string): boolean {
    const approval = this.approvals.get(approvalId)
    const reserved = this.reservations.get(approvalId)
    if (!approval || approval.status !== 'pending' || !reserved) return false
    const resolved = { ...resolveApprovalRequest(approval, reserved.decision, reserved.reason), ...(reserved.choice ? { choice: reserved.choice } : {}) }
    this.approvals.delete(approvalId)
    this.approvals.set(approvalId, resolved)
    this.reservations.delete(approvalId)
    this.deferredExpirations.delete(approvalId)
    const resolver = this.resolvers.get(approvalId)
    this.resolvers.delete(approvalId)
    resolver?.resolve(manualApprovalResolution(reserved.decision, reserved.reason, reserved.choice))
    this.trimResolved()
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

  expire(approvalId: string, reason = 'turn cancelled'): boolean {
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
    this.approvals.delete(approvalId)
    this.approvals.set(approvalId, expireApprovalRequest(approval, reason))
    const resolver = this.resolvers.get(approvalId)
    this.resolvers.delete(approvalId)
    resolver?.resolve(manualApprovalResolution('deny', reason))
    this.trimResolved()
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

  private trimResolved(): void {
    let resolved = [...this.approvals.values()].filter((approval) => approval.status !== 'pending').length
    if (resolved <= this.resolvedCapacity) return
    for (const [id, approval] of this.approvals) {
      if (approval.status === 'pending') continue
      this.approvals.delete(id)
      this.resolvers.delete(id)
      this.reservations.delete(id)
      this.deferredExpirations.delete(id)
      resolved -= 1
      if (resolved <= this.resolvedCapacity) return
    }
  }
}
