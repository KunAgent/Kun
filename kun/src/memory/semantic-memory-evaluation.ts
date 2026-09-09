import { performance } from 'node:perf_hooks'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import type { MemoryRecord } from '../contracts/memory.js'
import { memoryInScope, memoryLifecycleState } from './memory-ranking.js'
import { retrieveMemoryRecords } from './memory-retrieval.js'
import type {
  SemanticMemoryEvaluationDataset,
  SemanticMemoryEvaluationQuery
} from './semantic-memory-evaluation-dataset.js'

export type SemanticMemoryCandidateKind = 'lexical' | 'semantic' | 'hybrid'
export type SemanticMemoryCandidateMetadata = {
  id: string
  kind: SemanticMemoryCandidateKind
  version: string
  runtime: string
  license: string
  artifactSha256?: string
  dimensions?: number
  normalization?: string
  parameters: Readonly<Record<string, string | number | boolean>>
  platforms: readonly string[]
}
export type SemanticMemoryCandidate = {
  metadata: SemanticMemoryCandidateMetadata
  retrieve: (input: {
    query: SemanticMemoryEvaluationQuery
    records: readonly MemoryRecord[]
    limit: number
    promptCharacterBudget: number
    nowIso: string
  }) => Promise<readonly MemoryRecord[]>
}

export type SemanticMemoryQueryResult = {
  queryId: string
  split: SemanticMemoryEvaluationQuery['split']
  queryLanguage: SemanticMemoryEvaluationQuery['queryLanguage']
  category: SemanticMemoryEvaluationQuery['category']
  expectedCount: number
  selectedIds: string[]
  recallAtK?: number
  precisionAtK?: number
  reciprocalRank?: number
  abstentionCorrect?: boolean
  falsePositiveSelections: number
  explicitForbiddenSelections: number
  scopeLeaks: number
  lifecycleLeaks: number
  authorityViolations: number
  unknownSelections: number
  selectedCharacters: number
  eligibleRecordCount: number
  latencyMs: number
}

export type SemanticMemoryMetricSummary = {
  queryCount: number
  rankedQueryCount: number
  emptyExpectedQueryCount: number
  recallAtK: number
  precisionAtK: number
  meanReciprocalRank: number
  abstentionAccuracy: number
  falsePositiveSelections: number
  explicitForbiddenSelections: number
  scopeLeaks: number
  lifecycleLeaks: number
  authorityViolations: number
  unknownSelections: number
  selectedCharacters: number
  latencyP50Ms: number
  latencyP95Ms: number
}

export type SemanticMemoryEvaluationReport = {
  dataset: {
    id: string
    recordsSha256: string
    queriesSha256: string
    scoringVersion: number
    evaluationNow: string
    limit: number
    promptCharacterBudget: number
  }
  candidate: SemanticMemoryCandidateMetadata
  results: SemanticMemoryQueryResult[]
  metrics: SemanticMemoryMetricSummary
  breakdowns: {
    split: Record<string, SemanticMemoryMetricSummary>
    language: Record<string, SemanticMemoryMetricSummary>
    category: Record<string, SemanticMemoryMetricSummary>
  }
  safetyGatePassed: boolean
  networkAttempts: number
  fallbackMismatches: number
}

export type DeterministicSemanticMemoryEvaluationReport = {
  schemaVersion: 1
  reportKind: 'lexical-baseline'
  timing: {
    excludedFromSnapshot: true
    reason: string
  }
  dataset: SemanticMemoryEvaluationReport['dataset']
  candidate: SemanticMemoryCandidateMetadata
  results: Array<Omit<SemanticMemoryQueryResult, 'latencyMs'>>
  metrics: Omit<SemanticMemoryMetricSummary, 'latencyP50Ms' | 'latencyP95Ms'>
  breakdowns: {
    split: Record<string, Omit<SemanticMemoryMetricSummary, 'latencyP50Ms' | 'latencyP95Ms'>>
    language: Record<string, Omit<SemanticMemoryMetricSummary, 'latencyP50Ms' | 'latencyP95Ms'>>
    category: Record<string, Omit<SemanticMemoryMetricSummary, 'latencyP50Ms' | 'latencyP95Ms'>>
  }
  safetyGatePassed: boolean
  networkAttempts: number
  fallbackMismatches: number
}

export async function runSemanticMemoryEvaluation(input: {
  dataset: SemanticMemoryEvaluationDataset
  candidate: SemanticMemoryCandidate
  split?: 'development' | 'holdout' | 'all'
  networkAttempts?: number
  fallbackMismatches?: number
}): Promise<SemanticMemoryEvaluationReport> {
  const split = input.split ?? 'development'
  const queries = split === 'all'
    ? input.dataset.queries
    : input.dataset.queries.filter((query) => query.split === split)
  const nowMs = Date.parse(input.dataset.manifest.evaluationNow)
  const results: SemanticMemoryQueryResult[] = []

  for (const query of queries) {
    const filtered = filterCandidateRecords(input.dataset.records, query, nowMs)
    const started = performance.now()
    const selected = await input.candidate.retrieve({
      query,
      records: filtered.eligible,
      limit: input.dataset.manifest.defaultK,
      promptCharacterBudget: input.dataset.manifest.promptCharacterBudget,
      nowIso: input.dataset.manifest.evaluationNow
    })
    const latencyMs = performance.now() - started
    if (selected.length > input.dataset.manifest.defaultK) {
      throw new Error(`candidate ${input.candidate.metadata.id} returned more than K for ${query.id}`)
    }
    const selectedIds = selected.map((record) => record.id)
    if (new Set(selectedIds).size !== selectedIds.length) {
      throw new Error(`candidate ${input.candidate.metadata.id} returned duplicate ids for ${query.id}`)
    }
    results.push(scoreQuery({
      query,
      selected,
      eligibleCount: filtered.eligible.length,
      scopeExcluded: filtered.scopeExcluded,
      lifecycleExcluded: filtered.lifecycleExcluded,
      sourceRecords: input.dataset.records,
      latencyMs
    }))
  }

  const networkAttempts = input.networkAttempts ?? 0
  const fallbackMismatches = input.fallbackMismatches ?? 0
  const metrics = summarizeSemanticMemoryResults(results)
  return {
    dataset: {
      id: input.dataset.manifest.datasetId,
      recordsSha256: input.dataset.manifest.hashes.recordsSha256,
      queriesSha256: input.dataset.manifest.hashes.queriesSha256,
      scoringVersion: input.dataset.manifest.scoringVersion,
      evaluationNow: input.dataset.manifest.evaluationNow,
      limit: input.dataset.manifest.defaultK,
      promptCharacterBudget: input.dataset.manifest.promptCharacterBudget
    },
    candidate: input.candidate.metadata,
    results,
    metrics,
    breakdowns: {
      split: summarizeBy(results, (result) => result.split),
      language: summarizeBy(results, (result) => result.queryLanguage),
      category: summarizeBy(results, (result) => result.category)
    },
    safetyGatePassed: safetyFailures(metrics, networkAttempts, fallbackMismatches) === 0,
    networkAttempts,
    fallbackMismatches
  }
}

export function createLexicalSemanticMemoryCandidate(): SemanticMemoryCandidate {
  return {
    metadata: {
      id: 'kun-memory-lexical-foundation',
      kind: 'lexical',
      version: 'p0-v1',
      runtime: 'kun-memory-retrieval',
      license: 'repository',
      parameters: { mode: 'filesystem-fallback' },
      platforms: ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64']
    },
    retrieve: async ({ query, records, limit, promptCharacterBudget, nowIso }) => retrieveMemoryRecords({
      records,
      request: { query: query.query, workspace: query.workspace, project: query.project, limit, promptCharacterBudget },
      policy: { ...DEFAULT_KUN_CAPABILITIES_CONFIG.memory, enabled: true },
      mode: 'filesystem-fallback',
      nowIso
    }).records
  }
}

export function summarizeSemanticMemoryResults(
  results: readonly SemanticMemoryQueryResult[]
): SemanticMemoryMetricSummary {
  const ranked = results.filter((result) => result.expectedCount > 0)
  const empty = results.filter((result) => result.expectedCount === 0)
  return {
    queryCount: results.length,
    rankedQueryCount: ranked.length,
    emptyExpectedQueryCount: empty.length,
    recallAtK: average(ranked.map((result) => result.recallAtK ?? 0)),
    precisionAtK: average(ranked.map((result) => result.precisionAtK ?? 0)),
    meanReciprocalRank: average(ranked.map((result) => result.reciprocalRank ?? 0)),
    abstentionAccuracy: average(empty.map((result) => result.abstentionCorrect ? 1 : 0)),
    falsePositiveSelections: sum(results.map((result) => result.falsePositiveSelections)),
    explicitForbiddenSelections: sum(results.map((result) => result.explicitForbiddenSelections)),
    scopeLeaks: sum(results.map((result) => result.scopeLeaks)),
    lifecycleLeaks: sum(results.map((result) => result.lifecycleLeaks)),
    authorityViolations: sum(results.map((result) => result.authorityViolations)),
    unknownSelections: sum(results.map((result) => result.unknownSelections)),
    selectedCharacters: sum(results.map((result) => result.selectedCharacters)),
    latencyP50Ms: percentile(results.map((result) => result.latencyMs), 0.5),
    latencyP95Ms: percentile(results.map((result) => result.latencyMs), 0.95)
  }
}

export function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1)
  return round(sorted[Math.min(index, sorted.length - 1)] ?? 0)
}

export function createDeterministicLexicalBaseline(
  report: SemanticMemoryEvaluationReport
): DeterministicSemanticMemoryEvaluationReport {
  if (report.candidate.kind !== 'lexical') {
    throw new Error('only a lexical candidate can produce the lexical baseline')
  }
  return {
    schemaVersion: 1,
    reportKind: 'lexical-baseline',
    timing: {
      excludedFromSnapshot: true,
      reason: 'Wall-clock samples are machine-dependent and are recorded in separate resource evidence.'
    },
    dataset: report.dataset,
    candidate: report.candidate,
    results: report.results.map(({ latencyMs: _latencyMs, ...result }) => result),
    metrics: withoutLatency(report.metrics),
    breakdowns: {
      split: mapWithoutLatency(report.breakdowns.split),
      language: mapWithoutLatency(report.breakdowns.language),
      category: mapWithoutLatency(report.breakdowns.category)
    },
    safetyGatePassed: report.safetyGatePassed,
    networkAttempts: report.networkAttempts,
    fallbackMismatches: report.fallbackMismatches
  }
}

function filterCandidateRecords(records: readonly MemoryRecord[], query: SemanticMemoryEvaluationQuery, nowMs: number) {
  const scoped = records.filter((record) => memoryInScope(record, query))
  const lifecycleEligible = scoped.filter((record) => memoryLifecycleState(record, nowMs) === 'active')
  const supersededIds = new Set(lifecycleEligible.flatMap((record) => record.supersedes ? [record.supersedes] : []))
  const eligible = lifecycleEligible.filter((record) => !supersededIds.has(record.id))
  return {
    eligible,
    scopeExcluded: new Set(records.filter((record) => !memoryInScope(record, query)).map((record) => record.id)),
    lifecycleExcluded: new Set(scoped.filter((record) => !eligible.includes(record)).map((record) => record.id))
  }
}

function scoreQuery(input: {
  query: SemanticMemoryEvaluationQuery
  selected: readonly MemoryRecord[]
  eligibleCount: number
  scopeExcluded: ReadonlySet<string>
  lifecycleExcluded: ReadonlySet<string>
  sourceRecords: readonly MemoryRecord[]
  latencyMs: number
}): SemanticMemoryQueryResult {
  const selectedIds = input.selected.map((record) => record.id)
  const expected = new Set(input.query.expectedIds)
  const relevantSelected = new Set(selectedIds.filter((id) => expected.has(id))).size
  const firstRelevant = selectedIds.findIndex((id) => expected.has(id))
  const sourceById = new Map(input.sourceRecords.map((record) => [record.id, record]))
  const ranked = expected.size > 0
  return {
    queryId: input.query.id,
    split: input.query.split,
    queryLanguage: input.query.queryLanguage,
    category: input.query.category,
    expectedCount: expected.size,
    selectedIds,
    ...(ranked ? {
      recallAtK: round(relevantSelected / expected.size),
      precisionAtK: round(selectedIds.length === 0 ? 0 : relevantSelected / selectedIds.length),
      reciprocalRank: round(firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1))
    } : { abstentionCorrect: selectedIds.length === 0 }),
    falsePositiveSelections: ranked ? 0 : selectedIds.length,
    explicitForbiddenSelections: selectedIds.filter((id) => input.query.forbiddenIds.includes(id)).length,
    scopeLeaks: selectedIds.filter((id) => input.scopeExcluded.has(id)).length,
    lifecycleLeaks: selectedIds.filter((id) => input.lifecycleExcluded.has(id)).length,
    authorityViolations: input.selected.filter((record) => {
      const source = sourceById.get(record.id)
      return source !== undefined && source.authority !== record.authority
    }).length,
    unknownSelections: selectedIds.filter((id) => !sourceById.has(id)).length,
    selectedCharacters: sum(input.selected.map((record) => record.content.length)),
    eligibleRecordCount: input.eligibleCount,
    latencyMs: round(input.latencyMs)
  }
}

function summarizeBy(
  results: readonly SemanticMemoryQueryResult[],
  keyFor: (result: SemanticMemoryQueryResult) => string
): Record<string, SemanticMemoryMetricSummary> {
  const keys = [...new Set(results.map(keyFor))].sort()
  return Object.fromEntries(keys.map((key) => [key, summarizeSemanticMemoryResults(
    results.filter((result) => keyFor(result) === key)
  )]))
}

function mapWithoutLatency(
  input: Record<string, SemanticMemoryMetricSummary>
): Record<string, Omit<SemanticMemoryMetricSummary, 'latencyP50Ms' | 'latencyP95Ms'>> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, withoutLatency(value)]))
}

function withoutLatency(
  input: SemanticMemoryMetricSummary
): Omit<SemanticMemoryMetricSummary, 'latencyP50Ms' | 'latencyP95Ms'> {
  const { latencyP50Ms: _latencyP50Ms, latencyP95Ms: _latencyP95Ms, ...metrics } = input
  return metrics
}

function safetyFailures(metrics: SemanticMemoryMetricSummary, networkAttempts: number, fallbackMismatches: number): number {
  return metrics.scopeLeaks + metrics.lifecycleLeaks + metrics.authorityViolations +
    metrics.unknownSelections + networkAttempts + fallbackMismatches
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : round(sum(values) / values.length)
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
