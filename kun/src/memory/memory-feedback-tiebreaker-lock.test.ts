import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MemoryFeedbackTiebreakerCalibrationReport,
  MemoryFeedbackTiebreakerCandidateLock,
  MemoryFeedbackTiebreakerDecisionPlan,
  MemoryFeedbackTiebreakerDevelopmentArtifact
} from './memory-feedback-tiebreaker-contracts.js'
import {
  createMemoryFeedbackTiebreakerCandidateLock,
  validateMemoryFeedbackTiebreakerCandidateLock
} from './memory-feedback-tiebreaker-lock.js'

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))

describe('memory feedback tiebreaker candidate lock', () => {
  it('rejects an internally inconsistent passing flag before creating a lock', async () => {
    const input = await loadInput()
    input.development.configurations[4]!.gates.passed = true
    expect(() => createMemoryFeedbackTiebreakerCandidateLock(input))
      .toThrow(/gates disagree with metrics/u)
  })

  it('rejects omitted, duplicated, reordered or redefined configurations', async () => {
    for (const mutation of ['omit', 'duplicate', 'reorder', 'gap', 'signal'] as const) {
      const input = await loadInput()
      const configs = input.development.configurations
      if (mutation === 'omit') configs.pop()
      if (mutation === 'duplicate') configs[1] = configs[0]!
      if (mutation === 'reorder') configs.reverse()
      if (mutation === 'gap') configs[1]!.maximumGap = 0.9
      if (mutation === 'signal') configs[1]!.signalRule = 'foundation-only'
      expect(() => createMemoryFeedbackTiebreakerCandidateLock(input))
        .toThrow(/candidate grid mismatch/u)
    }
  })

  it('uses the pre-registered fallback when no development candidate passes every gate', async () => {
    const input = await loadInput()
    const lock = createMemoryFeedbackTiebreakerCandidateLock(input)

    expect(lock.selectedCandidateId).toBe('foundation-control')
    expect(lock.gates).toEqual(input.plan.gates)
    expect(lock.holdoutRunLimit).toBe(1)
    expect(validateMemoryFeedbackTiebreakerCandidateLock({ lock, ...input })).toEqual(lock)
  })

  it('rejects a lock after any development dependency is tampered with', async () => {
    const input = await loadInput()
    const lock = createMemoryFeedbackTiebreakerCandidateLock(input)
    const tampered = {
      ...input.development,
      configurations: input.development.configurations.map((candidate, index) => index === 0
        ? { ...candidate, selectedIdsSha256: 'f'.repeat(64) }
        : candidate)
    }

    expect(() => validateMemoryFeedbackTiebreakerCandidateLock({
      lock,
      ...input,
      development: tampered
    })).toThrow(/does not match its dependencies/u)
  })

  it('matches the frozen candidate lock', async () => {
    const input = await loadInput()
    const frozen = MemoryFeedbackTiebreakerCandidateLock.parse(JSON.parse(await readFile(
      fixturePath('memory-feedback-tiebreaker-lock.v1.json'),
      'utf8'
    )))

    expect(frozen).toEqual(createMemoryFeedbackTiebreakerCandidateLock(input))
  })
})

async function loadInput() {
  const [calibrationText, planText, developmentText] = await Promise.all([
    readFile(fixturePath('memory-feedback-tiebreaker-calibration.v1.json'), 'utf8'),
    readFile(fixturePath('memory-feedback-tiebreaker-plan.v1.json'), 'utf8'),
    readFile(fixturePath('memory-feedback-tiebreaker-development.v1.json'), 'utf8')
  ])
  return {
    calibration: MemoryFeedbackTiebreakerCalibrationReport.parse(JSON.parse(calibrationText)),
    plan: MemoryFeedbackTiebreakerDecisionPlan.parse(JSON.parse(planText)),
    development: MemoryFeedbackTiebreakerDevelopmentArtifact.parse(JSON.parse(developmentText)),
    lockedAt: '2026-09-16T00:00:00.000Z'
  }
}
