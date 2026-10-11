import { describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DispatchRecord } from '../contracts/ade.js'
import { captureReviewRevision } from '../workspace-tasks/review-revision.js'
import { reconcileWorkerReviewActivity, refreshWorkerReviewActivity, workerReviewProjection } from './worker-review-activity.js'

const dispatch = (id: string, overrides: Partial<DispatchRecord> = {}): DispatchRecord => ({
  dispatchId: id, teamId: 'team', workerId: 'worker', parentTurnId: 'turn',
  title: id, task: 'implement', mode: 'queue', state: 'completed',
  verdict: { status: 'pending', checks: [] },
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  ...overrides
})

describe('workerReviewProjection', () => {
  it('keeps every unresolved dispatch visible even after a newer verdict', () => {
    expect(workerReviewProjection([
      dispatch('old', { verdict: { status: 'pending', checks: [] } }),
      dispatch('new', { verdict: { status: 'passed', checks: [] }, updatedAt: '2026-09-02T00:00:00Z' })
    ])).toEqual({ reviewRequired: true, reviewStatus: 'pending' })
  })

  it('does not turn cancelled or clean failed dispatches into reviews', () => {
    expect(workerReviewProjection([
      dispatch('cancelled', { state: 'cancelled' }),
      dispatch('failed', { state: 'failed', capture: {
        changedFiles: 0, insertions: 0, deletions: 0
      } })
    ])).toEqual({ reviewRequired: false })
  })

  it('retains quality review of partial changes after failure', () => {
    expect(workerReviewProjection([dispatch('failed', {
      state: 'failed', capture: { changedFiles: 1, insertions: 2, deletions: 0 }
    })])).toEqual({ reviewRequired: true, reviewStatus: 'pending' })
  })

  it('reconciles stored verdicts for worker activity after restart', async () => {
    const apply = vi.fn()
    const list = vi.fn(async () => [dispatch('done', { verdict: {
      status: 'waived', checks: [], decidedBy: 'user'
    } })])
    await reconcileWorkerReviewActivity({ list } as never, {
      list: () => [{ kind: 'worker', teamId: 'team', unitId: 'worker' }],
      apply
    } as never)
    expect(list).toHaveBeenCalledWith('team')
    expect(apply).toHaveBeenCalledWith('worker', {
      reviewRequired: true, reviewStatus: 'waived'
    }, 'runtime')
  })

  it('projects a decided verdict as stale when the working tree changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-worker-review-'))
    const git = (...args: string[]) => promisify(execFile)('git', ['-C', root, ...args])
    try {
      await git('init', '--quiet')
      await git('config', 'user.email', 'test@example.com')
      await git('config', 'user.name', 'Test')
      await writeFile(join(root, 'a.txt'), 'base\n')
      await git('add', 'a.txt')
      await git('commit', '--quiet', '-m', 'base')
      const revision = await captureReviewRevision('tws_one', root)
      const completed = dispatch('done', { verdict: {
        status: 'passed', checks: [], decidedBy: 'user', revision
      } })
      const apply = vi.fn()
      const deps = { listByWorker: async () => [completed] } as never
      const activity = { apply } as never
      const workspace = { workspaceId: 'tws_one', path: root }
      await refreshWorkerReviewActivity(deps, activity, 'team', 'worker', workspace)
      expect(apply).toHaveBeenLastCalledWith('worker', {
        reviewRequired: true, reviewStatus: 'passed'
      }, 'runtime')
      await writeFile(join(root, 'a.txt'), 'changed\n')
      await refreshWorkerReviewActivity(deps, activity, 'team', 'worker', workspace)
      expect(apply).toHaveBeenLastCalledWith('worker', {
        reviewRequired: true, reviewStatus: 'stale'
      }, 'runtime')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
