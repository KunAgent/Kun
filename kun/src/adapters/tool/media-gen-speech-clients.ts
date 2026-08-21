import type { GeneratedMedia, MusicGenClient, MusicGenRequest, SpeechGenClient, SpeechGenRequest } from './media-gen-tool-provider.js'
import { ImageGenHttpError } from './image-gen-tool-provider.js'
import {
  apiUrl,
  assertMiniMaxOk,
  audioExtension,
  audioMimeType,
  bufferFromHex,
  createMediaFetch,
  requestJson,
  requestResponse,
  withTimeout
} from './media-gen-client-support.js'
import type { MiniMaxBaseResponse } from './media-gen-client-support.js'

type MiniMaxAudioPayload = {
  data?: { audio?: string }
  base_resp?: MiniMaxBaseResponse
}

type MimoSpeechPayload = {
  choices?: Array<{
    message?: {
      audio?: {
        data?: string
      }
    }
  }>
}


export function createSpeechGenClient(config: {
  protocol?: string
  baseUrl?: string
  apiKey?: string
  proxyUrl?: string
}): SpeechGenClient {
  // Media generation shares the provider-level model proxy with chat requests.
  const fetchImpl = createMediaFetch(config.proxyUrl)
  if (config.protocol === 'minimax-t2a') return new MiniMaxSpeechClient(config.baseUrl!, config.apiKey!, fetchImpl)
  if (config.protocol === 'mimo-tts') return new MimoSpeechClient(config.baseUrl!, config.apiKey!, fetchImpl)
  return new OpenAiCompatSpeechClient(config.baseUrl!, config.apiKey!, fetchImpl)
}

export function createMusicGenClient(config: {
  protocol?: string
  baseUrl?: string
  apiKey?: string
  proxyUrl?: string
}): MusicGenClient {
  return new MiniMaxMusicClient(config.baseUrl!, config.apiKey!, createMediaFetch(config.proxyUrl))
}


export class OpenAiCompatSpeechClient implements SpeechGenClient {
  readonly id = 'openai-speech'
  private readonly endpointUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.endpointUrl = apiUrl(baseUrl, '/v1/audio/speech')
  }

  async generate(request: SpeechGenRequest): Promise<GeneratedMedia> {
    const response = await requestResponse(this.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        input: request.text,
        voice: request.voice || 'alloy',
        response_format: request.format
      }),
      signal: withTimeout(request.signal, request.timeoutMs)
    }, request, this.fetchImpl)
    if (!response.ok) throw new ImageGenHttpError(response.status, await response.text())
    const mimeType = response.headers.get('content-type')?.split(';')[0] || audioMimeType(request.format)
    return {
      data: Buffer.from(await response.arrayBuffer()),
      mimeType,
      extension: audioExtension(request.format)
    }
  }
}

export class MiniMaxSpeechClient implements SpeechGenClient {
  readonly id = 'minimax-t2a'
  private readonly endpointUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.endpointUrl = apiUrl(baseUrl, '/v1/t2a_v2')
  }

  async generate(request: SpeechGenRequest): Promise<GeneratedMedia> {
    const voiceId = request.voice || 'male-qn-qingse'
    const payload = await requestJson<MiniMaxAudioPayload>(this.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        text: request.text,
        output_format: 'hex',
        voice_setting: {
          voice_id: voiceId,
          speed: 1,
          vol: 1,
          pitch: 0
        },
        audio_setting: {
          format: request.format,
          sample_rate: request.format === 'mp3' ? 32_000 : 44_100,
          bitrate: 128_000,
          channel: 1
        }
      }),
      signal: withTimeout(request.signal, request.timeoutMs)
    }, request, this.fetchImpl)
    assertMiniMaxOk(payload.base_resp, 'MiniMax speech provider')
    const audio = payload.data?.audio
    if (!audio) throw new Error('MiniMax speech provider returned no audio data')
    return {
      data: bufferFromHex(audio),
      mimeType: audioMimeType(request.format),
      extension: audioExtension(request.format)
    }
  }
}

export class MimoSpeechClient implements SpeechGenClient {
  readonly id = 'mimo-tts'
  private readonly endpointUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.endpointUrl = apiUrl(baseUrl, '/v1/chat/completions')
  }

  async generate(request: SpeechGenRequest): Promise<GeneratedMedia> {
    const messages = [
      ...(request.style ? [{ role: 'user', content: request.style }] : []),
      { role: 'assistant', content: request.text }
    ]
    const payload = await requestJson<MimoSpeechPayload>(this.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'api-key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        messages,
        audio: {
          format: request.format,
          ...(request.voice ? { voice: request.voice } : {})
        }
      }),
      signal: withTimeout(request.signal, request.timeoutMs)
    }, request, this.fetchImpl)
    const audio = payload.choices?.[0]?.message?.audio?.data
    if (!audio) throw new Error('MiMo speech provider returned no audio data')
    return {
      data: Buffer.from(audio, 'base64'),
      mimeType: audioMimeType(request.format),
      extension: audioExtension(request.format)
    }
  }
}

export class MiniMaxMusicClient implements MusicGenClient {
  readonly id = 'minimax-music'
  private readonly endpointUrl: string

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.endpointUrl = apiUrl(baseUrl, '/v1/music_generation')
  }

  async generate(request: MusicGenRequest): Promise<GeneratedMedia> {
    const payload = await requestJson<MiniMaxAudioPayload>(this.endpointUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        ...(request.prompt ? { prompt: request.prompt } : {}),
        ...(request.lyrics ? { lyrics: request.lyrics } : {}),
        output_format: 'hex',
        audio_setting: {
          format: request.format,
          sample_rate: 44_100,
          bitrate: 256_000
        },
        lyrics_optimizer: request.lyricsOptimizer ?? (!request.lyrics && request.instrumental !== true),
        ...(request.instrumental !== undefined ? { is_instrumental: request.instrumental } : {}),
        ...(request.referenceAudioUrl ? { audio_url: request.referenceAudioUrl } : {})
      }),
      signal: withTimeout(request.signal, request.timeoutMs)
    }, request, this.fetchImpl)
    assertMiniMaxOk(payload.base_resp, 'MiniMax music provider')
    const audio = payload.data?.audio
    if (!audio) throw new Error('MiniMax music provider returned no audio data')
    return {
      data: bufferFromHex(audio),
      mimeType: audioMimeType(request.format),
      extension: audioExtension(request.format)
    }
  }
}
