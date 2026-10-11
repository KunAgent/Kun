import type { MemoryCandidate } from '../contracts/memory-distillation.js'
import type { MemoryConsolidation, MemoryRecord, MemorySourceEvidence } from '../contracts/memory.js'
import { MEMORY_MAX_SOURCES } from '../contracts/memory.js'

export const MEMORY_COMPARISON_CURRENT_MAX_BYTES = 12_000
export const MEMORY_COMPARISON_SNAPSHOT_MAX_BYTES = 208_000

/** History stays in the CAS snapshot, but must not consume the current-content eligibility budget. */
export function memoryComparisonFitsBudget(record: MemoryRecord): boolean {
  const { history: _history, ...current } = record
  return Buffer.byteLength(JSON.stringify(current)) <= MEMORY_COMPARISON_CURRENT_MAX_BYTES &&
    Buffer.byteLength(JSON.stringify(record)) <= MEMORY_COMPARISON_SNAPSHOT_MAX_BYTES
}

/** A completed assistant turn says nothing about whether its claimed work succeeded. */
export function memoryEvidenceStatus(sources: readonly MemorySourceEvidence[]): MemoryConsolidation['evidenceStatus'] {
  const observed = sources.filter((source) => source.kind === 'tool' && source.trust === 'observed' && source.receiptId)
  if (observed.some((source) => source.outcome === 'aborted')) return 'aborted'
  if (observed.some((source) => source.outcome === 'failed')) return 'observed-failure'
  if (observed.some((source) => source.outcome === 'succeeded')) return 'observed-success'
  return sources.some((source) => source.kind === 'user' && source.trust === 'explicit-user') ? 'user-stated' : 'unverified'
}

/** Preserve every cited source, or defer rather than silently sever provenance. */
export function mergeMemoryEvidence(...groups: ReadonlyArray<readonly MemorySourceEvidence[]>): MemorySourceEvidence[] {
  const sources = new Map<string, MemorySourceEvidence>()
  for (const group of groups) for (const source of group) {
    const existing = sources.get(source.id)
    sources.set(source.id, existing ? mergeCompatibleEvidence(existing, source) : source)
  }
  if (sources.size > MEMORY_MAX_SOURCES) throw new Error('memory consolidation evidence exceeds its budget')
  return [...sources.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function mergeCompatibleEvidence(left: MemorySourceEvidence, right: MemorySourceEvidence): MemorySourceEvidence {
  const keys = ['kind', 'trust', 'threadId', 'turnId', 'itemId', 'locator', 'contentHash',
    'receiptId', 'repositorySha', 'outcome'] as const
  if (keys.some((key) => left[key] !== undefined && right[key] !== undefined && left[key] !== right[key]) ||
    left.excerpt && right.excerpt && left.excerpt !== right.excerpt &&
      (!left.contentHash || left.contentHash !== right.contentHash)) {
    throw new Error('memory source identity changed')
  }
  const artifactIds = [...new Set([...(left.artifactIds ?? []), ...(right.artifactIds ?? [])])]
  if (artifactIds.length > 8) throw new Error('memory consolidation artifacts exceed their budget')
  return { ...left, ...right, ...(artifactIds.length ? { artifactIds } : {}) }
}

export function consolidateMemoryCandidate(candidate: MemoryCandidate, records: readonly MemoryRecord[], reason?: string): MemoryCandidate {
  const sources = mergeMemoryEvidence(candidate.sources, ...records.map((record) => record.sources))
  const sourceMemoryIds = [...new Set(records.flatMap((record) => [record.id, ...(record.consolidation?.sourceMemoryIds ?? [])]))]
  if (sourceMemoryIds.length > 8) throw new Error('memory consolidation lineage exceeds its budget')
  const sourceSessionIds = [...new Set([
    ...sources.flatMap((source) => source.threadId ? [source.threadId] : []),
    ...records.flatMap((record) => record.consolidation?.sourceSessionIds ?? [])
  ])]
  if (sourceSessionIds.length > 8) throw new Error('memory consolidation sessions exceed its budget')
  return { ...candidate, sources, consolidation: {
    sourceMemoryIds, sourceSessionIds,
    reason: reason?.trim().slice(0, 1000) || (records.length ? 'Updated by newer cited evidence; prior evidence retained.' : 'Durable information extracted from cited evidence.'),
    evidenceStatus: memoryEvidenceStatus(sources)
  } }
}

const SUCCESS_CLAIM = /\b(?:(?:tests?|checks?|build|validation|verification|deployment|migration)\s+(?:all\s+)?(?:passed|succeeded|successful|completed successfully)|(?:verified|confirmed)\s+(?:success|working)|successfully\s+(?:deployed|built|tested|verified))\b|(?:测试|验证|构建|部署)(?:全部|均|已)?(?:通过|成功)/iu
const UNSAFE_INSTRUCTION = /\b(?:ignore|override|bypass|disregard)\s+(?:(?:all|previous|prior|the|system|safety|user)\s+)*(?:instructions?|rules?|permissions?|approvals?|polic(?:y|ies))\b|\b(?:grant|assume|increase)\s+(?:all\s+)?(?:permissions?|authority|access)\b|(?:忽略|绕过|覆盖)(?:之前|先前|所有|系统|安全|用户)*(?:指令|规则|权限|审批)/iu

export function candidateSafetyFailure(candidate: MemoryCandidate, context: readonly MemorySourceEvidence[] = candidate.sources): 'unsupported-success' | 'unsafe-instruction' | undefined {
  // Untrusted retrieved instructions cannot become durable permission changes.
  if (UNSAFE_INSTRUCTION.test([candidate.content, candidate.consolidation?.reason ?? ''].join(' '))) return 'unsafe-instruction'
  if (SUCCESS_CLAIM.test(candidate.content) && (memoryEvidenceStatus(candidate.sources) !== 'observed-success' ||
    context.some((source) => source.trust === 'observed' && ['failed', 'aborted'].includes(source.outcome ?? '')))) {
    return 'unsupported-success'
  }
  return undefined
}
