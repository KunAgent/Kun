import { MemoryRecord, MemoryRevisionSnapshot, type MemoryRevision } from '../contracts/memory.js'

export class MemoryRevisionConflictError extends Error {
  constructor(message = 'memory changed; reload before editing') {
    super(message)
    this.name = 'MemoryRevisionConflictError'
  }
}

export function assertMemoryRevision(record: MemoryRecord, expected?: number): void {
  if (expected !== undefined && expected !== record.revision) throw new MemoryRevisionConflictError()
}

export function revisionSnapshot(record: MemoryRecord): MemoryRevision['snapshot'] {
  return MemoryRevisionSnapshot.parse({
    content: record.content, tags: record.tags, type: record.type, authority: record.authority,
    confidence: record.confidence, importance: record.importance, sources: record.sources,
    observedAt: record.observedAt, expiresAt: record.expiresAt, validFrom: record.validFrom,
    validTo: record.validTo, disabledAt: record.disabledAt, agentContext: record.agentContext, consolidation: record.consolidation
  })
}

/** Keep revision snapshots in the same atomic canonical write as their current state. */
export function reviseMemory(current: MemoryRecord, next: MemoryRecord,
  operation: MemoryRevision['operation']): MemoryRecord {
  const history = [...current.history, {
    revision: current.revision, changedAt: next.updatedAt, operation, snapshot: revisionSnapshot(current)
  }].slice(-20)
  // A long legacy record must never make every subsequent mutation unbounded.
  while (history.length && JSON.stringify(history).length > 64_000) history.shift()
  return MemoryRecord.parse({ ...next, revision: current.revision + 1, history })
}

export function rollbackMemory(current: MemoryRecord, targetRevision: number, now: string): MemoryRecord {
  if (current.deletedAt) throw new MemoryRevisionConflictError('forgotten memories cannot be restored by rollback')
  const entry = current.history.find((item) => item.revision === targetRevision)
  if (!entry) throw new MemoryRevisionConflictError('requested revision is outside the retained history')
  // Scope, ownership identity, sources of consolidation and lifecycle are never broadened by history.
  if (entry.snapshot.agentContext?.agentId !== current.agentContext?.agentId) {
    throw new MemoryRevisionConflictError('rollback cannot change memory ownership')
  }
  return reviseMemory(current, MemoryRecord.parse({
    ...current, ...entry.snapshot,
    agentContext: current.agentContext ? { ...current.agentContext, locked: true } : undefined,
    updatedAt: now
  }), 'rollback')
}
