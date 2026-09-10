import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEMANTIC_MEMORY_V2_DATASET_PATHS,
  loadSemanticMemoryV2EvaluationDataset,
  parseSemanticMemoryV2EvaluationDataset,
  SemanticMemoryV2QueryCategory
} from './semantic-memory-evaluation-v2-dataset.js'

describe('semantic Memory v2 evaluation dataset', () => {
  it('loads the frozen anonymous 40/40 dataset', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()

    expect(dataset.manifest.datasetId).toBe('kun-memory-semantic-retrieval-anonymous-v2')
    expect(dataset.records.length).toBeGreaterThanOrEqual(40)
    expect(dataset.records.length).toBeLessThanOrEqual(48)
    expect(dataset.queries).toHaveLength(80)
    expect(dataset.queries.filter((query) => query.split === 'development')).toHaveLength(40)
    expect(dataset.queries.filter((query) => query.split === 'holdout')).toHaveLength(40)
    expect(dataset.records.every((record) => record.authority === 'reference')).toBe(true)
    expect(dataset.queries.every((query) => query.rationale.length >= 20)).toBe(true)
  })

  it('matches every declared primary-category quota', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()

    for (const category of SemanticMemoryV2QueryCategory.options) {
      for (const split of ['development', 'holdout'] as const) {
        const actual = dataset.queries.filter((query) => query.category === category && query.split === split)
        expect(actual).toHaveLength(dataset.manifest.categoryQuotas[category][split])
      }
    }
  })

  it('contains no machine, account, or credential identifiers', async () => {
    const data = await sourceTexts()
    const source = `${data.recordsText}\n${data.queriesText}`

    expect(source).not.toMatch(/\b[A-Za-z]:[\\/]/u)
    expect(source).not.toMatch(/\\\\[^\\\s]+\\[^\\\s]+/u)
    expect(source).not.toMatch(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu)
    expect(source).not.toMatch(/github\.com\/[A-Za-z0-9_-]+/iu)
    expect(source).not.toMatch(/\b(?:api[_-]?key|password|secret|token)\b\s*[:=]/iu)
  })

  it.each([
    ['unsupported schema version', (data: RawData) => { data.records.schemaVersion = 1 }],
    ['unknown field', (data: RawData) => { data.queries.unexpected = true }],
    ['missing rationale', (data: RawData) => { data.queries.queries[0].rationale = '' }],
    ['duplicate query id', (data: RawData) => { data.queries.queries[1].id = data.queries.queries[0].id }],
    ['unresolved expected id', (data: RawData) => { data.queries.queries[0].expectedIds = ['p2a_v2_missing'] }],
    ['expected and forbidden conflict', (data: RawData) => {
      data.queries.queries[0].forbiddenIds = [...data.queries.queries[0].expectedIds]
    }],
    ['non-deterministic split', (data: RawData) => { data.queries.queries[0].split = 'holdout' }],
    ['category quota drift', (data: RawData) => { data.queries.queries[0].category = 'cross-lingual' }]
  ])('rejects %s after checksums are refreshed', async (_name, mutate) => {
    const data = await rawData()
    mutate(data)
    refreshHashes(data)

    expect(() => parseSemanticMemoryV2EvaluationDataset(toTexts(data))).toThrow()
  })

  it('rejects source or manifest changes with stale checksums', async () => {
    const data = await rawData()
    data.records.records[0].content += ' Changed.'
    const input = toTexts(data)

    expect(() => parseSemanticMemoryV2EvaluationDataset(input)).toThrow('records checksum mismatch')
  })

  it('recomputes the same three source hashes on repeated loads', async () => {
    const first = await loadSemanticMemoryV2EvaluationDataset()
    const second = await loadSemanticMemoryV2EvaluationDataset()

    expect(first.sourceHashes).toEqual(second.sourceHashes)
    expect(first.sourceHashes.manifest).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('accepts all frozen inputs with Windows line endings', async () => {
    const data = await sourceTexts()

    expect(() => parseSemanticMemoryV2EvaluationDataset({
      recordsText: windowsLines(data.recordsText),
      queriesText: windowsLines(data.queriesText),
      manifestText: windowsLines(data.manifestText),
      checksumsText: windowsLines(data.checksumsText)
    })).not.toThrow()
  })
})

type RawData = {
  records: { schemaVersion: number; records: Array<{ content: string }> }
  queries: {
    unexpected?: boolean
    queries: Array<{
      id: string
      split: 'development' | 'holdout'
      category: string
      rationale: string
      expectedIds: string[]
      forbiddenIds: string[]
    }>
  }
  manifest: { hashes: { recordsSha256: string; queriesSha256: string } }
  checksums: { files: { records: string; queries: string; manifest: string } }
}

async function sourceTexts() {
  const paths = DEFAULT_SEMANTIC_MEMORY_V2_DATASET_PATHS
  const [recordsText, queriesText, manifestText, checksumsText] = await Promise.all([
    readFile(paths.records, 'utf8'),
    readFile(paths.queries, 'utf8'),
    readFile(paths.manifest, 'utf8'),
    readFile(paths.checksums, 'utf8')
  ])
  return { recordsText, queriesText, manifestText, checksumsText }
}

async function rawData(): Promise<RawData> {
  const texts = await sourceTexts()
  return {
    records: JSON.parse(texts.recordsText),
    queries: JSON.parse(texts.queriesText),
    manifest: JSON.parse(texts.manifestText),
    checksums: JSON.parse(texts.checksumsText)
  }
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

function windowsLines(value: string): string {
  return value.replace(/\r?\n/gu, '\r\n')
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
  return createHash('sha256').update(value).digest('hex')
}
