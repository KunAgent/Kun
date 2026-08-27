import { lstat, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isSafeThreadId } from '../contracts/thread-id.js'

/**
 * Session Guardian: bounded, read-mostly health scans over thread storage.
 *
 * The scan never loads a full log into memory: file sizes come from stat,
 * and item/event counts come from streaming JSONL line iteration with a
 * cap. Warnings are advisory — the guardian never prunes user history on
 * its own.
 */

export type ThreadHealthReport = {
  threadId: string
  messagesBytes: number
  eventsBytes: number
  metadataBytes: number
  archivesBytes: number
  snapshotsBytes: number
  staleTmpCount: number
  staleTmpOldestAgeMs: number | null
  eventCount: number
  itemCount: number
  compactionCount: number
  modelContextCount: number
  modelContextBaselineCount: number
  warnings: string[]
}

export type GuardianThresholds = {
  maxEventsBytes?: number
  maxMessagesBytes?: number
  maxMetadataBytes?: number
  maxEventCount?: number
  maxStaleTmpAgeMs?: number
}

export const DEFAULT_GUARDIAN_THRESHOLDS: Required<GuardianThresholds> = {
  maxEventsBytes: 64 * 1024 * 1024,
  maxMessagesBytes: 32 * 1024 * 1024,
  maxMetadataBytes: 16 * 1024 * 1024,
  maxEventCount: 200_000,
  maxStaleTmpAgeMs: 24 * 60 * 60 * 1_000
}

/** File-name patterns Kun itself creates for atomic writes and staging. */
const OWNED_TMP_PATTERNS = [
  /^messages\.jsonl\.\d+\.\d+\.[0-9a-f-]{8,}\.tmp$/,
  /^events\.jsonl\.\d+\.\d+\.[0-9a-f-]{8,}\.tmp$/,
  /^metadata\.jsonl\.compact\.tmp$/,
  /^metadata\.jsonl\.\d+\.[0-9a-f-]{8,}\.tmp$/,
  /^metadata\.jsonl\.\d+\.\d+\.[0-9a-f-]{8,}\.repair\.tmp$/
]

export class SessionGuardian {
  private readonly dataDir: string
  private readonly nowIso: () => string
  private readonly thresholds: GuardianThresholds

  constructor(deps: { dataDir: string; nowIso: () => string; thresholds?: GuardianThresholds }) {
    this.dataDir = deps.dataDir
    this.nowIso = deps.nowIso
    this.thresholds = { ...DEFAULT_GUARDIAN_THRESHOLDS, ...deps.thresholds }
  }

  /** Scan every thread directory; bounded per-file reads keep memory flat. */
  async scanAll(): Promise<ThreadHealthReport[]> {
    const threadsRoot = join(this.dataDir, 'threads')
    const entries = await readdir(threadsRoot, { withFileTypes: true }).catch(() => [])
    const reports: ThreadHealthReport[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !isSafeThreadId(entry.name)) continue
      reports.push(await this.scanThread(entry.name))
    }
    return reports
  }

  async scanThread(threadId: string): Promise<ThreadHealthReport> {
    const dir = join(this.dataDir, 'threads', threadId)
    const warnings: string[] = []
    const [messagesBytes, eventsBytes, metadataBytes, archivesBytes, snapshotsBytes, staleTmp] =
      await Promise.all([
        fileSize(join(dir, 'messages.jsonl')),
        fileSize(join(dir, 'events.jsonl')),
        fileSize(join(dir, 'metadata.jsonl')),
        dirSize(join(dir, 'archives')),
        dirSize(join(dir, 'snapshots')),
        this.findStaleTmp(dir)
      ])
    const [eventCount, itemCount, compactionCount, modelContextCount, baselineCount] =
      await Promise.all([
        countJsonlLines(join(dir, 'events.jsonl')),
        countJsonlLines(join(dir, 'messages.jsonl')),
        countKindOccurrences(join(dir, 'messages.jsonl'), '"kind":"compaction"'),
        countKindOccurrences(join(dir, 'messages.jsonl'), '"kind":"model_context"'),
        countKindOccurrences(join(dir, 'messages.jsonl'), '"baseline":true')
      ])
    if (eventsBytes > this.thresholds.maxEventsBytes!) {
      warnings.push(`events.jsonl ${formatBytes(eventsBytes)} exceeds ${formatBytes(this.thresholds.maxEventsBytes!)}`)
    }
    if (messagesBytes > this.thresholds.maxMessagesBytes!) {
      warnings.push(`messages.jsonl ${formatBytes(messagesBytes)} exceeds ${formatBytes(this.thresholds.maxMessagesBytes!)}`)
    }
    if (metadataBytes > this.thresholds.maxMetadataBytes!) {
      warnings.push(`metadata.jsonl ${formatBytes(metadataBytes)} exceeds ${formatBytes(this.thresholds.maxMetadataBytes!)}`)
    }
    if (eventCount > this.thresholds.maxEventCount!) {
      warnings.push(`event count ${eventCount} exceeds ${this.thresholds.maxEventCount}`)
    }
    if (compactionCount > 5) {
      warnings.push(`${compactionCount} compaction markers retained; expected at most a few after canonical rewrite`)
    }
    if (modelContextCount > 8 && baselineCount === 0) {
      warnings.push(`${modelContextCount} model_context deltas without a baseline; squash did not run`)
    }
    if (staleTmp.length > 0) {
      warnings.push(`${staleTmp.length} stale temp file(s) (oldest ${Math.round((staleTmp[0]?.ageMs ?? 0) / 3_600_000)}h old)`)
    }
    return {
      threadId,
      messagesBytes,
      eventsBytes,
      metadataBytes,
      archivesBytes,
      snapshotsBytes,
      staleTmpCount: staleTmp.length,
      staleTmpOldestAgeMs: staleTmp[0]?.ageMs ?? null,
      eventCount,
      itemCount,
      compactionCount,
      modelContextCount,
      modelContextBaselineCount: baselineCount,
      warnings
    }
  }

  /**
   * Delete provably-own stale temp files: strict name patterns inside a
   * thread directory, older than the grace period, with no symlink. Unknown
   * or fresh files are only reported, never removed.
   */
  async cleanupStaleTmp(threadId: string): Promise<{ removed: string[]; kept: string[] }> {
    const dir = join(this.dataDir, 'threads', threadId)
    const stale = await this.findStaleTmp(dir)
    const removed: string[] = []
    const kept: string[] = []
    for (const candidate of stale) {
      const target = join(dir, candidate.name)
      const link = await lstat(target).catch(() => null)
      if (!link || link.isSymbolicLink()) { kept.push(candidate.name); continue }
      const canonical = await stat(join(dir, candidate.name.replace(/\.[0-9a-f-]{8,}\.tmp$/, '').replace(/\.compact\.tmp$/, '').replace(/\.repair\.tmp$/, ''))).catch(() => null)
      // The canonical file must exist (or be legitimately absent for a fresh
      // thread) before a staged replacement can be considered garbage.
      if (!canonical) { kept.push(candidate.name); continue }
      await rm(target, { force: true }).catch(() => undefined)
      removed.push(candidate.name)
    }
    return { removed, kept }
  }

  private async findStaleTmp(dir: string): Promise<Array<{ name: string; ageMs: number }>> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const now = Date.parse(this.nowIso())
    const stale: Array<{ name: string; ageMs: number }> = []
    for (const entry of entries) {
      if (!entry.isFile() || !OWNED_TMP_PATTERNS.some((pattern) => pattern.test(entry.name))) continue
      const info = await stat(join(dir, entry.name)).catch(() => null)
      if (!info) continue
      const ageMs = Number.isFinite(now) ? now - info.mtimeMs : Number.POSITIVE_INFINITY
      if (ageMs >= this.thresholds.maxStaleTmpAgeMs!) {
        stale.push({ name: entry.name, ageMs })
      }
    }
    return stale.sort((left, right) => right.ageMs - left.ageMs)
  }
}

async function fileSize(path: string): Promise<number> {
  const info = await stat(path).catch(() => null)
  return info?.size ?? 0
}

async function dirSize(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  let total = 0
  for (const entry of entries) {
    if (entry.isDirectory()) {
      total += await dirSize(join(path, entry.name))
    } else {
      total += await fileSize(join(path, entry.name))
    }
  }
  return total
}

/**
 * Stream-count JSONL lines without materializing the file. A hard line cap
 * bounds work on pathological logs; the exact count beyond it is irrelevant
 * because any threshold it could influence is already exceeded.
 */
async function countJsonlLines(path: string, cap = 500_000): Promise<number> {
  const { createReadStream } = await import('node:fs')
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path, { encoding: 'utf-8', highWaterMark: 64 * 1024 })
    let count = 0
    let remainder = ''
    stream.on('data', (chunk: string | Buffer) => {
      remainder += String(chunk)
      let index = remainder.indexOf('\n')
      while (index >= 0) {
        count += 1
        if (count >= cap) { stream.destroy(); resolve(count); return }
        remainder = remainder.slice(index + 1)
        index = remainder.indexOf('\n')
      }
    })
    stream.on('end', () => {
      if (remainder.trim()) count += 1
      resolve(count)
    })
    stream.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') resolve(0)
      else reject(error)
    })
  })
}

async function countKindOccurrences(path: string, needle: string, cap = 500_000): Promise<number> {
  const { createReadStream } = await import('node:fs')
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path, { encoding: 'utf-8', highWaterMark: 64 * 1024 })
    let count = 0
    let remainder = ''
    stream.on('data', (chunk: string | Buffer) => {
      remainder += String(chunk)
      let index = remainder.indexOf('\n')
      while (index >= 0) {
        if (remainder.slice(0, index).includes(needle)) count += 1
        if (count >= cap) { stream.destroy(); resolve(count); return }
        remainder = remainder.slice(index + 1)
        index = remainder.indexOf('\n')
      }
    })
    stream.on('end', () => {
      if (remainder.includes(needle)) count += 1
      resolve(count)
    })
    stream.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') resolve(0)
      else reject(error)
    })
  })
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}
