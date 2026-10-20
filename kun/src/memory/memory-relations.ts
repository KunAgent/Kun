import { createHash } from 'node:crypto'
import type { MemoryRecord } from '../contracts/memory.js'
import type { MemoryRelationBinding, MemoryRelationProposal } from '../contracts/memory-relations.js'
import { canonicalMemoryHash } from './memory-record-normalizer.js'
import { memoryLifecycleState, normalizeMemoryScopePath } from './memory-ranking.js'
import { MemoryRevisionConflictError } from './memory-revisions.js'

export class MemoryRelationConflictError extends MemoryRevisionConflictError {
  constructor() { super('Memory relation is unavailable or stale. Refresh and analyze again.') }
}

export function relationBinding(record: MemoryRecord): MemoryRelationBinding {
  return { id: record.id, revision: record.revision, fingerprint: canonicalMemoryHash(record) }
}

export function relationBindingMatches(record: MemoryRecord, binding: MemoryRelationBinding): boolean {
  return record.id === binding.id && record.revision === binding.revision &&
    canonicalMemoryHash(record) === binding.fingerprint
}

export function relationRecordEligible(record: MemoryRecord, nowMs: number): boolean {
  return !record.agentContext && record.authority === 'reference' &&
    memoryLifecycleState(record, nowMs) === 'active'
}

export function sameRelationScope(source: MemoryRecord, target: MemoryRecord): boolean {
  if (source.agentContext || target.agentContext || source.scope !== target.scope) return false
  if (source.scope === 'user') return true
  if (source.scope === 'workspace') {
    return normalizeMemoryScopePath(source.workspace) === normalizeMemoryScopePath(target.workspace)
  }
  if (source.projectIdentity || target.projectIdentity) {
    return Boolean(source.projectIdentity && target.projectIdentity &&
      normalizeMemoryScopePath(source.projectIdentity) === normalizeMemoryScopePath(target.projectIdentity))
  }
  return normalizeMemoryScopePath(source.project ?? source.workspace) ===
    normalizeMemoryScopePath(target.project ?? target.workspace)
}

export function relationId(proposal: MemoryRelationProposal): string {
  // One decision per directed pair/version, irrespective of later model wording.
  return 'relation_' + createHash('sha256').update(JSON.stringify([
    proposal.source.id, proposal.source.revision, proposal.source.fingerprint,
    proposal.target.id, proposal.target.revision, proposal.target.fingerprint
  ])).digest('hex')
}

export function relationEvidenceValid(record: MemoryRecord, span: { start: number; end: number }): boolean {
  return span.end <= record.content.length && record.content.slice(span.start, span.end).trim().length > 0
}
