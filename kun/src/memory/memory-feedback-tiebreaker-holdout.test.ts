import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  MemoryFeedbackTiebreakerCalibrationReport,
  MemoryFeedbackTiebreakerCandidateLock,
  MemoryFeedbackTiebreakerDecisionPlan,
  MemoryFeedbackTiebreakerDevelopmentArtifact
} from './memory-feedback-tiebreaker-contracts.js'
import { runLockedMemoryFeedbackTiebreakerHoldout } from './memory-feedback-tiebreaker-holdout.js'

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

describe('memory feedback tiebreaker holdout guard', () => {
  it('rejects an invalid lock before the evaluation callback runs', async () => {
    const input = await loadInput()
    const evaluate = vi.fn()
    const invalidLock = {
      ...input.lock,
      artifactHashes: { ...input.lock.artifactHashes, fixtureSha256: 'f'.repeat(64) }
    }

    expect(() => runLockedMemoryFeedbackTiebreakerHoldout({
      ...input,
      lock: invalidLock,
      independentReviewConfirmed: true,
      evidenceExists: false,
      evaluate
    })).toThrow(/does not match its dependencies/u)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('requires independent review and refuses to overwrite evidence', async () => {
    const input = await loadInput()
    const evaluate = vi.fn()
    const run = (independentReviewConfirmed: boolean, evidenceExists: boolean) => () =>
      runLockedMemoryFeedbackTiebreakerHoldout({
        ...input,
        independentReviewConfirmed,
        evidenceExists,
        evaluate
      })

    expect(run(false, false)).toThrow(/requires independent lock review/u)
    expect(run(true, true)).toThrow(/evidence already exists/u)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('passes only the locked candidate id to an authorized evaluator', async () => {
    const input = await loadInput()
    const evaluate = vi.fn((candidateId: string) => ({ candidateId }))

    expect(runLockedMemoryFeedbackTiebreakerHoldout({
      ...input,
      independentReviewConfirmed: true,
      evidenceExists: false,
      evaluate
    })).toEqual({ candidateId: 'foundation-control' })
    expect(evaluate).toHaveBeenCalledOnce()
  })
})

async function loadInput() {
  const [calibrationText, planText, developmentText, lockText] = await Promise.all([
    readFile(fixturePath('memory-feedback-tiebreaker-calibration.v1.json'), 'utf8'),
    readFile(fixturePath('memory-feedback-tiebreaker-plan.v1.json'), 'utf8'),
    readFile(fixturePath('memory-feedback-tiebreaker-development.v1.json'), 'utf8'),
    readFile(fixturePath('memory-feedback-tiebreaker-lock.v1.json'), 'utf8')
  ])
  return {
    calibration: MemoryFeedbackTiebreakerCalibrationReport.parse(JSON.parse(calibrationText)),
    plan: MemoryFeedbackTiebreakerDecisionPlan.parse(JSON.parse(planText)),
    development: MemoryFeedbackTiebreakerDevelopmentArtifact.parse(JSON.parse(developmentText)),
    lock: MemoryFeedbackTiebreakerCandidateLock.parse(JSON.parse(lockText)),
    lockedAt: '2026-09-16T00:00:00.000Z'
  }
}
