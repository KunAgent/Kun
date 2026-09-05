import { canonicalMemoryHash } from './memory-record-normalizer.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryDistillationPendingStore } from './memory-distillation-pending-store.js'
import { MemoryDistillationCoordinator } from './memory-distillation-coordinator.js'
import { FileMemoryStore } from './memory-store.js'

const roots: string[] = []
const initialTime = '2026-09-03T01:00:00.000Z'
const candidate = {
  content: 'The user prefers concise release notes.',
  type: 'preference' as const, confidence: 0.9, importance: 0.7,
  observedAt: initialTime, tags: ['release'],
  sources: [{ id: 'source_user', kind: 'user' as const, trust: 'explicit-user' as const,
    threadId: 'thread_1', turnId: 'turn_1', excerpt: 'I prefer concise notes.' }]
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function newRoot() {
  const path = await mkdtemp(join(tmpdir(), 'kun-pr1266-review-'))
  roots.push(path)
  return path
}
describe('Memory distillation approval concurrency', () => {
  it('does not reopen a denied candidate when the second runtime persists its cache', async () => {
    const dataDir = await newRoot()
    const options = { dataDir, nowIso: () => initialTime }
    const first = new MemoryDistillationPendingStore(options)
    await first.beginRun('thread_1', 'turn_1')
    const [entry] = await first.completeRun('thread_1', 'turn_1', [{
      threadId: 'thread_1', turnId: 'turn_1', target: { scope: 'workspace', workspace: dataDir },
      candidate, proposedAction: { action: 'create' }
    }])
    const second = new MemoryDistillationPendingStore(options)
    await second.ready()
    await first.transition(entry!.id, ['pending'], 'denied')
    await second.beginRun('thread_2', 'turn_2')
    const restarted = new MemoryDistillationPendingStore(options)
    expect((await restarted.get(entry!.id))?.status).toBe('denied')
  })
  it.each([initialTime, '2026-09-03T02:00:00.000Z'])('preserves an edit at %s after validation and before the write', async (editTime) => {
    const dataDir = await newRoot()
    let clock = initialTime
    const memory = new FileMemoryStore({ rootDir: join(dataDir, 'memory'),
      config: { enabled: true, scopes: ['workspace'], maxInjectedRecords: 8,
        distillation: { enabled: true } }, nowIso: () => clock })
    const original = await memory.createWithId('target', {
      content: 'The user prefers long release notes.', scope: 'workspace', workspace: dataDir
    })
    const pending = new MemoryDistillationPendingStore({ dataDir, nowIso: () => clock })
    await pending.beginRun('thread_1', 'turn_1')
    const [entry] = await pending.completeRun('thread_1', 'turn_1', [{
      threadId: 'thread_1', turnId: 'turn_1', target: { scope: 'workspace', workspace: dataDir },
      candidate, proposedAction: { action: 'update', memoryId: 'target', targetUpdatedAt: original.updatedAt, targetFingerprint: canonicalMemoryHash(original) }
    }])
    const transition = pending.transition.bind(pending)
    vi.spyOn(pending, 'transition').mockImplementation(async (...args) => {
      const result = await transition(...args)
      if (args[2] === 'applying') {
        clock = editTime
        await memory.update('target', { content: 'The user now wants detailed release notes.' },
          { workspace: dataDir })
      }
      return result
    })
    const coordinator = new MemoryDistillationCoordinator({
      threads: {} as never, model: {} as never, pending, memoryStore: () => memory,
      enabled: () => true, nowIso: () => clock
    })
    await coordinator.decide(entry!.id, { decision: 'allow' }, dataDir).catch(() => undefined)
    expect((await memory.get('target'))?.content).toBe('The user now wants detailed release notes.')
  })
})
