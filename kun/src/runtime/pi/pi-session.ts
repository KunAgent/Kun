/**
 * PiSession (P6-09/10): one pi rpc session bound to a Kun turn flow.
 *
 * Pi differs from codex in that ONE spawned process hosts ONE session at a
 * time (cwd and session file are process-bound), so there is no per-turn id
 * routing — events on the channel belong to this session while it holds the
 * pool lease.
 *
 * Turn lifecycle: `prompt` → events → `agent_settled` resolves the turn
 * (`agent_end` is a mid-run boundary). `data.disposition:'handled'` from the
 * prompt response means no run started — resolve immediately.
 *
 * The `kun-pi-bridge` extension surfaces tool-approval asks as
 * `extension_ui_request` records with title 'kun:approval' and a JSON
 * `{toolName, toolCallId, input}` payload; this session answers them via
 * `extension_ui_response` (`value:'allow'|'deny'` or `cancelled`) after Kun's
 * approval gate rules. Other dialog methods map onto requestUserInput.
 */
import type {
  HarnessSession,
  HarnessSessionStartInput,
  HarnessTurnInput,
  HarnessTurnResult,
  HarnessTurnSink
} from '../../session/harness-session.js'
import { HarnessTransportError } from '../../session/harness-session.js'
import type { PiClient } from './pi-client.js'
import { PiEventMapper } from './pi-event-mapper.js'
import {
  escapePiSlashCommand,
  PI_EVENTS,
  type PiAssistantMessage,
  type PiExtensionUiRequest
} from './pi-protocol.js'

/** Title the bridge uses for tool-approval asks (see kun-pi-bridge-source). */
export const KUN_PI_APPROVAL_TITLE = 'kun:approval'

export type PiBridgePermissionMode = 'read-only' | 'ask' | 'auto' | 'bypass'

export class PiSession implements HarnessSession {
  readonly providerSessionId: string
  readonly preparation: HarnessSessionStartInput['preparation']
  readonly replayedHistory: boolean

  private readonly client: PiClient
  private readonly input: HarnessSessionStartInput
  private readonly writePermissionMode:
    | ((mode: PiBridgePermissionMode) => void)
    | undefined
  private readonly disposers: (() => void)[] = []
  private detached = false

  constructor(
    client: PiClient,
    providerSessionId: string,
    input: HarnessSessionStartInput,
    writePermissionMode?: (mode: PiBridgePermissionMode) => void
  ) {
    this.client = client
    this.providerSessionId = providerSessionId
    this.input = input
    this.preparation = input.preparation
    this.replayedHistory = !input.preparation.resumed
    this.writePermissionMode = writePermissionMode
  }

  async runTurn(
    input: HarnessTurnInput,
    sink: HarnessTurnSink,
    signal: AbortSignal
  ): Promise<HarnessTurnResult> {
    // Per-turn permission file write — the bridge re-reads it per tool_call.
    this.writePermissionMode?.(piBridgeMode(input))

    const mapper = new PiEventMapper({
      threadId: this.input.threadId,
      turnId: this.input.turnId,
      model: input.model
    })

    const unsubs: (() => void)[] = []
    const subscribe = (type: string): void => {
      unsubs.push(
        this.client.onEvent(type, (event) => {
          const drafts = mapper.mapEvent(event)
          if (drafts.length) void sink.emit(drafts)
        })
      )
    }
    for (const type of [
      PI_EVENTS.messageUpdate,
      PI_EVENTS.messageEnd,
      PI_EVENTS.toolExecutionStart,
      PI_EVENTS.toolExecutionEnd
    ]) {
      subscribe(type)
    }
    unsubs.push(
      this.client.onEvent(PI_EVENTS.extensionUiRequest, (event) =>
        this.handleExtensionUi(event as PiExtensionUiRequest, sink)
      )
    )
    this.disposers.push(() => unsubs.forEach((u) => u()))

    const settled = this.waitForSettled()
    this.disposers.push(settled.dispose)

    const onAbort = (): void => {
      void this.interrupt().catch((error) =>
        sink.diagnostic(
          `pi abort failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      )
    }
    if (signal.aborted) {
      settled.dispose()
      return { status: 'cancelled' }
    }
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      const promptText = buildPromptText(input)
      const disposition = await this.client.prompt(
        escapePiSlashCommand(promptText),
        input.images
      )
      // 'handled' means an input handler consumed the prompt — no agent run,
      // no agent_settled; the turn is already complete.
      if (disposition === 'handled') {
        return { status: 'completed' }
      }
      return await settled.promise
    } catch (error) {
      if (signal.aborted) return { status: 'cancelled' }
      if (error instanceof HarnessTransportError) {
        return { status: 'failed', code: error.code, message: error.message }
      }
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  /** Pi `abort`; resolves after the request is acked (session goes idle). */
  async interrupt(): Promise<void> {
    await this.client.abort()
  }

  /** Mid-turn user message (`steer` — delivered after the current tool batch). */
  async steer(text: string): Promise<void> {
    await this.client.steer(escapePiSlashCommand(text))
  }

  detach(): void {
    if (this.detached) return
    this.detached = true
    for (const dispose of this.disposers.splice(0)) dispose()
  }

  // -- turn boundary --------------------------------------------------------------

  /**
   * Resolves on `agent_settled`. `message_end` with `stopReason:'error'`
   * records the provider failure so the settled turn reports it honestly.
   */
  private waitForSettled(): {
    promise: Promise<HarnessTurnResult>
    dispose: () => void
  } {
    let lastError: string | undefined
    let resolve!: (result: HarnessTurnResult) => void
    const promise = new Promise<HarnessTurnResult>((r) => {
      resolve = r
    })
    const unsubs: (() => void)[] = []
    const dispose = (): void => unsubs.forEach((u) => u())
    const finish = (result: HarnessTurnResult): void => {
      dispose()
      resolve(result)
    }
    unsubs.push(
      this.client.onEvent(PI_EVENTS.messageEnd, (event) => {
        const message = event.message as PiAssistantMessage | undefined
        if (message?.stopReason === 'error') {
          lastError =
            message.errorMessage?.trim() || 'pi agent request failed'
        }
      }),
      this.client.onEvent(PI_EVENTS.agentSettled, () => {
        finish(
          lastError
            ? { status: 'failed', code: 'agent_error', message: lastError }
            : { status: 'completed' }
        )
      })
    )
    // Process death mid-turn means no agent_settled is coming.
    void this.client.process.exit.then((info) => {
      finish({
        status: 'failed',
        code: 'harness_crashed',
        message:
          `pi rpc exited (code ${info.code ?? 'null'}, ` +
          `signal ${info.signal ?? 'null'})`
      })
    })
    return { promise, dispose }
  }

  // -- extension UI → Kun gates -------------------------------------------------------

  private handleExtensionUi(
    event: PiExtensionUiRequest,
    sink: HarnessTurnSink
  ): void {
    const id = typeof event.id === 'string' ? event.id : undefined
    const method = typeof event.method === 'string' ? event.method : ''
    // Fire-and-forget records (notify/setStatus/...) carry an id too but no
    // response is expected; surface them as diagnostics only.
    if (method === 'notify' || method === 'setStatus') {
      const message =
        typeof event.message === 'string'
          ? event.message
          : typeof event.statusText === 'string'
            ? event.statusText
            : ''
      if (message) sink.diagnostic(`pi extension ${method}: ${message}`)
      return
    }
    if (!id) return

    if (method === 'input' && event.title === KUN_PI_APPROVAL_TITLE) {
      void this.routeApproval(id, event, sink)
      return
    }
    // Any other dialog → generic user-input plumbing.
    void this.routeUserInput(id, method, event, sink)
  }

  private async routeApproval(
    id: string,
    event: PiExtensionUiRequest,
    sink: HarnessTurnSink
  ): Promise<void> {
    let toolName = 'tool'
    let toolInput: Record<string, unknown> = {}
    try {
      const payload = JSON.parse(
        typeof event.placeholder === 'string' ? event.placeholder : '{}'
      ) as { toolName?: unknown; toolCallId?: unknown; input?: unknown }
      if (typeof payload.toolName === 'string') toolName = payload.toolName
      if (payload.input && typeof payload.input === 'object') {
        toolInput = payload.input as Record<string, unknown>
      }
    } catch {
      // Malformed bridge payload: fall through and ask with minimal detail.
    }
    try {
      const response = await sink.requestApproval({
        kind: approvalKindForTool(toolName),
        summary: approvalSummary(toolName, toolInput),
        detail: { toolName, input: toolInput },
        risky: toolName === 'bash'
      })
      if (response.decision === 'cancel') {
        await this.client.answerExtensionUi(id, { cancelled: true })
        return
      }
      const value =
        response.decision === 'accept' || response.decision === 'accept-session'
          ? 'allow'
          : 'deny'
      await this.client.answerExtensionUi(id, { value })
    } catch (error) {
      sink.diagnostic(
        `pi approval routing failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
      // Fail closed: nothing sent means pi auto-cancels the dialog on timeout.
    }
  }

  private async routeUserInput(
    id: string,
    method: string,
    event: PiExtensionUiRequest,
    sink: HarnessTurnSink
  ): Promise<void> {
    try {
      const options = Array.isArray(event.options)
        ? event.options
            .filter((o): o is string => typeof o === 'string')
            .map((o) => ({ id: o, label: o }))
        : undefined
      const response = await sink.requestUserInput({
        kind:
          method === 'select'
            ? 'select'
            : method === 'confirm'
              ? 'confirm'
              : method === 'editor'
                ? 'editor'
                : 'input',
        prompt:
          [event.title, event.message]
            .filter((s): s is string => typeof s === 'string' && !!s)
            .join('\n') || 'pi extension request',
        options
      })
      if (response.cancelled) {
        await this.client.answerExtensionUi(id, { cancelled: true })
        return
      }
      const answer = response.answers?.value ?? response.answers?.answer
      if (method === 'confirm') {
        const confirmed =
          answer === true || answer === 'true' || answer === 'yes'
        await this.client.answerExtensionUi(id, { confirmed })
        return
      }
      await this.client.answerExtensionUi(id, {
        value: typeof answer === 'string' ? answer : ''
      })
    } catch (error) {
      sink.diagnostic(
        `pi extension UI routing failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
}

// ---- helpers -------------------------------------------------------------------

function buildPromptText(input: HarnessTurnInput): string {
  return [
    ...input.instructionBlocks,
    input.historyTranscript ?? '',
    input.handoffBrief ?? '',
    input.userText,
    input.clientSurfaceInstruction ?? ''
  ]
    .filter((s) => s && s.trim().length > 0)
    .join('\n\n')
}

function approvalKindForTool(
  toolName: string
): 'command' | 'file-change' | 'tool' | 'other' {
  if (toolName === 'bash') return 'command'
  if (toolName === 'edit' || toolName === 'write') return 'file-change'
  return 'tool'
}

/**
 * Kun permission ceiling → bridge mode. `read-only` sandbox always wins;
 * `approve-for-me` maps to 'auto' (bridge allows, hard blocks still apply).
 */
function piBridgeMode(input: HarnessTurnInput): PiBridgePermissionMode {
  if (input.sandboxMode === 'read-only') return 'read-only'
  switch (input.kunPermissionMode) {
    case 'full-access':
      return 'bypass'
    case 'approve-for-me':
      return 'auto'
    default:
      return 'ask'
  }
}

function approvalSummary(
  toolName: string,
  input: Record<string, unknown>
): string {
  if (toolName === 'bash' && typeof input.command === 'string') {
    return input.command.slice(0, 200)
  }
  const path = typeof input.path === 'string' ? input.path : undefined
  return path ? `${toolName} ${path}` : toolName
}
