import { describe, expect, it } from 'vitest'
import {
  upstreamDeepSeekFimCompletionsUrl,
  upstreamOpenAiCustomEndpointUrl,
  upstreamOpenAiChatCompletionsUrl,
  upstreamOpenAiModelsUrl
} from './openai-compat-url'

describe('openai compatible url builders', () => {
  it('keeps root base URLs on the OpenAI v1 path', () => {
    expect(upstreamOpenAiChatCompletionsUrl('https://api.example.com')).toBe(
      'https://api.example.com/v1/chat/completions'
    )
    expect(upstreamOpenAiModelsUrl('https://api.example.com')).toBe('https://api.example.com/v1/models')
  })

  it('appends chat completions suffix even when the base URL already looks like an endpoint', () => {
    expect(upstreamOpenAiChatCompletionsUrl('https://api.example.com/custom/chat/completions')).toBe(
      'https://api.example.com/custom/chat/completions/v1/chat/completions'
    )
    expect(upstreamOpenAiChatCompletionsUrl('https://api.example.com/custom/chat/completions/')).toBe(
      'https://api.example.com/custom/chat/completions/v1/chat/completions'
    )
  })

  it('appends chat completions suffix before query strings outside custom endpoint mode', () => {
    const endpoint = 'https://api.example.com/openai/deployments/m/chat/completions?api-version=2026-01-01'

    expect(
      upstreamOpenAiChatCompletionsUrl(endpoint)
    ).toBe(
      'https://api.example.com/openai/deployments/m/chat/completions/v1/chat/completions?api-version=2026-01-01'
    )
  })

  it('keeps custom full endpoint URLs unchanged without known suffix matching', () => {
    expect(upstreamOpenAiCustomEndpointUrl('https://api.example.com/custom/chat/completions')).toBe(
      'https://api.example.com/custom/chat/completions'
    )
    expect(
      upstreamOpenAiCustomEndpointUrl('https://api.example.com/openai/deployments/m/chat/completions?api-version=2026-01-01')
    ).toBe('https://api.example.com/openai/deployments/m/chat/completions?api-version=2026-01-01')
    expect(upstreamOpenAiCustomEndpointUrl('https://api.example.com/custom-path')).toBe(
      'https://api.example.com/custom-path'
    )
    expect(upstreamOpenAiCustomEndpointUrl('https://api.example.com/custom-path/?api-version=2026-01-01')).toBe(
      'https://api.example.com/custom-path?api-version=2026-01-01'
    )
  })

  it('appends models suffix without stripping endpoint-looking paths', () => {
    expect(upstreamOpenAiModelsUrl('https://api.example.com/api/v3/chat/completions')).toBe(
      'https://api.example.com/api/v3/chat/completions/v1/models'
    )
  })

  it('keeps DeepSeek beta FIM completions behavior', () => {
    expect(upstreamDeepSeekFimCompletionsUrl('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/beta/completions'
    )
    expect(upstreamDeepSeekFimCompletionsUrl('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/beta/completions'
    )
  })
})
