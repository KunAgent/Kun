import type { ImageGenClient, ImageGenEditRequest, ImageGenRequest, GeneratedImage } from './image-gen-tool-provider.js'
import { createProxyFetch } from '../model/proxy-fetch.js'
import {
  CODEX_IMAGE_INSTRUCTIONS,
  CODEX_IMAGE_RESPONSES_MODEL,
  ImageGenHttpError,
  MAX_CODEX_IMAGE_SSE_BYTES,
  SIZE_TIERS,
  codexImageModelSupportsInputFidelity,
  codexResponsesImageUrl,
  extractCodexResponsesImage,
  imageDataUrl,
  imageFetchFailure,
  isCodexInputFidelityModelError,
  isCodexToolChoiceError,
  openAiCompatImageUrl,
  parseSizeLongEdge,
  readLimitedResponseText,
  summarizeCodexResponsesImage,
  volcengineArkImageUrl,
  type CodexImageToolChoiceMode,
  type ImagesApiPayload,
  type MiniMaxImagePayload,
  type VolcengineArkImagesPayload
} from './image-gen-client-codecs.js'

export function createImageGenClient(config: {
  protocol?: string
  baseUrl?: string
  apiKey?: string
  headers?: Record<string, string>
  proxyUrl?: string
}): ImageGenClient {
  // Media generation shares the provider-level model proxy so a
  // proxy-restricted provider stays reachable for tool calls too.
  const fetchImpl = createProxyFetch(config.proxyUrl ?? '') ?? fetch
  if (config.protocol === 'minimax-image') {
    return new MiniMaxImageClient(config.baseUrl!, config.apiKey!, fetchImpl)
  }
  if (config.protocol === 'codex-responses-image') {
    return new CodexResponsesImageClient(config.baseUrl!, config.apiKey!, config.headers, fetchImpl)
  }
  if (config.protocol === 'grok-imagine-image') {
    return new GrokImagineImageClient(config.baseUrl!, config.apiKey!, config.headers, fetchImpl)
  }
  if (config.protocol === 'volcengine-ark-image') {
    return new VolcengineArkImageClient(config.baseUrl!, config.apiKey!, fetchImpl)
  }
  return new OpenAiCompatImageClient(config.baseUrl!, config.apiKey!, fetchImpl)
}

/**
 * Endpoint URL for an OpenAI-compatible images API. Mirrors the chat
 * client's base-url rule so the same provider baseUrl works for both:
 * a versioned base (`…/v1`) gets the endpoint appended, anything else
 * gets `/v1` inserted first (e.g. `https://zenmux.ai/api` →
 * `…/api/v1/images/generations`). A fully-qualified endpoint URL is
 * kept, including re-routing between generations and edits.
 */

export class OpenAiCompatImageClient implements ImageGenClient {
  readonly id = 'openai-compat'
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.baseUrl = trimTrailingSlashes(baseUrl)
  }

  async generate(request: ImageGenRequest): Promise<GeneratedImage> {
    const body = (includeResponseFormat: boolean, includeQuality: boolean) =>
      JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        n: 1,
        ...(request.size ? { size: request.size } : {}),
        ...(includeQuality && request.quality && request.quality !== 'auto' ? { quality: request.quality } : {}),
        ...(includeResponseFormat ? { response_format: 'b64_json' } : {})
      })
    return this.requestImage(
      openAiCompatImageUrl(this.baseUrl, 'generations'),
      (includeResponseFormat, includeQuality) => ({
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: body(includeResponseFormat, includeQuality)
      }),
      request
    )
  }

  async edit(request: ImageGenEditRequest): Promise<GeneratedImage> {
    const buildForm = (includeResponseFormat: boolean, includeQuality: boolean) => {
      const form = new FormData()
      form.set('model', request.model)
      form.set('prompt', request.prompt)
      if (request.size) form.set('size', request.size)
      if (includeQuality && request.quality && request.quality !== 'auto') form.set('quality', request.quality)
      if (includeResponseFormat) form.set('response_format', 'b64_json')
      const field = request.images.length > 1 ? 'image[]' : 'image'
      for (const image of request.images) {
        form.append(field, new Blob([new Uint8Array(image.data)], { type: image.mimeType }), image.name)
      }
      return form
    }
    return this.requestImage(
      openAiCompatImageUrl(this.baseUrl, 'edits'),
      (includeResponseFormat, includeQuality) => ({
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: buildForm(includeResponseFormat, includeQuality)
      }),
      request
    )
  }

  /**
   * POST with two compat fallbacks: providers that reject `response_format`
   * (e.g. gpt-image-1) get one retry without it, and providers that return a
   * URL instead of b64_json (e.g. SiliconFlow default) get a second download.
   */
  private async requestImage(
    url: string,
    init: (
      includeResponseFormat: boolean,
      includeQuality: boolean
    ) => { headers: Record<string, string>; body: string | FormData },
    request: { timeoutMs: number; signal: AbortSignal; quality?: ImageGenRequest['quality'] }
  ): Promise<GeneratedImage> {
    const signal = withTimeout(request.signal, request.timeoutMs)
    const post = async (includeResponseFormat: boolean, includeQuality: boolean): Promise<Response> => {
      try {
        return await this.fetchImpl(url, { method: 'POST', ...init(includeResponseFormat, includeQuality), signal })
      } catch (error) {
        throw imageFetchFailure(url, error, request)
      }
    }
    let includeResponseFormat = true
    let includeQuality = Boolean(request.quality && request.quality !== 'auto')
    let response = await post(includeResponseFormat, includeQuality)
    if (!response.ok && response.status >= 400 && response.status < 500) {
      let errorBody = await response.text()
      if (includeQuality && /quality/i.test(errorBody)) {
        includeQuality = false
        response = await post(includeResponseFormat, includeQuality)
        if (!response.ok && response.status >= 400 && response.status < 500) {
          errorBody = await response.text()
        }
      }
      if (!response.ok && response.status >= 400 && response.status < 500) {
        if (!/response_format/i.test(errorBody)) throw new ImageGenHttpError(response.status, errorBody)
        includeResponseFormat = false
        response = await post(includeResponseFormat, includeQuality)
      }
    }
    if (!response.ok) {
      throw new ImageGenHttpError(response.status, await response.text())
    }
    const payload = (await response.json()) as ImagesApiPayload
    const entry = payload.data?.[0]
    if (entry?.b64_json) {
      return { data: Buffer.from(entry.b64_json, 'base64'), mimeType: 'image/png' }
    }
    if (entry?.url) {
      let download: Response
      try {
        download = await this.fetchImpl(entry.url, { signal })
      } catch (error) {
        throw imageFetchFailure(entry.url, error, request)
      }
      if (!download.ok) throw new ImageGenHttpError(download.status, await download.text())
      const mimeType = download.headers.get('content-type')?.split(';')[0] || 'image/png'
      return { data: Buffer.from(await download.arrayBuffer()), mimeType }
    }
    throw new Error('image provider returned no image data')
  }
}

export class VolcengineArkImageClient implements ImageGenClient {
  readonly id = 'volcengine-ark-image'
  private readonly endpointUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.endpointUrl = volcengineArkImageUrl(baseUrl)
  }

  generate(request: ImageGenRequest): Promise<GeneratedImage> {
    return this.requestImage(request)
  }

  edit(request: ImageGenEditRequest): Promise<GeneratedImage> {
    return this.requestImage(request, request.images)
  }

  private async requestImage(
    request: ImageGenRequest,
    images: ImageGenEditRequest['images'] = []
  ): Promise<GeneratedImage> {
    const signal = withTimeout(request.signal, request.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(this.endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          ...(images.length > 0 ? { image: images.map(imageDataUrl) } : {}),
          ...(request.size ? { size: request.size } : { size: '2K' }),
          output_format: 'png',
          response_format: 'b64_json',
          sequential_image_generation: 'disabled',
          stream: false,
          watermark: false
        }),
        signal
      })
    } catch (error) {
      throw imageFetchFailure(this.endpointUrl, error, request)
    }
    if (!response.ok) {
      throw new ImageGenHttpError(response.status, await response.text())
    }
    const payload = (await response.json()) as VolcengineArkImagesPayload
    const entry = payload.data?.[0]
    if (entry?.b64_json) {
      return { data: Buffer.from(entry.b64_json, 'base64'), mimeType: 'image/png' }
    }
    if (entry?.url) {
      let download: Response
      try {
        download = await this.fetchImpl(entry.url, { signal })
      } catch (error) {
        throw imageFetchFailure(entry.url, error, request)
      }
      if (!download.ok) throw new ImageGenHttpError(download.status, await download.text())
      const mimeType = download.headers.get('content-type')?.split(';')[0] || 'image/png'
      return { data: Buffer.from(await download.arrayBuffer()), mimeType }
    }
    const detail = payload.error?.message?.trim() || payload.error?.code?.trim()
    throw new Error(detail
      ? `Volcano Ark image provider returned no image data: ${detail}`
      : 'Volcano Ark image provider returned no image data')
  }
}

export class GrokImagineImageClient implements ImageGenClient {
  readonly id = 'grok-imagine-image'
  private readonly endpointUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly headers: Record<string, string> = {},
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.endpointUrl = openAiCompatImageUrl(baseUrl, 'generations')
  }

  async generate(request: ImageGenRequest): Promise<GeneratedImage> {
    const signal = withTimeout(request.signal, request.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(this.endpointUrl, {
        method: 'POST',
        headers: {
          ...this.headers,
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          n: 1,
          aspect_ratio: request.aspectRatio ?? 'auto',
          resolution: grokImagineResolution(request.size),
          response_format: 'b64_json'
        }),
        signal
      })
    } catch (error) {
      throw imageFetchFailure(this.endpointUrl, error, request)
    }
    const text = await response.text()
    if (!response.ok) throw new ImageGenHttpError(response.status, text)
    let payload: ImagesApiPayload
    try {
      payload = JSON.parse(text) as ImagesApiPayload
    } catch {
      throw new Error('Grok Imagine image provider returned invalid JSON')
    }
    const b64 = payload.data?.[0]?.b64_json
    if (!b64) throw new Error('Grok Imagine image provider returned no image data')
    return { data: Buffer.from(b64, 'base64'), mimeType: 'image/jpeg' }
  }

  async edit(_request: ImageGenEditRequest): Promise<GeneratedImage> {
    throw new Error('Grok Imagine image editing is not supported by this tool')
  }
}

function grokImagineResolution(size: string | undefined): '1k' | '2k' {
  const longEdge = size ? parseSizeLongEdge(size) : undefined
  return longEdge && longEdge >= SIZE_TIERS['2K'] ? '2k' : '1k'
}

export class CodexResponsesImageClient implements ImageGenClient {
  readonly id = 'codex-responses-image'
  private readonly endpointUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly headers: Record<string, string> = {},
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.endpointUrl = codexResponsesImageUrl(baseUrl)
  }

  async generate(request: ImageGenRequest): Promise<GeneratedImage> {
    return this.requestImage(request, [])
  }

  async edit(request: ImageGenEditRequest): Promise<GeneratedImage> {
    return this.requestImage(request, request.images)
  }

  private async requestImage(
    request: ImageGenRequest,
    inputImages: { name: string; mimeType: string; data: Buffer }[]
  ): Promise<GeneratedImage> {
    const signal = withTimeout(request.signal, request.timeoutMs)
    const shouldRequestInputFidelity = inputImages.length > 0 &&
      codexImageModelSupportsInputFidelity(request.model)
    const buildBody = (
      toolChoiceMode: CodexImageToolChoiceMode,
      includeInputFidelity: boolean
    ) => JSON.stringify({
      model: CODEX_IMAGE_RESPONSES_MODEL,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: request.prompt },
            ...inputImages.map((image) => ({
              type: 'input_image',
              image_url: imageDataUrl(image),
              detail: 'high'
            }))
          ]
        }
      ],
      instructions: CODEX_IMAGE_INSTRUCTIONS,
      tools: [
        {
          type: 'image_generation',
          action: inputImages.length > 0 ? 'edit' : 'generate',
          model: request.model,
          quality: request.quality ?? 'auto',
          output_format: 'png',
          background: 'opaque',
          partial_images: 1,
          ...(includeInputFidelity ? { input_fidelity: 'high' } : {}),
          ...(request.size ? { size: request.size } : {})
        }
      ],
      ...(toolChoiceMode === 'allowed_tools'
        ? {
            tool_choice: {
              type: 'allowed_tools',
              mode: 'required',
              tools: [{ type: 'image_generation' }]
            }
          }
        : toolChoiceMode === 'required'
          ? { tool_choice: 'required' }
          : {}),
      stream: true,
      store: false
    })

    let lastHttpError: ImageGenHttpError | null = null
    let lastEmptyResponse = ''
    let includeInputFidelity = shouldRequestInputFidelity
    let retriedWithoutInputFidelity = false
    const post = async (
      mode: CodexImageToolChoiceMode,
      withInputFidelity: boolean
    ): Promise<{ response: Response; text: string }> => {
      let response: Response
      try {
        response = await this.fetchImpl(this.endpointUrl, {
          method: 'POST',
          headers: {
            ...this.headers,
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'text/event-stream',
            'Content-Type': 'application/json'
          },
          body: buildBody(mode, withInputFidelity),
          signal
        })
      } catch (error) {
        throw imageFetchFailure(this.endpointUrl, error, request)
      }
      return {
        response,
        text: await readLimitedResponseText(response, MAX_CODEX_IMAGE_SSE_BYTES)
      }
    }

    for (const mode of ['allowed_tools', 'required', 'none'] satisfies CodexImageToolChoiceMode[]) {
      let { response, text } = await post(mode, includeInputFidelity)
      if (
        !response.ok &&
        includeInputFidelity &&
        !retriedWithoutInputFidelity &&
        isCodexInputFidelityModelError(response.status, text)
      ) {
        // Retry immediately in the same tool-choice mode. Once the provider has
        // established that this routed model rejects the field, keep it omitted
        // from any later tool-choice compatibility attempts in this request.
        includeInputFidelity = false
        retriedWithoutInputFidelity = true
        ;({ response, text } = await post(mode, false))
      }
      if (!response.ok) {
        const error = new ImageGenHttpError(response.status, text)
        lastHttpError = error
        if (isCodexToolChoiceError(response.status, text)) continue
        throw error
      }
      const image = extractCodexResponsesImage(text)
      if (image) return image
      lastEmptyResponse = `Codex image provider returned no image data${summarizeCodexResponsesImage(text)}`
      if (mode !== 'none') continue
    }
    if (lastEmptyResponse) throw new Error(lastEmptyResponse)
    if (lastHttpError) throw lastHttpError
    throw new Error('Codex image provider returned no image data')
  }
}

export class MiniMaxImageClient implements ImageGenClient {
  readonly id = 'minimax-image'
  private readonly endpointUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.endpointUrl = minimaxImageGenerationUrl(baseUrl)
  }

  async generate(request: ImageGenRequest): Promise<GeneratedImage> {
    return this.requestImage({
      model: request.model,
      prompt: request.prompt,
      ...minimaxImageDimensionFields(request.model, request.size),
      prompt_optimizer: true,
      response_format: 'base64',
      n: 1
    }, request)
  }

  async edit(request: ImageGenEditRequest): Promise<GeneratedImage> {
    return this.requestImage({
      model: request.model,
      prompt: request.prompt,
      ...minimaxImageDimensionFields(request.model, request.size),
      subject_reference: request.images.map((image) => ({
        type: 'character',
        image_file: `data:${image.mimeType};base64,${image.data.toString('base64')}`
      })),
      prompt_optimizer: true,
      response_format: 'base64',
      n: 1
    }, request)
  }

  private async requestImage(
    body: Record<string, unknown>,
    request: { timeoutMs: number; signal: AbortSignal }
  ): Promise<GeneratedImage> {
    const signal = withTimeout(request.signal, request.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(this.endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal
      })
    } catch (error) {
      throw imageFetchFailure(this.endpointUrl, error, request)
    }
    const text = await response.text()
    if (!response.ok) throw new ImageGenHttpError(response.status, text)
    let payload: MiniMaxImagePayload
    try {
      payload = JSON.parse(text) as MiniMaxImagePayload
    } catch {
      throw new Error('MiniMax image provider returned invalid JSON')
    }
    const statusCode = payload.base_resp?.status_code
    if (typeof statusCode === 'number' && statusCode !== 0) {
      throw new Error(`MiniMax image provider failed (${statusCode}): ${payload.base_resp?.status_msg ?? 'unknown error'}`)
    }
    const b64 = payload.data?.image_base64?.[0]
    if (b64) {
      return { data: Buffer.from(b64, 'base64'), mimeType: 'image/jpeg' }
    }
    const imageUrl = payload.data?.image_urls?.[0]
    if (imageUrl) {
      let download: Response
      try {
        download = await this.fetchImpl(imageUrl, { signal })
      } catch (error) {
        throw imageFetchFailure(imageUrl, error, request)
      }
      if (!download.ok) throw new ImageGenHttpError(download.status, await download.text())
      const mimeType = download.headers.get('content-type')?.split(';')[0] || 'image/jpeg'
      return { data: Buffer.from(await download.arrayBuffer()), mimeType }
    }
    throw new Error('MiniMax image provider returned no image data')
  }
}

function minimaxImageGenerationUrl(baseUrl: string): string {
  const normalized = trimTrailingSlashes(baseUrl.trim())
  const lower = normalized.toLowerCase()
  if (!normalized) return '/v1/image_generation'
  if (lower.endsWith('/v1/image_generation') || lower.endsWith('/image_generation')) return normalized
  if (lower.endsWith('/v1')) return `${normalized}/image_generation`
  return `${normalized}/v1/image_generation`
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
// only, and image-01 receives explicit width/height instead).
const MINIMAX_ASPECT_RATIOS: Array<{ label: string; value: number }> = [
  { label: '1:1', value: 1 },
  { label: '16:9', value: 16 / 9 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '9:16', value: 9 / 16 }
]

/**
 * MiniMax dimension fields for a `WxH` size. Per the t2i API docs only
 * image-01 accepts explicit width/height (range [512, 2048], multiples
 * of 8); image-01-live rejects them with status 2013, so every other model
 * gets the nearest supported aspect_ratio instead. Nearest (not exact)
 * because mapImageSize rounds edges to multiples of 8 — e.g. 3:2 at the 1K
 * tier becomes 1024x680.
 */
export function minimaxImageDimensionFields(
  model: string,
  size: string | undefined
): Record<string, unknown> {
  const match = size?.trim().match(/^(\d+)x(\d+)$/)
  if (!match) return {}
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return {}
  if (model.trim() === 'image-01') return { width, height }
  const target = width / height
  let best = MINIMAX_ASPECT_RATIOS[0]
  let bestDiff = Number.POSITIVE_INFINITY
  for (const candidate of MINIMAX_ASPECT_RATIOS) {
    const diff = Math.abs(Math.log(candidate.value / target))
    if (diff < bestDiff) {
      bestDiff = diff
      best = candidate
    }
  }
  return { aspect_ratio: best.label }
}

function withTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}
