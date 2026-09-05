import { canonicalMemoryHash } from './memory-record-normalizer.js'
import { normalizeMemoryCandidateContent } from '../contracts/memory-distillation.js'
import type {
  MemoryDistillationApplyReceipt,
  PendingMemoryCandidate
} from '../contracts/memory-distillation-runtime.js'
import type { MemoryRecord, MemorySourceEvidence } from '../contracts/memory.js'
import { isMemoryActive, type MemoryStore } from './memory-store.js'

type DistillationWriteStore = Pick<MemoryStore, 'list' | 'update' | 'createWithId'>

export class MemoryDistillationConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MemoryDistillationConflictError'
  }
}

export function buildMemoryDistillationApplyReceipt(
  current: PendingMemoryCandidate
): MemoryDistillationApplyReceipt {
  const expectedMemoryId = current.proposedAction.action === 'update'
    ? current.proposedAction.memoryId
    : `mem_distilled_${current.fingerprint.slice(0, 20)}`
  return {
    operationId: `apply_${current.fingerprint.slice(0, 24)}`,
    expectedMemoryId,
    ...(current.proposedAction.action === 'create'
      ? {}
      : { targetUpdatedAt: current.proposedAction.targetUpdatedAt })
  }
}

export async function validateMemoryDistillationApplyIntent(
  store: DistillationWriteStore,
  current: PendingMemoryCandidate,
  nowMs: number
): Promise<MemoryRecord | undefined> {
  const active = (await store.list({
    workspace: current.target.workspace,
    includeDeleted: true
  })).filter((record) =>
    record.scope === 'workspace' && isMemoryActive(record, nowMs)
  )
  const action = current.proposedAction
  const target = action.action === 'create'
    ? undefined
    : active.find((record) => record.id === action.memoryId)
  if (action.action !== 'create') {
    if (!target) {
      throw new MemoryDistillationConflictError('the proposed Memory target is no longer active')
    }
    if (target.updatedAt !== action.targetUpdatedAt || canonicalMemoryHash(target) !== action.targetFingerprint) {
      throw new MemoryDistillationConflictError('the proposed Memory target changed after extraction')
    }
  }

  const candidateContent = comparableContent(current.candidate.content)
  const duplicate = active.find((record) =>
    record.id !== target?.id && comparableContent(record.content) === candidateContent
  )
  if (duplicate) {
    throw new MemoryDistillationConflictError('an equivalent active Memory already exists')
  }
  return target
}

async function writeMemoryDistillationCandidate(
  store: DistillationWriteStore,
  current: PendingMemoryCandidate,
  target: MemoryRecord | undefined
): Promise<MemoryRecord> {
  if (!current.applyReceipt) throw new Error('memory distillation apply receipt is unavailable')
  const input = {
    content: current.candidate.content,
    scope: 'workspace' as const,
    workspace: current.target.workspace,
    sourceThreadId: current.threadId,
    sourceTurnId: current.turnId,
    provenance: { kind: 'inference' as const, turnId: current.turnId },
    tags: current.candidate.tags,
    confidence: current.candidate.confidence,
    type: current.candidate.type,
    importance: current.candidate.importance,
    observedAt: current.candidate.observedAt,
    sources: current.candidate.sources
  }
  if (current.proposedAction.action === 'update') {
    if (!target) throw new MemoryDistillationConflictError('the update target is unavailable')
    return store.update(target.id, {
      content: input.content,
      tags: input.tags,
      confidence: input.confidence,
      type: input.type,
      importance: input.importance,
      observedAt: input.observedAt,
      sources: mergeSources(input.sources, target.sources)
    }, { workspace: current.target.workspace })
  }
  if (!store.createWithId) {
    throw new Error('memory store does not support crash-safe distillation IDs')
  }
  const supersedes = current.proposedAction.action === 'supersede'
    ? target?.id
    : undefined
  if (current.proposedAction.action === 'supersede' && !supersedes) {
    throw new MemoryDistillationConflictError('the supersede target is unavailable')
  }
  return store.createWithId(current.applyReceipt.expectedMemoryId, {
    ...input,
    ...(supersedes ? { supersedes } : {})
  })
}

/** Every backend must validate and write under the same canonical mutation queue. */
export async function applyMemoryDistillationCandidate(
  store: MemoryStore,
  current: PendingMemoryCandidate,
  _target?: MemoryRecord
): Promise<MemoryRecord> {
  if (!store.commitDistillation) throw new Error('atomic memory distillation is unavailable')
  return store.commitDistillation(current)
}

/** Called only while the owning backend holds its mutation queue. */
export async function commitMemoryDistillationCandidate(
  store: DistillationWriteStore,
  current: PendingMemoryCandidate,
  nowMs: number
): Promise<MemoryRecord> {
  if (current.status !== 'applying' || !current.applyReceipt) {
    throw new MemoryDistillationConflictError('memory candidate has no approved apply receipt')
  }
  const records = await store.list({ workspace: current.target.workspace, includeDeleted: true })
  const expected = records.find((record) => record.id === current.applyReceipt!.expectedMemoryId)
  if (expected && memoryRecordMatchesDistillationCandidate(expected, current)) {
    if (current.proposedAction.action === 'supersede') {
      const action = current.proposedAction
      const target = records.find((record) => record.id === action.memoryId)
      if (!target) throw new MemoryDistillationConflictError('the supersede target is unavailable')
      if (!target.supersededAt) {
        // Recover an interrupted two-record write only if its old target is unchanged.
        if (target.updatedAt !== action.targetUpdatedAt || canonicalMemoryHash(target) !== action.targetFingerprint) {
          throw new MemoryDistillationConflictError('the proposed Memory target changed after extraction')
        }
        return writeMemoryDistillationCandidate(store, current, target)
      }
    }
    return expected
  }
  if (expected && current.proposedAction.action !== 'update') {
    throw new MemoryDistillationConflictError('the expected Memory record changed')
  }
  const target = await validateMemoryDistillationApplyIntent(store, current, nowMs)
  return writeMemoryDistillationCandidate(store, current, target)
}

export function memoryRecordMatchesDistillationCandidate(
  record: MemoryRecord,
  current: PendingMemoryCandidate
): boolean {
  const candidate = current.candidate
  const sourceIds = new Set(record.sources.map((source) => source.id))
  return record.scope === 'workspace' &&
    !record.deletedAt && !record.disabledAt && !record.supersededAt &&
    record.authority === 'reference' &&
    record.content === candidate.content &&
    record.type === candidate.type &&
    record.confidence === candidate.confidence &&
    record.importance === candidate.importance &&
    record.observedAt === candidate.observedAt &&
    sameStrings(record.tags, candidate.tags) &&
    candidate.sources.every((source) => sourceIds.has(source.id)) &&
    (current.proposedAction.action !== 'supersede' ||
      record.supersedes === current.proposedAction.memoryId)
}

function mergeSources(
  candidate: readonly MemorySourceEvidence[],
  existing: readonly MemorySourceEvidence[]
): MemorySourceEvidence[] {
  const seen = new Set<string>()
  return [...candidate, ...existing]
    .filter((source) => !seen.has(source.id) && Boolean(seen.add(source.id)))
    .slice(0, 8)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function comparableContent(content: string): string {
  return normalizeMemoryCandidateContent(content).toLocaleLowerCase('en-US')
}
