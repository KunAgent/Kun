import { readFile } from 'node:fs/promises'
import { atomicWriteFile } from './atomic-write.js'

/**
 * A torn tail (an unterminated final JSONL record) is only quarantined from the
 * index projection after it has been observed stable for this long with the
 * source file's size/mtime unchanged. Active appends complete the tail and are
 * never quarantined prematurely.
 */
export const EVENT_INDEX_REBUILD_TORN_TAIL_STABLE_MS = 5 * 60 * 1000

/** Consecutive retryable failures before a source is quarantined and skipped. */
export const EVENT_INDEX_REBUILD_FAILURE_LIMIT = 3

export type EventIndexRebuildDiagnosticReason =
  | 'torn_tail'
  | 'invalid_record'
  | 'oversized_record'
  | 'rebuild_failure'

export type EventIndexRebuildDiagnostic = {
  version: 1
  recordedAt: string
  threadId: string
  sourceFingerprint: string
  reason: EventIndexRebuildDiagnosticReason
  /** Absolute byte offset of the first corrupt/oversized/torn record. */
  byteOffset?: number
  /** Byte length of the torn tail or oversized record when known. */
  length?: number
  /** Number of corrupt records when the reason is a batch scan result. */
  count?: number
  /** Number of consecutive rebuild failures for a `rebuild_failure` record. */
  failureCount?: number
  /** Bounded sample hash so Guardian can correlate without replaying bodies. */
  sampleSha256?: string
  sampleTruncated?: boolean
}

/** Stable identity of a source file across sweeps, used to reset failure counts. */
export function eventIndexSourceFingerprint(info: {
  dev: number
  ino: number
  size: number
  mtimeMs: number
}): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`
}

/**
 * Persist a self-describing, bounded diagnostic for later repair. The file is
 * written atomically with 0600 permissions and never rewrites `events.jsonl`.
 */
export async function writeEventIndexRebuildDiagnostic(
  path: string,
  diagnostic: EventIndexRebuildDiagnostic
): Promise<void> {
  await atomicWriteFile(path, JSON.stringify(diagnostic))
}

export async function readEventIndexRebuildDiagnostic(
  path: string
): Promise<EventIndexRebuildDiagnostic | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as EventIndexRebuildDiagnostic
    return parsed && typeof parsed === 'object' && parsed.version === 1 ? parsed : undefined
  } catch {
    return undefined
  }
}
