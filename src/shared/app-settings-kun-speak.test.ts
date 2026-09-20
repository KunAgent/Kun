import { describe, expect, it } from 'vitest'
import { defaultKunSpeakSettings } from './app-settings-kun-defaults'
import { normalizeKunSpeakSettings } from './app-settings-kun-media'
import { LOCAL_SANOTTS_VOICE_AUTO_ID } from './local-sanotts-voices'

describe('normalizeKunSpeakSettings', () => {
  it('keeps auto on disk instead of resolving a locale voice', () => {
    const settings = normalizeKunSpeakSettings({ voice: 'auto' })
    expect(settings.voice).toBe(LOCAL_SANOTTS_VOICE_AUTO_ID)
    expect(settings).not.toHaveProperty('model')
  })

  it('migrates leftover Kokoro fields onto auto', () => {
    const settings = normalizeKunSpeakSettings({
      model: 'kokoro-82m-int8',
      voice: 'af_heart',
      downloadSource: 'sufy'
    } as never)
    expect(settings.voice).toBe(LOCAL_SANOTTS_VOICE_AUTO_ID)
    expect(settings.downloadSource).toBe(defaultKunSpeakSettings().downloadSource)
  })

  it('preserves an explicit sanoTTS voice override', () => {
    expect(normalizeKunSpeakSettings({ voice: 'chinese' }).voice).toBe('chinese')
  })
})
