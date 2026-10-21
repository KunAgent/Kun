import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { runGit, resolveGitCwd } from './git-service'
import {
  createCheckpointManifestV1,
  type GitCheckpointManifestV1,
  validateCheckpointRestoreContext
} from './git-checkpoint-manifest'
import type {
  GitCheckpointCreateResult,
  GitCheckpointRestoreResult
} from '../../shared/git-checkpoint'

import {
  CHECKPOINT_REFERENCE_FILE_EXTENSIONS,
  DAY_MS,
  DEFAULT_MAX_CHECKPOINTS_PER_THREAD,
  GitCheckpointCleanupDueResult,
  GitCheckpointCleanupResult,
  GitCheckpointCleanupState,
  checkpointCleanupStatePath,
  checkpointDir,
  readMetadata,
  resolveCheckpointsRoot
} from './git-checkpoint-foundation'

export function extractWorkspaceCheckpointIds(text: string): Set<string> {
  const ids = new Set<string>()
  const pattern = /"workspaceCheckpointId"\s*:\s*"([^"]+)"/g
  let match: RegExpExecArray | null = null
  while ((match = pattern.exec(text)) !== null) {
    const id = match[1]?.trim()
    if (id) ids.add(id)
  }
  return ids
}

export async function collectReferencedCheckpointIds(dataDir: string): Promise<Set<string>> {
  const referenced = new Set<string>()
  const roots = [join(resolve(dataDir), 'threads')]
  const visit = async (dir: string): Promise<void> => {
    let entries: Dirent<string>[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return
      throw error
    }

    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile() || !CHECKPOINT_REFERENCE_FILE_EXTENSIONS.has(extname(entry.name))) continue
      let text = ''
      try {
        text = await readFile(path, 'utf-8')
      } catch {
        continue
      }
      for (const id of extractWorkspaceCheckpointIds(text)) {
        referenced.add(id)
      }
    }
  }

  for (const root of roots) {
    await visit(root)
  }
  return referenced
}

export async function readCleanupState(root: string): Promise<GitCheckpointCleanupState> {
  try {
    const raw = await readFile(checkpointCleanupStatePath(root), 'utf-8')
    const parsed = JSON.parse(raw) as GitCheckpointCleanupState
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export async function writeCleanupState(root: string, state: GitCheckpointCleanupState): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(checkpointCleanupStatePath(root), JSON.stringify(state, null, 2), 'utf-8')
}

export function isCheckpointCleanupDue(lastRunAt: string | undefined, intervalDays: number, now: Date): boolean {
  if (!lastRunAt) return true
  const lastRunMs = Date.parse(lastRunAt)
  if (!Number.isFinite(lastRunMs)) return true
  return now.getTime() - lastRunMs >= intervalDays * DAY_MS
}

// A checkpoint directory is created before its referencing thread item is
// flushed to disk, so a freshly-created checkpoint can momentarily look
// unreferenced. Skip directories modified within this window so a cleanup pass
// landing in that gap can't delete a checkpoint a concurrent turn just created;
// a genuinely orphaned one is removed on a later pass. Injectable so tests can
// disable it with graceMs: 0.
export const CHECKPOINT_CLEANUP_GRACE_MS = 10 * 60 * 1_000

export async function resolveCheckpointCreatedMs(root: string, checkpointId: string): Promise<number | null> {
  const metadata = await readMetadata(root, checkpointId)
  if (metadata) {
    const createdMs = Date.parse(metadata.createdAt)
    if (Number.isFinite(createdMs)) return createdMs
  }
  const named = checkpointNameTimestamp(checkpointId)
  if (named > 0) return named
  try {
    const dirStat = await stat(join(root, checkpointId))
    return dirStat.mtimeMs
  } catch {
    return null
  }
}

export async function cleanupUnusedGitCheckpoints(params: {
  dataDir: string
  checkpointsRoot?: string
  /** Delete checkpoints older than this many days (by createdAt / name / mtime). */
  maxAgeDays?: number
  /** Also enforce the per-thread cap across every thread in the store. */
  maxPerThread?: number
  graceMs?: number
  now?: Date
}): Promise<GitCheckpointCleanupResult> {
  const graceMs = params.graceMs ?? CHECKPOINT_CLEANUP_GRACE_MS
  const nowMs = (params.now ?? new Date()).getTime()
  const maxAgeMs =
    typeof params.maxAgeDays === 'number' && Number.isFinite(params.maxAgeDays) && params.maxAgeDays > 0
      ? params.maxAgeDays * DAY_MS
      : null
  const maxPerThread =
    typeof params.maxPerThread === 'number' && Number.isFinite(params.maxPerThread)
      ? Math.max(1, Math.min(100, Math.floor(params.maxPerThread)))
      : DEFAULT_MAX_CHECKPOINTS_PER_THREAD
  const root = resolveCheckpointsRoot(params.dataDir, params.checkpointsRoot)
  // Collecting references reads every thread log (gigabytes on a large
  // history) and only matters for a checkpoint that would otherwise be
  // deleted, so it runs at most once and only when such a checkpoint exists.
  let referencedScan: Promise<Set<string>> | undefined
  const referencedIds = () => (referencedScan ??= collectReferencedCheckpointIds(params.dataDir))
  const result: GitCheckpointCleanupResult = {
    scanned: 0,
    kept: 0,
    deleted: 0,
    failed: 0,
    deletedIds: [],
    failedIds: []
  }

  let entries: Dirent<string>[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return result
    throw error
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const checkpointId = entry.name
    result.scanned += 1
    const createdMs = await resolveCheckpointCreatedMs(root, checkpointId)
    const expiredByAge =
      maxAgeMs != null && createdMs != null && nowMs - createdMs >= maxAgeMs
    if (!expiredByAge && graceMs > 0) {
      try {
        const dirStat = await stat(join(root, checkpointId))
        if (nowMs - dirStat.mtimeMs < graceMs) {
          // Recently touched — may be referenced by an item not yet flushed.
          result.kept += 1
          continue
        }
      } catch {
        // Cannot stat (e.g. removed concurrently); fall through to the delete.
      }
    }
    // A message may expose this checkpoint as its rollback target. Retain it
    // regardless of its age so cleanup can never leave a broken rollback link.
    if ((await referencedIds()).has(checkpointId)) {
      result.kept += 1
      continue
    }
    try {
      await rm(join(root, checkpointId), { recursive: true, force: true })
      result.deleted += 1
      result.deletedIds.push(checkpointId)
    } catch {
      result.failed += 1
      result.failedIds.push(checkpointId)
    }
  }

  // Keep all checkpoints that remain reachable from thread history. The cap is
  // deliberately a soft limit over unreferenced directories only: deleting a
  // referenced checkpoint would turn an existing rollback action into data loss.
  const pruned = await pruneAllThreadCheckpoints(root, maxPerThread, referencedScan ? await referencedScan : undefined)
  for (const checkpointId of pruned.deleted) {
    if (result.deletedIds.includes(checkpointId)) continue
    result.deleted += 1
    result.deletedIds.push(checkpointId)
    result.kept = Math.max(0, result.kept - 1)
  }

  return result
}

export async function cleanupUnusedGitCheckpointsIfDue(params: {
  dataDir: string
  checkpointsRoot?: string
  intervalDays: number
  now?: Date
  graceMs?: number
  maxPerThread?: number
  /**
   * When true, skip the interval gate (used on app startup so retention always
   * runs once per launch). Age pruning still uses `intervalDays`.
   */
  force?: boolean
  /** When set and different from the last recorded version, force a cleanup pass. */
  appVersion?: string
}): Promise<GitCheckpointCleanupDueResult> {
  const now = params.now ?? new Date()
  const root = resolveCheckpointsRoot(params.dataDir, params.checkpointsRoot)
  const state = await readCleanupState(root)
  const lastRunAt = typeof state.lastRunAt === 'string' ? state.lastRunAt : undefined
  const appVersion = typeof params.appVersion === 'string' ? params.appVersion.trim() : ''
  const versionChanged = Boolean(appVersion) && state.lastAppVersion !== appVersion
  if (!params.force && !versionChanged && !isCheckpointCleanupDue(lastRunAt, params.intervalDays, now)) {
    return { due: false, lastRunAt: lastRunAt ?? null }
  }
  const result = await cleanupUnusedGitCheckpoints({
    dataDir: params.dataDir,
    ...(params.checkpointsRoot ? { checkpointsRoot: params.checkpointsRoot } : {}),
    maxAgeDays: params.intervalDays,
    ...(params.maxPerThread !== undefined ? { maxPerThread: params.maxPerThread } : {}),
    now,
    ...(params.graceMs !== undefined ? { graceMs: params.graceMs } : {})
  })
  const nextLastRunAt = now.toISOString()
  await writeCleanupState(root, {
    lastRunAt: nextLastRunAt,
    ...(appVersion
      ? { lastAppVersion: appVersion }
      : typeof state.lastAppVersion === 'string'
        ? { lastAppVersion: state.lastAppVersion }
        : {})
  })
  return { due: true, lastRunAt: nextLastRunAt, result }
}

/**
 * Keep at most `max` checkpoints for a thread. This is a HARD cap (issue
 * #1156): checkpoints beyond the newest `max` are removed even when still
 * referenced by saved messages — otherwise an active thread pins every full
 * bundle forever and the store grows without bound. Messages keep their
 * `workspaceCheckpointId` reference; restoring a removed checkpoint surfaces
 * an expired-rollback state instead. `keepId` is always retained.
 */
export async function pruneThreadCheckpoints(
  root: string,
  threadId: string,
  max: number,
  keepId?: string,
  referencedIds: ReadonlySet<string> = new Set()
): Promise<{ deleted: string[] }> {
  if (max <= 0) return { deleted: [] }
  let entries: Dirent<string>[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { deleted: [] }
  }
  const owned: Array<{ id: string; order: number }> = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const metadata = await readMetadata(root, entry.name)
    if (!metadata || metadata.threadId !== threadId) continue
    const createdMs = Date.parse(metadata.createdAt)
    const order = Number.isFinite(createdMs) ? createdMs : checkpointNameTimestamp(entry.name)
    owned.push({ id: entry.name, order })
  }
  // Newest first; the hard cap counts referenced checkpoints too, so an
  // active thread cannot pin unbounded history. `keepId` (the snapshot a
  // concurrent turn is waiting on) is always retained.
  owned.sort((a, b) => b.order - a.order)
  const deleted: string[] = []
  let kept = 0
  for (const { id } of owned) {
    if (id === keepId) {
      kept += 1
      continue
    }
    if (kept < max) {
      kept += 1
      continue
    }
    try {
      await rm(checkpointDir(root, id), { recursive: true, force: true })
      deleted.push(id)
    } catch {
      // best-effort
    }
  }
  return { deleted }
}

/**
 * Enforce the hard checkpoint cap for every thread under `root`. Referenced
 * checkpoints count toward the cap (issue #1156); `referencedIds` is accepted
 * for call-site compatibility but no longer exempts entries from deletion.
 */
export async function pruneAllThreadCheckpoints(
  root: string,
  max: number,
  referencedIds: ReadonlySet<string> = new Set()
): Promise<{ deleted: string[] }> {
  if (max <= 0) return { deleted: [] }
  let entries: Dirent<string>[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { deleted: [] }
  }
  const byThread = new Map<string, Array<{ id: string; order: number }>>()
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const metadata = await readMetadata(root, entry.name)
    if (!metadata?.threadId) continue
    const createdMs = Date.parse(metadata.createdAt)
    const order = Number.isFinite(createdMs) ? createdMs : checkpointNameTimestamp(entry.name)
    const list = byThread.get(metadata.threadId) ?? []
    list.push({ id: entry.name, order })
    byThread.set(metadata.threadId, list)
  }
  const deleted: string[] = []
  for (const owned of byThread.values()) {
    owned.sort((a, b) => b.order - a.order)
    let kept = 0
    for (const { id } of owned) {
      if (kept < max) {
        kept += 1
        continue
      }
      try {
        await rm(checkpointDir(root, id), { recursive: true, force: true })
        deleted.push(id)
      } catch {
        // best-effort
      }
    }
  }
  return { deleted }
}

/** Extract the `gcp_<timestamp>_<uuid>` creation epoch for ordering fallback. */
export function checkpointNameTimestamp(name: string): number {
  const match = name.match(/^gcp_(\d+)_/)
  return match ? Number(match[1]) : 0
}
