import { resolve } from 'node:path'
import type {
  MemoryFreshnessClass,
  MemoryRankingFeatures,
  MemoryRecord,
  MemoryScope,
  MemoryType
} from '../contracts/memory.js'
import { lexicalTokenCoverage, memoryRecordSearchTokens } from './memory-search-tokens.js'

export const MEMORY_FRESHNESS_HALF_LIFE_MS = 180 * 24 * 60 * 60 * 1_000
export const MEMORY_RANKING_WEIGHTS = Object.freeze({
  lexical: 0.55,
  scopeAffinity: 0.1,
  typeAffinity: 0.1,
  freshness: 0.1,
  importance: 0.075,
  confidence: 0.075
})

export type MemoryLifecycleState =
  | 'active'
  | 'deleted'
  | 'disabled'
  | 'superseded'
  | 'not-yet-valid'
  | 'expired'

export type RankedMemory = {
  record: MemoryRecord
  channel: 'fts5' | 'type-affinity' | 'filesystem'
  features: MemoryRankingFeatures
}

export function memoryLifecycleState(record: MemoryRecord, nowMs: number): MemoryLifecycleState {
  if (record.deletedAt) return 'deleted'
  if (record.disabledAt) return 'disabled'
  if (record.supersededAt) return 'superseded'
  if (record.validFrom && Date.parse(record.validFrom) > nowMs) return 'not-yet-valid'
  if (record.validTo && Date.parse(record.validTo) <= nowMs) return 'expired'
  if (record.expiresAt && Date.parse(record.expiresAt) <= nowMs) return 'expired'
  return 'active'
}

export function memoryFreshness(
  record: MemoryRecord,
  nowMs: number,
  halfLifeMs = MEMORY_FRESHNESS_HALF_LIFE_MS
): number {
  if (halfLifeMs <= 0) return 1
  const observedMs = Date.parse(record.observedAt || record.updatedAt || record.createdAt)
  if (!Number.isFinite(observedMs)) return 1
  const ageMs = Math.max(0, nowMs - observedMs)
  return clamp01(Math.pow(0.5, ageMs / halfLifeMs))
}

export function memoryFreshnessClass(value: number): MemoryFreshnessClass {
  if (value >= 0.8) return 'fresh'
  if (value >= 0.5) return 'recent'
  if (value >= 0.25) return 'aging'
  return 'stale'
}

export function memoryInScope(
  record: MemoryRecord,
  access: { workspace?: string; project?: string },
  allowedScopes: readonly MemoryScope[] = ['user', 'workspace', 'project']
): boolean {
  if (!allowedScopes.includes(record.scope)) return false
  if (record.scope === 'user') return true
  const workspace = normalizeMemoryScopePath(access.workspace)
  if (!workspace) return false
  if (record.scope === 'workspace') {
    return normalizeMemoryScopePath(record.workspace) === workspace
  }
  const project = normalizeMemoryScopePath(access.project ?? access.workspace)
  const recordProject = normalizeMemoryScopePath(record.project ?? record.workspace)
  return Boolean(project && recordProject && project === recordProject)
}

export function normalizeMemoryScopePath(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  const normalized = resolve(trimmed)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function rankMemory(input: {
  record: MemoryRecord
  query: string
  queryTokens: readonly string[]
  nowMs: number
  lexicalOverride?: number
  channel?: RankedMemory['channel']
}): RankedMemory {
  const lexical = clamp01(input.lexicalOverride ?? lexicalTokenCoverage(
    input.queryTokens,
    memoryRecordSearchTokens(input.record).tokens
  ))
  const typeAffinity = memoryTypeAffinity(input.record, input.query)
  const freshness = memoryFreshness(input.record, input.nowMs)
  const scopeAffinity = scopeAffinityFor(input.record.scope)
  const features = {
    lexical,
    scopeAffinity,
    typeAffinity,
    freshness,
    importance: clamp01(input.record.importance),
    confidence: clamp01(input.record.confidence),
    finalScore: 0
  }
  features.finalScore = clamp01(
    features.lexical * MEMORY_RANKING_WEIGHTS.lexical +
    features.scopeAffinity * MEMORY_RANKING_WEIGHTS.scopeAffinity +
    features.typeAffinity * MEMORY_RANKING_WEIGHTS.typeAffinity +
    features.freshness * MEMORY_RANKING_WEIGHTS.freshness +
    features.importance * MEMORY_RANKING_WEIGHTS.importance +
    features.confidence * MEMORY_RANKING_WEIGHTS.confidence
  )
  return {
    record: input.record,
    channel: input.channel ?? (typeAffinity > lexical ? 'type-affinity' : 'filesystem'),
    features
  }
}

export function hasPositiveMemoryRelevance(candidate: RankedMemory): boolean {
  return candidate.features.lexical > 0 || candidate.features.typeAffinity > 0
}

export function compareRankedMemories(left: RankedMemory, right: RankedMemory): number {
  return right.features.finalScore - left.features.finalScore ||
    right.record.updatedAt.localeCompare(left.record.updatedAt) ||
    left.record.id.localeCompare(right.record.id)
}

export function memoryTypeHints(query: string): MemoryType[] {
  const normalized = query.normalize('NFKC').toLocaleLowerCase('en-US')
  const hints = new Set<MemoryType>()
  if (/\b(prefer|preference|favorite|favourite|like)\b/u.test(normalized) || /偏好|喜欢|习惯/u.test(normalized)) {
    hints.add('preference')
  }
  if (/\b(decide|decision|chosen|choice)\b/u.test(normalized) || /决定|选择|决策/u.test(normalized)) {
    hints.add('decision')
  }
  if (/\b(who am i|my name|identity|profile)\b/u.test(normalized) || /我是谁|我的名字|身份/u.test(normalized)) {
    hints.add('fact')
    hints.add('relationship')
  }
  return [...hints]
}

function memoryTypeAffinity(record: MemoryRecord, query: string): number {
  const hints = memoryTypeHints(query)
  if (hints.includes(record.type)) return 1
  const normalizedTags = record.tags.map((tag) => tag.toLocaleLowerCase('en-US'))
  if (hints.includes('fact') && normalizedTags.some((tag) => ['identity', 'profile', '身份'].includes(tag))) return 1
  if (hints.includes('preference') && normalizedTags.some((tag) => ['preference', 'preferences', '偏好'].includes(tag))) return 1
  return 0
}

function scopeAffinityFor(scope: MemoryScope): number {
  switch (scope) {
    case 'project': return 1
    case 'workspace': return 0.9
    case 'user': return 0.8
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}
