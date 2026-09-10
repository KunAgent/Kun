import { describe, expect, it } from 'vitest'
import { LOCAL_KOKORO_VOICES } from '@shared/local-kokoro-voices'
import {
  SPEAK_SPEED_MAX,
  SPEAK_SPEED_MIN,
  clampSpeakSpeed,
  formatSpeakSpeed,
  speakAccentLabel,
  speakModelStateLabel,
  speakQualityLabel,
  speakSourceStatusText,
  speakVisibleVoiceIds,
  speakVoiceGroups,
  speakVoiceOptionLabel
} from './settings-section-speak-support'

const labels: Record<string, string> = {
  speakAccentAll: 'All accents',
  speakAccentAmerican: 'American',
  speakAccentBritish: 'British',
  speakVoiceMale: 'male',
  speakVoiceFemale: 'female',
  speakVoiceStateDownloading: 'downloading',
  speakVoiceStateNotDownloaded: 'not downloaded',
  speakModelStateReady: 'Ready',
  speakModelStateDownloading: 'Downloading',
  speakModelStateNotDownloaded: 'Not downloaded',
  speakModelStateError: 'Failed',
  speakQualityBalanced: 'Balanced',
  speakQualityStrong: 'Higher quality',
  speakQualityReference: 'Reference',
  speakDownloadSourceAvailable: '{{source}} reachable in {{ms}} ms',
  speakDownloadSourceUnavailable: '{{source}} unavailable: {{reason}}',
  speakDownloadSourceUnknownReason: 'no response'
}

const t = (key: string, options?: Record<string, unknown>): string =>
  (labels[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''))

describe('speakVoiceGroups', () => {
  it('groups every voice under its accent with American first', () => {
    const groups = speakVoiceGroups('all')

    expect(groups.map((group) => group.accent)).toEqual(['en-us', 'en-gb'])
    expect(groups.flatMap((group) => group.voices)).toHaveLength(LOCAL_KOKORO_VOICES.length)
  })

  it('narrows to one accent when filtered', () => {
    const groups = speakVoiceGroups('en-gb')

    expect(groups).toHaveLength(1)
    for (const voice of groups[0].voices) expect(voice.id.startsWith('b')).toBe(true)
  })

  it('exposes the filtered ids in dropdown order', () => {
    expect(speakVisibleVoiceIds('en-us')).toEqual(
      LOCAL_KOKORO_VOICES.filter((voice) => voice.accent === 'en-us').map((voice) => voice.id)
    )
  })
})

describe('label helpers', () => {
  it('labels accents, including the all filter', () => {
    expect(speakAccentLabel(t, 'all')).toBe('All accents')
    expect(speakAccentLabel(t, 'en-us')).toBe('American')
    expect(speakAccentLabel(t, 'en-gb')).toBe('British')
  })

  it('marks a voice that still needs downloading', () => {
    const voice = LOCAL_KOKORO_VOICES.find((candidate) => candidate.id === 'am_adam')!

    expect(speakVoiceOptionLabel(t, voice, 'ready')).toBe('Adam (male)')
    expect(speakVoiceOptionLabel(t, voice, 'not_downloaded')).toBe('Adam (male) - not downloaded')
    expect(speakVoiceOptionLabel(t, voice, 'downloading')).toBe('Adam (male) - downloading')
  })

  it('labels every model state and quality tier', () => {
    expect(speakModelStateLabel(t, 'ready')).toBe('Ready')
    expect(speakModelStateLabel(t, 'downloading')).toBe('Downloading')
    expect(speakModelStateLabel(t, 'not_downloaded')).toBe('Not downloaded')
    expect(speakModelStateLabel(t, 'error')).toBe('Failed')
    expect(speakQualityLabel(t, 'balanced')).toBe('Balanced')
    expect(speakQualityLabel(t, 'strong')).toBe('Higher quality')
    expect(speakQualityLabel(t, 'reference')).toBe('Reference')
  })

  it('describes reachable and unreachable download sources', () => {
    expect(speakSourceStatusText(t, {
      sourceId: 'huggingface',
      label: 'Hugging Face',
      url: 'https://example.invalid',
      state: 'available',
      responseTimeMs: 42
    })).toBe('Hugging Face reachable in 42 ms')

    expect(speakSourceStatusText(t, {
      sourceId: 'hf-mirror',
      label: 'HF-Mirror',
      url: 'https://example.invalid',
      state: 'unavailable'
    })).toBe('HF-Mirror unavailable: no response')
  })
})

describe('clampSpeakSpeed', () => {
  it('clamps to the supported range and rounds to two decimals', () => {
    expect(clampSpeakSpeed(0.1)).toBe(SPEAK_SPEED_MIN)
    expect(clampSpeakSpeed(9)).toBe(SPEAK_SPEED_MAX)
    expect(clampSpeakSpeed(1.234)).toBe(1.23)
    expect(clampSpeakSpeed(Number.NaN)).toBe(1)
  })

  it('formats the slider value with a multiplier suffix', () => {
    expect(formatSpeakSpeed(1)).toBe('1.00x')
    expect(formatSpeakSpeed(1.5)).toBe('1.50x')
  })
})
