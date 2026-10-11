import { createHash } from 'node:crypto'
import type { MemoryRecord, MemoryConsolidation } from '../contracts/memory.js'
import { canonicalMemoryHash } from './memory-record-normalizer.js'

/** Records the exact prepared input, not a claim that a model read or used it. */
export type MemoryInjectionReceipt = {
  version: 1
  state: 'prepared-input'
  preparedAt: string
  inputHash: string
  entries: Array<{ memoryId: string; revision: number; fingerprint: string; sourceIds: string[];
    evidenceStatus?: MemoryConsolidation['evidenceStatus'] }>
}
export function memoryInjectionReceipt(records: readonly MemoryRecord[], text: string, now = new Date().toISOString()): MemoryInjectionReceipt {
  return { version: 1, state: 'prepared-input', preparedAt: now,
    inputHash: createHash('sha256').update(text).digest('hex'),
    entries: records.map((record) => ({ memoryId: record.id, revision: record.revision ?? 0,
      fingerprint: canonicalMemoryHash(record), sourceIds: record.sources.map((source) => source.id),
      evidenceStatus: record.consolidation?.evidenceStatus })) }
}
