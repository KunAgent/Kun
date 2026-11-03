import Database from 'better-sqlite3'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { makeToolResultItem, makeUserItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { ManagerRemoteSessionStore, ManagerRemoteThreadStore } from './remote-data-stores.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'
import { MAX_MANAGER_DATA_BODY_BYTES } from './service-manager-state.js'
import { ManagerSharedDataStore } from './shared-data-store.js'

it('settles and recovers a thread larger than the real Manager HTTP limit without losing history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-large-thread-'))
  const store = await ManagerSharedDataStore.create(root)
  const server = await startNodeHttpServer({
    host: '127.0.0.1', port: 0,
    router: buildServiceManagerRouter({
      managerToken: 'test-token', instanceId: 'test-manager',
      startedAt: new Date().toISOString(), state: new ServiceManagerState(), sharedData: store
    })
  })
  try {
    const connection = { discovery: {
      version: 1 as const, protocolVersion: 6 as const, instanceId: 'test-manager', pid: process.pid,
      startedAt: new Date().toISOString(), host: '127.0.0.1', port: server.port,
      baseUrl: `http://127.0.0.1:${server.port}`, managerToken: 'test-token',
      serviceVersion: '0.4.0', dataDir: root, settingsPath: join(root, 'settings.json')
    } }
    const threadStore = new ManagerRemoteThreadStore(connection)
    const sessionStore = new ManagerRemoteSessionStore(connection)
    const threadId = 'thread-large'
    const oldTurn = createTurnRecord({ id: 'turn-old', threadId, prompt: 'Big edit', status: 'completed' })
    const activeTurn = createTurnRecord({ id: 'turn-active', threadId, prompt: 'Continue', status: 'running' })
    const payload = 'x'.repeat(1024 * 1024)
    const largeItems = Array.from({ length: 65 }, (_, index) => makeToolResultItem({
      id: `large-${index}`, threadId, turnId: oldTurn.id, callId: `call-${index}`,
      toolName: 'acp:edit', output: { diffs: [{ path: 'app.ts', oldText: '', newText: payload }] }
    }))
    const userItem = makeUserItem({ id: 'user-active', threadId, turnId: activeTurn.id, text: 'Continue' })
    await store.sessionStore.rewriteItems(threadId, [...largeItems, userItem])
    let thread = await threadStore.upsert({
      ...createThreadRecord({ id: threadId, title: 'Large history', workspace: '/tmp', model: 'test' }),
      status: 'running', turns: [{ ...oldTurn, items: largeItems }, { ...activeTurn, items: [userItem] }]
    })
    expect(Buffer.byteLength(JSON.stringify(thread))).toBeGreaterThan(MAX_MANAGER_DATA_BODY_BYTES)
    expect(thread.turns[0].items.length).toBe(65)
    expect(thread.turns[1].prompt).toBe('Continue')
    const readIndex = () => {
      const db = new Database(join(root, 'index.sqlite3'), { readonly: true })
      try { return db.prepare('SELECT message_count, preview FROM threads WHERE id = ?').get(threadId) }
      finally { db.close() }
    }
    expect(readIndex()).toEqual({ message_count: 66, preview: 'Continue' })

    const conditional = await threadStore.upsertIfRevision({ ...thread, title: 'Renamed' }, thread.revision!)
    expect(conditional.applied).toBe(true)
    expect(conditional.thread?.turns[0].items.length).toBe(65)
    expect(await threadStore.upsertIfRevision(thread, thread.revision!)).toMatchObject({ applied: false })

    const nowIso = () => new Date().toISOString()
    const events = new RuntimeEventRecorder({
      eventBus: new InMemoryEventBus(), sessionStore,
      allocateSeq: (id) => sessionStore.allocateEventSeq(id), nowIso
    })
    const turns = new TurnService({
      threadStore, sessionStore, events, nowIso, inflight: new InflightTracker(),
      steering: new SteeringQueue(), compactor: new ContextCompactor(), ids: new SequentialIdGenerator()
    })
    await expect(turns.interruptTurn({ threadId, turnId: activeTurn.id })).resolves.toEqual({ status: 'aborted' })
    expect((await threadStore.getMetadata(threadId))?.status).toBe('idle')
    expect(readIndex()).toEqual({ message_count: 66, preview: 'Continue' })

    // Simulate a persisted running turn with no owner after process restart.
    thread = (await threadStore.getMetadata(threadId))!
    await threadStore.upsert({
      ...thread, status: 'running',
      turns: thread.turns.map((turn) => turn.id === activeTurn.id ? activeTurn : turn)
    })
    expect(await turns.reconcileOrphanedTurns()).toEqual([{ threadId, turnId: activeTurn.id }])
    expect((await threadStore.getMetadata(threadId))?.turns[1].status).toBe('failed')
    const recovered = await store.sessionStore.loadItems(threadId)
    expect(recovered.filter((item) => item.kind === 'interruption_note')).toHaveLength(1)
    expect(recovered.filter((item) => item.kind === 'tool_result').length).toBe(65)

    // Discard must retain the other turn's >64MiB history through the same HTTP path.
    thread = (await threadStore.getMetadata(threadId))!
    await threadStore.upsert({
      ...thread, status: 'running',
      turns: thread.turns.map((turn) => turn.id === activeTurn.id ? activeTurn : turn)
    })
    await turns.interruptTurn({ threadId, turnId: activeTurn.id, discard: true })
    const retained = await store.sessionStore.loadItems(threadId)
    expect(retained.map((item) => item.id)).toEqual([...largeItems, userItem].map((item) => item.id))
    expect(retained.filter((item) => item.kind === 'tool_result').every((item) =>
      JSON.stringify(item.output).includes(payload))).toBe(true)
    expect((await threadStore.list())[0].status).toBe('idle')
    expect(readIndex()).toEqual({ message_count: 66, preview: 'Continue' })
    const next = await turns.startTurn({ threadId, request: { prompt: 'A new message still works' } })
    await expect(turns.finishTurn({ threadId, turnId: next.turnId, status: 'completed' }))
      .resolves.toMatchObject({ kind: 'applied', status: 'completed' })
    const pruned = await turns.pruneThread({
      threadId, request: { throughTurnId: oldTurn.id, archiveBeforePrune: false }
    })
    expect(pruned.pruned).toBe(true)
    expect((await store.sessionStore.loadItems(threadId)).some((item) => item.id.startsWith('large-'))).toBe(false)
  } finally {
    await server.close()
    await store.close()
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)
