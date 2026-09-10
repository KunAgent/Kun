import type {
  LocalKokoroTrackExportResult,
  LocalKokoroTrackInfo,
  LocalKokoroTrackUsage
} from './local-kokoro-tracks'
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
  LocalKokoroDownloadSourceId,
  LocalKokoroDownloadSourceStatusResult,
  LocalKokoroModelDeleteResult,
  LocalKokoroModelDownloadResult,
  LocalKokoroModelId,
  LocalKokoroModelProgress,
  LocalKokoroModelStatus,
  LocalKokoroReadinessResult,
  LocalKokoroVoiceStatus
} from './local-kokoro'
import type { LocalKokoroVoiceId } from './local-kokoro-voices'
import type {
  LocalKokoroSpeakRequest,
  LocalKokoroSpeakResult
} from './local-kokoro-speech'

/**
 * Bridge surface for the two local speech engines: Whisper for voice input and
 * Kokoro for reading answers aloud. Both download their weights on demand into
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
  getLocalKokoroModelStatus: (modelId?: LocalKokoroModelId) => Promise<LocalKokoroModelStatus>
  listLocalKokoroModelStatuses: () => Promise<LocalKokoroModelStatus[]>
  downloadLocalKokoroModel: (payload?: {
    modelId?: LocalKokoroModelId
    ownerId?: string
    sourceId?: LocalKokoroDownloadSourceId
  }) => Promise<LocalKokoroModelDownloadResult>
  cancelLocalKokoroModel: (modelId?: LocalKokoroModelId) => Promise<LocalKokoroModelDownloadResult>
  deleteLocalKokoroModel: (modelId?: LocalKokoroModelId) => Promise<LocalKokoroModelDeleteResult>
  checkLocalKokoroDownloadSources: (payload?: {
    modelId?: LocalKokoroModelId
  }) => Promise<LocalKokoroDownloadSourceStatusResult>
  getLocalKokoroVoiceStatus: (voiceId?: LocalKokoroVoiceId) => Promise<LocalKokoroVoiceStatus>
  listDownloadedLocalKokoroVoices: () => Promise<LocalKokoroVoiceId[]>
  downloadLocalKokoroVoice: (payload?: {
    voiceId?: LocalKokoroVoiceId
    ownerId?: string
    sourceId?: LocalKokoroDownloadSourceId
  }) => Promise<LocalKokoroVoiceStatus>
  getLocalKokoroReadiness: (payload?: {
    modelId?: LocalKokoroModelId
    voiceId?: LocalKokoroVoiceId
  }) => Promise<LocalKokoroReadinessResult>
  synthesizeLocalKokoroSpeech: (payload: LocalKokoroSpeakRequest) => Promise<LocalKokoroSpeakResult>
  pingLocalKokoroMain: () => Promise<number>
  /** Keys of every Speak recording kept on disk. */
  listLocalKokoroTrackKeys: () => Promise<string[]>
  getLocalKokoroTrackUsage: () => Promise<LocalKokoroTrackUsage>
  /** Write the audio captured for a request as one recording. */
  finalizeLocalKokoroTrack: (
    payload: { requestId: string; key: string }
  ) => Promise<LocalKokoroTrackInfo | null>
  discardLocalKokoroTrack: (requestId: string) => Promise<boolean>
  /** Stored audio as base64 16-bit PCM, or null when it is gone. */
  readLocalKokoroTrack: (key: string) => Promise<string | null>
  exportLocalKokoroTrack: (
    payload: { key: string; fileName?: string }
  ) => Promise<LocalKokoroTrackExportResult>
  clearLocalKokoroTracks: () => Promise<LocalKokoroTrackUsage>
  cancelLocalKokoroSpeech: (requestId: string) => Promise<boolean>
  onLocalKokoroModelProgress: (handler: (payload: LocalKokoroModelProgress) => void) => () => void
}
