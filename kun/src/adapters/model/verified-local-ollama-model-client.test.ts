import { describe, expect, it, vi } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { GoogleWorkspaceModelClient } from '../../gmail/model-data-policy.js'
import { VerifiedLocalOllamaModelClient } from './verified-local-ollama-model-client.js'
import { CompatModelClient } from './compat-model-client.js'

const response = () => new Response(JSON.stringify({ id: 'reply', model: 'qwen3:4b',
  choices: [{ message: { content: 'Local email summary' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })
const request = (patch: Partial<ModelRequest> = {}): ModelRequest => ({ threadId: 'mail-thread', turnId: 'turn',
  providerId: 'kun-gmail-local', model: 'qwen3:4b', history: [], prefix: [], tools: [], stream: false,
  maxRetryAttempts: 0, abortSignal: new AbortController().signal, ...patch })
async function collect(stream: AsyncIterable<ModelStreamChunk>) {
  const result: ModelStreamChunk[] = []
  for await (const chunk of stream) result.push(chunk)
  return result
}
const fixture = () => {
  const directFetch = vi.fn(async () => response())
  const assertCurrent = vi.fn()
  const client = new VerifiedLocalOllamaModelClient({ origin: 'http://127.0.0.1:40123', model: 'qwen3:4b', directFetch, assertCurrent })
  return { client, directFetch, assertCurrent }
}

describe('host-proven local Ollama Gmail model', () => {
  it('uses only the supplied physical transport and exact app-owned numeric loopback endpoint', async () => {
    const f = fixture()
    const names = ['gmail_connect', 'gmail_search', 'gmail_read', 'gmail_send']
    const tool = (name: string, providerId = 'gmail', providerKind: 'built-in' | 'mcp' = 'built-in') => ({
      name, description: name, inputSchema: { type: 'object' }, providerId, providerKind })
    await collect(f.client.stream(request({ tools: [...names.map((name) => tool(name)), tool('bash', 'builtin'),
      tool('web_search', 'builtin'), tool('gmail_read', 'gmail', 'mcp')] })))
    expect(f.directFetch).toHaveBeenCalledOnce()
    const [url, options] = f.directFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:40123/v1/chat/completions')
    expect(options.redirect).toBe('error')
    expect(JSON.parse(String(options.body))).toMatchObject({ model: 'qwen3:4b', store: false })
    expect(JSON.parse(String(options.body)).tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual([...names].sort())
    expect(f.assertCurrent).toHaveBeenCalled()
  })

  it('rejects arbitrary localhost aliases, LAN hosts and a cloud-model selection', () => {
    for (const origin of ['http://localhost:40123', 'http://192.168.1.4:40123', 'https://ollama.com',
      'http://127.0.0.1:40123/?route=cloud', 'http://127.0.0.1:40123/v1']) {
      expect(() => new VerifiedLocalOllamaModelClient({ origin, model: 'qwen3:4b', directFetch: vi.fn(), assertCurrent: vi.fn() })).toThrow()
    }
    const f = fixture()
    expect(() => f.client.stream(request({ model: 'qwen3:4b-cloud' }))).toThrow()
    expect(() => f.client.stream(request({ providerId: 'user-configured-local' }))).toThrow()
    expect(f.directFetch).not.toHaveBeenCalled()
  })

  it('stops before any body is sent when the owned server proof is revoked', async () => {
    const f = fixture()
    f.assertCurrent.mockImplementation(() => { throw new Error('Owned server exited') })
    expect(() => f.client.stream(request())).toThrow('Owned server exited')
    expect(f.directFetch).not.toHaveBeenCalled()
  })

  it('binds the reserved display profile to the host client without using user profile transport', async () => {
    const f = fixture()
    const untrusted = { provider: 'user-sdk', model: 'user-model', stream: vi.fn(async function* () {}) }
    const policy = { selection: async () => ({ providerId: 'kun-gmail-local', model: 'qwen3:4b' }),
      dataState: async () => ({ sensitive: true, sharingAllowed: true }),
      local: { providerId: 'kun-gmail-local' as const, model: 'qwen3:4b' as const, client: f.client } }
    const wrapper = new GoogleWorkspaceModelClient(untrusted, policy)
    expect(await wrapper.availability('mail-thread')).toEqual({ allowed: true, providerName: 'Ollama Local (cloud disabled)' })
    await collect(wrapper.stream(request()))
    expect(untrusted.stream).not.toHaveBeenCalled()
    expect(f.directFetch).toHaveBeenCalledOnce()
  })

  it('does not export the local model to gateway callers', () => {
    const f = fixture()
    expect(() => f.client.stream(request({ gatewayRouting: { allowedTargets: [{ providerId: 'kun-gmail-local', modelId: 'qwen3:4b' }] } }))).toThrow('not exported')
    expect(f.directFetch).not.toHaveBeenCalled()
  })
  it('does not accept a cloud client mislabeled as the reserved local profile', async () => {
    const directFetch = vi.fn()
    const cloud = new CompatModelClient({ baseUrl: 'https://ollama.com/v1', model: 'qwen3:4b', apiKey: 'not-real', fetchImpl: directFetch })
    const wrapper = new GoogleWorkspaceModelClient(cloud, {
      selection: async () => ({ providerId: 'kun-gmail-local', model: 'qwen3:4b' }),
      dataState: async () => ({ sensitive: true, sharingAllowed: true }),
      local: { providerId: 'kun-gmail-local', model: 'qwen3:4b', client: cloud }
    })
    expect(await wrapper.availability('mail-thread')).toMatchObject({ allowed: false })
    await expect(collect(wrapper.stream(request()))).rejects.toThrow('Gmail data requires')
    expect(directFetch).not.toHaveBeenCalled()
  })

  it('rechecks consent after asynchronous wire admission, immediately before the HTTP call', async () => {
    const f = fixture()
    let sharing = true
    const wrapper = new GoogleWorkspaceModelClient(f.client, {
      selection: async () => ({ providerId: 'kun-gmail-local', model: 'qwen3:4b' }),
      dataState: async () => ({ sensitive: true, sharingAllowed: sharing }),
      local: { providerId: 'kun-gmail-local', model: 'qwen3:4b', client: f.client }
    })
    const chunks = await collect(wrapper.stream(request({ beforeWireDispatch: async () => { sharing = false } })))
    expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
    expect(f.directFetch).not.toHaveBeenCalled()
  })
})
