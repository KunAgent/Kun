import {
  DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  SPEECH_TO_TEXT_PROTOCOLS
} from '@shared/app-settings'
import {
  LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID,
  type LocalWhisperDownloadSourceStatus,
  type LocalWhisperModelStatus
} from '@shared/local-whisper'


export const SPEECH_LANGUAGE_OPTIONS: readonly string[] = ['', 'zh', 'en', 'ja', 'ko']
export const CUSTOM_SPEECH_PROTOCOLS = SPEECH_TO_TEXT_PROTOCOLS.filter(
  (protocol) => protocol !== 'local-whisper' && protocol !== 'gemini-cli-audio'
)

/**
 * 0.5s 440Hz mono 16kHz sine tone — enough for the ASR endpoint to accept the
 * request and prove auth + base URL + model are wired correctly.
 */
export function buildTestToneWavBase64(): string {
  const sampleRate = 16_000
  const sampleCount = sampleRate / 2
  const dataBytes = sampleCount * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < sampleCount; i++) {
    view.setInt16(44 + i * 2, Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), true)
  }
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

export const DEFAULT_SPEECH_TO_TEXT = {
  enabled: false,
  providerId: '',
  protocol: DEFAULT_SPEECH_TO_TEXT_PROTOCOL,
  baseUrl: '',
  apiKey: '',
  model: '',
  localWhisperDownloadSource: LOCAL_WHISPER_DEFAULT_DOWNLOAD_SOURCE_ID,
  language: '',
  timeoutMs: 60000
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return ''
  const mb = bytes / 1024 / 1024
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
}

export function formatTransferBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${Math.max(1, Math.round(bytes))} B`
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`
  }
  const mb = bytes / 1024 / 1024
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
}

export function formatTransferRate(bytesPerSecond: number | undefined, pendingLabel: string): string {
  const formatted = formatTransferBytes(bytesPerSecond)
  return formatted ? `${formatted}/s` : pendingLabel
}

export function speechProtocolLabel(t: (key: string) => string, protocol: string): string {
  if (protocol === 'deepseek-asr') return t('speechProtocolDeepSeekAsr')
  if (protocol === 'mimo-asr') return t('speechProtocolMimoAsr')
  if (protocol === 'xai-stt') return t('speechProtocolXaiStt')
  if (protocol === 'gemini-audio') return t('speechProtocolGeminiAudio')
  if (protocol === 'gemini-cli-audio') return t('speechProtocolGeminiCliAudio')
  if (protocol === 'local-whisper') return t('speechProtocolLocalWhisper')
  return t('speechProtocolOpenAi')
}

export function supportsSpeechProvider(item: {
  kind?: string
  speech?: { protocol?: string }
}): boolean {
  if (!item.speech) return false
  if (item.speech.protocol === 'gemini-cli-audio') return item.kind === 'gemini-cli-api'
  return (
    item.kind !== 'cursor-sdk' &&
    item.kind !== 'agent-sdk' &&
    item.kind !== 'antigravity-cli'
  )
}

export function localWhisperQualityLabel(t: (key: string) => string, tier: string): string {
  return t(`speechToTextLocalQuality_${tier}`)
}

export function localWhisperSourceStatusText(
  t: (key: string, values?: Record<string, unknown>) => string,
  status: LocalWhisperDownloadSourceStatus
): string {
  if (status.state === 'available') {
    return t('speechToTextLocalDownloadSourceAvailable', {
      source: status.label,
      ms: status.responseTimeMs ?? 0
    })
  }
  return t('speechToTextLocalDownloadSourceUnavailable', {
    source: status.label,
    message: status.message || (status.httpStatus ? `HTTP ${status.httpStatus}` : t('speechToTextLocalDownloadSourceUnknownError'))
  })
}

export function localWhisperModelStateLabel(t: (key: string) => string, state: LocalWhisperModelStatus['state'] | undefined): string {
  if (state === 'ready') return t('speechToTextLocalModelStateReady')
  if (state === 'downloading') return t('speechToTextLocalModelStateDownloading')
  return t('speechToTextLocalModelStateMissing')
}
