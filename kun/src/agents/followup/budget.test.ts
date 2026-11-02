import { afterEach, describe, expect, it, vi } from 'vitest'
import { CollaborationPolicySchema, CommitmentControlSchema } from '../../contracts/collaboration-followup.js'
import { assertBudget, consumeAttempt, rollBudget } from './budget.js'
import { FollowUpError } from './state.js'
import { followUpFixture, type FollowUpFixture } from './followup-test-support.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanups.splice(0).reverse()) await close() })

/** Real control/policy rows from a tracked commitment, so the helpers see production shapes. */
async function rows(f: FollowUpFixture) {
  await f.followUp.enable('agent-1', f.commitment.id, f.enable)
  const control = await f.store.get('commitment_control', f.commitment.id)
  const policyRef = (control!.value as { policyRef: string }).policyRef
  const policy = await f.store.get('collaboration_policy', policyRef)
  return { control: CommitmentControlSchema.parse(control!.value),
    policy: CollaborationPolicySchema.parse(policy!.value) }
}

const withLimits = (base: ReturnType<typeof CollaborationPolicySchema.parse>,
  limits: Partial<typeof base.limits>) =>
  CollaborationPolicySchema.parse({ ...base, limits: { ...base.limits, ...limits } })

const now = '2026-01-01T00:00:00.000Z'
const windowStart = '2026-01-01T00:00:00.000Z'
const windowEnd = '2026-01-02T00:00:00.000Z'

describe('follow-up budget', () => {
  it('refuses a new attempt once the daily allowance is spent', async () => {
    const f = await followUpFixture(); cleanups.push(f.cleanup)
    const { control, policy: base } = await rows(f)
    const policy = withLimits(base, { attemptsPerDay: 2, attemptsTotal: 9, minimumIntervalMs: 1000 })
    const spent = CommitmentControlSchema.parse({ ...control, budget: { ...control.budget,
      windowStart, windowEnd, consumed: 2, totalConsumed: 2 } })
    expect(() => assertBudget(policy, control, now)).not.toThrow()
    expect(() => assertBudget(policy, spent, now)).toThrow(FollowUpError)
    expect(() => assertBudget(policy, spent, now)).toThrow(/daily/)
  })

  it('refuses once the lifetime total is reached even in a fresh window', async () => {
    const f = await followUpFixture(); cleanups.push(f.cleanup)
    const { control, policy: base } = await rows(f)
    const policy = withLimits(base, { attemptsPerDay: 5, attemptsTotal: 2, minimumIntervalMs: 1000 })
    const spent = CommitmentControlSchema.parse({ ...control, budget: { ...control.budget,
      windowStart, windowEnd, consumed: 0, totalConsumed: 2 } })
    expect(() => assertBudget(policy, spent, now)).toThrow(/total/)
  })

  it('enforces the minimum interval between attempts', async () => {
    const f = await followUpFixture(); cleanups.push(f.cleanup)
    const { control, policy: base } = await rows(f)
    const policy = withLimits(base, { attemptsPerDay: 5, attemptsTotal: 9, minimumIntervalMs: 60_000 })
    const budget = { ...control.budget, windowStart, windowEnd, consumed: 1, totalConsumed: 1,
      lastAttemptAt: '2026-01-01T00:04:30.000Z' }
    const row = CommitmentControlSchema.parse({ ...control, budget })
    expect(() => assertBudget(policy, row, '2026-01-01T00:05:00.000Z')).toThrow(/minimum interval/)
    expect(() => assertBudget(policy, row, '2026-01-01T00:06:00.000Z')).not.toThrow()
  })

  it('rolls the window forward and resets only the per-window count', () => {
    const rolled = rollBudget({ windowStart, windowEnd, reserved: 0, consumed: 3, totalConsumed: 9 },
      '2026-01-02T00:00:01.000Z')
    expect(rolled).toMatchObject({ consumed: 0, totalConsumed: 9 })
    expect(rolled.windowEnd > windowEnd).toBe(true)
    // Inside the window nothing moves.
    expect(rollBudget({ windowStart, windowEnd, reserved: 0, consumed: 3, totalConsumed: 9 }, now).consumed).toBe(3)
  })

  it('spends exactly one attempt per dispatch and keeps the lifetime total monotonic', async () => {
    const f = await followUpFixture(); cleanups.push(f.cleanup)
    const { control } = await rows(f)
    const spent = CommitmentControlSchema.parse(consumeAttempt(control, now))
    expect(spent.budget).toMatchObject({ consumed: control.budget.consumed + 1,
      totalConsumed: control.budget.totalConsumed + 1, lastAttemptAt: now })
    expect(spent.updatedAt).toBe(now)
  })

  it('resets the daily count on rollover but never the lifetime total', async () => {
    const f = await followUpFixture(); cleanups.push(f.cleanup)
    const { control } = await rows(f)
    const earlier = CommitmentControlSchema.parse({ ...control, budget: { ...control.budget,
      windowStart: '2025-12-31T00:00:00.000Z', windowEnd: '2026-01-01T00:00:00.000Z',
      consumed: 5, totalConsumed: 5 } })
    const spent = CommitmentControlSchema.parse(consumeAttempt(earlier, '2026-01-01T00:00:30.000Z'))
    expect(spent.budget).toMatchObject({ consumed: 1, totalConsumed: 6 })
    expect(spent.budget.windowStart).toBe('2026-01-01T00:00:30.000Z')
  })
})
