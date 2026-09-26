/**
 * Pure helpers for the Speak settings section: voice grouping, state labels and
 * the default sample line used by the voice preview.
 */
import {
  LOCAL_SANOTTS_VOICES,
  type LocalSanottsVoice,
  type LocalSanottsVoiceId,
  type LocalSanottsVoiceLanguage
} from '@shared/local-sanotts-voices'
import type {
  LocalSanottsAssetState,
  LocalSanottsDownloadSourceStatus
} from '@shared/local-sanotts'

export const SPEAK_PREVIEW_SAMPLES: Record<LocalSanottsVoiceLanguage, string> = {
  en: 'Hello, this is a test of the selected voice.',
  zh: '你好，这是当前声线的试听。',
  ru: 'Здравствуйте, это проверка выбранного голоса.',
  hi: 'नमस्ते, यह चयनित आवाज़ का परीक्षण है।'
}

export const SPEAK_PREVIEW_SAMPLE_TEXT = SPEAK_PREVIEW_SAMPLES.en

export const SPEAK_LANGUAGE_FILTERS = ['all', ...(['en', 'zh', 'ru', 'hi'] as const)] as const
export type SpeakLanguageFilter = (typeof SPEAK_LANGUAGE_FILTERS)[number]

export const SPEAK_SPEED_MIN = 0.5
export const SPEAK_SPEED_MAX = 2
export const SPEAK_SPEED_STEP = 0.05

export type SpeakVoiceGroup = {
  language: LocalSanottsVoiceLanguage
  voices: LocalSanottsVoice[]
}

/** Voices grouped by language so the dropdown can render one optgroup each. */
export function speakVoiceGroups(filter: SpeakLanguageFilter): SpeakVoiceGroup[] {
  const languages: LocalSanottsVoiceLanguage[] = filter === 'all' ? ['en', 'zh', 'ru', 'hi'] : [filter]
  return languages
    .map((language) => ({
      language,
      voices: LOCAL_SANOTTS_VOICES.filter((voice) => voice.language === language).map((voice) => ({ ...voice }))
    }))
    .filter((group) => group.voices.length > 0)
}

/** Voice ids visible under the current language filter, in dropdown order. */
export function speakVisibleVoiceIds(filter: SpeakLanguageFilter): LocalSanottsVoiceId[] {
  return speakVoiceGroups(filter).flatMap((group) => group.voices.map((voice) => voice.id))
}

export function speakLanguageLabel(
  t: (key: string) => string,
  language: LocalSanottsVoiceLanguage | 'all'
): string {
  if (language === 'all') return t('speakLanguageAll')
  if (language === 'zh') return t('speakLanguageZh')
  if (language === 'ru') return t('speakLanguageRu')
  if (language === 'hi') return t('speakLanguageHi')
  return t('speakLanguageEn')
}

export function speakPreviewSample(language: LocalSanottsVoiceLanguage): string {
  return SPEAK_PREVIEW_SAMPLES[language] || SPEAK_PREVIEW_SAMPLES.en
}

export function speakVoiceOptionLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  voice: LocalSanottsVoice,
  state: LocalSanottsAssetState
): string {
  const suffix = state === 'ready'
    ? ''
    : state === 'downloading'
      ? ` - ${t('speakVoiceStateDownloading')}`
      : ` - ${t('speakVoiceStateNotDownloaded')}`
  return `${voice.label}${suffix}`
}

export function speakModelStateLabel(
  t: (key: string) => string,
  state: LocalSanottsAssetState
): string {
  if (state === 'ready') return t('speakModelStateReady')
  if (state === 'downloading') return t('speakModelStateDownloading')
  if (state === 'error') return t('speakModelStateError')
  return t('speakModelStateNotDownloaded')
}

export function speakSourceStatusText(
  t: (key: string, options?: Record<string, unknown>) => string,
  status: LocalSanottsDownloadSourceStatus
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
