import type { ThreadRecord, ThreadSummary } from '../contracts/threads.js'
import type { ThreadStore } from '../ports/thread-store.js'

/**
 * Metadata reads go through the Service Manager in managed mode, one HTTP
 * request each. Restart recovery needs every thread's turn states, so large
 * histories (thousands of threads) must not pay that round trip serially.
 */
export const THREAD_METADATA_SCAN_CONCURRENCY = 16

type MetadataReader = Pick<ThreadStore, 'list' | 'get' | 'getMetadata'>

/**
 * One startup snapshot of thread metadata, shared by the restart sweeps.
 * Entries are a prefilter only: a sweep re-reads a thread before acting on
 * it, because an earlier sweep may already have changed that record.
 */
export type ThreadMetadataScan = {
  readonly summaries: readonly ThreadSummary[]
  /** Metadata at scan time; null when the record is missing or unreadable. */
  readonly metadata: ReadonlyMap<string, ThreadRecord | null>
}

/** Metadata-only read with the full record as fallback; failures read as null. */
export async function readThreadMetadata(
  store: Pick<ThreadStore, 'get' | 'getMetadata'>,
  threadId: string
): Promise<ThreadRecord | null> {
  try {
    return await (store.getMetadata?.(threadId) ?? store.get(threadId))
  } catch {
    return null
  }
}

/** List every thread (including side threads) and read their metadata in parallel. */
export async function scanThreadMetadata(
  store: MetadataReader,
  options: { concurrency?: number } = {}
): Promise<ThreadMetadataScan> {
  const summaries = await store.list({ includeSide: true })
  const metadata = new Map<string, ThreadRecord | null>()
  let next = 0
  const workers = Math.min(
    Math.max(1, options.concurrency ?? THREAD_METADATA_SCAN_CONCURRENCY),
    summaries.length
  )
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < summaries.length) {
      const summary = summaries[next++]!
      metadata.set(summary.id, await readThreadMetadata(store, summary.id))
    }
  }))
  return { summaries, metadata }
}

/** Snapshot metadata when present in the scan; otherwise read it now. */
export async function scannedThreadMetadata(
  store: Pick<ThreadStore, 'get' | 'getMetadata'>,
  scan: ThreadMetadataScan,
  threadId: string
): Promise<ThreadRecord | null> {
  return scan.metadata.has(threadId)
    ? scan.metadata.get(threadId) ?? null
    : readThreadMetadata(store, threadId)
}
