import { describe, expect, it } from 'vitest'
import { LOCAL_SANOTTS_VOICES } from '@shared/local-sanotts-voices'
import {
  SPEAK_SPEED_MAX,
  SPEAK_SPEED_MIN,
  clampSpeakSpeed,
  formatSpeakSpeed,
  speakLanguageLabel,
  speakModelStateLabel,
  speakSourceStatusText,
  speakVisibleVoiceIds,
  speakVoiceGroups,
  speakVoiceOptionLabel
} from './settings-section-speak-support'

const labels: Record<string, string> = {
  speakLanguageAll: 'All languages',
  speakLanguageEn: 'English',
  speakLanguageZh: 'Chinese',
  speakLanguageRu: 'Russian',
  speakLanguageHi: 'Hindi',
  speakVoiceStateDownloading: 'downloading',
  speakVoiceStateNotDownloaded: 'not downloaded',
  speakModelStateReady: 'Ready',
  speakModelStateDownloading: 'Downloading',
  speakModelStateNotDownloaded: 'Not downloaded',
  speakModelStateError: 'Failed',
  speakDownloadSourceAvailable: '{{source}} reachable in {{ms}} ms',
  speakDownloadSourceUnavailable: '{{source}} unavailable: {{reason}}',
  speakDownloadSourceUnknownReason: 'no response'
}

const t = (key: string, options?: Record<string, unknown>): string =>
  (labels[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''))

describe('speakVoiceGroups', () => {
  it('groups every voice under its language with English first', () => {
    const groups = speakVoiceGroups('all')

    expect(groups.map((group) => group.language)).toEqual(['en', 'zh', 'ru', 'hi'])
    expect(groups.flatMap((group) => group.voices)).toHaveLength(LOCAL_SANOTTS_VOICES.length)
  })

  it('narrows to one language when filtered', () => {
    const groups = speakVoiceGroups('zh')

    expect(groups).toHaveLength(1)
    for (const voice of groups[0].voices) expect(voice.language).toBe('zh')
  })

  it('exposes the filtered ids in dropdown order', () => {
    expect(speakVisibleVoiceIds('en')).toEqual(
      LOCAL_SANOTTS_VOICES.filter((voice) => voice.language === 'en').map((voice) => voice.id)
    )
  })
})

describe('label helpers', () => {
  it('labels languages, including the all filter', () => {
    expect(speakLanguageLabel(t, 'all')).toBe('All languages')
    expect(speakLanguageLabel(t, 'en')).toBe('English')
    expect(speakLanguageLabel(t, 'zh')).toBe('Chinese')
  })

  it('marks a voice that still needs downloading', () => {
    const voice = LOCAL_SANOTTS_VOICES.find((candidate) => candidate.id === 'amy')!

    expect(speakVoiceOptionLabel(t, voice, 'ready')).toBe('Amy')
    expect(speakVoiceOptionLabel(t, voice, 'not_downloaded')).toBe('Amy - not downloaded')
    expect(speakVoiceOptionLabel(t, voice, 'downloading')).toBe('Amy - downloading')
  })

  it('labels every asset state', () => {
    expect(speakModelStateLabel(t, 'ready')).toBe('Ready')
    expect(speakModelStateLabel(t, 'downloading')).toBe('Downloading')
    expect(speakModelStateLabel(t, 'not_downloaded')).toBe('Not downloaded')
    expect(speakModelStateLabel(t, 'error')).toBe('Failed')
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
