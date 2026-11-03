import { describe, expect, it, vi } from 'vitest'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { GeminiCliApiModelClient } from './gemini-cli-api-model-client.js'
import { GeminiCodeAssistModelClient } from './gemini-code-assist-model-client.js'
import { GeminiCliOAuthSource } from './gemini-cli-oauth.js'

const reply = () => new Response('data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"Summary"}]},"finishReason":"STOP"}]}}\n\n',
  { headers: { 'content-type': 'text/event-stream' } })
async function collect(client: ModelClient, request: ModelRequest): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of client.stream(request)) chunks.push(chunk)
  return chunks
}

function fixture(kind: 'cli' | 'code-assist') {
  let sharing = true
  const fetchImpl = vi.fn<typeof fetch>(async (url) => String(url).endsWith(':loadCodeAssist')
    ? Response.json({ currentTier: { id: 'standard-tier' }, cloudaicompanionProject: 'fixture-project' }) : reply())
  const client = kind === 'cli' ? new GeminiCliApiModelClient({ model: 'gemini-2.5-flash', fetchImpl,
    retry: { maxAttempts: 0 }, oauthSource: new GeminiCliOAuthSource({ fetchImpl,
      loadCredential: async () => ({ accessToken: 'fixture-access', expiresAt: Date.now() + 3_600_000 }) }) })
    : new GeminiCodeAssistModelClient({ model: 'gemini-2.5-flash', fetchImpl,
      auth: { kind: 'gemini-oauth', accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: Date.now() + 3_600_000, projectId: 'fixture-project' } })
  const request: ModelRequest = { threadId: 'private-mail', turnId: 'turn', model: 'gemini-2.5-flash',
    prefix: [], history: [], tools: [], abortSignal: new AbortController().signal,
    googleWorkspaceData: { assertCurrent: () => { if (!sharing) throw new Error('Mail sharing revoked') } } }
  return { client, request, fetchImpl, revoke() { sharing = false } }
}

describe('configured Gemini models with Gmail conversation permission', () => {
  for (const kind of ['cli', 'code-assist'] as const) {
    it(`allows the configured ${kind} model without vendor evidence`, async () => {
      const f = fixture(kind)
      const chunks = await collect(f.client, f.request)
      expect(f.fetchImpl.mock.calls.filter(([url]) => String(url).includes(':streamGenerateContent'))).toHaveLength(1)
      expect(chunks).toContainEqual({ kind: 'assistant_text_delta', text: 'Summary' })
    })

    it(`prevents a ${kind} mail-bearing request when final asynchronous admission revokes sharing`, async () => {
      const f = fixture(kind)
      const chunks = await collect(f.client, { ...f.request, beforeWireDispatch: async () => f.revoke() })
      expect(f.fetchImpl.mock.calls.filter(([url]) => String(url).includes(':streamGenerateContent'))).toHaveLength(0)
      expect(chunks.some((chunk) => chunk.kind === 'error')).toBe(true)
    })
  }
})
