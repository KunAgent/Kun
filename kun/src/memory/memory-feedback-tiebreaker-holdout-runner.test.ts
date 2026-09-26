import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runMemoryFeedbackTiebreakerHoldout } from './memory-feedback-tiebreaker-holdout-runner.js'

describe('memory feedback tiebreaker holdout runner', () => {
  it('refuses scoring the retired version even in a fresh output directory', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'kun-tiebreaker-runner-'))
    try {
      await expect(runMemoryFeedbackTiebreakerHoldout({
        outputDirectory,
        independentReviewConfirmed: true,
        lockedAt: '2026-09-21T00:00:00.000Z'
      })).rejects.toThrow(/v1 is retired/u)
      expect(await readdir(outputDirectory)).toEqual([])
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })
})
