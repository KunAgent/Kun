import { describe, expect, it, vi } from 'vitest'
import { loadSemanticMemoryV3EvaluationDataset } from './semantic-memory-evaluation-v3-dataset.js'
import {
  runSemanticMemoryV3HoldoutEvaluation,
  runSemanticMemoryV3DevelopmentGrid,
  semanticMemoryV3DevelopmentGridConfigurations
} from './semantic-memory-evaluation-v3-workflow.js'

describe('semantic Memory v3 development workflow', () => {
  it('enumerates the frozen finite grid and reports every configuration', async () => {
    const dataset = await loadSemanticMemoryV3EvaluationDataset()
    const configurations = semanticMemoryV3DevelopmentGridConfigurations(dataset)
    expect(configurations).toHaveLength(54)
    expect(new Set(configurations.map((configuration) => configuration.id)).size).toBe(54)

    const result = await runSemanticMemoryV3DevelopmentGrid({
      dataset,
      createCandidate: (configuration) => ({
        metadata: {
          id: configuration.id,
          kind: 'hybrid',
          version: 'v3-test',
          runtime: 'offline-test',
          license: 'repository',
          parameters: { ...configuration },
          platforms: ['win32-x64']
        },
        retrieve: async () => []
      })
    })

    expect(result.entries).toHaveLength(54)
    expect(result.entries.every((entry) => entry.report !== undefined && entry.error === undefined)).toBe(true)
    expect(result.entries.every((entry) => entry.report?.results.every((item) => item.split === 'development'))).toBe(true)
  })

  it('does not invoke a candidate when the holdout lock is invalid', async () => {
    const dataset = await loadSemanticMemoryV3EvaluationDataset()
    const retrieve = vi.fn(async () => [])
    const candidate = {
      metadata: {
        id: 'candidate',
        kind: 'hybrid' as const,
        version: 'v3-test',
        runtime: 'offline-test',
        license: 'repository',
        parameters: {},
        platforms: ['win32-x64']
      },
      retrieve
    }

    await expect(runSemanticMemoryV3HoldoutEvaluation({
      dataset,
      model: dataset.manifest.candidateIdentity,
      baseline: { id: 'baseline', version: 'v1', parameters: {} },
      candidate,
      lock: {}
    })).rejects.toThrow()
    expect(retrieve).not.toHaveBeenCalled()
  })
})
