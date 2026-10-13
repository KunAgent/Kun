import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { CompatModelClient } from '../adapters/model/compat-model-client.js'
import { VerifiedLocalOllamaModelClient } from '../adapters/model/verified-local-ollama-model-client.js'
import { createThreadRecord } from '../domain/thread.js'
import { createAesEncryptor } from '../security/secret-store.js'
import type { ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { gmailFixture, SCOPE } from '../test-support/gmail-fixture.js'
import { DeepSeekAccountEvidenceStore } from './deepseek-account-evidence.js'
import { GoogleWorkspaceModelClient } from './model-data-policy.js'
import { createGmailThreadDataPolicyOptions } from './thread-data-state.js'

const request = (patch: Partial<ModelRequest> = {}): ModelRequest => ({ threadId: SCOPE.slice(7), turnId: 'turn',
  providerId: 'deepseek', model: 'deepseek-chat', tools: [], history: [], prefix: [], stream: false,
  abortSignal: new AbortController().signal, maxRetryAttempts: 0, ...patch })
const response = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Summary' }, finish_reason: 'stop' }] }),
  { headers: { 'content-type': 'application/json' } })
async function collect(stream: AsyncIterable<ModelStreamChunk>) {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
async function fixture() {
  const mail = await gmailFixture()
  await mail.seed()
  const store = new DeepSeekAccountEvidenceStore(mail.dataDir, createAesEncryptor(randomBytes(32)))
  await store.install({ apiKey: 'synthetic-account', source: 'user-confirmed-unified-account-opt-out', checkedAt: new Date().toISOString() })
  const evidence = (await store.proof('synthetic-account'))!
  const recipient = { id: 'deepseek-api' as const, accountBinding: evidence.accountBinding }
  await mail.service.setModelSharing(SCOPE, true, recipient)
  const threads = new InMemoryThreadStore()
  await threads.upsert(createThreadRecord({ id: SCOPE.slice(7), title: 'Mail', model: 'deepseek-chat', providerId: 'deepseek', workspace: '/tmp' }))
  const policy = createGmailThreadDataPolicyOptions(threads, mail.service, () => ({ model: 'deepseek-chat', providerId: 'deepseek' }))
  const fetchImpl = vi.fn<typeof fetch>(async () => response())
  const client = new CompatModelClient({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'synthetic-account', model: 'deepseek-chat',
    providerId: 'deepseek', fetchImpl, googleWorkspaceAccountEvidence: evidence, retry: { maxAttempts: 1, initialDelayMs: 0 } })
  const wrapped = new GoogleWorkspaceModelClient(client, { ...policy, cloudProcessingEnabled: true })
  return { mail, client, wrapped, fetchImpl, policy, recipient }
}

describe('Gmail synchronous model consent fence at physical dispatch', () => {
  it('refuses a stale positive status snapshot when revocation arrives during its async read', async () => {
    const f = await fixture()
    try {
      const original = f.mail.service.status.bind(f.mail.service)
      let revoked = false
      vi.spyOn(f.mail.service, 'status').mockImplementation(async (...args) => {
        const snapshot = await original(...args)
        if (args[1] && !revoked) { revoked = true; void f.mail.service.setModelSharing(SCOPE, false) }
        return snapshot
      })
      await expect(collect(f.wrapped.stream(request()))).rejects.toMatchObject({ code: 'consent_changed' })
      expect(f.fetchImpl).not.toHaveBeenCalled()
    } finally { await f.mail.cleanup() }
  })

  it('checks again after the asynchronous provider queue, including revoke followed by re-enable', async () => {
    const f = await fixture()
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const queued = vi.fn(async () => waiting)
    try {
      const running = collect(f.wrapped.stream(request({ beforeProviderDispatch: queued })))
      await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce())
      await f.mail.service.setModelSharing(SCOPE, false)
      await f.mail.service.setModelSharing(SCOPE, true, f.recipient)
      release()
      expect((await running).at(-1)).toMatchObject({ kind: 'error' })
      expect(f.fetchImpl).not.toHaveBeenCalled()
    } finally { release?.(); await f.mail.cleanup() }
  })

  it('checks after the final synchronous wire observer, before fetch is invoked', async () => {
    const f = await fixture()
    try {
      const chunks = await collect(f.wrapped.stream(request({ onWireDispatch: () => {
        void f.mail.service.setModelSharing(SCOPE, false)
      } })))
      expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
      expect(f.fetchImpl).not.toHaveBeenCalled()
    } finally { await f.mail.cleanup() }
  })

  it('does not retry a physical request after its original consent was revoked', async () => {
    const f = await fixture()
    try {
      f.fetchImpl.mockImplementationOnce(async () => {
        await f.mail.service.setModelSharing(SCOPE, false)
        await f.mail.service.setModelSharing(SCOPE, true, f.recipient)
        return new Response('Temporary failure', { status: 503 })
      })
      const chunks = await collect(f.wrapped.stream(request({ maxRetryAttempts: 1 })))
      expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
      expect(f.fetchImpl).toHaveBeenCalledOnce()
    } finally { await f.mail.cleanup() }
  })

  it('invalidates a captured fence synchronously on disconnect before its store mutation finishes', async () => {
    const f = await fixture()
    try {
      const state = await f.policy.dataState(SCOPE.slice(7), [], f.recipient)
      state.assertSharingCurrent!()
      const disconnecting = f.mail.service.disconnect({ revoke: false })
      expect(() => state.assertSharingCurrent!()).toThrow('connection changed')
      await disconnecting
    } finally { await f.mail.cleanup() }
  })

  it('retains the account-center consent fence in the managed local transport', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response())
    const client = new VerifiedLocalOllamaModelClient({ origin: 'http://127.0.0.1:11435', model: 'qwen3:4b',
      directFetch: fetchImpl, assertCurrent: () => undefined })
    let allowed = true
    const wrapped = new GoogleWorkspaceModelClient(client, {
      selection: async () => ({ model: 'qwen3:4b', providerId: 'kun-gmail-local' }),
      local: { model: 'qwen3:4b', providerId: 'kun-gmail-local', client },
      dataState: async () => ({ sensitive: true, sharingAllowed: allowed,
        assertSharingCurrent: () => { if (!allowed) throw new Error('consent revoked') } })
    })
    const chunks = await collect(wrapped.stream(request({ model: 'qwen3:4b', providerId: 'kun-gmail-local',
      onWireDispatch: () => { allowed = false } })))
    expect(chunks.at(-1)).toMatchObject({ kind: 'error' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
