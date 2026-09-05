import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testGraphConfig } from './graph-test-fixtures.test-support.js'
import { GraphAttemptLeaseManager } from './graph-attempt-leases.js'
import { FileGraphWriteCoordinator } from './graph-write-coordinator.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  ))
})

describe('GraphAttemptLeaseManager', () => {
  it('treats a concurrently accepted persisted lease as already integrated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-graph-attempt-lease-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    const config = testGraphConfig({ writeIsolation: { mode: 'lease' } })
    const writes = new FileGraphWriteCoordinator({
      rootDir: join(root, 'writes'),
      config: () => config
    })
    const manager = new GraphAttemptLeaseManager({ writes, config: () => config })
    const claim = await writes.acquire({
      runId: 'run_1',
      nodeId: 'node_1',
      attemptId: 'attempt_1',
      workspaceRoot: workspace,
      scopes: []
    })
    if (!claim.acquired) throw new Error('expected the test lease to be acquired')

    manager.track('attempt_1', claim.lease)
    await writes.release(claim.lease.leaseId, 'accepted')

    await expect(manager.integrate('attempt_1')).resolves.toBe('applied')
  })

  it('rechecks durable acceptance when release races the active check', async () => {
    const activeLease = {
      leaseId: 'lease_1',
      runId: 'run_1',
      nodeId: 'node_1',
      attemptId: 'attempt_1',
      workspaceRoot: 'C:\\workspace',
      scopes: [],
      state: 'active' as const,
      acquiredAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-02T01:00:00.000Z'
    }
    const acceptedLease = {
      ...activeLease,
      state: 'released' as const,
      releasedAt: '2026-08-02T00:00:01.000Z',
      releaseDisposition: 'accepted' as const
    }
    const writes = {
      list: vi.fn()
        .mockResolvedValueOnce({ leases: [activeLease], worktrees: [] })
        .mockResolvedValueOnce({ leases: [acceptedLease], worktrees: [] }),
      isActive: vi.fn().mockResolvedValue(false),
      captureWorktree: vi.fn(),
      integrate: vi.fn(),
      release: vi.fn()
    }
    const config = testGraphConfig({ writeIsolation: { mode: 'lease' } })
    const manager = new GraphAttemptLeaseManager({
      writes: writes as unknown as FileGraphWriteCoordinator,
      config: () => config
    })
    manager.track('attempt_1', activeLease)

    await expect(manager.integrate('attempt_1')).resolves.toBe('applied')
    expect(writes.list).toHaveBeenCalledTimes(2)
    expect(writes.captureWorktree).not.toHaveBeenCalled()
  })

  it('stops heartbeats when an accepted durable release fails', async () => {
    vi.useFakeTimers()
    try {
      const lease = activeLeaseFixture()
      const writes = {
        list: vi.fn().mockResolvedValue({ leases: [lease], worktrees: [] }),
        isActive: vi.fn().mockResolvedValue(true),
        captureWorktree: vi.fn().mockResolvedValue(undefined),
        integrate: vi.fn(),
        renew: vi.fn().mockResolvedValue(undefined),
        release: vi.fn().mockRejectedValue(new Error('durable release failed'))
      }
      const config = testGraphConfig({
        writeIsolation: { mode: 'lease', leaseTtlMs: 3_000 }
      })
      const manager = new GraphAttemptLeaseManager({
        writes: writes as unknown as FileGraphWriteCoordinator,
        config: () => config
      })
      manager.track('attempt_1', lease)
      manager.startHeartbeat({
        runId: 'run_1',
        attemptId: 'attempt_1',
        lease,
        abort: new AbortController(),
        onRenewalFailure: vi.fn()
      })

      await expect(manager.integrate('attempt_1')).rejects.toThrow('durable release failed')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(writes.renew).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops heartbeats when a failed-attempt release cannot be persisted', async () => {
    vi.useFakeTimers()
    try {
      const lease = activeLeaseFixture()
      const writes = {
        renew: vi.fn().mockResolvedValue(undefined),
        release: vi.fn().mockRejectedValue(new Error('release unavailable'))
      }
      const config = testGraphConfig({
        writeIsolation: { mode: 'lease', leaseTtlMs: 3_000 }
      })
      const manager = new GraphAttemptLeaseManager({
        writes: writes as unknown as FileGraphWriteCoordinator,
        config: () => config
      })
      manager.track('attempt_1', lease)
      manager.startHeartbeat({
        runId: 'run_1',
        attemptId: 'attempt_1',
        lease,
        abort: new AbortController(),
        onRenewalFailure: vi.fn()
      })

      await expect(manager.release('attempt_1', 'failed')).rejects.toThrow('release unavailable')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(writes.renew).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

function activeLeaseFixture() {
  return {
    leaseId: 'lease_1',
    runId: 'run_1',
    nodeId: 'node_1',
    attemptId: 'attempt_1',
    workspaceRoot: '/workspace',
    scopes: [],
    state: 'active' as const,
    acquiredAt: '2026-08-02T00:00:00.000Z',
    expiresAt: '2026-08-02T01:00:00.000Z'
  }
}
