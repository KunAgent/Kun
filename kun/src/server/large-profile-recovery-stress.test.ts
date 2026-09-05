import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import type { SessionGuardian } from '../services/session-guardian.js'
import type { ThreadService } from '../services/thread-service.js'
import {
  createRuntimeMaintenanceSlices,
  MAINTENANCE_SLICE_MAX_MS
} from './runtime-maintenance-slices.js'
import { resetRuntimeLoadStateForTests } from './runtime-load-shedder.js'
import { ThreadReadCoordinator } from './thread-read-coordinator.js'

const roots: string[] = []

afterEach(async () => {
  resetRuntimeLoadStateForTests()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('large profile recovery stress fixture', () => {
  it('coalesces duplicate foreground recovery while slicing 200-thread maintenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-large-profile-stress-'))
    roots.push(root)
    const ids = Array.from({ length: 200 }, (_, index) => `thread-${index}`)
    const listPage = vi.fn(async (options?: { cursor?: string; limit?: number }) => {
      const start = Number(options?.cursor ?? 0)
      const page = ids.slice(start, start + (options?.limit ?? 8))
      const next = start + page.length
      return {
        threads: page.map((id) => ({ id, status: 'idle', updatedAt: id })),
        hasMore: next < ids.length,
        ...(next < ids.length ? { nextCursor: String(next) } : {})
      }
    })
    const get = vi.fn(async (id: string) => ({ id, turns: [{ attachmentIds: [`asset-${id}`] }] }))
    const pruneExpiredLeases = vi.fn(async () => undefined)
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: { listPage, get } as unknown as ThreadService,
      attachments: () => ({ pruneExpiredLeases }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn(async () => ({ warnings: [] })) } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })
    const reads = new ThreadReadCoordinator()
    let finishRead!: () => void
    const physicalRead = vi.fn(() => new Promise<void>((resolve) => { finishRead = resolve }))
    const joined = Array.from({ length: 20 }, () => reads.run('foreground:thread-1', 'foreground', physicalRead))
    expect(physicalRead).toHaveBeenCalledOnce()
    await expect(maintenance.runAttachmentSlice()).resolves.toBe(false)
    expect(get).not.toHaveBeenCalled()
    finishRead()
    await Promise.all(joined)

    for (let generation = 0; generation < 2; generation += 1) {
      let complete = false
      while (!complete) complete = await maintenance.runAttachmentSlice()
    }
    expect(get).toHaveBeenCalledTimes(400)
    expect(pruneExpiredLeases).toHaveBeenCalledOnce()
    expect(maintenance.stats()).toMatchObject({ processedThreads: 400 })
    expect(reads.stats()).toMatchObject({ started: 1, joined: 19, rejected: 0 })

    // Chunked appends + compacted files keep total write volume O(N); the old
    // cumulative whole-file rewrite grew quadratically with the thread count.
    const compactText = await readFile(join(root, 'maintenance-attachments', 'gen-1.json'), 'utf8')
    const compactBytes = Buffer.byteLength(compactText, 'utf8')
    expect(maintenance.stats().bytesWritten).toBeLessThanOrEqual(12 * compactBytes)
    // Wall time also includes shared-runner scheduling and filesystem sync;
    // the fake-timer unit test enforces the 50ms loop budget precisely.
    expect(maintenance.stats().maxDurationMs).toBeLessThanOrEqual(MAINTENANCE_SLICE_MAX_MS * 6)
  })
})
