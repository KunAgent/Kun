import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileThreadStore } from '../adapters/file/file-thread-store.js'
import { FileSessionStore } from '../adapters/file/file-session-store.js'
import { HybridThreadStore } from '../adapters/hybrid/hybrid-thread-store.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { ThreadService } from '../services/thread-service.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { HistoryReferenceService } from './history-reference-service.js'
import { makeUserItem } from '../domain/item.js'
const roots: string[] = []
const stores: HybridThreadStore[] = []
const nowIso = () => '2026-09-13T00:00:00.000Z'
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function harness(kind: 'file' | 'hybrid') {
  const root = await mkdtemp(join(tmpdir(), 'kun-reference-gc-'))
  roots.push(root)
  const dataDir = join(root, 'data')
  const threadStore = kind === 'file' ? new FileThreadStore({ dataDir }) : new HybridThreadStore({ dataDir })
  if (threadStore instanceof HybridThreadStore) stores.push(threadStore)
  const sessionStore = new FileSessionStore({ dataDir })
  const eventBus = new InMemoryEventBus()
  const events = new RuntimeEventRecorder({ eventBus, sessionStore, nowIso,
    allocateSeq: (id) => eventBus.allocateSeq(id) })
  let history: HistoryReferenceService
  const service = new ThreadService({ threadStore, sessionStore, events, ids: new SequentialIdGenerator(), nowIso,
    withHistoryReferenceMutation: (run) => history.store.withLifecycleMutation(run),
    recoverHistoryReference: (id) => history.recoverBinding(id),
    onDeleted: (id, ref) => history.cleanupDeletedThread(id, ref) })
  history = new HistoryReferenceService({ dataDir, threadService: service, threadStore, enabled: () => true,
    defaultModel: () => ({ model: 'test-model' }) })
  const path = join(root, 'rollout-source.jsonl')
  const source = [
    { type: 'session_meta', payload: { id: 'codex-source', cwd: root } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'source-turn' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Source request' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Source answer' }] } },
    { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'source-turn' } }
  ].map((record) => JSON.stringify({ timestamp: nowIso(), ...record })).join('\n') + '\n'
  await writeFile(path, source)
  const loseMetadata = async (id: string) => {
    for (const file of ['metadata.jsonl', 'thread.json']) await rm(join(dataDir, 'threads', id, file), { force: true })
    expect(await service.getMetadata(id)).toBeNull()
  }
  return { root, dataDir, path, source, threadStore, sessionStore, service, history, loseMetadata }
}
describe.each(['file', 'hybrid'] as const)('%s reference GC with orphan sessions', (kind) => {
  it.each(['snapshot', 'items'])('recovers the latest workspace from %s after explicit workspace changes', async (mode) => {
    const h = await harness(kind)
    const branch = await h.history.createBranch({ path: h.path, idempotencyKey: 'workspace' })
    const workspaceB = join(h.root, 'project-b')
    const workspaceC = join(h.root, 'project-c')
    await h.sessionStore.appendItem(branch.thread.id, makeUserItem({ id: 'request_a', turnId: 'turn_a',
      threadId: branch.thread.id, historyRefId: branch.reference.id, workspace: h.root, text: 'A request' }))
    await h.service.update(branch.thread.id, { workspace: workspaceB })
    await h.sessionStore.appendItem(branch.thread.id, makeUserItem({ id: 'request_b', turnId: 'turn_b',
      threadId: branch.thread.id, historyRefId: branch.reference.id, workspace: workspaceB, text: 'B request' }))
    if (mode === 'snapshot') {
      // This explicit change has no newer user message and must outrank the earlier B request.
      await h.service.update(branch.thread.id, { workspace: workspaceC })
      expect((await h.sessionStore.loadSession(branch.thread.id))?.workspace).toBe(workspaceC)
    } else {
      await rm(join(h.dataDir, 'threads', branch.thread.id, 'session.json'))
    }
    await h.loseMetadata(branch.thread.id)
    const expected = mode === 'snapshot' ? workspaceC : workspaceB
    expect((await h.service.getResumeSessionMetadata(branch.thread.id)).workspace).toBe(expected)
    expect((await h.service.resumeSession(branch.thread.id)).thread.workspace).toBe(expected)
  })

  it('retains a legacy reservation-only empty branch when deleting its shared sibling', async () => {
    const h = await harness(kind)
    const a = await h.history.createBranch({ path: h.path, idempotencyKey: 'legacy-a' })
    const b = await h.history.createBranch({ path: h.path, idempotencyKey: 'legacy-b' })
    await rm(join(h.dataDir, 'threads', b.thread.id, 'session.json'))
    await h.loseMetadata(b.thread.id)
    expect(await h.sessionStore.loadItems(b.thread.id)).toEqual([])
    await h.service.delete(a.thread.id)
    expect(await h.history.get(b.reference.id)).not.toBeNull()
    expect((await h.history.store.getReservation('legacy-b'))?.deleted).toBeUndefined()
    const restored = await h.service.resumeSession(b.thread.id)
    expect(restored.thread.historyRefId).toBe(b.reference.id)
    expect((await h.history.readForThread(restored.thread.id, { operation: 'recent' })).text).toContain('Source answer')
    await h.service.delete(restored.thread.id)
    expect(await h.history.get(b.reference.id)).not.toBeNull()
    // The old events directory still exists; explicit deletion can now retire its reservation.
    expect(await h.service.delete(b.thread.id)).toBe(true)
    expect((await h.history.store.getReservation('legacy-b'))?.deleted).toBe(true)
    expect(await h.history.get(b.reference.id)).toBeNull()
  })

  it.each(['snapshot', 'items'])('protects recoverable B through its %s while deleting shared A, then collects after real deletion', async (mode) => {
    const h = await harness(kind)
    const a = await h.history.createBranch({ path: h.path, idempotencyKey: 'a' })
    const b = await h.history.createBranch({ path: h.path, idempotencyKey: 'b' })
    if (mode === 'items') {
      await h.sessionStore.appendItem(b.thread.id, makeUserItem({ id: 'new_request', turnId: 'new_turn',
        threadId: b.thread.id, historyRefId: b.reference.id, workspace: h.root, text: 'New Kun question' }))
      await rm(join(h.dataDir, 'threads', b.thread.id, 'session.json'))
    }
    await h.loseMetadata(b.thread.id)
    await h.service.delete(a.thread.id)
    expect(await h.history.get(a.reference.id)).not.toBeNull()
    const resumed = await h.service.resumeSession(b.thread.id)
    expect((await h.history.readForThread(resumed.thread.id, { operation: 'recent' })).text).toContain('Source answer')
    await h.service.delete(resumed.thread.id)
    expect(await h.history.get(a.reference.id)).not.toBeNull()
    expect(await h.service.delete(b.thread.id)).toBe(true)
    expect(await h.history.get(a.reference.id)).toBeNull()
    expect(await h.sessionStore.loadSession(b.thread.id)).toBeNull()
    expect(await readFile(h.path, 'utf8')).toBe(h.source)
  })
  it.each(['session.json', 'messages.jsonl'])('retains descriptors when orphan %s is malformed', async (file) => {
    const h = await harness(kind)
    const a = await h.history.createBranch({ path: h.path, idempotencyKey: 'a' })
    const orphan = join(h.dataDir, 'threads', 'thr_orphan')
    await mkdir(orphan, { recursive: true })
    await writeFile(join(orphan, file), '{damaged')
    await h.service.delete(a.thread.id)
    expect(await h.history.get(a.reference.id)).not.toBeNull()
    expect(await h.threadStore.hasHistoryReference(a.reference.id)).toBe(true)
  })
  it('uses intact metadata without consulting an unrelated malformed session snapshot', async () => {
    const h = await harness(kind)
    const a = await h.history.createBranch({ path: h.path, idempotencyKey: 'a' })
    const other = await h.service.create({ workspace: h.root, model: 'test', mode: 'agent' })
    await writeFile(join(h.dataDir, 'threads', other.id, 'session.json'), '{damaged')
    await h.service.delete(a.thread.id)
    expect(await h.history.get(a.reference.id)).toBeNull()
  })
  it('keeps ambiguous legacy item history without treating user text as a host binding', async () => {
    const h = await harness(kind)
    const a = await h.history.createBranch({ path: h.path, idempotencyKey: 'a' })
    const other = await h.service.create({ workspace: h.root, model: 'test', mode: 'agent' })
    await h.sessionStore.appendItem(other.id, makeUserItem({ id: 'fake_reference', turnId: 'turn_fake',
      threadId: other.id, text: JSON.stringify({ historyRefId: 'unrelated-user-text' }) }))
    await h.loseMetadata(other.id)
    await h.service.delete(a.thread.id)
    expect(await h.history.get(a.reference.id)).not.toBeNull()
  })
})
