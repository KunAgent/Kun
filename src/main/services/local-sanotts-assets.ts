import { app } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import type { LocalSanottsVoiceId } from '../../shared/local-sanotts-voices'

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
  let timeoutMessage = `sanoTTS download stalled for ${Math.round(SANOTTS_STALL_TIMEOUT_MS / 1000)} seconds`
  let connectTimer: NodeJS.Timeout | undefined
  let stallTimer: NodeJS.Timeout | undefined
  const clearTimers = (): void => {
    if (connectTimer) clearTimeout(connectTimer)
    if (stallTimer) clearTimeout(stallTimer)
  }
  const resetStallTimer = (): void => {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      timeoutMessage = `sanoTTS download stalled for ${Math.round(SANOTTS_STALL_TIMEOUT_MS / 1000)} seconds`
      request.controller.abort()
    }, SANOTTS_STALL_TIMEOUT_MS)
  }
  try {
    await mkdir(dirname(request.targetPath), { recursive: true })
    connectTimer = setTimeout(() => {
      timeoutMessage = `sanoTTS download did not connect within ${Math.round(SANOTTS_CONNECT_TIMEOUT_MS / 1000)} seconds`
      request.controller.abort()
    }, SANOTTS_CONNECT_TIMEOUT_MS)
    const response = await fetch(request.url, {
      headers: { 'User-Agent': localSanottsUserAgent() },
      signal: request.controller.signal
    })
    if (connectTimer) clearTimeout(connectTimer)
    resetStallTimer()
    if (!response.ok || !response.body) {
      throw new Error(`failed to download sanoTTS asset: HTTP ${response.status}`)
    }
    const totalBytes = readContentLength(response.headers)
    if (totalBytes && totalBytes > request.maxBytes) {
      throw new Error(`sanoTTS asset is larger than the ${Math.round(request.maxBytes / 1024 / 1024)} MB limit`)
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
        bodyStream.destroy(new Error('sanoTTS asset exceeded the local size limit'))
      }
    })
    request.onProgress?.(0, totalBytes, 0)
    await pipeline(bodyStream, createWriteStream(tempPath))
    clearTimers()
    const info = await stat(tempPath)
    if (info.size <= 0 || info.size > request.maxBytes) {
      throw new Error('downloaded sanoTTS asset size is invalid')
    }
    if (info.size !== request.sizeBytes) {
      throw new Error(
        `downloaded sanoTTS asset size mismatch: expected ${request.sizeBytes} bytes, got ${info.size} bytes`
      )
    }
    const actualSha256 = await fileSha256(tempPath)
    if (actualSha256 !== request.sha256) {
      throw new Error(
        `downloaded sanoTTS asset checksum mismatch: expected ${request.sha256}, got ${actualSha256}`
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

export function sanottsTimeoutMessage(kind: 'connect' | 'stall' | 'source'): string {
  if (kind === 'connect') {
    return `sanoTTS download did not connect within ${Math.round(SANOTTS_CONNECT_TIMEOUT_MS / 1000)} seconds`
  }
  if (kind === 'source') {
    return `source check timed out after ${Math.round(SANOTTS_SOURCE_CHECK_TIMEOUT_MS / 1000)} seconds`
  }
  return `sanoTTS download stalled for ${Math.round(SANOTTS_STALL_TIMEOUT_MS / 1000)} seconds`
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
