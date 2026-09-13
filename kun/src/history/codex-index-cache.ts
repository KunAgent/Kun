import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { HistoryReference } from '../contracts/history-reference.js'
import type { CodexIndex } from './codex-index.js'

const MAX_ENTRIES = 8
const MAX_BYTES = 8 * 1024 * 1024
type Entry = { referenceId: string; signature: string; index: CodexIndex; bytes: number }
const entries = new Map<string, Entry>()
const building = new Map<string, Promise<CodexIndex>>()
let bytes = 0
let generation = 0

/** Only positions and bounded labels are cached. hydrateHistory still hashes source bytes before returning text. */
export async function getCachedCodexIndex(
  reference: HistoryReference, build: () => Promise<CodexIndex>
): Promise<CodexIndex> {
  const key = JSON.stringify([reference.id, reference.parserVersion, reference.cutoffTurnId,
    reference.files.map((file) => [resolve(file.path), file.byteLength, file.sha256])])
  let signature: string
  try { signature = await sourceSignature(reference) }
  catch (error) { invalidateCodexIndexCache(reference.id); throw error }
  const cached = entries.get(key)
  if (cached?.signature === signature) {
    entries.delete(key)
    entries.set(key, cached)
    return structuredClone(cached.index)
  }
  removeEntry(key)
  const pendingKey = `${key}\n${signature}\n${generation}`
  const current = building.get(pendingKey)
  if (current) return structuredClone(await current)
  const startedGeneration = generation
  const pending = (async () => {
    const index = await build()
    const size = indexBytes(index)
    if (size <= MAX_BYTES && startedGeneration === generation &&
      signature === await sourceSignature(reference)) {
      removeEntry(key)
      entries.set(key, { referenceId: reference.id, signature, index: structuredClone(index), bytes: size })
      bytes += size
      while (entries.size > MAX_ENTRIES || bytes > MAX_BYTES) removeEntry(entries.keys().next().value!)
    }
    return index
  })()
  building.set(pendingKey, pending)
  try { return await pending }
  finally { if (building.get(pendingKey) === pending) building.delete(pendingKey) }
}

/** Called after reference removal/relink; an old in-flight build must not repopulate removed metadata. */
export function invalidateCodexIndexCache(referenceId?: string): void {
  generation += 1
  for (const [key, entry] of entries) {
    if (!referenceId || entry.referenceId === referenceId) removeEntry(key)
  }
}

async function sourceSignature(reference: HistoryReference): Promise<string> {
  const signatures = await Promise.all(reference.files.map(async (file) => {
    const value = await stat(file.path, { bigint: true })
    if (!value.isFile()) throw new Error('Codex history source is not a regular file.')
    return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].map(String).join(':')
  }))
  return signatures.join('|')
}

function removeEntry(key: string): void {
  const entry = entries.get(key)
  if (entry) { entries.delete(key); bytes -= entry.bytes }
}

/** Conservative heap estimate with early exit, without serializing a large index into another large string. */
function indexBytes(index: CodexIndex): number {
  const text = (value: string | undefined) => 64 + (value?.length ?? 0) * 2
  let total = 512 + text(index.path) + text(index.sessionId) + text(index.title) + text(index.workspace)
  for (const file of index.files) total += 256 + text(file.path) + text(file.sessionId) + text(file.sha256)
  for (const warning of index.warnings) total += text(warning)
  for (const turn of index.turns) {
    total += 512 + text(turn.id) + text(turn.label) + text(turn.filePath) + text(turn.createdAt)
    for (const item of turn.items) {
      total += 192 + text(item.kind) + text(item.callId) + text(item.toolName)
      if (total > MAX_BYTES) return total
    }
    if (total > MAX_BYTES) return total
  }
  return total
}

/** Test-only observability; cached content is deliberately not exposed. */
export function codexIndexCacheStats(): { entries: number; bytes: number; building: number } {
  return { entries: entries.size, bytes, building: building.size }
}
