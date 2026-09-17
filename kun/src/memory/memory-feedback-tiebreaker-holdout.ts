import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MemoryFeedbackTiebreakerEvidence,
  memoryFeedbackTiebreakerArtifactSha256,
  type MemoryFeedbackTiebreakerCalibration,
  type MemoryFeedbackTiebreakerDevelopmentArtifactValue,
  type MemoryFeedbackTiebreakerLock,
  type MemoryFeedbackTiebreakerPlan
} from './memory-feedback-tiebreaker-contracts.js'
import { evaluateMemoryFeedbackTiebreakerGates } from './memory-feedback-tiebreaker-gates.js'
import { assertMemoryFeedbackTiebreakerPrivateArtifact } from './memory-feedback-tiebreaker-privacy.js'
import { validateMemoryFeedbackTiebreakerCandidateLock } from './memory-feedback-tiebreaker-lock.js'

export function runLockedMemoryFeedbackTiebreakerHoldout<T>(input: {
  lock: MemoryFeedbackTiebreakerLock
  plan: MemoryFeedbackTiebreakerPlan
  calibration: MemoryFeedbackTiebreakerCalibration
  development: MemoryFeedbackTiebreakerDevelopmentArtifactValue
  lockedAt: string
  independentReviewConfirmed: boolean
  evidenceExists: boolean
  evaluate: (selectedCandidateId: string) => T
}): T {
  const lock = validateMemoryFeedbackTiebreakerCandidateLock(input)
  if (!input.independentReviewConfirmed) {
    throw new Error('memory feedback tiebreaker holdout requires independent lock review')
  }
  if (input.evidenceExists) {
    throw new Error('memory feedback tiebreaker holdout evidence already exists')
  }
  return input.evaluate(lock.selectedCandidateId)
}

// Use one fixed output directory per decision registry. An empty/partial file is
// a consumed attempt after failure, not permission to rerun or delete evidence.
export async function persistLockedMemoryFeedbackTiebreakerHoldout(input: Omit<
  Parameters<typeof runLockedMemoryFeedbackTiebreakerHoldout>[0],
  'evidenceExists' | 'evaluate'
> & {
  outputDirectory: string
  evaluate: (selectedCandidateId: string) => unknown | Promise<unknown>
}) {
  const selectedCandidateId = runLockedMemoryFeedbackTiebreakerHoldout({
    ...input, evidenceExists: false, evaluate: (id) => id
  })
  await mkdir(input.outputDirectory, { recursive: true })
  const path = join(input.outputDirectory, `${input.lock.decisionId}.json`)
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.sync()
    const evidence = MemoryFeedbackTiebreakerEvidence.parse(await input.evaluate(selectedCandidateId))
    const expectedHashes = {
      ...input.plan.artifactHashes,
      decisionPlanSha256: memoryFeedbackTiebreakerArtifactSha256(input.plan),
      candidateLockSha256: memoryFeedbackTiebreakerArtifactSha256(input.lock)
    }
    if (evidence.decisionId !== input.lock.decisionId || evidence.selectedCandidateId !== selectedCandidateId ||
        memoryFeedbackTiebreakerArtifactSha256(evidence.artifactHashes) !==
        memoryFeedbackTiebreakerArtifactSha256(expectedHashes)) {
      throw new Error('memory feedback tiebreaker evidence does not match lock')
    }
    for (const partition of [evidence.development, evidence.holdout]) {
      const recomputed = evaluateMemoryFeedbackTiebreakerGates(partition.foundation, {
        metrics: partition.candidate, bootstrapLowerBounds: partition.bootstrapLowerBounds
      }, input.plan)
      const { privacy, determinism, resource } = partition.gates
      const expected = { ...recomputed, privacy, determinism, resource,
        passed: recomputed.passed && privacy && determinism && resource }
      if (memoryFeedbackTiebreakerArtifactSha256(expected) !==
          memoryFeedbackTiebreakerArtifactSha256(partition.gates)) {
        throw new Error('memory feedback tiebreaker evidence gates disagree with metrics')
      }
    }
    const decision = evidence.development.gates.passed && evidence.holdout.gates.passed ? 'go' : 'no-go'
    if (evidence.decision !== decision) throw new Error('memory feedback tiebreaker decision disagrees with gates')
    assertMemoryFeedbackTiebreakerPrivateArtifact(evidence)
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`
    if (Buffer.byteLength(serialized) > input.plan.gates.resource.maximumEvidenceBytes) {
      throw new Error('memory feedback tiebreaker evidence exceeds byte limit')
    }
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
    return evidence
  } finally {
    await handle.close()
  }
}
