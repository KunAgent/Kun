import { randomUUID } from 'node:crypto'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import { goalContextTexts } from '../../contracts/items.js'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import {
  startLlmDebugRoundIfEnabled,
  type LlmDebugRound,
  type LlmDebugSink
} from '../../services/llm-debug-recorder.js'
import { repairToolArguments } from './tool-argument-repair.js'
import type { ModelRequestRetryConfig } from '../../config/kun-config.js'
import {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  isCustomModelEndpointFormat,
  modelEndpointPath,
  normalizeModelEndpointFormat,
  resolveModelEndpointFormat,
  usesChatCompletionsShape,
  type ModelEndpointFormat
} from '../../contracts/model-endpoint-format.js'
import { createProxyFetch } from './proxy-fetch.js'
import { resolveCompatModelCapabilities } from './compat-capabilities.js'
import {
  DEFAULT_MODEL_STREAM_LIMITS,
  ModelStreamResourceBudget,
  ModelStreamResourceLimitError,
  type ModelStreamLimits,
  type PendingToolCall
} from './model-stream-resource-budget.js'
import {
  assertPendingToolCallsComplete,
  ModelStreamProtocolError
} from './tool-call-stream-identity.js'
import { normalizeCompatUsage } from './compat-usage-normalizer.js'
import {
  exponentialRetryDelayMs,
  normalizeModelRequestRetryConfig,
  retryDelayMs,
  sleepWithAbort
} from './compat-retry-policy.js'
import {
  buildCompatRequestHeaders,
  classifyCompatHttpError,
  compatHttpFailureLog,
  redactUrlForLog,
  summarizeHttpErrorBody
} from './compat-http-diagnostics.js'
import {
  httpFailureRetryDecision,
  rateLimitRecoverySuffix,
  retryDelayForBudget
} from './failure-reason.js'
import type { CompatChatMessage } from './compat-request-codecs.js'
import { projectCompatMessages } from './compat-message-projector.js'
import {
  codexModelSupportsNativeImageGeneration,
  createCompatRequestCodecs,
  normalizeToolSpecs,
  requiresReasoningRoundTrip
} from './compat-request-builder.js'
import { createResponsesContentTracker } from './responses-stream-decoder.js'
import { createAnthropicThinkingState } from './anthropic-messages-stream-decoder.js'
import {
  consumeCompatStreamPayload,
  materializeCompatNonStreaming
} from './compat-model-client-stream-payloads.js'
import { CompatModelClientBase } from './compat-model-client-base.js'
import { IncrementalSseFrameBuffer } from './incremental-sse-frame-buffer.js'
import { summarizeModelRetryFailure } from './model-retry-failure-summary.js'
import { StreamOutputReplayBuffer } from './stream-output-replay-buffer.js'
import type { ChatCompletionResponse, CompatPostResult, ModelStopReason } from './compat-model-types.js'
import {
  isRecoverableStreamTransportError,
  mergeStreamFinishReason,
  mergeUsageSnapshots,
  normalizeModelStreamLimits,
  normalizeStreamIdleTimeoutMs,
  readLimitedResponseText,
  readLimitedResponseJson,
  readStreamChunk
} from './compat-model-support.js'

export class CompatModelStreamingClient extends CompatModelClientBase {
  protected async *streamSseWithRecovery(input: {
    response: Response
    request: ModelRequest
    endpointFormat: ModelEndpointFormat
    configuredEndpointFormat: ModelEndpointFormat
    model: string
    retry: ReturnType<typeof normalizeModelRequestRetryConfig>
    usedRetryAttempts: number
    post: () => Promise<CompatPostResult>
    url: string
    maxErrorBodyBytes: number
    streamLimits: ModelStreamLimits
    knownSecrets: readonly string[]
  }): AsyncIterable<ModelStreamChunk> {
    let response = input.response
    let usedRetryAttempts = input.usedRetryAttempts
    let rateLimitRecoveryMs: number | undefined
    let emittedReasoning = false
    let deliveredText = false
    let committedOutput = false
    let attemptedStreamRecovery = false
    let firstStreamFailure: { code: string; message: string } | undefined
    // maxAttempts counts retries after the initial request everywhere, and
    // `0` is an explicit "no automatic transport retries" setting. Unlike the
    // older code, this stream-recovery budget must not sneak in a minimum of
    // one retry when the operator disabled retries. A per-request ceiling
    // (probes pass 0) caps it further.
    const maxRetryAttempts = input.request.maxRetryAttempts !== undefined
      ? Math.min(input.retry.maxAttempts, input.request.maxRetryAttempts)
      : input.retry.maxAttempts
    const exhaustedRetryMessage = maxRetryAttempts === 0
      ? 'automatic request retries were disabled'
      : `all ${maxRetryAttempts} configured request retries were exhausted`

    while (true) {
      if (!response.body) {
        yield withFirstStreamFailure({ kind: 'error', message: 'model response had no body' }, firstStreamFailure)
        return
      }

      let recoverableError: Extract<ModelStreamChunk, { kind: 'error' }> | null = null
      let pendingCompletion: Extract<ModelStreamChunk, { kind: 'completed' }> | undefined
      let sawTerminalError = false
      const deferredOutput = new StreamOutputReplayBuffer()
      const suppressReasoning = emittedReasoning
      for await (const chunk of this.streamSse(
        response.body,
        input.request.abortSignal,
        input.endpointFormat,
        input.model
      )) {
        if (chunk.kind === 'error') {
          // A turn abort (user stop, tool cancellation, host shutdown) can
          // race the provider's own disconnect noise. The abort already owns
          // the terminal outcome; surfacing the raw transport error here would
          // fail the turn with a misleading provider-looking message.
          if (input.request.abortSignal.aborted) return
          if (isRecoverableStreamTransportError(chunk)) {
            // Once a provider/protocol error has been delivered, later socket
            // noise must not replay the request or replace that diagnostic.
            if (sawTerminalError) break
            const message = summarizeModelRetryFailure(chunk.message, input.knownSecrets) ?? 'model stream interrupted'
            recoverableError = { ...chunk, message }
            firstStreamFailure ??= { code: chunk.code ?? 'stream_disconnected', message }
            continue
          }
          sawTerminalError = true
          // Protocol/provider errors are terminal diagnostics, not replay
          // divergence. Commit any completed output before preserving the
          // provider's remaining error/completed terminal sequence.
          for (const deferred of deferredOutput.drain()) {
            committedOutput = true
            yield deferred
          }
          if (attemptedStreamRecovery && firstStreamFailure) {
            yield {
              ...chunk,
              failure: { category: 'unknown', failoverAllowed: false, ...chunk.failure, firstStreamFailure }
            }
          } else {
            yield chunk
          }
          continue
        }
        if (chunk.kind === 'assistant_reasoning_delta') {
          if (suppressReasoning) continue
          emittedReasoning = true
        }
        if (chunk.kind === 'assistant_text_delta') {
          if (chunk.text) deliveredText = true
          yield chunk
          continue
        }
        if (deferredOutput.defer(chunk)) {
          // Tool calls and generated media become observable side effects in
          // AgentLoop. Hold them until this attempt reaches a terminal marker
          // so an interrupted attempt can be discarded and replayed safely.
          continue
        }
        if (chunk.kind === 'usage' || chunk.kind === 'completed') {
          for (const deferred of deferredOutput.drain()) {
            committedOutput = true
            yield deferred
          }
        }
        if (chunk.kind === 'completed') {
          // Do not claim success until the iterator really ends: an abnormal
          // provider sequence can still deliver a transport error afterwards.
          pendingCompletion = chunk
          continue
        }
        yield chunk
      }

      if (!recoverableError) {
        if (!input.request.abortSignal.aborted && pendingCompletion &&
          (!sawTerminalError || pendingCompletion.stopReason === 'error')) yield pendingCompletion
        return
      }
      if (input.request.abortSignal.aborted) return
      const interruptedFailure = {
        category: recoverableError.failure?.category ?? 'network' as const,
        failoverAllowed: recoverableError.failure?.failoverAllowed ?? true,
        ...recoverableError.failure,
        responsePhase: 'interrupted' as const,
        partialOutput: deliveredText,
        ...(attemptedStreamRecovery && firstStreamFailure ? { firstStreamFailure } : {}),
        ...(deliveredText || committedOutput ? { failoverAllowed: false } : {})
      }
      if (deliveredText || committedOutput) {
        yield { ...recoverableError, failure: interruptedFailure }
        return
      }
      if (usedRetryAttempts >= maxRetryAttempts) {
        yield {
          ...recoverableError,
          failure: interruptedFailure,
          message: `${recoverableError.message} (${exhaustedRetryMessage})`
        }
        return
      }

      const nextAttempt = usedRetryAttempts + 1
      const delayMs = retryDelayMs(response, input.retry.initialDelayMs, usedRetryAttempts)
      const failureSummary = summarizeModelRetryFailure(recoverableError.message, input.knownSecrets)
      yield {
        kind: 'retrying',
        status: response.status,
        attempt: nextAttempt,
        maxAttempts: maxRetryAttempts,
        delayMs,
        reason: 'stream_transport',
        ...(failureSummary ? { failureSummary } : {})
      }
      const aborted = await sleepWithAbort(delayMs, input.request.abortSignal)
      if (aborted || input.request.abortSignal.aborted) {
        return
      }
      usedRetryAttempts = nextAttempt
      attemptedStreamRecovery = true

      while (true) {
        const retried = await input.post()
        if (input.request.abortSignal.aborted) {
          if (retried.kind === 'response') void retried.response.body?.cancel().catch(() => {})
          return
        }
        if (retried.kind === 'error') {
          const failoverCap = (input.request.failover?.alternatives ?? 0) > 0
            ? Math.min(1, maxRetryAttempts)
            : maxRetryAttempts
          if (
            retried.failure.failoverAllowed === false ||
            usedRetryAttempts >= failoverCap
          ) {
            yield {
              kind: 'error',
              message: retried.failure.failoverAllowed !== false && usedRetryAttempts >= maxRetryAttempts
                ? `${retried.message} (${exhaustedRetryMessage})`
                : retried.message,
              ...(retried.code ? { code: retried.code } : {}),
              failure: {
                ...retried.failure,
                ...(firstStreamFailure ? { firstStreamFailure } : {})
              }
            }
            return
          }
          const networkRetryAttempt = usedRetryAttempts + 1
          const networkDelayMs = Math.min(
            (input.request.failover?.alternatives ?? 0) > 0 ? 3_000 : Number.MAX_SAFE_INTEGER,
            exponentialRetryDelayMs(
              input.retry.initialDelayMs,
              usedRetryAttempts
            )
          )
          const failureSummary = summarizeModelRetryFailure(retried.message, input.knownSecrets)
          yield {
            kind: 'retrying',
            attempt: networkRetryAttempt,
            maxAttempts: maxRetryAttempts,
            delayMs: networkDelayMs,
            reason: 'network',
            ...(failureSummary ? { failureSummary } : {})
          }
          const networkRetryAborted = await sleepWithAbort(
            networkDelayMs,
            input.request.abortSignal
          )
          if (networkRetryAborted || input.request.abortSignal.aborted) {
            return
          }
          usedRetryAttempts = networkRetryAttempt
          continue
        }
        response = retried.response
        if (response.ok) break

        let errorBody: { text: string; exceeded: boolean } | undefined
        if (input.retry.httpStatusCodes.includes(response.status)) {
          errorBody = await readLimitedResponseText(response, input.maxErrorBodyBytes)
          if (input.request.abortSignal.aborted) return
          const { classification, budget } = httpFailureRetryDecision({
            status: response.status,
            body: errorBody.exceeded ? '' : errorBody.text,
            headers: response.headers,
            alternatives: input.request.failover?.alternatives,
            policyMaxAttempts: maxRetryAttempts
          })
          if (classification.reason === 'rate' && usedRetryAttempts >= budget.maxAttempts) {
            rateLimitRecoveryMs = classification.retryAfterMs
          }
          if (usedRetryAttempts < budget.maxAttempts) {
            const httpRetryAttempt = usedRetryAttempts + 1
            const httpDelayMs = retryDelayForBudget({
              response,
              budget,
              initialDelayMs: input.retry.initialDelayMs,
              attempt: usedRetryAttempts
            })
            const status = response.status
            const failureSummary = errorBody.exceeded
              ? `model error response exceeded ${input.maxErrorBodyBytes} bytes`
              : summarizeModelRetryFailure(summarizeHttpErrorBody(errorBody.text), input.knownSecrets)
            yield {
              kind: 'retrying',
              status,
              attempt: httpRetryAttempt,
              maxAttempts: maxRetryAttempts,
              delayMs: httpDelayMs,
              ...(failureSummary ? { failureSummary } : {})
            }
            const httpRetryAborted = await sleepWithAbort(httpDelayMs, input.request.abortSignal)
            if (httpRetryAborted || input.request.abortSignal.aborted) {
              return
            }
            usedRetryAttempts = httpRetryAttempt
            continue
          }
        }

        errorBody ??= await readLimitedResponseText(response, input.maxErrorBodyBytes)
        if (input.request.abortSignal.aborted) return
        if (errorBody.exceeded) {
          yield withFirstStreamFailure({
            kind: 'error',
            message: `model error response exceeded ${input.maxErrorBodyBytes} bytes`,
            code: 'response_body_too_large'
          }, firstStreamFailure)
          return
        }
        this.logHttpFailure({
          url: input.url,
          status: response.status,
          body: input.request.gatewayRouting ? '[gateway error body omitted]' : errorBody.text,
          endpointFormat: input.endpointFormat,
          configuredEndpointFormat: input.configuredEndpointFormat,
          model: input.model
        })
        const classified = await this.classifyHttpError(
          response.status,
          errorBody.text,
          response.headers.get('retry-after'),
          response.headers
        )
        if (input.request.abortSignal.aborted) return
        yield {
          kind: 'error',
          message: `${classified.message}${rateLimitRecoverySuffix(rateLimitRecoveryMs)}`,
          code: classified.code,
          failure: { ...classified.failure, ...(firstStreamFailure ? { firstStreamFailure } : {}) }
        }
        return
      }

      if (
        this.config.nonStreaming ||
        response.headers.get('content-type')?.includes('application/json')
      ) {
        const json = await readLimitedResponseJson(response, input.streamLimits.maxTotalBytes)
        if (input.request.abortSignal.aborted) return
        if (json.kind === 'limit') {
          yield withFirstStreamFailure({
            kind: 'error',
            message: `model response exceeded ${json.maxBytes} bytes`,
            code: 'stream_resource_limit'
          }, firstStreamFailure)
          return
        }
        if (json.kind === 'invalid_json') {
          yield withFirstStreamFailure({ kind: 'error', message: `model response contained invalid JSON: ${json.message}` }, firstStreamFailure)
          return
        }
        for (const chunk of materializeCompatNonStreaming(
          json.value as ChatCompletionResponse,
          input.endpointFormat,
          input.model,
          input.streamLimits,
          {
            normalizeUsage: (usage) => this.mapUsage(usage, input.model),
            parseToolArguments: (raw) => this.parseToolArguments(raw)
          }
        )) {
          yield chunk.kind === 'error' ? withFirstStreamFailure(chunk, firstStreamFailure) : chunk
        }
        return
      }
    }
  }

  protected async *streamSse(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    endpointFormat: ModelEndpointFormat,
    model: string
  ): AsyncIterable<ModelStreamChunk> {
    const decoder = new TextDecoder('utf-8')
    const reader = body.getReader()
    const frameBuffer = new IncrementalSseFrameBuffer()
    const pendingArguments = new Map<string, PendingToolCall>()
    const pendingByIndex = new Map<number, string>()
    const completedToolCalls = new Set<string>()
    const responsesContentTracker = createResponsesContentTracker()
    const anthropicThinkingState = createAnthropicThinkingState()
    let usage: UsageSnapshot | null = null
    // The Responses protocol may repeat final output in response.completed;
    // a boolean is sufficient to suppress that duplicate. Retaining the full
    // streamed text/reasoning here used quadratic concatenation and a second
    // unbounded copy of an already-emitted response.
    let sawTextDelta = false
    let stopReason: ModelStopReason = 'stop'
    let finishReason: string | null = null
    let sawDone = false
    let readerFinished = false
    let bufferBytes = 0
    const idleTimeoutMs = normalizeStreamIdleTimeoutMs(this.config.streamIdleTimeoutMs)
    const limits = normalizeModelStreamLimits(this.config.streamLimits)
    const budget = new ModelStreamResourceBudget(limits)
    const cancelReader = (reason: string): void => {
      // Never await cancellation here: a broken/custom ReadableStream can
      // make its cancel promise hang, defeating the very timeout/limit that
      // is trying to stop it.
      void reader.cancel(reason).catch(() => {})
    }
    try {
      while (!signal.aborted) {
        const read = await readStreamChunk(reader, signal, idleTimeoutMs)
        if (read.kind === 'timeout') {
          yield {
            kind: 'error',
            message: `model stream stalled for ${idleTimeoutMs}ms without data`,
            code: 'stream_idle_timeout',
            failure: { category: 'timeout', failoverAllowed: true, responsePhase: 'interrupted' }
          }
          return
        }
        if (read.kind === 'aborted') break
        if (read.kind === 'error') {
          yield {
            kind: 'error',
            message: read.message,
            code: 'stream_read_error',
            failure: { category: 'network', failoverAllowed: true, responsePhase: 'interrupted' }
          }
          return
        }
        const { value, done } = read
        if (done) {
          readerFinished = true
          break
        }
        if (!value) {
          readerFinished = true
          break
        }
        budget.addInboundBytes(value.byteLength)
        bufferBytes += value.byteLength
        if (bufferBytes > limits.maxBufferBytes) {
          throw budget.exceeded(`${limits.maxBufferBytes} buffered SSE bytes`)
        }
        frameBuffer.append(decoder.decode(value, { stream: true }))
        while (true) {
          const parsedFrame = frameBuffer.takeFrame()
          if (parsedFrame === null) break
          const frame = parsedFrame.data
          const consumedBytes = Buffer.byteLength(frame, 'utf8') + Buffer.byteLength(parsedFrame.delimiter, 'utf8')
          bufferBytes = Math.max(0, bufferBytes - consumedBytes)
          budget.addFrame(Buffer.byteLength(frame, 'utf8'))
          const dataLines = frame
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('')
          if (!dataLines) continue
          if (dataLines === '[DONE]') {
            finishReason = finishReason ?? 'stop'
            sawDone = true
            break
          }
          let payload: unknown
          try {
            payload = JSON.parse(dataLines)
          } catch {
            yield { kind: 'error', message: 'model stream contained invalid SSE JSON', code: 'stream_invalid_frame' }
            return
          }
          const result = consumeCompatStreamPayload(
            payload as Record<string, unknown>,
            pendingArguments,
            pendingByIndex,
            completedToolCalls,
            sawTextDelta,
            responsesContentTracker,
            anthropicThinkingState,
            endpointFormat,
            model,
            budget,
            {
              normalizeUsage: (usage) => this.mapUsage(usage, model),
              parseToolArguments: (raw) => this.parseToolArguments(raw)
            }
          )
          budget.addOutput(result.chunks)
          sawTextDelta = result.sawTextDelta
          if (result.usage) usage = mergeUsageSnapshots(usage, result.usage)
          if (result.finishReason) {
            // Some protocols emit a semantic terminal reason followed by a
            // generic stop frame. Do not let that trailing frame downgrade
            // `length`, `tool_calls`, or `error` to a successful stop.
            finishReason = mergeStreamFinishReason(finishReason, result.finishReason)
          }
          for (const chunk of result.chunks) yield chunk
        }
        if (sawDone) break
      }
    } catch (error) {
      if (error instanceof ModelStreamResourceLimitError || error instanceof ModelStreamProtocolError) {
        frameBuffer.clear()
        budget.clearPendingCalls(pendingArguments)
        pendingByIndex.clear()
        completedToolCalls.clear()
        cancelReader(error instanceof ModelStreamProtocolError
          ? 'model stream tool-call protocol error'
          : 'model stream resource limit exceeded')
        yield {
          kind: 'error',
          message: error.message,
          code: error instanceof ModelStreamProtocolError ? error.code : 'stream_resource_limit'
        }
        return
      }
      throw error
    } finally {
      if (!readerFinished) cancelReader('model stream closed before body completion')
      try {
        reader.releaseLock()
      } catch {
        // The stream may already be released; ignore.
      }
    }
    if (signal.aborted) {
      return
    }
    if (!sawDone && !finishReason) {
      yield {
        kind: 'error',
        message: 'model stream ended before a terminal frame',
        code: 'stream_truncated',
        failure: { category: 'network', failoverAllowed: true, responsePhase: 'interrupted' }
      }
      return
    }
    // Safety net: finalize any tool call whose arguments finished streaming but
    // was never emitted because the stream ended without a per-call "done"
    // signal. The chat_completions branch only finalizes on
    // `finish_reason === 'tool_calls'`, so a provider that ends with 'stop',
    // 'length', or a bare `[DONE]` while a tool call is still pending would
    // otherwise DROP the call silently. Truncated arguments surface here as
    // `{ __raw }` (a tool error the model can react to) instead of vanishing.
    let flushedPendingToolCall = false
    try {
      assertPendingToolCallsComplete(pendingArguments)
      for (const [callId, pending] of pendingArguments) {
        if (!pending.name) continue
        if (completedToolCalls.has(callId)) continue
        const argumentsRaw = budget.pendingArguments(pending)
        budget.completeToolCall(argumentsRaw)
        flushedPendingToolCall = true
        completedToolCalls.add(callId)
        yield {
          kind: 'tool_call_complete',
          callId,
          toolName: pending.name,
          arguments: this.parseToolArguments(argumentsRaw || '{}')
        }
      }
    } catch (error) {
      if (error instanceof ModelStreamResourceLimitError || error instanceof ModelStreamProtocolError) {
        yield {
          kind: 'error',
          message: error.message,
          code: error instanceof ModelStreamProtocolError ? error.code : 'stream_resource_limit'
        }
        return
      }
      throw error
    }
    budget.clearPendingCalls(pendingArguments)
    if (usage) yield { kind: 'usage', usage }
    stopReason = ((): ModelStopReason => {
      switch (finishReason) {
        case 'tool_calls':
          return 'tool_calls'
        case 'length':
          return 'length'
        case 'error':
          return 'error'
        default:
          // A completed or recovered tool call means this was really a
          // tool-call turn even if the provider emitted only a generic stop.
          return flushedPendingToolCall || completedToolCalls.size > 0 ? 'tool_calls' : 'stop'
      }
    })()
    yield { kind: 'completed', stopReason }
  }
}

function withFirstStreamFailure(
  chunk: Extract<ModelStreamChunk, { kind: 'error' }>,
  firstStreamFailure: { code: string; message: string } | undefined
): Extract<ModelStreamChunk, { kind: 'error' }> {
  if (!firstStreamFailure) return chunk
  return { ...chunk, failure: { category: 'unknown', failoverAllowed: false, ...chunk.failure, firstStreamFailure } }
}
