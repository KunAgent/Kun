import { randomUUID } from 'node:crypto'
import { goalContextTexts } from '../../contracts/items.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import {
  startLlmDebugRoundIfEnabled,
  type LlmDebugRound,
  type LlmDebugSink
} from '../../services/llm-debug-recorder.js'
import { createProxyFetch } from './proxy-fetch.js'
import { summarizeModelRetryFailure } from './model-retry-failure-summary.js'
import {
  GeminiCliApiHttpError,
  buildGeminiCliCodeAssistRequest,
  geminiErrorCode,
  geminiHeaders,
  geminiProviderMetadata,
  geminiRetryDelayMs,
  isUnauthorized,
  normalizeGeminiUsage,
  objectValue,
  providerErrorMessage,
  readGeminiError,
  readGeminiSse,
  safeDebug,
  safeErrorMessage,
  traceSafeBody,
  type GeminiUsageMetadata
} from './gemini-cli-api-codec.js'
import { GeminiCliOAuthSource } from './gemini-cli-oauth.js'
import {
  exponentialRetryDelayMs,
  normalizeModelRequestRetryConfig,
  sleepWithAbort
} from './compat-retry-policy.js'
import { classifyModelFailure, httpRetryBudget, modelFailureMetadata } from './failure-reason.js'
import type { ModelRequestRetryConfig } from '../../config/kun-config.js'
export const GEMINI_CLI_CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
export const GEMINI_CLI_CODE_ASSIST_API_VERSION = 'v1internal'


export type GeminiCliApiModelClientConfig = {
  model: string
  modelProxyUrl?: string
  endpoint?: string
  apiVersion?: string
  fetchImpl?: typeof fetch
  oauthSource?: GeminiCliOAuthSource
  debugSink?: LlmDebugSink
  retry?: ModelRequestRetryConfig
}


type GeminiCodeAssistSetup = {
  currentTier?: { id?: string }
  paidTier?: { id?: string }
  cloudaicompanionProject?: string
  ineligibleTiers?: Array<{ reasonMessage?: string }>
  error?: { code?: number; status?: string; message?: string }
}

/**
 * Native Kun model client for the official Gemini CLI's Google subscription
 * API path. Unlike Antigravity it does not delegate the whole turn: Kun keeps
 * history, tools, approvals, compaction, retries, and SSE ownership.
 */
export class GeminiCliApiModelClient implements ModelClient {
  readonly provider = 'gemini-cli-api'
  readonly model: string
  readonly config: {
    baseUrl: string
    endpointFormat: 'custom_endpoint'
  }

  private readonly fetchImpl: typeof fetch
  private readonly oauthSource: GeminiCliOAuthSource
  private readonly debugSink?: LlmDebugSink
  private readonly endpoint: string
  private readonly apiVersion: string
  private readonly retry: ReturnType<typeof normalizeModelRequestRetryConfig>
  private projectId: string | undefined

  constructor(config: GeminiCliApiModelClientConfig) {
    this.model = config.model
    this.endpoint = (config.endpoint ??
      process.env.CODE_ASSIST_ENDPOINT?.trim() ??
      GEMINI_CLI_CODE_ASSIST_ENDPOINT).replace(/\/+$/, '')
    this.apiVersion = (config.apiVersion ??
      process.env.CODE_ASSIST_API_VERSION?.trim() ??
      GEMINI_CLI_CODE_ASSIST_API_VERSION).replace(/^\/+|\/+$/g, '')
    this.config = {
      baseUrl: `${this.endpoint}/${this.apiVersion}`,
      endpointFormat: 'custom_endpoint'
    }
    this.fetchImpl = config.fetchImpl ??
      createProxyFetch(config.modelProxyUrl ?? '') ??
      fetch
    this.oauthSource = config.oauthSource ?? new GeminiCliOAuthSource({
      fetchImpl: this.fetchImpl
    })
    this.debugSink = config.debugSink
    this.retry = normalizeModelRequestRetryConfig(config.retry)
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const round = await this.startDebugRound(request)
    try {
      for await (const chunk of this.streamInner(request, round)) {
        safeDebug(() => this.debugSink?.captureChunk(round!, chunk))
        yield chunk
      }
    } finally {
      if (round && this.debugSink) {
        await this.debugSink.finish(round).catch(() => {})
      }
    }
  }

  private async *streamInner(
    request: ModelRequest,
    round: LlmDebugRound | null
  ): AsyncIterable<ModelStreamChunk> {
    if (request.abortSignal.aborted) {
      yield { kind: 'error', code: 'request_aborted', message: 'request was aborted before start' }
      return
    }

    let accessToken: string
    try {
      accessToken = await this.oauthSource.accessToken()
    } catch (error) {
      if (round && this.debugSink) {
        safeDebug(() => this.debugSink!.recordPhaseDiagnostic?.(round, {
          phase: 'credential',
          failureOrigin: 'credential',
          code: 'gemini_cli_login_required',
          message: safeErrorMessage(error)
        }))
      }
      yield {
        kind: 'error',
        code: 'gemini_cli_login_required',
        message: safeErrorMessage(error)
      }
      return
    }

    try {
      this.projectId = this.projectId ?? await this.loadProject(accessToken, request.abortSignal, round)
    } catch (error) {
      if (isUnauthorized(error)) {
        try {
          accessToken = await this.oauthSource.accessToken(accessToken)
          this.projectId = await this.loadProject(accessToken, request.abortSignal, round)
        } catch (retryError) {
          if (round && this.debugSink) {
            safeDebug(() => this.debugSink!.recordPhaseDiagnostic?.(round, {
              phase: 'credential',
              failureOrigin: 'credential',
              code: 'gemini_cli_auth_failed',
              message: safeErrorMessage(retryError)
            }))
          }
          yield {
            kind: 'error',
            code: 'gemini_cli_auth_failed',
            message: safeErrorMessage(retryError)
          }
          return
        }
      } else {
        yield {
          kind: 'error',
          code: 'gemini_cli_setup_failed',
          message: safeErrorMessage(error)
        }
        return
      }
    }

    const model = request.model?.trim() || this.model
    const body = buildGeminiCliCodeAssistRequest(request, model, this.projectId)
    let attemptOrdinal = 0
    const post = (
      reason: 'initial' | 'credential_refresh' | 'transport_retry'
    ) => this.postStream({
      body,
      accessToken,
      signal: request.abortSignal,
      round,
      attempt: ++attemptOrdinal,
      reason
    })
    let result = await post('initial')
    let credentialRefreshAttempted = false
    let transportRetryAttempt = 0
    let terminalProviderError: Awaited<ReturnType<typeof readGeminiError>> | undefined
    const retryStatuses = new Set(this.retry.httpStatusCodes)
    while (true) {
      if (result.error) {
        if (
          request.abortSignal.aborted ||
          transportRetryAttempt >= this.retry.maxAttempts
        ) break
        const nextAttempt = transportRetryAttempt + 1
        const delayMs = exponentialRetryDelayMs(
          this.retry.initialDelayMs,
          transportRetryAttempt
        )
        const failureSummary = summarizeModelRetryFailure(result.error, [accessToken])
        yield {
          kind: 'retrying',
          attempt: nextAttempt,
          maxAttempts: this.retry.maxAttempts,
          delayMs,
          reason: 'network',
          ...(failureSummary ? { failureSummary } : {})
        }
        const aborted = await sleepWithAbort(delayMs, request.abortSignal)
        if (aborted || request.abortSignal.aborted) {
          yield {
            kind: 'error',
            code: 'request_aborted',
            message: 'Gemini CLI API request was aborted during retry backoff.'
          }
          return
        }
        transportRetryAttempt = nextAttempt
        result = await post('transport_retry')
        continue
      }
      if (!result.response || result.response.ok) break
      if (result.response.status === 401 && !credentialRefreshAttempted) {
        credentialRefreshAttempted = true
        await result.response.body?.cancel().catch(() => {})
        try {
          accessToken = await this.oauthSource.accessToken(accessToken)
        } catch (error) {
          if (round && this.debugSink) {
            safeDebug(() => this.debugSink!.recordPhaseDiagnostic?.(round, {
              phase: 'credential',
              failureOrigin: 'credential',
              code: 'gemini_cli_auth_failed',
              message: safeErrorMessage(error)
            }))
          }
          yield {
            kind: 'error',
            code: 'gemini_cli_auth_failed',
            message: safeErrorMessage(error)
          }
          return
        }
        result = await post('credential_refresh')
        continue
      }
      if (!retryStatuses.has(result.response.status)) break
      const status = result.response.status
      const providerError = await readGeminiError(result.response)
      const classification = classifyModelFailure({
        status,
        providerCode: providerError.status,
        body: providerError.message,
        headers: result.response.headers,
        retryAfterMs: providerError.retryAfterMs
      })
      const budget = httpRetryBudget({
        reason: classification.reason,
        retryAfterMs: classification.retryAfterMs ?? providerError.retryAfterMs,
        alternatives: request.failover?.alternatives,
        policy: this.retry
      })
      if (transportRetryAttempt >= budget.maxAttempts) {
        terminalProviderError = providerError
        break
      }
      const delayMs = await geminiRetryDelayMs(
        result.response,
        this.retry.initialDelayMs,
        transportRetryAttempt
      )
      const failureSummary = summarizeModelRetryFailure(providerError.message, [accessToken])
      yield {
        kind: 'retrying',
        status,
        attempt: transportRetryAttempt + 1,
        maxAttempts: this.retry.maxAttempts,
        delayMs,
        ...(failureSummary ? { failureSummary } : {})
      }
      const aborted = await sleepWithAbort(delayMs, request.abortSignal)
      if (aborted || request.abortSignal.aborted) {
        yield {
          kind: 'error',
          code: 'request_aborted',
          message: 'Gemini CLI API request was aborted during retry backoff.'
        }
        return
      }
      transportRetryAttempt += 1
      result = await post('transport_retry')
    }
    if (result.error) {
      yield {
        kind: 'error',
        code: request.abortSignal.aborted ? 'request_aborted' : 'gemini_cli_api_network_error',
        message: result.error
      }
      return
    }
    const response = result.response!
    if (!response.ok) {
      const error = terminalProviderError ?? await readGeminiError(response)
      yield {
        kind: 'error',
        code: geminiErrorCode(response.status, error.status),
        message: error.message,
        failure: {
          ...modelFailureMetadata({
            status: response.status,
            providerCode: error.status,
            body: error.message,
            headers: response.headers,
            retryAfterMs: error.retryAfterMs
          })
        }
      }
      return
    }
    if (!response.body) {
      yield {
        kind: 'error',
        code: 'gemini_cli_api_empty_response',
        message: 'Gemini CLI API returned no response body.'
      }
      return
    }

    let sawToolCall = false
    let sawContent = false
    let finishReason = ''
    let latestUsage: GeminiUsageMetadata | undefined
    try {
      for await (const payload of readGeminiSse(response.body, request.abortSignal)) {
        const candidate = payload.response?.candidates?.[0]
        finishReason = candidate?.finishReason ?? finishReason
        latestUsage = payload.response?.usageMetadata ?? latestUsage
        for (const part of candidate?.content?.parts ?? []) {
          if (typeof part.text === 'string' && part.text) {
            sawContent = true
            yield part.thought
              ? { kind: 'assistant_reasoning_delta', text: part.text }
              : { kind: 'assistant_text_delta', text: part.text }
          }
          if (part.functionCall?.name) {
            sawContent = true
            sawToolCall = true
            const providerMetadata = geminiProviderMetadata(part.thoughtSignature)
            yield {
              kind: 'tool_call_complete',
              callId: part.functionCall.id?.trim() || randomUUID(),
              toolName: part.functionCall.name,
              arguments: objectValue(part.functionCall.args),
              ...(providerMetadata ? { providerMetadata } : {})
            }
          }
          if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('image/')) {
            sawContent = true
            yield {
              kind: 'image_generation_complete',
              imageBase64: part.inlineData.data,
              mimeType: part.inlineData.mimeType
            }
          }
        }
        const blockReason = payload.response?.promptFeedback?.blockReason
        if (blockReason && !sawContent) {
          throw new Error(
            `Gemini CLI API blocked the request: ${
              payload.response?.promptFeedback?.blockReasonMessage || blockReason
            }`
          )
        }
      }
    } catch (error) {
      yield {
        kind: 'error',
        code: request.abortSignal.aborted ? 'request_aborted' : 'gemini_cli_api_stream_failed',
        message: safeErrorMessage(error)
      }
      return
    }

    if (latestUsage) {
      yield {
        kind: 'usage',
        usage: normalizeGeminiUsage(
          latestUsage,
          request.providerId?.trim() || this.provider,
          model
        )
      }
    }
    if (!sawContent) {
      yield {
        kind: 'error',
        code: 'gemini_cli_api_empty_response',
        message: /MAX_TOKENS/i.test(finishReason)
          ? 'Gemini CLI API exhausted the output-token budget before returning visible content.'
          : 'Gemini CLI API completed without returning text, reasoning, a tool call, or an image.',
        failure: {
          category: 'unavailable',
          failoverAllowed: true
        }
      }
      return
    }
    yield {
      kind: 'completed',
      stopReason: sawToolCall
        ? 'tool_calls'
        : /MAX_TOKENS/i.test(finishReason)
          ? 'length'
          : 'stop'
    }
  }

  private async startDebugRound(request: ModelRequest): Promise<LlmDebugRound | null> {
    if (!this.debugSink) return null
    return await startLlmDebugRoundIfEnabled(this.debugSink, {
      threadId: request.threadId,
      turnId: request.turnId,
      provider: this.provider,
      model: request.model?.trim() || this.model,
      toolCatalog: request.tools.map((tool) => ({
        name: tool.name,
        ...(tool.providerKind ? { providerKind: tool.providerKind } : {}),
        ...(tool.providerId ? { providerId: tool.providerId } : {})
      })),
      redactedRequestValues: [
        ...goalContextTexts(request.history),
        ...(request.redactedRequestValues ?? [])
      ]
    }) ?? null
  }

  private async loadProject(
    accessToken: string,
    signal: AbortSignal,
    round: LlmDebugRound | null = null
  ): Promise<string> {
    const url = this.methodUrl('loadCodeAssist')
    const headers = geminiHeaders(accessToken)
    const requestBody = {
      metadata: {
        ideType: 'IDE_UNSPECIFIED',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI'
      }
    }
    const body = JSON.stringify(requestBody)
    const trace = round && this.debugSink
      ? safeDebug(() => this.debugSink!.beginHttpAttempt(round, {
          endpointFormat: 'gemini-cli-api',
          attempt: 1,
          reason: 'initial',
          url,
          headers,
          bodyText: traceSafeBody(requestBody),
          secretValues: [accessToken],
          phase: 'setup',
          failureOrigin: 'setup'
        }))
      : undefined
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal
      })
      if (trace && round && this.debugSink) {
        safeDebug(() => this.debugSink!.captureHttpResponse(round, trace, response))
      }
      const payload = await response.json().catch(() => null) as GeminiCodeAssistSetup | null
      if (!response.ok) {
        if (trace) trace.diagnosticCode = 'gemini_cli_setup_failed'
        throw new GeminiCliApiHttpError(
          response.status,
          providerErrorMessage(payload?.error, response.status)
        )
      }
      const projectId = payload?.cloudaicompanionProject?.trim() ||
        process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
        process.env.GOOGLE_CLOUD_PROJECT_ID?.trim()
      if (projectId) return projectId
      const reason = payload?.ineligibleTiers
        ?.map((tier) => tier.reasonMessage?.trim())
        .filter(Boolean)
        .join('; ')
      if (trace) trace.diagnosticCode = 'gemini_cli_setup_failed'
      throw new Error(
        reason ||
        'Gemini CLI account setup is incomplete. Run `gemini` once to finish Google subscription onboarding.'
      )
    } catch (error) {
      if (trace && !(error instanceof GeminiCliApiHttpError)) {
        this.debugSink?.captureHttpError(trace, error)
      }
      throw error
    }
  }

  private async postStream(input: {
    body: Record<string, unknown>
    accessToken: string
    signal: AbortSignal
    round: LlmDebugRound | null
    attempt: number
    reason: 'initial' | 'credential_refresh' | 'transport_retry'
  }): Promise<{ response?: Response; error?: string }> {
    const url = `${this.methodUrl('streamGenerateContent')}?alt=sse`
    const headers = geminiHeaders(input.accessToken)
    const trace = input.round && this.debugSink
      ? safeDebug(() => this.debugSink!.beginHttpAttempt(input.round!, {
          endpointFormat: 'gemini-cli-api',
          attempt: input.attempt,
          reason: input.reason,
          url,
          headers,
          bodyText: traceSafeBody(input.body),
          secretValues: [input.accessToken]
        }))
      : undefined
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(input.body),
        signal: input.signal
      })
      if (trace && input.round && this.debugSink) {
        safeDebug(() => this.debugSink!.captureHttpResponse(input.round!, trace, response))
      }
      return { response }
    } catch (error) {
      if (trace && this.debugSink) {
        safeDebug(() => this.debugSink!.captureHttpError(trace, error))
      }
      return {
        error: input.signal.aborted
          ? 'Gemini CLI API request was aborted.'
          : `Gemini CLI API request failed: ${safeErrorMessage(error)}`
      }
    }
  }

  private methodUrl(method: string): string {
    return `${this.endpoint}/${this.apiVersion}:${method}`
  }
}


export { buildGeminiCliCodeAssistRequest } from './gemini-cli-api-codec.js'
