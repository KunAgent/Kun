/**
 * `HarnessTurnSink` implementation bound to a Kun turn: protocol
 * drafts go through the shared draft emitter (the same emitter ACP uses —
 * it is already transport-agnostic), approvals resolve through the delegated
 * approval pipeline, user-input requests route into the `UserInputGate`.
 */
import type { ApprovalActionEnvelope } from '../contracts/approvals.js'
import { ApprovalActionEnvelopeSchema } from '../contracts/approvals.js'
import type { ApprovalRequest } from '../domain/approval.js'
import {
  createApprovalActionEnvelope,
  createApprovalRequest,
  safeApprovalActionSummary
} from '../domain/approval.js'
import type { ToolEffects } from '../ports/tool-host.js'
import { AcpDraftEmitter } from '../runtime/acp/acp-turn-emitter.js'
import { harnessTurnTiming } from '../runtime/harness-turn-timing.js'
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
  workspace: string
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

const NESTED_TARGET_KEYS = ['command', 'cmd', 'path', 'file_path', 'filepath', 'cwd'] as const

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function approvalToolKind(
  kind: HarnessApprovalRequest['kind']
): 'command_execution' | 'file_change' | 'tool_call' | undefined {
  if (kind === 'command') return 'command_execution'
  if (kind === 'file-change') return 'file_change'
  if (kind === 'tool') return 'tool_call'
  return undefined
}

function approvalEffects(kind: HarnessApprovalRequest['kind']): ToolEffects {
  switch (kind) {
    case 'command':
      return { network: true, externalWrite: true, processExecution: true, guiAutomation: false }
    case 'file-change':
      return { network: false, externalWrite: true, processExecution: false, guiAutomation: false }
    case 'permissions':
    case 'tool':
    case 'other':
    default:
      return { network: true, externalWrite: true, processExecution: false, guiAutomation: false }
  }
}

function prepareApprovalArguments(detail: Record<string, unknown>): {
  arguments: Record<string, unknown>
  cwd?: string
  exactFileTargets?: string[]
} {
  const args: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'string' && !value.trim()) continue
    args[key] = value
  }
  if (isPlainRecord(detail.input)) {
    for (const key of NESTED_TARGET_KEYS) {
      if (args[key] !== undefined && args[key] !== null) continue
      const nested = detail.input[key]
      if (typeof nested === 'string' && nested.trim()) args[key] = nested
    }
  }
  const cwd = typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : undefined
  const exactFileTargets =
    typeof detail.grantRoot === 'string' && detail.grantRoot.trim()
      ? [detail.grantRoot.trim()]
      : undefined
  return {
    arguments: args,
    ...(cwd ? { cwd } : {}),
    ...(exactFileTargets ? { exactFileTargets } : {})
  }
}

export class KunTimelineTurnSink implements HarnessTurnSink {
  private pending: Promise<void> = Promise.resolve()
  private failed = false
  private failure: unknown
  constructor(private readonly deps: KunTimelineTurnSinkDeps) {}

  emit(drafts: Parameters<AcpDraftEmitter['emitAll']>[0]): Promise<void> {
    // Sampled on arrival: the emitter queue below delays persistence.
    harnessTurnTiming(this.deps.threadId, this.deps.turnId).observe(drafts)
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
    const toolName = APPROVAL_TOOL_NAMES[request.kind] ?? 'harness_action'
    const toolKind = approvalToolKind(request.kind)
    const prepared = prepareApprovalArguments(request.detail ?? {})
    const workspace = this.deps.workspace.trim()
    let action: ApprovalActionEnvelope
    try {
      if (!workspace) throw new Error('approval workspace is empty')
      action = ApprovalActionEnvelopeSchema.parse(
        createApprovalActionEnvelope({
          toolName,
          providerKind: 'delegation',
          ...(toolKind ? { toolKind } : {}),
          effects: approvalEffects(request.kind),
          arguments: prepared.arguments,
          workspace,
          ...(prepared.cwd ? { cwd: prepared.cwd } : {}),
          ...(prepared.exactFileTargets ? { exactFileTargets: prepared.exactFileTargets } : {}),
          reason: request.summary,
          requiresUserDecision: request.risky === true
        })
      )
    } catch (error) {
      this.deps.diagnostic?.(
        `approval request failed closed: ${error instanceof Error ? error.message : String(error)}`
      )
      return { decision: 'decline' }
    }
    const approval: ApprovalRequest = createApprovalRequest({
      id: this.deps.ids.next('approval'),
      threadId: this.deps.threadId,
      turnId: this.deps.turnId,
      toolName,
      summary: safeApprovalActionSummary(action),
      action
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
