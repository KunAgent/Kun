import { describe, expect, it } from 'vitest'
import type { MemoryRecord } from '../contracts/memory.js'
import type {
  SemanticMemoryCandidate,
  SemanticMemoryCandidateMetadata
} from './semantic-memory-evaluation.js'
import { loadSemanticMemoryV2EvaluationDataset } from './semantic-memory-evaluation-v2-dataset.js'
import {
  assertSemanticMemoryV2HoldoutLock,
  createSemanticMemoryV2EvaluationLock,
  runSemanticMemoryV2DevelopmentGrid,
  runSemanticMemoryV2HoldoutEvaluation,
  selectSemanticMemoryV2DevelopmentCandidate,
  semanticMemoryV2DevelopmentGridConfigurations,
  semanticMemoryV2DevelopmentGridSha256,
  type SemanticMemoryV2GridConfiguration
} from './semantic-memory-evaluation-v2-workflow.js'

describe('semantic Memory v2 evaluation workflow', () => {
  it('enumerates the complete frozen development grid deterministically', async () => {
    const { manifest } = await loadSemanticMemoryV2EvaluationDataset()
    const first = semanticMemoryV2DevelopmentGridConfigurations(manifest)
    const second = semanticMemoryV2DevelopmentGridConfigurations(manifest)

    expect(first).toHaveLength(18)
    expect(first).toEqual(second)
    expect(first[0]).toEqual({
      id: 'sim-0p7-sem-0p5-lex-1-rrf-30',
      minimumSimilarity: 0.7,
      semanticWeight: 0.5,
      lexicalWeight: 1,
      rankConstant: 30
    })
    expect(first.at(-1)?.id).toBe('sim-0p8-sem-1p5-lex-1-rrf-60')
    expect(semanticMemoryV2DevelopmentGridSha256(manifest)).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('runs every configuration against development queries only', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()
    const result = await runSemanticMemoryV2DevelopmentGrid({
      dataset,
      createCandidate: candidateFor
    })

    expect(result.entries).toHaveLength(18)
    expect(result.entries.every((entry) => entry.report.results.length === 40)).toBe(true)
    expect(result.entries.every((entry) =>
      entry.report.results.every((query) => query.split === 'development')
    )).toBe(true)
    expect(result.entries.every((entry) =>
      entry.report.dataset.queriesSha256 === dataset.sourceHashes.queries
    )).toBe(true)
  })

  it('rejects a candidate whose metadata drifts from a grid configuration', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()

    await expect(runSemanticMemoryV2DevelopmentGrid({
      dataset,
      createCandidate: (configuration) => ({
        ...candidateFor(configuration),
        metadata: { ...candidateFor(configuration).metadata, parameters: {} }
      })
    })).rejects.toThrow('does not match grid configuration')
  })

  it('selects only a safe development candidate using deterministic quality ordering', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()
    const grid = await runSemanticMemoryV2DevelopmentGrid({ dataset, createCandidate: candidateFor })
    const baseline = grid.entries[0]!.report
    const weaker = grid.entries[0]!
    const stronger = {
      ...grid.entries[1]!,
      report: {
        ...grid.entries[1]!.report,
        metrics: {
          ...grid.entries[1]!.report.metrics,
          recallAtK: baseline.metrics.recallAtK + 0.2,
          meanReciprocalRank: baseline.metrics.meanReciprocalRank + 0.1,
          precisionAtK: baseline.metrics.precisionAtK
        }
      }
    }
    const unsafe = {
      ...grid.entries[2]!,
      report: {
        ...grid.entries[2]!.report,
        safetyGatePassed: false,
        metrics: { ...grid.entries[2]!.report.metrics, recallAtK: 1, meanReciprocalRank: 1 }
      }
    }

    expect(selectSemanticMemoryV2DevelopmentCandidate({
      manifest: dataset.manifest,
      baseline,
      grid: { ...grid, entries: [weaker, unsafe, stronger] }
    })?.configuration.id).toBe(stronger.configuration.id)
  })

  it('requires a matching lock before returning any holdout result', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()
    const configuration = semanticMemoryV2DevelopmentGridConfigurations(dataset.manifest)[0]!
    const candidate = candidateFor(configuration)
    const lock = createLock(dataset, candidate.metadata, configuration)
    const report = await runSemanticMemoryV2HoldoutEvaluation({
      dataset,
      candidate,
      terminologySha256: 'd'.repeat(64),
      lock
    })

    expect(report.results).toHaveLength(40)
    expect(report.results.every((result) => result.split === 'holdout')).toBe(true)
  })

  it('fails closed for an absent or drifted holdout lock', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()
    const configuration = semanticMemoryV2DevelopmentGridConfigurations(dataset.manifest)[0]!
    const candidate = candidateFor(configuration)
    const lock = createLock(dataset, candidate.metadata, configuration)

    expect(() => assertSemanticMemoryV2HoldoutLock({
      dataset,
      candidate: candidate.metadata,
      terminologySha256: 'd'.repeat(64),
      lock: undefined
    })).toThrow()
    expect(() => assertSemanticMemoryV2HoldoutLock({
      dataset,
      candidate: { ...candidate.metadata, artifactSha256: '0'.repeat(64) },
      terminologySha256: 'd'.repeat(64),
      lock
    })).toThrow('candidate')
    expect(() => assertSemanticMemoryV2HoldoutLock({
      dataset,
      candidate: candidate.metadata,
      terminologySha256: '9'.repeat(64),
      lock
    })).toThrow('terminologySha256')
  })

  it('rejects a lock selection outside the pre-registered grid', async () => {
    const dataset = await loadSemanticMemoryV2EvaluationDataset()
    const configuration = {
      ...semanticMemoryV2DevelopmentGridConfigurations(dataset.manifest)[0]!,
      id: 'sim-outside',
      minimumSimilarity: 0.69
    }
    const candidate = candidateFor(configuration)

    expect(() => createLock(dataset, candidate.metadata, configuration)).toThrow('outside the frozen')
  })
})

function candidateFor(configuration: SemanticMemoryV2GridConfiguration): SemanticMemoryCandidate {
  return {
    metadata: {
      id: `test-${configuration.id}`,
      kind: 'hybrid',
      version: 'test',
      runtime: 'test',
      license: 'test',
      artifactSha256: 'a'.repeat(64),
      dimensions: 8,
      normalization: 'test-l2',
      parameters: {
        fusionMode: 'semantic-gated-rrf',
        minimumSimilarity: configuration.minimumSimilarity,
        semanticWeight: configuration.semanticWeight,
        lexicalWeight: configuration.lexicalWeight,
        rankConstant: configuration.rankConstant
      },
      platforms: ['test']
    },
    retrieve: async ({ records }) => noRecords(records)
  }
}

function createLock(
  dataset: Awaited<ReturnType<typeof loadSemanticMemoryV2EvaluationDataset>>,
  candidate: SemanticMemoryCandidateMetadata,
  selectedConfiguration: SemanticMemoryV2GridConfiguration
) {
  return createSemanticMemoryV2EvaluationLock({
    dataset,
    candidate,
    selectedConfiguration,
    terminologySha256: 'd'.repeat(64),
    developmentEvidenceSha256: 'e'.repeat(64),
    lockedAt: '2026-09-10T00:00:00.000Z'
  })
}

function noRecords(_records: readonly MemoryRecord[]): readonly MemoryRecord[] {
  return []
}
