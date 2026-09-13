import type { MemoryRecord } from '../contracts/memory.js'
import type {
  SemanticMemoryCandidate,
  SemanticMemoryCandidateMetadata,
  SemanticMemoryEvaluationQueryInput
} from './semantic-memory-evaluation.js'
import { applyMemoryContextBudget } from './memory-retrieval-trace.js'
import { reciprocalRankFusion } from './semantic-memory-vector-candidate.js'

export type SemanticMemoryV3ScoreRequest = {
  query: SemanticMemoryEvaluationQueryInput
  records: readonly MemoryRecord[]
  nowIso: string
}

export type SemanticMemoryV3ScoredRecord = {
  record: MemoryRecord
  score: number
}

export type SemanticMemoryV3ScoreRecords = (
  request: SemanticMemoryV3ScoreRequest
) => readonly SemanticMemoryV3ScoredRecord[] | Promise<readonly SemanticMemoryV3ScoredRecord[]>

export function createSemanticMemoryV3SemanticGatedCandidate(input: {
  metadata: Omit<SemanticMemoryCandidateMetadata, 'kind'>
  lexicalCandidate: SemanticMemoryCandidate
  scoreRecords: SemanticMemoryV3ScoreRecords
  minimumSimilarity: number
  semanticWeight: number
  lexicalWeight: number
  rankConstant: number
}): SemanticMemoryCandidate {
  if (!Number.isFinite(input.minimumSimilarity) || input.minimumSimilarity < -1 || input.minimumSimilarity > 1) {
    throw new Error('minimumSimilarity must be between -1 and 1')
  }
  reciprocalRankFusion({
    rankings: [
      { ids: [], weight: input.semanticWeight },
      { ids: [], weight: input.lexicalWeight }
    ],
    rankConstant: input.rankConstant
  })

  return {
    metadata: {
      ...input.metadata,
      kind: 'hybrid',
      parameters: {
        ...input.metadata.parameters,
        fusionMode: 'semantic-gated-rrf',
        minimumSimilarity: input.minimumSimilarity,
        semanticWeight: input.semanticWeight,
        lexicalWeight: input.lexicalWeight,
        rankConstant: input.rankConstant,
        lexicalCandidateId: input.lexicalCandidate.metadata.id
      }
    },
    retrieve: async (request) => {
      const scored = validateAndSortScores(await input.scoreRecords({
        query: request.query,
        records: request.records,
        nowIso: request.nowIso
      }), request.records)
      const semantic = scored.filter(({ score }) => score >= input.minimumSimilarity)
      const lexical = await input.lexicalCandidate.retrieve({
        ...request,
        limit: request.records.length
      })
      const semanticIds = new Set(semantic.map(({ record }) => record.id))
      const ids = reciprocalRankFusion({
        rankings: [
          { ids: semantic.map(({ record }) => record.id), weight: input.semanticWeight },
          { ids: lexical.map((record) => record.id).filter((id) => semanticIds.has(id)), weight: input.lexicalWeight }
        ],
        rankConstant: input.rankConstant
      })
      const byId = new Map(request.records.map((record) => [record.id, record]))
      return applyBudget(
        ids.map((id, index) => ({ record: byId.get(id)!, score: 1 / (index + 1) })),
        request.limit,
        request.promptCharacterBudget,
        request.nowIso
      )
    }
  }
}

export function createSemanticMemoryV3LexicalVetoCandidate(input: {
  metadata: Omit<SemanticMemoryCandidateMetadata, 'kind'>
  lexicalCandidate: SemanticMemoryCandidate
  scoreRecords: SemanticMemoryV3ScoreRecords
  marginGap?: number
}): SemanticMemoryCandidate {
  const marginGap = input.marginGap ?? 0
  if (!Number.isFinite(marginGap) || marginGap < 0) {
    throw new Error('marginGap must be a finite non-negative number')
  }

  return {
    metadata: {
      ...input.metadata,
      kind: 'hybrid',
      parameters: {
        ...input.metadata.parameters,
        fusionMode: marginGap > 0 ? 'lexical-veto-margin' : 'lexical-veto',
        marginGap
      }
    },
    retrieve: async (request) => {
      const lexical = await input.lexicalCandidate.retrieve({
        ...request,
        limit: request.records.length
      })
      if (lexical.length === 0) return []
      const lexicalIds = new Set(lexical.map((record) => record.id))
      const scored = validateAndSortScores(await input.scoreRecords({
        query: request.query,
        records: request.records,
        nowIso: request.nowIso
      }), request.records)
      const admitted = scored.filter(({ record }) => lexicalIds.has(record.id))
      if (!passesMarginGate(admitted, marginGap)) return []
      return applyBudget(admitted, request.limit, request.promptCharacterBudget, request.nowIso)
    }
  }
}

export function passesMarginGate(
  scored: readonly SemanticMemoryV3ScoredRecord[],
  marginGap: number
): boolean {
  if (!Number.isFinite(marginGap) || marginGap < 0) {
    throw new Error('marginGap must be a finite non-negative number')
  }
  if (scored.length < 2 || marginGap === 0) return scored.length > 0
  return scored[0]!.score - scored[1]!.score >= marginGap
}

function validateAndSortScores(
  scored: readonly SemanticMemoryV3ScoredRecord[],
  records: readonly MemoryRecord[]
): SemanticMemoryV3ScoredRecord[] {
  const allowedIds = new Set(records.map((record) => record.id))
  const seen = new Set<string>()
  for (const candidate of scored) {
    if (!allowedIds.has(candidate.record.id)) throw new Error(`scored candidate is outside the authorized input: ${candidate.record.id}`)
    if (seen.has(candidate.record.id)) throw new Error(`scored candidate contains duplicate id: ${candidate.record.id}`)
    if (!Number.isFinite(candidate.score)) throw new Error(`scored candidate has a non-finite score: ${candidate.record.id}`)
    seen.add(candidate.record.id)
  }
  return [...scored].sort((left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id))
}

function applyBudget(
  scored: readonly SemanticMemoryV3ScoredRecord[],
  limit: number,
  promptCharacterBudget: number,
  nowIso: string
): MemoryRecord[] {
  const ranked = scored.map(({ record, score }) => ({
    record,
    channel: 'filesystem' as const,
    features: {
      lexical: clamp01(score),
      scopeAffinity: 0,
      typeAffinity: 0,
      freshness: 0,
      importance: record.importance,
      confidence: record.confidence,
      finalScore: clamp01(score)
    }
  }))
  return applyMemoryContextBudget(ranked, limit, promptCharacterBudget, Date.parse(nowIso)).records
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
