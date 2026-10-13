import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createAesEncryptor } from '../security/secret-store.js'
import { DeepSeekAccountEvidenceStore, type DeepSeekAccountEvidenceProof } from './deepseek-account-evidence.js'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { GoogleWorkspaceModelClient } from './model-data-policy.js'
import { assertGoogleWorkspaceModelEndpoint } from '../domain/google-workspace-model-policy.js'
import { CompatModelClient } from '../adapters/model/compat-model-client.js'
import { MultiProviderModelClient } from '../adapters/model/multi-provider-model-client.js'
import { RoutePoolModelClient } from '../adapters/model/route-pool-model-client.js'
import { withModelVerification } from '../services/model-verification-client.js'

let evidence: DeepSeekAccountEvidenceProof
let evidenceDir: string
beforeAll(async () => {
  evidenceDir = await mkdtemp(join(tmpdir(), 'kun-deepseek-proof-'))
  const store = new DeepSeekAccountEvidenceStore(evidenceDir, createAesEncryptor(randomBytes(32)))
  await store.install({ apiKey: 'not-real', source: 'user-confirmed-unified-account-opt-out', checkedAt: new Date().toISOString() })
  evidence = (await store.proof('not-real'))!
})
afterAll(async () => { await rm(evidenceDir, { recursive: true, force: true }) })

const request = (patch: Partial<ModelRequest> = {}): ModelRequest => ({ threadId: 'mail-thread', turnId: 'turn',
  providerId: 'reviewed', model: 'gpt-oss:20b', tools: [], history: [], prefix: [],
  abortSignal: new AbortController().signal, maxRetryAttempts: 0, stream: false, ...patch })
const response = () => new Response(JSON.stringify({ id: 'reply', model: 'gpt-oss:20b',
  choices: [{ message: { content: 'Email summary' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })
async function collect(stream: AsyncIterable<ModelStreamChunk>) {
  const result: ModelStreamChunk[] = []
  for await (const chunk of stream) result.push(chunk)
  return result
}
const policy = (sensitive = true, sharingAllowed = true) => ({
  // Account evidence and exact recipient consent are required in addition to this release switch.
  cloudProcessingEnabled: true,
  selection: vi.fn(async () => ({ model: 'gpt-oss:20b', providerId: 'reviewed' })),
  dataState: vi.fn(async () => ({ sensitive, sharingAllowed, assertSharingCurrent: () => undefined }))
})

describe('Google Workspace model recipient policy', () => {
  it('keeps cloud Gmail processing disabled by default even for the reviewed vendor endpoint', async () => {
    const fetchImpl = vi.fn()
    const client = new CompatModelClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-real', googleWorkspaceAccountEvidence: evidence, model: 'gpt-oss:20b', fetchImpl })
    const controls = policy()
    const wrapped = new GoogleWorkspaceModelClient(client, { selection: controls.selection, dataState: controls.dataState })
    expect(await wrapped.availability('mail-thread')).toMatchObject({ allowed: false })
    await expect(collect(wrapped.stream(request()))).rejects.toThrow('currently requires Kun')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('accepts only the exact reviewed HTTPS API and refuses lookalikes, query routes and protocols', () => {
    expect(() => assertGoogleWorkspaceModelEndpoint('https://api.deepseek.com/v1', 'chat_completions')).not.toThrow()
    expect(() => assertGoogleWorkspaceModelEndpoint('https://api.deepseek.com/v1/chat/completions', 'chat_completions', true)).not.toThrow()
    for (const url of ['http://api.deepseek.com/v1', 'https://api.deepseek.com.attacker.test/v1', 'https://relay.test/ollama/v1',
      'http://localhost:11434/v1', 'https://api.deepseek.com/v1?route=other', 'https://api.deepseek.com:444/v1',
      'https://user@ollama.com/v1', 'https://api.openai.com/v1']) {
      expect(() => assertGoogleWorkspaceModelEndpoint(url, 'chat_completions')).toThrow('Gmail data requires')
    }
    expect(() => assertGoogleWorkspaceModelEndpoint('https://api.deepseek.com/v1', 'responses')).toThrow()
  })

  it('transmits sensitive data only to the reviewed API with the reviewed account and no unsupported storage parameter', async () => {
    const fetchImpl = vi.fn(async () => response())
    const client = new CompatModelClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-real', googleWorkspaceAccountEvidence: evidence, model: 'gpt-oss:20b', fetchImpl })
    const observed = withModelVerification(client, 'reviewed', () => undefined)
    const direct = new MultiProviderModelClient({ default: observed, providers: new Map([['reviewed', observed]]) })
    const wrapped = new GoogleWorkspaceModelClient(direct, policy())
    expect(await wrapped.availability('mail-thread')).toMatchObject({ allowed: true, providerName: 'DeepSeek API', recipient: 'deepseek-api' })
    await collect(wrapped.stream(request()))
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions')
    expect(options.redirect).toBe('error')
    expect(JSON.parse(String(options.body))).not.toHaveProperty('store')
  })

  it('blocks all old mail history after consent is revoked or the mailbox is disconnected', async () => {
    const fetchImpl = vi.fn()
    const client = new CompatModelClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-real', googleWorkspaceAccountEvidence: evidence, model: 'gpt-oss:20b', fetchImpl })
    const wrapped = new GoogleWorkspaceModelClient(client, policy(true, false))
    await expect(collect(wrapped.stream(request()))).rejects.toThrow('sharing has not been granted')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses another API key returned by a live credential resolver before physical fetch', async () => {
    const fetchImpl = vi.fn()
    const client = new CompatModelClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-real', model: 'deepseek-chat',
      googleWorkspaceAccountEvidence: evidence, fetchImpl,
      resolveCredentials: async () => ({ apiKey: 'different-account', refreshable: false }) })
    const wrapped = new GoogleWorkspaceModelClient(client, policy())
    expect(await wrapped.availability('mail-thread')).toMatchObject({ allowed: true })
    const chunks = await collect(wrapped.stream(request({ model: 'deepseek-chat' })))
    expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects a final Cookie even when the protected Bearer key matches the reviewed account', async () => {
    const fetchImpl = vi.fn()
    const client = new CompatModelClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-real', model: 'deepseek-chat',
      googleWorkspaceAccountEvidence: evidence, fetchImpl, headers: { Cookie: 'synthetic-cookie' } })
    const wrapped = new GoogleWorkspaceModelClient(client, policy())
    const chunks = await collect(wrapped.stream(request({ model: 'deepseek-chat' })))
    expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an HTTPS API configuration without host-owned opt-out evidence', async () => {
    const fetchImpl = vi.fn()
    const client = new CompatModelClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-real', model: 'deepseek-chat', fetchImpl })
    const wrapped = new GoogleWorkspaceModelClient(client, policy())
    expect(await wrapped.availability('mail-thread')).toMatchObject({ allowed: false, reason: 'deepseek_api_account_not_reviewed' })
    await expect(collect(wrapped.stream(request({ model: 'deepseek-chat' })))).rejects.toMatchObject({ code: 'google_data_provider_not_approved' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a changed recipient for future titles, compaction and normal requests', async () => {
    const fetchImpl = vi.fn()
    const client = new CompatModelClient({ baseUrl: 'https://relay.example/v1', apiKey: 'not-real', googleWorkspaceAccountEvidence: evidence, model: 'gpt-oss:20b', fetchImpl })
    const wrapped = new GoogleWorkspaceModelClient(client, policy())
    expect(await wrapped.availability('mail-thread')).toMatchObject({ allowed: false, reason: 'approved_model_required' })
    for (const purpose of ['assistant', 'title', 'compaction'] as const) {
      await expect(collect(wrapped.stream(request({ trace: { roundId: 'r', step: 0, purpose } })))).rejects.toThrow('Gmail data requires')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('checks the task’s admitted source route instead of substituting the current composer route', async () => {
    const fetchImpl = vi.fn()
    const reviewed = new CompatModelClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-real', googleWorkspaceAccountEvidence: evidence, model: 'gpt-oss:20b', fetchImpl })
    const original = new CompatModelClient({ baseUrl: 'https://original.example/v1', apiKey: 'not-real', googleWorkspaceAccountEvidence: evidence, model: 'original-model', fetchImpl })
    const direct = new MultiProviderModelClient({ default: reviewed, providers: new Map([['reviewed', reviewed], ['original', original]]) })
    const wrapped = new GoogleWorkspaceModelClient(direct, policy())
    expect(await wrapped.availability('mail-thread')).toMatchObject({ allowed: true })
    const admitted = { model: 'original-model', providerId: 'original' }
    expect(await wrapped.availability('mail-thread', admitted)).toMatchObject({ allowed: false })
    await expect(wrapped.assertAllowed('mail-thread', admitted)).rejects.toThrow('Gmail data requires')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses opaque SDK recipients without executing their stream', async () => {
    const stream = vi.fn(async function* () { yield { kind: 'completed', stopReason: 'stop' } as ModelStreamChunk })
    const wrapped = new GoogleWorkspaceModelClient({ provider: 'sdk', model: 'model', stream }, policy())
    await expect(collect(wrapped.stream(request()))).rejects.toThrow('Gmail data requires')
    expect(stream).not.toHaveBeenCalled()
  })

  it('preserves ordinary conversations with their existing provider', async () => {
    const fetchImpl = vi.fn(async () => response())
    const client = new CompatModelClient({ baseUrl: 'https://custom.example/v1', apiKey: 'not-real', googleWorkspaceAccountEvidence: evidence, model: 'gpt-oss:20b', fetchImpl })
    const wrapped = new GoogleWorkspaceModelClient(client, policy(false, false))
    await collect(wrapped.stream(request()))
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('rejects account failover and never sends to the fallback', async () => {
    const fetchImpl = vi.fn()
    const client = new CompatModelClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-real', googleWorkspaceAccountEvidence: evidence, model: 'gpt-oss:20b', fetchImpl })
    const direct = new MultiProviderModelClient({ default: client, providers: new Map([['reviewed', client]]) })
    const routed = new RoutePoolModelClient(direct, [], () => ({ id: 'gpt-oss:20b', supportsToolCalling: true,
      inputModalities: ['text'], outputModalities: ['text'], messageParts: ['text'] }))
    routed.replaceFailoverGroups([{ providerId: 'reviewed', strategy: 'order',
      members: [{ providerId: 'reviewed', models: ['gpt-oss:20b'], enabled: true }],
      fallbackTargets: [{ providerId: 'other', modelId: 'model' }] }])
    const wrapped = new GoogleWorkspaceModelClient(routed, policy())
    await expect(collect(wrapped.stream(request()))).rejects.toThrow('Gmail data requires')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('invalidates the captured recipient generation before a physical retry', async () => {
    const fetchImpl = vi.fn(async () => {
      direct.replace({ default: client, providers: new Map([['reviewed', client]]) })
      return new Response('stream_options unsupported', { status: 400 })
    })
    const client = new CompatModelClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'not-real', googleWorkspaceAccountEvidence: evidence, model: 'gpt-oss:20b', fetchImpl })
    const direct = new MultiProviderModelClient({ default: client, providers: new Map([['reviewed', client]]) })
    const wrapped = new GoogleWorkspaceModelClient(direct, policy())
    const chunks = await collect(wrapped.stream(request({ stream: true })))
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
  })
})
