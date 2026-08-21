import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { goalContextTexts } from '../../contracts/items.js'
import { startLlmDebugRoundIfEnabled, type LlmDebugRound } from '../../services/llm-debug-recorder.js'
import { exponentialRetryDelayMs, normalizeModelRequestRetryConfig, retryDelayMs, sleepWithAbort } from './compat-retry-policy.js'
import { CompatModelStreamingClient } from './compat-model-client-stream.js'
import { summarizeModelRetryFailure } from './model-retry-failure-summary.js'
import { summarizeHttpErrorBody } from './compat-http-diagnostics.js'
import type { ChatCompletionResponse, CompatModelClientConfig, CompatPostResult } from './compat-model-types.js'
import {
  buildChatCompletionsUrl,
  buildModelEndpointUrl,
  ignoreModelTraceFailure,
  isCodexEndpoint,
  normalizeCodexResponsesUrl,
  normalizeModelStreamLimits,
  normalizeStreamIdleTimeoutMs,
  readLimitedResponseJson,
  readLimitedResponseText,
  reasoningFromMessage,
  shouldRetryWithoutSamplingParams,
  shouldRetryWithoutStreamUsage,
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
    if (request.abortSignal.aborted) {
      yield { kind: 'error', message: 'request was aborted before start' }
      return
    }
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
    const url = buildModelEndpointUrl(this.config.baseUrl, configuredEndpointFormat)
    const stream = request.stream ?? !this.config.nonStreaming
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
    let headers = this.buildHeaders(stream, endpointFormat, responsesLite, credentials)
    const retry = normalizeModelRequestRetryConfig(this.config.retry)
    const modelStreamLimits = normalizeModelStreamLimits(this.config.streamLimits)
    const maxErrorBodyBytes = Math.min(modelStreamLimits.maxTotalBytes, 1 * 1024 * 1024)
    const retryStatuses = new Set(retry.httpStatusCodes)
    let attemptOrdinal = 0
    const post = (
      requestBody: Record<string, unknown>,
      reason: 'initial' | 'transport_retry' | 'credential_refresh' | 'stream_options_fallback'
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
    while (true) {
      if (result.kind === 'error') {
        if (
          request.abortSignal.aborted ||
          result.failure.failoverAllowed === false ||
          transportRetryAttempt >= retry.maxAttempts
        ) break
        const nextAttempt = transportRetryAttempt + 1
        const delayMs = exponentialRetryDelayMs(retry.initialDelayMs, transportRetryAttempt)
        const failureSummary = summarizeModelRetryFailure(result.message, [credentials.apiKey])
        yield {
          kind: 'retrying',
          attempt: nextAttempt,
          maxAttempts: retry.maxAttempts,
          delayMs,
          reason: 'network',
          ...(failureSummary ? { failureSummary } : {})
        }
        const aborted = await sleepWithAbort(delayMs, request.abortSignal)
        if (aborted || request.abortSignal.aborted) {
          yield { kind: 'error', message: 'request was aborted during retry backoff' }
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
        headers = this.buildHeaders(stream, endpointFormat, responsesLite, credentials)
        result = await post(body, 'credential_refresh')
        continue
      }
      if (
        transportRetryAttempt >= retry.maxAttempts ||
        !retryStatuses.has(result.response.status)
      ) break
      const delayMs = retryDelayMs(result.response, retry.initialDelayMs, transportRetryAttempt)
      const status = result.response.status
      const errorBody = await readLimitedResponseText(result.response, maxErrorBodyBytes)
      const failureSummary = errorBody.exceeded
        ? `model error response exceeded ${maxErrorBodyBytes} bytes`
        : summarizeModelRetryFailure(summarizeHttpErrorBody(errorBody.text), [credentials.apiKey])
      yield {
        kind: 'retrying',
        status,
        attempt: transportRetryAttempt + 1,
        maxAttempts: retry.maxAttempts,
        delayMs,
        ...(failureSummary ? { failureSummary } : {})
      }
      const aborted = await sleepWithAbort(delayMs, request.abortSignal)
      if (aborted || request.abortSignal.aborted) {
        yield { kind: 'error', message: 'request was aborted during retry backoff' }
        return
      }
      transportRetryAttempt += 1
      result = await post(body, 'transport_retry')
    }
    if (result.kind === 'error') {
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
      const errorBody = await readLimitedResponseText(response, maxErrorBodyBytes)
      if (errorBody.exceeded) {
        yield {
          kind: 'error',
          message: `model error response exceeded ${maxErrorBodyBytes} bytes`,
          code: 'response_body_too_large'
        }
        return
      }
      const text = errorBody.text
      const retryBody = shouldRetryWithoutSamplingParams(response.status, text, body)
        ? stripSamplingFromBody(body)
        : (
          usesChatCompletionsShape(endpointFormat) &&
            shouldRetryWithoutStreamUsage(response.status, text, body)
            ? this.buildRequestBody(request, stream, { endpointFormat, includeStreamUsage: false })
            : null
        )
      if (retryBody) {
        const fallbackResult = await post(retryBody, 'stream_options_fallback')
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
            yield* this.materializeNonStreaming(
              json.value as ChatCompletionResponse,
              endpointFormat,
              requestModel,
              modelStreamLimits
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
        const retryClassified = await this.classifyHttpError(response.status, retryText, response.headers.get('retry-after'))
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
      const classified = await this.classifyHttpError(response.status, text, response.headers.get('retry-after'))
      yield {
        kind: 'error',
        message: classified.message,
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
      yield* this.materializeNonStreaming(
        json.value as ChatCompletionResponse,
        endpointFormat,
        requestModel,
        modelStreamLimits
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
