import { createHash } from 'node:crypto'
import type { ConsolidationJob } from '../contracts/consolidation-job.js'
import { MemoryRecord } from '../contracts/memory.js'

export function consolidationMemoryHash(memory: unknown): string {
  return sha256(JSON.stringify(MemoryRecord.parse(memory)))
}

/** Deterministic integrity only; this makes no claim about summary quality. */
export function verifyConsolidationEvidence(job: ConsolidationJob, value: unknown): void {
  const memory = MemoryRecord.parse(value)
  const source = memory.sources.find((entry) => entry.threadId === job.threadId)
  if (memory.id !== job.memoryIds[0] || memory.sourceThreadId !== job.threadId ||
    memory.type !== 'episode' || memory.authority !== 'reference' ||
    memory.deletedAt || memory.disabledAt || memory.supersededAt ||
    !source?.excerpt || source.contentHash !== sha256(source.excerpt)) {
    throw new Error('episode evidence is incomplete or mismatched')
  }
  const sourceId = `src_consolidation_${sha256(JSON.stringify([
    job.threadId, job.cutoffRevision, source.contentHash
  ])).slice(0, 24)}`
  if (source.id !== sourceId) throw new Error('episode source fingerprint does not match job')
  if (job.checkpoint && (!job.checkpoint.memoryHash ||
    job.checkpoint.memoryHash !== consolidationMemoryHash(memory))) {
    throw new Error('episode no longer matches consolidation checkpoint')
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
