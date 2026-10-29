import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  STORAGE_DIAGNOSTICS_RETENTION_DAYS,
  type StorageCleanupPlan,
  type StoragePlanItem,
  type StoragePlanSkipCounts
} from '../../../shared/storage-cleanup'
import { directoryHasNoFiles, pathBytes } from './disk-usage'
import { storageCleanupLocations, type StorageCleanupPaths } from './paths'

/** Replay logs below this size are not worth a rewrite. */
export const SLIM_MIN_EVENT_BYTES = 64 * 1024
/** Kun accepts this many thread ids per slim request. */
export const SLIM_BATCH_SIZE = 500
/** One cleanup run never touches more threads than this; the rest wait for the next run. */
export const SLIM_MAX_THREADS_PER_RUN = 3000

export type SlimPreviewCandidate = {
  threadId: string
  eligible: boolean
  skipReason?: 'missing' | 'recent' | 'pinned' | 'active' | 'room' | 'goal' | 'already_slim'
  title?: string
  workspace?: string
  updatedAt?: string
}

export type SlimRuntimeClient = {
  preview: (threadIds: string[], idleBefore: string) => Promise<SlimPreviewCandidate[]>
  apply: (threadIds: string[], idleBefore: string) => Promise<{
    slimmed: Array<{ threadId: string; afterBytes: number }>
    skipped: Array<{ threadId: string; reason: string }>
  }>
}

type ThreadDiskCandidate = { threadId: string; eventBytes: number; shellOutputs: string[]; shellBytes: number; newestMs: number }

const DAY_MS = 86_400_000

async function newestMtime(dir: string, names: string[]): Promise<number> {
  const stamps = await Promise.all(names.map((name) => lstat(join(dir, name)).then((info) => info.mtimeMs, () => 0)))
  return Math.max(0, ...stamps)
}

async function shellOutputs(dir: string, idleBeforeMs: number): Promise<{ paths: string[]; bytes: number }> {
  const shellsDir = join(dir, 'background-shells')
  const names = await readdir(shellsDir).catch(() => [] as string[])
  const paths: string[] = []
  let bytes = 0
  for (const name of names) {
    if (!name.endsWith('.output')) continue
    const info = await lstat(join(shellsDir, name)).catch(() => null)
    if (!info?.isFile() || info.mtimeMs >= idleBeforeMs) continue
    paths.push(join(shellsDir, name))
    bytes += info.size
  }
  return { paths, bytes }
}

/** Threads whose files on disk have been quiet since before the cutoff, largest first. */
export async function idleThreadCandidates(threadsDir: string, idleBeforeMs: number): Promise<ThreadDiskCandidate[]> {
  const names = await readdir(threadsDir).catch(() => [] as string[])
  const found: ThreadDiskCandidate[] = []
  await Promise.all(names.map(async (threadId) => {
    const dir = join(threadsDir, threadId)
    const events = await lstat(join(dir, 'events.jsonl')).catch(() => null)
    if (!events?.isFile()) return
    const newestMs = await newestMtime(dir, ['events.jsonl', 'messages.jsonl', 'metadata.jsonl'])
    if (newestMs >= idleBeforeMs) return
    const shells = await shellOutputs(dir, idleBeforeMs)
    if (events.size < SLIM_MIN_EVENT_BYTES && shells.bytes === 0) return
    found.push({ threadId, eventBytes: events.size, shellOutputs: shells.paths, shellBytes: shells.bytes, newestMs })
  }))
  return found.sort((a, b) => (b.eventBytes + b.shellBytes) - (a.eventBytes + a.shellBytes))
}

export async function emptyTaskWorktrees(root: string, idleBeforeMs: number): Promise<Array<{ path: string; name: string; mtimeMs: number }>> {
  const names = await readdir(root).catch(() => [] as string[])
  const found: Array<{ path: string; name: string; mtimeMs: number }> = []
  for (const name of names) {
    const path = join(root, name)
    const info = await lstat(path).catch(() => null)
    if (!info?.isDirectory() || info.mtimeMs >= idleBeforeMs) continue
    if (await directoryHasNoFiles(path)) found.push({ path, name, mtimeMs: info.mtimeMs })
  }
  return found
}

export async function staleTrajectoryRecords(root: string, now: number): Promise<Array<{ path: string; name: string; bytes: number; mtimeMs: number }>> {
  const cutoff = now - STORAGE_DIAGNOSTICS_RETENTION_DAYS * DAY_MS
  const names = await readdir(root).catch(() => [] as string[])
  const found: Array<{ path: string; name: string; bytes: number; mtimeMs: number }> = []
  for (const name of names) {
    const info = await lstat(join(root, name)).catch(() => null)
    if (info?.isFile() && info.mtimeMs < cutoff) found.push({ path: join(root, name), name, bytes: info.size, mtimeMs: info.mtimeMs })
  }
  return found
}

export type PlanTargets = {
  threads: Map<string, { shellOutputs: string[] }>
  paths: Map<string, string>
}

/**
 * Build the reviewable plan. Item ids double as execution targets: the
 * executor re-derives eligibility from disk and Kun, so a stale id from an
 * old preview can only skip, never widen the run.
 */
export async function buildCleanupPlan(input: {
  paths: StorageCleanupPaths
  olderThanDays: number
  runtime: SlimRuntimeClient
  now?: Date
}): Promise<{ plan: StorageCleanupPlan; targets: PlanTargets }> {
  const now = input.now ?? new Date()
  const idleBeforeMs = now.getTime() - input.olderThanDays * DAY_MS
  const idleBefore = new Date(idleBeforeMs).toISOString()
  const items: StoragePlanItem[] = []
  const targets: PlanTargets = { threads: new Map(), paths: new Map() }
  const skipped: StoragePlanSkipCounts = { pinned: 0, active: 0, room: 0, goal: 0, recent: 0 }

  const disk = await idleThreadCandidates(storageCleanupLocations.threadsDir(input.paths), idleBeforeMs)
  const considered = disk.slice(0, SLIM_MAX_THREADS_PER_RUN)
  const byId = new Map(considered.map((candidate) => [candidate.threadId, candidate]))
  for (let index = 0; index < considered.length; index += SLIM_BATCH_SIZE) {
    const batch = considered.slice(index, index + SLIM_BATCH_SIZE).map((candidate) => candidate.threadId)
    for (const result of await input.runtime.preview(batch, idleBefore)) {
      const candidate = byId.get(result.threadId)
      if (!candidate) continue
      if (!result.eligible) {
        const reason = result.skipReason
        if (reason && reason in skipped) skipped[reason as keyof StoragePlanSkipCounts] += 1
        continue
      }
      // An already-trimmed log still lists its leftover shell outputs.
      const eventBytes = candidate.eventBytes >= SLIM_MIN_EVENT_BYTES ? candidate.eventBytes : 0
      const bytes = eventBytes + candidate.shellBytes
      if (bytes === 0) continue
      items.push({
        id: `threadSlim:${candidate.threadId}`,
        kind: 'threadSlim',
        title: result.title?.trim() || candidate.threadId,
        ...(result.workspace ? { detail: result.workspace } : {}),
        updatedAt: result.updatedAt ?? new Date(candidate.newestMs).toISOString(),
        bytes
      })
      targets.threads.set(candidate.threadId, { shellOutputs: candidate.shellOutputs })
    }
  }

  for (const worktree of await emptyTaskWorktrees(storageCleanupLocations.taskWorktrees(input.paths), idleBeforeMs)) {
    const id = `emptyWorktree:${worktree.name}`
    items.push({
      id, kind: 'emptyWorktree', title: worktree.name, detail: 'worktrees/tasks',
      updatedAt: new Date(worktree.mtimeMs).toISOString(), bytes: await pathBytes(worktree.path)
    })
    targets.paths.set(id, worktree.path)
  }

  for (const record of await staleTrajectoryRecords(storageCleanupLocations.trajectoryRecords(input.paths), now.getTime())) {
    const id = `trajectoryRecord:${record.name}`
    items.push({
      id, kind: 'trajectoryRecord', title: record.name, detail: 'observability/trajectory',
      updatedAt: new Date(record.mtimeMs).toISOString(), bytes: record.bytes
    })
    targets.paths.set(id, record.path)
  }

  return {
    plan: {
      createdAt: now.toISOString(),
      olderThanDays: input.olderThanDays,
      idleBefore,
      items,
      totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
      skipped,
      truncated: disk.length > considered.length
    },
    targets
  }
}
