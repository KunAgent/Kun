import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphSupervisionObligationManager } from '../graph/graph-supervision-obligation-manager.js'
import { GraphRunConflictError } from '../graph/graph-run-store.js'
import {
  testGraphConfig,
  testGraphPlan
} from '../graph/graph-test-fixtures.test-support.js'
import { dispatchRequest } from '../server/http-server.js'
import type { ServiceManagerConnection } from './manager-client.js'
import { ManagerRemoteGraphRunStore } from './remote-data-stores.js'
import {
  ManagerSharedDataStore,
  type ManagerGraphStoreOperation
} from './shared-data-store.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'

const roots: string[] = []
const sharedStores: ManagerSharedDataStore[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  const stores = sharedStores.splice(0)
  const pendingRoots = roots.splice(0)
  try {
    await Promise.all(stores.map((store) => store.close()))
  } finally {
    await Promise.all(pendingRoots.map((root) =>
      rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })))
  }
})

describe('manager-backed Graph supervision CAS retries', () => {
  it('rehydrates append conflicts and rereads before persisting and updating one obligation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-manager-graph-supervision-retry-'))
    roots.push(root)
    const sharedData = await ManagerSharedDataStore.create(join(root, 'data'))
    sharedStores.push(sharedData)
    const config = testGraphConfig()
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-graph-retry',
      startedAt: '2026-08-10T00:00:00.000Z',
      state: new ServiceManagerState(),
      sharedData
    })
    const manager: ServiceManagerConnection = {
      discovery: {
        version: 1,
        protocolVersion: 3,
        instanceId: 'manager-graph-retry',
        pid: process.pid,
        startedAt: '2026-08-10T00:00:00.000Z',
        host: '127.0.0.1',
        port: 18700,
        baseUrl: 'http://127.0.0.1:18700',
        managerToken: 'manager-secret',
        serviceVersion: '0.1.0',
        dataDir: join(root, 'data'),
        settingsPath: join(root, 'kun-settings.json')
      }
    }

    const appendStatuses: number[] = []
    vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init)
      const response = await dispatchRequest(router, request)
      if (new URL(request.url).pathname === '/v1/data/graph/append') {
        appendStatuses.push(response.status)
      }
      return response
    }) as typeof fetch)

    const originalExecuteGraph = sharedData.executeGraph.bind(sharedData)
    let injectNextAppendConflict = false
    let injectedConflict = 0
    vi.spyOn(sharedData, 'executeGraph').mockImplementation(
      async (operation: ManagerGraphStoreOperation, value: unknown) => {
        if (operation === 'append' && injectNextAppendConflict) {
          injectNextAppendConflict = false
          injectedConflict += 1
          throw new GraphRunConflictError(`simulated manager CAS conflict ${injectedConflict}`)
        }
        return originalExecuteGraph(operation, value)
      }
    )

    const remote = new ManagerRemoteGraphRunStore(manager, () => config)
    const remoteConflicts: GraphRunConflictError[] = []
    const originalRemoteAppend = remote.append.bind(remote)
    vi.spyOn(remote, 'append').mockImplementation(async (runId, input) => {
      try {
        return await originalRemoteAppend(runId, input)
      } catch (error) {
        if (error instanceof GraphRunConflictError) remoteConflicts.push(error)
        throw error
      }
    })
    const getSpy = vi.spyOn(remote, 'get')

    await remote.create({
      runId: 'run_manager_graph_supervision_retry',
      threadId: 'thread_manager_graph_supervision_retry',
      projectId: 'project_manager_graph_supervision_retry',
      sourceTurnId: 'turn_manager_graph_supervision_retry',
      plan: testGraphPlan(),
      commandId: 'command_manager_graph_supervision_retry',
      idempotencyKey: 'manager-graph-supervision-retry:create'
    })

    let sequence = 0
    const nowMs = Date.parse('2026-08-10T00:00:00.000Z')
    const obligations = new GraphSupervisionObligationManager({
      store: remote,
      nowMs: () => nowMs,
      nowIso: () => new Date(nowMs).toISOString(),
      nextId: (prefix) => `${prefix}_${++sequence}`
    })
    const signal = {
      runId: 'run_manager_graph_supervision_retry',
      reason: 'help' as const,
      nodeIds: [] as string[],
      digest: 'The source Lead must inspect the manager-backed Graph run.'
    }

    const readsBeforePersist = getSpy.mock.calls.length
    injectNextAppendConflict = true
    const persisted = await obligations.persistSignal(signal, false)
    expect(persisted).toMatchObject({
      kind: 'help',
      state: 'pending',
      deliveryAttempts: 0,
      digest: signal.digest
    })
    expect(getSpy.mock.calls.length - readsBeforePersist).toBeGreaterThanOrEqual(2)

    const readsBeforeUpdate = getSpy.mock.calls.length
    injectNextAppendConflict = true
    const claimed = await obligations.claim(signal.runId, [persisted!.id])
    expect(claimed?.obligations).toEqual([
      expect.objectContaining({
        id: persisted!.id,
        kind: 'help',
        state: 'delivering',
        deliveryAttempts: 1
      })
    ])
    expect(getSpy.mock.calls.length - readsBeforeUpdate).toBeGreaterThanOrEqual(2)

    const [run, events] = await Promise.all([
      remote.get(signal.runId),
      remote.events(signal.runId)
    ])
    expect(run?.supervisionObligations).toEqual([
      expect.objectContaining({
        id: persisted!.id,
        kind: 'help',
        state: 'delivering',
        deliveryAttempts: 1,
        digest: signal.digest
      })
    ])
    expect(events.filter((entry) =>
      entry.event.type === 'supervision_obligation_opened')).toHaveLength(1)
    expect(events.filter((entry) =>
      entry.event.type === 'supervision_delivery_started')).toHaveLength(1)
    const persistedObligationIds = events.flatMap((entry) => {
      switch (entry.event.type) {
        case 'supervision_obligation_opened':
        case 'supervision_delivery_started':
          return [entry.event.payload.obligation.id]
        default:
          return []
      }
    })
    expect(persistedObligationIds).toEqual([
      persisted!.id,
      persisted!.id
    ])
    expect(appendStatuses).toEqual([409, 200, 409, 200])
    expect(remoteConflicts).toHaveLength(2)
    expect(remoteConflicts).toEqual([
      expect.objectContaining({ message: 'simulated manager CAS conflict 1' }),
      expect.objectContaining({ message: 'simulated manager CAS conflict 2' })
    ])
  })
})
