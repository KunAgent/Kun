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
   * Model used for per-format inference verification. Falls back to the
   * first model returned by the listing probes when omitted.
   */
  verifyModel: z.string().min(1).max(512).optional(),
  useProxy: z.boolean().default(false)
}).strict()

export type DetectedProtocol = {
  format: ModelEndpointFormat
  /** Usable: the catalog listing or an inference probe succeeded. */
  ok: boolean
  /** The model catalog answered with this format's auth family. */
  listed: boolean
  /** A real minimal inference request completed on this format. */
  verified: boolean
  latencyMs: number
  models?: string[]
  message?: string
}

const VERIFY_TIMEOUT_MS = 20_000
// OpenAI Responses rejects max_output_tokens below 16; keep the same floor
// for every format so a passing probe is meaningful for all of them.
const VERIFY_MAX_TOKENS = 16

async function listProbe(
  baseUrl: string,
  format: ModelEndpointFormat,
  apiKey: string,
  headers: Record<string, string> | undefined,
  proxyUrl: string
): Promise<{ ok: boolean; latencyMs: number; models?: string[]; message?: string }> {
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
    return { ok: true, latencyMs: Date.now() - started, models: models.slice(0, 200) }
  } catch (error) {
    return {
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
): Promise<{ ok: boolean; message?: string }> {
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
      maxTokens: VERIFY_MAX_TOKENS,
      maxRetryAttempts: 0,
      abortSignal: AbortSignal.timeout(VERIFY_TIMEOUT_MS)
    })
    for await (const chunk of stream) {
      if (chunk.kind === 'assistant_text_delta' ||
          chunk.kind === 'assistant_reasoning_delta' ||
          chunk.kind === 'completed') {
        return { ok: true }
      }
      if (chunk.kind === 'error') {
        return { ok: false, message: chunk.message }
      }
    }
    return { ok: false, message: 'provider returned no output' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function preferredFormatForModel(model: string): ModelEndpointFormat {
  const name = model.trim().toLowerCase()
  if (/^claude/.test(name)) return 'messages'
  if (/^(gpt-|o\d|codex)/.test(name)) return 'responses'
  return 'chat_completions'
}

const FORMAT_ORDER: readonly ModelEndpointFormat[] = ['chat_completions', 'responses', 'messages']

/**
 * Detects which wire protocols a base URL speaks. The model catalog is
 * queried once per auth family (OpenAI Bearer vs Anthropic x-api-key) — a
 * successful listing proves reachability, not protocol support, because
 * relay gateways commonly accept both header styles. When a verify model is
 * available (requested explicitly or taken from the listing) each format is
 * then exercised with a bounded inference request, and `verified` is only
 * set when that request actually completes. Recommendations only ever point
 * at verified formats; when several pass, the model family picks between
 * them (claude models prefer messages, gpt/o-N/codex prefer responses,
 * otherwise chat_completions wins).
 */
export async function detectProviderProtocols(
  raw: unknown,
  /** Resolved global proxy URL, applied only when `useProxy` is requested. */
  globalProxyUrl = ''
): Promise<{ baseUrl: string; formats: DetectedProtocol[]; recommended?: ModelEndpointFormat }> {
  const input = DetectProtocolRequestSchema.parse(raw)
  const apiKey = input.credential?.trim() ?? ''
  const proxyUrl = input.useProxy ? globalProxyUrl : ''
  const [openaiList, anthropicList] = await Promise.all([
    listProbe(input.baseUrl, 'chat_completions', apiKey, input.customHeaders, proxyUrl),
    listProbe(input.baseUrl, 'messages', apiKey, input.customHeaders, proxyUrl)
  ])
  const listedModels = Array.from(new Set([
    ...(openaiList.models ?? []),
    ...(anthropicList.models ?? [])
  ]))
  const formats: DetectedProtocol[] = [
    {
      format: 'chat_completions',
      ok: openaiList.ok,
      listed: openaiList.ok,
      verified: false,
      latencyMs: openaiList.latencyMs,
      ...(openaiList.models ? { models: openaiList.models } : {}),
      ...(openaiList.message ? { message: openaiList.message } : {})
    },
    {
      format: 'responses',
      ok: openaiList.ok,
      listed: openaiList.ok,
      verified: false,
      latencyMs: openaiList.latencyMs,
      ...(openaiList.models ? { models: openaiList.models } : {}),
      ...(openaiList.message ? { message: openaiList.message } : {})
    },
    {
      format: 'messages',
      ok: anthropicList.ok,
      listed: anthropicList.ok,
      verified: false,
      latencyMs: anthropicList.latencyMs,
      ...(anthropicList.models ? { models: anthropicList.models } : {}),
      ...(anthropicList.message ? { message: anthropicList.message } : {})
    }
  ]
  const verifyModel = input.verifyModel ?? listedModels[0]
  if (verifyModel) {
    await Promise.all(formats.map(async (entry) => {
      const verify = await inferenceVerify(
        input.baseUrl,
        entry.format,
        verifyModel,
        apiKey,
        input.customHeaders,
        proxyUrl
      )
      entry.verified = verify.ok
      if (verify.ok) {
        entry.ok = true
        entry.message = undefined
      } else if (verify.message && !entry.ok) {
        entry.message = verify.message
      }
    }))
  }
  const verified = FORMAT_ORDER.filter((format) => formats.some((entry) => entry.format === format && entry.verified))
  const preferred = verifyModel ? preferredFormatForModel(verifyModel) : 'chat_completions'
  const recommended = verified.includes(preferred) ? preferred : verified[0]
  return { baseUrl: input.baseUrl, formats, ...(recommended ? { recommended } : {}) }
}
