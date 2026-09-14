import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './atomic-write.js'
import type { RuntimeEvent } from '../../contracts/events.js'

export type HighestSeqCacheEntry = { seq: number; size: number; mtimeMs: number | null }

/**
 * Per-cursor-file append state. Transient checkpoints land on the per-thread
 * write queue, so a single stat+mkdir on first use and an in-memory size are
 * enough; the data dir has one writer process (runtime lease), and the file
 * is only ever appended or atomically rewritten from this path.
 */
const cursorFileState = new Map<string, {
  dirEnsured: boolean
  size: number | null
  seq: number | null
}>()

export function clearCursorCheckpointState(threadDir: string): void {
  cursorFileState.delete(join(threadDir, 'events.cursor'))
}

export function resetCursorCheckpointState(): void {
  cursorFileState.clear()
}

export async function persistCursorCheckpoint(threadDir: string, seq: number): Promise<void> {
  const path = join(threadDir, 'events.cursor')
  let state = cursorFileState.get(path)
  if (!state) {
    state = { dirEnsured: false, size: null, seq: null }
    cursorFileState.set(path, state)
  }
  if (!state.dirEnsured) {
    await mkdir(threadDir, { recursive: true, mode: 0o700 })
    state.dirEnsured = true
  }
  if (state.size === null) {
    state.size = (await stat(path).catch(() => null))?.size ?? 0
  }
  const line = `${seq}\n`
  const lineBytes = Buffer.byteLength(line, 'utf8')
  try {
    await appendFile(path, line, { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    // A failed or torn append leaves the on-disk size unknown; re-stat next
    // time rather than trusting the in-memory offset.
    state.size = null
    throw error
  }
  state.seq = seq
  state.size += lineBytes
  if (state.size > 64 * 1024) {
    await atomicWriteFile(path, line, { allowDirectWriteFallback: false })
    state.size = lineBytes
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
  const known = cursorFileState.get(join(threadDir, 'events.cursor'))
  // Only trust a value this process actually appended; a state entry created
  // by a failed write must fall through to the file.
  if (known?.seq !== null && known?.seq !== undefined) return known.seq
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
