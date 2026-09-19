/**
 * Settings and on-demand asset download for Speak.
 *
 * The first Speak on a fresh install has no runtime WASM or voice weights on
 * disk. Rather than failing, both are fetched while a progress card reports
 * bytes, and playback continues automatically once they are verified.
 */
import { isAppLocale } from '@shared/app-locales'
import {
  LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID,
  LOCAL_SANOTTS_RUNTIME_LABEL,
  LOCAL_SANOTTS_RUNTIME_SIZE_BYTES,
  type LocalSanottsDownloadSourceId
} from '@shared/local-sanotts'
import {
  LOCAL_SANOTTS_DEFAULT_VOICE_ID,
  localSanottsVoiceById,
  resolveLocalSanottsVoiceId,
  type LocalSanottsVoiceId
} from '@shared/local-sanotts-voices'
import { useSpeakStore } from '../../stores/speak-store'

export type SpeakSettings = {
  enabled: boolean
  /** Keep the audio for an answer on disk once it has been produced. */
  keepTracks: boolean
  /** Concrete voice used for synthesis after resolving `auto`. */
  voice: LocalSanottsVoiceId
  speed: number
  downloadSource: LocalSanottsDownloadSourceId
  autoDownload: boolean
}

export type SpeakAssetResult = { ok: true } | { ok: false; message: string }

export async function loadSpeakSettings(): Promise<SpeakSettings | null> {
  if (typeof window.kunGui?.getSettings !== 'function') return null
  try {
    const settings = await window.kunGui.getSettings()
    const speak = settings.agents.kun.speak
    const locale = isAppLocale(settings.locale) ? settings.locale : 'en'
    return {
      enabled: speak.enabled,
      voice: resolveLocalSanottsVoiceId(speak.voice, locale),
      speed: speak.speed,
      downloadSource: speak.downloadSource ?? LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID,
      autoDownload: speak.autoDownload,
      keepTracks: speak.keepTracks === true
    }
  } catch {
    return null
  }
}

/**
 * Ensure the runtime and selected voice are on disk, downloading them when the
 * user has left auto-download on. `isCanceled` lets a stop click abandon the wait.
 */
export async function ensureSanottsAssets(
  settings: SpeakSettings,
  isCanceled: () => boolean,
  ownerId?: string
): Promise<SpeakAssetResult> {
  const bridge = window.kunGui
  if (typeof bridge?.getLocalSanottsReadiness !== 'function') {
    return { ok: false, message: 'speakUnavailable' }
  }
  const voiceId = settings.voice || LOCAL_SANOTTS_DEFAULT_VOICE_ID
  const readiness = await bridge.getLocalSanottsReadiness({ voiceId })
  if (isCanceled()) return { ok: false, message: '' }
  if (readiness.ready) return { ok: true }
  if (!settings.autoDownload) return { ok: false, message: 'speakModelMissing' }
  if (isCanceled()) return { ok: false, message: '' }

  const store = useSpeakStore.getState()
  store.setPhase('downloading')
  const stopProgress = subscribeToProgress(voiceId, isCanceled)
  try {
    if (readiness.runtime.state !== 'ready') {
      store.setDownload({
        asset: 'runtime',
        label: LOCAL_SANOTTS_RUNTIME_LABEL,
        downloadedBytes: 0,
        totalBytes: LOCAL_SANOTTS_RUNTIME_SIZE_BYTES
      })
      const download = await bridge.downloadLocalSanottsRuntime({
        sourceId: settings.downloadSource,
        ownerId
      })
      if (isCanceled()) return { ok: false, message: '' }
      if (!download.ok) return { ok: false, message: download.message }
      if (download.status.state !== 'ready') return { ok: false, message: 'speakModelMissing' }
    }
    if (readiness.voice.state !== 'ready') {
      const voice = localSanottsVoiceById(voiceId)
      store.setDownload({
        asset: 'voice',
        label: voice.label,
        downloadedBytes: 0,
        totalBytes: voice.sizeBytes
      })
      const voiceStatus = await bridge.downloadLocalSanottsVoice({
        voiceId,
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

function subscribeToProgress(voiceId: LocalSanottsVoiceId, isCanceled: () => boolean): () => void {
  if (typeof window.kunGui?.onLocalSanottsAssetProgress !== 'function') return () => undefined
  return window.kunGui.onLocalSanottsAssetProgress((progress) => {
    if (isCanceled()) return
    if (progress.asset === 'voice' && progress.voiceId !== voiceId) return
    const label = progress.asset === 'voice'
      ? localSanottsVoiceById(progress.voiceId ?? voiceId).label
      : LOCAL_SANOTTS_RUNTIME_LABEL
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
