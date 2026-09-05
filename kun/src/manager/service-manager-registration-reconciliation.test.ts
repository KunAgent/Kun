import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { dispatchRequest } from '../server/http-server.js'
import { buildServiceManagerRouter } from './service-manager-router.js'
import { ServiceManagerState } from './service-manager-state.js'
import { ManagerSharedDataStore } from './shared-data-store.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ))
})

describe('Runtime registration expired-lease barrier', () => {
  it('reclaims a dead owner and settles its turn before registering a replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-registration-reconcile-'))
    roots.push(root)
    const sharedData = await ManagerSharedDataStore.create(join(root, 'data'))
    const thread = createThreadRecord({
      id: 'thread-restart',
      title: 'Restart recovery',
      workspace: '/tmp/workspace',
      model: 'test-model'
    })
    const turn = createTurnRecord({
      id: 'turn-restart',
      threadId: thread.id,
      prompt: 'Keep working',
      status: 'running'
    })
    await sharedData.executeThread('upsert', {
      thread: { ...thread, status: 'running', turns: [turn] }
    })

    const now = new Date()
    const state = new ServiceManagerState()
    state.register(registration('runtime-old', now.toISOString(), 2_147_483_647), now)
    state.acquireLease({
      threadId: thread.id,
      turnId: turn.id,
      ownerFlavor: 'production',
      ownerInstanceId: 'runtime-old'
    }, now)
    const reconcile = vi.spyOn(sharedData, 'reconcileExpiredLease')
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-1',
      startedAt: now.toISOString(),
      state,
      sharedData,
      flushState: async () => undefined
    })

    const response = await dispatchRequest(router, new Request(
      'http://127.0.0.1/v1/runtimes/production/register',
      {
        method: 'PUT',
        headers: {
          authorization: 'Bearer manager-secret',
          'content-type': 'application/json'
        },
        body: JSON.stringify(registration('runtime-new', now.toISOString()))
      }
    ))

    expect(response.status).toBe(200)
    expect(reconcile).toHaveBeenCalledOnce()
    expect(state.registration('production')).toMatchObject({ instanceId: 'runtime-new' })
    expect(state.requiresTurnMutationFence(thread.id)).toBe(false)
    const persisted = await sharedData.executeThread('get', {
      threadId: thread.id
    }) as { turns: Array<{ status: string; terminalCode?: string; managerLeaseSettlement?: unknown }> }
    expect(persisted.turns[0]).toMatchObject({
      status: 'failed',
      terminalCode: 'owner_lease_expired',
      managerLeaseSettlement: expect.objectContaining({ ownerInstanceId: 'runtime-old' })
    })
    await sharedData.close()
  })

  it('does not admit a replacement when dead-owner reconciliation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-registration-reconcile-'))
    roots.push(root)
    const sharedData = await ManagerSharedDataStore.create(join(root, 'data'))
    const now = new Date()
    const state = new ServiceManagerState()
    state.register(registration('runtime-old', now.toISOString(), 2_147_483_647), now)
    state.acquireLease({
      threadId: 'thread-reconcile-failure',
      turnId: 'turn-reconcile-failure',
      ownerFlavor: 'production',
      ownerInstanceId: 'runtime-old'
    }, now)
    vi.spyOn(sharedData, 'reconcileExpiredLease')
      .mockRejectedValue(new Error('injected reconciliation failure'))
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-1',
      startedAt: now.toISOString(),
      state,
      sharedData,
      flushState: async () => undefined
    })

    await expect(dispatchRequest(router, new Request(
      'http://127.0.0.1/v1/runtimes/production/register',
      {
        method: 'PUT',
        headers: {
          authorization: 'Bearer manager-secret',
          'content-type': 'application/json'
        },
        body: JSON.stringify(registration('runtime-new', now.toISOString()))
      }
    ))).rejects.toThrow('injected reconciliation failure')
    expect(state.registration('production')).toBeNull()
    await sharedData.close()
  })
})

function registration(instanceId: string, startedAt: string, pid = process.pid) {
  return {
    flavor: 'production' as const,
    instanceId,
    pid,
    startedAt,
    host: '127.0.0.1',
    port: 18899,
    baseUrl: 'http://127.0.0.1:18899',
    runtimeToken: 'runtime-secret'
  }
}
