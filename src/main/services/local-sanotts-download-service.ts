import { rm } from 'node:fs/promises'
import { SanottsDownloadTasks } from './local-sanotts-download-tasks'
import {
  LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID,
  LOCAL_SANOTTS_DOWNLOAD_SOURCES,
  LOCAL_SANOTTS_LICENSE,
  LOCAL_SANOTTS_MODEL_REPO,
  LOCAL_SANOTTS_RUNTIME_FILES,
  LOCAL_SANOTTS_RUNTIME_ID,
  LOCAL_SANOTTS_RUNTIME_LABEL,
  LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
  localSanottsDownloadSourceById,
  localSanottsRuntimeFileUrl,
  localSanottsVoiceFileUrl,
  type LocalSanottsAssetProgress,
  type LocalSanottsDownloadSource,
  type LocalSanottsDownloadSourceStatus,
  type LocalSanottsDownloadSourceStatusResult,
  type LocalSanottsReadinessResult,
  type LocalSanottsRuntimeDeleteResult,
  type LocalSanottsRuntimeDownloadResult,
  type LocalSanottsRuntimeStatus,
  type LocalSanottsVoiceStatus
} from '../../shared/local-sanotts'
import {
  LOCAL_SANOTTS_DEFAULT_VOICE_ID,
  LOCAL_SANOTTS_VOICES,
  localSanottsVoiceById,
  type LocalSanottsVoice,
  type LocalSanottsVoiceId
} from '../../shared/local-sanotts-voices'
import {
  SANOTTS_SOURCE_CHECK_TIMEOUT_MS,
  describeSanottsDownloadError,
  downloadVerifiedAsset,
  localSanottsRuntimeDir,
  localSanottsRuntimeFilePath,
  localSanottsRuntimeMetadataPath,
  localSanottsUserAgent,
  localSanottsVoiceDir,
  localSanottsVoiceFilePath,
  readAssetSize,
  removeLegacyKokoroSpeechCache,
  sanottsTimeoutMessage
} from './local-sanotts-assets'

let progressEmitter: ((progress: LocalSanottsAssetProgress) => void) | null = null
const progressByKey = new Map<string, LocalSanottsAssetProgress>()
const transfers = new SanottsDownloadTasks()
let legacyCleanup: Promise<void> | null = null

function ensureLegacyCleanup(): void {
  legacyCleanup ??= removeLegacyKokoroSpeechCache()
}

export function releaseLocalSanottsDownloads(ownerId?: string): void {
  if (ownerId) transfers.release(ownerId)
  else transfers.releasePlayback()
}

export function setLocalSanottsProgressEmitter(
  emitter: ((progress: LocalSanottsAssetProgress) => void) | null
): void {
  progressEmitter = emitter
}

export function shutdownLocalSanottsDownloads(): void {
  transfers.shutdown()
}

export async function getLocalSanottsRuntimeStatus(): Promise<LocalSanottsRuntimeStatus> {
  ensureLegacyCleanup()
  const path = localSanottsRuntimeDir()
  const size = await totalPresentBytes(
    LOCAL_SANOTTS_RUNTIME_FILES.map((file) => localSanottsRuntimeFilePath(file.fileName))
  )
  if (size !== null) {
    return runtimeStatus('ready', { path, downloadedBytes: size, totalBytes: size })
  }
  const lastProgress = progressByKey.get(LOCAL_SANOTTS_RUNTIME_ID)
  if (transfers.has(LOCAL_SANOTTS_RUNTIME_ID)) {
    return runtimeStatus('downloading', {
      downloadedBytes: lastProgress?.downloadedBytes,
      totalBytes: lastProgress?.totalBytes,
      speedBytesPerSecond: lastProgress?.speedBytesPerSecond
    })
  }
  return runtimeStatus('not_downloaded')
}

export async function getLocalSanottsVoiceStatus(
  voiceId: unknown = LOCAL_SANOTTS_DEFAULT_VOICE_ID
): Promise<LocalSanottsVoiceStatus> {
  ensureLegacyCleanup()
  const voice = localSanottsVoiceById(voiceId)
  const path = localSanottsVoiceDir(voice.id)
  const size = await totalPresentBytes(
    voice.files.map((file) => localSanottsVoiceFilePath(voice.id, file.fileName))
  )
  if (size !== null) {
    return { voiceId: voice.id, sizeBytes: voice.sizeBytes, state: 'ready', path, downloadedBytes: size }
  }
  if (transfers.has(voice.id)) {
    return { voiceId: voice.id, sizeBytes: voice.sizeBytes, state: 'downloading' }
  }
  return { voiceId: voice.id, sizeBytes: voice.sizeBytes, state: 'not_downloaded' }
}

export async function listDownloadedLocalSanottsVoices(): Promise<LocalSanottsVoiceId[]> {
  const statuses = await Promise.all(
    LOCAL_SANOTTS_VOICES.map((voice) => getLocalSanottsVoiceStatus(voice.id))
  )
  return statuses.filter((status) => status.state === 'ready').map((status) => status.voiceId)
}

export async function downloadLocalSanottsRuntime(
  sourceId?: unknown,
  ownerId?: string
): Promise<LocalSanottsRuntimeDownloadResult> {
  try {
    return await transfers.run(LOCAL_SANOTTS_RUNTIME_ID, ownerId, async (controller) => {
      const current = await getLocalSanottsRuntimeStatus()
      if (current.state === 'ready') return { ok: true, status: current }
      controller.signal.throwIfAborted()
      return runRuntimeDownload(localSanottsDownloadSourceById(sourceId), controller)
    })
  } catch (error) {
    return { ok: false, message: String(error), status: runtimeStatus('not_downloaded') }
  }
}

export async function cancelLocalSanottsRuntime(): Promise<LocalSanottsRuntimeDownloadResult> {
  await transfers.cancel(LOCAL_SANOTTS_RUNTIME_ID)
  return { ok: true, status: await getLocalSanottsRuntimeStatus() }
}

export async function deleteLocalSanottsRuntime(): Promise<LocalSanottsRuntimeDeleteResult> {
  try {
    await transfers.cancel(LOCAL_SANOTTS_RUNTIME_ID)
    await rm(localSanottsRuntimeDir(), { recursive: true, force: true })
    const status = await getLocalSanottsRuntimeStatus()
    emitProgress({
      asset: 'runtime',
      runtimeId: LOCAL_SANOTTS_RUNTIME_ID,
      downloadedBytes: LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
      totalBytes: LOCAL_SANOTTS_RUNTIME_SIZE_BYTES
    })
    return { ok: true, status }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      status: await getLocalSanottsRuntimeStatus()
    }
  }
}

export async function downloadLocalSanottsVoice(
  voiceId: unknown = LOCAL_SANOTTS_DEFAULT_VOICE_ID,
  sourceId?: unknown,
  ownerId?: string
): Promise<LocalSanottsVoiceStatus> {
  const voice = localSanottsVoiceById(voiceId)
  const source = localSanottsDownloadSourceById(sourceId)
  return transfers.run<LocalSanottsVoiceStatus>(voice.id, ownerId, async (controller) => {
    const current = await getLocalSanottsVoiceStatus(voice.id)
    if (current.state === 'ready') return current
    controller.signal.throwIfAborted()
    try {
      await downloadFileGroup(
        voice.files,
        (fileName) => localSanottsVoiceFileUrl(voice.id, fileName, source.id),
        (fileName) => localSanottsVoiceFilePath(voice.id, fileName),
        controller,
        (downloadedBytes, totalBytes, bytesPerSecond) =>
          emitProgress({
            asset: 'voice',
            voiceId: voice.id,
            downloadedBytes,
            totalBytes,
            speedBytesPerSecond: bytesPerSecond
          })
      )
      const status = await getLocalSanottsVoiceStatus(voice.id)
      emitProgress({
        asset: 'voice',
        voiceId: voice.id,
        downloadedBytes: voice.sizeBytes,
        totalBytes: voice.sizeBytes
      })
      return status
    } catch (error) {
      const message = `${source.label}: ${describeSanottsDownloadError(error, sanottsTimeoutMessage('stall'))}`
      return { voiceId: voice.id, sizeBytes: voice.sizeBytes, state: 'error', message }
    }
  }).catch((error) => ({
    voiceId: voice.id,
    sizeBytes: voice.sizeBytes,
    state: 'error' as const,
    message: String(error)
  }))
}

export async function getLocalSanottsReadiness(
  voiceId: unknown = LOCAL_SANOTTS_DEFAULT_VOICE_ID
): Promise<LocalSanottsReadinessResult> {
  const [runtime, voice] = await Promise.all([
    getLocalSanottsRuntimeStatus(),
    getLocalSanottsVoiceStatus(voiceId)
  ])
  return {
    voiceId: voice.voiceId,
    runtime,
    voice,
    ready: runtime.state === 'ready' && voice.state === 'ready'
  }
}

export async function checkLocalSanottsDownloadSources(): Promise<LocalSanottsDownloadSourceStatusResult> {
  const sources = await Promise.all(
    LOCAL_SANOTTS_DOWNLOAD_SOURCES.map((source) => checkDownloadSource(source))
  )
  return { sources }
}

async function runRuntimeDownload(
  source: LocalSanottsDownloadSource,
  controller: AbortController
): Promise<LocalSanottsRuntimeDownloadResult> {
  try {
    await downloadFileGroup(
      LOCAL_SANOTTS_RUNTIME_FILES,
      (fileName) => localSanottsRuntimeFileUrl(fileName, source.id),
      localSanottsRuntimeFilePath,
      controller,
      (downloadedBytes, totalBytes, bytesPerSecond) =>
        emitProgress({
          asset: 'runtime',
          runtimeId: LOCAL_SANOTTS_RUNTIME_ID,
          downloadedBytes,
          totalBytes,
          speedBytesPerSecond: bytesPerSecond
        }),
      {
        path: localSanottsRuntimeMetadataPath(),
        content: {
          runtimeId: LOCAL_SANOTTS_RUNTIME_ID,
          source: LOCAL_SANOTTS_MODEL_REPO,
          license: LOCAL_SANOTTS_LICENSE,
          downloadSource: source.id,
          downloadSourceLabel: source.label,
          size: LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
          downloadedAt: new Date().toISOString()
        }
      }
    )
    const status = await getLocalSanottsRuntimeStatus()
    emitProgress({
      asset: 'runtime',
      runtimeId: LOCAL_SANOTTS_RUNTIME_ID,
      downloadedBytes: LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
      totalBytes: LOCAL_SANOTTS_RUNTIME_SIZE_BYTES
    })
    return { ok: true, status }
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: true, status: runtimeStatus('not_downloaded') }
    }
    const message = `${source.label}: ${describeSanottsDownloadError(error, sanottsTimeoutMessage('stall'))}`
    return { ok: false, message, status: runtimeStatus('error', { message }) }
  } finally {
    progressByKey.delete(LOCAL_SANOTTS_RUNTIME_ID)
  }
}

async function downloadFileGroup(
  files: readonly { fileName: string; sizeBytes: number; maxBytes: number; sha256: string }[],
  urlFor: (fileName: string) => string,
  pathFor: (fileName: string) => string,
  controller: AbortController,
  onProgress: (downloadedBytes: number, totalBytes: number, bytesPerSecond: number) => void,
  metadata?: { path: string; content: Record<string, unknown> }
): Promise<void> {
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0)
  let completedBytes = 0
  for (const [index, file] of files.entries()) {
    controller.signal.throwIfAborted()
    await downloadVerifiedAsset({
      url: urlFor(file.fileName),
      targetPath: pathFor(file.fileName),
      sizeBytes: file.sizeBytes,
      maxBytes: file.maxBytes,
      sha256: file.sha256,
      controller,
      onProgress: (downloadedBytes, _fileTotal, bytesPerSecond) =>
        onProgress(completedBytes + downloadedBytes, totalBytes, bytesPerSecond),
      metadata: index === files.length - 1 ? metadata : undefined
    })
    completedBytes += file.sizeBytes
  }
}

async function checkDownloadSource(
  source: LocalSanottsDownloadSource
): Promise<LocalSanottsDownloadSourceStatus> {
  const url = localSanottsRuntimeFileUrl('snt_g2p.wasm', source.id)
  const controller = new AbortController()
  const startedAt = Date.now()
  const timer = setTimeout(() => controller.abort(), SANOTTS_SOURCE_CHECK_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-0', 'User-Agent': localSanottsUserAgent() },
      signal: controller.signal
    })
    await response.body?.cancel().catch(() => undefined)
    const available = response.status === 200 || response.status === 206
    return {
      sourceId: source.id,
      label: source.label,
      url,
      state: available ? 'available' : 'unavailable',
      httpStatus: response.status,
      responseTimeMs: Date.now() - startedAt,
      ...(!available ? { message: `HTTP ${response.status}` } : {})
    }
  } catch (error) {
    return {
      sourceId: source.id,
      label: source.label,
      url,
      state: 'unavailable',
      responseTimeMs: Date.now() - startedAt,
      message: describeSanottsDownloadError(error, sanottsTimeoutMessage('source'))
    }
  } finally {
    clearTimeout(timer)
  }
}

async function totalPresentBytes(paths: string[]): Promise<number | null> {
  let total = 0
  for (const path of paths) {
    const size = await readAssetSize(path)
    if (size === null) return null
    total += size
  }
  return total
}

function runtimeStatus(
  state: LocalSanottsRuntimeStatus['state'],
  extra: Partial<LocalSanottsRuntimeStatus> = {}
): LocalSanottsRuntimeStatus {
  return {
    runtimeId: LOCAL_SANOTTS_RUNTIME_ID,
    label: LOCAL_SANOTTS_RUNTIME_LABEL,
    source: LOCAL_SANOTTS_MODEL_REPO,
    license: LOCAL_SANOTTS_LICENSE,
    sizeBytes: LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
    state,
    ...extra
  }
}

function emitProgress(progress: LocalSanottsAssetProgress): void {
  const percent = progress.totalBytes && progress.totalBytes > 0
    ? Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100)
    : undefined
  const update = { ...progress, percent }
  const key = progress.asset === 'voice' ? progress.voiceId : LOCAL_SANOTTS_RUNTIME_ID
  if (key) progressByKey.set(key, update)
  progressEmitter?.(update)
}

export type { LocalSanottsVoice }
export { LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID }
