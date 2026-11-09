import { describe, expect, it } from 'vitest'
import type { AdeDispatchRecord } from '@shared/ade-teams'
import type { ActivityRow } from '@shared/activity-row'
import { AgentDispatchIntentPublicSchema } from '@shared/agent-dispatch'
import { dispatchGroupElapsed, dispatchRollup, workerElapsed, workerProgress } from './agent-dispatch-card-model'

const START = '2026-10-22T02:00:00.000Z'
const FINISH = '2026-10-22T02:01:00.000Z'
const card = AgentDispatchIntentPublicSchema.parse({
  intentId: 'intent', kind: 'worker', state: 'running', revision: 1,
  source: { threadId: 'parent', turnId: 'turn', toolCallId: 'call', applicationSessionId: 'app' },
  policySnapshot: { approvalPolicy: 'never', sandboxMode: 'danger-full-access', approvalReviewer: 'user' },
  recommendation: { title: 'Batch', task: 'Work', agentId: 'kun', permissionMode: 'full-access', agentSelection: 'auto',
    assignments: [1, 2, 3].map((index) => ({ label: `Task ${index}`, agentId: 'kun' })) },
  startRequestId: 'start', createdAt: START, updatedAt: START,
  target: { workerIds: ['w1', 'w2', 'w3'], dispatchIds: ['d1', 'd2', 'd3'] }
})
const dispatch = (index: number, patch: Partial<AdeDispatchRecord> = {}): AdeDispatchRecord => ({
  dispatchId: `d${index}`, workerId: `w${index}`, teamId: 'parent', turnId: `t${index}`,
  title: `Task ${index}`, state: 'accepted', createdAt: START, updatedAt: START, ...patch
})
const activity = (turnId: string, state: 'working' | 'waiting' = 'working') => ({
  unitId: 'w1', threadId: 'w1', state, turnId, restoredUnconfirmed: false, waitingReason: 'approval', currentTool: 'read'
}) as ActivityRow

describe('worker dispatch progress projection', () => {
  it('counts execution independently from review and never counts queued/approval as working', () => {
    const records = [dispatch(1, { startedAt: START }), dispatch(2), dispatch(3, { state: 'completed', verdict: { status: 'rejected', checks: [] } })]
    const rows = { w1: activity('t1'), w2: { ...activity('t2', 'waiting'), unitId: 'w2', threadId: 'w2' } }
    const progresses = [0, 1, 2].map((index) => workerProgress(card, index, rows, records))
    expect(dispatchRollup(progresses)).toMatchObject({ working: 1, waiting: 1, done: 1, failed: 0, pending: 0 })
    expect(progresses[2].state).toBe('rejected')
    const queued = workerProgress(card, 1, {}, records)
    expect(queued.executionState).toBe('pending')
  })

  it('requires the original dispatch and matching live turn; a later worker_send cannot leak its tool', () => {
    expect(workerProgress(card, 0, { w1: activity('later') }, [dispatch(1)])).toMatchObject({ state: 'pending' })
    expect(workerProgress(card, 0, { w1: activity('later') }, [dispatch(1)])).not.toHaveProperty('detail')
    expect(workerProgress({ ...card, state: 'completed' }, 0, { w1: activity('later') }, [])).toMatchObject({ state: 'unknown' })
    expect(workerProgress(card, 0, { w1: { ...activity('t1'), restoredUnconfirmed: true } }, [dispatch(1)])).toMatchObject({ state: 'pending' })
  })

  it('keeps partial cancellation, refusal and skipped rows separate and non-navigable before launch', () => {
    const records = [dispatch(1, { state: 'completed' }), dispatch(2, { state: 'failed', prelaunchDisposition: 'refused', failureReason: 'No capacity' }),
      dispatch(3, { state: 'failed', prelaunchDisposition: 'skipped' })]
    const progresses = [0, 1, 2].map((index) => workerProgress(card, index, {}, records))
    expect(dispatchRollup(progresses)).toMatchObject({ done: 1, refused: 1, skipped: 1, cancelled: 0 })
    expect(progresses[1]).not.toHaveProperty('workerId')
    expect(progresses[2]).not.toHaveProperty('workerId')
    expect(workerProgress({ ...card, state: 'cancelled' }, 0, {}, [records[0]]).executionState).toBe('done')
    expect(workerProgress(card, 1, {}, [dispatch(2, { state: 'cancelled' })]).executionState).toBe('cancelled')
  })

  it('prefers the structured report, retains its outcome, then falls back to excerpt and failure reason', () => {
    const report = { summary: 'Reported summary', outcome: 'partial' as const, submittedAt: FINISH }
    const record = dispatch(1, { state: 'completed', workerReport: report, resultExcerpt: 'Excerpt', failureReason: 'Failure' })
    expect(workerProgress(card, 0, {}, [record])).toMatchObject({ summary: 'Reported summary', reportOutcome: 'partial', state: 'awaiting_review' })
    expect(workerProgress(card, 0, {}, [{ ...record, workerReport: undefined }]).summary).toBe('Excerpt')
    expect(workerProgress(card, 0, {}, [{ ...record, workerReport: undefined, resultExcerpt: undefined }]).summary).toBe('Failure')
  })

  it('ticks live time, freezes at finish, and refuses to infer timing from updatedAt', () => {
    const progress = workerProgress(card, 0, {}, [dispatch(1, { startedAt: START })])
    expect(workerElapsed(progress, Date.parse(FINISH))).toBe(60_000)
    const finished = workerProgress(card, 0, {}, [dispatch(1, { state: 'completed', startedAt: START, finishedAt: FINISH, updatedAt: '2026-10-23T00:00:00Z' })])
    expect(workerElapsed(finished, Date.now())).toBe(60_000)
    expect(workerElapsed(workerProgress(card, 0, {}, [dispatch(1, { state: 'completed' })]), Date.now())).toBeNull()
    expect(workerElapsed({ ...finished, startedAt: 'bad' }, Date.now())).toBeNull()
    expect(dispatchGroupElapsed([progress, finished], Date.parse(FINISH))).toBe(60_000)
    expect(dispatchGroupElapsed([progress, { ...finished, startedAt: undefined }], Date.now())).toBeNull()
  })
})
