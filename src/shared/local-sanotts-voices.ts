/**
 * sanoTTS voice catalog for the Speak action.
 *
 * v1 ships the piperlite voices that share snt_voice.wasm. Locale `auto`
 * picks one of these; the user can override in settings.
 */
import type { AppLocale } from './app-locales'

export type LocalSanottsSpeechScript = 'han' | 'cyrillic' | 'devanagari'
export type LocalSanottsVoiceLanguage = 'en' | 'zh' | 'ru' | 'hi'
export type LocalSanottsVoiceFile = {
  fileName: string
  sizeBytes: number
  sha256: string
  maxBytes: number
}

export const LOCAL_SANOTTS_VOICES = [
  {
    id: 'amy',
    label: 'Amy',
    language: 'en',
    scripts: [] as const satisfies readonly LocalSanottsSpeechScript[],
    sizeBytes: 5_819_317,
    files: [
      {
        fileName: 'meta.json',
        sizeBytes: 1_197,
        sha256: '1c211821b231991138b4b383d2fcdc621c3ea72f9302297ffccbc398cded68f4',
        maxBytes: 16_384
      },
      {
        fileName: 'front_f32.bin',
        sizeBytes: 1_816_420,
        sha256: '9bc304dd1db30b17a2efb751795137c6d26f25aaf9c96f05bc1dec7c86e0ce23',
        maxBytes: 4 * 1024 * 1024
      },
      {
        fileName: 'dec_f32.bin',
        sizeBytes: 4_001_700,
        sha256: 'f520bcbf278607343e68170a06619a465a333d2d67476c6823d130e91580281b',
        maxBytes: 6 * 1024 * 1024
      }
    ]
  },
  {
    id: 'chinese',
    label: 'Chinese',
    language: 'zh',
    scripts: ['han'] as const satisfies readonly LocalSanottsSpeechScript[],
    sizeBytes: 6_000_266,
    files: [
      {
        fileName: 'meta.json',
        sizeBytes: 1_230,
        sha256: 'e73aecc065b1d7fc8b71c87ab676024ec27d5723222ef1dc66d74451b231ea71',
        maxBytes: 16_384
      },
      {
        fileName: 'front_f32.bin',
        sizeBytes: 3_438_220,
        sha256: '34e5d7498cd405e16039433d8ad09000643669c0bdfc91e0f81bcdf4e40bf218',
        maxBytes: 6 * 1024 * 1024
      },
      {
        fileName: 'dec_f32.bin',
        sizeBytes: 2_560_816,
        sha256: 'c994f980de6df513b83db65aeedea70cbad250e4d9fc96b1541a2e71301be4d0',
        maxBytes: 5 * 1024 * 1024
      }
    ]
  },
  {
    id: 'russian',
    label: 'Russian',
    language: 'ru',
    scripts: ['cyrillic'] as const satisfies readonly LocalSanottsSpeechScript[],
    sizeBytes: 3_136_002,
    files: [
      {
        fileName: 'meta.json',
        sizeBytes: 1_490,
        sha256: '77a0ec6dc0672026140f801b932e25d11107d1ec0a492513e4592540f8e30540',
        maxBytes: 16_384
      },
      {
        fileName: 'front_f16.bin',
        sizeBytes: 1_672_654,
        sha256: '0e842f691630397868ec68cb54d4e1a4e3fd98f0eb5fef10084323c2e3a0bae5',
        maxBytes: 4 * 1024 * 1024
      },
      {
        fileName: 'dec_f16.bin',
        sizeBytes: 1_461_858,
        sha256: 'e794c358df9ffa29ae5b4d24e4065463e872499df9f3b8fd4497e454f715cc40',
        maxBytes: 4 * 1024 * 1024
      }
    ]
  },
  {
    id: 'hindi',
    label: 'Hindi',
    language: 'hi',
    scripts: ['devanagari'] as const satisfies readonly LocalSanottsSpeechScript[],
    sizeBytes: 5_999_893,
    files: [
      {
        fileName: 'meta.json',
        sizeBytes: 1_225,
        sha256: '29230f0e67a81b4d5a853563fa57a4d39d93a7ee544d0a016ae381319004ea30',
        maxBytes: 16_384
      },
      {
        fileName: 'front_f32.bin',
        sizeBytes: 3_440_140,
        sha256: 'ae6f5ec73e7c15cb0bef5b0c51eaa9cb105bbcbefb2137c43e16bf89e591a75e',
        maxBytes: 6 * 1024 * 1024
      },
      {
        fileName: 'dec_f32.bin',
        sizeBytes: 2_558_528,
        sha256: '0df0527a221c840814f1e2795f3a65edf3f08e32beb5f235df3c65a79761f4c5',
        maxBytes: 5 * 1024 * 1024
      }
    ]
  }
] as const

export type LocalSanottsVoice = (typeof LOCAL_SANOTTS_VOICES)[number]
export type LocalSanottsVoiceId = LocalSanottsVoice['id']
export const LOCAL_SANOTTS_VOICE_AUTO_ID = 'auto' as const
export type LocalSanottsVoiceSetting = typeof LOCAL_SANOTTS_VOICE_AUTO_ID | LocalSanottsVoiceId
export const LOCAL_SANOTTS_DEFAULT_VOICE_ID: LocalSanottsVoiceId = 'amy'
export const LOCAL_SANOTTS_VOICE_LANGUAGES = ['en', 'zh', 'ru', 'hi'] as const

export function isLocalSanottsVoiceId(value: unknown): value is LocalSanottsVoiceId {
  return LOCAL_SANOTTS_VOICES.some((voice) => voice.id === value)
}

export function isLocalSanottsVoiceSetting(value: unknown): value is LocalSanottsVoiceSetting {
  return value === LOCAL_SANOTTS_VOICE_AUTO_ID || isLocalSanottsVoiceId(value)
}

export function localSanottsVoiceById(voiceId: unknown): LocalSanottsVoice {
  return (
    LOCAL_SANOTTS_VOICES.find((voice) => voice.id === voiceId)
    ?? LOCAL_SANOTTS_VOICES.find((voice) => voice.id === LOCAL_SANOTTS_DEFAULT_VOICE_ID)
    ?? LOCAL_SANOTTS_VOICES[0]
  )
}

export function localSanottsVoiceForLocale(locale: AppLocale): LocalSanottsVoiceId {
  if (locale === 'zh') return 'chinese'
  if (locale === 'ru') return 'russian'
  if (locale === 'hi') return 'hindi'
  return LOCAL_SANOTTS_DEFAULT_VOICE_ID
}

/** Persist `auto`; resolve a concrete voice only at speak time. */
export function resolveLocalSanottsVoiceId(
  voice: unknown,
  locale: AppLocale
): LocalSanottsVoiceId {
  if (isLocalSanottsVoiceId(voice)) return voice
  return localSanottsVoiceForLocale(locale)
}

export function localSanottsVoiceScripts(voiceId: unknown): readonly LocalSanottsSpeechScript[] {
  return localSanottsVoiceById(voiceId).scripts
}
