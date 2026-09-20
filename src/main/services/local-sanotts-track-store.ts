/**
 * On-disk store for Speak recordings.
 *
 * Chunks are captured while an answer is spoken and written as one WAV when the
 * answer finishes, so a second Speak on the same answer replays the file rather
 * than paying for synthesis again, and the user can save it to their device.
 */
import { BrowserWindow, app, dialog } from 'electron'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { LOCAL_SANOTTS_SAMPLE_RATE } from '../../shared/local-sanotts'
import {
  LOCAL_SANOTTS_TRACK_EXTENSION,
  decodeWavPcm,
  encodeWav,
  isLocalSanottsTrackKey,
  localSanottsTrackDurationSeconds,
  localSanottsTrackFileName,
  readWavSampleRate,
  type LocalSanottsTrackExportResult,
  type LocalSanottsTrackInfo,
  type LocalSanottsTrackUsage
} from '../../shared/local-sanotts-tracks'

type Capture = {
  parts: Uint8Array[]
  bytes: number
  disabled: boolean
  timer: NodeJS.Timeout
  sampleRate: number
}
const captures = new Map<string, Capture>()
let captureEpoch = 0
let diskQueue: Promise<unknown> = Promise.resolve()

function diskOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = diskQueue.then(operation)
  diskQueue = next.catch(() => undefined)
  return next
}

export function localSanottsCaptureUsage(): { count: number; bytes: number } {
  return { count: captures.size, bytes: [...captures.values()].reduce((total, item) => total + item.bytes, 0) }
}

export function discardAllLocalSanottsCaptures(): void {
  captureEpoch += 1
  for (const id of captures.keys()) discardLocalSanottsTrackCapture(id)
}

export const LOCAL_SANOTTS_TRACK_MAX_BYTES = 200 * 1024 * 1024
export const LOCAL_SANOTTS_TRACK_STORE_MAX_BYTES = 1024 * 1024 * 1024

export function localSanottsTrackDirectory(): string {
  return join(app.getPath('userData'), 'models', 'speech', 'sanotts', 'tracks')
}

function trackPath(key: string): string {
  return join(localSanottsTrackDirectory(), `${key}.${LOCAL_SANOTTS_TRACK_EXTENSION}`)
}

export function beginLocalSanottsTrackCapture(requestId: string): void {
  if (!requestId) return
  discardLocalSanottsTrackCapture(requestId)
  const timer = setTimeout(() => discardLocalSanottsTrackCapture(requestId), 5 * 60_000)
  timer.unref?.()
  captures.set(requestId, {
    parts: [],
    bytes: 0,
    disabled: false,
    timer,
    sampleRate: LOCAL_SANOTTS_SAMPLE_RATE
  })
}

export function appendLocalSanottsTrackChunk(
  requestId: string,
  pcm: Uint8Array,
  sampleRate = LOCAL_SANOTTS_SAMPLE_RATE
): void {
  const capture = captures.get(requestId)
  if (!capture || capture.disabled) return
  capture.timer.refresh()
  if (pcm.byteLength > LOCAL_SANOTTS_TRACK_MAX_BYTES - localSanottsCaptureUsage().bytes) {
    capture.parts = []
    capture.bytes = 0
    capture.disabled = true
    return
  }
  if (capture.parts.length === 0 && sampleRate > 0) capture.sampleRate = sampleRate
  capture.parts.push(pcm)
  capture.bytes += pcm.byteLength
}

export function discardLocalSanottsTrackCapture(requestId: string): void {
  const capture = captures.get(requestId)
  if (capture) clearTimeout(capture.timer)
  captures.delete(requestId)
}

function concatChunks(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.byteLength
  }
  return merged
}

export async function finalizeLocalSanottsTrack(
  requestId: string,
  key: string
): Promise<LocalSanottsTrackInfo | null> {
  const capture = captures.get(requestId)
  discardLocalSanottsTrackCapture(requestId)
  if (!capture || capture.disabled || !capture.bytes || !isLocalSanottsTrackKey(key)) return null
  const epoch = captureEpoch
  return diskOperation(async () => {
    if (epoch !== captureEpoch) return null
    const usage = await localSanottsTrackUsage()
    const previous = await getLocalSanottsTrack(key)
    if (usage.totalBytes - (previous?.sizeBytes ?? 0) + capture.bytes + 44 > LOCAL_SANOTTS_TRACK_STORE_MAX_BYTES) {
      return null
    }
    const pcm = concatChunks(capture.parts)
    const directory = localSanottsTrackDirectory()
    await mkdir(directory, { recursive: true })
    const wav = encodeWav(pcm, capture.sampleRate)
    const target = trackPath(key)
    const partial = `${target}.writing`
    try {
      await writeFile(partial, wav)
      if (epoch !== captureEpoch) return null
      await rename(partial, target)
      if (epoch !== captureEpoch) return null
      return {
        key,
        sizeBytes: wav.byteLength,
        durationSeconds: localSanottsTrackDurationSeconds(wav.byteLength, capture.sampleRate),
        createdAt: new Date().toISOString()
      }
    } finally {
      await rm(partial, { force: true }).catch(() => undefined)
    }
  })
}

export async function getLocalSanottsTrack(key: unknown): Promise<LocalSanottsTrackInfo | null> {
  if (!isLocalSanottsTrackKey(key)) return null
  try {
    const path = trackPath(key)
    const info = await stat(path)
    if (!info.isFile()) return null
    const header = await readFile(path)
    return {
      key,
      sizeBytes: info.size,
      durationSeconds: localSanottsTrackDurationSeconds(info.size, readWavSampleRate(header)),
      createdAt: info.mtime.toISOString()
    }
  } catch {
    return null
  }
}

export async function listLocalSanottsTrackKeys(): Promise<string[]> {
  try {
    const entries = await readdir(localSanottsTrackDirectory())
    const suffix = `.${LOCAL_SANOTTS_TRACK_EXTENSION}`
    return entries
      .filter((entry) => entry.endsWith(suffix))
      .map((entry) => entry.slice(0, -suffix.length))
      .filter((key) => isLocalSanottsTrackKey(key))
  } catch {
    return []
  }
}

export async function localSanottsTrackUsage(): Promise<LocalSanottsTrackUsage> {
  const keys = await listLocalSanottsTrackKeys()
  let totalBytes = 0
  for (const key of keys) {
    try {
      totalBytes += (await stat(trackPath(key))).size
    } catch {
      // A track removed between listing and sizing simply does not count.
    }
  }
  return { count: keys.length, totalBytes }
}

export async function readLocalSanottsTrackPcm(key: unknown): Promise<string | null> {
  if (!isLocalSanottsTrackKey(key)) return null
  try {
    const wav = await readFile(trackPath(key))
    const pcm = decodeWavPcm(wav)
    if (pcm.byteLength === 0) return null
    return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')
  } catch {
    return null
  }
}

export async function clearLocalSanottsTracks(): Promise<LocalSanottsTrackUsage> {
  discardAllLocalSanottsCaptures()
  return diskOperation(async () => {
    await rm(localSanottsTrackDirectory(), { recursive: true, force: true })
    return { count: 0, totalBytes: 0 }
  })
}

export async function exportLocalSanottsTrack(
  payload: { key: unknown; fileName?: string },
  options?: { parentWindow?: BrowserWindow | null }
): Promise<LocalSanottsTrackExportResult> {
  try {
    if (!isLocalSanottsTrackKey(payload.key)) {
      return { ok: false, message: 'Recording is unavailable' }
    }
    const source = trackPath(payload.key)
    const wav = await readFile(source).catch(() => null)
    if (!wav) return { ok: false, message: 'Recording is unavailable' }

    const dialogOptions: Electron.SaveDialogOptions = {
      title: 'Save speech',
      defaultPath: join(homedir(), sanitizeFileName(payload.fileName) || localSanottsTrackFileName()),
      filters: [{ name: 'WAV audio', extensions: [LOCAL_SANOTTS_TRACK_EXTENSION] }]
    }
    const chosen = options?.parentWindow
      ? await dialog.showSaveDialog(options.parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    if (chosen.canceled || !chosen.filePath) return { ok: false, canceled: true }

    const target = chosen.filePath.toLowerCase().endsWith(`.${LOCAL_SANOTTS_TRACK_EXTENSION}`)
      ? chosen.filePath
      : `${chosen.filePath}.${LOCAL_SANOTTS_TRACK_EXTENSION}`
    await writeFile(target, wav)
    return { ok: true, path: target }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function sanitizeFileName(value: string | undefined): string {
  return Array.from(value ?? '', (char) => (char.charCodeAt(0) <= 0x1f ? '-' : char))
    .join('')
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 180)
}
