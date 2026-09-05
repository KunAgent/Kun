import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write.js'
import type { RuntimeEvent } from '../../contracts/events.js'

export type HighestSeqCacheEntry = { seq: number; size: number; mtimeMs: number | null }

export async function persistCursorCheckpoint(threadDir: string, seq: number): Promise<void> {
  await mkdir(threadDir, { recursive: true, mode: 0o700 })
  const path = join(threadDir, 'events.cursor')
  await appendFile(path, `${seq}\n`, { encoding: 'utf8', mode: 0o600 })
  if ((await stat(path)).size > 64 * 1024) {
    await atomicWriteFile(path, `${seq}\n`, { allowDirectWriteFallback: false })
  }
}

export async function persistCursorCheckpointEvent(
  event: RuntimeEvent,
  threadDir: string,
  withWrite: (operation: () => Promise<void>) => Promise<void>
): Promise<boolean> {
  if (event.kind !== 'cursor_checkpoint') return false
  await withWrite(() => persistCursorCheckpoint(threadDir, event.seq))
  return true
}

export async function loadCursorCheckpoint(threadDir: string): Promise<number> {
  try {
    const lines = (await readFile(join(threadDir, 'events.cursor'), 'utf8')).trim().split('\n')
    const value = Number.parseInt(lines.at(-1) ?? '', 10)
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
  } catch {
    return 0
  }
}

export function updateHighestSeqCache(input: {
  cache: Map<string, HighestSeqCacheEntry>
  threadId: string
  seq: number
  info: { size: number; mtimeMs: number | null }
  maxThreads: number
  preserveHigher?: boolean
}): void {
  const current = input.cache.get(input.threadId)?.seq ?? 0
  input.cache.delete(input.threadId)
  input.cache.set(input.threadId, {
    seq: input.preserveHigher ? Math.max(current, input.seq) : input.seq,
    size: input.info.size,
    mtimeMs: input.info.mtimeMs
  })
  while (input.cache.size > input.maxThreads) {
    const oldest = input.cache.keys().next().value
    if (oldest === undefined) return
    input.cache.delete(oldest)
  }
}
