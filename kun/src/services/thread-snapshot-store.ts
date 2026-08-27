import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

export const THREAD_SNAPSHOT_SCHEMA_VERSION = 1

/** Files captured by a snapshot; SQLite indexes are rebuilt, never copied. */
const SNAPSHOT_FILES = ['messages.jsonl', 'metadata.jsonl', 'events.jsonl', 'session.json'] as const
type SnapshotFile = (typeof SNAPSHOT_FILES)[number]

export const ThreadSnapshotManifestSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: z.string().min(1),
  threadId: z.string().min(1),
  createdAt: z.string().min(1),
  reason: z.enum(['prune', 'restore', 'scheduled', 'manual']),
  threadRevision: z.number().int().nonnegative(),
  itemRevision: z.number().int().nonnegative(),
  eventHighWaterSeq: z.number().int().nonnegative(),
  files: z.array(z.object({
    name: z.string().min(1),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  }))
}).strict()
export type ThreadSnapshotManifest = z.infer<typeof ThreadSnapshotManifestSchema>

export type ThreadSnapshotStoreDeps = {
  dataDir: string
  nowIso: () => string
}

export class ThreadSnapshotStore {
  private readonly threadsDir: string
  private readonly nowIso: () => string

  constructor(deps: ThreadSnapshotStoreDeps) {
    this.threadsDir = join(deps.dataDir, 'threads')
    this.nowIso = deps.nowIso
  }

  /** Capture a complete, checksummed snapshot of a thread's canonical files. */
  async capture(input: {
    threadId: string
    reason: ThreadSnapshotManifest['reason']
    threadRevision: number
    itemRevision: number
    eventHighWaterSeq: number
  }): Promise<ThreadSnapshotManifest> {
    const snapshotId = `${this.nowIso().replace(/[^0-9]/g, '').slice(0, 17)}-${input.reason}-${Math.random().toString(36).slice(2, 8)}`
    const threadDir = join(this.threadsDir, input.threadId)
    const stagingDir = join(threadDir, 'snapshots', `${snapshotId}.staging`)
    const finalDir = join(threadDir, 'snapshots', snapshotId)
    await mkdir(stagingDir, { recursive: true, mode: 0o700 })
    try {
      const files: ThreadSnapshotManifest['files'] = []
      for (const name of SNAPSHOT_FILES) {
        const source = join(threadDir, name)
        const info = await stat(source).catch(() => null)
        if (!info) continue
        await copyFile(source, join(stagingDir, name))
        const digest = createHash('sha256')
            .update(await readFile(join(stagingDir, name)))
            .digest('hex')
        files.push({ name, bytes: info.size, sha256: digest })
      }
      const manifest: ThreadSnapshotManifest = {
        schemaVersion: THREAD_SNAPSHOT_SCHEMA_VERSION,
        snapshotId,
        threadId: input.threadId,
        createdAt: this.nowIso(),
        reason: input.reason,
        threadRevision: input.threadRevision,
        itemRevision: input.itemRevision,
        eventHighWaterSeq: input.eventHighWaterSeq,
        files
      }
      await writeFile(
        join(stagingDir, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: 'utf-8', mode: 0o600 }
      )
      // Only the rename from staging to the id directory marks the snapshot
      // complete; a crash before it leaves an obviously-staging path that the
      // guardian can quarantine.
      await rename(stagingDir, finalDir)
      return manifest
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  /** List completed snapshots (staging directories are ignored), newest first. */
  async list(threadId: string): Promise<ThreadSnapshotManifest[]> {
    const root = join(this.threadsDir, threadId, 'snapshots')
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    const manifests: ThreadSnapshotManifest[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.endsWith('.staging')) continue
      const raw = await readFile(join(root, entry.name, 'manifest.json'), 'utf-8').catch(() => null)
      if (!raw) continue
      const parsed = ThreadSnapshotManifestSchema.safeParse(JSON.parse(raw))
      if (parsed.success && parsed.data.threadId === threadId) manifests.push(parsed.data)
    }
    return manifests.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /** Verify every recorded file still matches its checksum. */
  async verify(threadId: string, snapshotId: string): Promise<boolean> {
    const manifest = await this.get(threadId, snapshotId)
    if (!manifest) return false
    const dir = join(this.threadsDir, threadId, 'snapshots', snapshotId)
    for (const file of manifest.files) {
      const content = await readFile(join(dir, file.name)).catch(() => null)
      if (!content) return false
      const digest = createHash('sha256').update(content).digest('hex')
      if (digest !== file.sha256) return false
    }
    return true
  }

  async get(threadId: string, snapshotId: string): Promise<ThreadSnapshotManifest | null> {
    const raw = await readFile(
      join(this.threadsDir, threadId, 'snapshots', snapshotId, 'manifest.json'),
      'utf-8'
    ).catch(() => null)
    if (!raw) return null
    const parsed = ThreadSnapshotManifestSchema.safeParse(JSON.parse(raw))
    return parsed.success && parsed.data.threadId === threadId ? parsed.data : null
  }

  /** Read a snapshot file's bytes after verification. */
  async readFile(threadId: string, snapshotId: string, name: string): Promise<Buffer | null> {
    if (!SNAPSHOT_FILES.includes(name as SnapshotFile)) return null
    const ok = await this.verify(threadId, snapshotId)
    if (!ok) return null
    return readFile(join(this.threadsDir, threadId, 'snapshots', snapshotId, name)).catch(() => null)
  }

  /**
   * Enforce retention: keep at most `keepLast` non-safety snapshots newer than
   * `keepDays` days, always preserving the newest healthy one of each reason.
   */
  async enforceRetention(input: {
    threadId: string
    keepLast: number
    keepDays: number
    protectSnapshotIds?: readonly string[]
  }): Promise<string[]> {
    const manifests = await this.list(input.threadId)
    if (manifests.length === 0) return []
    const protect = new Set([...(input.protectSnapshotIds ?? []), manifests[0]!.snapshotId])
    const newestByReason = new Map<string, string>()
    for (const manifest of manifests) {
      if (!newestByReason.has(manifest.reason)) newestByReason.set(manifest.reason, manifest.snapshotId)
    }
    for (const id of newestByReason.values()) protect.add(id)
    const cutoffMs = Date.parse(this.nowIso()) - input.keepDays * 86_400_000
    const removed: string[] = []
    let kept = 0
    for (const manifest of manifests) {
      if (protect.has(manifest.snapshotId)) { kept += 1; continue }
      const ageMs = Date.parse(manifest.createdAt)
      if (kept < input.keepLast && (!Number.isFinite(ageMs) || ageMs >= cutoffMs)) {
        kept += 1
        continue
      }
      await rm(join(this.threadsDir, input.threadId, 'snapshots', manifest.snapshotId), {
        recursive: true, force: true
      }).catch(() => undefined)
      removed.push(manifest.snapshotId)
    }
    return removed
  }
}
