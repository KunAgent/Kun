import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MemoryFeedbackTiebreakerCalibrationReport,
  MemoryFeedbackTiebreakerCandidateLock,
  MemoryFeedbackTiebreakerDecisionPlan,
  MemoryFeedbackTiebreakerDevelopmentArtifact,
  memoryFeedbackTiebreakerArtifactSha256
} from './memory-feedback-tiebreaker-contracts.js'
import {
  persistLockedMemoryFeedbackTiebreakerHoldout,
  runLockedMemoryFeedbackTiebreakerHoldout
} from './memory-feedback-tiebreaker-holdout.js'

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('memory feedback tiebreaker holdout guard', () => {
  it('persists only one concurrent attempt and refuses subsequent runs', async () => {
    const input = await persistenceInput()
    const evidence = syntheticEvidence(input)
    const evaluate = vi.fn(async () => evidence)
    const results = await Promise.allSettled([
      persistLockedMemoryFeedbackTiebreakerHoldout({ ...input, evaluate }),
      persistLockedMemoryFeedbackTiebreakerHoldout({ ...input, evaluate })
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(evaluate).toHaveBeenCalledOnce()
    const path = join(input.outputDirectory, `${input.lock.decisionId}.json`)
    const before = await readFile(path, 'utf8')
    expect(JSON.parse(before)).toEqual(evidence)
    await expect(persistLockedMemoryFeedbackTiebreakerHoldout({ ...input, evaluate }))
      .rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('retains a failed attempt and cannot rerun after evaluation throws', async () => {
    const input = await persistenceInput()
    const evaluate = vi.fn(() => { throw new Error('interrupted') })
    await expect(persistLockedMemoryFeedbackTiebreakerHoldout({ ...input, evaluate }))
      .rejects.toThrow('interrupted')
    await expect(persistLockedMemoryFeedbackTiebreakerHoldout({ ...input, evaluate }))
      .rejects.toMatchObject({ code: 'EEXIST' })
    expect(evaluate).toHaveBeenCalledOnce()
  })

  it('rejects a false go decision without publishing evidence', async () => {
    const input = await persistenceInput()
    await expect(persistLockedMemoryFeedbackTiebreakerHoldout({
      ...input, evaluate: () => ({ ...syntheticEvidence(input), decision: 'go' })
    })).rejects.toThrow(/decision disagrees/u)
    expect(await readFile(join(input.outputDirectory, `${input.lock.decisionId}.json`), 'utf8')).toBe('')
  })

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

async function persistenceInput() {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'kun-tiebreaker-holdout-test-'))
  temporaryRoots.push(outputDirectory)
  return { ...await loadInput(), outputDirectory, independentReviewConfirmed: true }
}

// Synthetic writer payload only; no holdout cases are evaluated by these tests.
function syntheticEvidence(input: Awaited<ReturnType<typeof persistenceInput>>) {
  const candidate = input.development.configurations[0]!
  const partition = {
    foundation: input.development.foundation,
    candidate: candidate.metrics,
    bootstrapLowerBounds: candidate.bootstrapLowerBounds,
    gates: { ...candidate.gates, privacy: true, determinism: true, resource: true }
  }
  return {
    schemaVersion: 1, evaluationVersion: input.plan.evaluationVersion,
    decisionId: input.lock.decisionId, status: 'final',
    artifactHashes: {
      ...input.plan.artifactHashes,
      decisionPlanSha256: memoryFeedbackTiebreakerArtifactSha256(input.plan),
      candidateLockSha256: memoryFeedbackTiebreakerArtifactSha256(input.lock)
    },
    selectedCandidateId: input.lock.selectedCandidateId, holdoutRunCount: 1,
    development: partition, holdout: partition, decision: 'no-go',
    reasons: ['Synthetic persistence test; not scored holdout evidence.']
  }
}

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
