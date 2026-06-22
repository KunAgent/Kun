import { describe, expect, it } from 'vitest'
import { CompatModelClient } from './compat-model-client.js'
import type { ModelCapabilityMetadata } from '../../contracts/capabilities.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

// Claude Pro/Max OAuth tokens (sk-ant-oat...) must present as the Claude Code
// client: Bearer-only auth (no x-api-key) plus an exact identity system block.
// Plain console API keys (sk-ant-api...) keep the standard Anthropic auth and
// get no identity block.

const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude."

type CapturedCall = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function messagesCapabilities(): (model: string) => ModelCapabilityMetadata {
  return (model) => ({
    id: model,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text'],
    endpointFormat: 'messages'
  })
}

function capturingFetch(calls: CapturedCall[]): typeof fetch {
  return (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({
      url: String(url),
      headers: init.headers,
      body: JSON.parse(init.body) as Record<string, unknown>
    })
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }) as unknown as typeof fetch
}

function request(model: string): ModelRequest {
  return {
    threadId: 't1',
    turnId: 'u1',
    model,
    systemPrompt: 'You are a helpful assistant.',
    prefix: [],
    history: [],
    tools: [],
    abortSignal: new AbortController().signal
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function newClient(apiKey: string, calls: CapturedCall[]): CompatModelClient {
  return new CompatModelClient({
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey,
    model: 'claude-opus-4-8',
    endpointFormat: 'messages',
    nonStreaming: true,
    fetchImpl: capturingFetch(calls),
    modelCapabilities: messagesCapabilities()
  })
}

describe('CompatModelClient Anthropic OAuth (Claude Pro/Max)', () => {
  it('drops x-api-key and prepends the Claude Code identity for sk-ant-oat tokens', async () => {
    const calls: CapturedCall[] = []
    await drain(newClient('sk-ant-oat01-secret', calls).stream(request('claude-opus-4-8')))

    // Bearer-only auth: x-api-key must be absent for OAuth tokens.
    expect(calls[0].headers.Authorization).toBe('Bearer sk-ant-oat01-secret')
    expect(calls[0].headers['x-api-key']).toBeUndefined()
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01')

    // The first system block must be the exact Claude Code identity line,
    // ahead of the caller's own system prompt.
    const system = calls[0].body.system as Array<{ type: string; text: string }>
    expect(system[0]).toEqual({ type: 'text', text: CLAUDE_CODE_IDENTITY })
    expect(system[1].text).toContain('You are a helpful assistant.')
  })

  it('emits the full Claude Code disguise when serve.headers are injected', async () => {
    // Simulates the kun-process default-client path: the bare access token is
    // the apiKey and anthropicRequestHeaders() are passed through as
    // config.headers (serve.headers). The outgoing request must carry the
    // complete disguise that the verified openclaw client sends.
    const calls: CapturedCall[] = []
    const client = new CompatModelClient({
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant-oat01-secret',
      model: 'claude-opus-4-8',
      endpointFormat: 'messages',
      nonStreaming: true,
      headers: {
        'anthropic-beta': 'oauth-2025-04-20,claude-code-20250219,fine-grained-tool-streaming-2025-05-14',
        'User-Agent': 'claude-cli/2.1.75',
        'x-app': 'cli'
      },
      fetchImpl: capturingFetch(calls),
      modelCapabilities: messagesCapabilities()
    })

    await drain(client.stream(request('claude-opus-4-8')))

    const h = calls[0].headers
    expect(h.Authorization).toBe('Bearer sk-ant-oat01-secret')
    expect(h['x-api-key']).toBeUndefined()
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(h['anthropic-beta']).toContain('oauth-2025-04-20')
    expect(h['anthropic-beta']).toContain('claude-code-20250219')
    expect(h['User-Agent']).toBe('claude-cli/2.1.75')
    expect(h['x-app']).toBe('cli')
    const system = calls[0].body.system as Array<{ type: string; text: string }>
    expect(system[0]).toEqual({ type: 'text', text: CLAUDE_CODE_IDENTITY })
  })

  it('keeps x-api-key and omits the identity block for plain console API keys', async () => {
    const calls: CapturedCall[] = []
    await drain(newClient('sk-ant-api03-secret', calls).stream(request('claude-opus-4-8')))

    expect(calls[0].headers['x-api-key']).toBe('sk-ant-api03-secret')
    expect(calls[0].headers.Authorization).toBe('Bearer sk-ant-api03-secret')
    const system = calls[0].body.system as Array<{ type: string; text: string }>
    expect(system[0].text).not.toBe(CLAUDE_CODE_IDENTITY)
    expect(system[0].text).toContain('You are a helpful assistant.')
  })
})
