import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import type {
  ModelRequestTraceDelegated,
  ModelRequestTraceRecord
} from '../../contracts/model-request-trace.js'
import type { ApprovalPolicy, SandboxMode } from '../../contracts/policy.js'
import {
  startLlmDebugRoundIfEnabled,
  type LlmDebugRound,
  type LlmDebugSink
} from '../../services/llm-debug-recorder.js'
import { bridgedToolModelName, type BridgeableTool } from './sdk-tool-bridge.js'
import { itemOf } from './agent-sdk-runtime-items.js'
import type { SdkRuntimeDeps, SdkTurnContext, TurnStatus } from './agent-sdk-runtime-contracts.js'

type AgentSdkTrace = {
  sink: LlmDebugSink
  round: LlmDebugRound
  record: ModelRequestTraceRecord
  currentText: string
  currentReasoning: string
}

export async function startAgentSdkTrace(
  sink: LlmDebugSink | undefined,
  input: {
    threadId: string
    turnId: string
    provider: string
    model: string
    prompt: string
    systemPrompt: string
    threadPersona?: string
    contextInstructions: readonly string[]
    redactedRequestValues: readonly string[]
    tools: readonly BridgeableTool[]
    images: ReadonlyArray<{ mediaType: string }>
    approvalPolicy: ApprovalPolicy
    sandboxMode?: SandboxMode
    oauthToken?: string
    delegated: ModelRequestTraceDelegated
  }
): Promise<AgentSdkTrace | undefined> {
  if (!sink?.beginSdkInvocation) return undefined
  let round: LlmDebugRound | undefined
  try {
    round = await startLlmDebugRoundIfEnabled(sink, {
      threadId: input.threadId,
      turnId: input.turnId,
      provider: input.provider,
      model: input.model,
      redactedRequestValues: input.redactedRequestValues,
      toolCatalog: input.tools.map((tool) => ({
        name: bridgedToolModelName(tool.name),
        ...(tool.providerId ? { providerId: tool.providerId } : {}),
        ...(tool.providerKind ? { providerKind: tool.providerKind } : {})
      }))
    })
    if (!round) return undefined
    const record = sink.beginSdkInvocation(round, {
      endpointFormat: 'agent-sdk',
      target: 'agent-sdk://local/query',
      bodyText: JSON.stringify({
        model: input.model,
        system: [input.systemPrompt, input.threadPersona ?? ''].filter(Boolean).join('\n'),
        instructions: input.contextInstructions,
        input: input.prompt,
        tools: input.tools.map((tool) => ({
          name: bridgedToolModelName(tool.name),
          description: tool.description,
          input_schema: tool.inputSchema
        })),
        attachments: {
          count: input.images.length,
          images: input.images
        },
        approvalPolicy: input.approvalPolicy,
        ...(input.sandboxMode ? { sandboxMode: input.sandboxMode } : {})
      }),
      ...(input.oauthToken ? { secretValues: [input.oauthToken] } : {}),
      delegated: input.delegated
    })
    return {
      sink,
      round,
      record,
      currentText: '',
      currentReasoning: ''
    }
  } catch {
    if (round) void sink.finish(round).catch(() => undefined)
    warnAgentSdkTraceFailure()
    return undefined
  }
}

export function captureAgentSdkTraceDraft(
  trace: AgentSdkTrace | undefined,
  draft: RuntimeEventDraft
): void {
  if (!trace) return
  try {
    const item = itemOf(draft)
    if (draft.kind === 'assistant_text_delta' && item?.kind === 'assistant_text') {
      trace.currentText += item.text
      trace.sink.captureChunk(trace.round, {
        kind: 'assistant_text_delta',
        text: item.text
      })
      return
    }
    if (
      draft.kind === 'assistant_reasoning_delta' &&
      item?.kind === 'assistant_reasoning'
    ) {
      trace.currentReasoning += item.text
      trace.sink.captureChunk(trace.round, {
        kind: 'assistant_reasoning_delta',
        text: item.text
      })
      return
    }
    if (draft.kind === 'item_created' && item?.kind === 'assistant_text') {
      const missing = item.text.startsWith(trace.currentText)
        ? item.text.slice(trace.currentText.length)
        : trace.currentText === item.text
          ? ''
          : item.text
      if (missing) {
        trace.sink.captureChunk(trace.round, {
          kind: 'assistant_text_delta',
          text: missing
        })
      }
      trace.currentText = ''
      return
    }
    if (draft.kind === 'item_created' && item?.kind === 'assistant_reasoning') {
      const missing = item.text.startsWith(trace.currentReasoning)
        ? item.text.slice(trace.currentReasoning.length)
        : trace.currentReasoning === item.text
          ? ''
          : item.text
      if (missing) {
        trace.sink.captureChunk(trace.round, {
          kind: 'assistant_reasoning_delta',
          text: missing
        })
      }
      trace.currentReasoning = ''
      return
    }
    if (draft.kind === 'item_created' && item?.kind === 'tool_call') {
      trace.sink.captureChunk(trace.round, {
        kind: 'tool_call_complete',
        callId: item.callId,
        toolName: item.toolName,
        arguments: item.arguments
      })
      return
    }
    if (draft.kind === 'tool_call_finished' && item?.kind === 'tool_result') {
      trace.sink.captureToolResult?.(trace.round, {
        callId: item.callId,
        toolName: item.toolName,
        output: traceOutputText(item.output),
        isError: item.isError
      })
      return
    }
    if (draft.kind === 'usage') {
      trace.sink.captureChunk(trace.round, {
        kind: 'usage',
        usage: draft.usage
      })
    }
  } catch {
    warnAgentSdkTraceFailure()
  }
}

export function traceOutputText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export async function finishAgentSdkTrace(
  trace: AgentSdkTrace | undefined,
  result:
    | { kind: 'completed' }
    | { kind: 'failed'; error: unknown }
    | { kind: 'error'; error: unknown }
): Promise<void> {
  if (!trace) return
  try {
    if (result.kind === 'completed') {
      trace.sink.captureChunk(trace.round, { kind: 'completed', stopReason: 'stop' })
    } else {
      trace.sink.captureChunk(trace.round, {
        kind: 'error',
        message: result.error instanceof Error ? result.error.message : String(result.error)
      })
      if (result.kind === 'error') {
        trace.sink.captureTransportError(trace.record, result.error)
      } else {
        trace.sink.captureChunk(trace.round, {
          kind: 'completed',
          stopReason: 'error'
        })
      }
    }
    await trace.sink.finish(trace.round)
  } catch {
    warnAgentSdkTraceFailure()
  }
}

let agentSdkTraceFailureWarned = false

export function warnAgentSdkTraceFailure(): void {
  if (agentSdkTraceFailureWarned) return
  agentSdkTraceFailureWarned = true
  console.warn(
    '[kun:agent-sdk] model request observability capture failed; the SDK turn continues unchanged'
  )
}

export function estimatedTokens(text: string): number {
  return text ? Math.ceil(Buffer.byteLength(text, 'utf8') / 4) : 0
}

const CLAUDE_CREDENTIAL_PATTERN = /sk-ant-(?:oat|api)[\w-]+/g

export function sanitizeAgentSdkError(error: unknown, oauthToken: string | undefined): string {
  const message = error instanceof Error ? error.message : String(error)
  const withoutKnownToken = oauthToken
    ? message.split(oauthToken).join('[REDACTED]')
    : message
  return withoutKnownToken.replace(CLAUDE_CREDENTIAL_PATTERN, '[REDACTED]')
}

/**
 * Record the `context_snapshot` telemetry for a delegated SDK turn start.
 * `historyText` is the prompt-level history actually sent (handoff brief,
 * portable transcript, or '' when the provider resumed natively).
 */
export async function recordAgentSdkContextSnapshot(input: {
  ctx: SdkTurnContext
  threadId: string
  turnId: string
  resumed: boolean
  historyText: string
  selectedKunTools: readonly BridgeableTool[]
  record: (draft: RuntimeEventDraft) => Promise<unknown> | unknown
  kunSystemPrompt: () => string
}): Promise<void> {
  const { ctx } = input
  if (!ctx.contextProfile) return
  const system = estimatedTokens([input.kunSystemPrompt(), ctx.threadPersona ?? ''].join('\n'))
  const tools = estimatedTokens(JSON.stringify(input.selectedKunTools))
  const skills = estimatedTokens((ctx.contextInstructions ?? []).join('\n'))
  const messages = estimatedTokens([input.historyText, ctx.userText].join('\n'))
  const other = (ctx.images?.length ?? 0) * 1_024
  await input.record({
    kind: 'context_snapshot',
    threadId: input.threadId,
    turnId: input.turnId,
    model: ctx.model ?? 'claude-default',
    providerId: ctx.sessionPreparation?.route.providerId ?? 'default',
    stepIndex: 0,
    ...ctx.contextProfile,
    estimatedInputTokens: tools + system + skills + messages + other,
    breakdown: { tools, system, skills, messages, other },
    toolCount: input.selectedKunTools.length,
    activeSkillIds: [...(ctx.activeSkillIds ?? [])],
    contextManagement: 'sdk-managed',
    nativeHistory: input.resumed ? 'unknown' : 'none'
  })
}
