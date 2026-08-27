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
  redactUrlForLog
} from './compat-http-diagnostics.js'
import type { CompatChatMessage } from './compat-request-codecs.js'
import { projectCompatMessages } from './compat-message-projector.js'
import {
  codexModelSupportsNativeImageGeneration,
  createCompatRequestCodecs,
  normalizeToolSpecs,
  requiresReasoningRoundTrip
} from './compat-request-builder.js'
import { decodeChatCompletionsStreamPayload } from './chat-completions-stream-decoder.js'
import {
  createResponsesContentTracker,
  decodeResponsesStreamPayload
} from './responses-stream-decoder.js'
import {
  createAnthropicThinkingState,
  decodeAnthropicMessagesStreamPayload
} from './anthropic-messages-stream-decoder.js'
import { decodeCompatNonStreamingResponse } from './compat-non-streaming-decoder.js'
import type { CompatModelClientConfig, ChatMessage, CompatPostResult } from './compat-model-types.js'
import { isCodexEndpoint, ignoreModelTraceFailure } from './compat-model-support.js'
import { isDeepSeekHost } from './model-error-probe.js'

export class CompatModelClientBase {
  readonly provider = 'compat'
  readonly model: string

  protected readonly config: CompatModelClientConfig
  protected readonly fetchImpl: typeof fetch
  protected readonly codexSessionId: string | undefined

  constructor(config: CompatModelClientConfig) {
    this.config = config
    this.model = config.model
    this.fetchImpl = config.fetchImpl ?? createProxyFetch(config.modelProxyUrl ?? '') ?? fetch
    this.codexSessionId = isCodexEndpoint(config.baseUrl)
      ? config.headers?.session_id?.trim() || randomUUID()
      : undefined
  }

  protected endpointFormat(): ModelEndpointFormat {
    return normalizeModelEndpointFormat(this.config.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT)
  }

  /**
   * The wire format for a specific model: a per-model override (carried on
   * the model's capability metadata) takes precedence over the
   * provider/runtime format. Lets one provider mix chat completions and
   * Anthropic Messages models (e.g. OpenCode Go's minimax/qwen entries).
   */
  protected endpointFormatForModel(model: string): ModelEndpointFormat {
    return this.capabilitiesForModel(model).endpointFormat
  }

  protected modelReasoningFor(model: string): ModelCapabilityMetadata['reasoning'] | undefined {
    return this.capabilitiesForModel(model).reasoning
  }

  /** Per-model output-token cap from capability metadata, if declared. */
  protected maxOutputTokensFor(model: string): number | undefined {
    return this.capabilitiesForModel(model).maxOutputTokens
  }

  protected capabilitiesForModel(model: string) {
    return resolveCompatModelCapabilities({
      model,
      providerEndpointFormat: this.config.endpointFormat,
      modelCapabilities: this.config.modelCapabilities
    })
  }

  /**
   * Resolves the output-token cap for a request: an explicit request value
   * wins, then the per-model capability override, then the supplied default.
   */
  protected resolveMaxTokens(
    request: ModelRequest,
    model: string,
    fallback?: number
  ): number | undefined {
    return request.maxTokens ?? this.maxOutputTokensFor(model) ?? fallback
  }

  protected async postChatCompletion(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    signal: AbortSignal,
    trace: {
      round: LlmDebugRound | null
      endpointFormat: ModelEndpointFormat
      attempt: number
      reason: 'initial' | 'transport_retry' | 'credential_refresh' | 'stream_options_fallback'
      apiKey: string
    }
  ): Promise<CompatPostResult> {
    const bodyText = JSON.stringify(body)
    const traceRound = trace.round
    const traceSink = this.config.debugSink
    const traceRecord = traceRound && traceSink
      ? ignoreModelTraceFailure(() => traceSink.beginHttpAttempt(traceRound, {
          endpointFormat: trace.endpointFormat,
          attempt: trace.attempt,
          reason: trace.reason,
          url,
          headers,
          bodyText,
          secretValues: [trace.apiKey]
        }))
      : undefined
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: bodyText,
        signal
      })
      if (traceRound && traceSink && traceRecord) {
        ignoreModelTraceFailure(() => {
          traceSink.captureHttpResponse(traceRound, traceRecord, response)
        })
      }
      return { kind: 'response', response }
    } catch (error) {
      if (traceRecord) {
        ignoreModelTraceFailure(() => traceSink?.captureHttpError(traceRecord, error))
      }
      const message = describeTransportFailure(error)
      // Only blame the proxy for genuine transport failures. A user-initiated
      // abort (turn cancelled, idle-timeout watchdog) also surfaces here as an
      // AbortError but has nothing to do with the proxy — don't send the user
      // chasing a proxy that is working fine.
      const aborted = error instanceof Error && error.name === 'AbortError'
      const proxyHint = !aborted && this.config.modelProxyUrl?.trim()
        ? '. Check the configured model-request proxy in Settings > Providers.'
        : ''
      const timeout = /timeout|timed out/i.test(message)
      return {
        kind: 'error',
        code: 'model_provider_unreachable',
        message: `model provider did not return a response from ${redactUrlForLog(url)}: ${message}${proxyHint}`,
        failure: { category: timeout ? 'timeout' : 'network', failoverAllowed: !aborted }
      }
    }
  }

  protected buildHeaders(
    stream: boolean,
    endpointFormat: ModelEndpointFormat,
    responsesLite = false,
    credentials: {
      apiKey: string
      headers?: Record<string, string>
    } = {
      apiKey: this.config.apiKey,
      headers: this.config.headers
    }
  ): Record<string, string> {
    const configuredHeaders = {
      ...(this.config.headers ?? {}),
      ...(credentials.headers ?? {})
    }
    // Protected credentials are resolved before every request and may
    // materialize a fresh session_id. Keep transport identity owned by this
    // client so credential refresh cannot invalidate Codex prompt routing.
    if (this.codexSessionId) configuredHeaders.session_id = this.codexSessionId
    return buildCompatRequestHeaders({
      apiKey: credentials.apiKey,
      configuredHeaders,
      stream,
      endpointFormat,
      responsesLite
    })
  }

  protected async classifyHttpError(status: number, text: string, retryAfter?: string | null) {
    return classifyCompatHttpError({
      status,
      text,
      baseUrl: this.config.baseUrl,
      fetchImpl: this.fetchImpl,
      retryAfter
    })
  }

  protected logHttpFailure(input: {
    url: string
    status: number
    body: string
    endpointFormat: ModelEndpointFormat
    configuredEndpointFormat: ModelEndpointFormat
    model: string
  }): void {
    console.warn('[kun:model] model HTTP request failed', compatHttpFailureLog({
      provider: this.provider,
      status: input.status,
      model: input.model,
      configuredModel: this.config.model,
      baseUrl: this.config.baseUrl,
      requestUrl: input.url,
      endpointFormat: input.endpointFormat,
      configuredEndpointFormat: input.configuredEndpointFormat,
      body: input.body
    }))
  }

  protected buildRequestBody(
    request: ModelRequest,
    stream: boolean,
    options: { endpointFormat?: ModelEndpointFormat; includeStreamUsage?: boolean } = {}
  ): Record<string, unknown> {
    const requestModel = request.model?.trim()
    const model = requestModel || this.config.model
    const messages = this.collectMessages(request, model)
    const endpointFormat = options.endpointFormat ?? this.endpointFormat()
    const tools = normalizeToolSpecs(request.tools)
    const reasoning = this.modelReasoningFor(model)
    const isCodex = isCodexEndpoint(this.config.baseUrl)
    const isCodexLite = isCodex && this.capabilitiesForModel(model).responsesMode === 'lite'
    const codecs = createCompatRequestCodecs()
    return codecs.build({
      request,
      model,
      messages,
      tools,
      stream,
      endpointFormat,
      includeStreamUsage: options.includeStreamUsage,
      baseUrl: this.config.baseUrl,
      reasoning,
      maxTokens: this.resolveMaxTokens(request, model),
      isCodex,
      isCodexLite,
      serviceTiers: this.capabilitiesForModel(model).serviceTiers,
      codexNativeImageGeneration: codexModelSupportsNativeImageGeneration(model)
    })
  }

  protected collectMessages(request: ModelRequest, model: string): ChatMessage[] {
    return projectCompatMessages(request, {
      historyLimit: this.config.historyLimit,
      thinkingMode: requiresReasoningRoundTrip(
        request.reasoningEffort,
        model,
        this.config.baseUrl,
        this.modelReasoningFor(model)
      ),
      strictThinkingToolReplay: isDeepSeekHost(this.config.baseUrl),
      supportsImages: this.modelSupportsImageInput(model)
    })
  }

  /**
   * Whether the resolved model accepts image input. Tool-result images are
   * only forwarded as real image parts to vision models; text-only models
   * get a text summary instead. Defaults to true when no capability
   * resolver is configured (the runtime always sets one).
   */
  protected modelSupportsImageInput(model: string): boolean {
    if (!this.config.modelCapabilities) return true
    return this.capabilitiesForModel(model).supportsVision
  }

  protected mapUsage(usage: Record<string, unknown>, model = this.config.model): UsageSnapshot {
    return normalizeCompatUsage({
      usage,
      model,
      providerBaseUrl: this.config.baseUrl,
      ...(this.config.billingKind ? { billingKind: this.config.billingKind } : {}),
      ...(this.capabilitiesForModel(model).pricing
        ? { catalogPricing: this.capabilitiesForModel(model).pricing }
        : {})
    })
  }

  protected parseToolArguments(raw: string): Record<string, unknown> {
    return repairToolArguments(raw).arguments
  }
}

/**
 * Native fetch intentionally exposes a terse "fetch failed" wrapper. Keep
 * the underlying cause when available so a connection failure explains why
 * the provider never responded (DNS, TLS, timeout, and similar cases).
 */
function describeTransportFailure(error: unknown): string {
  const messages: string[] = []
  let current: unknown = error
  for (let depth = 0; current && depth < 4; depth += 1) {
    const candidate = current as { message?: unknown; cause?: unknown; code?: unknown }
    const message = typeof candidate.message === 'string' ? candidate.message.trim() : ''
    const code = typeof candidate.code === 'string' ? candidate.code.trim() : ''
    const detail = [message, code && !message.includes(code) ? `(${code})` : ''].filter(Boolean).join(' ')
    if (detail && !messages.includes(detail)) messages.push(detail)
    current = candidate.cause
  }
  return messages.join(' → ').slice(0, 1_024) || 'unknown transport failure'
}
