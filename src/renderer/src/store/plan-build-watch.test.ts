import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityRow } from '@shared/activity-row'

const providerMock = vi.hoisted(() => ({
  getActivitySnapshot: vi.fn(),
  pollActivity: vi.fn()
}))
const loadDiffMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('../agent/registry', () => ({ getProvider: () => providerMock }))
vi.mock('./review-store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./review-store')>()
  return { ...mod, loadWorkspaceDiff: loadDiffMock }
})

import {
  takePlanBuildReview,
  watchPlanBuildReview
} from './plan-build-watch'

function settledRow(unitId: string): ActivityRow {
  return {
    unitId,
    mainState: 'idle',
    lastOutcome: 'completed'
  } as unknown as ActivityRow
}

function runningRow(unitId: string): ActivityRow {
  return { unitId, mainState: 'running' } as unknown as ActivityRow
}

describe('watchPlanBuildReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerMock.pollActivity.mockImplementation(async () => new Promise(() => {}))
  })

  it('flags the thread when the build row settles via a poll change', async () => {
    providerMock.getActivitySnapshot.mockResolvedValue({
      cursor: 'c0',
      rows: [runningRow('thr_build')]
    })
    providerMock.pollActivity.mockResolvedValueOnce({
      type: 'activity',
      cursor: 'c1',
      changes: [{ unitId: 'thr_build', row: settledRow('thr_build') }]
    })
    watchPlanBuildReview('ws_1', 'thr_build')
    await vi.waitFor(() => {
      expect(takePlanBuildReview('thr_build')).toBe('ws_1')
    })
    expect(loadDiffMock).toHaveBeenCalledWith('ws_1')
    expect(takePlanBuildReview('thr_build')).toBeNull()
  })

  it('flags immediately when the row already settled before the watch started', async () => {
    providerMock.getActivitySnapshot.mockResolvedValue({
      cursor: 'c0',
      rows: [settledRow('thr_build')]
    })
    watchPlanBuildReview('ws_1', 'thr_build')
    await vi.waitFor(() => {
      expect(takePlanBuildReview('thr_build')).toBe('ws_1')
    })
    expect(providerMock.pollActivity).not.toHaveBeenCalled()
  })

  it('ignores settles for other units and keeps watching', async () => {
    providerMock.getActivitySnapshot.mockResolvedValue({ cursor: 'c0', rows: [] })
    providerMock.pollActivity
      .mockResolvedValueOnce({
        type: 'activity',
        cursor: 'c1',
        changes: [{ unitId: 'other', row: settledRow('other') }]
      })
      .mockResolvedValueOnce({
        type: 'activity',
        cursor: 'c2',
        changes: [{ unitId: 'thr_build', row: settledRow('thr_build') }]
      })
    watchPlanBuildReview('ws_2', 'thr_build')
    await vi.waitFor(() => {
      expect(takePlanBuildReview('thr_build')).toBe('ws_2')
    })
  })

  it('is a no-op without an activity provider surface', async () => {
    ;(providerMock as Record<string, unknown>).getActivitySnapshot = undefined
    watchPlanBuildReview('ws_1', 'thr_x')
    await Promise.resolve()
    expect(takePlanBuildReview('thr_x')).toBeNull()
    providerMock.getActivitySnapshot = vi.fn()
  })
})
