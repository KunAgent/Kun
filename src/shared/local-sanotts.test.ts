import { describe, expect, it } from 'vitest'
import {
  LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID,
  LOCAL_SANOTTS_RUNTIME_FILES,
  LOCAL_SANOTTS_RUNTIME_ID,
  LOCAL_SANOTTS_RUNTIME_REVISION,
  LOCAL_SANOTTS_VOICE_REVISION,
  LOCAL_SANOTTS_ESPEAK_REVISION,
  localSanottsRuntimeFileUrl,
  isLocalSanottsDownloadSourceId,
  localSanottsAssetUrl,
  localSanottsDownloadSourceById,
  localSanottsDownloadSourcesForRetry,
  localSanottsVoiceFileUrl
} from './local-sanotts'
import {
  LOCAL_SANOTTS_VOICE_AUTO_ID,
  LOCAL_SANOTTS_VOICES,
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

  it('counts complete voice assets including pinned offline Russian pronunciation sources', () => {
    for (const voice of LOCAL_SANOTTS_VOICES) {
      expect(voice.sizeBytes).toBe(voice.files.reduce((total, file) => total + file.sizeBytes, 0))
    }
    const russian = localSanottsVoiceById('russian')
    for (const fileName of ['ru_rules', 'ru_list', 'ru_emoji', 'ru_listx']) {
      expect(russian.files.some(file => file.fileName === fileName)).toBe(true)
      expect(localSanottsVoiceFileUrl('russian', fileName, 'hf-mirror')).toContain(
        `raw.githubusercontent.com/espeak-ng/espeak-ng/${LOCAL_SANOTTS_ESPEAK_REVISION}/dictsource/`
      )
    }
    expect(localSanottsVoiceFileUrl('russian', 'ru_listx', 'huggingface')).toContain('/extra/ru_listx')
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
    expect(LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID).toBe('github-pages')
    expect(localSanottsDownloadSourceById('missing').id).toBe(LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID)
    expect(localSanottsAssetUrl('huggingface', 'snt_g2p.wasm')).toContain('huggingface.co/ampixa/sanoTTS')
    expect(localSanottsVoiceFileUrl('chinese', 'meta.json', 'github-pages')).toBe(
      `https://raw.githubusercontent.com/Ampixa/sanoTTS/${LOCAL_SANOTTS_RUNTIME_REVISION}/web/voices/chinese/meta.json`
    )
    expect(localSanottsVoiceById('chinese').id).toBe('chinese')
    expect(LOCAL_SANOTTS_RUNTIME_ID).toBe('sanotts-runtime')
  })

  it('pins all source revisions and routes runtime away from voice-only mirrors', () => {
    for (const id of ['huggingface', 'hf-mirror', 'github-pages']) {
      expect(localSanottsRuntimeFileUrl('snt_g2p.wasm', id)).toContain(`/${LOCAL_SANOTTS_RUNTIME_REVISION}/web/`)
      expect(localSanottsDownloadSourcesForRetry(id, 'runtime').map(source => source.id)).toEqual(['github-pages'])
      expect(localSanottsVoiceFileUrl('amy', 'meta.json', id)).toContain(id === 'github-pages'
        ? `/${LOCAL_SANOTTS_RUNTIME_REVISION}/web/`
        : `/resolve/${LOCAL_SANOTTS_VOICE_REVISION}/web/`)
    }
  })

  it('tries the preferred source first and then the rest of the catalog', () => {
    expect(localSanottsDownloadSourcesForRetry('huggingface').map((source) => source.id)).toEqual([
      'huggingface',
      'hf-mirror',
      'github-pages'
    ])
    expect(localSanottsDownloadSourcesForRetry('github-pages').map((source) => source.id)).toEqual([
      'github-pages',
      'huggingface',
      'hf-mirror'
    ])
    expect(localSanottsDownloadSourcesForRetry('missing')[0]?.id).toBe('github-pages')
  })
})
