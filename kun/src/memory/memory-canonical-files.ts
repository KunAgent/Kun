import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { applyPosixMode } from '../security/posix-permissions.js'
import type { MemoryRecord } from '../contracts/memory.js'
import { canonicalMemoryHash, normalizeMemoryRecord } from './memory-record-normalizer.js'

export const MEMORY_MAX_FALLBACK_FILES = 5_000
const SAFE_MEMORY_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u

export type CanonicalMemoryReadResult = {
  records: MemoryRecord[]
  malformedIds: string[]
  totalFiles: number
  truncated: boolean
}

export async function readCanonicalMemoryDirectory(
  rootDir: string,
  options: { maxFiles?: number } = {}
): Promise<CanonicalMemoryReadResult> {
  await ensureMemoryRoot(rootDir)
  const maxFiles = Math.max(0, Math.floor(options.maxFiles ?? Number.MAX_SAFE_INTEGER))
  const entries = (await readdir(rootDir).catch(() => []))
    .filter((entry) => entry.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
  const selected = entries.slice(0, maxFiles)
  const parsed: Array<ReturnType<typeof normalizeMemoryRecord>> = []
  for (let offset = 0; offset < selected.length; offset += 64) {
    parsed.push(...await Promise.all(selected.slice(offset, offset + 64).map(async (entry) => {
      const identifier = entry.slice(0, -'.json'.length)
      try {
        const value = JSON.parse(await readFile(join(rootDir, entry), 'utf8')) as unknown
        return normalizeMemoryRecord(value, identifier)
      } catch {
        return { ok: false as const, identifier, reason: 'invalid-json' }
      }
    })))
  }
  return {
    records: parsed.flatMap((result) => result.ok ? [result.record] : []),
    malformedIds: parsed.flatMap((result) => result.ok ? [] : [result.identifier]).slice(0, 64),
    totalFiles: entries.length,
    truncated: entries.length > selected.length
  }
}

export async function readCanonicalMemoryRecordHashes(
  rootDir: string,
  ids: readonly string[]
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  await Promise.all(ids.map(async (id) => {
    try {
      const value = JSON.parse(await readFile(memoryRecordPath(rootDir, id), 'utf8')) as unknown
      const normalized = normalizeMemoryRecord(value, id)
      if (normalized.ok) hashes.set(id, canonicalMemoryHash(normalized.record))
    } catch {
      // Missing, malformed, or unsafe id: omit from the map so the caller skips the record.
    }
  }))
  return hashes
}

export async function writeCanonicalMemoryRecord(rootDir: string, record: MemoryRecord): Promise<void> {
  await ensureMemoryRoot(rootDir)
  await atomicWriteFile(memoryRecordPath(rootDir, record.id), JSON.stringify(record, null, 2))
}

export async function purgeCanonicalMemoryRecord(rootDir: string, id: string): Promise<void> {
  await rm(memoryRecordPath(rootDir, id), { force: true })
}

export function memoryRecordPath(rootDir: string, id: string): string {
  if (!SAFE_MEMORY_ID.test(id)) throw new Error(`invalid memory id: ${id}`)
  const root = resolve(rootDir)
  const target = resolve(root, `${id}.json`)
  const pathRelative = relative(root, target)
  if (!pathRelative || pathRelative === '.' || pathRelative === '..' || pathRelative.startsWith(`..${sep}`)) {
    throw new Error('memory record path must stay below the canonical memory directory')
  }
  return target
}

export function assertSafeMemoryIndexPath(dataDir: string, sqlitePath: string): string {
  const root = resolve(dataDir)
  const target = resolve(sqlitePath)
  const pathRelative = relative(root, target)
  if (!pathRelative || pathRelative === '.' || pathRelative === '..' || pathRelative.startsWith(`..${sep}`)) {
    throw new Error('memory index path must stay below the configured data directory')
  }
  if (dirname(target) !== root || !target.endsWith('.sqlite3')) {
    throw new Error('memory index must be a .sqlite3 file directly below the configured data directory')
  }
  return target
}

async function ensureMemoryRoot(rootDir: string): Promise<void> {
  await mkdir(rootDir, { recursive: true, mode: 0o700 })
  await applyPosixMode(rootDir, 0o700)
}
