import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { loadSemanticMemoryEvaluationDataset } from './semantic-memory-evaluation-dataset.js'

describe('semantic Memory development evidence', () => {
  it('contains development-only screening that matches the candidate lock', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const evidence = await fixture('semantic-memory-development-screening.v1.json')

    expect(evidence.constraints).toMatchObject({ split: 'development', holdoutIncluded: false, networkAttempts: 0 })
    expect(evidence.dataset).toMatchObject({
      id: dataset.manifest.datasetId,
      recordsSha256: dataset.manifest.hashes.recordsSha256,
      queriesSha256: dataset.manifest.hashes.queriesSha256,
      queryCount: dataset.manifest.counts.development
    })
    expect(evidence.developmentSelection).toMatchObject({
      candidateId: 'multilingual-e5-small-q8',
      configurationId: 'hybrid-0.8-1'
    })
    const selected = evidence.candidates[0].configurations.find(
      (configuration: unknown[]) => configuration[0] === evidence.developmentSelection.configurationId
    )
    expect(selected).toBeDefined()
    expect(evidence.candidates[0].artifactSha256)
      .toBe(dataset.manifest.candidateLock.candidate.artifactSha256)
  })

  it('keeps the selected Windows x64 resource evidence within every frozen limit', async () => {
    const dataset = await loadSemanticMemoryEvaluationDataset()
    const evidence = await fixture('semantic-memory-e5-resources.windows-x64.v1.json')
    const resources = evidence.resources
    const thresholds = dataset.manifest.thresholds

    expect(evidence.offline.networkAttempts).toBe(thresholds.networkAttempts)
    expect(evidence.candidate.artifactSha256).toBe(dataset.manifest.candidateLock.candidate.artifactSha256)
    expect(resources.warmQueryIterations).toBeGreaterThanOrEqual(30)
    expect(resources.coldReadinessMs).toBeLessThanOrEqual(thresholds.maximumColdReadinessMs)
    expect(resources.warmQueryP95Ms).toBeLessThanOrEqual(thresholds.maximumWarmQueryP95Ms)
    expect(resources.tenThousandRecordBuildMs).toBeLessThanOrEqual(thresholds.maximumTenThousandRecordBuildMs)
    expect(resources.modelBytes).toBeLessThanOrEqual(thresholds.maximumCompressedModelBytes)
    expect(resources.indexBytes).toBeLessThanOrEqual(thresholds.maximumTenThousandRecordIndexBytes)
    expect(resources.additionalPeakRssBytes).toBeLessThanOrEqual(thresholds.maximumAdditionalPeakRssBytes)
  })
})

async function fixture(name: string): Promise<any> {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
}
