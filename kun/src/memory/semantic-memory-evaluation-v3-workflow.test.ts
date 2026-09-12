import { describe, expect, it, vi } from 'vitest'
import type { MemoryRecord } from '../contracts/memory.js'
import { loadSemanticMemoryV3EvaluationDataset } from './semantic-memory-evaluation-v3-dataset.js'
import { runSemanticMemoryEvaluation, type SemanticMemoryCandidate } from './semantic-memory-evaluation.js'
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

  it('keeps three locked development repeats deterministic', async () => {
    const dataset = await loadSemanticMemoryV3EvaluationDataset()
    const run = () => runSemanticMemoryV3DevelopmentGrid({
      dataset,
      createCandidate: (configuration) => ({
        metadata: {
          id: configuration.id,
          kind: 'hybrid' as const,
          version: 'v3-test',
          runtime: 'offline-test',
          license: 'repository',
          parameters: { ...configuration },
          platforms: ['win32-x64']
        },
        retrieve: async ({ records, limit }) => records.slice(0, limit)
      })
    })
    const repeats = await Promise.all(Array.from({ length: 3 }, run))
    const deterministic = (grid: typeof repeats[number]) => ({
      gridSha256: grid.gridSha256,
      entries: grid.entries.map((entry) => ({
        configuration: entry.configuration,
        error: entry.error,
        report: entry.report && {
          results: entry.report.results.map(({ latencyMs: _latencyMs, ...result }) => result),
          metrics: {
            ...entry.report.metrics,
            latencyP50Ms: 0,
            latencyP95Ms: 0
          }
        }
      }))
    })

    expect(deterministic(repeats[1]!)).toEqual(deterministic(repeats[0]!))
    expect(deterministic(repeats[2]!)).toEqual(deterministic(repeats[0]!))
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

  it('fails closed for scope, lifecycle, authority, unknown, forbidden, and network violations', async () => {
    const dataset = await loadSemanticMemoryV3EvaluationDataset()
    const query = dataset.queries.find((item) => item.id === 'p2a_v3_q025_ember_deploy_scope')!
    const foreign = dataset.records.find((record) => record.id === 'p2a_v3_lumen_deploy')!
    const disabled = dataset.records.find((record) => record.id === 'p2a_v3_a_password_rotation_disabled')!
    const source = dataset.records.find((record) => record.id === 'p2a_v3_a_review')!
    const changedAuthority = { ...source, authority: 'instruction' } as unknown as MemoryRecord
    const unknown = { ...source, id: 'p2a_v3_unknown_selection' }
    const candidate: SemanticMemoryCandidate = {
      metadata: {
        id: 'unsafe-v3-test-candidate',
        kind: 'hybrid',
        version: 'v3-test',
        runtime: 'offline-test',
        license: 'test-only',
        parameters: {},
        platforms: ['win32-x64']
      },
      retrieve: async () => [foreign, disabled, changedAuthority, unknown]
    }

    const report = await runSemanticMemoryEvaluation({
      dataset,
      candidate,
      split: 'development',
      networkAttempts: 1
    })
    const result = report.results.find((item) => item.queryId === query.id)!

    expect(result.scopeLeaks).toBe(1)
    expect(result.lifecycleLeaks).toBe(1)
    expect(result.authorityViolations).toBe(1)
    expect(result.unknownSelections).toBe(1)
    expect(result.explicitForbiddenSelections).toBe(1)
    expect(report.networkAttempts).toBe(1)
    expect(report.safetyGatePassed).toBe(false)
  })
})
