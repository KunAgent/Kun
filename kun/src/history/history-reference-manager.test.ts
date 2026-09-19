import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'
import { ManagerRemoteThreadStore } from '../manager/remote-data-stores.js'
import { buildServiceManagerRouter, ServiceManagerState } from '../manager/service-manager.js'
import { ManagerSharedDataStore } from '../manager/shared-data-store.js'
import { isManagerStoreRead } from '../manager/remote-data-store-request.js'
import { FileDelegatedSessionBindingStore } from '../runtime/delegated-session-binding.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { HistoryReferenceService } from './history-reference-service.js'

const nowIso = () => '2026-09-13T00:00:00.000Z'

describe('Manager-owned reference cleanup', () => {
  it('queries canonical metadata, preserves shared archived forks and cleans the last reference over HTTP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-history-manager-'))
    const dataDir = join(root, 'data')
    const path = join(root, 'rollout.jsonl')
    const source = [
      { type: 'session_meta', payload: { id: 'codex-test', cwd: root, timestamp: nowIso() } },
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-test' } },
      { type: 'response_item', payload: { type: 'message', role: 'user',
        content: [{ type: 'input_text', text: 'SOURCE_TITLE_6471' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: 'SOURCE_BODY_6471' }] } },
      { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-test' } }
    ].map((record) => JSON.stringify(record)).join('\n') + '\n'
    await writeFile(path, source)
    const sharedData = await ManagerSharedDataStore.create(dataDir)
    const router = buildServiceManagerRouter({ managerToken: 'manager-secret', instanceId: 'manager-a',
      startedAt: nowIso(), state: new ServiceManagerState(), sharedData })
    const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
    const baseUrl = `http://127.0.0.1:${server.port}`
    const threadStore = new ManagerRemoteThreadStore({ discovery: {
      version: 1, protocolVersion: 5, instanceId: 'manager-a', pid: process.pid,
      startedAt: nowIso(), host: '127.0.0.1', port: server.port, baseUrl,
      managerToken: 'manager-secret', serviceVersion: '0.1.0', dataDir,
      settingsPath: join(root, 'settings.json')
    } })
    configureManagerAtomicJsonClient({ baseUrl, token: 'manager-secret', dataDir })
    vi.stubEnv('KUN_MANAGER_BASE_URL', baseUrl)
    vi.stubEnv('KUN_MANAGER_TOKEN', 'manager-secret')
    vi.stubEnv('KUN_MANAGER_DATA_DIR', dataDir)
    vi.stubEnv('KUN_RUNTIME_INSTANCE_ID', 'runtime-test')
    vi.stubEnv('KUN_RUNTIME_FLAVOR', 'production')
    const delegatedBindings = new FileDelegatedSessionBindingStore(join(dataDir, 'delegated-bindings'))
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    let history: HistoryReferenceService
    const threadService = new ThreadService({ threadStore, sessionStore,
      ids: new SequentialIdGenerator(), nowIso,
      withHistoryReferenceMutation: (operation) => history.store.withLifecycleMutation(operation),
      onDeleted: async (threadId, referenceId) => {
        await Promise.all([
          delegatedBindings.delete(threadId), history.cleanupDeletedThread(threadId, referenceId)
        ])
      },
      events: new RuntimeEventRecorder({ eventBus, sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId), nowIso }) })
    history = new HistoryReferenceService({ dataDir, threadService, threadStore,
      enabled: () => true, defaultModel: () => ({ model: 'test-model' }) })
    try {
      const input = { path, idempotencyKey: 'first' }
      const first = await history.createBranch(input)
      const fork = await threadService.fork(first.thread.id, { relation: 'side' })
      await threadService.update(fork.id, { status: 'archived' })
      const listSpy = vi.spyOn(sharedData.threadStore, 'list').mockRejectedValue(new Error('index unavailable'))
      const getSpy = vi.spyOn(sharedData.threadStore, 'get').mockRejectedValue(new Error('no body hydration'))
      expect(await threadStore.hasHistoryReference(first.reference.id)).toBe(true)
      expect(isManagerStoreRead('thread', 'hasHistoryReference')).toBe(true)
      await threadService.delete(first.thread.id)
      expect(await history.get(first.reference.id)).not.toBeNull()
      await threadService.delete(fork.id)
      expect(await threadStore.hasHistoryReference(first.reference.id)).toBe(false)
      expect(await history.get(first.reference.id)).toBeNull()
      await expect(history.createBranch(input)).rejects.toMatchObject({ code: 'history_branch_deleted' })
      expect(listSpy).not.toHaveBeenCalled()
      expect(getSpy).not.toHaveBeenCalled()
      listSpy.mockRestore()
      getSpy.mockRestore()
      const reservations = await history.store.reservations()
      expect(reservations).toHaveLength(1)
      expect(reservations[0]?.value).toMatchObject({ completed: true, deleted: true })
      expect(JSON.stringify(reservations)).not.toContain(root)
      expect(await readdir(join(dataDir, 'history-references'))).toEqual(['requests'])
      expect(await readFile(path, 'utf8')).toBe(source)
      const unauthorized = await fetch(`${baseUrl}/v1/data/history-reference-reservations`, { method: 'POST' })
      expect(unauthorized.status).toBe(401)
      const metadata = createThreadRecord({ id: 'thread-fork-marker', title: 'Fork marker',
        workspace: root, model: 'test', forkedFromTurnId: 'turn-native-boundary' })
      await threadStore.upsert(metadata)
      expect(await threadStore.getMetadata(metadata.id)).toMatchObject({ forkedFromTurnId: 'turn-native-boundary' })
      expect(await threadStore.list()).toContainEqual(expect.objectContaining({
        id: metadata.id, forkedFromTurnId: 'turn-native-boundary'
      }))
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      configureManagerAtomicJsonClient(null)
      await server.close()
      await sharedData.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
