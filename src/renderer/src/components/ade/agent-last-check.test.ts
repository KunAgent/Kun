import { describe, expect, it } from 'vitest'
import type { AdeHarnessReadiness } from '@shared/ade-harnesses'
import { checkFromProof, newestCheck, type LastCheck } from './agent-last-check'

const readiness = (checkedAt: string): AdeHarnessReadiness => ({ profileKey: 'k', usable: true, authentication: 'unverified', checks: [], checkedAt })
const failure = (at: number, profileKey = 'k'): LastCheck => ({ error: 'agentEnablement.failed', errorDetail: '', at, profileKey })

describe('last readiness check', () => {
  it('takes the time of a check the runtime kept with its proof', () => {
    expect(checkFromProof(readiness('2026-10-08T10:00:00.000Z'), 'k')).toMatchObject({ at: Date.parse('2026-10-08T10:00:00.000Z'), error: '' })
    expect(checkFromProof(readiness('not a date'), 'k').at).toBe(0)
  })

  it('shows the newest check, so a later proof replaces an older failure and the reverse', () => {
    const proof = checkFromProof(readiness('2026-10-08T10:00:00.000Z'), 'k')
    expect(newestCheck('k', failure(proof.at - 1), proof)).toBe(proof)
    const later = failure(proof.at + 5_000)
    expect(newestCheck('k', later, proof)).toBe(later)
  })

  it('never shows a check made for another connection', () => {
    expect(newestCheck('k', failure(10, 'other'))).toBeUndefined()
    expect(newestCheck('k', undefined, undefined)).toBeUndefined()
  })
})
