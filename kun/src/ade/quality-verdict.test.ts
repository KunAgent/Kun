import { describe, expect, it } from 'vitest'
import {
  managerCtx,
  NOW,
  seedDispatch,
  seedWorker,
  setupAdeStores,
  teardownAdeStores,
  makeHarness,
  type AdeStores
} from './manager-controls-test-support.js'

/** Verdict rules: 10 §4 — independence, supersede, user lock, reviewer merge. */

async function seeded(): Promise<AdeStores> {
  const stores = await setupAdeStores()
  await seedWorker(stores)
  await seedDispatch(stores, {
    dispatchId: 'dsp_done',
    state: 'completed',
    outcome: 'completed'
  })
  return stores
}

describe('QualityVerdicts.setVerdict', () => {
  it('records a manager verdict without touching execution state', async () => {
    const stores = await seeded()
    try {
      const { verdicts, activity } = makeHarness(stores)
      const result = await verdicts.workerVerdict(managerCtx(), {
        dispatchId: 'dsp_done',
        status: 'needs_changes',
        notes: 'missing tests'
      })
      expect(result.ok).toBe(true)
      const dispatch = await stores.dispatches.get('thr_mgr', 'dsp_done')
      // Acceptance is separate from execution (10 §4.1): state stays completed.
      expect(dispatch?.state).toBe('completed')
      expect(dispatch?.verdict).toMatchObject({
        status: 'needs_changes',
        decidedBy: 'manager',
        notes: 'missing tests',
        checks: []
      })
      expect(dispatch?.verdict?.decidedAt).toBeTruthy()
      expect(dispatch?.verdict?.revision).toMatchObject({
        completeness: 'incomplete', reason: 'git_unavailable'
      })
      expect(activity.apply).toHaveBeenCalledWith('wrk_1', {
        reviewRequired: true,
        reviewStatus: 'needs_changes'
      }, 'runtime')
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('supersedes a manager verdict when the user decides', async () => {
    const stores = await seeded()
    try {
      const { verdicts } = makeHarness(stores)
      await verdicts.workerVerdict(managerCtx(), {
        dispatchId: 'dsp_done',
        status: 'needs_changes',
        notes: 'manager says fix'
      })
      const result = await verdicts.setVerdict({
        dispatchId: 'dsp_done',
        status: 'passed',
        decidedBy: 'user',
        notes: 'good enough'
      })
      expect(result.ok).toBe(true)
      const verdict = result.verdict!
      expect(verdict).toMatchObject({ status: 'passed', decidedBy: 'user' })
      // Both decisions stay on record (10 §4.2).
      expect(verdict.superseded).toMatchObject([
        {
          status: 'needs_changes',
          decidedBy: 'manager',
          notes: 'manager says fix',
          decidedAt: expect.any(String)
        }
      ])
      expect(verdict.superseded?.[0]?.revision).toMatchObject({ completeness: 'incomplete' })
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('locks out manager writes after a user verdict but lets the user re-decide', async () => {
    const stores = await seeded()
    try {
      const { verdicts } = makeHarness(stores)
      await verdicts.setVerdict({ dispatchId: 'dsp_done', status: 'rejected', decidedBy: 'user' })
      const locked = await verdicts.workerVerdict(managerCtx(), {
        dispatchId: 'dsp_done',
        status: 'passed'
      })
      expect(locked).toMatchObject({ ok: false, refusal: 'user_verdict_locked' })
      let verdict = (await stores.dispatches.get('thr_mgr', 'dsp_done'))!.verdict!
      expect(verdict.status).toBe('rejected')

      const again = await verdicts.setVerdict({
        dispatchId: 'dsp_done',
        status: 'waived',
        decidedBy: 'user'
      })
      expect(again.ok).toBe(true)
      verdict = again.verdict!
      expect(verdict.status).toBe('waived')
      expect(verdict.superseded?.[0]?.status).toBe('rejected')
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('carries reviewer linkage and checks across a new decision', async () => {
    const stores = await seeded()
    try {
      const { verdicts } = makeHarness(stores)
      await verdicts.mergeReviewerFindings({
        teamId: 'thr_mgr',
        dispatchId: 'dsp_done',
        reviewerWorkerId: 'wrk_rev',
        report: {
          summary: 'found a bug',
          outcome: 'failed',
          checks: [{ name: 'null-check', status: 'failed', detail: 'a.ts:9' }],
          risks: [],
          submittedAt: NOW
        }
      })
      const result = await verdicts.setVerdict({
        dispatchId: 'dsp_done',
        status: 'needs_changes',
        decidedBy: 'manager'
      })
      expect(result.verdict?.reviewerWorkerId).toBe('wrk_rev')
      expect(result.verdict?.checks).toEqual([
        { name: 'null-check', status: 'failed', detail: 'a.ts:9', source: 'reviewer' }
      ])
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('returns dispatch_not_found for an unknown dispatch id', async () => {
    const stores = await seeded()
    try {
      const { verdicts } = makeHarness(stores)
      const result = await verdicts.workerVerdict(managerCtx(), {
        dispatchId: 'dsp_ghost',
        status: 'passed'
      })
      expect(result).toMatchObject({ ok: false, refusal: 'dispatch_not_found' })
    } finally {
      await teardownAdeStores(stores)
    }
  })
})

describe('QualityVerdicts.mergeReviewerFindings', () => {
  it('merges checks and risks as reviewer-sourced checks, preserving status', async () => {
    const stores = await seeded()
    try {
      const { verdicts } = makeHarness(stores)
      await verdicts.setVerdict({ dispatchId: 'dsp_done', status: 'passed', decidedBy: 'user' })
      const verdict = await verdicts.mergeReviewerFindings({
        teamId: 'thr_mgr',
        dispatchId: 'dsp_done',
        reviewerWorkerId: 'wrk_rev',
        report: {
          summary: 'lgtm but risky',
          outcome: 'succeeded',
          checks: [
            { name: 'style', status: 'passed' },
            { name: 'edge-case', status: 'failed', detail: 'empty input' }
          ],
          risks: ['no rollback plan'],
          submittedAt: NOW
        }
      })
      // The reviewer never decides — user verdict stays (10 §5).
      expect(verdict).toMatchObject({
        status: 'passed',
        decidedBy: 'user',
        reviewerWorkerId: 'wrk_rev'
      })
      expect(verdict?.checks).toEqual([
        { name: 'style', status: 'passed', source: 'reviewer' },
        { name: 'edge-case', status: 'failed', detail: 'empty input', source: 'reviewer' },
        { name: 'risk', status: 'failed', source: 'reviewer', detail: 'no rollback plan' }
      ])
    } finally {
      await teardownAdeStores(stores)
    }
  })

  it('initializes a pending verdict when the dispatch has none', async () => {
    const stores = await setupAdeStores()
    try {
      await seedWorker(stores)
      // A raw store write can produce a dispatch without the verdict field.
      await seedDispatch(stores, { dispatchId: 'dsp_raw', state: 'completed', verdict: undefined })
      const { verdicts } = makeHarness(stores)
      const verdict = await verdicts.mergeReviewerFindings({
        teamId: 'thr_mgr',
        dispatchId: 'dsp_raw',
        reviewerWorkerId: 'wrk_rev',
        report: { summary: 'ok', outcome: 'succeeded', checks: [], risks: [], submittedAt: NOW }
      })
      expect(verdict).toMatchObject({ status: 'pending', reviewerWorkerId: 'wrk_rev' })
    } finally {
      await teardownAdeStores(stores)
    }
  })
})

describe('QualityVerdicts.teamForDispatch', () => {
  it('resolves the owning team for the verdict route', async () => {
    const stores = await seeded()
    try {
      const { verdicts } = makeHarness(stores)
      expect(await verdicts.teamForDispatch('dsp_done')).toBe('thr_mgr')
      expect(await verdicts.teamForDispatch('dsp_ghost')).toBeNull()
    } finally {
      await teardownAdeStores(stores)
    }
  })
})
