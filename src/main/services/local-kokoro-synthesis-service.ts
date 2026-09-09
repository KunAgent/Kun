/**
 * Local Kokoro speech synthesis, run off the Main thread.
 *
 * `onnxruntime-node` executes inference synchronously on whichever JavaScript
 * thread calls it, so running it in Main froze the window for the length of
 * every chunk - two to three seconds at a time, which is what put the spinning
 * cursor on screen while an answer was being spoken. This module keeps the same
 * public API and forwards the work to a worker thread instead.
 */
import { Worker } from 'node:worker_threads'
import {
  LOCAL_KOKORO_DEFAULT_MODEL_ID,
  localKokoroModelById,
  type LocalKokoroModelId
} from '../../shared/local-kokoro'
import {
  LOCAL_KOKORO_DEFAULT_VOICE_ID,
  localKokoroVoiceById,
  localKokoroVoiceLanguage
} from '../../shared/local-kokoro-voices'
import type {
  LocalKokoroSpeakRequest,
  LocalKokoroSpeakResult
} from '../../shared/local-kokoro-speech'
import { getLocalKokoroModelStatus, getLocalKokoroVoiceStatus } from './local-kokoro-download-service'
import {
  appendLocalKokoroTrackChunk,
  beginLocalKokoroTrackCapture,
  discardLocalKokoroTrackCapture
} from './local-kokoro-track-store'
import { resolveKokoroWorkerEntry } from './local-kokoro-worker-lookup'
import type { KokoroWorkerRequest, KokoroWorkerResponse } from './local-kokoro-worker-protocol'

/**
 * The worker holds the whole model resident (250-550 MB depending on the tier),
 * so an idle one is shut down instead of being kept until quit. The next Speak
 * pays the model load again, which is a fraction of a second.
 */
export const LOCAL_KOKORO_SESSION_IDLE_RELEASE_MS = 5 * 60_000

type PendingRun = {
  resolve: (result: LocalKokoroSpeakResult) => void
}

let worker: Worker | null = null
let workerReady: Promise<Worker> | null = null
const pending = new Map<string, PendingRun>()
const canceledRequests = new Set<string>()
/** Requests whose audio is being collected into a stored recording. */
const capturing = new Set<string>()
let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null
let activeRequests = 0
let shuttingDown = false
/** Runs are serialized: concurrent inference on one session only adds contention. */
let runQueue: Promise<unknown> = Promise.resolve()

function workerEntryUrl(): URL {
  return new URL(resolveKokoroWorkerEntry(import.meta.url))
}

function handleResponse(message: KokoroWorkerResponse): void {
  if (message?.type !== 'result') return
  const run = pending.get(message.id)
  if (!run) return
  pending.delete(message.id)
  if (!message.ok) {
    run.resolve({
      ok: false,
      canceled: message.canceled,
      message: message.message
    })
    return
  }
  run.resolve({
    ok: true,
    sampleRate: message.sampleRate,
    sampleCount: message.sampleCount,
    durationSeconds: message.durationSeconds,
    pcm16Base64: Buffer.from(
      message.pcm.buffer,
      message.pcm.byteOffset,
      message.pcm.byteLength
    ).toString('base64')
  })
}

function failAllPending(message: string): void {
  const runs = [...pending.values()]
  pending.clear()
  for (const run of runs) run.resolve({ ok: false, message })
}

async function ensureWorker(): Promise<Worker> {
  if (worker) return worker
  if (workerReady) return workerReady
  workerReady = new Promise<Worker>((resolve, reject) => {
    const created = new Worker(workerEntryUrl())
    const onFirstMessage = (message: KokoroWorkerResponse): void => {
      if (message?.type !== 'ready') return
      created.off('message', onFirstMessage)
      created.on('message', handleResponse)
      worker = created
      resolve(created)
    }
    created.on('message', onFirstMessage)
    created.once('error', (error) => {
      worker = null
      workerReady = null
      failAllPending(error instanceof Error ? error.message : String(error))
      reject(error)
    })
    created.once('exit', () => {
      if (worker === created) worker = null
      workerReady = null
      failAllPending('Kokoro speech worker stopped')
    })
  }).finally(() => {
    workerReady = null
  })
  return workerReady
}

function cancelIdleRelease(): void {
  if (!idleReleaseTimer) return
  clearTimeout(idleReleaseTimer)
  idleReleaseTimer = null
}

function scheduleIdleRelease(): void {
  cancelIdleRelease()
  if (shuttingDown || !worker) return
  idleReleaseTimer = setTimeout(() => {
    idleReleaseTimer = null
    // A request that arrived while the timer was pending owns the worker.
    if (activeRequests > 0) return
    void shutdownWorker()
  }, LOCAL_KOKORO_SESSION_IDLE_RELEASE_MS)
  // Never hold the Main process open just to release a model.
  idleReleaseTimer.unref?.()
}

async function shutdownWorker(): Promise<void> {
  const current = worker
  worker = null
  workerReady = null
  if (!current) return
  current.off('message', handleResponse)
  await current.terminate().catch(() => undefined)
}

export function cancelLocalKokoroSpeech(requestId: string): void {
  if (typeof requestId !== 'string' || !requestId) return
  canceledRequests.add(requestId)
  // A half-spoken answer must not be stored as if it were complete.
  if (capturing.delete(requestId)) discardLocalKokoroTrackCapture(requestId)
  worker?.postMessage({ type: 'cancel', id: requestId } satisfies KokoroWorkerRequest)
}

/** Forget that a request was being recorded, once its track is written or dropped. */
export function clearLocalKokoroCapture(requestId: string): void {
  capturing.delete(requestId)
}

/** Worker residency, exposed for tests and diagnostics. */
export function localKokoroSessionState(): {
  resident: boolean
  idleReleaseScheduled: boolean
  pendingRuns: number
} {
  return {
    resident: Boolean(worker),
    idleReleaseScheduled: Boolean(idleReleaseTimer),
    pendingRuns: pending.size
  }
}

/** Drop the worker so a deleted or re-downloaded model is reloaded. */
export async function resetLocalKokoroSession(): Promise<void> {
  cancelIdleRelease()
  await shutdownWorker()
}

export async function shutdownLocalKokoroSynthesis(): Promise<void> {
  shuttingDown = true
  cancelIdleRelease()
  failAllPending('local Kokoro service is shutting down')
  await shutdownWorker()
}

function clampSpeed(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 1
  return Math.min(2, Math.max(0.5, parsed))
}

/**
 * Synthesize one chunk of text. Returns 16-bit PCM at 24 kHz, base64 encoded,
 * which the renderer decodes straight into a Web Audio buffer.
 */
export async function synthesizeLocalKokoroSpeech(
  request: LocalKokoroSpeakRequest
): Promise<LocalKokoroSpeakResult> {
  const requestId = typeof request.requestId === 'string' ? request.requestId : ''
  activeRequests += 1
  cancelIdleRelease()
  try {
    if (shuttingDown) return { ok: false, message: 'local Kokoro service is shutting down' }
    const text = typeof request.text === 'string' ? request.text.trim() : ''
    if (!text) return { ok: false, message: 'nothing to speak' }
    const model = localKokoroModelById(request.modelId ?? LOCAL_KOKORO_DEFAULT_MODEL_ID)
    const voice = localKokoroVoiceById(request.voiceId ?? LOCAL_KOKORO_DEFAULT_VOICE_ID)
    const modelStatus = await getLocalKokoroModelStatus(model.id)
    if (modelStatus.state !== 'ready' || !modelStatus.path) {
      return { ok: false, message: 'Kokoro model is not downloaded', missing: 'model' }
    }
    const voiceStatus = await getLocalKokoroVoiceStatus(voice.id)
    if (voiceStatus.state !== 'ready' || !voiceStatus.path) {
      return { ok: false, message: 'Kokoro voice is not downloaded', missing: 'voice' }
    }
    if (canceledRequests.has(requestId)) return { ok: false, canceled: true }

    const active = await ensureWorker()
    const payload: KokoroWorkerRequest = {
      type: 'synthesize',
      id: requestId,
      text,
      modelPath: modelStatus.path,
      voiceId: voice.id,
      voicePath: voiceStatus.path,
      language: localKokoroVoiceLanguage(voice.id),
      speed: clampSpeed(request.speed)
    }
    if (request.keepTrack && !capturing.has(requestId)) {
      capturing.add(requestId)
      beginLocalKokoroTrackCapture(requestId)
    }
    // Serialized so a queued chunk cannot contend with the one being spoken.
    const run = runQueue.then(() => new Promise<LocalKokoroSpeakResult>((resolve) => {
      if (canceledRequests.has(requestId)) {
        resolve({ ok: false, canceled: true })
        return
      }
      pending.set(requestId, { resolve })
      active.postMessage(payload)
    }))
    runQueue = run.catch(() => undefined)
    const result = await run
    if (request.keepTrack && result.ok) {
      appendLocalKokoroTrackChunk(requestId, Buffer.from(result.pcm16Base64, 'base64'))
    }
    return result
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    pending.delete(requestId)
    if (requestId) canceledRequests.delete(requestId)
    activeRequests -= 1
    if (activeRequests === 0) scheduleIdleRelease()
  }
}

/** Model tiers the worker can be asked for, used by callers that pre-warm. */
export type { LocalKokoroModelId }
