import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { MemoryDistillationPendingStore } from './memory-distillation-pending-store.js'

const candidate = {
  content: 'The user prefers concise release notes.',
  type: 'preference' as const,
  confidence: 0.9,
  importance: 0.7,
  observedAt: '2026-09-03T01:00:00.000Z',
  tags: ['release'],
  sources: [{
    id: 'source_user',
    kind: 'user' as const,
    threadId: 'thread_1',
    turnId: 'turn_1',
    excerpt: 'I prefer concise release notes.',
    trust: 'explicit-user' as const
  }]
}

describe('MemoryDistillationPendingStore', () => {
  it('persists one run and candidate across restart without replay duplicates', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-memory-distillation-'))
    const nowIso = () => '2026-09-03T01:00:00.000Z'
    const first = new MemoryDistillationPendingStore({ dataDir, nowIso })

    expect(await first.beginRun('thread_1', 'turn_1')).toBe(true)
    expect(await first.beginRun('thread_1', 'turn_1')).toBe(false)
    const inserted = await first.completeRun('thread_1', 'turn_1', [{
      threadId: 'thread_1',
      turnId: 'turn_1',
      target: { scope: 'workspace', workspace: 'D:/workspace' },
      candidate,
      proposedAction: { action: 'create' }
    }])
    expect(inserted).toHaveLength(1)
    expect(inserted[0]?.expiresAt).toBe('2026-09-10T01:00:00.000Z')

    const restarted = new MemoryDistillationPendingStore({ dataDir, nowIso })
    await restarted.ready()
    expect(await restarted.beginRun('thread_1', 'turn_1')).toBe(false)
    expect(await restarted.list({ status: 'pending' })).toEqual(inserted)
    const persisted = JSON.parse(await readFile(
      join(dataDir, 'memory-distillation', 'state.json'),
      'utf8'
    ))
    expect(persisted.schemaVersion).toBe(1)
  })

  it('keeps deny, withdrawal, and expiry terminal and non-reopenable', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-memory-distillation-'))
    let now = '2026-09-03T01:00:00.000Z'
    const store = new MemoryDistillationPendingStore({
      dataDir,
      nowIso: () => now,
      pendingTtlMs: 1_000
    })
    await store.beginRun('thread_1', 'turn_1')
    const [denied] = await store.completeRun('thread_1', 'turn_1', [insert('turn_1')])
    await store.transition(denied!.id, ['pending'], 'denied')
    await expect(store.transition(denied!.id, ['pending'], 'applying')).rejects.toThrow(
      /already denied/u
    )

    await store.beginRun('thread_1', 'turn_2')
    const [withdrawn] = await store.completeRun('thread_1', 'turn_2', [insert('turn_2')])
    await store.transition(withdrawn!.id, ['pending'], 'withdrawn')

    await store.beginRun('thread_1', 'turn_3')
    const [expiring] = await store.completeRun('thread_1', 'turn_3', [insert('turn_3')])
    now = '2026-09-03T01:00:02.000Z'
    expect(await store.expireDue()).toBe(1)
    expect((await store.get(expiring!.id))?.status).toBe('expired')
    expect((await store.get(withdrawn!.id))?.status).toBe('withdrawn')
  })

  it('isolates candidate listings by host-owned workspace', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-memory-distillation-'))
    const store = new MemoryDistillationPendingStore({ dataDir })
    await store.beginRun('thread_1', 'turn_1')
    await store.completeRun('thread_1', 'turn_1', [insert('turn_1', 'D:/workspace-a')])
    await store.beginRun('thread_2', 'turn_2')
    await store.completeRun('thread_2', 'turn_2', [insert('turn_2', 'D:/workspace-b')])

    expect(await store.list({ workspace: 'D:/workspace-a' })).toHaveLength(1)
    expect(await store.list({ workspace: 'D:/workspace-b' })).toHaveLength(1)
    expect(await store.list({ workspace: 'D:/workspace-c' })).toHaveLength(0)
  })

  it('closes interrupted extraction but preserves applying state for reconciliation', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-memory-distillation-'))
    const store = new MemoryDistillationPendingStore({ dataDir, nowIso: () => candidate.observedAt })
    await store.beginRun('thread_1', 'turn_1')
    const [entry] = await store.completeRun('thread_1', 'turn_1', [insert('turn_1')])
    await store.transition(entry!.id, ['pending'], 'applying')
    await store.beginRun('thread_1', 'turn_2')

    const restarted = new MemoryDistillationPendingStore({
      dataDir,
      nowIso: () => '2026-09-03T02:00:00.000Z'
    })
    await restarted.ready()
    expect((await restarted.get(entry!.id))?.status).toBe('applying')
    expect(await restarted.beginRun('thread_1', 'turn_2')).toBe(false)
  })

  it('does not advance cached state when a durable write fails', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-memory-distillation-'))
    let failNextWrite = true
    const store = new MemoryDistillationPendingStore({
      dataDir,
      writeState: async (path, contents) => {
        if (failNextWrite) {
          failNextWrite = false
          throw new Error('simulated durable write failure')
        }
        await atomicWriteFile(path, contents, {
          durable: true,
          allowDirectWriteFallback: false
        })
      }
    })

    await expect(store.beginRun('thread_1', 'turn_1')).rejects.toThrow(
      /simulated durable write failure/u
    )
    expect(await store.beginRun('thread_1', 'turn_1')).toBe(true)

    const restarted = new MemoryDistillationPendingStore({ dataDir })
    expect(await restarted.beginRun('thread_1', 'turn_1')).toBe(false)
  })
})

function insert(turnId: string, workspace = 'D:/workspace') {
  return {
    threadId: 'thread_1',
    turnId,
    target: { scope: 'workspace' as const, workspace },
    candidate: {
      ...candidate,
      sources: candidate.sources.map((source) => ({ ...source, turnId }))
    },
    proposedAction: { action: 'create' as const }
  }
}
