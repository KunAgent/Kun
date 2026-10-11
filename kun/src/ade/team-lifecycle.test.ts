import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAdeThreadDeleted } from './team-lifecycle.js'
import { FileTeamStore } from './team-store.js'

let dataDir: string
let teams: FileTeamStore

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'kun-ade-lifecycle-'))
  teams = new FileTeamStore(dataDir)
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

const NOW = '2026-09-26T02:00:00.000Z'

function makeTeam() {
  return teams.ensure('thr_mgr').then(async (team) => {
    await teams.upsertWorker('thr_mgr', {
      workerId: 'wrk_1',
      label: 'implementer',
      route: { harnessId: 'kun', model: 'model-x', credentialMode: 'provider' },
      permissionMode: 'default',
      lifecycle: 'persistent',
      securitySnapshot: { sandboxRoot: '/tmp/ws', memoryEnabled: false },
      control: 'manager',
      state: 'active',
      createdAt: NOW
    })
    await teams.upsertWorker('thr_mgr', {
      workerId: 'wrk_2',
      label: 'reviewer',
      route: { harnessId: 'kun', model: 'model-x', credentialMode: 'provider' },
      permissionMode: 'default',
      lifecycle: 'ephemeral',
      securitySnapshot: { sandboxRoot: '/tmp/ws', memoryEnabled: false },
      control: 'manager',
      state: 'active',
      createdAt: NOW
    })
    return team
  })
}

describe('handleAdeThreadDeleted', () => {
  it('deleting a manager thread removes the team dir and revokes worker grants', async () => {
    await makeTeam()
    const revoke = vi.fn()
    await handleAdeThreadDeleted({
      thread: { id: 'thr_mgr' },
      teams,
      revokeThreadGrants: revoke,
      nowIso: () => NOW
    })
    expect(revoke.mock.calls.map((call) => call[0]).sort()).toEqual(['wrk_1', 'wrk_2'])
    expect(await teams.byManager('thr_mgr')).toBeNull()
  })

  it('deleting a worker thread marks its team record released', async () => {
    await makeTeam()
    const revoke = vi.fn()
    await handleAdeThreadDeleted({
      thread: {
        id: 'wrk_1',
        executionUnit: {
          kind: 'worker',
          teamId: 'thr_mgr',
          managerThreadId: 'thr_mgr',
          label: 'implementer',
          lifecycle: 'persistent',
          control: 'manager'
        }
      },
      teams,
      revokeThreadGrants: revoke,
      nowIso: () => NOW
    })
    const worker = await teams.worker('thr_mgr', 'wrk_1')
    expect(worker?.state).toBe('released')
    expect(worker?.releasedAt).toBe(NOW)
    expect(revoke).not.toHaveBeenCalled()
    // The team itself survives; the other worker stays active.
    expect((await teams.byManager('thr_mgr'))?.workers).toHaveLength(2)
  })

  it('ignores threads without a team or execution unit', async () => {
    const revoke = vi.fn()
    await handleAdeThreadDeleted({
      thread: { id: 'thr_unrelated' },
      teams,
      revokeThreadGrants: revoke,
      nowIso: () => NOW
    })
    await handleAdeThreadDeleted({
      thread: null,
      teams,
      revokeThreadGrants: revoke,
      nowIso: () => NOW
    })
    expect(revoke).not.toHaveBeenCalled()
  })
})
