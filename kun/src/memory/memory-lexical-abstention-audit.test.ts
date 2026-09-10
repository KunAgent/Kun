import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_KUN_CAPABILITIES_CONFIG } from '../contracts/capabilities.js'
import { retrieveMemoryRecords } from './memory-retrieval.js'
import { loadSemanticMemoryV2EvaluationDataset } from './semantic-memory-evaluation-v2-dataset.js'

type RegressionFixture = {
  foundationThreshold: number
  cases: Array<{
    queryId: string
    expectedIds: string[]
    forbiddenIds: string[]
    observedBeforeFix: string[]
    expectedAfterFix: string[]
  }>
}

const fixturePath = fileURLToPath(new URL(
  './fixtures/memory-lexical-abstention-regression.v1.json',
  import.meta.url
))

describe('Memory lexical abstention audit', () => {
  it('records the weak-positive q033/q034 baseline and correct q035/q036 abstention', async () => {
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as RegressionFixture
    const dataset = await loadSemanticMemoryV2EvaluationDataset()
    const policy = { ...DEFAULT_KUN_CAPABILITIES_CONFIG.memory, enabled: true }

    expect(fixture.foundationThreshold).toBe(0.4)
    for (const testCase of fixture.cases) {
      const query = dataset.queries.find((item) => item.id === testCase.queryId)
      expect(query).toBeDefined()
      const result = retrieveMemoryRecords({
        records: dataset.records,
        request: {
          query: query!.query,
          workspace: query!.workspace,
          project: query!.project,
          limit: dataset.manifest.defaultK,
          promptCharacterBudget: dataset.manifest.promptCharacterBudget
        },
        policy,
        mode: 'filesystem-fallback',
        nowIso: dataset.manifest.evaluationNow
      })

      expect(result.records.map((record) => record.id)).toEqual(testCase.observedBeforeFix)
      expect(testCase.expectedAfterFix).toEqual([])
      expect(result.records.every((record) => !testCase.expectedIds.includes(record.id))).toBe(true)
      if (testCase.observedBeforeFix.length > 0) {
        expect(result.trace.rankings[0]?.features.lexical).toBeGreaterThan(0)
        expect(result.trace.rankings[0]?.features.lexical).toBeLessThan(fixture.foundationThreshold)
      }
    }
  })
})
