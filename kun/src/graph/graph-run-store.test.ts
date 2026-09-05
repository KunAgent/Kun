import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileArtifactStore } from '../artifacts/artifact-store.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import {
  FileGraphRunStore,
  GraphRunConflictError,
  GraphStoreCorruptionError
} from './graph-run-store.js'
import { testGraphConfig, testGraphPlan } from './graph-test-fixtures.test-support.js'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-graph-store-'))
  roots.push(root)
  const runtimeEvents: RuntimeEventDraft[] = []
  let id = 0
  const store = new FileGraphRunStore({
    rootDir: join(root, 'graphs'),
    artifactStore: new FileArtifactStore(join(root, 'artifacts')),
    config: () => testGraphConfig({
      context: { maxInlineEventBytes: 256 },
      retention: { snapshotEveryEvents: 2 }
    }),
    runtimeEvents: {
      record: async (event) => {
        runtimeEvents.push(event)
        return event as never
      }
    },
    nowIso: () => new Date(Date.UTC(2026, 6, 26, 0, 0, id)).toISOString(),
    nextId: (prefix) => `${prefix}_${++id}`
  })
  return { root, store, runtimeEvents }
}

async function createRun(store: FileGraphRunStore) {
  return store.create({
    runId: 'run_1',
    threadId: 'thread_1',
    projectId: 'project_1',
    sourceTurnId: 'turn_1',
    plan: testGraphPlan(),
    commandId: 'command_create',
    idempotencyKey: 'create_1'
  })
}

describe('FileGraphRunStore', () => {
  it('retries initialization after a transient index read failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-store-retry-'))
    roots.push(root)
    const graphsDir = join(root, 'graphs')
    await mkdir(graphsDir)
    await writeFile(join(graphsDir, 'index.json'), '{invalid', 'utf8')
    const store = new FileGraphRunStore({
      rootDir: graphsDir,
      config: () => testGraphConfig()
    })

    await expect(store.list()).rejects.toMatchObject({ code: 'EXTENSION_JSON_INVALID' })
    await writeFile(join(graphsDir, 'index.json'), '[]\n', 'utf8')

    await expect(store.list()).resolves.toEqual([])
  })

  it('creates, snapshots, lists, reloads, and emits through RuntimeEventRecorder', async () => {
    const { store, runtimeEvents } = await fixture()
    const created = await createRun(store)

    expect(created.run).toMatchObject({
      id: 'run_1',
      threadId: 'thread_1',
      status: 'draft',
      lastEventSeq: 1
    })
    expect(await store.get('run_1')).toEqual(created.run)
    expect(await store.list({ projectId: 'project_1' })).toHaveLength(1)
    expect(runtimeEvents).toHaveLength(1)
    expect(runtimeEvents[0]).toMatchObject({
      kind: 'graph_event',
      threadId: 'thread_1',
      graph: {
        graphSeq: 1,
        event: { type: 'payload_externalized' }
      }
    })
  })

  it('persists graph_event through the shared recorder and publishes it for SSE', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-runtime-event-'))
    roots.push(root)
    const eventBus = new InMemoryEventBus()
    const sessions = new InMemorySessionStore()
    const recorder = new RuntimeEventRecorder({
      eventBus,
      sessionStore: sessions,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso: () => new Date().toISOString()
    })
    const published: unknown[] = []
    const unsubscribe = eventBus.subscribe('thread_1', (event) => published.push(event))
    const store = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      artifactStore: new FileArtifactStore(join(root, 'artifacts')),
      config: () => testGraphConfig(),
      runtimeEvents: recorder
    })
    await createRun(store)
    unsubscribe()
    const persisted = await sessions.loadEventsSince('thread_1', 0)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({
      kind: 'graph_event',
      threadId: 'thread_1',
      graph: { runId: 'run_1', graphSeq: 1 }
    })
    expect(published).toEqual(persisted)

    const journal = (await readFile(
      join(root, 'graphs', 'run_1', 'events.jsonl'),
      'utf8'
    )).trim().split('\n').map((line) => JSON.parse(line))
    await writeFile(
      join(root, 'graphs', 'run_1', 'runtime-outbox.json'),
      `${JSON.stringify(journal.map((record) => record.envelope))}\n`,
      'utf8'
    )
    const restartedRecorder = new RuntimeEventRecorder({
      eventBus,
      sessionStore: sessions,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso: () => new Date().toISOString()
    })
    const restartedStore = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      artifactStore: new FileArtifactStore(join(root, 'artifacts')),
      config: () => testGraphConfig(),
      runtimeEvents: restartedRecorder
    })
    expect((await createRun(restartedStore)).duplicate).toBe(true)
    expect(await sessions.loadEventsSince('thread_1', 0)).toHaveLength(1)
  })

  it('uses command/idempotency records to suppress duplicate side effects', async () => {
    const { store, runtimeEvents } = await fixture()
    const first = await createRun(store)
    const duplicateCreate = await createRun(store)
    expect(duplicateCreate.duplicate).toBe(true)
    expect(duplicateCreate.run).toEqual(first.run)

    const input = {
      expectedSeq: 1,
      graphRevision: 1,
      commandId: 'command_validate',
      idempotencyKey: 'validate_1',
      event: {
        type: 'run_status_changed' as const,
        payload: { from: 'draft' as const, to: 'validating' as const }
      }
    }
    const applied = await store.append('run_1', input)
    const duplicate = await store.append('run_1', input)
    expect(applied.duplicate).toBe(false)
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.state.lastEventSeq).toBe(2)
    expect(runtimeEvents).toHaveLength(2)
  })

  it('keeps durable create and append commands successful while replaying a failed outbox once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-outbox-'))
    roots.push(root)
    const delivered: RuntimeEventDraft[] = []
    let failNext = true
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const store = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      config: () => testGraphConfig(),
      runtimeEvents: {
        record: async (event) => {
          if (failNext) {
            failNext = false
            throw new Error(`temporary recorder failure ${'x'.repeat(2_048)}`)
          }
          delivered.push(event)
          return event as never
        }
      }
    })

    const created = await createRun(store)
    expect(created).toMatchObject({
      duplicate: false,
      run: { id: 'run_1', lastEventSeq: 1 }
    })
    expect((await store.get('run_1'))?.lastEventSeq).toBe(1)
    expect(await store.list({ threadId: 'thread_1' })).toEqual([
      expect.objectContaining({ id: 'run_1', lastEventSeq: 1 })
    ])
    expect((await readFile(
      join(root, 'graphs', 'run_1', 'events.jsonl'),
      'utf8'
    )).trim().split('\n')).toHaveLength(1)
    const pendingCreate = JSON.parse(await readFile(
      join(root, 'graphs', 'run_1', 'runtime-outbox.json'),
      'utf8'
    )) as Array<{ eventId: string }>
    expect(pendingCreate).toHaveLength(1)
    expect(warning).toHaveBeenCalledOnce()
    expect(String(warning.mock.calls[0]?.[0])).toMatch(
      /^\[kun] Graph runtime event outbox flush deferred for run_1: temporary recorder failure /
    )
    expect(String(warning.mock.calls[0]?.[0]).length).toBeLessThan(600)

    failNext = true
    const duplicateCreateWhileRecorderIsDown = await createRun(store)
    expect(duplicateCreateWhileRecorderIsDown.duplicate).toBe(true)
    expect(delivered).toHaveLength(0)
    expect(JSON.parse(await readFile(
      join(root, 'graphs', 'run_1', 'runtime-outbox.json'),
      'utf8'
    ))).toHaveLength(1)

    const duplicateCreate = await createRun(store)
    expect(duplicateCreate.duplicate).toBe(true)
    expect(delivered).toHaveLength(1)
    expect(JSON.parse(await readFile(
      join(root, 'graphs', 'run_1', 'runtime-outbox.json'),
      'utf8'
    ))).toEqual([])

    failNext = true
    const appended = await store.append('run_1', {
      expectedSeq: 1,
      graphRevision: 1,
      commandId: 'command_validate',
      idempotencyKey: 'validate_1',
      event: {
        type: 'run_status_changed',
        payload: { from: 'draft', to: 'validating' }
      }
    })
    expect(appended).toMatchObject({
      duplicate: false,
      state: { status: 'validating', lastEventSeq: 2 },
      envelope: { graphSeq: 2 }
    })
    expect((await store.get('run_1'))?.lastEventSeq).toBe(2)
    expect(await store.list({ threadId: 'thread_1' })).toEqual([
      expect.objectContaining({ id: 'run_1', status: 'validating', lastEventSeq: 2 })
    ])
    expect((await readFile(
      join(root, 'graphs', 'run_1', 'events.jsonl'),
      'utf8'
    )).trim().split('\n')).toHaveLength(2)
    expect(JSON.parse(await readFile(
      join(root, 'graphs', 'run_1', 'runtime-outbox.json'),
      'utf8'
    ))).toHaveLength(1)

    failNext = true
    const duplicateAppendWhileRecorderIsDown = await store.append('run_1', {
      expectedSeq: 1,
      graphRevision: 1,
      commandId: 'command_validate',
      idempotencyKey: 'validate_1',
      event: {
        type: 'run_status_changed',
        payload: { from: 'draft', to: 'validating' }
      }
    })
    expect(duplicateAppendWhileRecorderIsDown).toMatchObject({
      duplicate: true,
      state: { status: 'validating', lastEventSeq: 2 }
    })
    expect(delivered).toHaveLength(1)
    expect(JSON.parse(await readFile(
      join(root, 'graphs', 'run_1', 'runtime-outbox.json'),
      'utf8'
    ))).toHaveLength(1)

    const duplicateAppend = await store.append('run_1', {
      expectedSeq: 1,
      graphRevision: 1,
      commandId: 'command_validate',
      idempotencyKey: 'validate_1',
      event: {
        type: 'run_status_changed',
        payload: { from: 'draft', to: 'validating' }
      }
    })
    expect(duplicateAppend).toMatchObject({
      duplicate: true,
      state: { status: 'validating', lastEventSeq: 2 }
    })
    expect(delivered.map((event) => (
      event.kind === 'graph_event' ? event.graph.eventId : undefined
    ))).toEqual([
      pendingCreate[0]!.eventId,
      appended.envelope.eventId
    ])
    expect(new Set(delivered.map((event) => (
      event.kind === 'graph_event' ? event.graph.eventId : undefined
    ))).size).toBe(2)
    expect(JSON.parse(await readFile(
      join(root, 'graphs', 'run_1', 'runtime-outbox.json'),
      'utf8'
    ))).toEqual([])
    expect(warning).toHaveBeenCalledTimes(4)
    expect(warning.mock.calls.every(([message]) => String(message).length < 600)).toBe(true)
  })

  it('serializes optimistic appends so only one stale writer commits', async () => {
    const { store } = await fixture()
    await createRun(store)
    const results = await Promise.allSettled([
      store.append('run_1', {
        expectedSeq: 1,
        graphRevision: 1,
        commandId: 'command_a',
        idempotencyKey: 'append_a',
        event: {
          type: 'run_status_changed',
          payload: { from: 'draft', to: 'validating' }
        }
      }),
      store.append('run_1', {
        expectedSeq: 1,
        graphRevision: 1,
        commandId: 'command_b',
        idempotencyKey: 'append_b',
        event: {
          type: 'run_status_changed',
          payload: { from: 'draft', to: 'cancelled' }
        }
      })
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejection = results.find((result) => result.status === 'rejected')
    expect(rejection).toMatchObject({ reason: expect.any(GraphRunConflictError) })
  })

  it('falls back to full journal replay when a snapshot is corrupted', async () => {
    const { root, store } = await fixture()
    await createRun(store)
    await store.append('run_1', {
      expectedSeq: 1,
      graphRevision: 1,
      event: {
        type: 'run_status_changed',
        payload: { from: 'draft', to: 'validating' }
      }
    })
    const before = await store.get('run_1')
    await writeFile(join(root, 'graphs', 'run_1', 'snapshot.json'), '{"corrupt":true}\n', 'utf8')
    expect(await store.get('run_1')).toEqual(before)
  })

  it('ignores a crash-truncated journal tail but rejects checksum corruption', async () => {
    const { root, store } = await fixture()
    await createRun(store)
    const journalPath = join(root, 'graphs', 'run_1', 'events.jsonl')
    await appendFile(journalPath, '{"checksum":"partial', 'utf8')
    expect((await store.get('run_1'))?.lastEventSeq).toBe(1)

    const text = await readFile(journalPath, 'utf8')
    const [first] = text.split('\n')
    const record = JSON.parse(first!) as { checksum: string }
    record.checksum = '0'.repeat(64)
    await writeFile(journalPath, `${JSON.stringify(record)}\n`, 'utf8')
    await expect(store.get('run_1')).rejects.toBeInstanceOf(GraphStoreCorruptionError)
  })

  it('validates legacy journal checksums before compatibility defaults are applied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-checksum-compat-'))
    roots.push(root)
    const store = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      config: () => testGraphConfig({ context: { maxInlineEventBytes: 64 * 1_024 } })
    })
    await createRun(store)
    const journalPath = join(root, 'graphs', 'run_1', 'events.jsonl')
    const record = JSON.parse((await readFile(journalPath, 'utf8')).trim()) as {
      checksum: string
      envelope: {
        event: {
          payload: {
            plan: {
              nodes: Array<{ assignment: { blockedTools?: string[] } }>
            }
          }
        }
      }
    }
    delete record.envelope.event.payload.plan.nodes[0]!.assignment.blockedTools
    record.checksum = checksumJsonForTest(record.envelope)
    await writeFile(journalPath, `${JSON.stringify(record)}\n`, 'utf8')

    const reloaded = new FileGraphRunStore({
      rootDir: join(root, 'graphs'),
      config: () => testGraphConfig()
    })
    await expect(reloaded.get('run_1')).resolves.toMatchObject({ id: 'run_1' })
  })

  it('requires a terminal state before physical removal', async () => {
    const { store } = await fixture()
    await createRun(store)
    await expect(store.remove('run_1')).rejects.toBeInstanceOf(GraphRunConflictError)
    await store.append('run_1', {
      expectedSeq: 1,
      graphRevision: 1,
      event: {
        type: 'run_status_changed',
        payload: { from: 'draft', to: 'cancelled' }
      }
    })
    await store.remove('run_1')
    expect(await store.get('run_1')).toBeNull()
  })

  it('compacts terminal journals behind a durable snapshot and still reloads truth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-compaction-'))
    roots.push(root)
    const options = {
      rootDir: join(root, 'graphs'),
      config: () => testGraphConfig({
        retention: { snapshotEveryEvents: 2, compactAfterEvents: 4 }
      })
    }
    const store = new FileGraphRunStore(options)
    await createRun(store)
    const transitions = [
      ['draft', 'validating'],
      ['validating', 'ready'],
      ['ready', 'running'],
      ['running', 'cancelled']
    ] as const
    for (const [from, to] of transitions) {
      const current = await store.get('run_1')
      await store.append('run_1', {
        expectedSeq: current!.lastEventSeq,
        graphRevision: 1,
        commandId: `command_${to}`,
        idempotencyKey: `transition_${to}`,
        event: { type: 'run_status_changed', payload: { from, to } }
      })
    }

    const journalPath = join(root, 'graphs', 'run_1', 'events.jsonl')
    const lines = (await readFile(journalPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).envelope.graphSeq).toBe(4)

    const snapshotPath = join(root, 'graphs', 'run_1', 'snapshot.json')
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as {
      checksum: string
      state: {
        plans: Array<{ nodes: Array<{ assignment: { blockedTools?: string[] } }> }>
      }
      recentCommands: unknown[]
    }
    delete snapshot.state.plans[0]!.nodes[0]!.assignment.blockedTools
    snapshot.checksum = checksumJsonForTest({
      state: snapshot.state,
      recentCommands: snapshot.recentCommands
    })
    await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`, 'utf8')

    const reloaded = new FileGraphRunStore(options)
    expect(await reloaded.get('run_1')).toMatchObject({
      status: 'cancelled',
      lastEventSeq: 5
    })
    expect((await reloaded.events('run_1', 0)).map((event) => event.graphSeq)).toEqual([4, 5])
    await expect(reloaded.append('run_1', {
      expectedSeq: 1,
      graphRevision: 1,
      commandId: 'command_validating',
      idempotencyKey: 'transition_validating',
      event: {
        type: 'run_status_changed',
        payload: { from: 'draft', to: 'validating' }
      }
    })).resolves.toMatchObject({
      duplicate: true,
      state: { lastEventSeq: 5 }
    })
    expect(await reloaded.eventReplay('run_1', 0)).toMatchObject({
      replayFloorSeq: 4,
      currentSeq: 5,
      snapshotSeq: 5,
      truncated: true
    })
  })

  it('compacts active journals and preserves replay plus compacted command idempotency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-active-compaction-'))
    roots.push(root)
    const options = {
      rootDir: join(root, 'graphs'),
      config: () => testGraphConfig({
        retention: { snapshotEveryEvents: 2, compactAfterEvents: 4 }
      })
    }
    const store = new FileGraphRunStore(options)
    await createRun(store)
    const transitions = [
      ['draft', 'validating'],
      ['validating', 'ready'],
      ['ready', 'running']
    ] as const
    for (const [from, to] of transitions) {
      const current = await store.get('run_1')
      await store.append('run_1', {
        expectedSeq: current!.lastEventSeq,
        graphRevision: 1,
        commandId: `command_${to}`,
        idempotencyKey: `transition_${to}`,
        event: { type: 'run_status_changed', payload: { from, to } }
      })
    }

    const journalPath = join(root, 'graphs', 'run_1', 'events.jsonl')
    const lines = (await readFile(journalPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).envelope.graphSeq).toBe(3)

    const reloaded = new FileGraphRunStore(options)
    await expect(reloaded.get('run_1')).resolves.toMatchObject({
      status: 'running',
      lastEventSeq: 4
    })
    const duplicate = await reloaded.append('run_1', {
      expectedSeq: 1,
      graphRevision: 1,
      commandId: 'command_validating',
      idempotencyKey: 'transition_validating',
      event: {
        type: 'run_status_changed',
        payload: { from: 'draft', to: 'validating' }
      }
    })
    expect(duplicate.duplicate).toBe(true)
    expect(duplicate.envelope.graphSeq).toBe(2)
    await expect(reloaded.eventReplay('run_1', 0)).resolves.toMatchObject({
      replayFloorSeq: 3,
      currentSeq: 4,
      snapshotSeq: 4,
      truncated: true,
      events: [
        expect.objectContaining({ graphSeq: 3 }),
        expect.objectContaining({ graphSeq: 4 })
      ]
    })
  })
})

function checksumJsonForTest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
