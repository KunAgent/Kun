import type { MemoryFeedbackEvent } from '../contracts/memory-feedback.js'
import type { MemoryRecord } from '../contracts/memory.js'
import { applyMemoryContextBudget } from './memory-retrieval-trace.js'
import {
  MEMORY_FEEDBACK_TIEBREAKER_CALIBRATION_PROCEDURE,
  compareMemoryFeedbackTiebreakerItems,
  type MemoryFeedbackTiebreakerItem
} from './memory-feedback-tiebreaker-calibration.js'
import type {
  MemoryFeedbackTiebreakerFixture,
  MemoryFeedbackTiebreakerSignalRuleValue
} from './memory-feedback-tiebreaker-contracts.js'
import { rankMemoryFeedbackTiebreakerFoundationCase } from './memory-feedback-tiebreaker-foundation.js'

type FixtureCase = MemoryFeedbackTiebreakerFixture['cases'][number]

export type MemoryFeedbackTiebreakerRanking = MemoryFeedbackTiebreakerItem & {
  selected: boolean
}

export type MemoryFeedbackTiebreakerCaseResult = {
  caseId: string
  signalRule: MemoryFeedbackTiebreakerSignalRuleValue
  maximumGap: number
  rankings: MemoryFeedbackTiebreakerRanking[]
  selectedIds: string[]
  forbiddenSelectedIds: string[]
  selectedCharacters: number
}

export function evaluateMemoryFeedbackTiebreakerCase(input: {
  fixture: MemoryFeedbackTiebreakerFixture
  item: FixtureCase
  signalRule: MemoryFeedbackTiebreakerSignalRuleValue
  maximumGap: number
}): MemoryFeedbackTiebreakerCaseResult {
  const foundation = rankMemoryFeedbackTiebreakerFoundationCase(input.fixture, input.item)
  const records = new Map(input.fixture.records.map((record) => [record.id, record]))
  const signals = buildSignals(input.fixture.events)
  const items = foundation.rankings.map((ranking) => ({
    memoryId: ranking.memoryId,
    foundationScore: ranking.foundationScore,
    ...signals.get(ranking.memoryId) ?? emptySignals()
  }))
  const ordered = input.signalRule === 'foundation-only'
    ? items
    : groupMemoryFeedbackTiebreakerNearTies(
      items,
      input.maximumGap,
      MEMORY_FEEDBACK_TIEBREAKER_CALIBRATION_PROCEDURE.maximumReorderWindow
    ).flatMap((group) => [...group].sort((left, right) =>
      compareMemoryFeedbackTiebreakerItems(left, right, input.signalRule)))
  const ranked = ordered.map((item) => toRankedMemory(item, foundation.trace, records))
  const selected = applyMemoryContextBudget(
    ranked,
    input.item.limit,
    input.item.promptCharacterBudget,
    Date.parse(input.fixture.evaluationNow)
  )
  const selectedIds = selected.records.map((record) => record.id)
  const selectedSet = new Set(selectedIds)

  return {
    caseId: input.item.id,
    signalRule: input.signalRule,
    maximumGap: input.maximumGap,
    rankings: ordered.map((item) => ({ ...item, selected: selectedSet.has(item.memoryId) })),
    selectedIds,
    forbiddenSelectedIds: selectedIds.filter((id) => input.item.forbiddenIds.includes(id)),
    selectedCharacters: selected.selectedCharacters
  }
}

export function groupMemoryFeedbackTiebreakerNearTies<T extends {
  foundationScore: number
}>(rankings: readonly T[], maximumGap: number, maximumWindow: number): T[][] {
  const groups: T[][] = []
  let index = 0
  while (index < rankings.length) {
    const leader = rankings[index]!
    const group = [leader]
    index += 1
    while (index < rankings.length && group.length < maximumWindow) {
      const candidate = rankings[index]!
      if (round(leader.foundationScore - candidate.foundationScore) > maximumGap) break
      group.push(candidate)
      index += 1
    }
    groups.push(group)
  }
  return groups
}

function buildSignals(events: readonly MemoryFeedbackEvent[]): Map<string, Omit<
  MemoryFeedbackTiebreakerItem,
  'memoryId' | 'foundationScore'
>> {
  const signals = new Map<string, ReturnType<typeof emptySignals>>()
  const get = (id: string): ReturnType<typeof emptySignals> => {
    const existing = signals.get(id)
    if (existing) return existing
    const created = emptySignals()
    signals.set(id, created)
    return created
  }
  for (const event of events) {
    if (event.kind === 'retrieved') {
      const signal = get(event.memoryId)
      signal.retrievalCount += 1
      if (!signal.lastRetrievedAt || signal.lastRetrievedAt < event.occurredAt) {
        signal.lastRetrievedAt = event.occurredAt
      }
    }
    if (event.kind === 'confirmed') get(event.memoryId).confirmationCount += 1
    if (event.kind === 'corrected') get(event.replacementMemoryId).correctionCount += 1
  }
  return signals
}

function emptySignals(): {
  confirmationCount: number
  correctionCount: number
  retrievalCount: number
  lastRetrievedAt?: string
} {
  return { confirmationCount: 0, correctionCount: 0, retrievalCount: 0 }
}

function toRankedMemory(
  item: MemoryFeedbackTiebreakerItem,
  trace: ReturnType<typeof rankMemoryFeedbackTiebreakerFoundationCase>['trace'],
  records: ReadonlyMap<string, MemoryRecord>
) {
  const ranking = trace.rankings.find((candidate) => candidate.memoryId === item.memoryId)
  const record = records.get(item.memoryId)
  if (!ranking || !record) throw new Error(`missing admitted tiebreaker memory: ${item.memoryId}`)
  return { record, channel: ranking.channel, features: ranking.features }
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
