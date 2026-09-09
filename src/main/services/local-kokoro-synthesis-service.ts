/** Main owns capture lifetime and delegates serialized inference to a worker host. */
import { Worker } from 'node:worker_threads'
import { LOCAL_KOKORO_DEFAULT_MODEL_ID, localKokoroModelById } from '../../shared/local-kokoro'
import { LOCAL_KOKORO_DEFAULT_VOICE_ID, localKokoroVoiceById, localKokoroVoiceLanguage } from '../../shared/local-kokoro-voices'
import type { LocalKokoroSpeakRequest, LocalKokoroSpeakResult } from '../../shared/local-kokoro-speech'
import { getLocalKokoroModelStatus, getLocalKokoroVoiceStatus, releaseLocalKokoroDownloads } from './local-kokoro-download-service'
import { appendLocalKokoroTrackChunk, beginLocalKokoroTrackCapture, discardLocalKokoroTrackCapture, discardAllLocalKokoroCaptures } from './local-kokoro-track-store'
import { resolveKokoroWorkerEntry } from './local-kokoro-worker-lookup'
import { KokoroWorkerHost } from './local-kokoro-worker-host'

export const LOCAL_KOKORO_SESSION_IDLE_RELEASE_MS = 5 * 60_000
const host = new KokoroWorkerHost(() => new Worker(new URL(resolveKokoroWorkerEntry(import.meta.url))))
const active = new Map<string, { canceled: boolean }>()
const capturing = new Set<string>()
const canceledRequests = new Map<string, number>()
let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null
let shuttingDown = false
let epoch = 0

function cancelIdleRelease(): void {
  if (idleReleaseTimer) clearTimeout(idleReleaseTimer)
  idleReleaseTimer = null
}

function scheduleIdleRelease(): void {
  cancelIdleRelease()
  if (shuttingDown || !host.resident || active.size > 0) return
  idleReleaseTimer = setTimeout(() => {
    idleReleaseTimer = null
    if (active.size === 0) void host.reset()
  }, LOCAL_KOKORO_SESSION_IDLE_RELEASE_MS)
  idleReleaseTimer.unref?.()
}

export function clearLocalKokoroCapture(requestId: string): void {
  capturing.delete(requestId)
}

function discard(requestId: string): void {
  capturing.delete(requestId)
  discardLocalKokoroTrackCapture(requestId)
}

export function cancelLocalKokoroSpeech(requestId: string): void {
  canceledRequests.set(requestId, Date.now() + 120_000)
  for (const [id, expires] of canceledRequests) {
    if (expires < Date.now() || canceledRequests.size > 2048) canceledRequests.delete(id)
  }
  const request = active.get(requestId)
  if (request) request.canceled = true
  discard(requestId)
  releaseLocalKokoroDownloads(requestId)
  host.cancel(requestId)
}

export function localKokoroSessionState(): {
  resident: boolean; idleReleaseScheduled: boolean; pendingRuns: number
} {
  return { resident: host.resident, idleReleaseScheduled: Boolean(idleReleaseTimer), pendingRuns: host.pendingRuns }
}

export async function resetLocalKokoroSession(): Promise<void> {
  epoch += 1
  releaseLocalKokoroDownloads()
  cancelIdleRelease()
  for (const request of active.values()) request.canceled = true
  capturing.clear()
  discardAllLocalKokoroCaptures()
  await host.reset()
}

export async function shutdownLocalKokoroSynthesis(): Promise<void> {
  shuttingDown = true
  await resetLocalKokoroSession()
}

export async function synthesizeLocalKokoroSpeech(request: LocalKokoroSpeakRequest): Promise<LocalKokoroSpeakResult> {
  const requestId = request.requestId
  if (active.has(requestId)) return { ok: false, message: 'Speech request is already running' }
  const state = { canceled: (canceledRequests.get(requestId) ?? 0) > Date.now() }
  const startedEpoch = epoch
  const canceled = (): boolean => state.canceled || startedEpoch !== epoch || shuttingDown
  active.set(requestId, state)
  if (request.keepTrack && !capturing.has(requestId)) {
    capturing.add(requestId)
    beginLocalKokoroTrackCapture(requestId)
  }
  cancelIdleRelease()
  let succeeded = false
  try {
    if (canceled()) return { ok: false, canceled: true }
    const text = typeof request.text === 'string' ? request.text.trim() : ''
    if (!text) return { ok: false, message: 'nothing to speak' }
    const model = localKokoroModelById(request.modelId ?? LOCAL_KOKORO_DEFAULT_MODEL_ID)
    const voice = localKokoroVoiceById(request.voiceId ?? LOCAL_KOKORO_DEFAULT_VOICE_ID)
    const [modelStatus, voiceStatus] = await Promise.all([
      getLocalKokoroModelStatus(model.id), getLocalKokoroVoiceStatus(voice.id)
    ])
    if (canceled()) return { ok: false, canceled: true }
    if (modelStatus.state !== 'ready' || !modelStatus.path) return { ok: false, message: 'Kokoro model is not downloaded', missing: 'model' }
    if (voiceStatus.state !== 'ready' || !voiceStatus.path) return { ok: false, message: 'Kokoro voice is not downloaded', missing: 'voice' }
    const response = await host.run({
      type: 'synthesize', id: requestId, text, modelPath: modelStatus.path,
      voiceId: voice.id, voicePath: voiceStatus.path, language: localKokoroVoiceLanguage(voice.id),
      speed: Number.isFinite(request.speed) ? Math.min(2, Math.max(0.5, request.speed!)) : 1
    }, canceled)
    if (canceled()) return { ok: false, canceled: true }
    if (!response.ok) return { ok: false, message: response.message, canceled: response.canceled }
    const pcm = Buffer.from(response.pcm.buffer, response.pcm.byteOffset, response.pcm.byteLength)
    if (request.keepTrack) appendLocalKokoroTrackChunk(requestId, pcm)
    succeeded = true
    return { ok: true, pcm16Base64: pcm.toString('base64'), sampleRate: response.sampleRate,
      sampleCount: response.sampleCount, durationSeconds: response.durationSeconds }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!succeeded) discard(requestId)
    if (active.get(requestId) === state) active.delete(requestId)
    scheduleIdleRelease()
  }
}

export type { LocalKokoroModelId } from '../../shared/local-kokoro'
