import type { GeneratedImage } from './image-gen-tool-provider.js'

export const CODEX_IMAGE_INSTRUCTIONS = 'You must fulfill image generation requests by using the image_generation tool.'
export const MAX_CODEX_IMAGE_SSE_BYTES = 64 * 1024 * 1024
const MAX_CODEX_IMAGE_SSE_EVENTS = 512
const MAX_CODEX_IMAGE_BASE64_CHARS = 64 * 1024 * 1024

export type CodexImageToolChoiceMode = 'allowed_tools' | 'required' | 'none'

export type ImagesApiPayload = { data?: { b64_json?: string; url?: string }[] }
export type VolcengineArkImagesPayload = {
  data?: { b64_json?: string; url?: string }[]
  error?: { code?: string; message?: string }
}
export type CodexResponsesImageEvent = {
  type?: string
  partial_image_b64?: string
  item?: {
    type?: string
    result?: string
    revised_prompt?: string
  }
  response?: {
    output?: Array<{
      type?: string
      result?: string
      revised_prompt?: string
    }>
  }
  error?: {
    code?: string
    message?: string
  }
  message?: string
}
export type MiniMaxImagePayload = {
  data?: {
    image_base64?: string[]
    image_urls?: string[]
  }
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

export const SIZE_TIERS: Record<string, number> = {
  '1K': 1024,
  '2K': 2048,
  '3K': 3072,
  '4K': 4096
}

export class ImageGenHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`HTTP ${status}: ${body}`)
  }
}

/** Flatten the nested cause chain that Node's fetch hides behind `TypeError`. */
export function describeNetworkError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (current instanceof AggregateError && current.errors.length > 0) {
      current = current.errors[0]
      continue
    }
    if (!(current instanceof Error)) {
      parts.push(String(current))
      break
    }
    const code = (current as { code?: unknown }).code
    const codeText = typeof code === 'string' ? code : ''
    const message = current.message.trim()
    if (message) {
      parts.push(codeText && !message.includes(codeText) ? `${message} (${codeText})` : message)
    } else if (codeText) {
      parts.push(codeText)
    }
    current = current.cause
  }
  const unique = parts.filter((part, index) => parts.indexOf(part) === index)
  return unique.join(': ') || 'unknown network error'
}

export function imageFetchFailure(
  url: string,
  error: unknown,
  request: { timeoutMs: number }
): Error {
  const target = url.split('?')[0]
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new Error(`image request to ${target} timed out after ${request.timeoutMs}ms`, { cause: error })
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error(`image request to ${target} was canceled`, { cause: error })
  }
  return new Error(`image request to ${target} failed: ${describeNetworkError(error)}`, { cause: error })
}

export function parseSizeLongEdge(size: string): number | undefined {
  const match = /^(\d+)x(\d+)$/.exec(size.trim())
  if (!match) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined
  return Math.max(width, height)
}


export function openAiCompatImageUrl(
  baseUrl: string,
  endpoint: 'generations' | 'edits'
): string {
  const path = `images/${endpoint}`
  let normalized = trimTrailingSlashes(baseUrl.trim())
  if (!normalized) return `/v1/${path}`
  const lower = normalized.toLowerCase()
  if (lower.endsWith(`/${path}`)) return normalized
  for (const known of ['images/generations', 'images/edits']) {
    if (lower.endsWith(`/${known}`)) {
      normalized = trimTrailingSlashes(normalized.slice(0, -known.length))
      break
    }
  }
  const lastSegment = normalized.split('/').pop()?.toLowerCase() ?? ''
  if (isVersionSegment(lastSegment)) return `${normalized}/${path}`
  return `${normalized}/v1/${path}`
}

export function codexResponsesImageUrl(baseUrl: string): string {
  const normalized = trimTrailingSlashes(baseUrl.trim())
  if (!normalized) return '/responses'
  if (normalized.toLowerCase().endsWith('/responses')) return normalized
  return `${normalized}/responses`
}

export function volcengineArkImageUrl(baseUrl: string): string {
  const normalized = trimTrailingSlashes(baseUrl.trim())
  if (!normalized) return '/images/generations'
  if (normalized.toLowerCase().endsWith('/images/generations')) return normalized
  return `${normalized}/images/generations`
}

export function imageDataUrl(image: { mimeType: string; data: Buffer }): string {
  const mimeType = image.mimeType.trim() || 'image/png'
  return `data:${mimeType};base64,${image.data.toString('base64')}`
}

export async function readLimitedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('Codex image generation response exceeded size limit')
    }
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let byteLength = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (value) {
        byteLength += value.byteLength
        if (byteLength > maxBytes) {
          await reader.cancel().catch(() => undefined)
          throw new Error('Codex image generation response exceeded size limit')
        }
        chunks.push(decoder.decode(value, { stream: !done }))
      }
      if (done) {
        const tail = decoder.decode()
        if (tail) chunks.push(tail)
        return chunks.join('')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function parseCodexResponsesImageEvents(body: string): CodexResponsesImageEvent[] {
  const events: CodexResponsesImageEvent[] = []
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]') continue
    try {
      events.push(JSON.parse(data) as CodexResponsesImageEvent)
    } catch {
      continue
    }
    if (events.length > MAX_CODEX_IMAGE_SSE_EVENTS) {
      throw new Error('Codex image generation response exceeded event limit')
    }
  }
  return events
}

function decodeCodexImagePayload(payload: string): Buffer {
  if (payload.length > MAX_CODEX_IMAGE_BASE64_CHARS) {
    throw new Error('Codex image generation result exceeded size limit')
  }
  return Buffer.from(payload, 'base64')
}

function codexImageFromResult(result: string | undefined): GeneratedImage | null {
  if (!result) return null
  return { data: decodeCodexImagePayload(result), mimeType: 'image/png' }
}

function codexResponseOutputText(event: CodexResponsesImageEvent): string {
  const output = event.response?.output ?? []
  const parts: string[] = []
  for (const item of output) {
    const record = item as Record<string, unknown>
    const content = record.content
    if (!Array.isArray(content)) continue
    for (const entry of content) {
      if (!entry || typeof entry !== 'object') continue
      const text = (entry as Record<string, unknown>).text
      if (typeof text === 'string' && text.trim()) parts.push(text.trim())
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, 300)
}

export function summarizeCodexResponsesImage(body: string): string {
  try {
    const events = parseCodexResponsesImageEvents(body)
    const types = [...new Set(events.map((event) => event.type).filter((type): type is string => Boolean(type)))]
      .slice(0, 8)
      .join(', ')
    const completed = events.find((event) => event.type === 'response.completed')
    const outputTypes = [...new Set((completed?.response?.output ?? []).map((item) => item.type).filter(Boolean))]
      .slice(0, 8)
      .join(', ')
    const text = completed ? codexResponseOutputText(completed) : ''
    const parts = [
      types ? `events: ${types}` : '',
      outputTypes ? `output: ${outputTypes}` : '',
      text ? `text: ${text}` : ''
    ].filter(Boolean)
    return parts.length > 0 ? ` (${parts.join('; ')})` : ''
  } catch {
    return ''
  }
}

export function isCodexToolChoiceError(status: number, body: string): boolean {
  if (status !== 400) return false
  return /tool[_ ]choice|allowed_tools|image_generation.*tools|tools.*image_generation/i.test(body)
}

export function codexImageModelSupportsInputFidelity(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized !== 'gpt-image-2' && normalized !== 'gpt-image-2-codex'
}

export function isCodexInputFidelityModelError(status: number, body: string): boolean {
  if (status !== 400) return false
  if (/invalid_input_fidelity_model/i.test(body)) return true
  return /input_fidelity.{0,200}(?:does not support|not supported|unsupported)/is.test(body) ||
    /(?:does not support|not supported|unsupported).{0,200}input_fidelity/is.test(body)
}

export function extractCodexResponsesImage(body: string): GeneratedImage | null {
  const events = parseCodexResponsesImageEvents(body)
  const failure = events.find((event) => event.type === 'response.failed' || event.type === 'error')
  if (failure) {
    const message = failure.error?.message ??
      failure.message ??
      (failure.error?.code ? `Codex image generation failed (${failure.error.code})` : '')
    throw new Error(message || 'Codex image generation failed')
  }

  for (const event of events) {
    if (
      event.type === 'response.output_item.done' &&
      event.item?.type === 'image_generation_call'
    ) {
      const image = codexImageFromResult(event.item.result)
      if (image) return image
    }
  }

  let latestPartial: GeneratedImage | null = null
  for (const event of events) {
    if (event.type !== 'response.image_generation_call.partial_image') continue
    latestPartial = codexImageFromResult(event.partial_image_b64) ?? latestPartial
  }

  const completed = events.find((event) => event.type === 'response.completed')
  for (const item of completed?.response?.output ?? []) {
    if (item.type !== 'image_generation_call') continue
    const image = codexImageFromResult(item.result)
    if (image) return image
  }
  return latestPartial
}


function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1
  return end === value.length ? value : value.slice(0, end)
}

function isVersionSegment(value: string): boolean {
  if (value.length < 2 || value[0] !== 'v') return false
  for (let index = 1; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 48 || code > 57) return false
  }
  return true
}

// aspect_ratio values both MiniMax image models accept (21:9 is image-01
