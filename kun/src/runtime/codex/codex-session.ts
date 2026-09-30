/**
 * CodexSession (P6-05): one Codex app-server thread bound to a Kun turn flow.
 * Owns the per-turn notification subscription, approval/user-input routing
 * through `HarnessTurnSink`, and turn completion via `turn/completed` —
 * worker self-reports never end a turn.
 */
import type {
  HarnessSession,
  HarnessSessionStartInput,
  HarnessTurnInput,
  HarnessTurnResult,
  HarnessTurnSink
} from '../../session/harness-session.js'
import { HarnessTransportError } from '../../session/harness-session.js'
import type { CodexClient } from './codex-client.js'
import { CodexEventMapper } from './codex-event-mapper.js'
import {
  CODEX_NOTIFICATIONS,
  CODEX_SERVER_REQUESTS,
  CodexCommandExecutionApprovalParamsSchema,
  CodexFileChangeApprovalParamsSchema,
  CodexPermissionsApprovalParamsSchema,
  CodexToolRequestUserInputParamsSchema,
  type CodexSandboxPolicy,
  type CodexToolRequestUserInputResponse,
  type CodexTurn,
  type CodexUserInput
} from './codex-protocol.js'

/** Inbound server request routed by `${codexThreadId}:${codexTurnId}`. */
export type CodexTurnRequestHandler = (
  method: string,
  params: unknown
) => Promise<unknown> | unknown

/** Agent-side request bus shared by all sessions on one process. */
export type CodexRequestRouter = {
  register(key: string, handler: CodexTurnRequestHandler): () => void
}

export class CodexSession implements HarnessSession {
  readonly providerSessionId: string
  readonly preparation: HarnessSessionStartInput['preparation']
  readonly replayedHistory: boolean

  private readonly client: CodexClient
  private readonly input: HarnessSessionStartInput
  private readonly router: CodexRequestRouter
  private readonly disposers: (() => void)[] = []
  private activeCodexTurnId: string | undefined
  private detached = false

  constructor(
    client: CodexClient,
    codexThreadId: string,
    input: HarnessSessionStartInput,
    router: CodexRequestRouter
  ) {
    this.client = client
    this.providerSessionId = codexThreadId
    this.input = input
    this.preparation = input.preparation
    this.replayedHistory = !input.preparation.resumed
    this.router = router
  }

  async runTurn(
    input: HarnessTurnInput,
    sink: HarnessTurnSink,
    signal: AbortSignal
  ): Promise<HarnessTurnResult> {
    const mapper = new CodexEventMapper({
      threadId: this.input.threadId,
      turnId: this.input.turnId,
      codexThreadId: this.providerSessionId,
      model: input.model
    })

    // Notifications are filtered by codex threadId inside the mapper.
    const unsubscribe = this.subscribeNotifications(mapper, sink)
    const turnDone = this.waitForTurnCompletion(sink)
    this.disposers.push(unsubscribe)

    const wireInput = toCodexUserInput(input)
    let turn: CodexTurn
    try {
      turn = await this.client.turnStart({
        threadId: this.providerSessionId,
        input: wireInput,
        ...(input.model ? { model: input.model } : {}),
        ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}),
        cwd: input.workspacePath,
        approvalPolicy: 'untrusted', // every request reaches Kun's gate
        sandboxPolicy: toCodexSandboxPolicy(
          input.sandboxMode,
          input.workspacePath
        ),
        clientUserMessageId: this.input.turnId
      })
    } catch (error) {
      unsubscribe()
      if (signal.aborted) return { status: 'cancelled' }
      throw error
    }
    this.activeCodexTurnId = turn.id

    const onAbort = (): void => {
      void this.interrupt().catch((error) =>
        sink.diagnostic(
          `turn/interrupt failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      )
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })

    try {
      const result = await turnDone
      return result
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  /** Codex `turn/interrupt`; resolves after the request is acked. */
  async interrupt(): Promise<void> {
    const turnId = this.activeCodexTurnId
    if (!turnId) return
    await this.client.turnInterrupt({
      threadId: this.providerSessionId,
      turnId
    })
  }

  /**
   * Mid-turn user message (`turn/steer`). The shared runtime does not yet
   * deliver mid-turn input to sessions; this is ready for when it does.
   */
  async steer(text: string): Promise<void> {
    const turnId = this.activeCodexTurnId
    if (!turnId) {
      throw new HarnessTransportError(
        'harness_not_ready',
        'no active codex turn to steer'
      )
    }
    await this.client.turnSteer({
      threadId: this.providerSessionId,
      expectedTurnId: turnId,
      input: [{ type: 'text', text }]
    })
  }

  detach(): void {
    if (this.detached) return
    this.detached = true
    for (const dispose of this.disposers.splice(0)) dispose()
  }

  // -- internal ------------------------------------------------------------------

  private subscribeNotifications(
    mapper: CodexEventMapper,
    sink: HarnessTurnSink
  ): () => void {
    const unsubs: (() => void)[] = []
    const subscribe = (method: string): void => {
      unsubs.push(
        this.client.onNotification(method, (_m, params) => {
          const drafts = mapper.mapNotification(method, params)
          if (drafts.length) void sink.emit(drafts)
        })
      )
    }
    for (const method of [
      CODEX_NOTIFICATIONS.agentMessageDelta,
      CODEX_NOTIFICATIONS.reasoningTextDelta,
      CODEX_NOTIFICATIONS.reasoningSummaryTextDelta,
      CODEX_NOTIFICATIONS.planDelta,
      CODEX_NOTIFICATIONS.itemStarted,
      CODEX_NOTIFICATIONS.itemCompleted,
      CODEX_NOTIFICATIONS.turnPlanUpdated,
      CODEX_NOTIFICATIONS.threadTokenUsageUpdated,
      CODEX_NOTIFICATIONS.turnDiffUpdated
    ]) {
      subscribe(method)
    }
    unsubs.push(
      this.client.onNotification(
        CODEX_NOTIFICATIONS.error,
        (_m, params) => {
          const p = params as
            | { willRetry?: boolean; error?: { message?: string } }
            | undefined
          if (p?.willRetry) {
            sink.diagnostic(
              `codex turn error (retrying): ${p.error?.message ?? 'unknown'}`
            )
            return
          }
          void sink.emit([
            {
              kind: 'error',
              threadId: this.input.threadId,
              turnId: this.input.turnId,
              message: p?.error?.message ?? 'codex turn error',
              code: 'codex_turn_error'
            }
          ])
        }
      ),
      this.client.onNotification(
        CODEX_NOTIFICATIONS.warning,
        (_m, params) => {
          const message = (params as { message?: string })?.message
          sink.diagnostic(`codex warning: ${message ?? 'unknown'}`)
        }
      )
    )
    return () => unsubs.forEach((dispose) => dispose())
  }

  /**
   * Resolves when `turn/completed` for the active codex turn arrives, or when
   * the turn-start ack carries a terminal status already.
   */
  private async waitForTurnCompletion(
    sink: HarnessTurnSink
  ): Promise<HarnessTurnResult> {
    return new Promise<HarnessTurnResult>((resolve) => {
      let settled = false
      let disposeRequest = (): void => {}
      let unsubscribe = (): void => {}
      const finish = (result: HarnessTurnResult): void => {
        if (settled) return
        settled = true
        disposeRequest()
        unsubscribe()
        resolve(result)
      }
      unsubscribe = this.client.onNotification(
        CODEX_NOTIFICATIONS.turnCompleted,
        (_m, params) => {
          const p = params as { threadId?: string; turn?: CodexTurn }
          if (p?.threadId !== this.providerSessionId) return
          const turn = p.turn
          if (!turn) return
          if (
            this.activeCodexTurnId &&
            turn.id !== this.activeCodexTurnId
          ) {
            return
          }
          finish(turnStatusToResult(turn))
        }
      )
      disposeRequest = this.router.register(
        `${this.providerSessionId}:*`,
        async (method, params) =>
          this.handleServerRequest(method, params, sink)
      )
      this.disposers.push(unsubscribe, disposeRequest)
      // The process dying mid-turn means no turn/completed is coming; fail
      // the wait instead of hanging on a dead transport.
      void this.client.process.exit.then((info) => {
        finish({
          status: 'failed',
          code: 'harness_crashed',
          message:
            `codex app-server exited (code ${info.code ?? 'null'}, ` +
            `signal ${info.signal ?? 'null'})`
        })
      })
    })
  }

  private async handleServerRequest(
    method: string,
    params: unknown,
    sink: HarnessTurnSink
  ): Promise<unknown> {
    switch (method) {
      case CODEX_SERVER_REQUESTS.commandExecutionApproval: {
        const p = CodexCommandExecutionApprovalParamsSchema.parse(params)
        const response = await sink.requestApproval({
          kind: 'command',
          summary: p.command ?? p.reason ?? 'command execution',
          detail: {
            command: p.command,
            cwd: p.cwd,
            reason: p.reason,
            commandActions: p.commandActions
          },
          risky: p.networkApprovalContext != null
        })
        return {
          decision: approvalDecisionForCommand(response.decision)
        }
      }
      case CODEX_SERVER_REQUESTS.fileChangeApproval: {
        const p = CodexFileChangeApprovalParamsSchema.parse(params)
        const response = await sink.requestApproval({
          kind: 'file-change',
          summary: p.reason ?? 'file changes',
          detail: { grantRoot: p.grantRoot }
        })
        return { decision: response.decision === 'accept' ? 'accept' : 'decline' }
      }
      case CODEX_SERVER_REQUESTS.permissionsApproval: {
        const p = CodexPermissionsApprovalParamsSchema.parse(params)
        const response = await sink.requestApproval({
          kind: 'permissions',
          summary: p.reason ?? 'permission escalation',
          detail: { permissions: p.permissions, cwd: p.cwd },
          risky: true
        })
        return {
          decision: response.decision === 'accept' ? 'accept' : 'decline'
        }
      }
      case CODEX_SERVER_REQUESTS.toolRequestUserInput: {
        const p = CodexToolRequestUserInputParamsSchema.parse(params)
        const response = await sink.requestUserInput({
          kind: 'other',
          prompt: p.questions.map((q) => q.question).join('\n'),
          questions: p.questions.map((q) => ({
            header: q.header,
            id: q.id,
            question: q.question,
            options: q.options ?? undefined
          }))
        })
        if (response.cancelled) {
          return { answers: {} } satisfies CodexToolRequestUserInputResponse
        }
        const answers: CodexToolRequestUserInputResponse['answers'] = {}
        for (const question of p.questions) {
          const value = response.answers?.[question.id]
          answers[question.id] = {
            answers: Array.isArray(value)
              ? value.map((v) => String(v))
              : value == null
                ? []
                : [String(value)]
          }
        }
        return { answers } satisfies CodexToolRequestUserInputResponse
      }
      default:
        throw new HarnessTransportError(
          'harness_protocol_error',
          `unsupported codex server request ${method}`
        )
    }
  }
}

// ---- helpers -------------------------------------------------------------------

function turnStatusToResult(turn: CodexTurn): HarnessTurnResult {
  switch (turn.status) {
    case 'completed':
      return { status: 'completed' }
    case 'interrupted':
      return { status: 'cancelled' }
    case 'failed':
      return {
        status: 'failed',
        code: 'agent_error',
        message: turn.error?.message ?? 'codex turn failed'
      }
    default:
      return { status: 'failed', code: 'agent_error', message: `unexpected turn status ${turn.status}` }
  }
}

function approvalDecisionForCommand(
  decision: 'accept' | 'accept-session' | 'decline' | 'cancel'
): string {
  switch (decision) {
    case 'accept':
      return 'accept'
    case 'accept-session':
      return 'acceptForSession'
    case 'cancel':
      return 'cancel'
    default:
      return 'decline'
  }
}

function toCodexSandboxPolicy(
  sandboxMode: string | undefined,
  workspacePath: string
): CodexSandboxPolicy | undefined {
  switch (sandboxMode) {
    case 'read-only':
      return { type: 'readOnly' }
    case 'danger-full-access':
      return { type: 'dangerFullAccess' }
    case 'external-sandbox':
      return { type: 'externalSandbox' }
    case 'workspace-write':
      return { type: 'workspaceWrite', writableRoots: [workspacePath] }
    default:
      return undefined
  }
}

function toCodexUserInput(input: HarnessTurnInput): CodexUserInput[] {
  const text = [
    ...input.instructionBlocks,
    input.historyTranscript ?? '',
    input.handoffBrief ?? '',
    input.userText,
    input.clientSurfaceInstruction ?? ''
  ]
    .filter((s) => s && s.trim().length > 0)
    .join('\n\n')
  const out: CodexUserInput[] = [{ type: 'text', text }]
  for (const attachment of input.attachmentPaths) {
    out.push({ type: 'localImage', path: attachment })
  }
  return out
}
