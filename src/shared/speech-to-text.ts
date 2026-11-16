import type { KunSpeechToTextSettingsV1 } from './app-settings-types'

/**
 * Base64 payload cap for one transcription request (~12 MB of audio).
 * Keeps a long mono 16 kHz WAV dictation (≈6 minutes) under the limit
 * while bounding what the renderer can push over IPC.
 */
export const SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS = 16_000_000

/** Hard cap on a single dictation so the payload stays under the IPC limit. */
export const SPEECH_TRANSCRIPTION_MAX_DURATION_MS = 5 * 60 * 1000

/**
 * Single source of truth for whether the configured speech transport can run.
 * Keep transport-specific credential rules here so every UI surface and the
 * main-process service stay in sync as speech providers are added.
 *
 * Renderer settings redact provider apiKeys. Pass `credentialReady: true` when
 * a shared model connection reports usable Registry credentials for the bound
 * provider (OAuth subscriptions such as grok-subscription).
 */
export function isSpeechToTextConfigured(
  speechToText: Pick<KunSpeechToTextSettingsV1, 'enabled' | 'protocol' | 'baseUrl' | 'apiKey' | 'model'>,
  options: { credentialReady?: boolean } = {}
): boolean {
  const hasCredential = Boolean(speechToText.apiKey.trim()) || Boolean(options.credentialReady)
  if (speechToText.protocol === 'local-whisper' || speechToText.protocol === 'gemini-cli-audio') {
    return speechToText.enabled && Boolean(speechToText.model.trim())
  }
  if (speechToText.protocol === 'xai-stt' || speechToText.protocol === 'deepseek-asr') {
    return (
      speechToText.enabled &&
      Boolean(speechToText.baseUrl.trim()) &&
      hasCredential
    )
  }
  return (
    speechToText.enabled &&
    Boolean(speechToText.baseUrl.trim()) &&
    hasCredential &&
    Boolean(speechToText.model.trim())
  )
}

export type SpeechTranscriptionRequest = {
  /** Base64-encoded audio bytes (no data: prefix). */
  audioBase64: string
  /** Audio MIME type, e.g. "audio/wav". */
  mimeType: string
  /** Optional recording duration, for logging/limits. */
  durationMs?: number
  /** Resolved provider settings from the renderer, including inherited provider credentials. */
  speechToText?: KunSpeechToTextSettingsV1
}

export type SpeechTranscriptionResult =
  | {
      ok: true
      text: string
    }
  | {
      ok: false
      message: string
    }
