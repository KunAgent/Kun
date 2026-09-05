import type { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import {
  MEMORY_MAX_TRACE_RANKINGS,
  type MemoryRecord,
  type MemoryRetrievalMode,
  type MemoryRetrievalTrace
} from '../contracts/memory.js'
import {
  compareRankedMemories,
  hasPositiveMemoryRelevance,
  memoryInScope,
  memoryLifecycleState,
  rankMemory,
  type RankedMemory
} from './memory-ranking.js'
import {
  MEMORY_MAX_QUERY_SEARCH_TOKENS,
  memorySearchTokens,
  type MemorySearchTokenResult
} from './memory-search-tokens.js'
import {
  applyMemoryContextBudget,
  createMemoryRetrievalTrace,
  DEFAULT_MEMORY_PROMPT_CHARACTER_BUDGET
} from './memory-retrieval-trace.js'

export const DEFAULT_MEMORY_RETRIEVAL_CANDIDATE_LIMIT = 64

export type MemoryRetrieveRequest = {
  query: string
  workspace?: string
  project?: string
  limit: number
  promptCharacterBudget?: number
  policy?: MemoryCapabilityConfig
}

export type MemoryRetrievalResult = {
  records: MemoryRecord[]
  trace: MemoryRetrievalTrace
}

export function retrieveMemoryRecords(input: {
  records: readonly MemoryRecord[]
  request: MemoryRetrieveRequest
  policy: MemoryCapabilityConfig
  mode: MemoryRetrievalMode
  nowIso: string
  minConfidence?: number
  queryTokens?: MemorySearchTokenResult
  lexicalScores?: ReadonlyMap<string, number>
  channels?: ReadonlyMap<string, RankedMemory['channel']>
  preFiltered?: { scope: number; lifecycle: number }
}): MemoryRetrievalResult {
  const queryTokens = input.queryTokens ?? memorySearchTokens(
    input.request.query,
    MEMORY_MAX_QUERY_SEARCH_TOKENS
  )
  const nowMs = Date.parse(input.nowIso)
  const allowedScopes = input.policy.scopes
  const scoped = input.records.filter((record) => memoryInScope(record, input.request, allowedScopes))
  const lifecycleEligible = scoped.filter((record) =>
    memoryLifecycleState(record, nowMs) === 'active' && record.confidence >= (input.minConfidence ?? 0)
  )
  const supersededIds = new Set(lifecycleEligible.flatMap((record) => record.supersedes ? [record.supersedes] : []))
  const lifecycleActive = lifecycleEligible.filter((record) => !supersededIds.has(record.id))
  const ranked = lifecycleActive
    .map((record) => rankMemory({
      record,
      query: input.request.query,
      queryTokens: queryTokens.tokens,
      nowMs,
      lexicalOverride: input.lexicalScores?.get(record.id),
      channel: input.channels?.get(record.id) ?? (input.mode === 'sqlite-fts5' ? 'fts5' : 'filesystem')
    }))
  const relevant = ranked.filter(hasPositiveMemoryRelevance).sort(compareRankedMemories)
  const requestedLimit = Math.max(0, Math.floor(input.request.limit))
  const recordLimit = input.policy.enabled
    ? Math.min(requestedLimit, input.policy.maxInjectedRecords, MEMORY_MAX_TRACE_RANKINGS)
    : 0
  const promptCharacterBudget = Math.max(
    0,
    Math.floor(input.request.promptCharacterBudget ?? DEFAULT_MEMORY_PROMPT_CHARACTER_BUDGET)
  )
  const selected = applyMemoryContextBudget(relevant, recordLimit, promptCharacterBudget, nowMs)
  const filtered = {
    scope: (input.preFiltered?.scope ?? 0) + input.records.length - scoped.length,
    lifecycle: (input.preFiltered?.lifecycle ?? 0) + scoped.length - lifecycleActive.length,
    irrelevant: ranked.length - relevant.length
  }
  return {
    records: selected.records,
    trace: createMemoryRetrievalTrace({
      timestamp: input.nowIso,
      mode: input.mode,
      queryTokenCount: queryTokens.tokens.length,
      queryTokensTruncated: queryTokens.truncated,
      candidateCount: lifecycleActive.length,
      filtered,
      ranked: relevant,
      selected,
      recordLimit,
      promptCharacterBudget
    })
  }
}
