import {
  isCustomModelEndpointFormat,
  modelEndpointPath,
  resolveModelEndpointFormat,
  type ModelEndpointFormat
} from '../../shared/app-settings'
import { openCodeSessionRuntimeHeaders } from '../../shared/opencode-session'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import {
  codexResponsesLiteInput,
  resolveCodexResponsesRequestAuth,
  usesCodexResponsesLite,
  withCodexResponsesLiteHeader
} from '../codex-responses-lite'

/**
 * Shared one-shot model request used by prompt optimization and the paper
 * reader's translation service. Covers the three supported endpoint families:
 * OpenAI chat completions, Anthropic messages, and OpenAI responses (plus the
 * Codex Responses Lite streaming variant). URL construction, headers, body
 * shape, and response parsing all live here so callers stay consistent.
 */

export const DEFAULT_ONE_SHOT_MAX_OUTPUT_TOKENS = 1600

export type OneShotModelRequestInput = {
  baseUrl: string
  apiKey: string
  endpointFormat: ModelEndpointFormat
  responsesMode?: 'lite'
  model: string
  systemPrompt: string
  userText: string
  timeoutMs: number
  proxyUrl?: string
  providerId?: string
  presetSource?: string
  maxOutputTokens?: number
}

export type OneShotModelRequestPayload = {
  url: string
  endpointFormat: ModelEndpointFormat
  headers: Record<string, string>
  body: Record<string, unknown>
  expectsSse: boolean
}

export type OneShotModelRequestResult =
  | { ok: true; text: string }
  | { ok: false; message: string }

export function buildModelEndpointUrl(baseUrl: string, endpointFormat: ModelEndpointFormat): string {
  if (isCustomModelEndpointFormat(endpointFormat)) return exactModelEndpointUrl(baseUrl)
  const path = modelEndpointPath(endpointFormat)
  const normalized = baseUrl.replace(/\/+$/, '')
  if (!normalized) return `/v1/${path}`
  if (normalized.endsWith('/v1')) return `${normalized}/${path}`
  if (normalized.endsWith('/beta')) return `${normalized.slice(0, -5)}/v1/${path}`
  return `${normalized}/v1/${path}`
}

function exactModelEndpointUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const query = trimmed.search(/[?#]/)
  if (query < 0) return trimmed.replace(/\/+$/, '')
  return `${trimmed.slice(0, query).replace(/\/+$/, '')}${trimmed.slice(query)}`
}

export function buildOneShotModelRequest(input: {
  baseUrl: string
  apiKey: string
  endpointFormat: ModelEndpointFormat
  model: string
  systemPrompt: string
  userText: string
  responsesMode?: 'lite'
  providerId?: string
  presetSource?: string
  maxOutputTokens?: number
}): OneShotModelRequestPayload | null {
  const endpointFormat = resolveModelEndpointFormat(input.endpointFormat, input.baseUrl)
  if (!endpointFormat) return null
  const auth = resolveCodexResponsesRequestAuth(input.baseUrl, input.apiKey)
  const responsesLite = usesCodexResponsesLite(input.baseUrl, input.responsesMode)
  const maxOutputTokens = input.maxOutputTokens ?? DEFAULT_ONE_SHOT_MAX_OUTPUT_TOKENS
  const headers: Record<string, string> = {
    ...withCodexResponsesLiteHeader({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.apiKey}`,
      ...auth.headers
    }, responsesLite),
    ...openCodeSessionRuntimeHeaders({
      presetSource: input.presetSource,
      providerId: input.providerId,
      baseUrl: input.baseUrl
    })
  }
  if (endpointFormat === 'messages') {
    headers['x-api-key'] = auth.apiKey
    headers['anthropic-version'] = '2023-06-01'
  }
  if (endpointFormat === 'responses') {
    if (responsesLite) {
      headers.Accept = 'text/event-stream'
      return {
        url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
        endpointFormat,
        headers,
        expectsSse: true,
        body: {
          model: input.model,
          input: codexResponsesLiteInput(input.systemPrompt, [{ role: 'user', content: input.userText }]),
          stream: true,
          store: false,
          tool_choice: 'auto',
          parallel_tool_calls: false,
          reasoning: { context: 'all_turns' }
        }
      }
    }
    return {
      url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
      endpointFormat,
      headers,
      expectsSse: false,
      body: {
        model: input.model,
        instructions: input.systemPrompt,
        input: input.userText,
        max_output_tokens: maxOutputTokens
      }
    }
  }
  if (endpointFormat === 'messages') {
    return {
      url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
      endpointFormat,
      headers,
      expectsSse: false,
      body: {
        model: input.model,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: input.userText }],
        max_tokens: maxOutputTokens
      }
    }
  }
  return {
    url: buildModelEndpointUrl(input.baseUrl, input.endpointFormat),
    endpointFormat,
    headers,
    expectsSse: false,
    body: {
      model: input.model,
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userText }
      ],
      max_tokens: maxOutputTokens
    }
  }
}

function extractResponsesContent(parsed: Record<string, unknown>): string {
  if (typeof parsed.output_text === 'string') return parsed.output_text.trim()
  const output = parsed.output
  if (!Array.isArray(output)) return ''
  return output.map((item) => {
    if (!item || typeof item !== 'object') return ''
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) return ''
    return content.map((block) => {
      if (!block || typeof block !== 'object') return ''
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string') return text
      const outputText = (block as { output_text?: unknown }).output_text
      return typeof outputText === 'string' ? outputText : ''
    }).join('')
  }).join('').trim()
}

export function extractOneShotResponseContent(rawJson: string, endpointFormat: ModelEndpointFormat): string {
  const parsed = JSON.parse(rawJson) as Record<string, unknown>
  if (endpointFormat === 'responses') {
    return extractResponsesContent(parsed)
  }
  if (endpointFormat === 'messages') {
    const content = parsed.content
    if (!Array.isArray(content)) return ''
    return content.map((block) =>
      block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : ''
    ).join('').trim()
  }
  const choices = parsed.choices
  if (!Array.isArray(choices)) return ''
  const first = choices[0]
  return first && typeof first === 'object'
    ? String((first as { message?: { content?: unknown } }).message?.content ?? '').trim()
    : ''
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function oneShotStreamError(payload: Record<string, unknown>): string {
  const error = recordValue(payload.error)
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  const response = recordValue(payload.response)
  const responseError = recordValue(response?.error)
  if (typeof responseError?.message === 'string' && responseError.message.trim()) {
    return responseError.message.trim()
  }
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
  return 'Model request stream failed.'
}

export function extractOneShotSseContent(rawSse: string): string {
  let deltaText = ''
  let finalText = ''
  const frames = rawSse.replace(/\r\n?/g, '\n').split(/\n\n+/)
  for (const frame of frames) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
      .trim()
    if (!data || data === '[DONE]') continue
    const payload = recordValue(JSON.parse(data))
    if (!payload) continue
    const type = typeof payload.type === 'string' ? payload.type : ''
    if (type === 'response.output_text.delta' && typeof payload.delta === 'string') {
      deltaText += payload.delta
      continue
    }
    if (type === 'response.output_text.done' && typeof payload.text === 'string') {
      finalText = payload.text
      continue
    }
    if (type === 'response.content_part.done') {
      const part = recordValue(payload.part)
      if (typeof part?.text === 'string') finalText += part.text
      continue
    }
    if (type === 'response.output_item.done') {
      const item = recordValue(payload.item)
      if (item) finalText = extractResponsesContent({ output: [item] }) || finalText
      continue
    }
    if (type === 'response.completed') {
      const response = recordValue(payload.response) ?? payload
      finalText = extractResponsesContent(response) || finalText
      continue
    }
    if (type === 'response.failed' || type === 'error') {
      throw new Error(oneShotStreamError(payload))
    }
  }
  return (deltaText || finalText).trim()
}

/**
 * Build the request for the configured endpoint format, send it through the
 * optional proxy, and extract the assistant text. Never throws; failures come
 * back as `{ ok: false, message }` so callers can show the reason verbatim.
 */
export async function oneShotModelRequest(
  input: OneShotModelRequestInput
): Promise<OneShotModelRequestResult> {
  const request = buildOneShotModelRequest({
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    endpointFormat: input.endpointFormat,
    responsesMode: input.responsesMode,
    model: input.model,
    systemPrompt: input.systemPrompt,
    userText: input.userText,
    providerId: input.providerId,
    presetSource: input.presetSource,
    maxOutputTokens: input.maxOutputTokens
  })
  if (!request) return { ok: false, message: 'Model endpoint format is invalid.' }

  let response: Response
  let bodyText = ''
  try {
    response = await fetchWithOptionalProxy(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(Math.max(1_000, input.timeoutMs))
    }, input.proxyUrl ?? '')
    bodyText = await response.text()
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      message: `Model request failed with HTTP ${response.status}: ${bodyText.slice(0, 300)}`
    }
  }
  try {
    const text = request.expectsSse
      ? extractOneShotSseContent(bodyText)
      : extractOneShotResponseContent(bodyText, request.endpointFormat).trim()
    if (!text) return { ok: false, message: 'Model request returned empty text.' }
    return { ok: true, text }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
