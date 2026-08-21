import { ImageGenHttpError, describeNetworkError } from './image-gen-tool-provider.js'
import { createProxyFetch } from '../model/proxy-fetch.js'

const AUDIO_FORMATS = new Set(['mp3', 'wav', 'flac', 'pcm', 'pcm16'])
const GROK_VIDEO_RESOLUTIONS = ['480P', '720P'] as const
const GROK_VIDEO_DURATIONS = [6, 10] as const
const VOLCENGINE_VIDEO_RESOLUTIONS = ['480P', '720P', '1080P', '4K'] as const

export type MiniMaxBaseResponse = {
  status_code?: number
  status_msg?: string
}

/** Shared media fetch honoring the provider-level model proxy when set. */
export function createMediaFetch(proxyUrl: string | undefined): typeof fetch {
  return createProxyFetch(proxyUrl ?? '') ?? fetch
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  request: { timeoutMs: number; signal: AbortSignal },
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const response = await requestResponse(url, init, request, fetchImpl)
  const text = await response.text()
  if (!response.ok) throw new ImageGenHttpError(response.status, text)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`provider returned invalid JSON from ${url.split('?')[0]}`)
  }
}

export async function requestResponse(
  url: string,
  init: RequestInit,
  request: { timeoutMs: number; signal: AbortSignal },
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  try {
    return await fetchImpl(url, init)
  } catch (error) {
    throw mediaFetchFailure(url, error, request)
  }
}

function mediaFetchFailure(
  url: string,
  error: unknown,
  request: { timeoutMs: number }
): Error {
  const target = url.split('?')[0]
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new Error(`media request to ${target} timed out after ${request.timeoutMs}ms`, { cause: error })
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error(`media request to ${target} was canceled`, { cause: error })
  }
  return new Error(`media request to ${target} failed: ${describeNetworkError(error)}`, { cause: error })
}

export function apiUrl(baseUrl: string, v1Path: string): string {
  const normalized = trimTrailingSlashes(baseUrl.trim())
  const lower = normalized.toLowerCase()
  const path = v1Path.startsWith('/') ? v1Path : `/${v1Path}`
  const pathWithoutV1 = path.startsWith('/v1/') ? path.slice('/v1'.length) : path
  if (!normalized) return path
  if (lower.endsWith(path.toLowerCase()) || lower.endsWith(pathWithoutV1.toLowerCase())) return normalized
  if (lower.endsWith('/v1')) return `${normalized}${pathWithoutV1}`
  return `${normalized}${path}`
}

export function minimaxRootUrl(baseUrl: string): string {
  const normalized = trimTrailingSlashes(baseUrl.trim())
  if (!normalized) return ''
  for (const suffix of ['/v1/video_generation', '/video_generation', '/v1/query/video_generation']) {
    if (normalized.toLowerCase().endsWith(suffix)) {
      return trimTrailingSlashes(normalized.slice(0, -suffix.length))
    }
  }
  if (normalized.toLowerCase().endsWith('/v1')) return trimTrailingSlashes(normalized.slice(0, -3))
  return normalized
}

export function volcengineArkVideoTasksUrl(baseUrl: string): string {
  const normalized = trimTrailingSlashes(baseUrl.trim())
  if (!normalized) return '/contents/generations/tasks'
  if (normalized.toLowerCase().endsWith('/contents/generations/tasks')) return normalized
  return `${normalized}/contents/generations/tasks`
}

export function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1
  return end === value.length ? value : value.slice(0, end)
}

export function assertMiniMaxOk(baseResp: MiniMaxBaseResponse | undefined, label: string): void {
  const statusCode = baseResp?.status_code
  if (typeof statusCode === 'number' && statusCode !== 0) {
    throw new Error(`${label} failed (${statusCode}): ${baseResp?.status_msg ?? 'unknown error'}`)
  }
}

export function bufferFromHex(value: string): Buffer {
  const normalized = value.replace(/\s+/g, '')
  if (!normalized || normalized.length % 2 !== 0 || /[^0-9a-f]/i.test(normalized)) {
    throw new Error('provider returned invalid hex audio data')
  }
  return Buffer.from(normalized, 'hex')
}

export function withTimeout(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

export function dataUri(mimeType: string, data: Buffer): string {
  return `data:${mimeType};base64,${data.toString('base64')}`
}

export function normalizeAudioFormat(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase()
  return normalized && AUDIO_FORMATS.has(normalized) ? normalized : 'mp3'
}

export function audioMimeType(format: string): string {
  switch (normalizeAudioFormat(format)) {
    case 'wav':
      return 'audio/wav'
    case 'flac':
      return 'audio/flac'
    case 'pcm':
    case 'pcm16':
      return 'audio/L16'
    case 'mp3':
    default:
      return 'audio/mpeg'
  }
}

export function audioExtension(format: string): string {
  const normalized = normalizeAudioFormat(format)
  return normalized === 'pcm16' ? 'pcm' : normalized
}

export function videoExtension(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('quicktime')) return 'mov'
  return 'mp4'
}

export function normalizeDuration(value: unknown, fallback: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(30, Math.max(1, candidate))
}

export function normalizeGrokVideoDuration(value: unknown, fallback: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return GROK_VIDEO_DURATIONS.includes(candidate as 6 | 10) ? candidate : 6
}

export function normalizeGrokVideoResolution(value: unknown, fallback: string): string {
  const candidate = (pickString(value) || fallback).toUpperCase()
  return GROK_VIDEO_RESOLUTIONS.includes(candidate as '480P' | '720P') ? candidate : '480P'
}

export function normalizeVolcengineVideoDuration(value: unknown, fallback: number): number {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(15, Math.max(4, candidate))
}

export function normalizeVolcengineVideoResolution(value: unknown, fallback: string): string {
  const candidate = (pickString(value) || fallback).toUpperCase()
  return VOLCENGINE_VIDEO_RESOLUTIONS.includes(
    candidate as (typeof VOLCENGINE_VIDEO_RESOLUTIONS)[number]
  )
    ? candidate
    : '720P'
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function isSuccessStatus(status: string): boolean {
  return ['success', 'succeeded', 'completed', 'complete'].includes(status.trim().toLowerCase())
}

export function isFailureStatus(status: string): boolean {
  return ['fail', 'failed', 'error', 'canceled', 'cancelled'].includes(status.trim().toLowerCase())
}

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise((resolveDelay, rejectDelay) => {
    const timer = setTimeout(resolveDelay, ms)
    const abort = () => {
      clearTimeout(timer)
      rejectDelay(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
