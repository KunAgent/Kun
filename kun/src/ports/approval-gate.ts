import type { ApprovalRequest, ApprovalResolution } from '../domain/approval.js'
import type { ApprovalChoice } from '../contracts/approval-choice.js'

/**
 * Port for the approval flow used by tool execution. The local gate
 * is the in-process registry; a remote gate could integrate with an
 * external service. The loop awaits a `decide` resolution before
 * proceeding with a tool call.
 */
export interface ApprovalGate {
  request(approval: ApprovalRequest): Promise<'allow' | 'deny'>
  /** Full immutable outcome; legacy gates may implement only the bare decision API. */
  requestResolution?(approval: ApprovalRequest): Promise<ApprovalResolution>
  decide(approvalId: string, decision: 'allow' | 'deny', reason?: string, choice?: ApprovalChoice): boolean
  /** Reserve a decision while its durable audit event is being committed. */
  reserveDecision(approvalId: string, decision: 'allow' | 'deny', reason?: string, choice?: ApprovalChoice): boolean
  /** Release the waiter only after the reserved audit event is durable. */
  commitDecision(approvalId: string): boolean
  /** Restore a pending approval when audit persistence fails. */
  rollbackDecision(approvalId: string): boolean
  /** Expire a pending decision when its owning turn is cancelled or shuts down. */
  expire(approvalId: string, reason?: string): boolean
  pending(threadId?: string): ApprovalRequest[]
  get(approvalId: string): ApprovalRequest | undefined
}
