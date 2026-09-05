import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'

const ATTACHMENTS_DIR = 'maintenance-attachments'

export function referencesChunkPath(dataDir: string, generation: number): string {
  return join(dataDir, ATTACHMENTS_DIR, `gen-${generation}.jsonl`)
}

export function compactedReferencesPath(dataDir: string, generation: number): string {
  return join(dataDir, ATTACHMENTS_DIR, `gen-${generation}.json`)
}

/**
 * Append one scan slice's newly discovered references as a single JSON-array
 * line. Returns the number of bytes appended so callers can track total write
 * amplification. The append happens before the cursor is advanced, so a crash
 * can only produce duplicate lines that are deduplicated at compaction time.
 */
export async function appendReferencesChunk(
  dataDir: string,
  generation: number,
  ids: readonly string[]
): Promise<number> {
  if (ids.length === 0) return 0
  await mkdir(join(dataDir, ATTACHMENTS_DIR), { recursive: true, mode: 0o700 })
  const line = `${JSON.stringify(ids)}\n`
  await appendFile(referencesChunkPath(dataDir, generation), line, { encoding: 'utf8', mode: 0o600 })
  return Buffer.byteLength(line, 'utf8')
}

/**
 * Read every chunk line for a generation. A crash mid-append can leave a
 * partial trailing line, so malformed lines are skipped; duplicates are
 * tolerated and removed later at compaction time.
 */
export async function readReferencesChunk(dataDir: string, generation: number): Promise<string[]> {
  const text = await readFile(referencesChunkPath(dataDir, generation), 'utf8').catch(() => '')
  const ids: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) continue
      for (const id of parsed) if (typeof id === 'string') ids.push(id)
    } catch {
      // Skip the malformed line.
    }
  }
  return ids
}

/** Atomically write a generation's deduplicated, sorted reference set. */
export async function writeCompactedReferences(
  dataDir: string,
  generation: number,
  ids: readonly string[]
): Promise<number> {
  const contents = JSON.stringify(ids)
  await atomicWriteFile(compactedReferencesPath(dataDir, generation), contents)
  return Buffer.byteLength(contents, 'utf8')
}

/** Read a compacted generation file; returns [] when absent or unreadable. */
export async function readCompactedReferences(dataDir: string, generation: number): Promise<string[]> {
  const text = await readFile(compactedReferencesPath(dataDir, generation), 'utf8').catch(() => '')
  try {
    const parsed: unknown = JSON.parse(text)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

/**
 * Remove a generation's on-disk files. By default both the chunk (`jsonl`) and
 * compacted (`json`) files are removed; pass an explicit `json: false` or
 * `jsonl: false` to keep one artifact while deleting the other.
 */
export async function removeGenerationFiles(
  dataDir: string,
  generation: number,
  options: { json?: boolean; jsonl?: boolean } = {}
): Promise<void> {
  const removeJson = options.json ?? true
  const removeJsonl = options.jsonl ?? true
  await Promise.all([
    removeJson ? rm(compactedReferencesPath(dataDir, generation), { force: true }) : Promise.resolve(),
    removeJsonl ? rm(referencesChunkPath(dataDir, generation), { force: true }) : Promise.resolve()
  ])
}
