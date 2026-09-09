import type { MemoryRecord } from '../contracts/memory.js'
import type {
  SemanticMemoryCandidate,
  SemanticMemoryCandidateMetadata
} from './semantic-memory-evaluation.js'
import { applyMemoryContextBudget } from './memory-retrieval-trace.js'
import type { RankedMemory } from './memory-ranking.js'

export type SemanticMemoryEmbedding = readonly number[] | Float32Array

export type SemanticMemoryEmbeddingProvider = {
  embed: (texts: readonly string[]) => Promise<readonly SemanticMemoryEmbedding[]>
}

export type SemanticMemoryRankFusion = {
  lexicalCandidate: SemanticMemoryCandidate
  semanticWeight: number
  lexicalWeight: number
  rankConstant: number
}

export function createVectorSemanticMemoryCandidate(input: {
  metadata: Omit<SemanticMemoryCandidateMetadata, 'kind' | 'parameters'> & {
    parameters?: Readonly<Record<string, string | number | boolean>>
  }
  provider: SemanticMemoryEmbeddingProvider
  queryPrefix?: string
  documentPrefix?: string
  minimumSimilarity: number
  fusion?: SemanticMemoryRankFusion
}): SemanticMemoryCandidate {
  validateCandidateConfiguration(input)
  const documentCache = new Map<string, { text: string; vector: number[] }>()
  const queryPrefix = input.queryPrefix ?? ''
  const documentPrefix = input.documentPrefix ?? ''
  const fusion = input.fusion

  return {
    metadata: {
      ...input.metadata,
      kind: fusion ? 'hybrid' : 'semantic',
      parameters: {
        ...input.metadata.parameters,
        minimumSimilarity: input.minimumSimilarity,
        queryPrefix,
        documentPrefix,
        ...(fusion ? {
          fusionMode: 'semantic-gated-rrf',
          semanticWeight: fusion.semanticWeight,
          lexicalWeight: fusion.lexicalWeight,
          rankConstant: fusion.rankConstant,
          lexicalCandidateId: fusion.lexicalCandidate.metadata.id
        } : {})
      }
    },
    retrieve: async (request) => {
      const documentVectors = await embedRecords(
        input.provider,
        request.records,
        documentPrefix,
        documentCache
      )
      const [queryVector] = await embedChecked(input.provider, [`${queryPrefix}${request.query.query}`])
      if (!queryVector) throw new Error('embedding provider did not return the query vector')
      const semantic = request.records
        .map((record, index) => ({
          record,
          score: cosineSimilarity(queryVector, documentVectors[index]!)
        }))
        .filter((candidate) => candidate.score >= input.minimumSimilarity)
        .sort(compareSemanticCandidates)

      const rankedRecords = fusion
        ? await fuseWithLexical(semantic, request.records, fusion, request)
        : semantic
      return applyOrderedBudget(
        rankedRecords,
        request.limit,
        request.promptCharacterBudget,
        Date.parse(request.nowIso)
      )
    }
  }
}

export function reciprocalRankFusion(input: {
  rankings: readonly { ids: readonly string[]; weight: number }[]
  rankConstant: number
}): string[] {
  if (!Number.isInteger(input.rankConstant) || input.rankConstant < 1) {
    throw new Error('rankConstant must be a positive integer')
  }
  const scores = new Map<string, { score: number; bestRank: number }>()
  for (const ranking of input.rankings) {
    if (!Number.isFinite(ranking.weight) || ranking.weight <= 0) {
      throw new Error('ranking weights must be positive finite numbers')
    }
    const seen = new Set<string>()
    ranking.ids.forEach((id, index) => {
      if (seen.has(id)) throw new Error(`ranking contains duplicate id: ${id}`)
      seen.add(id)
      const rank = index + 1
      const previous = scores.get(id) ?? { score: 0, bestRank: rank }
      scores.set(id, {
        score: previous.score + ranking.weight / (input.rankConstant + rank),
        bestRank: Math.min(previous.bestRank, rank)
      })
    })
  }
  return [...scores]
    .sort(([leftId, left], [rightId, right]) =>
      right.score - left.score || left.bestRank - right.bestRank || leftId.localeCompare(rightId)
    )
    .map(([id]) => id)
}

async function embedRecords(
  provider: SemanticMemoryEmbeddingProvider,
  records: readonly MemoryRecord[],
  prefix: string,
  cache: Map<string, { text: string; vector: number[] }>
): Promise<number[][]> {
  const missing = records.filter((record) => cache.get(record.id)?.text !== `${prefix}${record.content}`)
  if (missing.length > 0) {
    const texts = missing.map((record) => `${prefix}${record.content}`)
    const vectors = await embedChecked(provider, texts)
    missing.forEach((record, index) => cache.set(record.id, { text: texts[index]!, vector: vectors[index]! }))
  }
  return records.map((record) => cache.get(record.id)?.vector ?? missingVector(record.id))
}

async function embedChecked(
  provider: SemanticMemoryEmbeddingProvider,
  texts: readonly string[]
): Promise<number[][]> {
  const embeddings = await provider.embed(texts)
  if (embeddings.length !== texts.length) {
    throw new Error(`embedding provider returned ${embeddings.length} vectors for ${texts.length} texts`)
  }
  const vectors = embeddings.map((embedding, index) => normalizeVector(embedding, index))
  const dimensions = vectors[0]?.length
  if (dimensions !== undefined && vectors.some((vector) => vector.length !== dimensions)) {
    throw new Error('embedding provider returned inconsistent dimensions')
  }
  return vectors
}

function normalizeVector(embedding: SemanticMemoryEmbedding, index: number): number[] {
  if (embedding.length === 0) throw new Error(`embedding ${index} is empty`)
  const vector = Array.from(embedding)
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`embedding ${index} contains a non-finite value`)
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) throw new Error(`embedding ${index} has zero magnitude`)
  return vector.map((value) => value / norm)
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) throw new Error('query and document embedding dimensions differ')
  return left.reduce((score, value, index) => score + value * right[index]!, 0)
}

async function fuseWithLexical(
  semantic: readonly { record: MemoryRecord; score: number }[],
  records: readonly MemoryRecord[],
  fusion: SemanticMemoryRankFusion,
  request: Parameters<SemanticMemoryCandidate['retrieve']>[0]
): Promise<Array<{ record: MemoryRecord; score: number }>> {
  const lexical = await fusion.lexicalCandidate.retrieve({ ...request, records })
  const semanticIds = new Set(semantic.map((candidate) => candidate.record.id))
  const ids = reciprocalRankFusion({
    rankings: [
      { ids: semantic.map((candidate) => candidate.record.id), weight: fusion.semanticWeight },
      {
        ids: lexical.map((record) => record.id).filter((id) => semanticIds.has(id)),
        weight: fusion.lexicalWeight
      }
    ],
    rankConstant: fusion.rankConstant
  })
  const byId = new Map(records.map((record) => [record.id, record]))
  return ids.map((id, index) => ({ record: byId.get(id)!, score: 1 / (index + 1) }))
}

function applyOrderedBudget(
  candidates: readonly { record: MemoryRecord; score: number }[],
  limit: number,
  promptCharacterBudget: number,
  nowMs: number
): MemoryRecord[] {
  const ranked: RankedMemory[] = candidates.map(({ record, score }) => ({
    record,
    channel: 'filesystem',
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
  return applyMemoryContextBudget(ranked, limit, promptCharacterBudget, nowMs).records
}

function compareSemanticCandidates(
  left: { record: MemoryRecord; score: number },
  right: { record: MemoryRecord; score: number }
): number {
  return right.score - left.score || left.record.id.localeCompare(right.record.id)
}

function validateCandidateConfiguration(input: {
  minimumSimilarity: number
  fusion?: SemanticMemoryRankFusion
}): void {
  if (!Number.isFinite(input.minimumSimilarity) || input.minimumSimilarity < -1 || input.minimumSimilarity > 1) {
    throw new Error('minimumSimilarity must be between -1 and 1')
  }
  if (!input.fusion) return
  reciprocalRankFusion({
    rankings: [
      { ids: [], weight: input.fusion.semanticWeight },
      { ids: [], weight: input.fusion.lexicalWeight }
    ],
    rankConstant: input.fusion.rankConstant
  })
}

function missingVector(id: string): never {
  throw new Error(`embedding cache is missing record: ${id}`)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
