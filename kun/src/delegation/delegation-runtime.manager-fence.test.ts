import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { createThreadRecord } from '../domain/thread.js'
import { makeAssistantTextItem } from '../domain/item.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { startNodeHttpServer } from '../server/node-http-server.js'
import { buildServiceManagerRouter, ServiceManagerState } from '../manager/service-manager.js'
import { ManagerSharedDataStore } from '../manager/shared-data-store.js'
import { ManagerRemoteSessionStore, ManagerRemoteThreadStore } from '../manager/remote-data-stores.js'
import { ManagerThreadExecutionLeaseClient } from '../manager/manager-thread-execution-lease-client.js'
import { KUN_MANAGER_PROTOCOL_VERSION } from '../manager/manager-discovery.js'
import { currentTurnMutationFence, runWithTurnMutationFence } from '../manager/turn-mutation-context.js'
import { DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-child-fence-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const data = await ManagerSharedDataStore.create(root)
  cleanup.push(() => data.close())
  const startedAt = new Date().toISOString()
  const state = new ServiceManagerState()
  state.register({ flavor: 'development', instanceId: 'runtime-worker', pid: process.pid,
    startedAt, host: '127.0.0.1', port: 18899, baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'fixture' })
  const router = buildServiceManagerRouter({ managerToken: 'fixture', instanceId: 'manager', startedAt, state, sharedData: data })
  const server = await startNodeHttpServer({ router, host: '127.0.0.1', port: 0 })
  cleanup.push(() => server.close())
  const manager = { discovery: { version: 1 as const, protocolVersion: KUN_MANAGER_PROTOCOL_VERSION,
    instanceId: 'manager', pid: process.pid, startedAt, host: '127.0.0.1', port: server.port,
    baseUrl: `http://127.0.0.1:${server.port}`, managerToken: 'fixture', serviceVersion: '0.1.0',
    dataDir: root, settingsPath: join(root, 'settings.json') } }
  const sessions = new ManagerRemoteSessionStore(manager)
  const threads = new ManagerRemoteThreadStore(manager)
  const leases = new ManagerThreadExecutionLeaseClient(manager, 'development', 'runtime-worker')
  cleanup.push(() => leases.shutdown())
  const eventBus = new InMemoryEventBus()
  const events = new RuntimeEventRecorder({ eventBus, sessionStore: sessions,
    allocateSeq: (threadId) => sessions.allocateEventSeq(threadId), nowIso: () => new Date().toISOString() })
  await threads.upsert(createThreadRecord({ id: 'parent', title: 'Parent', workspace: root, model: 'fixture' }))
  return { root, sessions, threads, leases, eventBus, events }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('detached child lifecycle through Manager turn fencing', () => {
  it.each([false, true])('persists child progress after parent completion with next parent active=%s, while stale tool writes remain rejected', async (nextParent) => {
    const h = await fixture()
    const started = deferred(), progress = deferred(), finish = deferred()
    const childRuns = new FileDelegationStore(join(h.root, 'children'))
    const inheritedScopes: unknown[] = []
    const runtime = new DelegationRuntime({
      config: SubagentsCapabilityConfig.parse({ enabled: true, maxParallel: 1 }),
      store: childRuns, threadStore: h.threads, events: h.events, eventBus: h.eventBus,
      idGenerator: () => 'child-detached',
      executor: async (input) => {
        inheritedScopes.push(currentTurnMutationFence())
        await h.threads.upsert(createThreadRecord({ id: input.childId, title: 'Child', workspace: h.root, model: 'fixture' }))
        const own = await h.leases.acquire(input.childId, 'child-turn')
        started.resolve()
        await progress.promise
        try {
          await runWithTurnMutationFence(own, () => h.events.record({
            kind: 'assistant_text_delta', threadId: input.childId, turnId: 'child-turn',
            itemId: 'child-answer', item: makeAssistantTextItem({ id: 'child-answer',
              threadId: input.childId, turnId: 'child-turn', text: 'Still working after the parent completed.' })
          }))
          await finish.promise
          return { summary: 'Child completed after its parent.' }
        } finally {
          await h.leases.release(input.childId, 'child-turn')
        }
      }
    })
    const parent = await h.leases.acquire('parent', 'parent-turn')
    const record = await runWithTurnMutationFence(parent, () => runtime.runChild({
      parentThreadId: 'parent', parentTurnId: 'parent-turn', launcher: 'manager-worker',
      prompt: 'Keep working independently', detach: true, signal: new AbortController().signal
    }))
    await started.promise
    await h.leases.release('parent', 'parent-turn')
    if (nextParent) await h.leases.acquire('parent', 'next-parent-turn')
    progress.resolve()
    await vi.waitFor(async () => {
      const stored = await h.sessions.loadEventsSince('parent', 0)
      expect(stored.some((event) => event.child?.childId === record.id && event.child.activity?.phase === 'responding')).toBe(true)
    })
    finish.resolve()
    await vi.waitFor(async () => {
      const stored = await h.sessions.loadEventsSince('parent', 0)
      const completed = stored.find((event) => event.child?.childId === record.id && event.child.childStatus === 'completed')
      expect(completed?.child?.parentTurnId).toBe('parent-turn')
      expect(completed?.turnId).toBeUndefined()
    })
    expect(inheritedScopes).toEqual([undefined])
    expect(await childRuns.get(record.id)).toMatchObject({ status: 'completed' })
    expect((await h.sessions.loadEventsSince(record.id, 0)).some((event) => event.kind === 'assistant_text_delta')).toBe(true)
    await expect(runWithTurnMutationFence(parent, () => h.events.record({
      kind: 'assistant_text_delta', threadId: 'parent', turnId: 'parent-turn', itemId: 'stale-tool', item: makeAssistantTextItem({ id: 'stale-tool',
        threadId: 'parent', turnId: 'parent-turn', text: 'must not persist' })
    }))).rejects.toMatchObject({ code: 'stale_turn_fence' })
    expect((await h.sessions.loadEventsSince('parent', 0)).some((event) => event.itemId === 'stale-tool')).toBe(false)
  }, 15_000)
})
