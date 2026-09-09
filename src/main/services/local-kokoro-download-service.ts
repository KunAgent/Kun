import { rm } from 'node:fs/promises'
import {
  LOCAL_KOKORO_DEFAULT_MODEL_ID,
  LOCAL_KOKORO_DOWNLOAD_SOURCES,
  LOCAL_KOKORO_MODELS,
  localKokoroDownloadSourceById,
  localKokoroModelById,
  localKokoroModelUrl,
  localKokoroVoiceUrl,
  recommendedLocalKokoroModelId,
  type LocalKokoroDownloadSource,
  type LocalKokoroDownloadSourceStatus,
  type LocalKokoroDownloadSourceStatusResult,
  type LocalKokoroModel,
  type LocalKokoroModelDeleteResult,
  type LocalKokoroModelDownloadResult,
  type LocalKokoroModelId,
  type LocalKokoroModelProgress,
  type LocalKokoroModelStatus,
  type LocalKokoroReadinessResult,
  type LocalKokoroVoiceStatus
} from '../../shared/local-kokoro'
import {
  LOCAL_KOKORO_DEFAULT_VOICE_ID,
  LOCAL_KOKORO_VOICES,
  localKokoroVoiceById,
  type LocalKokoroVoiceId
} from '../../shared/local-kokoro-voices'
import {
  KOKORO_SOURCE_CHECK_TIMEOUT_MS,
  describeKokoroDownloadError,
  downloadVerifiedAsset,
  kokoroTimeoutMessage,
  localKokoroModelMetadataPath,
  localKokoroModelPath,
  localKokoroUserAgent,
  localKokoroVoicePath,
  readAssetSize
} from './local-kokoro-assets'

/** Voice files are tiny; the cap only guards against a wrong URL. */
const VOICE_MAX_BYTES = 4 * 1024 * 1024

let progressEmitter: ((progress: LocalKokoroModelProgress) => void) | null = null
let lastProgress: LocalKokoroModelProgress | null = null
let modelDownloadPromise: Promise<LocalKokoroModelDownloadResult> | null = null
let activeModelDownload: {
  modelId: LocalKokoroModelId
  controller: AbortController
  canceled: boolean
} | null = null
const voiceDownloads = new Map<LocalKokoroVoiceId, Promise<LocalKokoroVoiceStatus>>()
let shuttingDown = false

export function setLocalKokoroProgressEmitter(
  emitter: ((progress: LocalKokoroModelProgress) => void) | null
): void {
  progressEmitter = emitter
}

export function shutdownLocalKokoroDownloads(): void {
  shuttingDown = true
  activeModelDownload?.controller.abort()
}

export async function getLocalKokoroModelStatus(
  modelId: unknown = LOCAL_KOKORO_DEFAULT_MODEL_ID
): Promise<LocalKokoroModelStatus> {
  const model = localKokoroModelById(modelId)
  const size = await readAssetSize(localKokoroModelPath(model.id))
  if (size !== null) {
    return modelStatus(model, 'ready', {
      path: localKokoroModelPath(model.id),
      downloadedBytes: size,
      totalBytes: size
    })
  }
  if (activeModelDownload?.modelId === model.id && activeModelDownload.canceled) {
    return modelStatus(model, 'not_downloaded')
  }
  if (modelDownloadPromise && lastProgress?.modelId === model.id && lastProgress.asset === 'model') {
    return modelStatus(model, 'downloading', {
      downloadedBytes: lastProgress.downloadedBytes,
      totalBytes: lastProgress.totalBytes,
      speedBytesPerSecond: lastProgress.speedBytesPerSecond
    })
  }
  return modelStatus(model, 'not_downloaded')
}

export async function listLocalKokoroModelStatuses(): Promise<LocalKokoroModelStatus[]> {
  return Promise.all(LOCAL_KOKORO_MODELS.map((model) => getLocalKokoroModelStatus(model.id)))
}

export async function getLocalKokoroVoiceStatus(
  voiceId: unknown = LOCAL_KOKORO_DEFAULT_VOICE_ID
): Promise<LocalKokoroVoiceStatus> {
  const voice = localKokoroVoiceById(voiceId)
  const path = localKokoroVoicePath(voice.id)
  const size = await readAssetSize(path)
  if (size !== null) {
    return { voiceId: voice.id, sizeBytes: voice.sizeBytes, state: 'ready', path, downloadedBytes: size }
  }
  if (voiceDownloads.has(voice.id)) {
    return { voiceId: voice.id, sizeBytes: voice.sizeBytes, state: 'downloading' }
  }
  return { voiceId: voice.id, sizeBytes: voice.sizeBytes, state: 'not_downloaded' }
}

/** Voice ids already present on disk, so the settings dropdown can mark them. */
export async function listDownloadedLocalKokoroVoices(): Promise<LocalKokoroVoiceId[]> {
  const statuses = await Promise.all(
    LOCAL_KOKORO_VOICES.map((voice) => getLocalKokoroVoiceStatus(voice.id))
  )
  return statuses.filter((status) => status.state === 'ready').map((status) => status.voiceId)
}

export async function downloadLocalKokoroModel(
  modelId: unknown = LOCAL_KOKORO_DEFAULT_MODEL_ID,
  sourceId?: unknown
): Promise<LocalKokoroModelDownloadResult> {
  const model = localKokoroModelById(modelId)
  if (shuttingDown) {
    return {
      ok: false,
      message: 'local Kokoro service is shutting down',
      status: modelStatus(model, 'not_downloaded')
    }
  }
  const current = await getLocalKokoroModelStatus(model.id)
  if (current.state === 'ready') return { ok: true, status: current }
  if (modelDownloadPromise) return modelDownloadPromise
  modelDownloadPromise = runModelDownload(model, localKokoroDownloadSourceById(sourceId)).finally(() => {
    modelDownloadPromise = null
    lastProgress = null
  })
  return modelDownloadPromise
}

export async function cancelLocalKokoroModel(
  modelId: unknown = LOCAL_KOKORO_DEFAULT_MODEL_ID
): Promise<LocalKokoroModelDownloadResult> {
  const model = localKokoroModelById(modelId)
  if (!activeModelDownload || activeModelDownload.modelId !== model.id) {
    return { ok: true, status: await getLocalKokoroModelStatus(model.id) }
  }
  const canceled = activeModelDownload
  canceled.canceled = true
  canceled.controller.abort()
  await modelDownloadPromise?.catch(() => undefined)
  return { ok: true, status: modelStatus(model, 'not_downloaded') }
}

export async function deleteLocalKokoroModel(
  modelId: unknown = LOCAL_KOKORO_DEFAULT_MODEL_ID
): Promise<LocalKokoroModelDeleteResult> {
  const model = localKokoroModelById(modelId)
  try {
    await rm(localKokoroModelPath(model.id), { force: true })
    await rm(localKokoroModelMetadataPath(model.id), { force: true })
    return { ok: true, status: await getLocalKokoroModelStatus(model.id) }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      status: await getLocalKokoroModelStatus(model.id)
    }
  }
}

/**
 * Download one voice's style vectors. Voices are shared across model tiers, so
 * they live in a single directory and are fetched at most once each.
 */
export async function downloadLocalKokoroVoice(
  voiceId: unknown = LOCAL_KOKORO_DEFAULT_VOICE_ID,
  sourceId?: unknown
): Promise<LocalKokoroVoiceStatus> {
  const voice = localKokoroVoiceById(voiceId)
  const current = await getLocalKokoroVoiceStatus(voice.id)
  if (current.state === 'ready') return current
  const pending = voiceDownloads.get(voice.id)
  if (pending) return pending
  const source = localKokoroDownloadSourceById(sourceId)
  const controller = new AbortController()
  const task = (async (): Promise<LocalKokoroVoiceStatus> => {
    const path = localKokoroVoicePath(voice.id)
    try {
      await downloadVerifiedAsset({
        url: localKokoroVoiceUrl(voice.id, source.id),
        targetPath: path,
        sizeBytes: voice.sizeBytes,
        maxBytes: VOICE_MAX_BYTES,
        sha256: voice.sha256,
        controller,
        onProgress: (downloadedBytes, totalBytes, bytesPerSecond) =>
          emitProgress({
            voiceId: voice.id,
            asset: 'voice',
            downloadedBytes,
            totalBytes,
            speedBytesPerSecond: bytesPerSecond
          })
      })
      return await getLocalKokoroVoiceStatus(voice.id)
    } catch (error) {
      const message = `${source.label}: ${describeKokoroDownloadError(error, kokoroTimeoutMessage('stall'))}`
      return { voiceId: voice.id, sizeBytes: voice.sizeBytes, state: 'error', message }
    }
  })().finally(() => {
    voiceDownloads.delete(voice.id)
  })
  voiceDownloads.set(voice.id, task)
  return task
}

/**
 * Whether the model tier and voice needed to speak are both on disk. The
 * renderer calls this before the first chunk so it can start a download and
 * show progress instead of failing.
 */
export async function getLocalKokoroReadiness(
  modelId: unknown = LOCAL_KOKORO_DEFAULT_MODEL_ID,
  voiceId: unknown = LOCAL_KOKORO_DEFAULT_VOICE_ID
): Promise<LocalKokoroReadinessResult> {
  const [model, voice] = await Promise.all([
    getLocalKokoroModelStatus(modelId),
    getLocalKokoroVoiceStatus(voiceId)
  ])
  return {
    modelId: model.modelId,
    voiceId: voice.voiceId,
    model,
    voice,
    ready: model.state === 'ready' && voice.state === 'ready'
  }
}

export async function checkLocalKokoroDownloadSources(
  modelId: unknown = LOCAL_KOKORO_DEFAULT_MODEL_ID
): Promise<LocalKokoroDownloadSourceStatusResult> {
  const model = localKokoroModelById(modelId)
  const sources = await Promise.all(
    LOCAL_KOKORO_DOWNLOAD_SOURCES.map((source) => checkDownloadSource(model, source))
  )
  return { modelId: model.id, sources }
}

async function runModelDownload(
  model: LocalKokoroModel,
  source: LocalKokoroDownloadSource
): Promise<LocalKokoroModelDownloadResult> {
  const controller = new AbortController()
  activeModelDownload = { modelId: model.id, controller, canceled: false }
  try {
    await downloadVerifiedAsset({
      url: localKokoroModelUrl(model.id, source.id),
      targetPath: localKokoroModelPath(model.id),
      sizeBytes: model.sizeBytes,
      maxBytes: model.maxBytes,
      sha256: model.sha256,
      controller,
      onProgress: (downloadedBytes, totalBytes, bytesPerSecond) =>
        emitProgress({
          modelId: model.id,
          asset: 'model',
          downloadedBytes,
          totalBytes,
          speedBytesPerSecond: bytesPerSecond
        }),
      metadata: {
        path: localKokoroModelMetadataPath(model.id),
        content: {
          modelId: model.id,
          fileName: model.fileName,
          source: model.source,
          license: model.license,
          downloadSource: source.id,
          downloadSourceLabel: source.label,
          downloadUrl: localKokoroModelUrl(model.id, source.id),
          sha256: model.sha256,
          size: model.sizeBytes,
          downloadedAt: new Date().toISOString()
        }
      }
    })
    return { ok: true, status: await getLocalKokoroModelStatus(model.id) }
  } catch (error) {
    if (activeModelDownload?.modelId === model.id && activeModelDownload.canceled) {
      return { ok: true, status: modelStatus(model, 'not_downloaded') }
    }
    const message = `${source.label}: ${describeKokoroDownloadError(error, kokoroTimeoutMessage('stall'))}`
    return { ok: false, message, status: modelStatus(model, 'error', { message }) }
  } finally {
    if (activeModelDownload?.modelId === model.id) activeModelDownload = null
  }
}

async function checkDownloadSource(
  model: LocalKokoroModel,
  source: LocalKokoroDownloadSource
): Promise<LocalKokoroDownloadSourceStatus> {
  const url = localKokoroModelUrl(model.id, source.id)
  const controller = new AbortController()
  const startedAt = Date.now()
  const timer = setTimeout(() => controller.abort(), KOKORO_SOURCE_CHECK_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-0', 'User-Agent': localKokoroUserAgent() },
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
      message: describeKokoroDownloadError(error, kokoroTimeoutMessage('source'))
    }
  } finally {
    clearTimeout(timer)
  }
}

function modelStatus(
  model: LocalKokoroModel,
  state: LocalKokoroModelStatus['state'],
  extra: Partial<LocalKokoroModelStatus> = {}
): LocalKokoroModelStatus {
  return {
    modelId: model.id,
    label: model.label,
    fileName: model.fileName,
    source: model.source,
    license: model.license,
    sha256: model.sha256,
    sizeBytes: model.sizeBytes,
    maxBytes: model.maxBytes,
    resourceTier: model.resourceTier,
    resourceEstimate: model.resourceEstimate,
    qualityTier: model.qualityTier,
    recommended: model.id === recommendedLocalKokoroModelId(process.arch),
    state,
    ...extra
  }
}

function emitProgress(progress: LocalKokoroModelProgress): void {
  const percent = progress.totalBytes && progress.totalBytes > 0
    ? Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100)
    : undefined
  lastProgress = { ...progress, percent }
  progressEmitter?.(lastProgress)
}
