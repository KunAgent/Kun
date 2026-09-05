import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PendingMemoryCandidate } from '../../contracts/memory-distillation-runtime.js'
import { MemoryDistillationPendingStore } from '../../memory/memory-distillation-pending-store.js'
import { buildMemoryDistillationApplyReceipt } from '../../memory/memory-distillation-apply.js'
import { canonicalMemoryHash } from '../../memory/memory-record-normalizer.js'
import { HybridMemoryStore } from './hybrid-memory-store.js'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function setup(action: 'update' | 'supersede') {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-hybrid-distillation-'))
  cleanup.push(() => rm(dataDir, { recursive: true, force: true }))
  let time = '2026-09-03T01:00:00.000Z'
  const store = new HybridMemoryStore({ dataDir, nowIso: () => time,
    config: { enabled: true, scopes: ['workspace'], maxInjectedRecords: 8,
      distillation: { enabled: true } } })
  cleanup.push(() => store.shutdown())
  await store.ready()
  const target = await store.createWithId('target', {
    content: 'The user prefers long release notes.', scope: 'workspace', workspace: dataDir
  })
  const pending = new MemoryDistillationPendingStore({ dataDir, nowIso: () => time })
  await pending.beginRun('thread', 'turn')
  const [entry] = await pending.completeRun('thread', 'turn', [{
    threadId: 'thread', turnId: 'turn', target: { scope: 'workspace', workspace: dataDir },
    candidate: {
      content: 'The user prefers concise release notes.', type: 'preference', tags: [],
      confidence: 0.9, importance: 0.7, observedAt: time,
      sources: [{ id: 'source', kind: 'user', trust: 'explicit-user', excerpt: 'Concise release notes.' }]
    },
    proposedAction: { action, memoryId: target.id, targetUpdatedAt: target.updatedAt,
      targetFingerprint: canonicalMemoryHash(target) }
  }])
  const applying = await pending.transition(entry!.id, ['pending'], 'applying', {
    applyReceipt: buildMemoryDistillationApplyReceipt(entry!)
  })
  return { store, dataDir, applying, advance: () => { time = '2026-09-03T02:00:00.000Z' } }
}

describe('atomic distillation with the SQLite Memory projection', () => {
  it.each(['update', 'supersede'] as const)('projects and replays %s exactly once', async (action) => {
    const h = await setup(action)
    const record = await h.store.commitDistillation(h.applying)
    await expect(h.store.commitDistillation(h.applying)).resolves.toEqual(record)
    const diagnostics = await h.store.diagnostics()
    expect(diagnostics.indexedCount).toBe(action === 'update' ? 1 : 2)
    expect(diagnostics.indexedCount).toBe(diagnostics.canonicalCount)
    const retrieved = await h.store.retrieve({ query: 'concise release notes', workspace: h.dataDir, limit: 8 })
    expect(retrieved.map((entry) => entry.id)).toEqual([record.id])
  })

  it.each(['update', 'supersede'] as const)('preserves indexed manual edits before %s', async (action) => {
    const h = await setup(action)
    // Deliberately keep the same clock value: the fingerprint must detect this edit.
    await h.store.update('target', { content: 'The user prefers exhaustive release notes.' }, { workspace: h.dataDir })
    await expect(h.store.commitDistillation(h.applying)).rejects.toThrow(/changed after extraction/)
    expect((await h.store.list({ workspace: h.dataDir }))[0]?.content)
      .toBe('The user prefers exhaustive release notes.')
    expect(await h.store.diagnostics()).toMatchObject({ canonicalCount: 1, indexedCount: 1 })
  })

  it('fails closed for old unapplied target proposals missing their fingerprint', async () => {
    const h = await setup('update')
    const old = structuredClone(h.applying)
    delete (old.proposedAction as Extract<PendingMemoryCandidate['proposedAction'], { action: 'update' }>).targetFingerprint
    await expect(h.store.commitDistillation(old)).rejects.toThrow(/changed after extraction/)
    expect((await h.store.list({ workspace: h.dataDir }))[0]?.content)
      .toBe('The user prefers long release notes.')
  })
})
