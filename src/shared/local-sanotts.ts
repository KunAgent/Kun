/**
 * Shared contract for the on-demand local sanoTTS engine.
 *
 * Runtime WASM and per-voice weights download into the user data directory;
 * nothing here ships inside the application bundle.
 */
import type { LocalSanottsVoiceId } from './local-sanotts-voices'

export const LOCAL_SANOTTS_PROVIDER_ID = 'local-sanotts'
export const LOCAL_SANOTTS_PROTOCOL = 'local-sanotts'
export const LOCAL_SANOTTS_MODEL_REPO = 'ampixa/sanoTTS'
export const LOCAL_SANOTTS_RUNTIME_ID = 'sanotts-runtime'
export const LOCAL_SANOTTS_RUNTIME_LABEL = 'sanoTTS runtime'
/** Piperlite voices in this build all render 22.05 kHz mono PCM. */
export const LOCAL_SANOTTS_SAMPLE_RATE = 22_050
/** Official piperlite cap: about 20 seconds of 22.05 kHz audio. */
export const LOCAL_SANOTTS_MAX_SAMPLES = LOCAL_SANOTTS_SAMPLE_RATE * 20
export const LOCAL_SANOTTS_MAX_PHONEME_IDS = 1_024
export const LOCAL_SANOTTS_LICENSE = 'GPL-3.0 (G2P) / MIT (neural runtime)'

export const LOCAL_SANOTTS_DOWNLOAD_SOURCES = [
  {
    id: 'huggingface',
    label: 'Hugging Face',
    baseUrl: `https://huggingface.co/${LOCAL_SANOTTS_MODEL_REPO}/resolve/main/web/`
  },
  {
    id: 'hf-mirror',
    label: 'HF-Mirror',
    baseUrl: `https://hf-mirror.com/${LOCAL_SANOTTS_MODEL_REPO}/resolve/main/web/`
  },
  {
    id: 'github-pages',
    label: 'GitHub Pages',
    baseUrl: 'https://ampixa.github.io/sanoTTS/'
  }
] as const
export const LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID = 'github-pages'

export const LOCAL_SANOTTS_RUNTIME_FILES = [
  {
    fileName: 'snt_g2p.js',
    sha256: 'a08606599e58b6526962ce5f3d9423ee62a468eeeedcb3ce52920d020def5824',
    sizeBytes: 72_546,
    maxBytes: 200_000
  },
  {
    fileName: 'snt_g2p.wasm',
    sha256: 'f5931a7d1c5e367dfd3bc44a1f3855ec91e90216f9ccce5c8d2d2f376a5bbc47',
    sizeBytes: 345_921,
    maxBytes: 1_000_000
  },
  {
    fileName: 'snt_g2p.data',
    sha256: '9e3ca4238e83c828cb143129b044b2dd288ae77b4755583a03efe34f4bef3e98',
    sizeBytes: 3_189_887,
    maxBytes: 5_000_000
  },
  {
    fileName: 'snt_voice.js',
    sha256: '73745db50516d6052802994a02dd8d0e3e27fcd26efa8cbe7e849d7ee5634266',
    sizeBytes: 10_406,
    maxBytes: 50_000
  },
  {
    fileName: 'snt_voice.wasm',
    sha256: 'cdcfa5bf3ec162797d8556be7b90ce334f88666141956a1650846bdff9517d1c',
    sizeBytes: 40_787,
    maxBytes: 200_000
  }
] as const

export const LOCAL_SANOTTS_RUNTIME_SIZE_BYTES = LOCAL_SANOTTS_RUNTIME_FILES.reduce(
  (total, file) => total + file.sizeBytes,
  0
)

export type LocalSanottsRuntimeFile = (typeof LOCAL_SANOTTS_RUNTIME_FILES)[number]
export type LocalSanottsDownloadSource = (typeof LOCAL_SANOTTS_DOWNLOAD_SOURCES)[number]
export type LocalSanottsDownloadSourceId = LocalSanottsDownloadSource['id']
export type LocalSanottsAssetState = 'not_downloaded' | 'downloading' | 'ready' | 'error'

export type LocalSanottsRuntimeStatus = {
  runtimeId: typeof LOCAL_SANOTTS_RUNTIME_ID
  label: string
  source: string
  license: string
  sizeBytes: number
  state: LocalSanottsAssetState
  path?: string
  downloadedBytes?: number
  totalBytes?: number
  speedBytesPerSecond?: number
  message?: string
}

export type LocalSanottsVoiceStatus = {
  voiceId: LocalSanottsVoiceId
  sizeBytes: number
  state: LocalSanottsAssetState
  path?: string
  downloadedBytes?: number
  message?: string
}

export type LocalSanottsAssetProgress = {
  runtimeId?: typeof LOCAL_SANOTTS_RUNTIME_ID
  voiceId?: LocalSanottsVoiceId
  asset: 'runtime' | 'voice'
  downloadedBytes: number
  totalBytes?: number
  percent?: number
  speedBytesPerSecond?: number
}

export type LocalSanottsDownloadSourceStatus = {
  sourceId: LocalSanottsDownloadSourceId
  label: string
  url: string
  state: 'available' | 'unavailable'
  httpStatus?: number
  responseTimeMs?: number
  message?: string
}

export type LocalSanottsDownloadSourceStatusResult = {
  sources: LocalSanottsDownloadSourceStatus[]
}

export type LocalSanottsRuntimeDownloadResult =
  | { ok: true; status: LocalSanottsRuntimeStatus }
  | { ok: false; message: string; status?: LocalSanottsRuntimeStatus }

export type LocalSanottsRuntimeDeleteResult = LocalSanottsRuntimeDownloadResult

export type LocalSanottsReadinessResult = {
  voiceId: LocalSanottsVoiceId
  runtime: LocalSanottsRuntimeStatus
  voice: LocalSanottsVoiceStatus
  ready: boolean
}

export function isLocalSanottsDownloadSourceId(value: unknown): value is LocalSanottsDownloadSourceId {
  return LOCAL_SANOTTS_DOWNLOAD_SOURCES.some((source) => source.id === value)
}

export function localSanottsDownloadSourceById(sourceId: unknown): LocalSanottsDownloadSource {
  return (
    LOCAL_SANOTTS_DOWNLOAD_SOURCES.find((source) => source.id === sourceId)
    ?? LOCAL_SANOTTS_DOWNLOAD_SOURCES.find((source) => source.id === LOCAL_SANOTTS_DEFAULT_DOWNLOAD_SOURCE_ID)
    ?? LOCAL_SANOTTS_DOWNLOAD_SOURCES[0]
  )
}

/** Preferred source first, then the rest of the catalog in listed order. */
export function localSanottsDownloadSourcesForRetry(preferredId: unknown): LocalSanottsDownloadSource[] {
  const preferred = localSanottsDownloadSourceById(preferredId)
  return [preferred, ...LOCAL_SANOTTS_DOWNLOAD_SOURCES.filter((source) => source.id !== preferred.id)]
}

export function localSanottsAssetUrl(sourceId: unknown, remotePath: string): string {
  return `${localSanottsDownloadSourceById(sourceId).baseUrl}${remotePath}`
}

export function localSanottsRuntimeFileUrl(fileName: string, sourceId: unknown): string {
  return localSanottsAssetUrl(sourceId, fileName)
}

export function localSanottsVoiceRemotePath(voiceId: LocalSanottsVoiceId, fileName: string): string {
  return `voices/${voiceId}/${fileName}`
}

export function localSanottsVoiceFileUrl(
  voiceId: LocalSanottsVoiceId,
  fileName: string,
  sourceId: unknown
): string {
  return localSanottsAssetUrl(sourceId, localSanottsVoiceRemotePath(voiceId, fileName))
}

export type { LocalSanottsVoiceId }
