import {
  MEMORY_MAX_TRACE_RANKINGS,
  MemoryRetrievalTrace,
  type MemoryRecord,
  type MemoryRetrievalMode,
  type MemoryRetrievalTrace as MemoryRetrievalTraceValue
} from '../contracts/memory.js'
import { MEMORY_RANKING_WEIGHTS, type RankedMemory } from './memory-ranking.js'
import { formatMemoryReferenceBlock } from './memory-context-format.js'

export const DEFAULT_MEMORY_PROMPT_CHARACTER_BUDGET = 6_000
const MIN_TRUNCATED_MEMORY_CONTENT_CHARS = 96

export type MemoryContextBudgetResult = {
  records: MemoryRecord[]
  selectedCharacters: number
  excludedIds: string[]
  truncatedIds: string[]
}

export function applyMemoryContextBudget(
  ranked: readonly RankedMemory[],
  limit: number,
  characterBudget = DEFAULT_MEMORY_PROMPT_CHARACTER_BUDGET,
  nowMs = Date.now()
): MemoryContextBudgetResult {
  const recordLimit = Math.max(0, Math.floor(limit))
  const budget = Math.max(0, Math.floor(characterBudget))
  const records: MemoryRecord[] = []
  const excludedIds: string[] = []
  const truncatedIds: string[] = []
  const seenContent = new Set<string>()
  let selectedCharacters = 0

  for (const candidate of ranked) {
    if (records.length >= recordLimit) break
    const duplicateKey = candidate.record.content.normalize('NFKC').trim().toLocaleLowerCase('en-US')
    if (seenContent.has(duplicateKey)) {
      excludedIds.push(candidate.record.id)
      continue
    }
    const fullCharacters = formatMemoryReferenceBlock([...records, candidate.record], nowMs).length
    let selectedRecord = candidate.record
    if (fullCharacters > budget) {
      const content = largestContentWithinBudget(records, candidate.record, budget, nowMs)
      if (content.length < MIN_TRUNCATED_MEMORY_CONTENT_CHARS) {
        excludedIds.push(candidate.record.id)
        continue
      }
      selectedRecord = { ...candidate.record, content }
      truncatedIds.push(candidate.record.id)
    }
    records.push(selectedRecord)
    seenContent.add(duplicateKey)
    selectedCharacters = formatMemoryReferenceBlock(records, nowMs).length
  }
  return {
    records,
    selectedCharacters,
    excludedIds: excludedIds.slice(0, MEMORY_MAX_TRACE_RANKINGS),
    truncatedIds: truncatedIds.slice(0, MEMORY_MAX_TRACE_RANKINGS)
  }
}

export function createMemoryRetrievalTrace(input: {
  timestamp: string
  mode: MemoryRetrievalMode
  queryTokenCount: number
  queryTokensTruncated: boolean
  candidateCount: number
  filtered: { scope: number; lifecycle: number; irrelevant: number }
  ranked: readonly RankedMemory[]
  selected: MemoryContextBudgetResult
  recordLimit: number
  promptCharacterBudget: number
}): MemoryRetrievalTraceValue {
  const selectedIds = input.selected.records.map((record) => record.id)
  const selectedSet = new Set(selectedIds)
  return MemoryRetrievalTrace.parse({
    timestamp: input.timestamp,
    mode: input.mode,
    queryTokenCount: input.queryTokenCount,
    queryTokensTruncated: input.queryTokensTruncated,
    candidateCount: input.candidateCount,
    filtered: input.filtered,
    rankings: input.ranked.slice(0, MEMORY_MAX_TRACE_RANKINGS).map((candidate) => ({
      memoryId: candidate.record.id,
      channel: candidate.channel,
      features: candidate.features,
      selected: selectedSet.has(candidate.record.id)
    })),
    selectedIds,
    excludedByPromptBudget: input.selected.excludedIds,
    truncatedIds: input.selected.truncatedIds,
    selectedCharacters: input.selected.selectedCharacters,
    recordLimit: input.recordLimit,
    promptCharacterBudget: input.promptCharacterBudget,
    rankingWeights: MEMORY_RANKING_WEIGHTS
  })
}

function largestContentWithinBudget(
  selected: readonly MemoryRecord[],
  candidate: MemoryRecord,
  budget: number,
  nowMs: number
): string {
  let low = 0
  let high = candidate.content.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const content = candidate.content.slice(0, middle).trimEnd()
    const length = formatMemoryReferenceBlock([...selected, { ...candidate, content }], nowMs).length
    if (length <= budget) low = middle
    else high = middle - 1
  }
  return candidate.content.slice(0, low).trimEnd()
}
