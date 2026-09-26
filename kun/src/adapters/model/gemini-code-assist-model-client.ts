import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { GeminiCodeAssistCredential } from '../../contracts/gemini-code-assist.js'
import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { repairToolArguments } from './tool-argument-repair.js'
import { createProxyFetch } from './proxy-fetch.js'
import {
  classifyCompatHttpError,
  compatHttpFailureLog
} from './compat-http-diagnostics.js'
import { projectCompatMessages } from './compat-message-projector.js'
import {
  COMPAT_HISTORY_CONTEXT,
  type CompatChatMessage,
  type CompatChatMessageContentPart
} from './compat-request-codecs.js'
import { normalizeToolSpecs } from './compat-request-builder.js'
import { IncrementalSseFrameBuffer } from './incremental-sse-frame-buffer.js'
import { KUN_VERSION } from '../../version.js'

const DEFAULT_CODE_ASSIST_BASE_URL = 'https://cloudcode-pa.googleapis.com'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_OAUTH_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
const GOOGLE_OAUTH_CLIENT_SECRET = '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'
const EARLY_REFRESH_MS = 5 * 60 * 1000
const SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'
const CODE_ASSIST_MODEL_ALIASES: Readonly<Record<string, string>> = {
  'gemini-3.5-flash': 'gemini-3-flash'
}

type GeminiPart = {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> }
  functionResponse?: {
    id?: string
    name: string
    response: Record<string, unknown>
  }
}

type GeminiContent = {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

type GeminiCodeAssistPayload = {
  response?: {
    candidates?: Array<{
      content?: { role?: string; parts?: GeminiPart[] }
      finishReason?: string
    }>
    usageMetadata?: {
      promptTokenCount?: number
      candidatesTokenCount?: number
      totalTokenCount?: number
      cachedContentTokenCount?: number
      thoughtsTokenCount?: number
    }
  }
  traceId?: string
}

export type GeminiCodeAssistModelClientConfig = {
  baseUrl?: string
  auth?: GeminiCodeAssistCredential
  /** Managed credentials are resolved for every request so a remote fence wins over cached auth. */
  resolveAuth?: () => Promise<GeminiCodeAssistCredential | null>
  model: string
  modelProxyUrl?: string
  fetchImpl?: typeof fetch
  historyLimit?: number
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
}

function stripTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1
  return value.slice(0, end)
}

export class GeminiCodeAssistModelClient implements ModelClient {
  readonly provider = 'gemini-code-assist'
  readonly model: string
  readonly config: {
    baseUrl: string
    endpointFormat: 'custom_endpoint'
    model: string
  }

  private auth?: GeminiCodeAssistCredential
  private readonly resolveAuth?: () => Promise<GeminiCodeAssistCredential | null>
  private readonly fetchImpl: typeof fetch
  private readonly historyLimit?: number
  private readonly modelCapabilities?: (model: string) => ModelCapabilityMetadata

  constructor(input: GeminiCodeAssistModelClientConfig) {
    this.model = input.model
    this.config = {
      baseUrl: stripTrailingSlashes(input.baseUrl?.trim() || DEFAULT_CODE_ASSIST_BASE_URL),
      endpointFormat: 'custom_endpoint',
      model: input.model
    }
    this.auth = input.auth ? { ...input.auth } : undefined
    this.resolveAuth = input.resolveAuth
    this.fetchImpl = input.fetchImpl ?? createProxyFetch(input.modelProxyUrl ?? '') ?? fetch
    this.historyLimit = input.historyLimit
    this.modelCapabilities = input.modelCapabilities
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    if (request.abortSignal.aborted) {
      yield { kind: 'error', message: 'request was aborted before start' }
      return
    }
    // Managed auth is request-local: concurrent generations must never publish
    // into a shared instance field where a late stale resolve could revive a
    // credential after another request observed a durable fence.
    let requestAuth = this.resolveAuth
      ? await this.resolveAuth().catch(() => null)
      : this.auth
    requestAuth = requestAuth ? { ...requestAuth } : null
    if (!requestAuth?.projectId || !requestAuth.accessToken) {
      yield {
        kind: 'error',
        message: 'Gemini subscription credentials are unavailable. Reconnect the provider in Settings.'
      }
      return
    }

    const model = request.model?.trim() || this.model
    const body = buildGeminiCodeAssistRequest({
      request,
      model,
      projectId: requestAuth.projectId,
      historyLimit: this.historyLimit,
      supportsImages: this.modelSupportsImageInput(model)
    })
    const streaming = request.stream !== false
    const method = streaming ? 'streamGenerateContent' : 'generateContent'
    const url = `${this.config.baseUrl}/v1internal:${method}${streaming ? '?alt=sse' : ''}`

    let accessToken: string
    try {
      const resolved = await this.accessToken(requestAuth, false)
      accessToken = resolved.accessToken
      requestAuth = resolved.auth
      if (!this.resolveAuth) this.auth = { ...requestAuth }
    } catch (error) {
      yield { kind: 'error', message: error instanceof Error ? error.message : String(error) }
      return
    }

    let result = await this.post(url, body, accessToken, request.abortSignal)
    if (result.kind === 'response' && result.response.status === 401 && requestAuth.refreshToken) {
      await result.response.body?.cancel().catch(() => {})
      try {
        const resolved = await this.accessToken(requestAuth, true)
        accessToken = resolved.accessToken
        requestAuth = resolved.auth
        if (!this.resolveAuth) this.auth = { ...requestAuth }
      } catch (error) {
        yield { kind: 'error', message: error instanceof Error ? error.message : String(error) }
        return
      }
      result = await this.post(url, body, accessToken, request.abortSignal)
    }
    if (result.kind === 'error') {
      yield {
        kind: 'error',
        message: result.message,
        failure: { category: 'network', failoverAllowed: !request.abortSignal.aborted }
      }
      return
    }
    if (!result.response.ok) {
      const text = await result.response.text()
      const upstreamModel = String(body.model ?? model)
      console.warn('[kun:model] model HTTP request failed', {
        ...compatHttpFailureLog({
          provider: this.provider,
          status: result.response.status,
          model,
          configuredModel: this.config.model,
          baseUrl: this.config.baseUrl,
          requestUrl: url,
          endpointFormat: 'custom_endpoint',
          configuredEndpointFormat: 'custom_endpoint',
          body: text
        }),
        upstreamModel
      })
      const classified = await classifyCompatHttpError({
        status: result.response.status,
        text,
        baseUrl: this.config.baseUrl,
        fetchImpl: this.fetchImpl,
        retryAfter: result.response.headers.get('retry-after'),
        headers: result.response.headers
      })
      const message = result.response.status === 404
        ? `Gemini Code Assist model "${model}" is not available for this Google subscription. Pull the provider model list again and select one returned by the account.`
        : classified.message
      yield {
        kind: 'error',
        message,
        code: classified.code,
        failure: classified.failure
      }
      return
    }

    if (!streaming || result.response.headers.get('content-type')?.includes('application/json')) {
      let payload: GeminiCodeAssistPayload
      try {
        payload = await result.response.json() as GeminiCodeAssistPayload
      } catch (error) {
        yield {
          kind: 'error',
          message: `Gemini Code Assist returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
        }
        return
      }
      yield* materializeGeminiPayloads([payload], request.turnId)
      return
    }
    if (!result.response.body) {
      yield { kind: 'error', message: 'Gemini Code Assist response had no body' }
      return
    }
    yield* this.streamSse(result.response.body, request)
  }

  private modelSupportsImageInput(model: string): boolean {
    const capability = this.modelCapabilities?.(model)
    return capability ? capability.inputModalities.includes('image') : true
  }

  private async accessToken(
    auth: GeminiCodeAssistCredential,
    forceRefresh: boolean
  ): Promise<{ accessToken: string; auth: GeminiCodeAssistCredential }> {
    if (!forceRefresh && auth.expiresAt > Date.now() + EARLY_REFRESH_MS) {
      return { accessToken: auth.accessToken, auth }
    }
    if (!auth.refreshToken) {
      if (auth.expiresAt > Date.now()) return { accessToken: auth.accessToken, auth }
      throw new Error('Gemini subscription login expired. Reconnect the provider in Settings.')
    }
    const response = await this.fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken
      }).toString()
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Gemini subscription token refresh failed with HTTP ${response.status}`)
    }
    let tokens: Record<string, unknown>
    try {
      tokens = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error('Gemini subscription token refresh returned invalid JSON')
    }
    const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : ''
    if (!accessToken) throw new Error('Gemini subscription token refresh returned no access token')
    const expiresIn = Number(tokens.expires_in) || 3600
    const refreshedAuth: GeminiCodeAssistCredential = {
      ...auth,
      accessToken,
      refreshToken:
        typeof tokens.refresh_token === 'string' && tokens.refresh_token
          ? tokens.refresh_token
          : auth.refreshToken,
      expiresAt: Date.now() + expiresIn * 1000
    }
    return { accessToken, auth: refreshedAuth }
  }

  private async post(
    url: string,
    body: Record<string, unknown>,
    accessToken: string,
    signal: AbortSignal
  ): Promise<{ kind: 'response'; response: Response } | { kind: 'error'; message: string }> {
    try {
      return {
        kind: 'response',
        response: await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': `Kun/${KUN_VERSION} (gemini-code-assist)`
          },
          body: JSON.stringify(body),
          signal
        })
      }
    } catch (error) {
      return {
        kind: 'error',
        message: `Gemini Code Assist request failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  private async *streamSse(
    body: ReadableStream<Uint8Array>,
    request: ModelRequest
  ): AsyncIterable<ModelStreamChunk> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    const frames = new IncrementalSseFrameBuffer()
    const state: GeminiStreamState = { finishReason: '', sawToolCall: false, callIndex: 0 }
    try {
      while (true) {
        if (request.abortSignal.aborted) {
          await reader.cancel().catch(() => {})
          yield { kind: 'error', message: 'request was aborted during streaming' }
          return
        }
        const next = await reader.read()
        if (next.done) break
        frames.append(decoder.decode(next.value, { stream: true }))
        while (true) {
          const frame = frames.takeFrame()
          if (!frame) break
          const data = sseData(frame.data)
          if (!data || data === '[DONE]') continue
          let payload: GeminiCodeAssistPayload
          try {
            payload = JSON.parse(data) as GeminiCodeAssistPayload
          } catch {
            yield { kind: 'error', message: 'Gemini Code Assist returned a malformed SSE chunk' }
            return
          }
          yield* materializeGeminiPayload(payload, request.turnId, state)
        }
      }
      const tail = decoder.decode()
      if (tail) frames.append(tail)
    } finally {
      reader.releaseLock()
    }
    yield* completeGeminiStream(state)
  }
}

export function buildGeminiCodeAssistRequest(input: {
  request: ModelRequest
  model: string
  projectId: string
  historyLimit?: number
  supportsImages?: boolean
}): Record<string, unknown> {
  const messages = projectCompatMessages(input.request, {
    historyLimit: input.historyLimit,
    thinkingMode: false,
    supportsImages: input.supportsImages ?? true
  })
  const systemText = messages
    .filter((message) =>
      message.role === 'system' && message[COMPAT_HISTORY_CONTEXT] !== true
    )
    .map((message) => plainText(message.content).trim())
    .filter(Boolean)
    .join('\n\n')
  const contents = geminiContents(messages.flatMap((message) => {
    if (message.role !== 'system') return [message]
    return message[COMPAT_HISTORY_CONTEXT] === true
      ? [{ ...message, role: 'user' as const }]
      : []
  }))
  const tools = normalizeToolSpecs(input.request.tools)
  const generationConfig: Record<string, unknown> = {}
  if (input.request.maxTokens !== undefined) generationConfig.maxOutputTokens = input.request.maxTokens
  if (input.request.temperature !== undefined) generationConfig.temperature = input.request.temperature
  if (input.request.topP !== undefined) generationConfig.topP = input.request.topP
  if (input.request.responseFormat === 'json_object') {
    generationConfig.responseMimeType = 'application/json'
  }
  const innerRequest: Record<string, unknown> = {
    contents,
    ...(systemText
      ? { systemInstruction: { role: 'user', parts: [{ text: systemText }] } }
      : {}),
    ...(tools.length
      ? {
          tools: [{
            functionDeclarations: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.inputSchema
            }))
          }]
        }
      : {}),
    ...(input.request.requiredToolName
      ? {
          toolConfig: {
            functionCallingConfig: {
              mode: 'ANY',
              allowedFunctionNames: [input.request.requiredToolName]
            }
          }
        }
      : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    session_id: input.request.threadId
  }
  return {
    model: mapGeminiCodeAssistModel(input.model),
    project: input.projectId,
    user_prompt_id: input.request.turnId,
    request: innerRequest
  }
}

export function mapGeminiCodeAssistModel(model: string): string {
  const trimmed = model.trim()
  const prefix = trimmed.startsWith('models/') ? 'models/' : ''
  const normalized = prefix ? trimmed.slice(prefix.length) : trimmed
  const mapped = CODE_ASSIST_MODEL_ALIASES[normalized] ?? normalized
  return `${prefix}${mapped}`
}

function geminiContents(messages: CompatChatMessage[]): GeminiContent[] {
  const toolNames = new Map<string, string>()
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) toolNames.set(call.id, call.function.name)
  }
  const out: GeminiContent[] = []
  for (const message of messages) {
    const parts: GeminiPart[] = []
    if (message.role === 'tool') {
      const callId = message.tool_call_id ?? ''
      const name = toolNames.get(callId) ?? 'tool'
      const response: Record<string, unknown> = { output: plainText(message.content) }
      parts.push({ functionResponse: { ...(callId ? { id: callId } : {}), name, response } })
      for (const part of arrayContent(message.content)) {
        const inlineData = inlineDataFromContentPart(part)
        if (inlineData) parts.push({ inlineData })
      }
      appendGeminiContent(out, { role: 'user', parts })
      continue
    }
    for (const part of arrayContent(message.content)) {
      if (part.type === 'text' && part.text) parts.push({ text: part.text })
      const inlineData = inlineDataFromContentPart(part)
      if (inlineData) parts.push({ inlineData })
    }
    if (typeof message.content === 'string' && message.content) parts.push({ text: message.content })
    for (const call of message.tool_calls ?? []) {
      const firstFunctionCall = !parts.some((part) => Boolean(part.functionCall))
      parts.push({
        functionCall: {
          id: call.id,
          name: call.function.name,
          args: repairToolArguments(call.function.arguments).arguments
        },
        ...(firstFunctionCall ? { thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE } : {})
      })
    }
    if (parts.length === 0) continue
    appendGeminiContent(out, {
      role: message.role === 'assistant' ? 'model' : 'user',
      parts
    })
  }
  return out
}

function appendGeminiContent(out: GeminiContent[], content: GeminiContent): void {
  const previous = out[out.length - 1]
  if (previous?.role === content.role) {
    previous.parts.push(...content.parts)
  } else {
    out.push(content)
  }
}

function arrayContent(
  content: CompatChatMessage['content']
): CompatChatMessageContentPart[] {
  return Array.isArray(content) ? content : []
}

function plainText(content: CompatChatMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

function inlineDataFromContentPart(
  part: CompatChatMessageContentPart
): { mimeType: string; data: string } | null {
  if (part.type !== 'image_url') return null
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(part.image_url.url)
  return match ? { mimeType: match[1], data: match[2].replace(/[\r\n]/g, '') } : null
}

function sseData(frame: string): string {
  return frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim()
}

type GeminiStreamState = {
  finishReason: string
  sawToolCall: boolean
  callIndex: number
  usage?: UsageSnapshot
}

async function* materializeGeminiPayloads(
  payloads: GeminiCodeAssistPayload[],
  turnId: string
): AsyncIterable<ModelStreamChunk> {
  const state: GeminiStreamState = { finishReason: '', sawToolCall: false, callIndex: 0 }
  for (const payload of payloads) yield* materializeGeminiPayload(payload, turnId, state)
  yield* completeGeminiStream(state)
}

async function* materializeGeminiPayload(
  payload: GeminiCodeAssistPayload,
  turnId: string,
  state: GeminiStreamState
): AsyncIterable<ModelStreamChunk> {
  const response = payload.response
  if (!response) return
  const candidate = response.candidates?.[0]
  if (candidate?.finishReason) state.finishReason = candidate.finishReason
  for (const part of candidate?.content?.parts ?? []) {
    if (part.functionCall?.name) {
      state.sawToolCall = true
      state.callIndex += 1
      const callId = part.functionCall.id?.trim() || `${turnId}_gemini_call_${state.callIndex}`
      yield {
        kind: 'tool_call_complete',
        callId,
        toolName: part.functionCall.name,
        arguments: part.functionCall.args ?? {}
      }
    } else if (part.text) {
      yield part.thought
        ? { kind: 'assistant_reasoning_delta', text: part.text }
        : { kind: 'assistant_text_delta', text: part.text }
    }
  }
  if (response.usageMetadata) state.usage = geminiUsage(response.usageMetadata)
}

async function* completeGeminiStream(
  state: GeminiStreamState
): AsyncIterable<ModelStreamChunk> {
  if (state.usage) yield { kind: 'usage', usage: state.usage }
  if (
    state.finishReason &&
    !['STOP', 'MAX_TOKENS'].includes(state.finishReason) &&
    !state.sawToolCall
  ) {
    yield {
      kind: 'error',
      message: `Gemini Code Assist stopped with ${state.finishReason}`,
      code: state.finishReason.toLowerCase()
    }
    return
  }
  yield {
    kind: 'completed',
    stopReason: state.sawToolCall
      ? 'tool_calls'
      : state.finishReason === 'MAX_TOKENS' ? 'length' : 'stop'
  }
}

function geminiUsage(
  metadata: NonNullable<
    NonNullable<GeminiCodeAssistPayload['response']>['usageMetadata']
  >
): UsageSnapshot {
  const promptTokens = positiveInteger(metadata.promptTokenCount)
  const completionTokens = positiveInteger(metadata.candidatesTokenCount)
  const totalTokens = positiveInteger(metadata.totalTokenCount) || promptTokens + completionTokens
  const cached = metadata.cachedContentTokenCount === undefined
    ? undefined
    : positiveInteger(metadata.cachedContentTokenCount)
  const miss = Math.max(0, promptTokens - (cached ?? 0))
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    ...(metadata.thoughtsTokenCount === undefined
      ? {}
      : { reasoningTokens: positiveInteger(metadata.thoughtsTokenCount) }),
    ...(cached === undefined
      ? { cacheHitRate: null }
      : {
          cachedTokens: cached,
          cacheHitTokens: cached,
          cacheMissTokens: miss,
          cacheHitRate: cached + miss > 0 ? cached / (cached + miss) : null
        }),
    turns: 1
  }
}

function positiveInteger(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}
