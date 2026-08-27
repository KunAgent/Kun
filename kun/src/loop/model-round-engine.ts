import type { CacheRequestSignature } from '../cache/cache-diagnostics.js'
import { utf8PrefixWithinBytes } from '../shared/utf8-text-blocks.js'
import type { PipelineStage } from '../contracts/events.js'
import type {
  ModelClient,
  ModelRequest,
  ModelRouteTargetMetadata
} from '../ports/model-client.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import type { UsageService } from '../services/usage-service.js'
import {
  makeAssistantReasoningItem,
  makeAssistantTextItem,
  makeToolCallItem
} from '../domain/item.js'
import { redactBrowserUseActionForPersistence } from '../contracts/browser-use.js'
import {
  ModelStreamCollector,
  type ModelStreamSnapshot,
  type ModelStreamToolMetadata
} from './model-stream-collector.js'
import type { LoopTelemetry } from './loop-telemetry.js'
import type { TurnExecutionFailure } from './turn-execution-types.js'
import { rewriteStreamDisconnectFailure } from './stream-disconnection-failure.js'
import {
  modelContextOverflowError,
  normalizeModelContextOverflowError,
  type ModelContextOverflowError
} from './model-context-overflow.js'

export type ModelRoundStreamResult =
  | { kind: 'completed'; snapshot: ModelStreamSnapshot }
  | { kind: 'tool_calls'; snapshot: ModelStreamSnapshot }
  | { kind: 'aborted' }
  | {
      kind: 'context_overflow'
      error: ModelContextOverflowError
      partialOutput: boolean
    }
  | { kind: 'failed' }

export type ModelRoundEngineInput = {
  threadId: string
  turnId: string
  signal: AbortSignal
  request: ModelRequest
  maxToolCallsPerStep: number
  toolCallOverflowBehavior?: 'fail' | 'truncate'
  streamToolMetadata: ReadonlyMap<string, ModelStreamToolMetadata>
  maxToolArgumentStringBytes?: number
  cacheSignature: CacheRequestSignature
  preSendDetails: Record<string, unknown>
  postSendDetails: Record<string, unknown>
  /**
   * Runs before the first committed route chunk is reduced or persisted.
   * Route pools suppress rejected pre-content targets, so this route owns any
   * tool calls that follow.
   */
  onRouteSelected?: (route: ModelRouteTargetMetadata) => Promise<void>
  writeGeneratedImage: (input: {
    imageBase64: string
    mimeType: string
  }) => Promise<{ markdown: string }>
}

export type ModelRoundEngineDeps = {
  model: Pick<ModelClient, 'stream'>
  events: Pick<RuntimeEventRecorder, 'record'>
  turns: Pick<TurnService, 'applyItem' | 'applyAssistantDelta'>
  usage: Pick<UsageService, 'record'>
  telemetry: Pick<LoopTelemetry, 'recordPromptPressure'>
  ids: Pick<IdGenerator, 'next'>
  recordPipelineStage: (
    threadId: string,
    turnId: string,
    stage: Extract<PipelineStage, 'pre_send' | 'post_send' | 'response_received'>,
    details?: Record<string, unknown>
  ) => Promise<void>
  recordGoalUsage: (threadId: string, tokens: number) => Promise<void>
  rememberFailure: (turnId: string, failure: TurnExecutionFailure) => void
  recordToolCallLimit: (threadId: string, turnId: string, message: string) => Promise<void>
}

const ASSISTANT_DELTA_EVENT_MAX_BYTES = 4 * 1024
const ASSISTANT_DELTA_EVENT_MAX_DELAY_MS = 40
const MAX_TRACKED_TOOL_CALL_TURNS = 128
const COMPAT_FALLBACK_CALL_ID_PATTERN = /^call_\d+$/

type AssistantDeltaEvent = {
  kind: 'assistant_text_delta' | 'assistant_reasoning_delta'
  itemId: string
  text: string
  textOffset: number
}

/**
 * Runs one already-prepared model request and owns only stream-local side
 * effects. The outer AgentLoop retains context resolution, compaction, tool
 * dispatch, and terminal lifecycle ownership.
 */
export class ModelRoundEngine {
  private readonly runtimeCallIdsByTurn = new Map<string, Set<string>>()

  constructor(private readonly deps: ModelRoundEngineDeps) {}

  async run(input: ModelRoundEngineInput): Promise<ModelRoundStreamResult> {
    const allocateRuntimeCallId = this.runtimeCallIdAllocator(input)
    const collector = new ModelStreamCollector({
      maxToolCallsPerStep: input.maxToolCallsPerStep,
      ...(input.toolCallOverflowBehavior
        ? { toolCallOverflowBehavior: input.toolCallOverflowBehavior }
        : {}),
      toolMetadata: input.streamToolMetadata,
      allocateRuntimeCallId,
      ...(input.maxToolArgumentStringBytes !== undefined
        ? { maxToolArgumentStringBytes: input.maxToolArgumentStringBytes }
        : {})
    })
    let textItemId = ''
    let reasoningItemId = ''
    let textCreatedAt = ''
    let reasoningCreatedAt = ''
    let persistedReasoningText = ''
    let persistedText = ''
    let emittedReasoningText = ''
    let emittedText = ''
    let queuedReasoningChars = 0
    let queuedTextChars = 0
    let selectedRoute: ModelRouteTargetMetadata | undefined
    let contextOverflow: ModelContextOverflowError | undefined
    let sawModelError = false
    const persistAccumulatedResponse = async (): Promise<void> => {
      if (collector.reasoning && collector.reasoning !== persistedReasoningText) {
        const nextReasoning = collector.reasoning
        const itemId = reasoningItemId || this.deps.ids.next('item_reasoning')
        reasoningItemId = itemId
        reasoningCreatedAt ||= new Date().toISOString()
        await this.deps.turns.applyItem(
          input.threadId,
          makeAssistantReasoningItem({
            id: itemId,
            turnId: input.turnId,
            threadId: input.threadId,
            text: nextReasoning,
            status: 'completed',
            createdAt: reasoningCreatedAt
          })
        )
        persistedReasoningText = nextReasoning
      }
      if (collector.text && collector.text !== persistedText) {
        const nextText = collector.text
        const itemId = textItemId || this.deps.ids.next('item_text')
        textItemId = itemId
        textCreatedAt ||= new Date().toISOString()
        await this.deps.turns.applyItem(
          input.threadId,
          makeAssistantTextItem({
            id: itemId,
            turnId: input.turnId,
            threadId: input.threadId,
            text: nextText,
            status: 'completed',
            createdAt: textCreatedAt
          })
        )
        persistedText = nextText
      }
    }
    const deltaEvents = new AssistantDeltaEventCoalescer(async (delta) => {
      if (delta.kind === 'assistant_text_delta') {
        if (delta.textOffset !== emittedText.length) {
          throw new Error(
            `assistant text delta offset mismatch: expected ${emittedText.length}, got ${delta.textOffset}`
          )
        }
        emittedText += delta.text
        await this.deps.turns.applyAssistantDelta(
          input.threadId,
          makeAssistantTextItem({
            id: delta.itemId,
            turnId: input.turnId,
            threadId: input.threadId,
            text: emittedText,
            status: 'running',
            createdAt: textCreatedAt
          }),
          delta.text,
          delta.textOffset
        )
        return
      }
      if (delta.textOffset !== emittedReasoningText.length) {
        throw new Error(
          `assistant reasoning delta offset mismatch: expected ${emittedReasoningText.length}, got ${delta.textOffset}`
        )
      }
      emittedReasoningText += delta.text
      await this.deps.turns.applyAssistantDelta(
        input.threadId,
        makeAssistantReasoningItem({
          id: delta.itemId,
          turnId: input.turnId,
          threadId: input.threadId,
          text: emittedReasoningText,
          status: 'running',
          createdAt: reasoningCreatedAt
        }),
        delta.text,
        delta.textOffset
      )
    })

    await this.deps.recordPipelineStage(
      input.threadId,
      input.turnId,
      'pre_send',
      input.preSendDetails
    )
    try {
      const streamIterator = this.deps.model.stream(input.request)[Symbol.asyncIterator]()
      // Calling next() enters async-generator model clients and starts their
      // fetch/SDK request. Post-send telemetry can then overlap provider TTFB
      // instead of delaying the actual network dispatch.
      const firstChunk = streamIterator.next()
      void firstChunk.catch(() => undefined)
      try {
        await this.deps.recordPipelineStage(
          input.threadId,
          input.turnId,
          'post_send',
          input.postSendDetails
        )
      } catch (error) {
        await streamIterator.return?.()
        throw error
      }
      for await (const chunk of streamFromDispatchedIterator(streamIterator, firstChunk)) {
        if (input.signal.aborted) {
          await deltaEvents.flush()
          await persistAccumulatedResponse()
          return { kind: 'aborted' }
        }
        if (chunk.route) {
          if (!selectedRoute) {
            selectedRoute = { ...chunk.route }
            await input.onRouteSelected?.(selectedRoute)
          } else if (!sameModelRouteTarget(selectedRoute, chunk.route)) {
            throw new Error(
              'model route changed after stream commit: ' +
              `${selectedRoute.providerId}/${selectedRoute.modelId} -> ` +
              `${chunk.route.providerId}/${chunk.route.modelId}`
            )
          }
        }
        const reduction = collector.reduce(chunk)
        if (reduction.terminal) {
          await deltaEvents.flush()
          const message = reduction.terminal.message
          this.deps.rememberFailure(input.turnId, {
            error: message,
            code: 'tool_call_limit_exceeded',
            severity: 'warning'
          })
          await this.deps.recordToolCallLimit(input.threadId, input.turnId, message)
          await persistAccumulatedResponse()
          return { kind: 'failed' }
        }
        for (const intent of reduction.intents) {
          if (
            intent.kind !== 'assistant_text_delta' &&
            intent.kind !== 'assistant_reasoning_delta'
          ) {
            await deltaEvents.flush()
          }
          switch (intent.kind) {
            case 'assistant_text_delta':
              if (!textItemId) {
                textItemId = this.deps.ids.next('item_text')
                textCreatedAt = new Date().toISOString()
              }
              await deltaEvents.append({
                kind: intent.kind,
                itemId: textItemId,
                text: intent.text,
                textOffset: queuedTextChars
              })
              queuedTextChars += intent.text.length
              break
            case 'assistant_reasoning_delta':
              if (!reasoningItemId) {
                reasoningItemId = this.deps.ids.next('item_reasoning')
                reasoningCreatedAt = new Date().toISOString()
              }
              await deltaEvents.append({
                kind: intent.kind,
                itemId: reasoningItemId,
                text: intent.text,
                textOffset: queuedReasoningChars
              })
              queuedReasoningChars += intent.text.length
              break
            case 'retrying':
              await this.deps.events.record({
                kind: 'model_request_retry',
                threadId: input.threadId,
                turnId: input.turnId,
                ...(intent.status !== undefined ? { status: intent.status } : {}),
                attempt: intent.attempt,
                maxAttempts: intent.maxAttempts,
                delayMs: intent.delayMs,
                ...(intent.reason ? { reason: intent.reason } : {}),
                ...(intent.failureSummary ? { failureSummary: intent.failureSummary } : {})
              })
              break
            case 'tool_call_ready': {
              // A model response can emit reasoning/text before its tool call.
              // Persist those assistant items now so the canonical item stream
              // keeps the same order as the SSE stream. Waiting until the
              // whole response ends would append the tool first and make a
              // reloaded conversation read backwards.
              await persistAccumulatedResponse()
              const itemId = `item_tool_${input.turnId}_${intent.call.callId}`
              await this.deps.turns.applyItem(
                input.threadId,
                makeToolCallItem({
                  id: itemId,
                  turnId: input.turnId,
                  threadId: input.threadId,
                  callId: intent.call.callId,
                  toolName: intent.call.toolName,
                  toolKind: intent.call.toolKind,
                  arguments: intent.call.toolName === 'browser_use'
                    ? redactBrowserUseActionForPersistence(intent.call.arguments) as Record<string, unknown>
                    : intent.call.arguments,
                  ...(intent.providerMetadata
                    ? { providerMetadata: intent.providerMetadata }
                    : {}),
                  ...(intent.repairNotes.length
                    ? { summary: `Repaired tool arguments: ${intent.repairNotes.join('; ')}` }
                    : {})
                })
              )
              await this.deps.events.record({
                kind: 'tool_call_ready',
                threadId: input.threadId,
                turnId: input.turnId,
                itemId,
                callId: intent.call.callId,
                toolName: intent.call.toolName,
                readyCount: collector.toolCallCount
              })
              break
            }
            case 'generated_image': {
              const generated = await input.writeGeneratedImage({
                imageBase64: intent.imageBase64,
                mimeType: intent.mimeType
              })
              const textIntent = collector.appendAssistantText(generated.markdown)
              if (!textItemId) {
                textItemId = this.deps.ids.next('item_text')
                textCreatedAt = new Date().toISOString()
              }
              await deltaEvents.append({
                kind: textIntent.kind,
                itemId: textItemId,
                text: textIntent.text,
                textOffset: queuedTextChars
              })
              queuedTextChars += textIntent.text.length
              break
            }
            case 'usage': {
              this.deps.telemetry.recordPromptPressure(
                input.threadId,
                input.request.model,
                intent.usage.promptTokens
              )
              const usage = this.deps.usage.record(
                input.threadId,
                intent.usage,
                input.cacheSignature,
                input.turnId
              )
              await this.deps.recordGoalUsage(input.threadId, intent.usage.totalTokens)
              await this.deps.events.record({
                kind: 'usage',
                threadId: input.threadId,
                turnId: input.turnId,
                model: input.request.model,
                ...(input.request.providerId ? { providerId: input.request.providerId } : {}),
                ...(input.request.accountId ? { accountId: input.request.accountId } : {}),
                usage
              })
              break
            }
            case 'model_error': {
              sawModelError = true
              contextOverflow = modelContextOverflowError(intent.message, intent.code)
              if (contextOverflow) break
              // A turn abort (user stop / tool cancel / host shutdown) that
              // races the provider's disconnect noise must not fail the turn.
              // Drop the raw transport error; the aborted outcome below owns
              // settlement.
              if (input.signal.aborted) break
              const rewritten = rewriteStreamDisconnectFailure({
                error: intent.message,
                ...(intent.code ? { code: intent.code } : {}),
                ...(intent.failure ? { details: { modelFailure: intent.failure } } : {})
              })
              this.deps.rememberFailure(input.turnId, rewritten ?? {
                error: intent.message,
                ...(intent.code ? { code: intent.code } : {}),
                ...(intent.failure ? { details: { modelFailure: intent.failure } } : {}),
                severity: 'error'
              })
              // Disconnects are terminal-only diagnostics. If a stop races
              // this chunk, TurnLifecycle will settle it as aborted; recording
              // an immediate error here would flash a misleading error card
              // before that terminal outcome arrives.
              if (!rewritten) {
                await this.deps.events.record({
                  kind: 'error',
                  threadId: input.threadId,
                  turnId: input.turnId,
                  message: intent.message,
                  code: intent.code,
                  ...(intent.failure ? { details: { modelFailure: intent.failure } } : {}),
                  severity: 'error'
                })
              }
              break
            }
          }
        }
      }
    } catch (error) {
      let streamFailure = error
      try {
        await deltaEvents.flush()
      } catch (flushError) {
        streamFailure = flushError
      }
      await persistAccumulatedResponse()
      const overflow = normalizeModelContextOverflowError(streamFailure)
      if (overflow) {
        return {
          kind: 'context_overflow',
          error: overflow,
          partialOutput: Boolean(collector.text || collector.reasoning || collector.toolCallCount)
        }
      }
      throw streamFailure
    } finally {
      deltaEvents.dispose()
    }

    if (input.signal.aborted) {
      await deltaEvents.flush()
      await persistAccumulatedResponse()
      return { kind: 'aborted' }
    }
    await deltaEvents.flush()
    const snapshot = collector.snapshot()
    await this.deps.recordPipelineStage(input.threadId, input.turnId, 'response_received', {
      stopReason: snapshot.stopReason,
      toolCallCount: snapshot.toolCalls.length,
      ...(collector.truncatedToolCallCount > 0
        ? { truncatedToolCallCount: collector.truncatedToolCallCount }
        : {}),
      textBytes: Buffer.byteLength(snapshot.text, 'utf8'),
      reasoningBytes: Buffer.byteLength(snapshot.reasoning, 'utf8')
    })
    await persistAccumulatedResponse()
    if (snapshot.stopReason === 'error') {
      if (contextOverflow) {
        return {
          kind: 'context_overflow',
          error: contextOverflow,
          partialOutput: Boolean(snapshot.text || snapshot.reasoning || snapshot.toolCalls.length)
        }
      }
      // A provider can end with only `completed(stopReason: "error")` and no
      // preceding `error` chunk. Without this synthesis the turn fails with an
      // empty message, which the renderer cannot render as a useful card.
      if (!sawModelError) {
        const message =
          'Model provider ended the response with an error status without returning a diagnostic message.'
        this.deps.rememberFailure(input.turnId, {
          error: message,
          code: 'model_error_without_message',
          severity: 'error'
        })
        await this.deps.events.record({
          kind: 'error',
          threadId: input.threadId,
          turnId: input.turnId,
          message,
          code: 'model_error_without_message',
          severity: 'error'
        })
      }
      return { kind: 'failed' }
    }
    return snapshot.toolCalls.length > 0
      ? { kind: 'tool_calls', snapshot }
      : { kind: 'completed', snapshot }
  }

  clearTurn(turnId: string): void {
    this.runtimeCallIdsByTurn.delete(turnId)
  }

  private runtimeCallIdAllocator(input: ModelRoundEngineInput): (providerCallId: string) => string {
    const used = this.runtimeCallIdsByTurn.get(input.turnId) ?? new Set<string>()
    for (const item of input.request.history) {
      if (item.kind === 'tool_call' || item.kind === 'tool_result') used.add(item.callId)
    }
    this.runtimeCallIdsByTurn.delete(input.turnId)
    this.runtimeCallIdsByTurn.set(input.turnId, used)
    if (this.runtimeCallIdsByTurn.size > MAX_TRACKED_TOOL_CALL_TURNS) {
      const oldest = this.runtimeCallIdsByTurn.keys().next().value
      if (oldest !== undefined) this.runtimeCallIdsByTurn.delete(oldest)
    }

    return (providerCallId) => {
      if (
        providerCallId.trim() &&
        !COMPAT_FALLBACK_CALL_ID_PATTERN.test(providerCallId)
      ) {
        if (!used.has(providerCallId)) {
          used.add(providerCallId)
          return providerCallId
        }
      }

      let runtimeCallId = this.deps.ids.next('call_tool')
      while (used.has(runtimeCallId)) runtimeCallId = this.deps.ids.next('call_tool')
      used.add(runtimeCallId)
      return runtimeCallId
    }
  }
}

function sameModelRouteTarget(
  a: ModelRouteTargetMetadata,
  b: ModelRouteTargetMetadata
): boolean {
  return a.routePoolId === b.routePoolId &&
    a.targetId === b.targetId &&
    a.providerId === b.providerId &&
    a.modelId === b.modelId &&
    a.requestedModelId === b.requestedModelId
}

async function* streamFromDispatchedIterator<T>(
  iterator: AsyncIterator<T>,
  first: Promise<IteratorResult<T>>
): AsyncGenerator<T> {
  let completed = false
  try {
    let current = await first
    while (!current.done) {
      yield current.value
      current = await iterator.next()
    }
    completed = true
  } finally {
    if (!completed && iterator.return) await iterator.return()
  }
}

type PendingAssistantDeltaEvent = Omit<AssistantDeltaEvent, 'text'> & {
  parts: string[]
  bytes: number
}

/**
 * Coalesces adjacent provider deltas into persistence-sized events. A byte
 * ceiling keeps large bursts moving immediately, while the short timer keeps
 * low-volume output live even when the provider pauses between chunks.
 */
class AssistantDeltaEventCoalescer {
  private pending: PendingAssistantDeltaEvent | undefined
  private timer: NodeJS.Timeout | undefined
  private writeTail: Promise<void> = Promise.resolve()
  private writeError: unknown
  private hasWriteError = false

  constructor(
    private readonly emit: (event: AssistantDeltaEvent) => Promise<void>,
    private readonly maxBytes = ASSISTANT_DELTA_EVENT_MAX_BYTES,
    private readonly maxDelayMs = ASSISTANT_DELTA_EVENT_MAX_DELAY_MS
  ) {}

  async append(event: AssistantDeltaEvent): Promise<void> {
    this.throwWriteError()
    if (!event.text) return
    if (
      this.pending &&
      (this.pending.kind !== event.kind || this.pending.itemId !== event.itemId)
    ) {
      await this.flush()
    }
    let offset = 0
    while (offset < event.text.length) {
      if (!this.pending) {
        this.pending = {
          kind: event.kind,
          itemId: event.itemId,
          textOffset: event.textOffset + offset,
          parts: [],
          bytes: 0
        }
        this.scheduleFlush()
      }
      const prefix = utf8PrefixWithinBytes(
        event.text,
        offset,
        this.maxBytes - this.pending.bytes
      )
      if (prefix.end === offset) {
        await this.flush()
        continue
      }
      this.pending.parts.push(event.text.slice(offset, prefix.end))
      this.pending.bytes += prefix.bytes
      offset = prefix.end
      if (this.pending.bytes >= this.maxBytes) await this.flush()
    }
  }

  async flush(): Promise<void> {
    this.cancelTimer()
    this.enqueuePending()
    await this.writeTail
    this.throwWriteError()
  }

  dispose(): void {
    this.cancelTimer()
  }

  private scheduleFlush(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.enqueuePending()
    }, this.maxDelayMs)
    this.timer.unref?.()
  }

  private cancelTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private enqueuePending(): void {
    const pending = this.pending
    if (!pending) return
    this.pending = undefined
    this.writeTail = this.writeTail.then(async () => {
      if (this.hasWriteError) return
      try {
        await this.emit({
          kind: pending.kind,
          itemId: pending.itemId,
          textOffset: pending.textOffset,
          text: pending.parts.join('')
        })
      } catch (error) {
        this.hasWriteError = true
        this.writeError = error
      }
    })
  }

  private throwWriteError(): void {
    if (this.hasWriteError) throw this.writeError
  }
}
