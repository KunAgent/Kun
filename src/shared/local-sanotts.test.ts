import { describe, expect, it } from 'vitest'
import {
  LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID,
  LOCAL_SANOTTS_RUNTIME_FILES,
  LOCAL_SANOTTS_RUNTIME_ID,
  isLocalSanottsDownloadSourceId,
  localSanottsAssetUrl,
  localSanottsDownloadSourceById,
  localSanottsVoiceFileUrl
} from './local-sanotts'
import {
  LOCAL_SANOTTS_VOICE_AUTO_ID,
  isLocalSanottsVoiceId,
  isLocalSanottsVoiceSetting,
  localSanottsVoiceById,
  localSanottsVoiceForLocale,
  resolveLocalSanottsVoiceId
} from './local-sanotts-voices'

describe('sanoTTS catalog', () => {
  it('pins a checksum for every runtime file', () => {
    expect(LOCAL_SANOTTS_RUNTIME_FILES.length).toBe(5)
    for (const file of LOCAL_SANOTTS_RUNTIME_FILES) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(file.sizeBytes).toBeGreaterThan(0)
      expect(file.maxBytes).toBeGreaterThan(file.sizeBytes)
    }
  })

  it('maps UI locale onto a shipped voice without writing auto away', () => {
    expect(localSanottsVoiceForLocale('zh')).toBe('chinese')
    expect(localSanottsVoiceForLocale('ru')).toBe('russian')
    expect(localSanottsVoiceForLocale('hi')).toBe('hindi')
    expect(localSanottsVoiceForLocale('en')).toBe('amy')
    expect(localSanottsVoiceForLocale('ja')).toBe('amy')
    expect(resolveLocalSanottsVoiceId(LOCAL_SANOTTS_VOICE_AUTO_ID, 'zh')).toBe('chinese')
    expect(resolveLocalSanottsVoiceId('amy', 'zh')).toBe('amy')
    expect(isLocalSanottsVoiceSetting('auto')).toBe(true)
    expect(isLocalSanottsVoiceId('auto')).toBe(false)
  })

  it('builds download URLs from the selected mirror', () => {
    expect(isLocalSanottsDownloadSourceId('github-pages')).toBe(true)
    expect(localSanottsDownloadSourceById('missing').id).toBe(LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID)
    expect(localSanottsAssetUrl('huggingface', 'snt_g2p.wasm')).toContain('huggingface.co/ampixa/sanoTTS')
    expect(localSanottsVoiceFileUrl('chinese', 'meta.json', 'github-pages')).toBe(
      'https://ampixa.github.io/sanoTTS/voices/chinese/meta.json'
    )
    expect(localSanottsVoiceById('chinese').id).toBe('chinese')
    expect(LOCAL_SANOTTS_RUNTIME_ID).toBe('sanotts-runtime')
  })
})
