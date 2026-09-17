/** Main owns capture lifetime and delegates serialized inference to a worker host. */
import { Worker } from 'node:worker_threads'
import { LOCAL_SANOTTS_DEFAULT_VOICE_ID, localSanottsVoiceById } from '../../shared/local-sanotts-voices'
import type { LocalSanottsSpeakRequest, LocalSanottsSpeakResult } from '../../shared/local-sanotts-speech'
import {
  getLocalSanottsRuntimeStatus,
  getLocalSanottsVoiceStatus,
  releaseLocalSanottsDownloads
} from './local-sanotts-download-service'
import {
  appendLocalSanottsTrackChunk,
  beginLocalSanottsTrackCapture,
  discardAllLocalSanottsCaptures,
  discardLocalSanottsTrackCapture
} from './local-sanotts-track-store'
import { resolveSanottsWorkerEntry } from './local-sanotts-worker-lookup'
import { SanottsWorkerHost } from './local-sanotts-worker-host'

export const LOCAL_SANOTTS_SESSION_IDLE_RELEASE_MS = 5 * 60_000
const host = new SanottsWorkerHost(() => new Worker(new URL(resolveSanottsWorkerEntry(import.meta.url))))
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
  }, LOCAL_SANOTTS_SESSION_IDLE_RELEASE_MS)
  idleReleaseTimer.unref?.()
}

export function clearLocalSanottsCapture(requestId: string): void {
  capturing.delete(requestId)
}

function discard(requestId: string): void {
  capturing.delete(requestId)
  discardLocalSanottsTrackCapture(requestId)
}

export function cancelLocalSanottsSpeech(requestId: string): void {
  canceledRequests.set(requestId, Date.now() + 120_000)
  for (const [id, expires] of canceledRequests) {
    if (expires < Date.now() || canceledRequests.size > 2048) canceledRequests.delete(id)
  }
  const request = active.get(requestId)
  if (request) request.canceled = true
  discard(requestId)
  releaseLocalSanottsDownloads(requestId)
  host.cancel(requestId)
}

export function localSanottsSessionState(): {
  resident: boolean; idleReleaseScheduled: boolean; pendingRuns: number
} {
  return { resident: host.resident, idleReleaseScheduled: Boolean(idleReleaseTimer), pendingRuns: host.pendingRuns }
}

export async function resetLocalSanottsSession(): Promise<void> {
  epoch += 1
  releaseLocalSanottsDownloads()
  cancelIdleRelease()
  for (const request of active.values()) request.canceled = true
  capturing.clear()
  discardAllLocalSanottsCaptures()
  await host.reset()
}

export async function shutdownLocalSanottsSynthesis(): Promise<void> {
  shuttingDown = true
  await resetLocalSanottsSession()
}

export async function synthesizeLocalSanottsSpeech(request: LocalSanottsSpeakRequest): Promise<LocalSanottsSpeakResult> {
  const requestId = request.requestId
  if (active.has(requestId)) return { ok: false, message: 'Speech request is already running' }
  const state = { canceled: (canceledRequests.get(requestId) ?? 0) > Date.now() }
  const startedEpoch = epoch
  const canceled = (): boolean => state.canceled || startedEpoch !== epoch || shuttingDown
  active.set(requestId, state)
  if (request.keepTrack && !capturing.has(requestId)) {
    capturing.add(requestId)
    beginLocalSanottsTrackCapture(requestId)
  }
  cancelIdleRelease()
  let succeeded = false
  try {
    if (canceled()) return { ok: false, canceled: true }
    const text = typeof request.text === 'string' ? request.text.trim() : ''
    if (!text) return { ok: false, message: 'nothing to speak' }
    const voice = localSanottsVoiceById(request.voiceId ?? LOCAL_SANOTTS_DEFAULT_VOICE_ID)
    const [runtimeStatus, voiceStatus] = await Promise.all([
      getLocalSanottsRuntimeStatus(), getLocalSanottsVoiceStatus(voice.id)
    ])
    if (canceled()) return { ok: false, canceled: true }
    if (runtimeStatus.state !== 'ready' || !runtimeStatus.path) {
      return { ok: false, message: 'sanoTTS runtime is not downloaded', missing: 'runtime' }
    }
    if (voiceStatus.state !== 'ready' || !voiceStatus.path) {
      return { ok: false, message: 'sanoTTS voice is not downloaded', missing: 'voice' }
    }
    const response = await host.run({
      type: 'synthesize',
      id: requestId,
      text,
      runtimeDir: runtimeStatus.path,
      voiceId: voice.id,
      voiceDir: voiceStatus.path,
      speed: Number.isFinite(request.speed) ? Math.min(2, Math.max(0.5, request.speed!)) : 1
    }, canceled)
    if (canceled()) return { ok: false, canceled: true }
    if (!response.ok) return { ok: false, message: response.message, canceled: response.canceled }
    const pcm = Buffer.from(response.pcm.buffer, response.pcm.byteOffset, response.pcm.byteLength)
    if (request.keepTrack) appendLocalSanottsTrackChunk(requestId, pcm, response.sampleRate)
    succeeded = true
    return {
      ok: true,
      pcm16Base64: pcm.toString('base64'),
      sampleRate: response.sampleRate,
      sampleCount: response.sampleCount,
      durationSeconds: response.durationSeconds
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!succeeded) discard(requestId)
    if (active.get(requestId) === state) active.delete(requestId)
    scheduleIdleRelease()
  }
}
