import type { TurnItem } from '../contracts/items.js'
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
import { sessionEventExists } from '../adapters/session-event-query.js'

export type InteractiveToolBridgeDeps = {
  approvalGate: ApprovalGate
  userInputGate: UserInputGate
  events: RuntimeEventRecorder
  turns: TurnService
  sessionStore: SessionStore
  nowIso: () => string
  approvalReview?: ApprovalReviewPort
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
    if (
      input.approvalPolicy === 'auto' &&
      input.sandboxMode === 'danger-full-access'
    ) {
      return { decision: 'allow', reviewer: 'user' }
    }
    if (input.approvalReviewer === 'agent') {
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
    })
  }

  async awaitUserInput(input: AwaitToolUserInputInput): Promise<UserInputResolution> {
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
    try {
      await this.deps.turns.applyItem(input.threadId, item)
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
    } finally {
      disarmTimeout()
    }
    await this.deps.turns.updateItem(input.threadId, item.id, {
      status: resolution.status,
      finishedAt: this.deps.nowIso(),
      ...(resolution.status === 'submitted' ? { answers: resolution.answers } : {})
    } as Partial<TurnItem>)
    const alreadyRecorded = await sessionEventExists(
      this.deps.sessionStore,
      input.threadId,
      (event) => event.kind === 'user_input_resolved' && event.inputId === input.input.id
    )
    if (!alreadyRecorded) {
      await this.deps.events.record({
        kind: 'user_input_resolved',
        threadId: input.threadId,
        turnId: input.turnId,
        itemId: item.id,
        inputId: input.input.id,
        status: resolution.status,
        prompt: input.input.prompt,
        questions: input.input.questions,
        ...(resolution.status === 'submitted' ? { answers: resolution.answers } : {})
      })
    }
    return resolution
  }
}
