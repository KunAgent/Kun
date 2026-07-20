import type { WorkerResult } from './types.js'

const FORBIDDEN_WORKER_REPORT_KEYS = new Set([
  'markdown',
  'report',
  'reportMarkdown',
  'draftReport',
  'section',
  'sections',
  'chapters'
])

export function validateWorkerResult(result: WorkerResult): void {
  for (const key of Object.keys(result as Record<string, unknown>)) {
    if (FORBIDDEN_WORKER_REPORT_KEYS.has(key)) {
      throw new Error(`ResearchTaskWorker output must not include final report prose field: ${key}`)
    }
  }
  if (result.notes.length === 0) {
    throw new Error(`ResearchTaskWorker ${result.taskId} must produce at least one structured note`)
  }
  for (const note of result.notes) {
    if (note.taskId !== result.taskId) {
      throw new Error(`ResearchNote ${note.id} taskId does not match worker task ${result.taskId}`)
    }
    for (const claimId of note.claimIds) {
      if (!result.claims.some((claim) => claim.id === claimId)) {
        throw new Error(`ResearchNote ${note.id} references unknown claim ${claimId}`)
      }
    }
  }
  for (const claim of result.claims) {
    for (const spanId of claim.supportSpanIds) {
      if (!result.evidenceSpans.some((span) => span.id === spanId)) {
        throw new Error(`AtomicClaim ${claim.id} references unknown evidence span ${spanId}`)
      }
    }
  }
  for (const span of result.evidenceSpans) {
    if (!result.sources.some((source) => source.id === span.sourceId)) {
      throw new Error(`EvidenceSpan ${span.id} references unknown source ${span.sourceId}`)
    }
  }
}
