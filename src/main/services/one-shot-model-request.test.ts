import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildModelEndpointUrl,
  buildOneShotModelRequest,
  extractOneShotResponseContent,
  extractOneShotSseContent,
  oneShotModelRequest
} from './one-shot-model-request'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildModelEndpointUrl', () => {
  it('appends the family path to a plain base URL', () => {
    expect(buildModelEndpointUrl('https://api.deepseek.com', 'chat_completions'))
      .toBe('https://api.deepseek.com/v1/chat/completions')
    expect(buildModelEndpointUrl('https://api.deepseek.com/', 'messages'))
      .toBe('https://api.deepseek.com/v1/messages')
    expect(buildModelEndpointUrl('https://api.deepseek.com', 'responses'))
      .toBe('https://api.deepseek.com/v1/responses')
  })

  it('does not double-append /v1 and normalizes a /beta suffix', () => {
    expect(buildModelEndpointUrl('https://api.deepseek.com/v1', 'chat_completions'))
      .toBe('https://api.deepseek.com/v1/chat/completions')
    expect(buildModelEndpointUrl('https://api.anthropic.com/beta', 'messages'))
      .toBe('https://api.anthropic.com/v1/messages')
  })

  it('treats a custom full endpoint URL as explicit (no path appended)', () => {
    expect(buildModelEndpointUrl('https://example.com/custom/path?token=1', 'custom_endpoint'))
      .toBe('https://example.com/custom/path?token=1')
    expect(buildModelEndpointUrl('https://example.com/custom/path/', 'custom_endpoint'))
      .toBe('https://example.com/custom/path')
  })
})

describe('buildOneShotModelRequest', () => {
  it('builds an OpenAI chat completions body', () => {
    const request = buildOneShotModelRequest({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      endpointFormat: 'chat_completions',
      model: 'deepseek-v4-pro',
      systemPrompt: 'Translate.',
      userText: 'hello'
    })
    expect(request?.url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(request?.expectsSse).toBe(false)
    expect(request?.headers.Authorization).toBe('Bearer sk-test')
    expect(request?.body).toMatchObject({
      model: 'deepseek-v4-pro',
      messages: [
        { role: 'system', content: 'Translate.' },
        { role: 'user', content: 'hello' }
      ],
      max_tokens: 1600
    })
  })

  it('builds an Anthropic messages body with x-api-key and version headers', () => {
    const request = buildOneShotModelRequest({
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant',
      endpointFormat: 'messages',
      model: 'claude-sonnet-4-5',
      systemPrompt: 'Translate.',
      userText: 'hello'
    })
    expect(request?.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request?.headers['x-api-key']).toBe('sk-ant')
    expect(request?.headers['anthropic-version']).toBe('2023-06-01')
    expect(request?.body).toMatchObject({
      model: 'claude-sonnet-4-5',
      system: 'Translate.',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 1600
    })
  })

  it('builds an OpenAI responses body with instructions/input fields', () => {
    const request = buildOneShotModelRequest({
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-oai',
      endpointFormat: 'responses',
      model: 'gpt-5.2',
      systemPrompt: 'Translate.',
      userText: 'hello'
    })
    expect(request?.url).toBe('https://api.openai.com/v1/responses')
    expect(request?.expectsSse).toBe(false)
    expect(request?.body).toMatchObject({
      model: 'gpt-5.2',
      instructions: 'Translate.',
      input: 'hello',
      max_output_tokens: 1600
    })
  })
})

describe('extractOneShotResponseContent', () => {
  it('reads chat completions choices', () => {
    expect(extractOneShotResponseContent(
      JSON.stringify({ choices: [{ message: { content: 'done' } }] }),
      'chat_completions'
    )).toBe('done')
  })

  it('reads anthropic messages content blocks', () => {
    expect(extractOneShotResponseContent(
      JSON.stringify({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
      'messages'
    )).toBe('ab')
  })

  it('reads responses output_text and output items', () => {
    expect(extractOneShotResponseContent(
      JSON.stringify({ output_text: 'answer' }),
      'responses'
    )).toBe('answer')
    expect(extractOneShotResponseContent(
      JSON.stringify({ output: [{ content: [{ text: 'x' }, { output_text: 'y' }] }] }),
      'responses'
    )).toBe('xy')
  })
})

describe('extractOneShotSseContent', () => {
  it('collects deltas and falls back to final text when no deltas stream', () => {
    const withDeltas = [
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      '',
      'data: {"type":"response.output_text.done","text":"Hello!"}',
      '',
      'data: [DONE]',
      ''
    ].join('\n')
    expect(extractOneShotSseContent(withDeltas)).toBe('Hello')
    const doneOnly = 'data: {"type":"response.output_text.done","text":"Hello!"}\n\ndata: [DONE]\n\n'
    expect(extractOneShotSseContent(doneOnly)).toBe('Hello!')
  })

  it('throws the stream error message on failure events', () => {
    const raw = 'data: {"type":"response.failed","response":{"error":{"message":"boom"}}}\n\n'
    expect(() => extractOneShotSseContent(raw)).toThrow('boom')
  })
})

describe('oneShotModelRequest', () => {
  it('posts to the endpoint and returns extracted text', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'translated' } }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await oneShotModelRequest({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-x',
      endpointFormat: 'chat_completions',
      model: 'm',
      systemPrompt: 's',
      userText: 'u',
      timeoutMs: 5000
    })
    expect(result).toEqual({ ok: true, text: 'translated' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('returns the HTTP failure instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    const result = await oneShotModelRequest({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-x',
      endpointFormat: 'chat_completions',
      model: 'm',
      systemPrompt: 's',
      userText: 'u',
      timeoutMs: 5000
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('404')
  })
})
