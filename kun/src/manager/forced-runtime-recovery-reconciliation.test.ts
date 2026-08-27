import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadExecutionLease } from '../contracts/runtime-flavor.js'
import {
  recordVerifiedForcedRuntimeOwner,
  readForcedRuntimeRecovery,
  type ForcedRuntimeRecoveryOwner
} from './forced-runtime-recovery.js'
import type { ManagerSharedDataStore } from './shared-data-store.js'
import {
  reconcileVerifiedForcedRuntimeRecovery,
  ServiceManagerState
} from './service-manager.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-forced-recovery-groups-'))
  roots.push(root)
  const controlDir = join(root, 'control')
  const currentDataDir = join(root, 'current-data')
  const legacyDataDir = join(root, 'legacy-data')
  await mkdir(currentDataDir, { recursive: true })
  await symlink(currentDataDir, legacyDataDir, process.platform === 'win32' ? 'junction' : 'dir')
  return {
    controlDir,
    currentDataDir,
    legacyDataDir,
    unrelatedDataDir: join(root, 'unrelated-data')
  }
}

function registration(flavor: 'production' | 'development', instanceId: string, pid: number) {
  return {
    flavor,
    instanceId,
    pid,
    startedAt: '2026-08-21T00:00:00.000Z',
    host: '127.0.0.1',
    port: flavor === 'production' ? 18899 : 18999,
    baseUrl: `http://127.0.0.1:${flavor === 'production' ? 18899 : 18999}`,
    runtimeToken: `${flavor}-token`
  }
}

function lease(threadId: string, owner: ReturnType<typeof registration>): ThreadExecutionLease {
  return {
    threadId,
    turnId: `turn-${threadId}`,
    ownerFlavor: owner.flavor,
    ownerInstanceId: owner.instanceId,
    acquiredAt: '2026-08-21T00:00:00.000Z',
    expiresAt: '2026-08-21T00:01:00.000Z'
  }
}

async function recordOwners(input: {
  controlDir: string
  groups: Array<{ dataDir: string; owners: ReturnType<typeof registration>[] }>
}) {
  let marker!: Awaited<ReturnType<typeof recordVerifiedForcedRuntimeOwner>>
  for (const group of input.groups) {
    for (const registration of group.owners) {
      marker = await recordVerifiedForcedRuntimeOwner({
        controlDir: input.controlDir,
        dataDir: group.dataDir,
        owner: {
          flavor: registration.flavor,
          instanceId: registration.instanceId,
          pid: registration.pid,
          startedAt: registration.startedAt
        }
      })
    }
  }
  return marker
}

function sharedData(reconciled: ThreadExecutionLease[], fail = false) {
  return {
    reconcileExpiredLease: vi.fn(async (entry: ThreadExecutionLease) => {
      if (fail) throw new Error('reconcile failed')
      reconciled.push(entry)
      return true
    })
  } as Pick<ManagerSharedDataStore, 'reconcileExpiredLease'>
}

describe('forced Runtime recovery reconciliation', () => {
  it('consumes legacy and current aliases in the current data plane', async () => {
    const test = await fixture()
    const state = new ServiceManagerState()
    const current = registration('production', 'production-current', 4101)
    const legacy = registration('development', 'development-legacy', 4102)
    state.register(current)
    state.register(legacy)
    state.acquireLease({
      threadId: 'thread-current',
      turnId: 'turn-current',
      ownerFlavor: current.flavor,
      ownerInstanceId: current.instanceId
    }, new Date('2026-08-21T00:00:00.000Z'))
    state.acquireLease({
      threadId: 'thread-legacy',
      turnId: 'turn-legacy',
      ownerFlavor: legacy.flavor,
      ownerInstanceId: legacy.instanceId
    }, new Date('2026-08-21T00:00:00.000Z'))
    state.acquireResource({
      resource: 'legacy-resource',
      ownerFlavor: legacy.flavor,
      ownerInstanceId: legacy.instanceId
    }, new Date('2026-08-21T00:00:00.000Z'))
    const marker = await recordOwners({
      controlDir: test.controlDir,
      groups: [
        { dataDir: test.currentDataDir, owners: [current] },
        { dataDir: test.legacyDataDir, owners: [legacy] }
      ]
    })
    const reconciled: ThreadExecutionLease[] = []
    let flushed = false

    await expect(reconcileVerifiedForcedRuntimeRecovery({
      controlDir: test.controlDir,
      dataDir: test.currentDataDir,
      record: marker,
      state,
      sharedData: sharedData(reconciled),
      flushState: async () => { flushed = true }
    })).resolves.toBe(2)

    expect(flushed).toBe(true)
    expect(state.registration('production')).toBeNull()
    expect(state.registration('development')).toBeNull()
    expect(state.lease('thread-current')).toBeNull()
    expect(state.lease('thread-legacy')).toBeNull()
    expect(reconciled.map((entry) => entry.threadId).sort()).toEqual([
      'thread-current',
      'thread-legacy'
    ])
    expect(await readForcedRuntimeRecovery(test.controlDir)).toBeNull()
  })

  it('keeps unrelated and failed recovery evidence instead of consuming it', async () => {
    const test = await fixture()
    const current = registration('production', 'production-current', 4101)
    const unrelated = registration('development', 'development-unrelated', 4103)
    const state = new ServiceManagerState()
    state.register(current)
    state.acquireLease({
      threadId: 'thread-current',
      turnId: 'turn-current',
      ownerFlavor: current.flavor,
      ownerInstanceId: current.instanceId
    }, new Date('2026-08-21T00:00:00.000Z'))
    const marker = await recordOwners({
      controlDir: test.controlDir,
      groups: [
        { dataDir: test.currentDataDir, owners: [current] },
        { dataDir: test.unrelatedDataDir, owners: [unrelated] }
      ]
    })

    await expect(reconcileVerifiedForcedRuntimeRecovery({
      controlDir: test.controlDir,
      dataDir: test.currentDataDir,
      record: marker,
      state,
      sharedData: sharedData([], true),
      flushState: async () => undefined
    })).rejects.toThrow('reconcile failed')
    const afterFailure = await readForcedRuntimeRecovery(test.controlDir)
    expect(afterFailure?.owners.map((owner) => owner.instanceId).sort()).toEqual([
      'development-unrelated',
      'production-current'
    ])

    const unrelatedOnlyState = new ServiceManagerState()
    await expect(reconcileVerifiedForcedRuntimeRecovery({
      controlDir: test.controlDir,
      dataDir: join(test.controlDir, 'another-data'),
      record: marker,
      state: unrelatedOnlyState,
      sharedData: sharedData([]),
      flushState: async () => undefined
    })).resolves.toBe(0)
    expect(await readForcedRuntimeRecovery(test.controlDir)).toMatchObject({
      markerId: marker.markerId,
      owners: expect.arrayContaining([
        expect.objectContaining({ instanceId: 'production-current' }),
        expect.objectContaining({ instanceId: 'development-unrelated' })
      ])
    })

    const recovered: ThreadExecutionLease[] = []
    await expect(reconcileVerifiedForcedRuntimeRecovery({
      controlDir: test.controlDir,
      dataDir: test.currentDataDir,
      record: marker,
      state: new ServiceManagerState(),
      sharedData: sharedData(recovered),
      flushState: async () => undefined
    })).resolves.toBe(0)
    const remaining = await readForcedRuntimeRecovery(test.controlDir)
    expect(remaining?.owners.map((owner: ForcedRuntimeRecoveryOwner) => owner.instanceId))
      .toEqual(['development-unrelated'])
  })
})
