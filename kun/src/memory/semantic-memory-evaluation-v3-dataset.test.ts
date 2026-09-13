import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  loadSemanticMemoryV3EvaluationDataset,
  parseSemanticMemoryV3EvaluationDataset,
  SemanticMemoryV3QueryCategory
} from './semantic-memory-evaluation-v3-dataset.js'

describe('semantic Memory v3 evaluation dataset', () => {
  it('accepts a frozen 40/40 dataset with a zero-overlap positive stratum', () => {
    const data = buildRawData()

    expect(parseSemanticMemoryV3EvaluationDataset(toTexts(data))).toMatchObject({
      records: expect.arrayContaining([expect.objectContaining({ id: 'p2a_v3_record_001' })]),
      queries: expect.arrayContaining([expect.objectContaining({ category: 'cross-lingual-zero-overlap-positive' })])
    })
  })

  it('requires every declared category quota and zero-overlap count', () => {
    const data = buildRawData()
    data.queries.queries[3]!.zeroLexicalOverlap = false
    refreshHashes(data)

    expect(() => parseSemanticMemoryV3EvaluationDataset(toTexts(data))).toThrow()
  })

  it('rejects a missing category stratum', () => {
    const data = buildRawData()
    data.queries.queries[0]!.category = 'semantic-paraphrase'
    refreshHashes(data)

    expect(() => parseSemanticMemoryV3EvaluationDataset(toTexts(data))).toThrow('lexical-control development quota mismatch')
  })

  it('rejects malformed category values before evaluation', () => {
    const data = buildRawData()
    data.queries.queries[0]!.category = 'unsupported-category'
    refreshHashes(data)

    expect(() => parseSemanticMemoryV3EvaluationDataset(toTexts(data))).toThrow()
  })

  it('rejects stale source checksums', () => {
    const data = buildRawData()
    data.records.records[0]!.content += ' Changed.'

    expect(() => parseSemanticMemoryV3EvaluationDataset(toTexts(data))).toThrow('records checksum mismatch')
  })

  it('accepts Windows line endings after canonical hashing', () => {
    const data = buildRawData()
    const texts = toTexts(data)

    expect(() => parseSemanticMemoryV3EvaluationDataset({
      recordsText: windowsLines(texts.recordsText),
      queriesText: windowsLines(texts.queriesText),
      manifestText: windowsLines(texts.manifestText),
      checksumsText: windowsLines(texts.checksumsText)
    })).not.toThrow()
  })

  it('rejects normalized duplicate queries across development and holdout', () => {
    const data = buildRawData()
    data.queries.queries[40]!.query = '  ＡＮＯＮＹＭＯＵＳ   ＱＵＥＲＹ １ ＬＥＸＩＣＡＬ－ＣＯＮＴＲＯＬ!!! '
    refreshHashes(data)

    expect(() => parseSemanticMemoryV3EvaluationDataset(toTexts(data))).toThrow('duplicates development query')
  })

  it('rejects near-duplicate queries across development and holdout', () => {
    const data = buildRawData()
    data.queries.queries[40]!.query = 'Anonymous query 1 lexical-control sample'
    refreshHashes(data)

    expect(() => parseSemanticMemoryV3EvaluationDataset(toTexts(data))).toThrow('near-duplicates across splits')
  })

  it('loads the checked-in frozen v3 fixture with the locked model identity', async () => {
    const dataset = await loadSemanticMemoryV3EvaluationDataset()

    expect(dataset.records).toHaveLength(44)
    expect(dataset.queries).toHaveLength(80)
    expect(dataset.manifest.candidateIdentity).toMatchObject({
      modelId: 'multilingual-e5-small-q8',
      modelSha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
      tokenizerSha256: '0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39'
    })
    expect(dataset.queries.filter((query) => query.zeroLexicalOverlap)).toHaveLength(8)
  })
})

type RawData = {
  records: {
    schemaVersion: number
    datasetId: string
    status: string
    evaluationNow: string
    records: Array<Record<string, unknown>>
  }
  queries: {
    schemaVersion: number
    datasetId: string
    status: string
    defaultK: number
    queries: Array<Record<string, unknown>>
  }
  manifest: Record<string, any>
  checksums: Record<string, any>
}

function buildRawData(): RawData {
  const categories = SemanticMemoryV3QueryCategory.options
  const records = Array.from({ length: 40 }, (_, index) => ({
    id: `p2a_v3_record_${String(index + 1).padStart(3, '0')}`,
    content: `Anonymous fact ${index + 1} about a stable project concept.`,
    scope: 'user',
    type: 'fact',
    tags: [`concept-${index + 1}`],
    confidence: 0.9,
    importance: 0.8,
    observedAt: '2026-09-01T00:00:00.000Z'
  }))
  const queries = Array.from({ length: 80 }, (_, index) => {
    const ordinal = index + 1
    const category = categories[index % categories.length]!
    const zeroLexicalOverlap = category === 'cross-lingual-zero-overlap-positive'
    const expectedIds = ordinal % 2 === 0 || zeroLexicalOverlap
      ? [`p2a_v3_record_${String((index % 40) + 1).padStart(3, '0')}`]
      : []
    const forbidden = expectedIds[0] === 'p2a_v3_record_040'
      ? 'p2a_v3_record_039'
      : 'p2a_v3_record_040'
    return {
      id: `p2a_v3_q${String(ordinal).padStart(3, '0')}_sample`,
      split: ordinal <= 40 ? 'development' : 'holdout',
      queryLanguage: ordinal % 2 === 0 ? 'zh' : 'en',
      category,
      query: zeroLexicalOverlap
        ? `跨语言零词面样本 ${String.fromCharCode(97 + ((ordinal - 1) % 26))}${String.fromCharCode(97 + Math.floor((ordinal - 1) / 26))} ${String.fromCharCode(122 - ((ordinal - 1) % 26))}${String.fromCharCode(122 - Math.floor((ordinal - 1) / 26))}`
        : `Anonymous query ${ordinal} ${category}`,
      expectedIds,
      forbiddenIds: [forbidden],
      zeroLexicalOverlap,
      rationale: 'Synthetic fixture rationale with a deterministic label and category explanation.'
    }
  })
  const recordsFile = {
    schemaVersion: 3,
    datasetId: 'kun-memory-semantic-retrieval-anonymous-v3',
    status: 'frozen',
    evaluationNow: '2026-09-01T00:00:00.000Z',
    records
  }
  const queriesFile = {
    schemaVersion: 3,
    datasetId: 'kun-memory-semantic-retrieval-anonymous-v3',
    status: 'frozen',
    defaultK: 5,
    queries
  }
  const categoryQuotas = Object.fromEntries(categories.map((category) => [category, { development: 4, holdout: 4 }]))
  const manifest = {
    schemaVersion: 3,
    datasetId: 'kun-memory-semantic-retrieval-anonymous-v3',
    status: 'frozen',
    evaluationNow: '2026-09-01T00:00:00.000Z',
    defaultK: 5,
    promptCharacterBudget: 8_000,
    scoringVersion: 3,
    splitRule: 'query ordinals 001-040 development; 041-080 holdout',
    hashes: { recordsSha256: '', queriesSha256: '' },
    counts: {
      records: 40,
      queries: 80,
      development: 40,
      holdout: 40,
      english: 40,
      chinese: 40,
      emptyExpected: 40,
      zeroOverlapPositive: 8
    },
    categoryQuotas,
    candidateIdentity: {
      modelId: 'multilingual-e5-small-q8',
      modelSha256: 'a'.repeat(64),
      tokenizerSha256: 'b'.repeat(64),
      queryPrefix: 'query: ',
      documentPrefix: 'passage: ',
      pooling: 'mean',
      normalization: 'l2',
      quantization: 'int8',
      runtime: 'onnxruntime-node',
      dimensions: 384
    },
    normalization: {
      tokenizerVersion: 'fixture-tokenizer-v3',
      zeroOverlapRule: 'case, punctuation, CJK segmentation, stopwords, and declared token normalization are applied before overlap testing'
    },
    bootstrap: { method: 'paired-percentile', seed: 1308, resamples: 10_000, confidenceLevel: 0.95 },
    developmentGrid: {
      minimumSimilarities: [0.7],
      marginGaps: [0.02, 0.05],
      semanticWeights: [1],
      lexicalWeights: [1],
      rankConstants: [30]
    },
    thresholds: {
      scopeLeaks: 0,
      lifecycleLeaks: 0,
      authorityViolations: 0,
      networkAttempts: 0,
      fallbackMismatches: 0,
      emptyResultAccuracy: 1,
      minimumRecallGainLowerBound: 0.15,
      minimumMrrGainLowerBound: 0.1,
      maximumOverallPrecisionDecline: 0.05,
      maximumZeroOverlapRecallDecline: 0.1,
      deterministicRuns: 3,
      maximumCompressedModelBytes: 150_000_000,
      maximumWarmQueryP95Ms: 500,
      maximumColdReadinessMs: 10_000,
      maximumTenThousandRecordBuildMs: 30_000,
      maximumAdditionalPeakRssBytes: 400_000_000,
      maximumTenThousandRecordIndexBytes: 500_000_000
    },
    review: {
      privacyPatternsChecked: ['absolute-path', 'UNC-path', 'email', 'credential', 'repository-account'],
      labelingRule: 'Each query has one primary category, a rationale, expected ids, and forbidden ids.',
      notes: 'Synthetic test data only; replace with reviewed frozen v3 fixtures before evaluation.'
    }
  }
  const data = { records: recordsFile, queries: queriesFile, manifest, checksums: { schemaVersion: 3, datasetId: manifest.datasetId, algorithm: 'sha256', files: { records: '', queries: '', manifest: '' } } }
  refreshHashes(data)
  return data
}

function refreshHashes(data: RawData): void {
  const recordsText = pretty(data.records)
  const queriesText = pretty(data.queries)
  data.manifest.hashes.recordsSha256 = sha256(recordsText)
  data.manifest.hashes.queriesSha256 = sha256(queriesText)
  const manifestText = pretty(data.manifest)
  data.checksums.files = {
    records: sha256(recordsText),
    queries: sha256(queriesText),
    manifest: sha256(manifestText)
  }
}

function toTexts(data: RawData) {
  return {
    recordsText: pretty(data.records),
    queriesText: pretty(data.queries),
    manifestText: pretty(data.manifest),
    checksumsText: pretty(data.checksums)
  }
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

function sha256(value: string): string {
  return createHash('sha256').update(value.replace(/\r\n?/gu, '\n')).digest('hex')
}

function windowsLines(value: string): string {
  return value.replace(/\r?\n/gu, '\r\n')
}
