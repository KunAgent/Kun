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
import {
  LOCAL_KOKORO_TRACK_EXTENSION,
  decodeWavPcm,
  encodeWav,
  isLocalKokoroTrackKey,
  localKokoroTrackDurationSeconds,
  localKokoroTrackFileName,
  type LocalKokoroTrackExportResult,
  type LocalKokoroTrackInfo,
  type LocalKokoroTrackUsage
} from '../../shared/local-kokoro-tracks'

/** Captured chunks per in-flight request, dropped when the answer ends. */
type Capture = { parts: Uint8Array[]; bytes: number; disabled: boolean; timer: NodeJS.Timeout }
const captures = new Map<string, Capture>()
let captureEpoch = 0
let diskQueue: Promise<unknown> = Promise.resolve()

function diskOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = diskQueue.then(operation)
  diskQueue = next.catch(() => undefined)
  return next
}

export function localKokoroCaptureUsage(): { count: number; bytes: number } {
  return { count: captures.size, bytes: [...captures.values()].reduce((total, item) => total + item.bytes, 0) }
}

export function discardAllLocalKokoroCaptures(): void {
  captureEpoch += 1
  for (const id of captures.keys()) discardLocalKokoroTrackCapture(id)
}

/**
 * Ceiling for a single recording. A very long answer is still spoken, it just
 * is not kept, so a runaway transcript cannot fill the disk.
 */
export const LOCAL_KOKORO_TRACK_MAX_BYTES = 200 * 1024 * 1024
export const LOCAL_KOKORO_TRACK_STORE_MAX_BYTES = 1024 * 1024 * 1024

export function localKokoroTrackDirectory(): string {
  return join(app.getPath('userData'), 'models', 'speech', 'kokoro', 'tracks')
}

function trackPath(key: string): string {
  return join(localKokoroTrackDirectory(), `${key}.${LOCAL_KOKORO_TRACK_EXTENSION}`)
}

/** Start collecting audio for a request. Calling it again resets the capture. */
export function beginLocalKokoroTrackCapture(requestId: string): void {
  if (!requestId) return
  discardLocalKokoroTrackCapture(requestId)
  const timer = setTimeout(() => discardLocalKokoroTrackCapture(requestId), 5 * 60_000)
  timer.unref?.()
  captures.set(requestId, { parts: [], bytes: 0, disabled: false, timer })
}

/** Bound capture memory before retaining or copying the next chunk. */
export function appendLocalKokoroTrackChunk(requestId: string, pcm: Uint8Array): void {
  const capture = captures.get(requestId)
  if (!capture || capture.disabled) return
  capture.timer.refresh()
  if (pcm.byteLength > LOCAL_KOKORO_TRACK_MAX_BYTES - localKokoroCaptureUsage().bytes) {
    capture.parts = []
    capture.bytes = 0
    capture.disabled = true
    return
  }
  capture.parts.push(pcm)
  capture.bytes += pcm.byteLength
}

export function discardLocalKokoroTrackCapture(requestId: string): void {
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

/**
 * Write the captured audio as one recording. Returns null when nothing was
 * captured or the recording would exceed the size ceiling.
 */
export async function finalizeLocalKokoroTrack(
  requestId: string,
  key: string
): Promise<LocalKokoroTrackInfo | null> {
  const capture = captures.get(requestId)
  discardLocalKokoroTrackCapture(requestId)
  if (!capture || capture.disabled || !capture.bytes || !isLocalKokoroTrackKey(key)) return null
  const epoch = captureEpoch
  return diskOperation(async () => {
    if (epoch !== captureEpoch) return null
    const usage = await localKokoroTrackUsage()
    const previous = await getLocalKokoroTrack(key)
    if (usage.totalBytes - (previous?.sizeBytes ?? 0) + capture.bytes + 44 > LOCAL_KOKORO_TRACK_STORE_MAX_BYTES) return null
    const pcm = concatChunks(capture.parts)
    const directory = localKokoroTrackDirectory()
    await mkdir(directory, { recursive: true })
    const wav = encodeWav(pcm)
    const target = trackPath(key)
    const partial = `${target}.writing`
    try {
      await writeFile(partial, wav)
      if (epoch !== captureEpoch) return null
      await rename(partial, target)
      if (epoch !== captureEpoch) return null
      return { key, sizeBytes: wav.byteLength,
        durationSeconds: localKokoroTrackDurationSeconds(wav.byteLength), createdAt: new Date().toISOString() }
    } finally {
      await rm(partial, { force: true }).catch(() => undefined)
    }
  })
}

export async function getLocalKokoroTrack(key: unknown): Promise<LocalKokoroTrackInfo | null> {
  if (!isLocalKokoroTrackKey(key)) return null
  try {
    const info = await stat(trackPath(key))
    if (!info.isFile()) return null
    return {
      key,
      sizeBytes: info.size,
      durationSeconds: localKokoroTrackDurationSeconds(info.size),
      createdAt: info.mtime.toISOString()
    }
  } catch {
    return null
  }
}

/** Every stored recording key, so the renderer can show what is available. */
export async function listLocalKokoroTrackKeys(): Promise<string[]> {
  try {
    const entries = await readdir(localKokoroTrackDirectory())
    const suffix = `.${LOCAL_KOKORO_TRACK_EXTENSION}`
    return entries
      .filter((entry) => entry.endsWith(suffix))
      .map((entry) => entry.slice(0, -suffix.length))
      .filter((key) => isLocalKokoroTrackKey(key))
  } catch {
    return []
  }
}

export async function localKokoroTrackUsage(): Promise<LocalKokoroTrackUsage> {
  const keys = await listLocalKokoroTrackKeys()
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

/** Stored audio as base64 16-bit PCM, ready for the renderer's audio buffer. */
export async function readLocalKokoroTrackPcm(key: unknown): Promise<string | null> {
  if (!isLocalKokoroTrackKey(key)) return null
  try {
    const wav = await readFile(trackPath(key))
    const pcm = decodeWavPcm(wav)
    if (pcm.byteLength === 0) return null
    return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')
  } catch {
    return null
  }
}

export async function clearLocalKokoroTracks(): Promise<LocalKokoroTrackUsage> {
  discardAllLocalKokoroCaptures()
  return diskOperation(async () => {
    await rm(localKokoroTrackDirectory(), { recursive: true, force: true })
    return { count: 0, totalBytes: 0 }
  })
}

/** Save a recording to a location the user picks. */
export async function exportLocalKokoroTrack(
  payload: { key: unknown; fileName?: string },
  options?: { parentWindow?: BrowserWindow | null }
): Promise<LocalKokoroTrackExportResult> {
  try {
    if (!isLocalKokoroTrackKey(payload.key)) {
      return { ok: false, message: 'Recording is unavailable' }
    }
    const source = trackPath(payload.key)
    const wav = await readFile(source).catch(() => null)
    if (!wav) return { ok: false, message: 'Recording is unavailable' }

    const dialogOptions: Electron.SaveDialogOptions = {
      title: 'Save speech',
      defaultPath: join(homedir(), sanitizeFileName(payload.fileName) || localKokoroTrackFileName()),
      filters: [{ name: 'WAV audio', extensions: [LOCAL_KOKORO_TRACK_EXTENSION] }]
    }
    const chosen = options?.parentWindow
      ? await dialog.showSaveDialog(options.parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)
    if (chosen.canceled || !chosen.filePath) return { ok: false, canceled: true }

    const target = chosen.filePath.toLowerCase().endsWith(`.${LOCAL_KOKORO_TRACK_EXTENSION}`)
      ? chosen.filePath
      : `${chosen.filePath}.${LOCAL_KOKORO_TRACK_EXTENSION}`
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
