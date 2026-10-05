/**
 * `HarnessTurnSink` implementation bound to a Kun turn (P6-02): protocol
 * drafts go through the shared draft emitter (the same emitter ACP uses —
 * it is already transport-agnostic), approvals resolve through the delegated
 * approval pipeline, user-input requests route into the `UserInputGate`.
 */
import type { ApprovalRequest } from '../domain/approval.js'
import { createApprovalRequest } from '../domain/approval.js'
import { AcpDraftEmitter } from '../runtime/acp/acp-turn-emitter.js'
import type { UserInputGate, UserInputQuestion } from '../ports/user-input-gate.js'
import type {
  HarnessApprovalRequest,
  HarnessApprovalResponse,
  HarnessTurnSink,
  HarnessUserInputRequest,
  HarnessUserInputResponse
} from './harness-session.js'

export type KunTimelineTurnSinkDeps = {
  emitter: AcpDraftEmitter
  approve: (approval: ApprovalRequest) => Promise<'allow' | 'deny'>
  userInputGate?: UserInputGate
  threadId: string
  turnId: string
  ids: { next(prefix: string): string }
  diagnostic?: (summary: string) => void
}

const APPROVAL_TOOL_NAMES: Record<HarnessApprovalRequest['kind'], string> = {
  command: 'command_execution',
  'file-change': 'file_change',
  permissions: 'permissions',
  tool: 'tool_call',
  other: 'harness_action'
}

export class KunTimelineTurnSink implements HarnessTurnSink {
  private pending: Promise<void> = Promise.resolve()
  private failed = false
  private failure: unknown
  constructor(private readonly deps: KunTimelineTurnSinkDeps) {}

  emit(drafts: Parameters<AcpDraftEmitter['emitAll']>[0]): Promise<void> {
    const next = this.pending.then(() => {
      if (this.failed) throw this.failure
      return this.deps.emitter.emitAll(drafts)
    })
    // Native transports deliver notifications synchronously. Observe rejected
    // writes here even when their caller cannot await, then fail flush rather
    // than finishing a successful turn with missing output.
    this.pending = next.catch((error) => { this.failed = true; this.failure = error })
    return next
  }

  async flush(): Promise<void> {
    await this.pending
    if (this.failed) throw this.failure
  }

  async requestApproval(
    request: HarnessApprovalRequest
  ): Promise<HarnessApprovalResponse> {
    const approval: ApprovalRequest = createApprovalRequest({
      id: this.deps.ids.next('approval'),
      threadId: this.deps.threadId,
      turnId: this.deps.turnId,
      toolName: APPROVAL_TOOL_NAMES[request.kind] ?? 'harness_action',
      summary: request.summary,
      ...(request.detail ? { action: request.detail as never } : {})
    })
    const decision = await this.deps.approve(approval)
    return { decision: decision === 'allow' ? 'accept' : 'decline' }
  }

  async requestUserInput(
    request: HarnessUserInputRequest
  ): Promise<HarnessUserInputResponse> {
    const gate = this.deps.userInputGate
    if (!gate) return { cancelled: true }
    const questions: UserInputQuestion[] = request.questions?.length
      ? request.questions.map((question) => ({
          header: (question.header ?? request.prompt).slice(0, 120),
          id: question.id,
          question: question.question,
          options:
            question.options?.map((option) => ({
              label: option.label,
              description: option.description ?? ''
            })) ?? []
        }))
      : request.kind === 'select' && request.options?.length
        ? request.options.map((option) => ({
            header: request.prompt.slice(0, 120),
            id: option.id,
            question: option.label,
            options: [
              { label: option.label, description: '' },
              { label: 'Decline', description: '' }
            ]
          }))
        : [
            {
              header: request.prompt.slice(0, 120),
              id: 'answer',
              question: request.prompt,
              options: request.options?.map((option) => ({
                label: option.label,
                description: ''
              })) ?? [{ label: 'Continue', description: '' }]
            }
          ]
    const resolution = await gate.request({
      id: this.deps.ids.next('input'),
      threadId: this.deps.threadId,
      turnId: this.deps.turnId,
      itemId: `item_${this.deps.turnId}_user`,
      prompt: request.prompt,
      questions
    })
    if (resolution.status !== 'submitted') return { cancelled: true }
    const answers: Record<string, unknown> = {}
    for (const answer of resolution.answers) {
      answers[answer.id] = answer.values ?? answer.value ?? answer.label
    }
    return { answers }
  }

  diagnostic(summary: string): void {
    this.deps.diagnostic?.(summary)
  }
}
