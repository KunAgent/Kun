import { describe, expect, it } from 'vitest'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { isSpeechToTextConfigured } from '../../shared/speech-to-text'
import {
  requestSpeechTranscription,
  resolveSpeechToTextForTranscription
} from './speech-to-text-service'

const AUDIO_BASE64 = Buffer.from('fake-wav-bytes').toString('base64')

function settingsWithSpeech(overrides: Record<string, unknown> = {}): AppSettingsV1 {
  return {
    agents: {
      kun: {
        speechToText: {
          enabled: true,
          providerId: '',
          protocol: 'mimo-asr',
          baseUrl: 'https://speech.example.test/v1',
          apiKey: 'sk-speech',
          model: 'mimo-v2.5-asr',
          language: '',
          timeoutMs: 30000,
          ...overrides
        }
      }
    }
  } as unknown as AppSettingsV1
}

type RecordedRequest = { url: string; init: RequestInit }

function fakeFetch(body: unknown, status = 200): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof fetch
  return { fetchImpl, requests }
}

describe('speech-to-text service', () => {
  it('rejects when the speech provider is not configured', async () => {
    const result = await requestSpeechTranscription(settingsWithSpeech({ apiKey: '' }), {
      audioBase64: AUDIO_BASE64,
      mimeType: 'audio/wav'
    })
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not configured') })
  })

  it('reports configuration state from enabled/baseUrl/apiKey/model', () => {
    expect(isSpeechToTextConfigured({ enabled: true, protocol: 'mimo-asr', baseUrl: 'x', apiKey: 'y', model: 'z' })).toBe(true)
    expect(isSpeechToTextConfigured({ enabled: false, protocol: 'mimo-asr', baseUrl: 'x', apiKey: 'y', model: 'z' })).toBe(false)
    expect(isSpeechToTextConfigured({ enabled: true, protocol: 'mimo-asr', baseUrl: '', apiKey: 'y', model: 'z' })).toBe(false)
    expect(isSpeechToTextConfigured({ enabled: true, protocol: 'local-whisper', baseUrl: '', apiKey: '', model: 'whisper-small-q5_1' })).toBe(true)
    expect(isSpeechToTextConfigured({ enabled: true, protocol: 'xai-stt', baseUrl: 'x', apiKey: 'y', model: '' })).toBe(true)
    expect(isSpeechToTextConfigured({ enabled: true, protocol: 'gemini-cli-audio', baseUrl: '', apiKey: '', model: 'gemini-2.5-flash' })).toBe(true)
    expect(isSpeechToTextConfigured(
      { enabled: true, protocol: 'xai-stt', baseUrl: 'https://api.x.ai/v1', apiKey: '', model: 'grok-transcribe' },
      { credentialReady: true }
    )).toBe(true)
    expect(isSpeechToTextConfigured(
      { enabled: true, protocol: 'xai-stt', baseUrl: 'https://api.x.ai/v1', apiKey: '', model: 'grok-transcribe' },
      { credentialReady: false }
    )).toBe(false)
  })

  it('falls back to Registry-projected apiKey when the renderer payload is redacted', async () => {
    const { fetchImpl, requests } = fakeFetch({ text: 'hello from Grok' })
    const result = await requestSpeechTranscription(
      settingsWithSpeech({
        protocol: 'xai-stt',
        baseUrl: 'https://api.x.ai/v1',
        apiKey: 'registry-oauth-json',
        model: 'grok-transcribe'
      }),
      {
        audioBase64: AUDIO_BASE64,
        mimeType: 'audio/wav',
        speechToText: {
          enabled: true,
          providerId: 'grok-subscription',
          protocol: 'xai-stt',
          baseUrl: 'https://api.x.ai/v1',
          apiKey: '',
          model: 'grok-transcribe',
          localWhisperDownloadSource: 'huggingface',
          language: '',
          timeoutMs: 30000
        }
      },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: 'hello from Grok' })
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer registry-oauth-json')
    expect(resolveSpeechToTextForTranscription(
      settingsWithSpeech({
        protocol: 'xai-stt',
        baseUrl: 'https://api.x.ai/v1',
        apiKey: 'registry-oauth-json',
        model: 'grok-transcribe'
      }),
      {
        enabled: true,
        providerId: 'grok-subscription',
        protocol: 'xai-stt',
        baseUrl: 'https://api.x.ai/v1',
        apiKey: '',
        model: 'grok-transcribe',
        localWhisperDownloadSource: 'huggingface',
        language: '',
        timeoutMs: 30000
      }
    ).apiKey).toBe('registry-oauth-json')
  })

  it('transcribes via MiMo ASR chat completions with a base64 data URI', async () => {
    const { fetchImpl, requests } = fakeFetch({
      choices: [{ message: { content: ' 你好，世界 ' } }]
    })
    const result = await requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav', durationMs: 1200 },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: '你好，世界' })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://speech.example.test/v1/chat/completions')
    const payload = JSON.parse(String(requests[0].init.body))
    expect(payload.model).toBe('mimo-v2.5-asr')
    expect(payload.asr_options).toEqual({ language: 'auto' })
    expect(payload.messages[0].content[0]).toEqual({
      type: 'input_audio',
      input_audio: { data: `data:audio/wav;base64,${AUDIO_BASE64}` }
    })
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-speech')
  })

  it('uses renderer-provided resolved speech settings with inherited provider credentials', async () => {
    const { fetchImpl, requests } = fakeFetch({
      choices: [{ message: { content: ' 你好 ' } }]
    })
    const result = await requestSpeechTranscription(
      settingsWithSpeech({ enabled: false, apiKey: '' }),
      {
        audioBase64: AUDIO_BASE64,
        mimeType: 'audio/wav',
        speechToText: {
          enabled: true,
          providerId: 'xiaomi-token-plan',
          protocol: 'mimo-asr',
          baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
          apiKey: 'tp-provider',
          model: 'mimo-v2.5-asr',
          localWhisperDownloadSource: 'huggingface',
          language: 'zh',
          timeoutMs: 30000
        }
      },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: '你好' })
    expect(requests[0].url).toBe('https://token-plan-cn.xiaomimimo.com/v1/chat/completions')
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tp-provider')
    expect(headers['api-key']).toBe('tp-provider')
    expect(JSON.parse(String(requests[0].init.body)).model).toBe('mimo-v2.5-asr')
  })

  it('passes the configured language hint to MiMo ASR', async () => {
    const { fetchImpl, requests } = fakeFetch({ choices: [{ message: { content: 'hi' } }] })
    await requestSpeechTranscription(
      settingsWithSpeech({ language: 'zh' }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )
    expect(JSON.parse(String(requests[0].init.body)).asr_options).toEqual({ language: 'zh' })
  })

  it('transcribes via OpenAI-compatible audio/transcriptions multipart upload', async () => {
    const { fetchImpl, requests } = fakeFetch({ text: 'hello world' })
    const result = await requestSpeechTranscription(
      settingsWithSpeech({ protocol: 'openai-transcriptions', model: 'whisper-1' }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: 'hello world' })
    expect(requests[0].url).toBe('https://speech.example.test/v1/audio/transcriptions')
    const form = requests[0].init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('transcribes via the dedicated xAI STT multipart endpoint', async () => {
    const { fetchImpl, requests } = fakeFetch({ text: 'hello from Grok' })
    const result = await requestSpeechTranscription(
      settingsWithSpeech({
        protocol: 'xai-stt',
        baseUrl: 'https://api.x.ai/v1',
        apiKey: 'xai-key',
        model: 'grok-transcribe',
        language: 'en'
      }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: 'hello from Grok' })
    expect(requests[0].url).toBe('https://api.x.ai/v1/stt')
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer xai-key')
    const form = requests[0].init.body as FormData
    expect(form.get('format')).toBe('true')
    expect(form.get('language')).toBe('en')
    expect(form.get('file')).toBeInstanceOf(Blob)
    expect(form.get('model')).toBeNull()
  })

  it('does not send unsupported xAI formatting languages', async () => {
    const { fetchImpl, requests } = fakeFetch({ text: '你好' })
    await requestSpeechTranscription(
      settingsWithSpeech({
        protocol: 'xai-stt',
        baseUrl: 'https://api.x.ai/v1',
        apiKey: 'xai-key',
        model: 'grok-transcribe',
        language: 'zh'
      }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )
    const form = requests[0].init.body as FormData
    expect(form.get('format')).toBeNull()
    expect(form.get('language')).toBeNull()
  })

  it('transcribes via Gemini native inline audio', async () => {
    const { fetchImpl, requests } = fakeFetch({
      candidates: [{
        content: {
          parts: [
            { text: 'internal thought', thought: true },
            { text: ' Gemini transcript ' }
          ]
        }
      }]
    })
    const result = await requestSpeechTranscription(
      settingsWithSpeech({
        protocol: 'gemini-audio',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-key',
        model: 'gemini-2.5-flash',
        language: 'zh'
      }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: 'Gemini transcript' })
    expect(requests[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    )
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('gemini-key')
    const payload = JSON.parse(String(requests[0].init.body))
    expect(payload.contents[0].parts[0].text).toContain('expected language is zh')
    expect(payload.contents[0].parts[1]).toEqual({
      inlineData: {
        mimeType: 'audio/wav',
        data: AUDIO_BASE64
      }
    })
  })

  it('uses Gemini CLI OAuth transcription without a base URL or API key', async () => {
    const result = await requestSpeechTranscription(
      settingsWithSpeech({
        providerId: 'gemini-cli-subscription',
        protocol: 'gemini-cli-audio',
        baseUrl: '',
        apiKey: '',
        model: 'gemini-2.5-flash'
      }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      {
        geminiCliTranscriber: async (speechToText, request) => {
          expect(speechToText.model).toBe('gemini-2.5-flash')
          expect(request.audioBase64).toBe(AUDIO_BASE64)
          return ' Gemini CLI transcript '
        }
      }
    )

    expect(result).toEqual({ ok: true, text: 'Gemini CLI transcript' })
  })

  it('transcribes local Whisper without requiring a base URL or API key', async () => {
    const result = await requestSpeechTranscription(
      settingsWithSpeech({
        providerId: 'local-whisper',
        protocol: 'local-whisper',
        baseUrl: '',
        apiKey: '',
        model: 'whisper-small-q5_1'
      }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      {
        localWhisperTranscriber: async (_request, speechToText) => {
          expect(speechToText.protocol).toBe('local-whisper')
          expect(speechToText.model).toBe('whisper-small-q5_1')
          return ' local transcript '
        }
      }
    )

    expect(result).toEqual({ ok: true, text: 'local transcript' })
  })

  it('surfaces upstream HTTP errors as failure messages', async () => {
    const { fetchImpl } = fakeFetch({ error: { message: 'invalid api key' } }, 401)
    const result = await requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('HTTP 401') })
  })

  it('rejects an empty transcription result', async () => {
    const { fetchImpl } = fakeFetch({ choices: [{ message: { content: '   ' } }] })
    const result = await requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('empty') })
  })

  it('considers deepseek-asr configured without requiring a model name', () => {
    expect(isSpeechToTextConfigured({
      enabled: true,
      protocol: 'deepseek-asr',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-ds',
      model: ''
    })).toBe(true)
  })

  it('transcribes via DeepSeek /v1/tools/asr multipart file-only request', async () => {
    const { fetchImpl, requests } = fakeFetch({ text: '  DeepSeek ASR result  ' })
    const result = await requestSpeechTranscription(
      settingsWithSpeech({
        protocol: 'deepseek-asr',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-ds',
        model: ''
      }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: 'DeepSeek ASR result' })
    expect(requests[0].url).toBe('https://api.deepseek.com/v1/tools/asr')
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.Authorization ?? headers.authorization).toBe('Bearer sk-ds')
    const form = requests[0].init.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('file')).toBeTruthy()
    expect(form.get('model')).toBeNull()
  })
})
