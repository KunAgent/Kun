import { makeUserInputItem } from '../domain/item.js'
import type { ApprovalRequest, ApprovalResolution } from '../domain/approval.js'
import type { ApprovalGate } from '../ports/approval-gate.js'
import type { ApprovalReviewPort } from '../ports/approval-review.js'
import type { SessionStore } from '../ports/session-store.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type {
  UserInputGate,
  UserInputResolution,
  UserInputRequest
} from '../ports/user-input-gate.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import {
  armUserInputTimeout,
  awaitAbortableGate,
  userInputRequestWithDeadline
} from '../services/interactive-gate.js'
import { settleUserInputResolution } from '../services/user-input-settlement.js'

export type InteractiveToolBridgeDeps = {
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  events: RuntimeEventRecorder
  turns: TurnService
  sessionStore: SessionStore
  nowIso: () => string
  approvalReview?: ApprovalReviewPort
  /** Park active-goal compute accounting while waiting on an actual user. */
  pauseForUser?: (threadId: string) => () => void
}

export type AwaitToolApprovalInput = {
  approval: ApprovalRequest
  approvalPolicy: ToolHostContext['approvalPolicy']
  approvalReviewer?: NonNullable<ToolHostContext['approvalReviewer']>
  actingModelRoute?: ToolHostContext['actingModelRoute']
  intent?: string
  sandboxMode: NonNullable<ToolHostContext['sandboxMode']>
  signal: AbortSignal
}

export type AwaitToolUserInputInput = {
  threadId: string
  turnId: string
  input: Omit<UserInputRequest, 'threadId' | 'turnId'>
  signal: AbortSignal
}

/**
 * Owns the interactive portions of native tool execution. It deliberately
 * preserves the different persistence models: approval is event-only, while
 * user input writes both an item and request/resolution events.
 */
export class InteractiveToolBridge {
  constructor(private readonly deps: InteractiveToolBridgeDeps) {}

  async awaitApproval(
    input: AwaitToolApprovalInput
  ): Promise<'allow' | 'deny' | ApprovalResolution> {
    const requiresUserDecision =
      input.approval.action?.requiresUserDecision === true ||
      input.approval.action?.reviewerRequirement === 'user'
    if (
      !requiresUserDecision &&
      input.approvalPolicy === 'auto' &&
      input.sandboxMode === 'danger-full-access'
    ) {
      return { decision: 'allow', reviewer: 'user' }
    }
    if (input.approvalReviewer === 'agent' && !requiresUserDecision) {
      if (!this.deps.approvalReview) {
        return {
          decision: 'deny',
          reviewer: 'agent',
          reason: 'Automatic review is unavailable; the action was denied fail closed.',
          reviewStatus: 'failed-closed'
        }
      }
      return this.deps.approvalReview.review({
        approval: input.approval,
        route: input.actingModelRoute,
        intent: input.intent,
        signal: input.signal
      })
    }
    const pending = this.deps.approvalGate.request(input.approval)
    const resumeTimer = this.deps.pauseForUser?.(input.approval.threadId)
    return new Promise<ApprovalResolution>((resolve, reject) => {
      let settled = false
      let requested!: Promise<unknown>
      const cleanup = (): void => input.signal.removeEventListener('abort', onAbort)
      const recordExpiredAfterRequest = (): void => {
        void requested.then(async () => {
          await pending
          const current = this.deps.approvalGate.get(input.approval.id)
          if (current?.status !== 'expired') return
          await this.deps.events.record({
            kind: 'approval_resolved',
            threadId: input.approval.threadId,
            turnId: input.approval.turnId,
            approvalId: input.approval.id,
            toolName: input.approval.toolName,
            status: 'expired',
            approvalReviewer: 'user',
            summary: input.approval.summary,
            ...(input.approval.action ? { action: input.approval.action } : {}),
            ...(current.reason ? { reason: current.reason } : {})
          })
        }).catch(() => undefined)
      }
      const expirePending = (reason: string): void => {
        if (this.deps.approvalGate.expire(input.approval.id, reason)) {
          recordExpiredAfterRequest()
        }
      }
      const onAbort = (): void => {
        if (settled) return
        settled = true
        cleanup()
        const reason = 'turn aborted while awaiting approval'
        expirePending(reason)
        reject(new Error(reason))
      }

      input.signal.addEventListener('abort', onAbort, { once: true })
      requested = this.deps.events.record({
        kind: 'approval_requested',
        threadId: input.approval.threadId,
        turnId: input.approval.turnId,
        approvalId: input.approval.id,
        toolName: input.approval.toolName,
        status: 'pending',
        approvalPolicy: input.approvalPolicy,
        approvalReviewer: 'user',
        sandboxMode: input.sandboxMode,
        summary: input.approval.summary,
        ...(input.approval.action ? { action: input.approval.action } : {})
      })

      if (input.signal.aborted) {
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
              const resolved = this.deps.approvalGate.get(input.approval.id)
              resolve({
                decision,
                reviewer: 'user',
                ...(resolved?.reason ? { reason: resolved.reason } : {})
              })
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
          this.deps.approvalGate.expire(input.approval.id, 'failed to publish approval request')
          void pending.catch(() => undefined)
          reject(error)
        }
      )
    }).finally(() => resumeTimer?.())
  }

  async awaitUserInput(input: AwaitToolUserInputInput): Promise<UserInputResolution> {
    const resumeTimer = this.deps.pauseForUser?.(input.threadId)
    try { return await this.awaitUserInputWhileParked(input) }
    finally { resumeTimer?.() }
  }

  private async awaitUserInputWhileParked(input: AwaitToolUserInputInput): Promise<UserInputResolution> {
    // Arm before the item/event becomes observable. An SSE subscriber can
    // submit synchronously while processing user_input_requested.
    const request: UserInputRequest = {
      ...input.input,
      threadId: input.threadId,
      turnId: input.turnId
    }
    const pending = this.deps.userInputGate.request(userInputRequestWithDeadline(request))
    const item = makeUserInputItem({
      id: input.input.itemId,
      threadId: input.threadId,
      turnId: input.turnId,
      inputId: input.input.id,
      prompt: input.input.prompt,
      questions: input.input.questions,
      ...(input.input.timeoutSeconds !== undefined
        ? { timeoutSeconds: input.input.timeoutSeconds }
        : {})
    })
    let requestedSeq: number | undefined
    try {
      await this.deps.turns.applyItem(input.threadId, item)
      requestedSeq = (
        await this.deps.events.record({
          kind: 'user_input_requested',
          threadId: input.threadId,
          turnId: input.turnId,
          itemId: item.id,
          inputId: input.input.id,
          status: 'pending',
          prompt: input.input.prompt,
          questions: input.input.questions,
          ...(input.input.timeoutSeconds !== undefined
            ? { timeoutSeconds: input.input.timeoutSeconds }
            : {})
        })
      ).seq
    } catch (error) {
      this.deps.userInputGate.resolve(input.input.id, { status: 'cancelled' })
      void pending.catch(() => undefined)
      throw error
    }

    const disarmTimeout = armUserInputTimeout(
      (resolution) => this.deps.userInputGate.resolve(input.input.id, resolution),
      input.input.id,
      input.input.timeoutSeconds
    )
    let resolution: UserInputResolution
    try {
      resolution = await awaitAbortableGate(
        pending,
        input.signal,
        () => { this.deps.userInputGate.resolve(input.input.id, { status: 'cancelled' }) },
        'cancelled while awaiting user input'
      )
    } catch {
      // The abort callback already resolved the gate as cancelled. Fall
      // through so the terminal item state and resolution event still land
      // instead of leaving a pending item behind an aborted turn.
      resolution = { status: 'cancelled' }
    } finally {
      disarmTimeout()
    }
    await settleUserInputResolution({
      turns: this.deps.turns,
      events: this.deps.events,
      sessionStore: this.deps.sessionStore,
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: item.id,
      inputId: input.input.id,
      prompt: input.input.prompt,
      questions: input.input.questions,
      resolution,
      requestedSeq,
      nowIso: this.deps.nowIso,
      signal: input.signal
    })
    return resolution
  }
}
