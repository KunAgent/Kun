import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeCleanupPlan } from './executor'
import { buildCleanupPlan, SLIM_BATCH_SIZE, type SlimRuntimeClient } from './planner'
import { StorageTrash } from './trash'

vi.mock('./planner', async (importOriginal) => ({
  ...await importOriginal<typeof import('./planner')>(),
  buildCleanupPlan: vi.fn()
}))

const roots: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('cleanup execution cancellation', () => {
  it.each(['resolved', 'rejected'] as const)('does not submit another batch after cancellation during a %s apply', async (outcome) => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cleanup-executor-'))
    roots.push(root)
    const ids = Array.from({ length: SLIM_BATCH_SIZE + 1 }, (_, index) => `t${index}`)
    const createdAt = new Date().toISOString()
    vi.mocked(buildCleanupPlan).mockResolvedValue({
      plan: {
        createdAt, olderThanDays: 30, idleBefore: createdAt,
        items: ids.map((id) => ({ id: `threadSlim:${id}`, kind: 'threadSlim', title: id, bytes: 1000 })),
        totalBytes: ids.length * 1000,
        skipped: { pinned: 0, active: 0, room: 0, goal: 0, recent: 0 }, truncated: false
      },
      targets: { threads: new Map(ids.map((id) => [id, { shellOutputs: [] }])), paths: new Map() }
    })
    let active = true
    const runtime: SlimRuntimeClient = {
      preview: vi.fn(),
      apply: vi.fn(async (threadIds: string[]) => {
        active = false
        if (outcome === 'rejected') throw new Error('Runtime request failed after cancellation')
        return { slimmed: threadIds.map((threadId) => ({ threadId, afterBytes: 10 })), skipped: [] }
      })
    }
    const trash = new StorageTrash(join(root, 'trash'))
    const result = await executeCleanupPlan({
      paths: { kunHome: root, dataDir: root, userData: root }, olderThanDays: 30, itemIds: 'all',
      runtime, trash, trashDays: 7, reason: 'scheduled', shouldContinue: () => active
    })
    expect(runtime.apply).toHaveBeenCalledTimes(1)
    expect(runtime.apply).toHaveBeenCalledWith(ids.slice(0, SLIM_BATCH_SIZE), createdAt)
    expect(result.slimmedThreads).toBe(outcome === 'resolved' ? SLIM_BATCH_SIZE : 0)
    expect(result.failed).toBe(outcome === 'rejected' ? SLIM_BATCH_SIZE : 0)
    expect((await trash.summary()).entries).toBe(0)
  })
})
