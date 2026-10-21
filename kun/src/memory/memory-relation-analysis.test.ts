import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { FileMemoryStore } from './memory-store.js'
import { analyzeMemoryRelations, relationCandidates } from './memory-relation-analysis.js'
import { withMemoryMutation } from './memory-mutation-queue.js'

const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), 'kun-relation-analysis-'))
  directories.push(rootDir)
  const store = new FileMemoryStore({ rootDir, config: MemoryCapabilityConfig.parse({ enabled: true }) })
  const source = await store.createWithId('mem_source', { content: 'Database uses PostgreSQL 17.', scope: 'user' })
  await store.createWithId('mem_target', { content: 'Database uses PostgreSQL 16.', scope: 'user' })
  const input = { memoryId: source.id, expectedRevision: source.revision, access: {} }
  const relation = { targetId: 'mem_target', kind: 'contradicts', sourceQuote: 'PostgreSQL 17', targetQuote: 'PostgreSQL 16' }
  const model = (value: unknown): ModelClient => ({ provider: 'test', model: 'configured', stream: vi.fn(async function* () {
    yield { kind: 'assistant_text_delta', text: JSON.stringify(value) } as ModelStreamChunk
    yield { kind: 'completed', stopReason: 'stop' } as ModelStreamChunk
  }) })
  return { rootDir, store, input, relation, model }
}

describe('Memory relation analysis', () => {
  it('sends bounded content only, validates evidence, and leaves canonical state untouched', async () => {
    const f = await fixture()
    await f.store.createWithId('mem_secret', { content: 'Database password secret-project', scope: 'workspace', workspace: '/private' })
    await f.store.createWithId('mem_rule', { content: 'Database always use PostgreSQL.', scope: 'user', authority: 'directive' })
    const model = f.model({ relations: [f.relation] })
    const result = await analyzeMemoryRelations({ ...f, model, modelId: 'configured' })
    expect(result.relations[0]).toMatchObject({ stale: false, suggestion: { status: 'pending', proposal: { kind: 'contradicts' } } })
    const request = vi.mocked(model.stream).mock.calls[0][0] as ModelRequest
    const payload = JSON.stringify(request.history)
    expect(payload).not.toContain('secret-project')
    expect(payload).not.toContain('mem_rule')
    expect(request).toMatchObject({ model: 'configured', tools: [], maxTokens: 2048, responseFormat: 'json_object' })
    expect(result.relations[0].target.content).toBe('Database uses PostgreSQL 16.')
    expect(result.relations[0].source.revision).toBe(1)
  })

  it('skips model invocation when no eligible counterpart exists', async () => {
    const f = await fixture()
    await f.store.update('mem_target', { disabled: true })
    const model = f.model({ relations: [] })
    expect(await analyzeMemoryRelations({ ...f, model, modelId: 'configured' })).toEqual({ relations: [] })
    expect(model.stream).not.toHaveBeenCalled()
  })

  it('bounds discovery and excludes private, expired, future, oversized and unrelated records', async () => {
    const f = await fixture()
    const source = await f.store.getById('mem_source')
    const target = await f.store.getById('mem_target')
    const blocked = [
      { ...target, id: 'mem_private', agentContext: { schemaVersion: 1 as const, agentId: 'agent',
        sourceConversationId: 'conversation', shared: true, sharedConversationIds: [], sharedProjectRoots: [], locked: false } },
      { ...target, id: 'mem_expired', expiresAt: '2020-01-01T00:00:00Z' },
      { ...target, id: 'mem_future', validFrom: '2099-01-01T00:00:00Z' },
      { ...target, id: 'mem_large', content: 'Database '.repeat(300) },
      { ...target, id: 'mem_unrelated', content: 'Hiking boots' }
    ]
    expect(relationCandidates(source, blocked, Date.now())).toEqual([])
    const eligible = Array.from({ length: 12 }, (_, i) => ({ ...target, id: `mem_${i}` }))
    expect(relationCandidates(source, eligible, Date.now())).toHaveLength(8)
    expect(relationCandidates(source, [...eligible].reverse(), Date.now()))
      .toEqual(relationCandidates(source, eligible, Date.now()))
  })

  it('does not invoke the model or store proposals when the caller already cancelled', async () => {
    const f = await fixture()
    const model = f.model({ relations: [f.relation] })
    await expect(analyzeMemoryRelations({ ...f, model, modelId: 'configured',
      signal: AbortSignal.abort() })).rejects.toThrow()
    expect(model.stream).not.toHaveBeenCalled()
    expect((await f.store.relations({ action: 'list', memoryId: f.input.memoryId, access: {} })).relations).toEqual([])
  })

  it.each(['unknown', 'invented quote', 'duplicate', 'extra fields', 'replace', 'oversized'])('rejects %s output without persisting a partial batch', async (kind) => {
    const f = await fixture()
    const bad = { ...f.relation }
    if (kind === 'unknown') bad.targetId = 'mem_secret'
    if (kind === 'invented quote') bad.targetQuote = 'a fact not present'
    if (kind === 'replace') bad.kind = 'supersedes'
    if (kind === 'oversized') bad.sourceQuote = 'x'.repeat(513)
    const output = kind === 'extra fields' ? { relations: [bad], instructions: 'leak' } :
      { relations: kind === 'duplicate' ? [bad, bad] : [bad] }
    await expect(analyzeMemoryRelations({ ...f, model: f.model(output), modelId: 'configured' })).rejects.toThrow()
    expect((await f.store.relations({ action: 'list', memoryId: f.input.memoryId, access: {} })).relations).toEqual([])
  })

  it('rejects output if a Memory changes while the model is running', async () => {
    const f = await fixture()
    const model: ModelClient = { provider: 'test', model: 'configured', stream: async function* () {
      await f.store.update('mem_target', { content: 'Database now uses SQLite.' })
      yield { kind: 'assistant_text_delta', text: JSON.stringify({ relations: [f.relation] }) }
      yield { kind: 'completed', stopReason: 'stop' }
    } }
    await expect(analyzeMemoryRelations({ ...f, model, modelId: 'configured' })).rejects.toThrow(/stale/)
  })

  it('rejects tools, truncated completion, and raw provider errors without exposing their text', async () => {
    const f = await fixture()
    for (const chunk of [
      { kind: 'tool_call_delta', callId: 'call', toolName: 'read_file', argumentsDelta: '' },
      { kind: 'completed', stopReason: 'length' },
      { kind: 'error', message: 'password=private-value' }
    ] as ModelStreamChunk[]) {
      const model: ModelClient = { provider: 'test', model: 'configured', stream: async function* () { yield chunk } }
      await expect(analyzeMemoryRelations({ ...f, model, modelId: 'configured' }))
        .rejects.toThrow('Memory relation analysis failed. No memories were changed.')
    }
  })

  it('times out even when an adapter ignores cancellation and never commits late output', async () => {
    const f = await fixture()
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const model: ModelClient = { provider: 'test', model: 'configured', stream: async function* () {
      await wait
      yield { kind: 'assistant_text_delta', text: JSON.stringify({ relations: [f.relation] }) }
      yield { kind: 'completed', stopReason: 'stop' }
    } }
    await expect(analyzeMemoryRelations({ ...f, model, modelId: 'configured', timeoutMs: 10 })).rejects.toThrow(/failed/)
    release()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect((await f.store.relations({ action: 'list', memoryId: f.input.memoryId, access: {} })).relations).toEqual([])
  })

  it.each(['cancel', 'timeout'])('never persists a queued analysis after %s', async (reason) => {
    const f = await fixture()
    let release!: () => void
    const hold = withMemoryMutation(f.rootDir, () => new Promise<void>((resolve) => { release = resolve }))
    let entered!: () => void
    const queued = new Promise<void>((resolve) => { entered = resolve })
    const original = f.store.relations.bind(f.store)
    vi.spyOn(f.store, 'relations').mockImplementation((...args) => { entered(); return original(...args) })
    const controller = new AbortController()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const pending = analyzeMemoryRelations({ ...f, model: f.model({ relations: [f.relation] }),
      modelId: 'configured', signal: controller.signal, timeoutMs: 1000 })
    const rejected = expect(pending).rejects.toThrow(/cancelled|timed out/)
    try {
      await queued
      if (reason === 'cancel') controller.abort()
      else await vi.advanceTimersByTimeAsync(1001)
      await rejected
    } finally {
      vi.useRealTimers()
      release()
      await hold
    }
    expect((await original({ action: 'list', memoryId: f.input.memoryId, access: {} })).relations).toEqual([])
  })
})
