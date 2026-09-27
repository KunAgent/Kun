import type { ApprovalRequest, ApprovalResolution } from '../domain/approval.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../ports/approval-review.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { ActingTurnModelRoute } from '../contracts/turns.js'
import {
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'

export type DelegatedApprovalDeps = {
  approvalGate?: ApprovalGate
  approvalReview?: ApprovalReviewPort
  events: RuntimeEventRecorder
}

/**
 * The shared approval pipeline for delegated runtimes (policy → agent
 * reviewer → user gate). Extracted from the Agent SDK runtime's per-turn
 * closure so ACP-mediated approvals resolve through the identical semantics:
 * `requiresUserDecision`/`reviewerRequirement: 'user'` envelopes stay
 * user-only, agent review fails closed without the service, and aborting the
 * turn expires the pending gate entry.
 */
export function makeDelegatedAwaitApproval(
  deps: DelegatedApprovalDeps,
  input: {
    approvalPolicy: ApprovalPolicy
    sandboxMode: SandboxMode | undefined
    approvalReviewer: ApprovalReviewer
    actingModelRoute: ActingTurnModelRoute
    /** Bounded excerpt of the initiating user's intent for review context. */
    intent: string
    signal: AbortSignal
  }
): (approval: ApprovalRequest) => Promise<'allow' | 'deny' | ApprovalResolution> {
  const { approvalPolicy, sandboxMode, approvalReviewer, actingModelRoute, intent, signal } = input
  return async (approval) => {
    const requiresUserDecision =
      approval.action?.requiresUserDecision === true ||
      approval.action?.reviewerRequirement === 'user'
    if (!requiresUserDecision && approvalPolicy === 'auto' && sandboxMode === 'danger-full-access') {
      return 'allow'
    }
    if (approvalReviewer === 'agent' && !requiresUserDecision) {
      if (!deps.approvalReview) {
        return {
          decision: 'deny',
          reviewer: 'agent',
          reason: 'Automatic approval review is unavailable.',
          reviewStatus: 'failed-closed'
        }
      }
      return deps.approvalReview.review({
        approval,
        route: actingModelRoute,
        intent,
        signal
      })
    }
    const gate = deps.approvalGate
    if (approvalPolicy === 'never' || !gate) return 'deny'
    const pending = gate.request(approval)

    // Arm cancellation before publishing approval_requested. The recorder may
    // block on durable storage or synchronous observers, but a cancelled turn
    // must still stop waiting immediately.
    let resolveRequested!: () => void
    let rejectRequested!: (reason: unknown) => void
    const requested = new Promise<void>((resolve, reject) => {
      resolveRequested = resolve
      rejectRequested = reject
    })

    return new Promise<'allow' | 'deny'>((resolve, reject) => {
      let settled = false
      let expiredResolutionScheduled = false
      const cleanup = (): void => signal.removeEventListener('abort', onAbort)
      const recordExpiredAfterRequest = (): void => {
        if (expiredResolutionScheduled) return
        expiredResolutionScheduled = true
        // Preserve the observable event order and consume every background
        // promise: requested must be durable before its expired resolution.
        void requested.then(async () => {
          await pending
          const current = gate.get(approval.id)
          if (current?.status !== 'expired') return
          await deps.events.record({
            kind: 'approval_resolved',
            threadId: approval.threadId,
            turnId: approval.turnId,
            approvalId: approval.id,
            toolName: approval.toolName,
            status: 'expired',
            approvalReviewer: 'user',
            summary: approval.summary,
            ...(approval.action ? { action: approval.action } : {}),
            ...(current.reason ? { reason: current.reason } : {})
          })
        }).catch(() => undefined)
      }
      const expirePending = (reason: string): void => {
        // InMemoryApprovalGate resolves an expiration as deny. When an HTTP
        // decision is reserved, expiration is deferred until commit/rollback;
        // the status check above prevents a false expired event if commit wins.
        if (gate.expire(approval.id, reason)) recordExpiredAfterRequest()
      }
      const onAbort = (): void => {
        if (settled) return
        settled = true
        cleanup()
        expirePending('turn aborted while awaiting approval')
        void pending.catch(() => undefined)
        resolve('deny')
      }

      signal.addEventListener('abort', onAbort, { once: true })

      try {
        const recording = deps.events.record({
          kind: 'approval_requested',
          threadId: approval.threadId,
          turnId: approval.turnId,
          approvalId: approval.id,
          toolName: approval.toolName,
          status: 'pending',
          approvalPolicy,
          approvalReviewer: 'user',
          sandboxMode: sandboxMode ?? DEFAULT_SANDBOX_MODE,
          summary: approval.summary,
          ...(approval.action ? { action: approval.action } : {})
        })
        // Attach both handlers immediately so a recorder rejection cannot
        // surface as unhandled while abort is winning the race.
        void recording.then(resolveRequested, rejectRequested).catch(rejectRequested)
      } catch (error) {
        rejectRequested(error)
      }

      if (signal.aborted) {
        onAbort()
        return
      }

      requested.then(
        () => {
          if (settled) return
          pending.then(
            (decision) => {
              if (settled) return
              settled = true
              cleanup()
              resolve(decision)
            },
            (error) => {
              if (settled) return
              settled = true
              cleanup()
              reject(error)
            }
          )
        },
        (error) => {
          if (settled) return
          settled = true
          cleanup()
          gate.expire(approval.id, 'failed to publish approval request')
          void pending.catch(() => undefined)
          reject(error)
        }
      )
    })
  }
}
