import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runMemoryFeedbackTiebreakerHoldout } from './memory-feedback-tiebreaker-holdout-runner.js'

describe('memory feedback tiebreaker holdout runner', () => {
  it('runs the reviewed fallback against holdout without changing frozen inputs', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'kun-tiebreaker-runner-'))
    try {
      const evidence = await runMemoryFeedbackTiebreakerHoldout({
        outputDirectory,
        independentReviewConfirmed: true,
        lockedAt: '2026-09-21T00:00:00.000Z'
      })
      expect(evidence.selectedCandidateId).toBe('foundation-control')
      expect(evidence.holdoutRunCount).toBe(1)
      expect(evidence.decision).toBe('no-go')
      expect(JSON.parse(await readFile(join(outputDirectory, `${evidence.decisionId}.json`), 'utf8')))
        .toEqual(evidence)
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })
})
