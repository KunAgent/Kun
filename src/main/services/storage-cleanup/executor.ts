import { lstat } from 'node:fs/promises'
import type {
  StorageCleanupResult,
  StorageCleanupRunReason,
  StoragePlanItemKind
} from '../../../shared/storage-cleanup'
import { buildCleanupPlan, SLIM_BATCH_SIZE, type SlimRuntimeClient } from './planner'
import type { StorageCleanupPaths } from './paths'
import type { StorageTrash } from './trash'

type ResultLine = StorageCleanupResult['lines'][number]

export class CleanupTally {
  readonly startedAt = new Date().toISOString()
  freedBytes = 0
  trashedBytes = 0
  slimmedThreads = 0
  movedToTrash = 0
  failed = 0
  private readonly lines = new Map<ResultLine['kind'], ResultLine>()

  add(kind: ResultLine['kind'], bytes: number, count = 1): void {
    const line = this.lines.get(kind) ?? { kind, count: 0, bytes: 0 }
    line.count += count
    line.bytes += bytes
    this.lines.set(kind, line)
  }

  finish(runId: string, reason: StorageCleanupRunReason): StorageCleanupResult {
    return {
      runId,
      reason,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      freedBytes: this.freedBytes,
      trashedBytes: this.trashedBytes,
      slimmedThreads: this.slimmedThreads,
      movedToTrash: this.movedToTrash,
      failed: this.failed,
      lines: [...this.lines.values()]
    }
  }
}

/** Move one path into a trash run, counting it under `kind`. */
export async function trashPath(
  move: (path: string, bytes: number) => Promise<boolean>,
  tally: CleanupTally,
  kind: ResultLine['kind'],
  path: string,
  bytes: number,
  /** Shell outputs belong to a thread line that already counted the thread. */
  countsAsItem = true
): Promise<void> {
  try {
    if (!(await lstat(path).catch(() => null))) return
    if (await move(path, bytes)) {
      tally.movedToTrash += 1
      tally.trashedBytes += bytes
      tally.add(kind, bytes, countsAsItem ? 1 : 0)
    }
  } catch {
    tally.failed += 1
  }
}

/**
 * Run the user-selected subset of a fresh plan. Eligibility is re-derived
 * here (and again by Kun under the thread lock), so ids from an old preview
 * can only drop out, never add work the user did not see.
 */
export async function executeCleanupPlan(input: {
  paths: StorageCleanupPaths
  olderThanDays: number
  itemIds: ReadonlySet<string> | 'all'
  runtime: SlimRuntimeClient
  trash: StorageTrash
  trashDays: number
  reason: StorageCleanupRunReason
}): Promise<StorageCleanupResult> {
  const { plan, targets } = await buildCleanupPlan(input)
  const wanted = (id: string): boolean => input.itemIds === 'all' || input.itemIds.has(id)
  const tally = new CleanupTally()
  const run = await input.trash.begin(input.trashDays)
  const itemsById = new Map(plan.items.map((item) => [item.id, item]))

  const threadIds = [...targets.threads.keys()].filter((threadId) => wanted(`threadSlim:${threadId}`))
  for (let index = 0; index < threadIds.length; index += SLIM_BATCH_SIZE) {
    const batch = threadIds.slice(index, index + SLIM_BATCH_SIZE)
    let response: Awaited<ReturnType<SlimRuntimeClient['apply']>>
    try {
      response = await input.runtime.apply(batch, plan.idleBefore)
    } catch {
      tally.failed += batch.length
      continue
    }
    const slimmed = new Map(response.slimmed.map((entry) => [entry.threadId, entry.afterBytes]))
    for (const skip of response.skipped) if (skip.reason === 'failed') tally.failed += 1
    for (const threadId of batch) {
      const reason = response.skipped.find((skip) => skip.threadId === threadId)?.reason
      // A log trimmed by an earlier run still releases its leftover shell output.
      if (!slimmed.has(threadId) && reason !== 'already_slim') continue
      const item = itemsById.get(`threadSlim:${threadId}`)
      const shells = targets.threads.get(threadId)?.shellOutputs ?? []
      if (slimmed.has(threadId)) {
        const shellBytes = (await Promise.all(shells.map((path) => lstat(path).then((info) => info.size, () => 0))))
          .reduce((sum, value) => sum + value, 0)
        const freed = Math.max(0, (item?.bytes ?? 0) - shellBytes - (slimmed.get(threadId) ?? 0))
        tally.freedBytes += freed
        tally.slimmedThreads += 1
        tally.add('threadSlim', freed)
      }
      for (const path of shells) {
        const bytes = await lstat(path).then((info) => info.size, () => 0)
        await trashPath(run.move, tally, 'threadSlim', path, bytes, slimmed.has(threadId) ? false : true)
      }
    }
  }

  for (const [id, path] of targets.paths) {
    if (!wanted(id)) continue
    const item = itemsById.get(id)
    if (!item) continue
    await trashPath(run.move, tally, item.kind as StoragePlanItemKind, path, item.bytes)
  }

  await run.commit()
  return tally.finish(run.runId, input.reason)
}
