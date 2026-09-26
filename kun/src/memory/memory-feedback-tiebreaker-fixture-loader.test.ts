import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  MemoryFeedbackTiebreakerFixtureFile,
  MemoryFeedbackTiebreakerManifest
} from './memory-feedback-tiebreaker-contracts.js'
import {
  DEFAULT_MEMORY_FEEDBACK_TIEBREAKER_PATHS,
  loadMemoryFeedbackTiebreakerDataset,
  memoryFeedbackTiebreakerFileSha256,
  parseMemoryFeedbackTiebreakerDataset
} from './memory-feedback-tiebreaker-fixture-loader.js'

describe('memory feedback tiebreaker fixture loader', () => {
  it('validates frozen hashes, quotas, labels, privacy, and split isolation', async () => {
    const dataset = await loadMemoryFeedbackTiebreakerDataset()

    expect(dataset.fixture.cases.filter((item) => item.partition === 'development')).toHaveLength(18)
    expect(dataset.fixture.cases.filter((item) => item.partition === 'holdout')).toHaveLength(18)
    expect(dataset.sourceHashes.fixture).toBe(dataset.manifest.fixtureSha256)
  })

  it('invalidates the manifest after a one-byte fixture change', async () => {
    const input = await loadTexts()

    expect(() => parseMemoryFeedbackTiebreakerDataset({
      ...input,
      fixtureText: input.fixtureText.replace('compact tables', 'compact tablez')
    })).toThrow(/fixture checksum mismatch/u)
  })

  it('rejects normalized duplicates across development and holdout', async () => {
    const input = await loadTexts()
    const fixture = MemoryFeedbackTiebreakerFixtureFile.parse(JSON.parse(input.fixtureText))
    const manifest = MemoryFeedbackTiebreakerManifest.parse(JSON.parse(input.manifestText))
    const development = fixture.cases.find((item) => item.partition === 'development')!
    const holdout = fixture.cases.find((item) => item.partition === 'holdout')!
    holdout.query = development.query.toUpperCase()

    expect(() => parseMemoryFeedbackTiebreakerDataset(seal(fixture, manifest)))
      .toThrow(/cross-split near-duplicates/u)
  })

  it('rejects ambiguous labels before retrieval can execute', async () => {
    const input = await loadTexts()
    const fixture = MemoryFeedbackTiebreakerFixtureFile.parse(JSON.parse(input.fixtureText))
    const item = fixture.cases.find((candidate) => candidate.stratum !== 'no-result-control')!
    item.forbiddenIds.push(item.expectedIds[0]!)

    expect(() => parseMemoryFeedbackTiebreakerDataset({
      ...input,
      fixtureText: JSON.stringify(fixture)
    })).toThrow(/both expected and forbidden/u)
  })
})

async function loadTexts(): Promise<{
  fixtureText: string
  manifestText: string
  checksumsText: string
}> {
  const [fixtureText, manifestText, checksumsText] = await Promise.all([
    readFile(DEFAULT_MEMORY_FEEDBACK_TIEBREAKER_PATHS.fixture, 'utf8'),
    readFile(DEFAULT_MEMORY_FEEDBACK_TIEBREAKER_PATHS.manifest, 'utf8'),
    readFile(DEFAULT_MEMORY_FEEDBACK_TIEBREAKER_PATHS.checksums, 'utf8')
  ])
  return { fixtureText, manifestText, checksumsText }
}

function seal(
  fixture: ReturnType<typeof MemoryFeedbackTiebreakerFixtureFile.parse>,
  manifest: ReturnType<typeof MemoryFeedbackTiebreakerManifest.parse>
): { fixtureText: string; manifestText: string; checksumsText: string } {
  const fixtureText = `${JSON.stringify(fixture, null, 2)}\n`
  manifest.fixtureSha256 = memoryFeedbackTiebreakerFileSha256(fixtureText)
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  const checksumsText = JSON.stringify({
    schemaVersion: 1,
    evaluationVersion: 'p3-feedback-tiebreaker-v1',
    algorithm: 'sha256',
    files: {
      fixture: manifest.fixtureSha256,
      manifest: memoryFeedbackTiebreakerFileSha256(manifestText)
    }
  })
  return { fixtureText, manifestText, checksumsText }
}
