import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadService } from '../services/thread-service.js'
import type { SessionGuardian } from '../services/session-guardian.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import { createRuntimeMaintenanceSlices } from './runtime-maintenance-slices.js'
import { cleanupRoots, roots, threadHarness } from './runtime-maintenance-slices.test-helpers.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupRoots()
})

describe('runtime maintenance slices single-flight', () => {
  it('joins a timed-out read instead of restarting it, then consumes the settled result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-overshoot-'))
    roots.push(root)
    const ids = ['thread-0', 'thread-1']
    const listPage = vi.fn(async () => ({
      threads: ids.map((id) => ({ id, status: 'idle', updatedAt: id })),
      hasMore: false
    }))
    let resolveFirst!: (value: { id: string; turns: Array<{ attachmentIds: string[] }> }) => void
    const get = vi.fn((id: string) => {
      if (get.mock.calls.length === 1) {
        return new Promise((resolve) => { resolveFirst = resolve })
      }
      return Promise.resolve({ id, turns: [{ attachmentIds: [`a-${id}`] }] })
    })
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: { listPage, get } as unknown as ThreadService,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    await expect(maintenance.runAttachmentSlice()).resolves.toBe(false)
    expect(maintenance.stats().overshoots).toBe(1)
    expect(maintenance.stats().processedThreads).toBe(0)

    // The still-pending read must be joined, not restarted: single-flight
    // prevents stacking a second full-file read on the same thread. The join
    // times out against the same 50ms slice deadline under real timers.
    await expect(maintenance.runAttachmentSlice()).resolves.toBe(false)
    expect(get).toHaveBeenCalledTimes(1)
    expect(maintenance.stats().overshoots).toBe(2)

    resolveFirst({ id: 'thread-0', turns: [{ attachmentIds: ['a-thread-0'] }] })
    await expect(maintenance.runAttachmentSlice()).resolves.toBe(true)
    expect(maintenance.stats().processedThreads).toBe(2)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('joins a timed-out guardian scan and consumes it once settled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-guardian-join-'))
    roots.push(root)
    const threads = threadHarness(2)
    let resolveScan!: (value: { threadId: string; warnings: string[] }) => void
    const scanThread = vi.fn((id: string) => {
      if (scanThread.mock.calls.length === 1) {
        return new Promise<{ threadId: string; warnings: string[] }>((resolve) => {
          resolveScan = resolve
        })
      }
      return Promise.resolve({ threadId: id, warnings: [] })
    })
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: threads.service,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    await expect(maintenance.runGuardianSlice()).resolves.toBe(false)
    expect(maintenance.stats().overshoots).toBe(1)

    // The pending scan is joined, not restarted: the second slice times out
    // waiting on the same underlying scanThread promise.
    await expect(maintenance.runGuardianSlice()).resolves.toBe(false)
    expect(scanThread).toHaveBeenCalledTimes(1)
    expect(maintenance.stats().overshoots).toBe(2)

    resolveScan({ threadId: 'thread-0', warnings: [] })
    await expect(maintenance.runGuardianSlice()).resolves.toBe(true)
    expect(maintenance.stats().processedThreads).toBe(2)
    expect(scanThread).toHaveBeenCalledTimes(2)
  })

  it('evicts a rejected flight so the next slice restarts the read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-flight-reject-'))
    roots.push(root)
    const ids = ['thread-0', 'thread-1']
    const listPage = vi.fn(async () => ({
      threads: ids.map((id) => ({ id, status: 'idle', updatedAt: id })),
      hasMore: false
    }))
    let rejectFirst!: (reason?: unknown) => void
    const get = vi.fn((id: string) => {
      if (get.mock.calls.length === 1) {
        return new Promise((_resolve, reject) => { rejectFirst = reject })
      }
      return Promise.resolve({ id, turns: [{ attachmentIds: [`a-${id}`] }] })
    })
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: { listPage, get } as unknown as ThreadService,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    await expect(maintenance.runAttachmentSlice()).resolves.toBe(false)
    expect(maintenance.stats().overshoots).toBe(1)

    rejectFirst(new Error('read failed'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The rejected entry self-evicted, so the next slice starts a fresh read
    // for thread-0 and proceeds to thread-1 (three get calls in total).
    await expect(maintenance.runAttachmentSlice()).resolves.toBe(true)
    expect(get).toHaveBeenCalledTimes(3)
    expect(maintenance.stats().processedThreads).toBe(2)
  })

  it('keeps a pending flight past the TTL instead of restarting it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-flight-pending-ttl-'))
    roots.push(root)
    const ids = ['thread-0']
    const listPage = vi.fn(async () => ({
      threads: ids.map((id) => ({ id, status: 'idle', updatedAt: id })),
      hasMore: false
    }))
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let resolveGet!: (value: { id: string; turns: Array<{ attachmentIds: string[] }> }) => void
    const get = vi.fn((id: string) => {
      if (get.mock.calls.length === 1) {
        return new Promise((resolve) => { resolveGet = resolve })
      }
      return Promise.resolve({ id, turns: [{ attachmentIds: [`a-${id}`] }] })
    })
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: { listPage, get } as unknown as ThreadService,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    await expect(maintenance.runAttachmentSlice()).resolves.toBe(false)
    expect(get).toHaveBeenCalledTimes(1)

    // 11 minutes pass while the read is still pending. The still-pending
    // flight must be joined, not evicted and restarted.
    now = 11 * 60_000
    await expect(maintenance.runAttachmentSlice()).resolves.toBe(false)
    expect(get).toHaveBeenCalledTimes(1)

    resolveGet({ id: 'thread-0', turns: [{ attachmentIds: ['a-thread-0'] }] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(maintenance.runAttachmentSlice()).resolves.toBe(true)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('reuses a settled flight within the TTL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-flight-settled-reuse-'))
    roots.push(root)
    const ids = ['thread-0']
    const listPage = vi.fn(async () => ({
      threads: ids.map((id) => ({ id, status: 'idle', updatedAt: id })),
      hasMore: false
    }))
    let resolveGet!: (value: { id: string; turns: Array<{ attachmentIds: string[] }> }) => void
    const get = vi.fn((id: string) => {
      if (get.mock.calls.length === 1) {
        return new Promise((resolve) => { resolveGet = resolve })
      }
      return Promise.resolve({ id, turns: [{ attachmentIds: [`a-${id}`] }] })
    })
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: { listPage, get } as unknown as ThreadService,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    await expect(maintenance.runAttachmentSlice()).resolves.toBe(false)
    expect(get).toHaveBeenCalledTimes(1)

    // Settle the previously timed-out read; it stays cached as a settled
    // flight and the next slice reuses it without a second read.
    resolveGet({ id: 'thread-0', turns: [{ attachmentIds: ['a-thread-0'] }] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(maintenance.runAttachmentSlice()).resolves.toBe(true)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('evicts a settled flight after the TTL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-flight-settled-ttl-'))
    roots.push(root)
    const ids = ['thread-0']
    const listPage = vi.fn(async () => ({
      threads: ids.map((id) => ({ id, status: 'idle', updatedAt: id })),
      hasMore: false
    }))
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let resolveGet!: (value: { id: string; turns: Array<{ attachmentIds: string[] }> }) => void
    const get = vi.fn((id: string) => {
      if (get.mock.calls.length === 1) {
        return new Promise((resolve) => { resolveGet = resolve })
      }
      return Promise.resolve({ id, turns: [{ attachmentIds: [`a-${id}`] }] })
    })
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: { listPage, get } as unknown as ThreadService,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    await expect(maintenance.runAttachmentSlice()).resolves.toBe(false)
    expect(get).toHaveBeenCalledTimes(1)

    resolveGet({ id: 'thread-0', turns: [{ attachmentIds: ['a-thread-0'] }] })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 11 minutes pass since settlement: the settled flight is past its
    // result TTL, so the next slice evicts it and starts a fresh read.
    now = 11 * 60_000
    await expect(maintenance.runAttachmentSlice()).resolves.toBe(true)
    expect(get).toHaveBeenCalledTimes(2)
  })
})
