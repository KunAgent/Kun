import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { FileMemoryStore } from './memory-store.js'
import { HybridMemoryStore } from '../adapters/hybrid/hybrid-memory-store.js'
import { recordMemoryForgetting } from './memory-forgetting.js'
import { memoryLifecycle, memoryHistory } from '../server/routes/memory-lifecycle.js'
import { executeMemoryLifecycleOperation } from '../manager/memory-lifecycle-owner.js'

const resources: Array<{ root: string; close?: () => Promise<void> }> = []
const policy = MemoryCapabilityConfig.parse({ enabled: true, scopes: ['workspace', 'user', 'project'] })
const access = { workspace: '/project' }
async function fixture(hybrid = false) {
  const root = await mkdtemp(join(tmpdir(), 'memory-lifecycle-'))
  const store = hybrid ? new HybridMemoryStore({ dataDir: root, config: policy }) :
    new FileMemoryStore({ rootDir: join(root, 'memory'), config: policy })
  resources.push({ root, close: 'shutdown' in store ? () => store.shutdown() : undefined })
  if ('ready' in store) await store.ready()
  return { root, store }
}
afterEach(async () => {
  for (const item of resources.splice(0)) { await item.close?.(); await rm(item.root, { recursive: true, force: true }) }
})

for (const backend of ['file', 'hybrid']) describe(`${backend} memory lifecycle`, () => {
  it('preserves unrelated saved facts and future captures that only share a turn or whole-turn hash', async () => {
    const { root, store } = await fixture(backend === 'hybrid')
    const provenance = { kind: 'user' as const, trust: 'explicit-user' as const,
      threadId: 'thread_multiple_facts', turnId: 'turn_multiple_facts', contentHash: 'whole-turn-hash' }
    const forgotten = await store.createWithId('mem_indent', { content: 'Use tabs for indentation',
      scope: 'workspace', workspace: '/project', sources: [{ ...provenance, id: 'indent', excerpt: 'Use tabs for indentation' }] })
    await store.createWithId('mem_manager', { content: 'Project manager is Nina', scope: 'workspace', workspace: '/project',
      sources: [{ ...provenance, id: 'manager', excerpt: 'Project manager is Nina' }] })
    await store.createWithId('mem_other_owner', { content: 'Independent agent fact', scope: 'user',
      agentContext: { schemaVersion: 1, agentId: 'other-agent', sourceConversationId: 'other-room',
        shared: false, sharedConversationIds: [], sharedProjectRoots: [], locked: false },
      sources: [{ ...provenance, id: 'other-owner', excerpt: 'Independent agent fact' }] })
    await store.lifecycle(forgotten.id, { action: 'forget', expectedRevision: forgotten.revision }, access)
    expect((await store.getById('mem_manager', access)).content).toBe('Project manager is Nina')
    expect((await store.list({ ...access, includeDeleted: true })).map((record) => record.id)).toContain('mem_manager')
    expect((await store.getById('mem_other_owner', { agent: { agentId: 'other-agent', manage: true } })).content)
      .toBe('Independent agent fact')
    await expect(store.createWithId('mem_release', { content: 'Release day is Tuesday', scope: 'workspace', workspace: '/project',
      sources: [{ ...provenance, id: 'release', excerpt: 'Release day is Tuesday' }] })).resolves.toMatchObject({ id: 'mem_release' })
    const restarted = new FileMemoryStore({ rootDir: join(root, 'memory'), config: policy })
    expect((await restarted.getById('mem_manager', access)).content).toBe('Project manager is Nina')
    await expect(restarted.createWithId('mem_recaptured_indent', { content: forgotten.content,
      scope: 'workspace', workspace: '/project' })).rejects.toThrow('forgotten')
  })

  it('binds precise source barriers to excerpts and keeps same-unit existing siblings accessible', async () => {
    const { store } = await fixture(backend === 'hybrid')
    const source = { kind: 'tool' as const, trust: 'observed' as const, threadId: 'evidence_thread',
      turnId: 'evidence_turn', itemId: 'report_receipt', locator: 'file:/project/report.txt' }
    const forgotten = await store.createWithId('mem_statement', { content: 'Formatting uses tabs',
      scope: 'workspace', workspace: '/project', sources: [{ ...source, id: 'first', excerpt: '  Formatting uses tabs.  ' }] })
    await store.createWithId('mem_same_unit_sibling', { content: 'Independent deployment region', scope: 'workspace', workspace: '/project',
      sources: [{ ...source, id: 'second', excerpt: '  Formatting uses tabs.  ' }] })
    await store.lifecycle(forgotten.id, { action: 'forget', expectedRevision: forgotten.revision }, access)
    expect((await store.getById('mem_same_unit_sibling', access)).content).toBe('Independent deployment region')
    await expect(store.createWithId('mem_paraphrase', { content: 'Indent with tab characters',
      scope: 'workspace', workspace: '/elsewhere', sources: [{ ...source, id: 'renamed', excerpt: 'Formatting  uses tabs.' }] }))
      .rejects.toThrow('forgotten')
    await expect(store.createWithId('mem_other_statement', { content: 'Deployment uses Europe',
      scope: 'workspace', workspace: '/project', sources: [{ ...source, id: 'third', excerpt: 'Deployment uses Europe.' }] }))
      .resolves.toMatchObject({ id: 'mem_other_statement' })
  })

  it('retains precise receipt-only and locator-only recapture barriers without a local source ID', async () => {
    const { store } = await fixture(backend === 'hybrid')
    for (const [index, anchor] of [{ receiptId: 'execution_receipt_only' }, { locator: 'file:/project/specific-report.txt' }].entries()) {
      const source = { ...anchor, kind: 'tool' as const, trust: 'observed' as const, id: 'old-source' }
      const memory = await store.createWithId(`mem_unit_${index}`, { content: `Forgotten precise unit ${index}`,
        scope: 'workspace', workspace: '/project', sources: [source] })
      await store.lifecycle(memory.id, { action: 'forget', expectedRevision: memory.revision }, access)
      await expect(store.createWithId(`mem_retry_unit_${index}`, { content: `Paraphrased old unit ${index}`,
        scope: 'workspace', workspace: '/elsewhere', sources: [{ ...source, id: 'new-source' }] })).rejects.toThrow('forgotten')
    }
  })

  it('serializes ordinary and agent CAS edits and records auditable rollback without broadening scope', async () => {
    const { store } = await fixture(backend === 'hybrid')
    const original = await store.createWithId('mem_cas', { content: 'Old finding', scope: 'workspace', workspace: '/project' })
    const results = await Promise.allSettled([
      store.update(original.id, { content: 'First correction', expectedRevision: original.revision }, access),
      store.update(original.id, { content: 'Second correction', expectedRevision: original.revision }, access)
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const current = await store.getById(original.id, access)
    expect(current.revision).toBe(2)
    expect((await store.history(original.id, access)).history[0]?.snapshot.content).toBe('Old finding')
    const rollback = await store.lifecycle(original.id, { action: 'rollback', expectedRevision: 2, targetRevision: 1 }, access)
    expect(rollback.memory).toMatchObject({ content: 'Old finding', scope: 'workspace', workspace: '/project', revision: 3 })
    expect(rollback.memory?.history.at(-1)?.operation).toBe('rollback')
    await expect(store.lifecycle(original.id, { action: 'disable', expectedRevision: 2 }, access)).rejects.toThrow('memory changed')
    await expect(store.history(original.id, { workspace: '/elsewhere' })).rejects.toThrow('not found')
  })

  it('distinguishes reversible disable from source-bound forget and erases derivatives with exact confirmation', async () => {
    const { root, store } = await fixture(backend === 'hybrid')
    const original = await store.createWithId('mem_forget', { content: 'PRIVATE_KNOWLEDGE_TOKEN', scope: 'workspace', workspace: '/project',
      sources: [{ id: 'source_private', kind: 'tool', trust: 'observed', threadId: 'thread_a', turnId: 'turn_a', itemId: 'receipt_a' }] })
    const disabled = await store.lifecycle(original.id, { action: 'disable', expectedRevision: 1 }, access)
    expect(await store.retrieve({ ...access, query: 'PRIVATE_KNOWLEDGE_TOKEN', limit: 8 })).toEqual([])
    await store.lifecycle(original.id, { action: 'restore', expectedRevision: disabled.memory!.revision }, access)
    const derivative = await store.createWithId('mem_derived', { content: 'Derived private conclusion', scope: 'workspace', workspace: '/project',
      consolidation: { sourceMemoryIds: [original.id], sourceSessionIds: ['thread_a'], evidenceStatus: 'unverified', reason: 'summary' } })
    const current = await store.getById(original.id, access)
    const forgotten = await store.lifecycle(original.id, { action: 'forget', expectedRevision: current.revision }, access)
    expect(forgotten.affectedIds.sort()).toEqual([derivative.id, original.id].sort())
    expect(await store.retrieve({ ...access, query: 'PRIVATE_KNOWLEDGE_TOKEN private conclusion', limit: 8 })).toEqual([])
    await expect(store.update(original.id, { disabled: false }, access)).rejects.toThrow('forgotten')
    await expect(store.createWithId('mem_recapture', { content: 'Different wording', scope: 'workspace', workspace: '/project', sources: original.sources })).rejects.toThrow('forgotten')
    await expect(store.createWithId('mem_renamed_source', { content: 'Paraphrased forgotten lesson', scope: 'workspace', workspace: '/elsewhere',
      sources: original.sources.map((source) => ({ ...source, id: 'renamed_source', contentHash: undefined })) })).rejects.toThrow('forgotten')
    await expect(store.createWithId('mem_derived_again', { content: 'Other summary', scope: 'workspace', workspace: '/project', consolidation: derivative.consolidation })).rejects.toThrow('forgotten')
    await expect(store.lifecycle(original.id, { action: 'erase', expectedRevision: forgotten.memory!.revision,
      confirmation: { memoryId: 'wrong_id', irreversible: true } }, access)).rejects.toThrow('exact memory')
    const erased = await store.lifecycle(original.id, { action: 'erase', expectedRevision: forgotten.memory!.revision,
      confirmation: { memoryId: original.id, irreversible: true } }, access)
    expect(erased.erased).toBe(true)
    for (const id of erased.affectedIds) await expect(readFile(join(root, 'memory', `${id}.json`), 'utf8')).rejects.toThrow()
    expect(await store.list({ ...access, includeDeleted: true })).toEqual([])
    const ledger = await readFile(join(root, 'memory/lifecycle/barriers.json'), 'utf8')
    expect(ledger).not.toContain('PRIVATE_KNOWLEDGE_TOKEN')
    expect(ledger).not.toContain('Derived private conclusion')
    const restarted = new FileMemoryStore({ rootDir: join(root, 'memory'), config: policy })
    await expect(restarted.createWithId(original.id, { content: 'retry', scope: 'workspace', workspace: '/project' })).rejects.toThrow('forgotten')
    expect(await restarted.retrieve({ ...access, query: 'private', limit: 8 })).toEqual([])
  })
})

describe('memory erasure boundary', () => {
  it('recovers a barrier-first interrupted erasure before listing or reindexing', async () => {
    const { root, store } = await fixture()
    const record = await store.createWithId('mem_crash_erase', { content: 'Gone after restart', scope: 'workspace', workspace: '/project' })
    await recordMemoryForgetting(join(root, 'memory'), [record], true, new Date().toISOString())
    expect(await store.list({ ...access, includeDeleted: true })).toEqual([])
    await expect(readFile(join(root, 'memory', `${record.id}.json`))).rejects.toThrow()
  })
  it('does not let erased index rows consume a visible pagination limit after a barrier-first crash', async () => {
    const { root, store } = await fixture(true)
    const first = await store.createWithId('mem_a_hidden', { content: 'hidden', scope: 'workspace', workspace: '/project' })
    await store.createWithId('mem_z_visible', { content: 'visible tail', scope: 'workspace', workspace: '/project' })
    if (store instanceof HybridMemoryStore) await store.waitForBackfill()
    await recordMemoryForgetting(join(root, 'memory'), [first], true, new Date().toISOString())
    const rows = await store.list({ ...access, limit: 1 })
    expect(rows.map((row) => row.id)).toEqual(['mem_z_visible'])
  })
  it('requires explicit confirmed identity at HTTP and serializes manager conflicts', async () => {
    const { store } = await fixture()
    const memory = await store.createWithId('mem_http', { content: 'HTTP protected', scope: 'workspace', workspace: '/project' })
    const request = (body: unknown) => new Request('http://kun/v1/memory/mem_http/lifecycle?workspace=/project', {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    expect((await memoryLifecycle(store, memory.id, request({ action: 'erase', expectedRevision: 1 }))).status).toBe(400)
    expect((await memoryLifecycle(store, memory.id, request({ action: 'disable', expectedRevision: 9 }))).status).toBe(409)
    expect((await memoryHistory(store, memory.id, new Request('http://kun/v1/memory/mem_http/history?workspace=/other'))).status).toBe(404)
    expect(await executeMemoryLifecycleOperation(store, 'lifecycle', { id: memory.id, access,
      request: { action: 'disable', expectedRevision: 9 } })).toMatchObject({ ok: false, conflict: expect.stringContaining('changed') })
  })
})
