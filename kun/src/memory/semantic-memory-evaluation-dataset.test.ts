import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { memoryRecordSearchTokens, memorySearchTokens } from './memory-search-tokens.js'
import {
  DEFAULT_SEMANTIC_MEMORY_DATASET_PATHS,
  loadSemanticMemoryEvaluationDataset,
  parseSemanticMemoryEvaluationDataset
} from './semantic-memory-evaluation-dataset.js'

describe('semantic Memory evaluation dataset', () => {
  it('loads only the frozen checked-in anonymous dataset', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()

    expect(dataset.manifest.datasetId).toBe('kun-memory-semantic-retrieval-anonymous-v1')
    expect(dataset.records).toHaveLength(31)
    expect(dataset.queries).toHaveLength(40)
    expect(dataset.queries.filter((query) => query.split === 'development')).toHaveLength(32)
    expect(dataset.queries.filter((query) => query.split === 'holdout')).toHaveLength(8)
    expect(dataset.queries.filter((query) => query.expectedIds.length === 0)).toHaveLength(4)
    expect(dataset.records.every((record) => record.authority === 'reference')).toBe(true)
  })

  it('contains the reviewed multilingual and zero-overlap coverage', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const recordsById = new Map(dataset.records.map((record) => [record.id, record]))
    const semantic = dataset.queries.filter((query) =>
      query.category === 'semantic-paraphrase' || query.category === 'cross-lingual'
    )
    const zeroOverlap = semantic.filter((query) => {
      const queryTokens = new Set(memorySearchTokens(query.query).tokens)
      const expectedTokens = new Set(query.expectedIds.flatMap((id) => {
        const record = recordsById.get(id)
        return record ? memoryRecordSearchTokens(record).tokens : []
      }))
      return [...queryTokens].every((token) => !expectedTokens.has(token))
    })

    expect(semantic).toHaveLength(22)
    expect(zeroOverlap).toHaveLength(8)
    expect(zeroOverlap.filter((query) => query.split === 'holdout')).toHaveLength(3)
  })

  it('contains no machine or account identifiers in the source data', async () => {
    const { recordsText, queriesText } = await sourceTexts()
    const source = `${recordsText}\n${queriesText}`

    expect(source).not.toMatch(/\b[A-Za-z]:[\\/]/u)
    expect(source).not.toMatch(/\\\\[^\\\s]+\\[^\\\s]+/u)
    expect(source).not.toMatch(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu)
    expect(source).not.toMatch(/github\.com\/[A-Za-z0-9_-]+/iu)
    expect(source).not.toMatch(/\b(?:api[_-]?key|password|secret|token)\b\s*[:=]/iu)
  })

  it.each([
    ['unsupported schema version', (data: RawData) => { data.records.schemaVersion = 2 }],
    ['unknown root field', (data: RawData) => { data.records.unexpected = true }],
    ['invalid Memory field', (data: RawData) => { data.records.records[0].confidence = 2 }],
    ['invalid scope target', (data: RawData) => { data.records.records[0].workspace = '/fixtures/p2a/workspace-a' }],
    ['duplicate record id', (data: RawData) => { data.records.records[1].id = data.records.records[0].id }],
    ['unresolved expected id', (data: RawData) => { data.queries.queries[0].expectedIds = ['p2a_missing'] }],
    ['expected and forbidden conflict', (data: RawData) => {
      data.queries.queries[0].forbiddenIds = [...data.queries.queries[0].expectedIds]
    }],
    ['split count drift', (data: RawData) => { data.queries.queries.find((query) => query.split === 'holdout')!.split = 'development' }]
  ])('rejects %s', async (_name, mutate) => {
    const data = await rawData()
    mutate(data)
    refreshHashes(data)

    expect(() => parseSemanticMemoryEvaluationDataset(toTexts(data))).toThrow()
  })

  it('rejects content changes that do not update the frozen manifest hash', async () => {
    const data = await rawData()
    data.records.records[0].content += ' Changed.'

    expect(() => parseSemanticMemoryEvaluationDataset(toTexts(data)))
      .toThrow('records hash mismatch')
  })
})

type RawData = {
  records: {
    schemaVersion: number
    unexpected?: boolean
    records: Array<{
      id: string
      content: string
      confidence: number
      workspace?: string
    }>
  }
  queries: {
    queries: Array<{
      split: 'development' | 'holdout'
      expectedIds: string[]
      forbiddenIds: string[]
    }>
  }
  manifest: {
    hashes: {
      recordsSha256: string
      queriesSha256: string
    }
  }
}

async function rawData(): Promise<RawData> {
  const { recordsText, queriesText, manifestText } = await sourceTexts()
  return {
    records: JSON.parse(recordsText),
    queries: JSON.parse(queriesText),
    manifest: JSON.parse(manifestText)
  }
}

async function sourceTexts() {
  const [recordsText, queriesText, manifestText] = await Promise.all([
    readFile(DEFAULT_SEMANTIC_MEMORY_DATASET_PATHS.records, 'utf8'),
    readFile(DEFAULT_SEMANTIC_MEMORY_DATASET_PATHS.queries, 'utf8'),
    readFile(DEFAULT_SEMANTIC_MEMORY_DATASET_PATHS.manifest, 'utf8')
  ])
  return { recordsText, queriesText, manifestText }
}

function refreshHashes(data: RawData): void {
  data.manifest.hashes.recordsSha256 = sha256(JSON.stringify(data.records, null, 2) + '\n')
  data.manifest.hashes.queriesSha256 = sha256(JSON.stringify(data.queries, null, 2) + '\n')
}

function toTexts(data: RawData) {
  return {
    recordsText: JSON.stringify(data.records, null, 2) + '\n',
    queriesText: JSON.stringify(data.queries, null, 2) + '\n',
    manifestText: JSON.stringify(data.manifest, null, 2) + '\n'
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
