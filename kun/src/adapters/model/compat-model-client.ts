import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { goalContextTexts } from '../../contracts/items.js'
import { startLlmDebugRoundIfEnabled, type LlmDebugRound } from '../../services/llm-debug-recorder.js'
import { exponentialRetryDelayMs, normalizeModelRequestRetryConfig, sleepWithAbort } from './compat-retry-policy.js'
import { CompatModelStreamingClient } from './compat-model-client-stream.js'
import { materializeCompatNonStreaming } from './compat-model-client-stream-payloads.js'
import { summarizeModelRetryFailure } from './model-retry-failure-summary.js'
import { summarizeHttpErrorBody } from './compat-http-diagnostics.js'
import {
  httpFailureRetryDecision,
  rateLimitRecoverySuffix,
  retryDelayForBudget
} from './failure-reason.js'
import type { ChatCompletionResponse, CompatModelClientConfig, CompatPostResult } from './compat-model-types.js'
import {
  buildChatCompletionsUrl,
  buildModelEndpointUrl,
  ignoreModelTraceFailure,
  isCodexEndpoint,
  isStreamRequiredError,
  normalizeCodexResponsesUrl,
  normalizeModelStreamLimits,
  normalizeStreamIdleTimeoutMs,
  openCodeSessionRuntimeHeaders,
  readLimitedResponseJson,
  readLimitedResponseText,
  reasoningFromMessage,
  shouldDropUnreplayableToolRounds,
  shouldRetryWithoutSamplingParams,
  shouldRetryWithoutStreamUsage,
  shouldRetryWithReasoningRoundTrip,
  stripSamplingFromBody,
  warnModelTraceFailure
} from './compat-model-support.js'
import { resolveModelEndpointFormat, usesChatCompletionsShape, type ModelEndpointFormat } from '../../contracts/model-endpoint-format.js'

export { redactUrlForLog } from './compat-http-diagnostics.js'
export { DEFAULT_MODEL_STREAM_LIMITS, type ModelStreamLimits } from './model-stream-resource-budget.js'
export { DEFAULT_STREAM_IDLE_TIMEOUT_MS } from './compat-model-support.js'
export type { CompatModelClientConfig } from './compat-model-types.js'

/** Multi-provider HTTP model client with compatible endpoint formats. */
export class CompatModelClient extends CompatModelStreamingClient implements ModelClient {
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const sink = this.config.debugSink
    if (!sink) {
      for await (const chunk of this.streamInner(request, null)) {
        yield this.attributeUsage(chunk, request)
      }
      return
    }
    const round = await startLlmDebugRoundIfEnabled(sink, {
      threadId: request.threadId,
      turnId: request.turnId,
      provider: this.provider,
      model: request.model?.trim() || this.config.model,
      ...(request.trace
        ? {
            roundId: request.trace.roundId,
            step: request.trace.step,
            purpose: request.trace.purpose
          }
        : {}),
      toolCatalog: request.tools.map((tool) => ({
        name: tool.name,
        ...(tool.providerKind ? { providerKind: tool.providerKind } : {}),
        ...(tool.providerId ? { providerId: tool.providerId } : {})
      })),
      redactedRequestValues: [
        ...goalContextTexts(request.history),
        ...(request.redactedRequestValues ?? [])
      ]
    }, warnModelTraceFailure)
    if (!round) {
      for await (const chunk of this.streamInner(request, null)) {
        yield this.attributeUsage(chunk, request)
      }
      return
    }
    try {
      for await (const chunk of this.streamInner(request, round)) {
        const attributed = this.attributeUsage(chunk, request)
        ignoreModelTraceFailure(() => sink.captureChunk(round, attributed))
        yield attributed
      }
    } finally {
      try {
        await sink.finish(round)
      } catch {
        warnModelTraceFailure()
      }
    }
  }

  private attributeUsage(chunk: ModelStreamChunk, request: ModelRequest): ModelStreamChunk {
    if (chunk.kind !== 'usage') return chunk
    const configuredProviderId = this.config.providerId?.trim()
    const requestProviderId = request.providerId?.trim()
    const actualProviderId = configuredProviderId || (
      requestProviderId && requestProviderId !== 'default' ? requestProviderId : undefined
    )
    return {
      ...chunk,
      usage: {
        ...chunk.usage,
        ...(actualProviderId ? { actualProviderId } : {}),
        ...(request.serviceTier === 'priority' ? { serviceTier: 'priority' as const } : {})
      }
    }
  }

  private async *streamInner(
    request: ModelRequest,
    round: LlmDebugRound | null
  ): AsyncIterable<ModelStreamChunk> {
    if (request.abortSignal.aborted) return
    const requestModel = request.model?.trim() || this.config.model
    // Resolve the wire format per request model: a single provider (e.g.
    // OpenCode Go) can route some models to chat completions and others to
    // Anthropic Messages. Falls back to the provider/runtime format.
    const configuredEndpointFormat = this.endpointFormatForModel(requestModel)
    const isCodex = isCodexEndpoint(this.config.baseUrl)
    // Legacy Codex profiles stored `.../codex` + `responses` (or a bare
    // custom path without `/responses`). Normalize before format inference so
    // chat does not fail the custom-endpoint suffix check or hit `/v1/responses`.
    const resolveBaseUrl = isCodex
      ? normalizeCodexResponsesUrl(this.config.baseUrl)
      : this.config.baseUrl
    const endpointFormat = resolveModelEndpointFormat(
      isCodex ? 'custom_endpoint' : configuredEndpointFormat,
      resolveBaseUrl
    )
    if (!endpointFormat) {
      yield {
        kind: 'error',
        message: 'custom full endpoint URL must end with /chat/completions, /completions, /responses, or /messages'
      }
      return
    }
    const url = buildModelEndpointUrl(this.baseUrlForFormat(configuredEndpointFormat), configuredEndpointFormat)
    // Codex Responses only accepts streamed requests; explicit stream:false
    // callers (subagents, background distillations) get forced streaming.
    const stream = isCodex ? true : (request.stream ?? !this.config.nonStreaming)
    const body = this.buildRequestBody(request, stream, { endpointFormat })
    let credentials: { apiKey: string; headers?: Record<string, string>; refreshable: boolean }
    try {
      credentials = this.config.resolveCredentials
        ? await this.config.resolveCredentials()
        : { apiKey: this.config.apiKey, headers: this.config.headers, refreshable: false }
    } catch (error) {
      yield {
        kind: 'error',
        code: 'credential_refresh_failed',
        message: error instanceof Error ? error.message : String(error)
      }
      return
    }
    const responsesLite = isCodexEndpoint(this.config.baseUrl) &&
      this.capabilitiesForModel(requestModel).responsesMode === 'lite'
    const runtimeHeaders = openCodeSessionRuntimeHeaders({
      presetSource: this.config.presetSource,
      providerId: this.config.providerId,
      baseUrl: this.config.baseUrl
    }, request.threadId)
    let headers = this.buildHeaders(stream, endpointFormat, responsesLite, credentials, runtimeHeaders)
    const retry = normalizeModelRequestRetryConfig(this.config.retry)
    const modelStreamLimits = normalizeModelStreamLimits(this.config.streamLimits)
    const maxErrorBodyBytes = Math.min(modelStreamLimits.maxTotalBytes, 1 * 1024 * 1024)
    const retryStatuses = new Set(retry.httpStatusCodes)
    // A per-request retry ceiling (probes pass 0 to fail fast without
    // burning failover state) caps the configured budget.
    const maxRetryAttempts = request.maxRetryAttempts !== undefined
      ? Math.min(retry.maxAttempts, request.maxRetryAttempts)
      : retry.maxAttempts
    let attemptOrdinal = 0
    const post = (
      requestBody: Record<string, unknown>,
      reason: 'initial' | 'transport_retry' | 'credential_refresh' | 'stream_options_fallback' | 'request_fallback'
    ) => this.postChatCompletion(url, headers, requestBody, request.abortSignal, {
      round,
      endpointFormat,
      attempt: ++attemptOrdinal,
      reason,
      apiKey: credentials.apiKey
    })
    let result = await post(body, 'initial')
    let transportRetryAttempt = 0
    let credentialRefreshAttempted = false
    let terminalErrorBody: { text: string; exceeded: boolean } | undefined
    let rateLimitRecoveryMs: number | undefined
    while (true) {
      if (result.kind === 'error') {
        // With declared failover alternatives a same-target network retry is
        // capped at one fast attempt — waiting out backoff just delays the
        // switch the user configured.
        const failoverCap = (request.failover?.alternatives ?? 0) > 0
          ? Math.min(1, maxRetryAttempts)
          : maxRetryAttempts
        if (
          request.abortSignal.aborted ||
          result.failure.failoverAllowed === false ||
          transportRetryAttempt >= failoverCap
        ) break
        const nextAttempt = transportRetryAttempt + 1
        const delayMs = Math.min(
          (request.failover?.alternatives ?? 0) > 0 ? 3_000 : Number.MAX_SAFE_INTEGER,
          exponentialRetryDelayMs(retry.initialDelayMs, transportRetryAttempt)
        )
        const failureSummary = summarizeModelRetryFailure(result.message, [credentials.apiKey])
        yield {
          kind: 'retrying',
          attempt: nextAttempt,
          maxAttempts: maxRetryAttempts,
          delayMs,
          reason: 'network',
          ...(failureSummary ? { failureSummary } : {})
        }
        const aborted = await sleepWithAbort(delayMs, request.abortSignal)
        if (aborted || request.abortSignal.aborted) {
          return
        }
        transportRetryAttempt = nextAttempt
        result = await post(body, 'transport_retry')
        continue
      }
      if (result.response.ok) break
      if (
        result.response.status === 401 &&
        credentials.refreshable &&
        this.config.resolveCredentials &&
        !credentialRefreshAttempted
      ) {
        credentialRefreshAttempted = true
        await result.response.body?.cancel().catch(() => {})
        try {
          credentials = await this.config.resolveCredentials(credentials.apiKey)
        } catch (error) {
          yield {
            kind: 'error',
            code: 'credential_refresh_failed',
            message: error instanceof Error ? error.message : String(error)
          }
          return
        }
        headers = this.buildHeaders(stream, endpointFormat, responsesLite, credentials, runtimeHeaders)
        result = await post(body, 'credential_refresh')
        continue
      }
      if (!retryStatuses.has(result.response.status)) break
      // Read the body once: the failure classifier and any terminal error
      // report share it, so a consumed response never gets read twice.
      const status = result.response.status
      const errorBody = await readLimitedResponseText(result.response, maxErrorBodyBytes)
      const { classification, budget } = httpFailureRetryDecision({
        status,
        body: errorBody.exceeded ? '' : errorBody.text,
        headers: result.response.headers,
        alternatives: request.failover?.alternatives,
        policyMaxAttempts: maxRetryAttempts
      })
      if (transportRetryAttempt >= budget.maxAttempts) {
        // Long rate-limit waits surface the recovery instant so the user can
        // retry deliberately instead of watching the turn stall.
        if (classification.reason === 'rate') {
          rateLimitRecoveryMs = classification.retryAfterMs
        }
        terminalErrorBody = errorBody
        break
      }
      const delayMs = retryDelayForBudget({
        response: result.response,
        budget,
        initialDelayMs: retry.initialDelayMs,
        attempt: transportRetryAttempt
      })
      const failureSummary = errorBody.exceeded
        ? `model error response exceeded ${maxErrorBodyBytes} bytes`
        : summarizeModelRetryFailure(summarizeHttpErrorBody(errorBody.text), [credentials.apiKey])
      yield {
        kind: 'retrying',
        status,
        attempt: transportRetryAttempt + 1,
        maxAttempts: maxRetryAttempts,
        delayMs,
        ...(failureSummary ? { failureSummary } : {})
      }
      const aborted = await sleepWithAbort(delayMs, request.abortSignal)
      if (aborted || request.abortSignal.aborted) {
        return
      }
      transportRetryAttempt += 1
      result = await post(body, 'transport_retry')
    }
    if (result.kind === 'error') {
      // Abort (user stop / tool cancel / host shutdown) owns the terminal
      // outcome. Do not surface the racing transport error as a turn failure.
      if (request.abortSignal.aborted) return
      yield {
        kind: 'error',
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
        failure: result.failure
      }
      return
    }
    let response = result.response
    if (!response.ok) {
      const errorBody = terminalErrorBody ?? await readLimitedResponseText(response, maxErrorBodyBytes)
      if (errorBody.exceeded) {
        yield {
          kind: 'error',
          message: `model error response exceeded ${maxErrorBodyBytes} bytes`,
          code: 'response_body_too_large'
        }
        return
      }
      const text = errorBody.text
      let forcedStream = false
      let retryBody: Record<string, unknown> | null = null
      let retryReason: 'stream_options_fallback' | 'request_fallback' = 'request_fallback'
      if (!stream && isStreamRequiredError(response.status, text)) {
        forcedStream = true
        headers = this.buildHeaders(true, endpointFormat, responsesLite, credentials, runtimeHeaders)
        retryBody = this.buildRequestBody(request, true, { endpointFormat })
      } else if (shouldRetryWithoutSamplingParams(response.status, text, body)) {
        retryBody = stripSamplingFromBody(body)
        retryReason = 'stream_options_fallback'
      } else if (
        usesChatCompletionsShape(endpointFormat) &&
        shouldRetryWithoutStreamUsage(response.status, text, body)
      ) {
        retryBody = this.buildRequestBody(request, stream, { endpointFormat, includeStreamUsage: false })
        retryReason = 'stream_options_fallback'
      } else if (
        usesChatCompletionsShape(endpointFormat) &&
        shouldRetryWithReasoningRoundTrip(response.status, text, body)
      ) {
        retryBody = this.buildRequestBody(request, stream, { endpointFormat, forceReasoningRoundTrip: true })
      } else if (
        endpointFormat === 'responses' &&
        shouldDropUnreplayableToolRounds(response.status, text, body)
      ) {
        retryBody = this.buildRequestBody(request, stream, {
          endpointFormat,
          dropUnreplayableResponsesToolRounds: true
        })
      }
      if (retryBody) {
        const fallbackResult = await post(retryBody, retryReason)
        if (fallbackResult.kind === 'error') {
          yield {
            kind: 'error',
            message: fallbackResult.message,
            ...(fallbackResult.code ? { code: fallbackResult.code } : {}),
            failure: fallbackResult.failure
          }
          return
        }
        response = fallbackResult.response
        if (response.ok) {
          if (
            (this.config.nonStreaming && !forcedStream) ||
            response.headers.get('content-type')?.includes('application/json')
          ) {
            const json = await readLimitedResponseJson(response, modelStreamLimits.maxTotalBytes)
            if (json.kind === 'limit') {
              yield {
                kind: 'error',
                message: `model response exceeded ${json.maxBytes} bytes`,
                code: 'stream_resource_limit'
              }
              return
            }
            if (json.kind === 'invalid_json') {
              yield { kind: 'error', message: `model response contained invalid JSON: ${json.message}` }
              return
            }
            yield* materializeCompatNonStreaming(
              json.value as ChatCompletionResponse,
              endpointFormat,
              requestModel,
              modelStreamLimits,
              {
                normalizeUsage: (usage) => this.mapUsage(usage, requestModel),
                parseToolArguments: (raw) => this.parseToolArguments(raw)
              }
            )
            return
          }
          if (!response.body) {
            yield { kind: 'error', message: 'model response had no body' }
            return
          }
          yield* this.streamSseWithRecovery({
            response,
            request,
            endpointFormat,
            configuredEndpointFormat,
            model: requestModel,
            retry,
            usedRetryAttempts: transportRetryAttempt,
            post: () => post(retryBody, 'transport_retry'),
            url,
            maxErrorBodyBytes,
            streamLimits: modelStreamLimits,
            knownSecrets: [credentials.apiKey]
          })
          return
        }
        const retryErrorBody = await readLimitedResponseText(response, maxErrorBodyBytes)
        if (retryErrorBody.exceeded) {
          yield {
            kind: 'error',
            message: `model error response exceeded ${maxErrorBodyBytes} bytes`,
            code: 'response_body_too_large'
          }
          return
        }
        const retryText = retryErrorBody.text
        this.logHttpFailure({
          url,
          status: response.status,
          body: retryText,
          endpointFormat,
          configuredEndpointFormat,
          model: requestModel
        })
        const retryClassified = await this.classifyHttpError(response.status, retryText, response.headers.get('retry-after'), response.headers)
        yield {
          kind: 'error',
          message: retryClassified.message,
          code: retryClassified.code,
          failure: retryClassified.failure
        }
        return
      }
      this.logHttpFailure({
        url,
        status: response.status,
        body: text,
        endpointFormat,
        configuredEndpointFormat,
        model: requestModel
      })
      const classified = await this.classifyHttpError(response.status, text, response.headers.get('retry-after'), response.headers)
      yield {
        kind: 'error',
        message: `${classified.message}${rateLimitRecoverySuffix(rateLimitRecoveryMs)}`,
        code: classified.code,
        failure: classified.failure
      }
      return
    }
    if (this.config.nonStreaming || response.headers.get('content-type')?.includes('application/json')) {
      const json = await readLimitedResponseJson(response, modelStreamLimits.maxTotalBytes)
      if (json.kind === 'limit') {
        yield {
          kind: 'error',
          message: `model response exceeded ${json.maxBytes} bytes`,
          code: 'stream_resource_limit'
        }
        return
      }
      if (json.kind === 'invalid_json') {
        yield { kind: 'error', message: `model response contained invalid JSON: ${json.message}` }
        return
      }
      yield* materializeCompatNonStreaming(
        json.value as ChatCompletionResponse,
        endpointFormat,
        requestModel,
        modelStreamLimits,
        {
          normalizeUsage: (usage) => this.mapUsage(usage, requestModel),
          parseToolArguments: (raw) => this.parseToolArguments(raw)
        }
      )
      return
    }
    if (!response.body) {
      yield { kind: 'error', message: 'model response had no body' }
      return
    }
    yield* this.streamSseWithRecovery({
      response,
      request,
      endpointFormat,
      configuredEndpointFormat,
      model: requestModel,
      retry,
      usedRetryAttempts: transportRetryAttempt,
      post: () => post(body, 'transport_retry'),
      url,
      maxErrorBodyBytes,
      streamLimits: modelStreamLimits,
      knownSecrets: [credentials.apiKey]
    })
  }

}
