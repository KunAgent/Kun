import { app } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ChildProcess } from 'node:child_process'
import { stopOwnedProcess } from '../../../kun/src/process/owned-process'
import { runOwnedCommand } from '../owned-command'
import { createHash } from 'node:crypto'
import {
  LOCAL_WHISPER_DEFAULT_MODEL_ID,
  LOCAL_WHISPER_MODELS,
  LOCAL_WHISPER_DOWNLOAD_SOURCES,
  isLocalWhisperDownloadSourceId,
  isLocalWhisperModelId,
  localWhisperDownloadSourceById,
  localWhisperModelById,
  type LocalWhisperDownloadSourceId,
  type LocalWhisperDownloadSourceStatus,
  type LocalWhisperDownloadSourceStatusResult,
  type LocalWhisperModelDownloadResult,
  type LocalWhisperModelId,
  type LocalWhisperModelProgress,
  type LocalWhisperModelStatus
} from '../../shared/local-whisper'
import type { KunSpeechToTextSettingsV1 } from '../../shared/app-settings'
import type { SpeechTranscriptionRequest } from '../../shared/speech-to-text'

const WHISPER_OUTPUT_EMPTY_MESSAGE = 'local whisper transcription result is empty'
const LOCAL_WHISPER_DOWNLOAD_CONNECT_TIMEOUT_MS = 20_000
const LOCAL_WHISPER_DOWNLOAD_STALL_TIMEOUT_MS = 30_000
const LOCAL_WHISPER_SOURCE_CHECK_TIMEOUT_MS = 8_000

type LocalWhisperModel = (typeof LOCAL_WHISPER_MODELS)[number]
type LocalWhisperDownloadSource = (typeof LOCAL_WHISPER_DOWNLOAD_SOURCES)[number]

let downloadPromise: Promise<LocalWhisperModelDownloadResult> | null = null
let progressEmitter: ((progress: LocalWhisperModelProgress) => void) | null = null
let lastProgress: LocalWhisperModelProgress | null = null
let activeDownload: {
  modelId: LocalWhisperModelId
  controller: AbortController
  tempPath: string
  canceled: boolean
} | null = null
const activeWhisperChildren = new Set<ChildProcess>()
const activeWhisperRuns = new Set<Promise<void>>()
let whisperShuttingDown = false

type RunnerCommand = {
  command: string
  argsPrefix: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export function setLocalWhisperProgressEmitter(
  emitter: ((progress: LocalWhisperModelProgress) => void) | null
): void {
  progressEmitter = emitter
}

export async function getLocalWhisperModelStatus(
  modelId: unknown = LOCAL_WHISPER_DEFAULT_MODEL_ID
): Promise<LocalWhisperModelStatus> {
  const model = localWhisperModelById(modelId)
  const diskStatus = await readLocalWhisperDiskStatus(model)
  if (diskStatus) return diskStatus
  if (activeDownload?.modelId === model.id && activeDownload.canceled) {
    return baseStatus(model.id, 'not_downloaded')
  }
  if (downloadPromise && lastProgress?.modelId === model.id) {
    return baseStatus(model.id, 'downloading', {
      downloadedBytes: lastProgress.downloadedBytes,
      totalBytes: lastProgress.totalBytes,
      speedBytesPerSecond: lastProgress.speedBytesPerSecond
    })
  }
  return baseStatus(model.id, 'not_downloaded')
}

async function readLocalWhisperDiskStatus(model: LocalWhisperModel): Promise<LocalWhisperModelStatus | null> {
  const path = localWhisperModelPath(model.id)
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    return baseStatus(model.id, 'ready', {
      path,
      downloadedBytes: info.size,
      totalBytes: info.size
    })
  } catch {
    return null
  }
}

export async function downloadLocalWhisperModel(
  modelId: unknown = LOCAL_WHISPER_DEFAULT_MODEL_ID,
  sourceId: unknown
): Promise<LocalWhisperModelDownloadResult> {
  const model = localWhisperModelById(modelId)
  if (whisperShuttingDown) {
    return {
      ok: false,
      message: 'local Whisper service is shutting down',
      status: baseStatus(model.id, 'not_downloaded')
    }
  }
  const current = await getLocalWhisperModelStatus(model.id)
  if (current.state === 'ready') return { ok: true, status: current }
  if (downloadPromise) return downloadPromise
  downloadPromise = downloadModel(model.id, sourceId)
    .finally(() => {
      downloadPromise = null
      lastProgress = null
    })
  return downloadPromise
}

export async function cancelLocalWhisperModel(
  modelId: unknown = LOCAL_WHISPER_DEFAULT_MODEL_ID
): Promise<LocalWhisperModelDownloadResult> {
  const model = localWhisperModelById(modelId)
  if (!activeDownload || activeDownload.modelId !== model.id) {
    return { ok: true, status: await getLocalWhisperModelStatus(model.id) }
  }
  const canceledDownload = activeDownload
  canceledDownload.canceled = true
  canceledDownload.controller.abort()
  await downloadPromise?.catch(() => undefined)
  await rm(canceledDownload.tempPath, { force: true }).catch(() => undefined)
  return { ok: true, status: baseStatus(model.id, 'not_downloaded') }
}

export async function checkLocalWhisperDownloadSources(
  modelId: unknown = LOCAL_WHISPER_DEFAULT_MODEL_ID
): Promise<LocalWhisperDownloadSourceStatusResult> {
  const model = localWhisperModelById(modelId)
  const sources = await Promise.all(
    LOCAL_WHISPER_DOWNLOAD_SOURCES.map((source) => checkLocalWhisperDownloadSource(model, source))
  )
  return { modelId: model.id, sources }
}

export async function deleteLocalWhisperModel(
  modelId: unknown = LOCAL_WHISPER_DEFAULT_MODEL_ID
) {
  const model = localWhisperModelById(modelId)
  try {
    await rm(localWhisperModelPath(model.id), { force: true })
    await rm(localWhisperModelMetadataPath(model.id), { force: true })
    return { ok: true, status: await getLocalWhisperModelStatus(model.id) }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      status: await getLocalWhisperModelStatus(model.id)
    }
  }
}

export async function transcribeViaLocalWhisper(
  request: SpeechTranscriptionRequest,
  speechToText: KunSpeechToTextSettingsV1
): Promise<string> {
  if (whisperShuttingDown) throw new Error('local Whisper service is shutting down')
  const modelId = normalizeModelId(speechToText.model)
  const status = await getLocalWhisperModelStatus(modelId)
  if (status.state !== 'ready' || !status.path) {
    throw new Error('local Whisper model is not downloaded')
  }
  const runner = await resolveWhisperRunner()
  const tempBase = join(tmpdir(), `kun-whisper-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  const inputPath = `${tempBase}.wav`
  const outputBase = `${tempBase}-out`
  const outputPath = `${outputBase}.txt`
  try {
    await writeFile(inputPath, Buffer.from(request.audioBase64, 'base64'))
    const languageArgs = whisperLanguageArgs(speechToText.language)
    const args = [
      ...runner.argsPrefix,
      '-m',
      status.path,
      '-f',
      inputPath,
      '-otxt',
      '-of',
      outputBase,
      '-nt',
      ...languageArgs
    ]
    await runWhisper(runner.command, args, speechToText.timeoutMs, runner)
    const text = (await readFile(outputPath, 'utf8')).trim()
    if (!text) throw new Error(WHISPER_OUTPUT_EMPTY_MESSAGE)
    return text
  } finally {
    await rm(inputPath, { force: true }).catch(() => undefined)
    await rm(outputPath, { force: true }).catch(() => undefined)
  }
}

function normalizeModelId(value: unknown): LocalWhisperModelId {
  return isLocalWhisperModelId(value) ? value : LOCAL_WHISPER_DEFAULT_MODEL_ID
}

async function downloadModel(
  modelId: LocalWhisperModelId,
  sourceId: unknown
): Promise<LocalWhisperModelDownloadResult> {
  const model = localWhisperModelById(modelId)
  const source = localWhisperDownloadSourceById(sourceId)
  return downloadModelFromSource(model, source)
}

async function downloadModelFromSource(
  model: LocalWhisperModel,
  source: LocalWhisperDownloadSource
): Promise<LocalWhisperModelDownloadResult> {
  const target = localWhisperModelPath(model.id)
  const tempPath = `${target}.download`
  const controller = new AbortController()
  let timeoutMessage = `local Whisper model download stalled for ${Math.round(LOCAL_WHISPER_DOWNLOAD_STALL_TIMEOUT_MS / 1000)} seconds`
  let connectTimer: NodeJS.Timeout | undefined
  let stallTimer: NodeJS.Timeout | undefined
  const clearTimers = (): void => {
    if (connectTimer) clearTimeout(connectTimer)
    if (stallTimer) clearTimeout(stallTimer)
  }
  const resetStallTimer = (): void => {
    if (stallTimer) clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      timeoutMessage = `local Whisper model download stalled for ${Math.round(LOCAL_WHISPER_DOWNLOAD_STALL_TIMEOUT_MS / 1000)} seconds`
      controller.abort()
    }, LOCAL_WHISPER_DOWNLOAD_STALL_TIMEOUT_MS)
  }
  try {
    await mkdir(dirname(target), { recursive: true })
    activeDownload = {
      modelId: model.id,
      controller,
      tempPath,
      canceled: false
    }
    connectTimer = setTimeout(() => {
      timeoutMessage = `local Whisper model download did not connect within ${Math.round(LOCAL_WHISPER_DOWNLOAD_CONNECT_TIMEOUT_MS / 1000)} seconds`
      controller.abort()
    }, LOCAL_WHISPER_DOWNLOAD_CONNECT_TIMEOUT_MS)
    const response = await fetch(localWhisperDownloadUrl(model, source.id), {
      headers: { 'User-Agent': localWhisperDownloadUserAgent() },
      signal: controller.signal
    })
    if (connectTimer) clearTimeout(connectTimer)
    resetStallTimer()
    if (!response.ok || !response.body) {
      throw new Error(`failed to download Whisper model: HTTP ${response.status}`)
    }
    const totalBytes = readContentLength(response.headers)
    if (totalBytes && totalBytes > model.maxBytes) {
      throw new Error(`Whisper model is larger than the ${Math.round(model.maxBytes / 1024 / 1024)} MB limit`)
    }
    let downloadedBytes = 0
    const startedAt = Date.now()
    const bodyStream = Readable.fromWeb(response.body as any)
    bodyStream.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length
      resetStallTimer()
      const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000)
      emitProgress({
        modelId: model.id,
        downloadedBytes,
        totalBytes,
        speedBytesPerSecond: downloadedBytes / elapsedSeconds
      })
      if (downloadedBytes > model.maxBytes) {
        bodyStream.destroy(new Error('Whisper model exceeded the local size limit'))
      }
    })
    emitProgress({ modelId: model.id, downloadedBytes: 0, totalBytes, speedBytesPerSecond: 0 })
    await pipeline(bodyStream, createWriteStream(tempPath))
    clearTimers()
    const info = await stat(tempPath)
    if (info.size <= 0 || info.size > model.maxBytes) {
      throw new Error('downloaded Whisper model size is invalid')
    }
    if (info.size !== model.sizeBytes) {
      throw new Error(`downloaded Whisper model size mismatch: expected ${model.sizeBytes} bytes, got ${info.size} bytes`)
    }
    const actualSha256 = await fileSha256(tempPath)
    if (actualSha256 !== model.sha256) {
      throw new Error(`downloaded Whisper model checksum mismatch: expected ${model.sha256}, got ${actualSha256}`)
    }
    await rename(tempPath, target)
    await writeFile(
      localWhisperModelMetadataPath(model.id),
      JSON.stringify({
        modelId: model.id,
        fileName: model.fileName,
        source: model.source,
        license: model.license,
        downloadSource: source.id,
        downloadSourceLabel: source.label,
        downloadUrl: localWhisperDownloadUrl(model, source.id),
        sha256: model.sha256,
        size: info.size,
        downloadedAt: new Date().toISOString()
      }, null, 2),
      'utf8'
    )
    return { ok: true, status: await getLocalWhisperModelStatus(model.id) }
  } catch (error) {
    const canceled = activeDownload?.modelId === model.id && activeDownload.canceled
    clearTimers()
    await rm(tempPath, { force: true }).catch(() => undefined)
    if (canceled) {
      return { ok: true, status: baseStatus(model.id, 'not_downloaded') }
    }
    const message = describeLocalWhisperDownloadError(error, timeoutMessage)
    return {
      ok: false,
      message: `${source.label}: ${message}`,
      status: baseStatus(model.id, 'error', {
        message: `${source.label}: ${message}`
      })
    }
  } finally {
    if (activeDownload?.modelId === model.id && activeDownload.tempPath === tempPath) {
      activeDownload = null
    }
  }
}

async function checkLocalWhisperDownloadSource(
  model: LocalWhisperModel,
  source: LocalWhisperDownloadSource
): Promise<LocalWhisperDownloadSourceStatus> {
  const url = localWhisperDownloadUrl(model, source.id)
  const controller = new AbortController()
  const startedAt = Date.now()
  const timer = setTimeout(() => controller.abort(), LOCAL_WHISPER_SOURCE_CHECK_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: {
        Range: 'bytes=0-0',
        'User-Agent': localWhisperDownloadUserAgent()
      },
      signal: controller.signal
    })
    await response.body?.cancel().catch(() => undefined)
    const responseTimeMs = Date.now() - startedAt
    const available = response.status === 200 || response.status === 206
    return {
      sourceId: source.id,
      label: source.label,
      url,
      state: available ? 'available' : 'unavailable',
      httpStatus: response.status,
      responseTimeMs,
      ...(!available ? { message: `HTTP ${response.status}` } : {})
    }
  } catch (error) {
    return {
      sourceId: source.id,
      label: source.label,
      url,
      state: 'unavailable',
      responseTimeMs: Date.now() - startedAt,
      message: describeLocalWhisperDownloadError(
        error,
        `source check timed out after ${Math.round(LOCAL_WHISPER_SOURCE_CHECK_TIMEOUT_MS / 1000)} seconds`
      )
    }
  } finally {
    clearTimeout(timer)
  }
}

function localWhisperDownloadUrl(model: LocalWhisperModel, sourceId: LocalWhisperDownloadSourceId): string {
  if (!isLocalWhisperDownloadSourceId(sourceId) || sourceId === 'huggingface') return model.downloadUrl
  return model.downloadMirrors.find((mirror) => mirror.id === sourceId)?.downloadUrl ?? model.downloadUrl
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function localWhisperDownloadUserAgent(): string {
  let version = 'dev'
  try {
    version = app?.getVersion?.() || version
  } catch {
    version = 'dev'
  }
  return `Kun/${version} local-whisper`
}

function baseStatus(
  modelId: LocalWhisperModelId,
  state: LocalWhisperModelStatus['state'],
  extra: Partial<LocalWhisperModelStatus> = {}
): LocalWhisperModelStatus {
  const model = localWhisperModelById(modelId)
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
    recommended: model.recommended,
    state,
    ...extra
  }
}

function emitProgress(progress: LocalWhisperModelProgress): void {
  const percent = progress.totalBytes && progress.totalBytes > 0
    ? Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100)
    : undefined
  lastProgress = { ...progress, percent }
  progressEmitter?.(lastProgress)
}

function describeLocalWhisperDownloadError(error: unknown, timeoutMessage: string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof Error && error.name === 'AbortError') return timeoutMessage
  if (/aborted|terminated|network|fetch failed|socket|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(message)) {
    return `local Whisper model download failed because the network connection was interrupted: ${message}`
  }
  return message
}

function readContentLength(headers: Headers): number | undefined {
  const raw = headers.get('content-length')
  if (!raw) return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function localWhisperBaseDir(): string {
  return join(app.getPath('userData'), 'models', 'speech', 'whisper')
}

function localWhisperModelPath(modelId: LocalWhisperModelId): string {
  const model = localWhisperModelById(modelId)
  return join(localWhisperBaseDir(), model.id, model.fileName)
}

function localWhisperModelMetadataPath(modelId: LocalWhisperModelId): string {
  return join(localWhisperBaseDir(), modelId, 'model.json')
}

async function resolveWhisperRunner(): Promise<RunnerCommand> {
  const explicit = process.env.KUN_WHISPER_CLI?.trim()
  if (explicit) return { command: explicit, argsPrefix: [] }
  const executable = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  const platformDir = `${process.platform}-${process.arch}`
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'whisper', platformDir, executable) : '',
    join(app.getAppPath(), 'resources', 'whisper', platformDir, executable),
    join(process.cwd(), 'resources', 'whisper', platformDir, executable)
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (await canExecute(candidate)) {
      const runnerDir = dirname(candidate)
      return {
        command: candidate,
        argsPrefix: [],
        cwd: runnerDir,
        env: localWhisperRunnerEnv(runnerDir)
      }
    }
  }
  return { command: executable, argsPrefix: [] }
}

function localWhisperRunnerEnv(runnerDir: string): NodeJS.ProcessEnv {
  if (process.platform !== 'linux') return process.env
  const existing = process.env.LD_LIBRARY_PATH
  return {
    ...process.env,
    LD_LIBRARY_PATH: existing ? `${runnerDir}:${existing}` : runnerDir
  }
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path)
    if (process.platform !== 'win32') await chmod(path, 0o755).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

function whisperLanguageArgs(language: string): string[] {
  const value = language.trim().toLowerCase()
  if (!value || value === 'auto') return ['-l', 'auto']
  if (value === 'zh') return ['-l', 'zh']
  if (value === 'en') return ['-l', 'en']
  if (value === 'ja') return ['-l', 'ja']
  if (value === 'ko') return ['-l', 'ko']
  return ['-l', value]
}

async function runWhisper(
  command: string,
  args: string[],
  timeoutMs: number,
  runner: Pick<RunnerCommand, 'cwd' | 'env'> = {}
): Promise<void> {
  const run = runOwnedCommand(command, args, {
    cwd: runner.cwd, env: runner.env, timeoutMs,
    messages: { timeout: `local Whisper timed out after ${timeoutMs}ms` },
    onSpawn: (child) => { activeWhisperChildren.add(child) },
    onSettled: (child) => { activeWhisperChildren.delete(child) }
  }).then((result) => {
    if (result.exitCode !== 0) {
      throw new Error((result.stderr || result.stdout || `local Whisper exited with code ${result.exitCode}`).trim().slice(0, 1000))
    }
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error(`local Whisper runner is missing (${basename(command)})`)
    throw error
  })
  activeWhisperRuns.add(run)
  try {
    await run
  } finally {
    activeWhisperRuns.delete(run)
  }
}

export async function shutdownLocalWhisperService(): Promise<void> {
  whisperShuttingDown = true
  if (activeDownload) {
    activeDownload.canceled = true
    activeDownload.controller.abort()
  }
  const stopped = await Promise.allSettled([...activeWhisperChildren].map((child) =>
    stopOwnedProcess(child, { graceMs: 0, timeoutMs: 2000 })))
  const stopFailures = stopped.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  const pending = [
    ...activeWhisperRuns,
    ...(downloadPromise ? [downloadPromise] : [])
  ]
  if (pending.length > 0) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, 2_000) })
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
  progressEmitter = null
  if (stopFailures.length) throw new AggregateError(stopFailures.map((result) => result.reason), 'Whisper process cleanup failed')
}

export function localWhisperAvailableModels(): typeof LOCAL_WHISPER_MODELS {
  return LOCAL_WHISPER_MODELS
}

export const _internals = {
  fileSha256,
  checkLocalWhisperDownloadSource,
  localWhisperDownloadUrl,
  localWhisperModelPath,
  runWhisper,
  resetShutdownForTest(): void {
    whisperShuttingDown = false
  },
  setLocalWhisperDownloadStateForTest(progress: LocalWhisperModelProgress | null): void {
    lastProgress = progress
    downloadPromise = progress
      ? Promise.resolve({ ok: false, message: 'test' })
      : null
    activeDownload = null
  }
}
