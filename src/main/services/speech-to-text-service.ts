import {
  resolveProviderProxyUrl,
  resolveKunSpeechToTextSettings,
  type AppSettingsV1,
  type KunSpeechToTextSettingsV1
} from '../../shared/app-settings'
import {
  isSpeechToTextConfigured,
  SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS,
  type SpeechTranscriptionRequest,
  type SpeechTranscriptionResult
} from '../../shared/speech-to-text'
import { describeNetworkError } from '../../../kun/src/adapters/tool/image-gen-tool-provider.js'
import {
  ensureFreshGrokCredentials,
  resolveGrokMediaOAuthApiKey
} from '../grok-auth'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import {
  speechTranscriptionPrompt,
  transcribeViaGeminiCliAudio
} from './gemini-cli-speech-to-text-service'
import { transcribeViaLocalWhisper } from './local-whisper-service'

const FILE_EXTENSION_BY_MIME: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac'
}

const XAI_FORMAT_LANGUAGE_CODES = new Set([
  'ar', 'cs', 'da', 'nl', 'en', 'fil', 'fr', 'de', 'hi', 'id', 'it', 'ja', 'ko',
  'mk', 'ms', 'fa', 'pl', 'pt', 'ro', 'ru', 'es', 'sv', 'th', 'tr', 'vi'
])

/**
 * Merge renderer-provided speech settings with Main's credential-projected
 * settings. Renderer `settings:get` redacts provider apiKeys, so an empty
 * request apiKey must fall back to the Registry-injected value.
 */
export function resolveSpeechToTextForTranscription(
  settings: AppSettingsV1,
  requestSpeechToText?: KunSpeechToTextSettingsV1
): KunSpeechToTextSettingsV1 {
  const resolved = resolveKunSpeechToTextSettings(settings)
  if (!requestSpeechToText) return resolved
  return {
    ...resolved,
    ...requestSpeechToText,
    apiKey: requestSpeechToText.apiKey.trim() || resolved.apiKey
  }
}

export async function requestSpeechTranscription(
  settings: AppSettingsV1,
  request: SpeechTranscriptionRequest,
  options: {
    fetchImpl?: typeof fetch
    localWhisperTranscriber?: (
      request: SpeechTranscriptionRequest,
      speechToText: KunSpeechToTextSettingsV1
    ) => Promise<string>
    geminiCliTranscriber?: (
      speechToText: KunSpeechToTextSettingsV1,
      request: SpeechTranscriptionRequest
    ) => Promise<string>
  } = {}
): Promise<SpeechTranscriptionResult> {
  const speechToText = resolveSpeechToTextForTranscription(settings, request.speechToText)
  if (!isSpeechToTextConfigured(speechToText)) {
    return { ok: false, message: describeSpeechConfigurationIssue(speechToText) }
  }
  if (!request.audioBase64 || request.audioBase64.length > SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS) {
    return { ok: false, message: 'audio payload is empty or too large' }
  }

  try {
    const proxyUrl = speechToText.protocol === 'local-whisper' ||
      speechToText.protocol === 'gemini-cli-audio'
      ? ''
      : resolveProviderProxyUrl(settings, speechToText.providerId)
    const fetchImpl = options.fetchImpl ?? ((input, init) =>
      fetchWithOptionalProxy(
        typeof input === 'string' || input instanceof URL ? input : input.url,
        init,
        proxyUrl
      ))
    let text: string
    switch (speechToText.protocol) {
      case 'local-whisper':
        text = await (options.localWhisperTranscriber ?? transcribeViaLocalWhisper)(request, speechToText)
        break
      case 'mimo-asr':
        text = await transcribeViaMimoAsr(speechToText, request, fetchImpl)
        break
      case 'xai-stt':
        text = await transcribeViaXaiStt(speechToText, request, fetchImpl, proxyUrl)
        break
      case 'gemini-audio':
        text = await transcribeViaGeminiAudio(speechToText, request, fetchImpl)
        break
      case 'gemini-cli-audio':
        text = await (options.geminiCliTranscriber ?? transcribeViaGeminiCliAudio)(speechToText, request)
        break
      default:
        text = await transcribeViaOpenAiTranscriptions(speechToText, request, fetchImpl)
        break
    }
    const trimmed = text.trim()
    if (!trimmed) return { ok: false, message: 'transcription result is empty' }
    return { ok: true, text: trimmed }
  } catch (error) {
    return { ok: false, message: describeTranscriptionError(error, speechToText.timeoutMs) }
  }
}

function describeSpeechConfigurationIssue(
  speechToText: Pick<KunSpeechToTextSettingsV1, 'enabled' | 'protocol' | 'baseUrl' | 'apiKey' | 'model'>
): string {
  if (!speechToText.enabled) return 'speech-to-text is disabled'
  if (
    speechToText.protocol !== 'xai-stt' &&
    !speechToText.model.trim()
  ) return 'speech-to-text model is not configured'
  if (
    speechToText.protocol !== 'local-whisper' &&
    speechToText.protocol !== 'gemini-cli-audio' &&
    !speechToText.baseUrl.trim()
  ) return 'speech-to-text API base URL is not configured'
  if (
    speechToText.protocol !== 'local-whisper' &&
    speechToText.protocol !== 'gemini-cli-audio' &&
    !speechToText.apiKey.trim()
  ) return 'speech-to-text API key is not configured'
  return 'speech-to-text provider is not configured'
}

/**
 * Xiaomi MiMo ASR rides the OpenAI-compatible chat completions endpoint:
 * the audio goes in as a base64 data URI inside an `input_audio` content
 * part and the transcript comes back as the assistant message content.
 */
async function transcribeViaMimoAsr(
  speechToText: KunSpeechToTextSettingsV1,
  request: SpeechTranscriptionRequest,
  fetchImpl: typeof fetch
): Promise<string> {
  const url = joinSpeechApiUrl(speechToText.baseUrl, 'chat/completions')
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${speechToText.apiKey}`,
      'api-key': speechToText.apiKey
    },
    body: JSON.stringify({
      model: speechToText.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: `data:${request.mimeType};base64,${request.audioBase64}`
              }
            }
          ]
        }
      ],
      asr_options: {
        language: speechToText.language || 'auto'
      },
      stream: false
    }),
    signal: AbortSignal.timeout(speechToText.timeoutMs)
  })
  const body = await response.text()
  if (!response.ok) throw new SpeechHttpError(response.status, body)
  const parsed = JSON.parse(body) as {
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const content = parsed.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : ''))
      .join('')
  }
  throw new Error('speech response has no transcript content')
}

/**
 * xAI's dedicated batch STT API accepts multipart audio at /v1/stt. It does
 * not take a chat model; the stored `grok-transcribe` id is a capability label.
 */
async function transcribeViaXaiStt(
  speechToText: KunSpeechToTextSettingsV1,
  request: SpeechTranscriptionRequest,
  fetchImpl: typeof fetch,
  proxyUrl: string
): Promise<string> {
  const fresh = await ensureFreshGrokCredentials(speechToText.apiKey, {
    fetcher: (input, init) => fetchImpl(input, init),
    proxyUrl
  })
  const credential = resolveGrokMediaOAuthApiKey(fresh.apiKey)
  const url = joinSpeechApiUrl(speechToText.baseUrl, 'stt')
  const audio = Buffer.from(request.audioBase64, 'base64')
  const form = new FormData()
  const language = speechToText.language.trim().toLowerCase()
  if (XAI_FORMAT_LANGUAGE_CODES.has(language)) {
    form.append('format', 'true')
    form.append('language', language)
  }
  const extension = FILE_EXTENSION_BY_MIME[request.mimeType.toLowerCase()] ?? 'wav'
  // xAI requires the file field to be appended after all option fields.
  form.append('file', new Blob([new Uint8Array(audio)], { type: request.mimeType }), `recording.${extension}`)
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      ...credential.headers,
      Authorization: `Bearer ${credential.apiKey}`
    },
    body: form,
    signal: AbortSignal.timeout(speechToText.timeoutMs)
  })
  const body = await response.text()
  if (!response.ok) throw new SpeechHttpError(response.status, body)
  const parsed = JSON.parse(body) as { text?: unknown }
  if (typeof parsed.text !== 'string') throw new Error('xAI speech response has no transcript text')
  return parsed.text
}

/**
 * Gemini's native GenerateContent API accepts small audio recordings inline.
 * This path is for API-key providers; Gemini CLI subscription OAuth uses the
 * separate Code Assist adapter above.
 */
async function transcribeViaGeminiAudio(
  speechToText: KunSpeechToTextSettingsV1,
  request: SpeechTranscriptionRequest,
  fetchImpl: typeof fetch
): Promise<string> {
  const url = joinSpeechApiUrl(
    speechToText.baseUrl,
    `models/${encodeURIComponent(speechToText.model)}:generateContent`
  )
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${speechToText.apiKey}`,
      'x-goog-api-key': speechToText.apiKey
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: speechTranscriptionPrompt(speechToText.language) },
          {
            inlineData: {
              mimeType: request.mimeType,
              data: request.audioBase64
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2_048
      }
    }),
    signal: AbortSignal.timeout(speechToText.timeoutMs)
  })
  const body = await response.text()
  if (!response.ok) throw new SpeechHttpError(response.status, body)
  const parsed = JSON.parse(body) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: unknown; thought?: unknown }>
      }
    }>
  }
  const text = parsed.candidates?.[0]?.content?.parts
    ?.filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
  if (typeof text !== 'string') throw new Error('Gemini speech response has no transcript text')
  return text
}

/** Standard OpenAI-style multipart upload to {baseUrl}/audio/transcriptions. */
async function transcribeViaOpenAiTranscriptions(
  speechToText: KunSpeechToTextSettingsV1,
  request: SpeechTranscriptionRequest,
  fetchImpl: typeof fetch
): Promise<string> {
  const url = joinSpeechApiUrl(speechToText.baseUrl, 'audio/transcriptions')
  const audio = Buffer.from(request.audioBase64, 'base64')
  const form = new FormData()
  const extension = FILE_EXTENSION_BY_MIME[request.mimeType.toLowerCase()] ?? 'wav'
  form.append('file', new Blob([new Uint8Array(audio)], { type: request.mimeType }), `recording.${extension}`)
  form.append('model', speechToText.model)
  form.append('response_format', 'json')
  if (speechToText.language && speechToText.language !== 'auto') {
    form.append('language', speechToText.language)
  }
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${speechToText.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(speechToText.timeoutMs)
  })
  const body = await response.text()
  if (!response.ok) throw new SpeechHttpError(response.status, body)
  const parsed = JSON.parse(body) as { text?: unknown }
  if (typeof parsed.text !== 'string') throw new Error('speech response has no transcript text')
  return parsed.text
}

export class SpeechHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`HTTP ${status}: ${body.slice(0, 500)}`)
  }
}

export function joinSpeechApiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${path}`
}

function describeTranscriptionError(error: unknown, timeoutMs: number): string {
  if (error instanceof SpeechHttpError) return error.message
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `speech request timed out after ${timeoutMs}ms`
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'speech request was canceled'
  }
  if (error instanceof SyntaxError) return 'speech response is not valid JSON'
  return describeNetworkError(error)
}
