import { mkdtemp, rm, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import { HistoryReferenceSchema } from '../contracts/history-reference.js'
import { RuntimeMigrationExportCreateRequest, RuntimeMigrationImportControl, type RuntimeMigrationSnapshotRecord } from '../contracts/migrations.js'
import { createThreadRecord } from '../domain/thread.js'
import { createHistoryReference, readHistoryPage, relinkHistoryReference } from '../history/codex-history.js'
import { HistoryReferenceStore } from '../history/history-reference-store.js'
import { ScopedMigrationMaintenanceLock } from '../ports/migration-maintenance-lock.js'
import { RuntimeMigrationImportService } from './runtime-migration-import-service.js'
import { RuntimeMigrationService, readRuntimeMigrationSnapshotRecords } from './runtime-migration-service.js'

const roots: string[] = []
const now = '2026-09-13T00:00:00.000Z'
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const reference = () => HistoryReferenceSchema.parse({ id: 'hist_reference', provider: 'codex',
  sessionId: 'codex-session', title: 'Source task', workspace: '/old/project', createdAt: now,
  cutoffTurnId: 'turn-source', parserVersion: 1,
  files: [{ path: '/missing/codex-original.jsonl', sessionId: 'codex-session', byteLength: 512,
    recordCount: 4, sha256: 'a'.repeat(64) }] })
const thread = (id = 'thr_source') => createThreadRecord({ id, historyRefId: reference().id,
  title: 'New Kun branch', workspace: '/old/project', model: 'test', createdAt: now })
const threadRecord = (id = 'thr_source'): RuntimeMigrationSnapshotRecord => ({ schemaVersion: 1, type: 'thread', ownerId: id, value: thread(id) })
const refRecord = (): RuntimeMigrationSnapshotRecord => ({ schemaVersion: 1, type: 'history-reference', value: reference() })
async function *records(values: RuntimeMigrationSnapshotRecord[]) { yield* values }
function control() {
  return RuntimeMigrationImportControl.parse({ schemaVersion: 1, type: 'import-control',
    value: { operationId: 'history-migration', workspacePathMap: { '/old/project': '/new/project' } } })
}
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'kun-migration-history-'))
  roots.push(root)
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const historyReferences = new HistoryReferenceStore(join(root, 'data'))
  const deps = { rootDir: join(root, 'imports'), threadStore, sessionStore, historyReferences,
    maintenance: new ScopedMigrationMaintenanceLock(), attachmentStore: () => undefined, memoryStore: () => undefined }
  return { root, deps, threadStore, sessionStore, historyReferences, service: new RuntimeMigrationImportService(deps) }
}

describe('reference-aware runtime migration', () => {
  it('preserves Claude Code descriptors when migrating without the original file', async () => {
    const h = await harness()
    const descriptor = { ...reference(), provider: 'claude-code' as const }
    const preflight = await h.service.preflight(control(), records([threadRecord(), { ...refRecord(), value: descriptor }]))
    await h.service.commit(preflight.importId)
    expect(await h.historyReferences.get(descriptor.id)).toMatchObject({ provider: 'claude-code', files: descriptor.files })
  })

  it('keeps introduced descriptors when a store cannot authoritatively prove non-use on rollback', async () => {
    const h = await harness()
    const preflight = await h.service.preflight(control(), records([threadRecord(), refRecord()]))
    await h.service.commit(preflight.importId)
    Object.defineProperty(h.threadStore, 'hasHistoryReference', { value: undefined })
    await h.service.rollback(preflight.importId)
    expect(await h.historyReferences.get(reference().id)).toEqual(reference())
  })

  it('upgrades old session metadata from its owning imported thread', async () => {
    const h = await harness()
    const preflight = await h.service.preflight(control(), records([threadRecord(), refRecord(), {
      schemaVersion: 1, type: 'session', ownerId: 'thr_source', value: {
        threadId: 'thr_source', turnId: 'turn_new', startedAt: now, updatedAt: now, items: [], events: [], closed: true
      }
    }]))
    await h.service.commit(preflight.importId)
    expect(await h.sessionStore.loadSession('thr_source')).toMatchObject({ historyRefId: reference().id,
      workspace: '/new/project', turnId: 'turn_new' })
  })

  it('retains enough source metadata to relink after the original path disappears', async () => {
    const h = await harness()
    const path = join(h.root, 'original.jsonl')
    const moved = join(h.root, 'moved.jsonl')
    const log = [
      { type: 'session_meta', payload: { id: 'relink-session', cwd: h.root } },
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-source' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Source only' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Original answer' }] } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-source' } }
    ].map((record) => JSON.stringify({ timestamp: now, ...record })).join('\n') + '\n'
    await writeFile(path, log)
    const source = await createHistoryReference(path)
    await rename(path, moved)
    const preflight = await h.service.preflight(control(), records([
      { ...threadRecord(), value: { ...thread(), historyRefId: source.id } },
      { ...refRecord(), value: source }
    ]))
    await h.service.commit(preflight.importId)
    const imported = (await h.historyReferences.get(source.id))!
    expect((await readHistoryPage(imported, { threadId: 'thr_source' })).status).toBe('missing')
    const linked = await relinkHistoryReference(imported, moved)
    await h.historyReferences.put(linked)
    expect((await readHistoryPage(linked, { threadId: 'thr_source' })).status).toBe('available')
    await h.service.verify(preflight.importId)
  })

  it('exports one shared descriptor and imports metadata without accessing missing source logs', async () => {
    const h = await harness()
    await h.historyReferences.put(reference())
    await h.threadStore.upsert(thread())
    await h.threadStore.upsert(thread('thr_shared'))
    const exporter = new RuntimeMigrationService({ rootDir: join(h.root, 'exports'), threads: h.threadStore,
      historyReferences: h.historyReferences, sessions: h.sessionStore,
      turns: { interruptTurn: vi.fn() }, approvals: new InMemoryApprovalGate(), userInputs: new InMemoryUserInputGate(),
      attachmentStore: () => undefined, memoryStore: () => undefined, nowIso: () => now })
    const exported = await exporter.createExport(RuntimeMigrationExportCreateRequest.parse({
      threadIds: ['thr_source', 'thr_shared'], runningThreadPolicy: 'wait' }))
    const { filePath } = await exporter.getExport(exported.snapshotId)
    const snapshot = await readRuntimeMigrationSnapshotRecords(filePath)
    expect(snapshot.filter((record) => record.type === 'history-reference')).toHaveLength(1)
    const destination = await harness()
    const preflight = await destination.service.preflight(control(), records(snapshot))
    expect(await destination.historyReferences.get(reference().id)).toBeNull()
    await destination.service.commit(preflight.importId)
    await destination.service.verify(preflight.importId)
    expect(await destination.historyReferences.get(reference().id)).toEqual(reference())
    expect((await destination.threadStore.get('thr_shared'))?.historyRefId).toBe(reference().id)
    expect(await destination.sessionStore.loadSession('thr_source')).toMatchObject({ historyRefId: reference().id,
      workspace: '/new/project', items: [] })
    await exporter.shutdown()
  })
  it('supports restart, repeated commit and rollback while retaining pre-existing shared references', async () => {
    const h = await harness()
    const local = { ...reference(), files: reference().files.map((file) => ({ ...file, path: '/local/relinked.jsonl' })) }
    await h.historyReferences.put(local)
    const preflight = await h.service.preflight(control(), records([threadRecord(), refRecord()]))
    await h.service.shutdown()
    const restarted = new RuntimeMigrationImportService(h.deps)
    await restarted.commit(preflight.importId)
    await restarted.commit(preflight.importId)
    expect(await h.historyReferences.get(reference().id)).toEqual(local)
    await restarted.rollback(preflight.importId)
    await restarted.rollback(preflight.importId)
    expect(await h.threadStore.get('thr_source')).toBeNull()
    expect(await h.historyReferences.get(reference().id)).toEqual(local)
  })
  it('rolls back introduced descriptors on failure and retains descriptors adopted by another thread', async () => {
    const h = await harness()
    const preflight = await h.service.preflight(control(), records([threadRecord(), refRecord()]))
    const write = vi.spyOn(h.threadStore, 'upsert').mockRejectedValueOnce(new Error('write failed'))
    await expect(h.service.commit(preflight.importId)).rejects.toThrow('write failed')
    expect(await h.historyReferences.get(reference().id)).toBeNull()
    write.mockRestore()
    const retry = await h.service.preflight(control(), records([threadRecord(), refRecord()]))
    await h.service.commit(retry.importId)
    await h.threadStore.upsert(thread('thr_shared'))
    await h.service.rollback(retry.importId)
    expect(await h.historyReferences.get(reference().id)).toEqual(reference())
  })
  it('rejects dangling/conflicting references, accepts old ordinary snapshots and old locally resolvable references', async () => {
    const h = await harness()
    await expect(h.service.preflight(control(), records([threadRecord()]))).rejects.toThrow('missing history reference descriptor')
    await h.historyReferences.put(reference())
    await expect(h.service.preflight(control(), records([threadRecord(), { ...refRecord(), value: { ...reference(), cutoffTurnId: 'different' } }])))
      .rejects.toThrow('identity conflict')
    const legacy = await h.service.preflight(control(), records([threadRecord()]))
    await h.service.commit(legacy.importId)
    const plain = { ...thread(), id: 'thr_plain', historyRefId: undefined }
    const older = await h.service.preflight(control(), records([{ schemaVersion: 1, type: 'thread', ownerId: plain.id, value: plain }]))
    await h.service.commit(older.importId)
    await h.service.verify(older.importId)
    expect((await h.threadStore.get(plain.id))?.historyRefId).toBeUndefined()
  })
  it('verifies reference identity independently of source availability', async () => {
    const h = await harness()
    const preflight = await h.service.preflight(control(), records([threadRecord(), refRecord()]))
    await h.service.commit(preflight.importId)
    await h.historyReferences.put({ ...reference(), cutoffTurnId: 'changed' })
    await expect(h.service.verify(preflight.importId)).rejects.toThrow('missing or changed')
  })
})
