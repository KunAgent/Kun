import { z } from 'zod'
import type { ModelEndpointFormat } from '../contracts/model-endpoint-format.js'
import { CompatModelClient } from '../adapters/model/compat-model-client.js'
import { probeModels } from './model-connection-probe.js'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'

export const DetectProtocolRequestSchema = z.object({
  baseUrl: z.string().url().max(2_048),
  credential: z.string().max(64 * 1024).optional(),
  customHeaders: z.record(z.string().min(1).max(128), z.string().max(8 * 1024)).optional(),
  /**
   * When set, formats that could not be confirmed by the model listing are
   * verified with a bounded 1-token inference request against this model.
   */
  verifyModel: z.string().min(1).max(512).optional(),
  useProxy: z.boolean().default(false)
}).strict()

export type DetectedProtocol = {
  format: ModelEndpointFormat
  ok: boolean
  latencyMs: number
  models?: string[]
  verified?: boolean
  message?: string
}

const DETECT_TIMEOUT_MS = 10_000
const VERIFY_TIMEOUT_MS = 20_000

async function listProbe(
  baseUrl: string,
  format: ModelEndpointFormat,
  apiKey: string,
  headers: Record<string, string> | undefined,
  proxyUrl: string
): Promise<DetectedProtocol> {
  const started = Date.now()
  try {
    const models = await probeModels({
      kind: 'http',
      baseUrl,
      endpointFormat: format,
      apiKey,
      ...(headers ? { headers } : {}),
      fallbackModels: [],
      proxyUrl
    })
    return { format, ok: true, latencyMs: Date.now() - started, models: models.slice(0, 200) }
  } catch (error) {
    return {
      format,
      ok: false,
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

async function inferenceVerify(
  baseUrl: string,
  format: ModelEndpointFormat,
  model: string,
  apiKey: string,
  headers: Record<string, string> | undefined,
  proxyUrl: string
): Promise<Pick<DetectedProtocol, 'ok' | 'verified' | 'message'>> {
  const client = new CompatModelClient({
    baseUrl,
    apiKey,
    model,
    endpointFormat: format,
    ...(headers ? { customHeaders: headers } : {}),
    ...(proxyUrl ? { modelProxyUrl: proxyUrl } : {}),
    fetchImpl: (createProxyFetch(proxyUrl) ?? fetch) as typeof fetch
  })
  try {
    const stream = client.stream({
      threadId: 'protocol_detect',
      turnId: `detect_${Date.now().toString(36)}`,
      model,
      systemPrompt: '',
      prefix: [],
      history: [{
        id: 'detect_msg_1',
        turnId: `detect_${Date.now().toString(36)}`,
        threadId: 'protocol_detect',
        role: 'user',
        kind: 'user_message',
        status: 'completed',
        createdAt: new Date().toISOString(),
        text: 'ping'
      }],
      tools: [],
      stream: true,
      maxTokens: 1,
      abortSignal: AbortSignal.timeout(VERIFY_TIMEOUT_MS)
    })
    for await (const chunk of stream) {
      if (chunk.kind === 'assistant_text_delta' ||
          chunk.kind === 'assistant_reasoning_delta' ||
          chunk.kind === 'completed') {
        return { ok: true, verified: true }
      }
      if (chunk.kind === 'error') {
        return { ok: false, verified: true, message: chunk.message }
      }
    }
    return { ok: false, verified: true, message: 'provider returned no output' }
  } catch (error) {
    return { ok: false, verified: true, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Detects which wire protocols a base URL speaks. The model listing is
 * tried first for the OpenAI and Anthropic header families in parallel —
 * OpenAI `chat_completions` and `responses` share `/models`, so a confirmed
 * listing marks both. When the listing is inconclusive for a format and a
 * `verifyModel` was supplied, a bounded 1-token request decides it.
 */
export async function detectProviderProtocols(
  raw: unknown,
  /** Resolved global proxy URL, applied only when `useProxy` is requested. */
  globalProxyUrl = ''
): Promise<{ baseUrl: string; formats: DetectedProtocol[]; recommended?: ModelEndpointFormat }> {
  const input = DetectProtocolRequestSchema.parse(raw)
  const apiKey = input.credential?.trim() ?? ''
  const proxyUrl = input.useProxy ? globalProxyUrl : ''
  const [openai, anthropic] = await Promise.all([
    listProbe(input.baseUrl, 'chat_completions', apiKey, input.customHeaders, proxyUrl),
    listProbe(input.baseUrl, 'messages', apiKey, input.customHeaders, proxyUrl)
  ])
  const formats: DetectedProtocol[] = [openai]
  // `responses` shares the OpenAI model listing; confirm-by-listing only.
  formats.push({
    format: 'responses',
    ok: openai.ok,
    latencyMs: openai.latencyMs,
    ...(openai.models ? { models: openai.models } : {}),
    ...(openai.message ? { message: openai.message } : {})
  })
  formats.push(anthropic)
  if (input.verifyModel) {
    await Promise.all(formats.map(async (entry) => {
      if (entry.ok) {
        entry.verified = true
        return
      }
      const verify = await inferenceVerify(
        input.baseUrl,
        entry.format,
        input.verifyModel!,
        apiKey,
        input.customHeaders,
        proxyUrl
      )
      entry.ok = verify.ok
      entry.verified = verify.verified
      if (verify.message) entry.message = verify.message
    }))
  }
  const recommended =
    (anthropic.ok ? 'messages' : undefined) ??
    (openai.ok ? 'chat_completions' : undefined)
  return { baseUrl: input.baseUrl, formats, ...(recommended ? { recommended } : {}) }
}
