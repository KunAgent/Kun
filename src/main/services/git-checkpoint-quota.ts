import { readdir, rm, stat, statfs } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_CHECKPOINT_MIN_FREE_DISK_BYTES,
  DEFAULT_CHECKPOINT_MAX_TOTAL_BYTES
} from '../../shared/app-settings-types-provider'
import { readMetadata, checkpointDir } from './git-checkpoint-foundation'

/**
 * Global disk quota for the checkpoint store (issue #1156): per-thread caps
 * alone cannot bound usage when every full-history `head.bundle` stays
 * referenced by an active thread. This module measures the checkpoints root and
 * evicts the oldest checkpoints first — referenced or not — until the projected
 * total fits, and reports whether a new snapshot may be created.
 */
export type CheckpointQuotaOptions = {
  /** Hard cap on total checkpoint bytes. Default 2 GiB. */
  maxTotalBytes?: number
  /** Skip creation when the disk backing the store has less free space. Default 1 GiB. */
  minFreeDiskBytes?: number
}

export type CheckpointQuotaDecision =
  | { allowed: true }
  | { allowed: false, reason: 'quota_exceeded' | 'low_disk', message: string }

async function directorySizeBytes(path: string): Promise<number> {
  let entries: Dirent[]
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      total += await directorySizeBytes(child)
    } else if (entry.isFile()) {
      try {
        total += (await stat(child)).size
      } catch {
        // Removed concurrently; skip.
      }
    }
  }
  return total
}

function normalizeBytes(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

/** Checkpoint directories under `root` ordered oldest-first by createdAt/name. */
async function listCheckpointsOldestFirst(root: string): Promise<Array<{ id: string, createdAtMs: number }>> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const listed: Array<{ id: string, createdAtMs: number }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.staging-')) continue
    const metadata = await readMetadata(root, entry.name)
    const createdMs = metadata ? Date.parse(metadata.createdAt) : NaN
    const byName = Number(entry.name.match(/^gcp_(\d+)_/)?.[1] ?? 0)
    listed.push({ id: entry.name, createdAtMs: Number.isFinite(createdMs) ? createdMs : byName })
  }
  listed.sort((a, b) => a.createdAtMs - b.createdAtMs)
  return listed
}

export async function checkpointsTotalBytes(root: string): Promise<number> {
  return directorySizeBytes(root)
}

/**
 * Evict oldest checkpoints (referenced ones first candidates — the quota is a
 * hard bound) until the projected total is at or below the cap. Returns the
 * deleted ids. Best-effort: unreadable/unremovable entries are skipped.
 */
export async function evictForQuota(params: {
  root: string
  maxTotalBytes?: number
  /** Keep at least this many checkpoints for the calling thread regardless of quota. */
  protectIds?: ReadonlySet<string>
}): Promise<{ deleted: string[], totalBytesBefore: number, totalBytesAfter: number }> {
  const cap = normalizeBytes(params.maxTotalBytes, DEFAULT_CHECKPOINT_MAX_TOTAL_BYTES)
  const protect = params.protectIds ?? new Set<string>()
  const totalBytesBefore = await checkpointsTotalBytes(params.root)
  const deleted: string[] = []
  let total = totalBytesBefore
  if (total <= cap) return { deleted, totalBytesBefore, totalBytesAfter: total }
  const oldestFirst = await listCheckpointsOldestFirst(params.root)
  for (const { id } of oldestFirst) {
    if (total <= cap) break
    if (protect.has(id)) continue
    const dir = checkpointDir(params.root, id)
    const size = await directorySizeBytes(dir)
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      continue
    }
    deleted.push(id)
    total = Math.max(0, total - size)
  }
  return { deleted, totalBytesBefore, totalBytesAfter: total }
}

/**
 * Pre-create quota gate. Evicts oldest checkpoints to make room; when the cap
 * still cannot be met (or free disk is below the floor), creation is skipped
 * and the caller returns `quota_exceeded` instead of writing a new snapshot.
 */
export async function ensureQuotaForCreate(params: {
  root: string
  quota?: CheckpointQuotaOptions
  /** Estimated bytes the new snapshot will add (defaults to the current HEAD bundle size when available). */
  projectedNewBytes: number
  protectIds?: ReadonlySet<string>
}): Promise<CheckpointQuotaDecision> {
  const cap = normalizeBytes(params.quota?.maxTotalBytes, DEFAULT_CHECKPOINT_MAX_TOTAL_BYTES)
  const minFree = normalizeBytes(params.quota?.minFreeDiskBytes, DEFAULT_CHECKPOINT_MIN_FREE_DISK_BYTES)
  const current = await checkpointsTotalBytes(params.root)
  if (current + params.projectedNewBytes > cap) {
    // Evict down to (cap - projected) so the new snapshot actually fits, not
    // merely back under the cap.
    const evicted = await evictForQuota({
      root: params.root,
      maxTotalBytes: Math.max(0, cap - params.projectedNewBytes),
      protectIds: params.protectIds
    })
    const after = evicted.totalBytesAfter
    if (after + params.projectedNewBytes > cap) {
      return {
        allowed: false,
        reason: 'quota_exceeded',
        message:
          `Git checkpoint storage quota exceeded: ${after} bytes used, ${params.projectedNewBytes} bytes needed, cap ${cap} bytes. ` +
          'Oldest checkpoints were evicted; raise the quota in settings or clean up manually.'
      }
    }
  }
  try {
    const freeBytes = await freeDiskBytes(params.root)
    if (freeBytes !== null && freeBytes < minFree) {
      return {
        allowed: false,
        reason: 'quota_exceeded',
        message:
          `Git checkpoint creation skipped: only ${freeBytes} bytes free on the checkpoint disk (minimum ${minFree} bytes).`
      }
    }
  } catch {
    // Root may not exist yet (first checkpoint); the disk floor cannot be
    // checked meaningfully before creation — proceed.
  }
  return { allowed: true }
}

/** Cross-platform free disk probe using the nearest existing parent. */
export async function freeDiskBytes(path: string): Promise<number | null> {
  let target = path
  while (true) {
    try {
      const info = await statfs(target, { bigint: true })
      const bytes = info.bavail * info.bsize
      return bytes > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(bytes)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
      const parent = dirname(target)
      if (parent === target) return null
      target = parent
    }
  }
}
