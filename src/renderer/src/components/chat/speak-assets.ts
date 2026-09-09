/**
 * Settings and on-demand asset download for Speak.
 *
 * The first Speak on a fresh install has no weights on disk. Rather than
 * failing, the model and the selected voice are fetched while a progress card
 * reports bytes, and playback continues automatically once both are verified.
 */
import {
  localKokoroModelById,
  type LocalKokoroDownloadSourceId,
  type LocalKokoroModelId
} from '@shared/local-kokoro'
import { localKokoroVoiceById, type LocalKokoroVoiceId } from '@shared/local-kokoro-voices'
import { useSpeakStore } from '../../stores/speak-store'

export type SpeakSettings = {
  enabled: boolean
  /** Keep the audio for an answer on disk once it has been produced. */
  keepTracks: boolean
  model: LocalKokoroModelId
  voice: LocalKokoroVoiceId
  speed: number
  downloadSource: LocalKokoroDownloadSourceId
  autoDownload: boolean
}

export type SpeakAssetResult = { ok: true } | { ok: false; message: string }

export async function loadSpeakSettings(): Promise<SpeakSettings | null> {
  if (typeof window.kunGui?.getSettings !== 'function') return null
  try {
    const settings = await window.kunGui.getSettings()
    const speak = settings.agents.kun.speak
    return {
      enabled: speak.enabled,
      model: speak.model,
      voice: speak.voice,
      speed: speak.speed,
      downloadSource: speak.downloadSource,
      autoDownload: speak.autoDownload,
      keepTracks: speak.keepTracks === true
    }
  } catch {
    return null
  }
}

/**
 * Ensure the model tier and voice are on disk, downloading them when the user
 * has left auto-download on. `isCanceled` lets a stop click abandon the wait.
 */
export async function ensureKokoroAssets(
  settings: SpeakSettings,
  isCanceled: () => boolean,
  ownerId?: string
): Promise<SpeakAssetResult> {
  const bridge = window.kunGui
  if (typeof bridge?.getLocalKokoroReadiness !== 'function') {
    return { ok: false, message: 'speakUnavailable' }
  }
  const readiness = await bridge.getLocalKokoroReadiness({
    modelId: settings.model,
    voiceId: settings.voice
  })
  if (isCanceled()) return { ok: false, message: '' }
  if (readiness.ready) return { ok: true }
  if (!settings.autoDownload) return { ok: false, message: 'speakModelMissing' }
  if (isCanceled()) return { ok: false, message: '' }

  const store = useSpeakStore.getState()
  store.setPhase('downloading')
  const stopProgress = subscribeToProgress(settings, isCanceled)
  try {
    if (readiness.model.state !== 'ready') {
      store.setDownload({
        asset: 'model',
        label: localKokoroModelById(settings.model).label,
        downloadedBytes: 0,
        totalBytes: localKokoroModelById(settings.model).sizeBytes
      })
      const download = await bridge.downloadLocalKokoroModel({
        modelId: settings.model,
        sourceId: settings.downloadSource,
        ownerId
      })
      if (isCanceled()) return { ok: false, message: '' }
      if (!download.ok) return { ok: false, message: download.message }
      if (download.status.modelId !== settings.model || download.status.state !== 'ready') return { ok: false, message: 'speakModelMissing' }
    }
    if (readiness.voice.state !== 'ready') {
      const voice = localKokoroVoiceById(settings.voice)
      store.setDownload({
        asset: 'voice',
        label: voice.label,
        downloadedBytes: 0,
        totalBytes: voice.sizeBytes
      })
      const voiceStatus = await bridge.downloadLocalKokoroVoice({
        voiceId: settings.voice,
        sourceId: settings.downloadSource,
        ownerId
      })
      if (isCanceled()) return { ok: false, message: '' }
      if (voiceStatus.state !== 'ready') {
        return { ok: false, message: voiceStatus.message || 'speakVoiceMissing' }
      }
    }
    return { ok: true }
  } finally {
    stopProgress()
    if (!isCanceled()) useSpeakStore.getState().setDownload(null)
  }
}

function subscribeToProgress(settings: SpeakSettings, isCanceled: () => boolean): () => void {
  if (typeof window.kunGui?.onLocalKokoroModelProgress !== 'function') return () => undefined
  return window.kunGui.onLocalKokoroModelProgress((progress) => {
    if (isCanceled()) return
    if (progress.asset === 'model' && progress.modelId !== settings.model) return
    if (progress.asset === 'voice' && progress.voiceId !== settings.voice) return
    const label = progress.asset === 'voice'
      ? localKokoroVoiceById(progress.voiceId ?? settings.voice).label
      : localKokoroModelById(progress.modelId ?? settings.model).label
    useSpeakStore.getState().setDownload({
      asset: progress.asset,
      label,
      downloadedBytes: progress.downloadedBytes,
      totalBytes: progress.totalBytes,
      percent: progress.percent,
      speedBytesPerSecond: progress.speedBytesPerSecond
    })
  })
}
