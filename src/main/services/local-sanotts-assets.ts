import { app } from 'electron'
import * as electron from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { LocalSanottsVoiceId } from '../../shared/local-sanotts-voices'
import { fileSha256, readVerifiedAssetSize } from './local-sanotts-asset-integrity'

export { fileSha256, readVerifiedAssetSize } from './local-sanotts-asset-integrity'

export const SANOTTS_CONNECT_TIMEOUT_MS = 20_000
export const SANOTTS_STALL_TIMEOUT_MS = 30_000
export const SANOTTS_SOURCE_CHECK_TIMEOUT_MS = 8_000

/** Root for every downloaded sanoTTS asset, sibling to the Whisper model store. */
export function localSanottsBaseDir(): string {
  return join(app.getPath('userData'), 'models', 'speech', 'sanotts')
}

export function localSanottsRuntimeDir(): string {
  return join(localSanottsBaseDir(), 'runtime')
}

export function localSanottsRuntimeFilePath(fileName: string): string {
  return join(localSanottsRuntimeDir(), fileName)
}

export function localSanottsRuntimeMetadataPath(): string {
  return join(localSanottsRuntimeDir(), 'runtime.json')
}

export function localSanottsVoiceDir(voiceId: LocalSanottsVoiceId): string {
  return join(localSanottsBaseDir(), 'voices', voiceId)
}

export function localSanottsVoiceFilePath(voiceId: LocalSanottsVoiceId, fileName: string): string {
  return join(localSanottsVoiceDir(voiceId), fileName)
}

export function legacyKokoroSpeechDir(): string {
  return join(app.getPath('userData'), 'models', 'speech', 'kokoro')
}

export async function removeLegacyKokoroSpeechCache(): Promise<void> {
  await rm(legacyKokoroSpeechDir(), { recursive: true, force: true }).catch(() => undefined)
}

export function localSanottsUserAgent(): string {
  let version = 'dev'
  try {
    version = app?.getVersion?.() || version
  } catch {
    version = 'dev'
  }
  return `Kun/${version} local-sanotts`
}

/** Electron's network stack honors the desktop's proxy configuration. */
export function sanottsFetch(input: string, init?: RequestInit): Promise<Response> {
  if ('net' in electron && typeof electron.net?.fetch === 'function') {
    return electron.net.fetch(input, init)
  }
  // Unit tests run in Node with a partial Electron mock. Never silently switch
  // production downloads to Node's different proxy/network behavior.
  if (process.env.NODE_ENV === 'test') return fetch(input, init)
  throw new Error('Electron network transport is unavailable for sanoTTS downloads')
}

export function readContentLength(headers: Headers): number | undefined {
  const raw = headers.get('content-length')
  if (!raw) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function describeSanottsDownloadError(error: unknown, timeoutMessage: string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof Error && error.name === 'AbortError') return timeoutMessage
  if (/aborted|terminated|network|fetch failed|socket|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(message)) {
    return `sanoTTS download failed because the network connection was interrupted: ${message}`
  }
  return message
}

export type SanottsAssetDownload = {
  url: string
  targetPath: string
  sizeBytes: number
  maxBytes: number
  sha256: string
  controller: AbortController
  onProgress?: (downloadedBytes: number, totalBytes: number | undefined, bytesPerSecond: number) => void
  metadata?: { path: string; content: Record<string, unknown> }
}

/**
 * Stream one asset to disk, then verify its byte length and SHA-256 before it
 * replaces the destination. A partial or tampered file is never published.
 */
export async function downloadVerifiedAsset(request: SanottsAssetDownload): Promise<void> {
  const tempPath = `${request.targetPath}.download`
  // Timeouts belong to this attempt; they must not cancel the caller's remaining
  // mirrors/retries. Keep explicit user cancellation linked through verification.
  const controller = new AbortController()
  const onAbort = (): void => controller.abort(request.controller.signal.reason)
  request.controller.signal.addEventListener('abort', onAbort, { once: true })
  if (request.controller.signal.aborted) onAbort()
  let timeoutError: Error | undefined
  let connectTimer: NodeJS.Timeout | undefined
  let stallTimer: NodeJS.Timeout | undefined
  let response: Response | undefined
  let bodyStream: Readable | undefined
  const clearTimers = (): void => {
    if (connectTimer) clearTimeout(connectTimer)
    if (stallTimer) clearTimeout(stallTimer)
  }
  const timeout = (kind: 'connect' | 'stall'): void => {
    timeoutError = new Error(sanottsTimeoutMessage(kind))
    timeoutError.name = 'TimeoutError'
    controller.abort(timeoutError)
  }
  const resetStallTimer = (): void => {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => timeout('stall'), SANOTTS_STALL_TIMEOUT_MS)
  }
  const writeMetadata = async (): Promise<void> => {
    controller.signal.throwIfAborted()
    if (request.metadata) {
      await writeFile(request.metadata.path, JSON.stringify(request.metadata.content, null, 2), 'utf8')
    }
    controller.signal.throwIfAborted()
  }
  try {
    controller.signal.throwIfAborted()
    await mkdir(dirname(request.targetPath), { recursive: true })
    await rm(tempPath, { force: true })
    if (await readVerifiedAssetSize(request.targetPath, request, controller.signal) !== null) {
      request.onProgress?.(request.sizeBytes, request.sizeBytes, 0)
      await writeMetadata()
      return
    }
    controller.signal.throwIfAborted()
    // The connection deadline covers DNS, TLS, redirects and response headers.
    connectTimer = setTimeout(() => timeout('connect'), SANOTTS_CONNECT_TIMEOUT_MS)
    response = await sanottsFetch(request.url, {
      headers: { 'User-Agent': localSanottsUserAgent() },
      signal: controller.signal,
      redirect: 'follow'
    })
    if (connectTimer) clearTimeout(connectTimer)
    controller.signal.throwIfAborted()
    if (!response.ok || !response.body) {
      throw new Error(`failed to download sanoTTS asset: HTTP ${response.status}`)
    }
    const totalBytes = readContentLength(response.headers)
    if (totalBytes && totalBytes > request.maxBytes) {
      throw new Error(`sanoTTS asset is larger than the ${Math.round(request.maxBytes / 1024 / 1024)} MB limit`)
    }
    let downloadedBytes = 0
    const startedAt = Date.now()
    bodyStream = Readable.fromWeb(response.body as never)
    bodyStream.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length
      resetStallTimer()
      const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000)
      request.onProgress?.(downloadedBytes, totalBytes, downloadedBytes / elapsedSeconds)
      if (downloadedBytes > request.maxBytes) {
        bodyStream?.destroy(new Error('sanoTTS asset exceeded the local size limit'))
      }
    })
    resetStallTimer()
    request.onProgress?.(0, totalBytes, 0)
    await pipeline(bodyStream, createWriteStream(tempPath, { flags: 'wx' }), { signal: controller.signal })
    // Disk verification is abortable, but is not a stalled network connection.
    clearTimers()
    controller.signal.throwIfAborted()
    const info = await stat(tempPath)
    if (info.size <= 0 || info.size > request.maxBytes) {
      throw new Error('downloaded sanoTTS asset size is invalid')
    }
    if (info.size !== request.sizeBytes) {
      throw new Error(
        `downloaded sanoTTS asset size mismatch: expected ${request.sizeBytes} bytes, got ${info.size} bytes`
      )
    }
    const actualSha256 = await fileSha256(tempPath, controller.signal)
    if (actualSha256 !== request.sha256) {
      throw new Error(
        `downloaded sanoTTS asset checksum mismatch: expected ${request.sha256}, got ${actualSha256}`
      )
    }
    controller.signal.throwIfAborted()
    await rename(tempPath, request.targetPath)
    await writeMetadata()
  } catch (error) {
    clearTimers()
    // Also terminate an unconsumed HTTP error/oversized body. A fetch failure
    // need not have destroyed the response stream itself.
    controller.abort()
    bodyStream?.destroy()
    await rm(tempPath, { force: true }).catch(() => undefined)
    if (request.controller.signal.aborted) request.controller.signal.throwIfAborted()
    if (timeoutError) throw timeoutError
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimers()
    request.controller.signal.removeEventListener('abort', onAbort)
    if (response?.body && !response.body.locked) {
      await response.body.cancel().catch(() => undefined)
    }
  }
}

export function sanottsTimeoutMessage(kind: 'connect' | 'stall' | 'source'): string {
  if (kind === 'connect') {
    return `sanoTTS download did not connect within ${Math.round(SANOTTS_CONNECT_TIMEOUT_MS / 1000)} seconds`
  }
  if (kind === 'source') {
    return `source check timed out after ${Math.round(SANOTTS_SOURCE_CHECK_TIMEOUT_MS / 1000)} seconds`
  }
  return `sanoTTS download stalled for ${Math.round(SANOTTS_STALL_TIMEOUT_MS / 1000)} seconds`
}

/** Raw on-disk size only; use readVerifiedAssetSize for readiness decisions. */
export async function readAssetSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}
