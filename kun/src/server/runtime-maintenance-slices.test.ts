import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadService } from '../services/thread-service.js'
import type { SessionGuardian } from '../services/session-guardian.js'
import type { AttachmentStore } from '../attachments/attachment-store.js'
import {
  createRuntimeMaintenanceSlices,
  MAINTENANCE_SLICE_MAX_MS
} from './runtime-maintenance-slices.js'
import { cleanupRoots, roots, threadHarness } from './runtime-maintenance-slices.test-helpers.js'

afterEach(async () => {
  vi.restoreAllMocks()
  await cleanupRoots()
})

describe('runtime maintenance slices', () => {
  it('persists progress and waits for two complete reference generations before pruning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-resume-'))
    roots.push(root)
    const threads = threadHarness(10)
    const pruneExpiredLeases = vi.fn(async (
      _references: ReadonlySet<string>,
      _expiresBeforeIso: string
    ) => undefined)
    const attachmentStore = { pruneExpiredLeases } as unknown as AttachmentStore
    const guardian = { scanThread: vi.fn(async () => ({ warnings: [] })) } as unknown as SessionGuardian
    const create = () => createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: threads.service,
      attachments: () => attachmentStore,
      guardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    const first = create()
    await expect(first.runAttachmentSlice()).resolves.toBe(false)
    expect(pruneExpiredLeases).not.toHaveBeenCalled()
    const resumed = create()
    await expect(resumed.runAttachmentSlice()).resolves.toBe(true)
    expect(pruneExpiredLeases).not.toHaveBeenCalled()
    await expect(resumed.runAttachmentSlice()).resolves.toBe(false)
    await expect(resumed.runAttachmentSlice()).resolves.toBe(true)

    expect(pruneExpiredLeases).toHaveBeenCalledOnce()
    const references = pruneExpiredLeases.mock.calls[0]![0] as Set<string>
    expect(references.size).toBe(10)
    expect(threads.get).toHaveBeenCalledTimes(20)
  })

  it('pauses without touching the inventory while a turn is active', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-paused-'))
    roots.push(root)
    const threads = threadHarness(20)
    const slices = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: threads.service,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z',
      hasActiveTurns: async () => true
    })

    await expect(slices.runAttachmentSlice()).resolves.toBe(false)
    await expect(slices.runGuardianSlice()).resolves.toBe(false)
    expect(threads.listPage).not.toHaveBeenCalled()
    expect(slices.stats()).toMatchObject({ paused: 2, processedThreads: 0 })
  })

  it('migrates a v1 state file without losing the prune safety set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-migrate-'))
    roots.push(root)
    const threads = threadHarness(10)
    const pruneExpiredLeases = vi.fn(async (
      _references: ReadonlySet<string>,
      _expiresBeforeIso: string
    ) => undefined)
    const attachmentStore = { pruneExpiredLeases } as unknown as AttachmentStore
    const guardian = { scanThread: vi.fn(async () => ({ warnings: [] })) } as unknown as SessionGuardian
    await writeFile(join(root, 'maintenance-state.json'), JSON.stringify({
      version: 1,
      attachments: {
        generation: 2,
        references: ['attachment-thread-0'],
        previousReferences: ['attachment-thread-0', 'attachment-thread-1']
      },
      guardian: {}
    }))

    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: threads.service,
      attachments: () => attachmentStore,
      guardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    let complete = false
    while (!complete) complete = await maintenance.runAttachmentSlice()

    // The migrated previousReferences become generation 1's compacted file, so
    // a single full pass over generation 2 is enough to trigger prune.
    expect(pruneExpiredLeases).toHaveBeenCalledOnce()
    const safeReferences = pruneExpiredLeases.mock.calls[0]![0] as Set<string>
    expect(safeReferences.has('attachment-thread-0')).toBe(true)
    expect(safeReferences.has('attachment-thread-1')).toBe(true)
    expect(safeReferences.size).toBe(10)

    const persisted = JSON.parse(await readFile(join(root, 'maintenance-state.json'), 'utf8')) as {
      version: number
      attachments: { references?: unknown }
    }
    expect(persisted.version).toBe(3)
    expect(persisted.attachments.references).toBeUndefined()
  })

  it('dedupes duplicate and malformed chunk lines across a crash recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-dedupe-'))
    roots.push(root)
    const threads = threadHarness(10)
    const pruneExpiredLeases = vi.fn(async (
      _references: ReadonlySet<string>,
      _expiresBeforeIso: string
    ) => undefined)
    const attachmentStore = { pruneExpiredLeases } as unknown as AttachmentStore
    const guardian = { scanThread: vi.fn(async () => ({ warnings: [] })) } as unknown as SessionGuardian
    await mkdir(join(root, 'maintenance-attachments'), { recursive: true })
    await writeFile(join(root, 'maintenance-attachments', 'gen-0.jsonl'), [
      JSON.stringify(['attachment-thread-0', 'attachment-thread-0', 'stale-extra']),
      'not-a-json-line',
      JSON.stringify(['attachment-thread-1'])
    ].join('\n') + '\n')

    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: threads.service,
      attachments: () => attachmentStore,
      guardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    let complete = false
    while (!complete) complete = await maintenance.runAttachmentSlice()
    const compacted = JSON.parse(
      await readFile(join(root, 'maintenance-attachments', 'gen-0.json'), 'utf8')
    ) as string[]
    expect(new Set(compacted).size).toBe(compacted.length)
    expect(compacted).toContain('attachment-thread-0')
    expect(compacted).toContain('attachment-thread-1')
    expect(compacted).toContain('stale-extra')

    // Run the second generation so prune exercises the recovered safe set.
    complete = false
    while (!complete) complete = await maintenance.runAttachmentSlice()
    expect(pruneExpiredLeases).toHaveBeenCalledOnce()
    const safe = pruneExpiredLeases.mock.calls[0]![0] as Set<string>
    expect(safe.has('attachment-thread-0')).toBe(true)
    expect(safe.has('attachment-thread-1')).toBe(true)
    expect(safe.has('stale-extra')).toBe(true)
    expect(safe.size).toBe(11)
  })

  it('keeps total write volume linear for a large profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-amplify-'))
    roots.push(root)
    const threads = threadHarness(200)
    const pruneExpiredLeases = vi.fn(async () => undefined)
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: threads.service,
      attachments: () => ({ pruneExpiredLeases }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn(async () => ({ warnings: [] })) } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    for (let generation = 0; generation < 2; generation += 1) {
      let complete = false
      while (!complete) complete = await maintenance.runAttachmentSlice()
    }
    const compactText = await readFile(join(root, 'maintenance-attachments', 'gen-1.json'), 'utf8')
    const compactBytes = Buffer.byteLength(compactText, 'utf8')
    // Chunked appends + compacted files + bounded cursor writes stay O(N); the
    // old cumulative whole-file rewrite grew quadratically with the profile.
    expect(maintenance.stats().bytesWritten).toBeLessThanOrEqual(12 * compactBytes)
    expect(pruneExpiredLeases).toHaveBeenCalledOnce()
  })

  it('bounds a slice even when every read is measurably slow', async () => {
    vi.useFakeTimers()
    try {
      const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-duration-'))
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
      const get = vi.fn(async (id: string) => {
        vi.setSystemTime(Date.now() + 30)
        return { id, turns: [{ attachmentIds: [`a-${id}`] }] }
      })
      const maintenance = createRuntimeMaintenanceSlices({
        dataDir: root,
        threads: { listPage, get } as unknown as ThreadService,
        attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
        guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
        nowIso: () => '2026-09-03T00:00:00.000Z'
      })

      await maintenance.runAttachmentSlice()
      expect(maintenance.stats().maxDurationMs).toBeLessThanOrEqual(MAINTENANCE_SLICE_MAX_MS + 40)
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs the event-index rebuild slice in the same low-priority lane', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-rebuild-'))
    roots.push(root)
    const threads = threadHarness(2)
    const eventIndexRebuild = vi.fn(async () => false)
    const idle = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: threads.service,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      eventIndexRebuild,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })
    await expect(idle.runEventIndexSlice()).resolves.toBe(false)
    expect(eventIndexRebuild).toHaveBeenCalledOnce()

    const busy = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: threads.service,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      eventIndexRebuild,
      nowIso: () => '2026-09-03T00:00:00.000Z',
      hasActiveTurns: async () => true
    })
    await expect(busy.runEventIndexSlice()).resolves.toBe(false)
    expect(eventIndexRebuild).toHaveBeenCalledOnce()
    expect(busy.stats()).toMatchObject({ paused: 1 })
  })

  it('guards the event-index rebuild task against overlapping runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-rebuild-single-flight-'))
    roots.push(root)
    const threads = threadHarness(2)
    let finishRebuild!: (value: boolean) => void
    const eventIndexRebuild = vi.fn(() => new Promise<boolean>((resolve) => {
      finishRebuild = resolve
    }))
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: threads.service,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      eventIndexRebuild,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    const first = maintenance.runEventIndexSlice()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // While the first rebuild slice is still pending, a second invocation
    // joins the same in-flight promise instead of starting a new one.
    const second = maintenance.runEventIndexSlice()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(eventIndexRebuild).toHaveBeenCalledOnce()

    finishRebuild(false)
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
    expect(maintenance.stats().eventIndexSlices).toBe(2)

    // The consumed entry is gone, so a later slice starts a fresh rebuild.
    const third = maintenance.runEventIndexSlice()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(eventIndexRebuild).toHaveBeenCalledTimes(2)
    finishRebuild(true)
    await expect(third).resolves.toBe(true)
  })

  it('advances the in-thread attachment cursor instead of livelocking on a huge thread', async () => {
    vi.useFakeTimers()
    try {
      const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-livelock-'))
      roots.push(root)
      const turnCount = 20
      const ids = Array.from({ length: turnCount }, (_, index) => `a-${index}`)
      const listPage = vi.fn(async () => ({
        threads: [{ id: 'thread-0', status: 'idle', updatedAt: '0' }],
        hasMore: false
      }))
      // Every read consumes the whole 50ms budget, so a single slice can only
      // consume one turn before the deadline fires.
      const get = vi.fn(async () => {
        vi.setSystemTime(Date.now() + 60)
        return { id: 'thread-0', turns: ids.map((id) => ({ attachmentIds: [id] })) }
      })
      const pruneExpiredLeases = vi.fn(async () => undefined)
      const maintenance = createRuntimeMaintenanceSlices({
        dataDir: root,
        threads: { listPage, get } as unknown as ThreadService,
        attachments: () => ({ pruneExpiredLeases }) as unknown as AttachmentStore,
        guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
        nowIso: () => '2026-09-03T00:00:00.000Z'
      })

      const statePath = join(root, 'maintenance-state.json')
      const generationTurnOffsets: number[][] = []
      for (let generation = 0; generation < 2; generation += 1) {
        const turnOffsets: number[] = []
        let complete = false
        let guard = 0
        while (!complete && guard < 100) {
          complete = await maintenance.runAttachmentSlice()
          guard += 1
          const persisted = JSON.parse(await readFile(statePath, 'utf8')) as {
            attachments: { generation: number; partialThread?: { turnOffset: number } }
          }
          if (
            persisted.attachments.generation === generation &&
            persisted.attachments.partialThread
          ) {
            turnOffsets.push(persisted.attachments.partialThread.turnOffset)
          }
        }
        expect(guard).toBeLessThan(100)
        generationTurnOffsets.push(turnOffsets)
      }

      // Each generation consumed exactly one turn per slice and never reset
      // back to an earlier turn — the cursor advanced monotonically.
      for (const turnOffsets of generationTurnOffsets) {
        expect(turnOffsets).toHaveLength(turnCount)
        for (let index = 1; index < turnOffsets.length; index += 1) {
          expect(turnOffsets[index]).toBeGreaterThan(turnOffsets[index - 1])
        }
      }

      expect(pruneExpiredLeases).toHaveBeenCalledOnce()
      const compacted = JSON.parse(
        await readFile(join(root, 'maintenance-attachments', 'gen-1.json'), 'utf8')
      ) as string[]
      expect(new Set(compacted).size).toBe(turnCount)
      expect(compacted).toHaveLength(turnCount)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resumes an in-thread attachment breakpoint without re-appending the consumed prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-resume-id-'))
    roots.push(root)
    const listPage = vi.fn(async (options?: { cursor?: string }) => {
      if (!options?.cursor) {
        return {
          threads: [{ id: 'thread-0', status: 'idle', updatedAt: '0' }],
          hasMore: true,
          nextCursor: '1'
        }
      }
      return { threads: [], hasMore: false }
    })
    const get = vi.fn(async () => ({
      id: 'thread-0',
      turns: [{ attachmentIds: ['a-0', 'a-1', 'a-2', 'a-3', 'a-4', 'a-5'] }]
    }))
    await mkdir(join(root, 'maintenance-attachments'), { recursive: true })
    await writeFile(
      join(root, 'maintenance-attachments', 'gen-0.jsonl'),
      JSON.stringify(['a-0', 'a-1']) + '\n'
    )
    await writeFile(join(root, 'maintenance-state.json'), JSON.stringify({
      version: 3,
      attachments: {
        generation: 0,
        pageOffset: 0,
        partialThread: { threadId: 'thread-0', turnOffset: 0, attachmentOffset: 2 }
      },
      guardian: {}
    }))
    const pruneExpiredLeases = vi.fn(async () => undefined)
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: { listPage, get } as unknown as ThreadService,
      attachments: () => ({ pruneExpiredLeases }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    await expect(maintenance.runAttachmentSlice()).resolves.toBe(false)

    // The pre-existing prefix line is untouched; the new append covers only the
    // not-yet-consumed suffix and never re-adds a-0/a-1.
    const lines = (await readFile(join(root, 'maintenance-attachments', 'gen-0.jsonl'), 'utf8'))
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    expect(lines).toHaveLength(2)
    const appended = JSON.parse(lines[1]!) as string[]
    expect(appended).toEqual(['a-2', 'a-3', 'a-4', 'a-5'])

    // Completing the generation dedupes into the full six-reference set.
    let complete = false
    while (!complete) complete = await maintenance.runAttachmentSlice()
    const compacted = JSON.parse(
      await readFile(join(root, 'maintenance-attachments', 'gen-0.json'), 'utf8')
    ) as string[]
    expect(new Set(compacted).size).toBe(6)
    expect(compacted).toContain('a-0')
    expect(compacted).toContain('a-5')
  })

  it('falls back to a full rescan when the saved breakpoint thread id is stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-stale-bp-'))
    roots.push(root)
    const listPage = vi.fn(async () => ({
      threads: [{ id: 'thread-9', status: 'idle', updatedAt: '9' }],
      hasMore: false
    }))
    const get = vi.fn(async (id: string) => ({
      id,
      turns: [{ attachmentIds: ['x-0', 'x-1', 'x-2'] }]
    }))
    await writeFile(join(root, 'maintenance-state.json'), JSON.stringify({
      version: 3,
      attachments: {
        generation: 0,
        pageOffset: 0,
        partialThread: { threadId: 'thread-stale', turnOffset: 5, attachmentOffset: 2 }
      },
      guardian: {}
    }))
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: { listPage, get } as unknown as ThreadService,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    // The stale breakpoint must be ignored so no attachment id is skipped.
    await expect(maintenance.runAttachmentSlice()).resolves.toBe(true)
    const compacted = JSON.parse(
      await readFile(join(root, 'maintenance-attachments', 'gen-0.json'), 'utf8')
    ) as string[]
    expect(compacted).toHaveLength(3)
    expect(compacted).toContain('x-0')
    expect(compacted).toContain('x-2')
  })

  it('migrates a v2 state file to v3 preserving cursor and pageOffset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-maintenance-v2-migrate-'))
    roots.push(root)
    await writeFile(join(root, 'maintenance-state.json'), JSON.stringify({
      version: 2,
      attachments: { generation: 3, cursor: '7', pageOffset: 1 },
      guardian: {}
    }))
    const listPage = vi.fn(async (options?: { cursor?: string }) => {
      expect(options?.cursor).toBe('7')
      return {
        threads: ['t-7', 't-8', 't-9'].map((id) => ({ id, status: 'idle', updatedAt: id })),
        hasMore: true,
        nextCursor: '10'
      }
    })
    const get = vi.fn(async (id: string) => ({
      id,
      turns: [{ attachmentIds: [`a-${id}`] }]
    }))
    const maintenance = createRuntimeMaintenanceSlices({
      dataDir: root,
      threads: { listPage, get } as unknown as ThreadService,
      attachments: () => ({ pruneExpiredLeases: vi.fn() }) as unknown as AttachmentStore,
      guardian: { scanThread: vi.fn() } as unknown as SessionGuardian,
      nowIso: () => '2026-09-03T00:00:00.000Z'
    })

    await expect(maintenance.runAttachmentSlice()).resolves.toBe(false)
    // pageOffset=1 skipped the first slot, so scanning starts at t-8.
    expect(get).toHaveBeenNthCalledWith(1, 't-8')

    const persisted = JSON.parse(await readFile(join(root, 'maintenance-state.json'), 'utf8')) as {
      version: number
      attachments: { generation: number; cursor?: string; pageOffset?: number; partialThread?: unknown }
    }
    expect(persisted.version).toBe(3)
    expect(persisted.attachments.generation).toBe(3)
    expect(persisted.attachments.partialThread).toBeUndefined()
  })
})
