/**
 * Shared contract for the bundled local Kokoro text-to-speech engine.
 *
 * Model weights and per-voice style vectors are downloaded on demand into the
 * user data directory; nothing here ships inside the application bundle.
 */
import {
  LOCAL_KOKORO_DEFAULT_VOICE_ID,
  type LocalKokoroVoiceId
} from './local-kokoro-voices'

export const LOCAL_KOKORO_PROVIDER_ID = 'local-kokoro'
export const LOCAL_KOKORO_PROTOCOL = 'local-kokoro'
export const LOCAL_KOKORO_MODEL_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX'
/** Kokoro always renders 24 kHz mono float32 PCM. */
export const LOCAL_KOKORO_SAMPLE_RATE = 24_000
/** Style vector width consumed by the `style` input. */
export const LOCAL_KOKORO_STYLE_DIMENSION = 256
/**
 * Voice files hold one style vector per token count, so a chunk may never
 * exceed this many tokens (including the leading/trailing boundary token).
 */
export const LOCAL_KOKORO_MAX_TOKENS = 510

export const LOCAL_KOKORO_DOWNLOAD_SOURCES = [
  {
    id: 'huggingface',
    label: 'Hugging Face',
    baseUrl: `https://huggingface.co/${LOCAL_KOKORO_MODEL_REPO}/resolve/main/`
  },
  {
    id: 'hf-mirror',
    label: 'HF-Mirror',
    baseUrl: `https://hf-mirror.com/${LOCAL_KOKORO_MODEL_REPO}/resolve/main/`
  },
  {
    id: 'hf-sufy',
    label: 'HF CDN',
    baseUrl: `https://hf-cdn.sufy.com/${LOCAL_KOKORO_MODEL_REPO}/resolve/main/`
  }
] as const
export const LOCAL_KOKORO_DEFAULT_DOWNLOAD_SOURCE_ID = 'huggingface'

export const LOCAL_KOKORO_INT8_MODEL_ID = 'kokoro-82m-int8'
export const LOCAL_KOKORO_FP16_MODEL_ID = 'kokoro-82m-fp16'
export const LOCAL_KOKORO_FP32_MODEL_ID = 'kokoro-82m-fp32'
export const LOCAL_KOKORO_DEFAULT_MODEL_ID = LOCAL_KOKORO_INT8_MODEL_ID

export const LOCAL_KOKORO_MODELS = [
  {
    id: LOCAL_KOKORO_INT8_MODEL_ID,
    label: 'Kokoro 82M (int8)',
    shortName: 'int8',
    fileName: 'model_quantized.onnx',
    remotePath: 'onnx/model_quantized.onnx',
    sha256: 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478',
    sizeBytes: 92_361_116,
    maxBytes: 120 * 1024 * 1024,
    license: 'Apache-2.0',
    source: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    resourceTier: 'low',
    resourceEstimate: {
      memory: '250-450 MB',
      cpuThreads: '1-4'
    },
    qualityTier: 'balanced'
  },
  {
    id: LOCAL_KOKORO_FP16_MODEL_ID,
    label: 'Kokoro 82M (fp16)',
    shortName: 'fp16',
    fileName: 'model_fp16.onnx',
    remotePath: 'onnx/model_fp16.onnx',
    sha256: 'ba4527a874b42b21e35f468c10d326fdff3c7fc8cac1f85e9eb6c0dfc35c334a',
    sizeBytes: 163_234_740,
    maxBytes: 200 * 1024 * 1024,
    license: 'Apache-2.0',
    source: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    resourceTier: 'medium',
    resourceEstimate: {
      memory: '300-550 MB',
      cpuThreads: '1-4'
    },
    qualityTier: 'strong'
  },
  {
    id: LOCAL_KOKORO_FP32_MODEL_ID,
    label: 'Kokoro 82M (fp32)',
    shortName: 'fp32',
    fileName: 'model.onnx',
    remotePath: 'onnx/model.onnx',
    sha256: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb',
    sizeBytes: 325_532_232,
    maxBytes: 380 * 1024 * 1024,
    license: 'Apache-2.0',
    source: 'onnx-community/Kokoro-82M-v1.0-ONNX',
    resourceTier: 'high',
    resourceEstimate: {
      memory: '700-1100 MB',
      cpuThreads: '1-4'
    },
    qualityTier: 'reference'
  }
] as const

/**
 * Model tier to recommend for a CPU architecture.
 *
 * The int8 model is dynamically quantized, and its integer matmul kernels are
 * slower than the fp16 graph on arm64 despite the smaller download - measured
 * at 1.4x realtime against 2.5x on an Apple Silicon machine. On x64 the CPU
 * provider casts fp16 back to fp32 before computing, so the quantized graph
 * stays the better default there.
 */
export function recommendedLocalKokoroModelId(arch: unknown): LocalKokoroModelId {
  return arch === 'arm64' ? LOCAL_KOKORO_FP16_MODEL_ID : LOCAL_KOKORO_INT8_MODEL_ID
}

export type LocalKokoroModel = (typeof LOCAL_KOKORO_MODELS)[number]
export type LocalKokoroModelId = LocalKokoroModel['id']
export type LocalKokoroResourceTier = LocalKokoroModel['resourceTier']
export type LocalKokoroQualityTier = LocalKokoroModel['qualityTier']
export type LocalKokoroDownloadSource = (typeof LOCAL_KOKORO_DOWNLOAD_SOURCES)[number]
export type LocalKokoroDownloadSourceId = LocalKokoroDownloadSource['id']

export type LocalKokoroAssetState = 'not_downloaded' | 'downloading' | 'ready' | 'error'

export type LocalKokoroModelStatus = {
  modelId: LocalKokoroModelId
  label: string
  fileName: string
  source: string
  license: string
  sha256: string
  sizeBytes: number
  maxBytes: number
  resourceTier: LocalKokoroResourceTier
  resourceEstimate: {
    memory: string
    cpuThreads: string
  }
  qualityTier: LocalKokoroQualityTier
  recommended?: boolean
  state: LocalKokoroAssetState
  path?: string
  downloadedBytes?: number
  totalBytes?: number
  speedBytesPerSecond?: number
  message?: string
}

export type LocalKokoroVoiceStatus = {
  voiceId: LocalKokoroVoiceId
  sizeBytes: number
  state: LocalKokoroAssetState
  path?: string
  downloadedBytes?: number
  message?: string
}

/**
 * Progress for the model download plus the voice that will be spoken. Voices
 * are three orders of magnitude smaller, so they share one progress channel.
 */
export type LocalKokoroModelProgress = {
  /** Set when `asset` is "model". */
  modelId?: LocalKokoroModelId
  /** Set when `asset` is "voice". */
  voiceId?: LocalKokoroVoiceId
  asset: 'model' | 'voice'
  downloadedBytes: number
  totalBytes?: number
  percent?: number
  speedBytesPerSecond?: number
}

export type LocalKokoroDownloadSourceStatus = {
  sourceId: LocalKokoroDownloadSourceId
  label: string
  url: string
  state: 'available' | 'unavailable'
  httpStatus?: number
  responseTimeMs?: number
  message?: string
}

export type LocalKokoroDownloadSourceStatusResult = {
  modelId: LocalKokoroModelId
  sources: LocalKokoroDownloadSourceStatus[]
}

export type LocalKokoroModelDownloadResult =
  | {
      ok: true
      status: LocalKokoroModelStatus
    }
  | {
      ok: false
      message: string
      status?: LocalKokoroModelStatus
    }

export type LocalKokoroModelDeleteResult = LocalKokoroModelDownloadResult

export type LocalKokoroReadinessResult = {
  modelId: LocalKokoroModelId
  voiceId: LocalKokoroVoiceId
  model: LocalKokoroModelStatus
  voice: LocalKokoroVoiceStatus
  ready: boolean
}

export function isLocalKokoroModelId(value: unknown): value is LocalKokoroModelId {
  return LOCAL_KOKORO_MODELS.some((model) => model.id === value)
}

export function isLocalKokoroDownloadSourceId(value: unknown): value is LocalKokoroDownloadSourceId {
  return LOCAL_KOKORO_DOWNLOAD_SOURCES.some((source) => source.id === value)
}

export function localKokoroModelById(modelId: unknown): LocalKokoroModel {
  return (
    LOCAL_KOKORO_MODELS.find((model) => model.id === modelId)
    ?? LOCAL_KOKORO_MODELS.find((model) => model.id === LOCAL_KOKORO_DEFAULT_MODEL_ID)
    ?? LOCAL_KOKORO_MODELS[0]
  )
}

export function localKokoroDownloadSourceById(sourceId: unknown): LocalKokoroDownloadSource {
  return (
    LOCAL_KOKORO_DOWNLOAD_SOURCES.find((source) => source.id === sourceId)
    ?? LOCAL_KOKORO_DOWNLOAD_SOURCES.find((source) => source.id === LOCAL_KOKORO_DEFAULT_DOWNLOAD_SOURCE_ID)
    ?? LOCAL_KOKORO_DOWNLOAD_SOURCES[0]
  )
}

/** Absolute download URL for a repository-relative asset path. */
export function localKokoroAssetUrl(sourceId: unknown, remotePath: string): string {
  return `${localKokoroDownloadSourceById(sourceId).baseUrl}${remotePath}`
}

export function localKokoroModelUrl(modelId: unknown, sourceId: unknown): string {
  return localKokoroAssetUrl(sourceId, localKokoroModelById(modelId).remotePath)
}

export function localKokoroVoiceRemotePath(voiceId: LocalKokoroVoiceId): string {
  return `voices/${voiceId}.bin`
}

export function localKokoroVoiceUrl(voiceId: LocalKokoroVoiceId, sourceId: unknown): string {
  return localKokoroAssetUrl(sourceId, localKokoroVoiceRemotePath(voiceId))
}

export { LOCAL_KOKORO_DEFAULT_VOICE_ID }
export type { LocalKokoroVoiceId }
