import { describe, expect, it, vi } from 'vitest'
import { dispatchRequest } from '../server/http-server.js'
import type { ManagerSharedDataStore } from './shared-data-store.js'
import { buildServiceManagerRouter, ServiceManagerState } from './service-manager.js'

describe('manager resource fencing', () => {
  it('does not acknowledge a lease until its fencing token is durably flushed', async () => {
    const state = new ServiceManagerState()
    let finishFlush!: () => void
    const flush = new Promise<void>((resolve) => { finishFlush = resolve })
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: new Date().toISOString(),
      state,
      flushState: () => flush
    })
    const responsePromise = dispatchRequest(router, request(
      '/v1/leases/resources/data%3Atest/acquire',
      { ownerFlavor: 'production', ownerInstanceId: 'runtime-1' },
      'POST'
    ))
    let settled = false
    void responsePromise.finally(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)

    finishFlush()
    const response = await responsePromise
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      acquired: true,
      lease: { fencingToken: 1 }
    })
  })

  it('blocks takeover while a fenced atomic commit is in flight', async () => {
    const state = new ServiceManagerState()
    const now = new Date()
    const resource = 'data:atomic-commit'
    const leaseA = state.acquireResource({
      resource, ownerFlavor: 'production', ownerInstanceId: 'runtime-a'
    }, now).lease
    let commitStarted!: () => void
    const started = new Promise<void>((resolve) => { commitStarted = resolve })
    let finishCommit!: () => void
    const finish = new Promise<void>((resolve) => { finishCommit = resolve })
    const writeAtomicJson = vi.fn(async (input: { beforeCommit?: () => void }) => {
      input.beforeCommit?.()
      commitStarted()
      await finish
      input.beforeCommit?.()
      return { revision: 1, value: { writer: 'runtime-a' } }
    })
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: now.toISOString(),
      state,
      flushState: async () => undefined,
      sharedData: { writeAtomicJson } as unknown as ManagerSharedDataStore
    })

    const responsePromise = dispatchRequest(router, request('/v1/data/atomic-json/write', {
      path: '/tmp/state.json',
      expectedRevision: 0,
      value: { writer: 'runtime-a' },
      fence: fence(leaseA)
    }))
    await started
    const blocked = state.acquireResource({
      resource, ownerFlavor: 'development', ownerInstanceId: 'runtime-b'
    }, new Date(now.getTime() + 5_000))
    expect(blocked.acquired).toBe(false)
    expect(blocked.lease.fencingToken).toBe(leaseA.fencingToken)
    expect(state.releaseResource(leaseA)).toBe(false)

    const renewed = state.renewResourceCommit(
      leaseA,
      blocked.lease.commitId!,
      new Date(now.getTime() + 9_000)
    )
    expect(renewed?.commitExpiresAt).toBe(new Date(now.getTime() + 19_000).toISOString())
    const stillBlocked = state.acquireResource({
      resource, ownerFlavor: 'development', ownerInstanceId: 'runtime-b'
    }, new Date(now.getTime() + 15_000))
    expect(stillBlocked.acquired).toBe(false)

    finishCommit()
    expect((await responsePromise).status).toBe(200)
    const leaseB = state.acquireResource({
      resource, ownerFlavor: 'development', ownerInstanceId: 'runtime-b'
    }, new Date(now.getTime() + 15_000)).lease
    expect(leaseB.fencingToken).toBe(leaseA.fencingToken + 1)
  })

  it('rejects a two-runtime stale atomic JSON writer before commit', async () => {
    const state = new ServiceManagerState()
    const resource = 'data:graph-write-coordinator'
    const staleLease = state.acquireResource({
      resource, ownerFlavor: 'production', ownerInstanceId: 'runtime-1'
    }, new Date('2026-08-01T00:00:00.000Z')).lease
    const currentLease = state.acquireResource({
      resource, ownerFlavor: 'development', ownerInstanceId: 'runtime-2'
    }, new Date('2026-08-01T00:00:11.000Z')).lease
    const writeAtomicJson = vi.fn()
    const router = buildServiceManagerRouter({
      managerToken: 'manager-secret',
      instanceId: 'manager-a',
      startedAt: '2026-08-01T00:00:00.000Z',
      state,
      sharedData: { writeAtomicJson } as unknown as ManagerSharedDataStore
    })

    expect(currentLease.fencingToken).toBe(staleLease.fencingToken + 1)
    const response = await dispatchRequest(router, request('/v1/data/atomic-json/write', {
      path: '/tmp/state.json',
      expectedRevision: 0,
      value: { writer: 'runtime-1' },
      fence: fence(staleLease)
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'resource_fence_stale' })
    expect(writeAtomicJson).not.toHaveBeenCalled()
    expect(state.validateResource(currentLease, new Date('2026-08-01T00:00:12.000Z'))).toBe(true)
  })
})

function fence(lease: {
  resource: string
  ownerFlavor: 'production' | 'development'
  ownerInstanceId: string
  fencingToken: number
}) {
  return {
    resource: lease.resource,
    ownerFlavor: lease.ownerFlavor,
    ownerInstanceId: lease.ownerInstanceId,
    fencingToken: lease.fencingToken
  }
}

function request(path: string, body: unknown, method = 'PUT'): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers: {
      authorization: 'Bearer manager-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}
