import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { SessionGuardian } from '../services/session-guardian.js'
import { createRuntimeMaintenanceSlices, MAINTENANCE_GUARDIAN_PAGE_THREADS } from './runtime-maintenance-slices.js'
import { cleanupRoots, roots, threadHarness } from './runtime-maintenance-slices.test-helpers.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupRoots()
})

const now = '2026-10-19T08:00:00.000Z'

async function slicesWith(store: Partial<AttachmentStore>, threadCount = 10, guardian?: SessionGuardian) {
  const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-candidates-'))
  roots.push(root)
  const threads = threadHarness(threadCount)
  const slices = createRuntimeMaintenanceSlices({
    dataDir: root,
    threads: threads.service,
    attachments: () => store as AttachmentStore,
    guardian: guardian ?? { scanThread: vi.fn(async () => ({ warnings: [] })) } as unknown as SessionGuardian,
    nowIso: () => now
  })
  return { threads, slices }
}

describe('attachment pruning candidates', () => {
  it('completes a pass without reading threads when nothing could be pruned', async () => {
    const pruneExpiredLeases = vi.fn(async () => ({ deleted: 0, released: 0 }))
    const expiredLeaseCandidates = vi.fn(async () => [] as string[])
    const { threads, slices } = await slicesWith({ pruneExpiredLeases, expiredLeaseCandidates })

    await expect(slices.runAttachmentSlice()).resolves.toBe(true)
    expect(expiredLeaseCandidates).toHaveBeenCalledWith('2026-10-18T08:00:00.000Z')
    expect(threads.listPage).not.toHaveBeenCalled()
    expect(threads.get).not.toHaveBeenCalled()
    // Releasing leases here could delete an attachment that just became a candidate unchecked.
    expect(pruneExpiredLeases).not.toHaveBeenCalled()
  })

  it('collects every reference before pruning when a candidate exists', async () => {
    const pruneExpiredLeases = vi.fn(async (_references: ReadonlySet<string>, _expiresBeforeIso: string) =>
      ({ deleted: 0, released: 0 }))
    const expiredLeaseCandidates = vi.fn(async () => ['attachment-thread-3'])
    const { threads, slices } = await slicesWith({ pruneExpiredLeases, expiredLeaseCandidates })

    for (let pass = 0; pass < 2; pass += 1) {
      while (!await slices.runAttachmentSlice()) { /* finish the pass */ }
    }
    expect(threads.get).toHaveBeenCalledTimes(20)
    expect(pruneExpiredLeases).toHaveBeenCalledOnce()
    expect(pruneExpiredLeases.mock.calls[0]![0]).toEqual(new Set(threads.ids.map((id) => `attachment-${id}`)))
    // Candidates are checked once per pass, not once per slice.
    expect(expiredLeaseCandidates).toHaveBeenCalledTimes(2)
  })

  it('keeps the full pass when the Manager cannot list candidates', async () => {
    const pruneExpiredLeases = vi.fn(async () => ({ deleted: 0, released: 0 }))
    const expiredLeaseCandidates = vi.fn(async () => { throw new Error('invalid attachment-store operation') })
    const { threads, slices } = await slicesWith({ pruneExpiredLeases, expiredLeaseCandidates })
    while (!await slices.runAttachmentSlice()) { /* finish the pass */ }
    expect(threads.get).toHaveBeenCalledTimes(10)
  })
})

describe('guardian page reuse', () => {
  it('lists each page once while slower scans split it across slices', async () => {
    const scanThread = vi.fn(async (threadId: string) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { threadId, warnings: [] }
    })
    const count = MAINTENANCE_GUARDIAN_PAGE_THREADS + 6
    const { threads, slices } = await slicesWith({}, count, { scanThread } as unknown as SessionGuardian)
    let passes = 0
    while (!await slices.runGuardianSlice()) passes += 1
    expect(passes).toBeGreaterThan(2)
    expect(scanThread).toHaveBeenCalledTimes(count)
    expect(threads.listPage).toHaveBeenCalledTimes(2)
  })
})
