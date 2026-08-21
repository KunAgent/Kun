import { ImageGenHttpError } from './image-gen-tool-provider.js'
import type { GeneratedMedia, VideoGenClient, VideoGenRequest } from './media-gen-tool-provider.js'
import {
  assertMiniMaxOk,
  createMediaFetch,
  dataUri,
  delay,
  isFailureStatus,
  isSuccessStatus,
  minimaxRootUrl,
  requestJson,
  requestResponse,
  trimTrailingSlashes,
  videoExtension,
  volcengineArkVideoTasksUrl,
  withTimeout
} from './media-gen-client-support.js'

type MiniMaxVideoCreatePayload = {
  task_id?: string
  base_resp?: MiniMaxBaseResponse
}

type MiniMaxVideoQueryPayload = {
  status?: string
  file_id?: string
  base_resp?: MiniMaxBaseResponse
}

type MiniMaxFileRetrievePayload = {
  file?: { download_url?: string }
  base_resp?: MiniMaxBaseResponse
}

type MiniMaxBaseResponse = {
  status_code?: number
  status_msg?: string
}

type GrokVideoCreatePayload = {
  request_id?: string
}

type GrokVideoPollPayload = {
  status?: string
  video?: { url?: string }
}

type VolcengineArkVideoContent =
  | { type: 'text'; text: string }
  | {
      type: 'image_url'
      image_url: { url: string }
      role: 'first_frame' | 'last_frame'
    }

type VolcengineArkVideoCreatePayload = {
  id?: string
}

type VolcengineArkVideoTaskPayload = {
  status?: string
  content?: { video_url?: string }
  error?: { code?: string; message?: string }
}


export function createVideoGenClient(config: {
  protocol?: string
  baseUrl?: string
  apiKey?: string
  headers?: Record<string, string>
  proxyUrl?: string
}): VideoGenClient {
  // Media generation shares the provider-level model proxy with chat requests.
  const fetchImpl = createMediaFetch(config.proxyUrl)
  if (config.protocol === 'grok-imagine-video') {
    return new GrokImagineVideoClient(config.baseUrl!, config.apiKey!, config.headers, fetchImpl)
  }
  if (config.protocol === 'volcengine-ark-video') {
    return new VolcengineArkVideoClient(config.baseUrl!, config.apiKey!, fetchImpl)
  }
  return new MiniMaxVideoClient(config.baseUrl!, config.apiKey!, fetchImpl)
}


export class MiniMaxVideoClient implements VideoGenClient {
  readonly id = 'minimax-video'
  private readonly rootUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.rootUrl = minimaxRootUrl(baseUrl)
  }

  async generate(request: VideoGenRequest): Promise<GeneratedMedia> {
    const signal = withTimeout(request.signal, request.timeoutMs)
    const createPayload = await requestJson<MiniMaxVideoCreatePayload>(`${this.rootUrl}/v1/video_generation`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        duration: request.duration,
        resolution: request.resolution,
        ...(request.firstFrameImage
          ? { first_frame_image: dataUri(request.firstFrameImage.mimeType, request.firstFrameImage.data) }
          : {}),
        ...(request.lastFrameImage
          ? { last_frame_image: dataUri(request.lastFrameImage.mimeType, request.lastFrameImage.data) }
          : {})
      }),
      signal
    }, request, this.fetchImpl)
    assertMiniMaxOk(createPayload.base_resp, 'MiniMax video provider')
    const taskId = createPayload.task_id
    if (!taskId) throw new Error('MiniMax video provider returned no task_id')
    await request.onUpdate?.({
      output: { status: 'submitted', taskId, provider: this.id }
    })

    const deadline = Date.now() + request.timeoutMs
    let lastStatus = 'submitted'
    while (Date.now() < deadline) {
      await delay(request.pollIntervalMs, signal)
      const queryUrl = new URL(`${this.rootUrl}/v1/query/video_generation`)
      queryUrl.searchParams.set('task_id', taskId)
      const queryPayload = await requestJson<MiniMaxVideoQueryPayload>(queryUrl.toString(), {
        method: 'GET',
        headers: this.headers(),
        signal
      }, request, this.fetchImpl)
      assertMiniMaxOk(queryPayload.base_resp, 'MiniMax video provider')
      lastStatus = queryPayload.status || lastStatus
      await request.onUpdate?.({
        output: { status: lastStatus, taskId, provider: this.id }
      })
      if (isFailureStatus(lastStatus)) {
        throw new Error(`MiniMax video generation failed with status ${lastStatus}`)
      }
      if (!isSuccessStatus(lastStatus)) continue
      const fileId = queryPayload.file_id
      if (!fileId) throw new Error('MiniMax video provider finished without file_id')
      const downloadUrl = await this.retrieveDownloadUrl(fileId, request)
      const response = await requestResponse(downloadUrl, { method: 'GET', signal }, request, this.fetchImpl)
      if (!response.ok) throw new ImageGenHttpError(response.status, await response.text())
      const mimeType = response.headers.get('content-type')?.split(';')[0] || 'video/mp4'
      return {
        data: Buffer.from(await response.arrayBuffer()),
        mimeType,
        extension: videoExtension(mimeType)
      }
    }
    throw new Error(`MiniMax video generation timed out after ${request.timeoutMs}ms (last status: ${lastStatus})`)
  }

  private async retrieveDownloadUrl(fileId: string, request: { timeoutMs: number; signal: AbortSignal }): Promise<string> {
    const retrieveUrl = new URL(`${this.rootUrl}/v1/files/retrieve`)
    retrieveUrl.searchParams.set('file_id', fileId)
    const payload = await requestJson<MiniMaxFileRetrievePayload>(retrieveUrl.toString(), {
      method: 'GET',
      headers: this.headers(),
      signal: withTimeout(request.signal, request.timeoutMs)
    }, request, this.fetchImpl)
    assertMiniMaxOk(payload.base_resp, 'MiniMax video provider')
    const downloadUrl = payload.file?.download_url
    if (!downloadUrl) throw new Error('MiniMax video provider returned no download_url')
    return downloadUrl
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    }
  }
}

export class VolcengineArkVideoClient implements VideoGenClient {
  readonly id = 'volcengine-ark-video'
  private readonly tasksUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.tasksUrl = volcengineArkVideoTasksUrl(baseUrl)
  }

  async generate(request: VideoGenRequest): Promise<GeneratedMedia> {
    const signal = withTimeout(request.signal, request.timeoutMs)
    const content: VolcengineArkVideoContent[] = [
      { type: 'text', text: request.prompt }
    ]
    if (request.firstFrameImage) {
      content.push({
        type: 'image_url',
        image_url: {
          url: dataUri(request.firstFrameImage.mimeType, request.firstFrameImage.data)
        },
        role: 'first_frame'
      })
    }
    if (request.lastFrameImage) {
      content.push({
        type: 'image_url',
        image_url: {
          url: dataUri(request.lastFrameImage.mimeType, request.lastFrameImage.data)
        },
        role: 'last_frame'
      })
    }

    const createPayload = await requestJson<VolcengineArkVideoCreatePayload>(this.tasksUrl, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        content,
        generate_audio: true,
        ...(request.aspectRatio ? { ratio: request.aspectRatio } : {}),
        duration: request.duration,
        resolution: request.resolution.toLowerCase(),
        watermark: false
      }),
      signal
    }, request, this.fetchImpl)
    const taskId = createPayload.id?.trim()
    if (!taskId) throw new Error('Volcano Ark video provider returned no task id')
    await request.onUpdate?.({
      output: { status: 'submitted', taskId, provider: this.id }
    })

    const deadline = Date.now() + request.timeoutMs
    let lastStatus = 'submitted'
    try {
      while (Date.now() < deadline) {
        await delay(request.pollIntervalMs, signal)
        const pollPayload = await requestJson<VolcengineArkVideoTaskPayload>(
          `${this.tasksUrl}/${encodeURIComponent(taskId)}`,
          {
            method: 'GET',
            headers: this.headers(),
            signal
          },
          request,
          this.fetchImpl
        )
        lastStatus = pollPayload.status?.trim().toLowerCase() || lastStatus
        await request.onUpdate?.({
          output: { status: lastStatus, taskId, provider: this.id }
        })
        if (['failed', 'expired', 'cancelled', 'canceled'].includes(lastStatus)) {
          const detail = pollPayload.error?.message?.trim() || pollPayload.error?.code?.trim()
          throw new Error(
            `Volcano Ark video generation ${lastStatus} (task_id=${taskId})${detail ? `: ${detail}` : ''}`
          )
        }
        if (lastStatus !== 'succeeded') continue
        const downloadUrl = pollPayload.content?.video_url?.trim()
        if (!downloadUrl) {
          throw new Error('Volcano Ark video provider finished without content.video_url')
        }
        const response = await requestResponse(downloadUrl, { method: 'GET', signal }, request, this.fetchImpl)
        if (!response.ok) throw new ImageGenHttpError(response.status, await response.text())
        const mimeType = response.headers.get('content-type')?.split(';')[0] || 'video/mp4'
        return {
          data: Buffer.from(await response.arrayBuffer()),
          mimeType,
          extension: videoExtension(mimeType)
        }
      }
    } catch (error) {
      const signalReasonName = signal.reason instanceof Error ? signal.reason.name : ''
      if (!request.signal.aborted && signal.aborted && signalReasonName === 'TimeoutError') {
        throw new Error(
          `Volcano Ark video generation timed out after ${request.timeoutMs}ms (last status: ${lastStatus})`
        )
      }
      throw error
    }
    throw new Error(
      `Volcano Ark video generation timed out after ${request.timeoutMs}ms (last status: ${lastStatus})`
    )
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    }
  }
}

export class GrokImagineVideoClient implements VideoGenClient {
  readonly id = 'grok-imagine-video'
  private readonly rootUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly extraHeaders: Record<string, string> = {},
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.rootUrl = trimTrailingSlashes(baseUrl)
  }

  async generate(request: VideoGenRequest): Promise<GeneratedMedia> {
    if (request.lastFrameImage) {
      throw new Error('Grok Imagine video does not support an explicit last frame')
    }
    const signal = withTimeout(request.signal, request.timeoutMs)
    const createPayload = await requestJson<GrokVideoCreatePayload>(`${this.rootUrl}/videos/generations`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        duration: request.duration,
        resolution: request.resolution.toLowerCase(),
        ...(request.firstFrameImage
          ? { image: { url: dataUri(request.firstFrameImage.mimeType, request.firstFrameImage.data) } }
          : request.aspectRatio
            ? { aspect_ratio: request.aspectRatio }
            : {}),
        reference_images: []
      }),
      signal
    }, request, this.fetchImpl)
    const requestId = createPayload.request_id?.trim()
    if (!requestId) throw new Error('Grok Imagine video provider returned no request_id')
    await request.onUpdate?.({
      output: { status: 'submitted', taskId: requestId, provider: this.id }
    })

    const deadline = Date.now() + request.timeoutMs
    let lastStatus = 'submitted'
    while (Date.now() < deadline) {
      await delay(request.pollIntervalMs, signal)
      const pollPayload = await requestJson<GrokVideoPollPayload>(
        `${this.rootUrl}/videos/${encodeURIComponent(requestId)}`,
        { method: 'GET', headers: this.headers(), signal },
        request,
        this.fetchImpl
      )
      lastStatus = pollPayload.status?.trim().toLowerCase() || lastStatus
      await request.onUpdate?.({
        output: { status: lastStatus, taskId: requestId, provider: this.id }
      })
      if (lastStatus === 'failed' || lastStatus === 'expired') {
        throw new Error(`Grok Imagine video generation ${lastStatus} (request_id=${requestId})`)
      }
      if (lastStatus !== 'done') continue
      const downloadUrl = pollPayload.video?.url?.trim()
      if (!downloadUrl) throw new Error('Grok Imagine video provider finished without a download URL')
      const response = await requestResponse(downloadUrl, { method: 'GET', signal }, request, this.fetchImpl)
      if (!response.ok) throw new ImageGenHttpError(response.status, await response.text())
      const mimeType = response.headers.get('content-type')?.split(';')[0] || 'video/mp4'
      return {
        data: Buffer.from(await response.arrayBuffer()),
        mimeType,
        extension: videoExtension(mimeType)
      }
    }
    throw new Error(`Grok Imagine video generation timed out after ${request.timeoutMs}ms (last status: ${lastStatus})`)
  }

  private headers(): Record<string, string> {
    return {
      ...this.extraHeaders,
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    }
  }
}
