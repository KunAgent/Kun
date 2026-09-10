/**
 * Pure helpers for the Speak settings section: voice grouping, state labels and
 * the default sample line used by the voice preview.
 */
import {
  LOCAL_KOKORO_VOICES,
  type LocalKokoroVoice,
  type LocalKokoroVoiceAccent,
  type LocalKokoroVoiceId
} from '@shared/local-kokoro-voices'
import type {
  LocalKokoroAssetState,
  LocalKokoroDownloadSourceStatus
} from '@shared/local-kokoro'

export const SPEAK_PREVIEW_SAMPLE_TEXT = 'Hello, this is a test of the selected voice.'

export const SPEAK_ACCENT_FILTERS = ['all', 'en-us', 'en-gb'] as const
export type SpeakAccentFilter = (typeof SPEAK_ACCENT_FILTERS)[number]

export const SPEAK_SPEED_MIN = 0.5
export const SPEAK_SPEED_MAX = 2
export const SPEAK_SPEED_STEP = 0.05

export type SpeakVoiceGroup = {
  accent: LocalKokoroVoiceAccent
  voices: LocalKokoroVoice[]
}

/** Voices grouped by accent so the dropdown can render one optgroup each. */
export function speakVoiceGroups(filter: SpeakAccentFilter): SpeakVoiceGroup[] {
  const accents: LocalKokoroVoiceAccent[] = filter === 'all' ? ['en-us', 'en-gb'] : [filter]
  return accents
    .map((accent) => ({
      accent,
      voices: LOCAL_KOKORO_VOICES.filter((voice) => voice.accent === accent).map((voice) => ({ ...voice }))
    }))
    .filter((group) => group.voices.length > 0)
}

/** Voice ids visible under the current accent filter, in dropdown order. */
export function speakVisibleVoiceIds(filter: SpeakAccentFilter): LocalKokoroVoiceId[] {
  return speakVoiceGroups(filter).flatMap((group) => group.voices.map((voice) => voice.id))
}

export function speakAccentLabel(
  t: (key: string) => string,
  accent: LocalKokoroVoiceAccent | 'all'
): string {
  if (accent === 'all') return t('speakAccentAll')
  return accent === 'en-gb' ? t('speakAccentBritish') : t('speakAccentAmerican')
}

export function speakVoiceOptionLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  voice: LocalKokoroVoice,
  state: LocalKokoroAssetState
): string {
  const gender = voice.gender === 'male' ? t('speakVoiceMale') : t('speakVoiceFemale')
  const suffix = state === 'ready'
    ? ''
    : state === 'downloading'
      ? ` - ${t('speakVoiceStateDownloading')}`
      : ` - ${t('speakVoiceStateNotDownloaded')}`
  return `${voice.label} (${gender})${suffix}`
}

export function speakModelStateLabel(
  t: (key: string) => string,
  state: LocalKokoroAssetState
): string {
  if (state === 'ready') return t('speakModelStateReady')
  if (state === 'downloading') return t('speakModelStateDownloading')
  if (state === 'error') return t('speakModelStateError')
  return t('speakModelStateNotDownloaded')
}

export function speakQualityLabel(t: (key: string) => string, tier: string): string {
  if (tier === 'reference') return t('speakQualityReference')
  if (tier === 'strong') return t('speakQualityStrong')
  return t('speakQualityBalanced')
}

export function speakSourceStatusText(
  t: (key: string, options?: Record<string, unknown>) => string,
  status: LocalKokoroDownloadSourceStatus
): string {
  if (status.state === 'available') {
    return t('speakDownloadSourceAvailable', {
      source: status.label,
      ms: Math.max(1, Math.round(status.responseTimeMs ?? 0))
    })
  }
  return t('speakDownloadSourceUnavailable', {
    source: status.label,
    reason: status.message ?? t('speakDownloadSourceUnknownReason')
  })
}

/** Clamp a slider value onto the supported speed range. */
export function clampSpeakSpeed(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(SPEAK_SPEED_MAX, Math.max(SPEAK_SPEED_MIN, Math.round(value * 100) / 100))
}

export function formatSpeakSpeed(value: number): string {
  return `${clampSpeakSpeed(value).toFixed(2)}x`
}
