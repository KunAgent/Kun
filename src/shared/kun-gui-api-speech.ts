import type {
  LocalSanottsTrackExportResult,
  LocalSanottsTrackInfo,
  LocalSanottsTrackUsage
} from './local-sanotts-tracks'
import type {
  LocalWhisperDownloadSourceId,
  LocalWhisperDownloadSourceStatusResult,
  LocalWhisperModelDeleteResult,
  LocalWhisperModelDownloadResult,
  LocalWhisperModelId,
  LocalWhisperModelProgress,
  LocalWhisperModelStatus
} from './local-whisper'
import type {
  LocalSanottsAssetProgress,
  LocalSanottsDownloadSourceId,
  LocalSanottsDownloadSourceStatusResult,
  LocalSanottsReadinessResult,
  LocalSanottsRuntimeDeleteResult,
  LocalSanottsRuntimeDownloadResult,
  LocalSanottsRuntimeStatus,
  LocalSanottsVoiceStatus
} from './local-sanotts'
import type { LocalSanottsVoiceId } from './local-sanotts-voices'
import type {
  LocalSanottsSpeakRequest,
  LocalSanottsSpeakResult
} from './local-sanotts-speech'

/**
 * Bridge surface for the two local speech engines: Whisper for voice input and
 * sanoTTS for reading answers aloud. Both download their weights on demand into
 * the user data directory, so the renderer needs asset management alongside the
 * transcription and synthesis calls.
 */
export type KunGuiLocalSpeechApi = {
  getLocalWhisperModelStatus: (modelId?: LocalWhisperModelId) => Promise<LocalWhisperModelStatus>
  downloadLocalWhisperModel: (payload?: {
    modelId?: LocalWhisperModelId
    sourceId?: LocalWhisperDownloadSourceId
  }) => Promise<LocalWhisperModelDownloadResult>
  cancelLocalWhisperModel: (modelId?: LocalWhisperModelId) => Promise<LocalWhisperModelDownloadResult>
  checkLocalWhisperDownloadSources: (payload?: {
    modelId?: LocalWhisperModelId
  }) => Promise<LocalWhisperDownloadSourceStatusResult>
  deleteLocalWhisperModel: (modelId?: LocalWhisperModelId) => Promise<LocalWhisperModelDeleteResult>
  onLocalWhisperModelProgress: (handler: (payload: LocalWhisperModelProgress) => void) => () => void
  getLocalSanottsRuntimeStatus: () => Promise<LocalSanottsRuntimeStatus>
  downloadLocalSanottsRuntime: (payload?: {
    ownerId?: string
    sourceId?: LocalSanottsDownloadSourceId
  }) => Promise<LocalSanottsRuntimeDownloadResult>
  cancelLocalSanottsRuntime: () => Promise<LocalSanottsRuntimeDownloadResult>
  deleteLocalSanottsRuntime: () => Promise<LocalSanottsRuntimeDeleteResult>
  checkLocalSanottsDownloadSources: () => Promise<LocalSanottsDownloadSourceStatusResult>
  getLocalSanottsVoiceStatus: (voiceId?: LocalSanottsVoiceId) => Promise<LocalSanottsVoiceStatus>
  listDownloadedLocalSanottsVoices: () => Promise<LocalSanottsVoiceId[]>
  downloadLocalSanottsVoice: (payload?: {
    voiceId?: LocalSanottsVoiceId
    ownerId?: string
    sourceId?: LocalSanottsDownloadSourceId
  }) => Promise<LocalSanottsVoiceStatus>
  getLocalSanottsReadiness: (payload?: {
    voiceId?: LocalSanottsVoiceId
  }) => Promise<LocalSanottsReadinessResult>
  synthesizeLocalSanottsSpeech: (payload: LocalSanottsSpeakRequest) => Promise<LocalSanottsSpeakResult>
  pingLocalSanottsMain: () => Promise<number>
  listLocalSanottsTrackKeys: () => Promise<string[]>
  getLocalSanottsTrackUsage: () => Promise<LocalSanottsTrackUsage>
  finalizeLocalSanottsTrack: (
    payload: { requestId: string; key: string }
  ) => Promise<LocalSanottsTrackInfo | null>
  discardLocalSanottsTrack: (requestId: string) => Promise<boolean>
  readLocalSanottsTrack: (key: string) => Promise<string | null>
  exportLocalSanottsTrack: (
    payload: { key: string; fileName?: string }
  ) => Promise<LocalSanottsTrackExportResult>
  clearLocalSanottsTracks: () => Promise<LocalSanottsTrackUsage>
  cancelLocalSanottsSpeech: (requestId: string) => Promise<boolean>
  onLocalSanottsAssetProgress: (handler: (payload: LocalSanottsAssetProgress) => void) => () => void
}
