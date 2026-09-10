import { app } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import {
  localKokoroModelById,
  type LocalKokoroModelId
} from '../../shared/local-kokoro'
import type { LocalKokoroVoiceId } from '../../shared/local-kokoro-voices'

export const KOKORO_CONNECT_TIMEOUT_MS = 20_000
export const KOKORO_STALL_TIMEOUT_MS = 30_000
export const KOKORO_SOURCE_CHECK_TIMEOUT_MS = 8_000

/** Root for every downloaded Kokoro asset, sibling to the Whisper model store. */
export function localKokoroBaseDir(): string {
  return join(app.getPath('userData'), 'models', 'speech', 'kokoro')
}

export function localKokoroModelPath(modelId: LocalKokoroModelId): string {
  const model = localKokoroModelById(modelId)
  return join(localKokoroBaseDir(), model.id, model.fileName)
}

export function localKokoroModelMetadataPath(modelId: LocalKokoroModelId): string {
  return join(localKokoroBaseDir(), modelId, 'model.json')
}

export function localKokoroVoicePath(voiceId: LocalKokoroVoiceId): string {
  return join(localKokoroBaseDir(), 'voices', `${voiceId}.bin`)
}

export function localKokoroUserAgent(): string {
  let version = 'dev'
  try {
    version = app?.getVersion?.() || version
  } catch {
    version = 'dev'
  }
  return `Kun/${version} local-kokoro`
}

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export function readContentLength(headers: Headers): number | undefined {
  const raw = headers.get('content-length')
  if (!raw) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function describeKokoroDownloadError(error: unknown, timeoutMessage: string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof Error && error.name === 'AbortError') return timeoutMessage
  if (/aborted|terminated|network|fetch failed|socket|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(message)) {
    return `Kokoro download failed because the network connection was interrupted: ${message}`
  }
  return message
}

export type KokoroAssetDownload = {
  url: string
  targetPath: string
  sizeBytes: number
  maxBytes: number
  sha256: string
  /** Aborting this controller cancels the transfer. */
  controller: AbortController
  onProgress?: (downloadedBytes: number, totalBytes: number | undefined, bytesPerSecond: number) => void
  /** Optional JSON receipt written next to the asset once verified. */
  metadata?: { path: string; content: Record<string, unknown> }
}

/**
 * Stream one asset to disk, then verify its byte length and SHA-256 before it
 * replaces the destination. A partial or tampered file is never published.
 */
export async function downloadVerifiedAsset(request: KokoroAssetDownload): Promise<void> {
  const tempPath = `${request.targetPath}.download`
  let timeoutMessage = `Kokoro download stalled for ${Math.round(KOKORO_STALL_TIMEOUT_MS / 1000)} seconds`
  let connectTimer: NodeJS.Timeout | undefined
  let stallTimer: NodeJS.Timeout | undefined
  const clearTimers = (): void => {
    if (connectTimer) clearTimeout(connectTimer)
    if (stallTimer) clearTimeout(stallTimer)
  }
  const resetStallTimer = (): void => {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      timeoutMessage = `Kokoro download stalled for ${Math.round(KOKORO_STALL_TIMEOUT_MS / 1000)} seconds`
      request.controller.abort()
    }, KOKORO_STALL_TIMEOUT_MS)
  }
  try {
    await mkdir(dirname(request.targetPath), { recursive: true })
    connectTimer = setTimeout(() => {
      timeoutMessage = `Kokoro download did not connect within ${Math.round(KOKORO_CONNECT_TIMEOUT_MS / 1000)} seconds`
      request.controller.abort()
    }, KOKORO_CONNECT_TIMEOUT_MS)
    const response = await fetch(request.url, {
      headers: { 'User-Agent': localKokoroUserAgent() },
      signal: request.controller.signal
    })
    if (connectTimer) clearTimeout(connectTimer)
    resetStallTimer()
    if (!response.ok || !response.body) {
      throw new Error(`failed to download Kokoro asset: HTTP ${response.status}`)
    }
    const totalBytes = readContentLength(response.headers)
    if (totalBytes && totalBytes > request.maxBytes) {
      throw new Error(`Kokoro asset is larger than the ${Math.round(request.maxBytes / 1024 / 1024)} MB limit`)
    }
    let downloadedBytes = 0
    const startedAt = Date.now()
    const bodyStream = Readable.fromWeb(response.body as never)
    bodyStream.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length
      resetStallTimer()
      const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000)
      request.onProgress?.(downloadedBytes, totalBytes, downloadedBytes / elapsedSeconds)
      if (downloadedBytes > request.maxBytes) {
        bodyStream.destroy(new Error('Kokoro asset exceeded the local size limit'))
      }
    })
    request.onProgress?.(0, totalBytes, 0)
    await pipeline(bodyStream, createWriteStream(tempPath))
    clearTimers()
    const info = await stat(tempPath)
    if (info.size <= 0 || info.size > request.maxBytes) {
      throw new Error('downloaded Kokoro asset size is invalid')
    }
    if (info.size !== request.sizeBytes) {
      throw new Error(
        `downloaded Kokoro asset size mismatch: expected ${request.sizeBytes} bytes, got ${info.size} bytes`
      )
    }
    const actualSha256 = await fileSha256(tempPath)
    if (actualSha256 !== request.sha256) {
      throw new Error(
        `downloaded Kokoro asset checksum mismatch: expected ${request.sha256}, got ${actualSha256}`
      )
    }
    request.controller.signal.throwIfAborted()
    await rename(tempPath, request.targetPath)
    if (request.metadata) {
      await writeFile(request.metadata.path, JSON.stringify(request.metadata.content, null, 2), 'utf8')
    }
  } catch (error) {
    clearTimers()
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export function kokoroTimeoutMessage(kind: 'connect' | 'stall' | 'source'): string {
  if (kind === 'connect') {
    return `Kokoro download did not connect within ${Math.round(KOKORO_CONNECT_TIMEOUT_MS / 1000)} seconds`
  }
  if (kind === 'source') {
    return `source check timed out after ${Math.round(KOKORO_SOURCE_CHECK_TIMEOUT_MS / 1000)} seconds`
  }
  return `Kokoro download stalled for ${Math.round(KOKORO_STALL_TIMEOUT_MS / 1000)} seconds`
}

/** Verified on-disk size for an asset, or null when it is absent. */
export async function readAssetSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}
