/** @vitest-environment jsdom */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrajectoryPage, TrajectorySummary } from '../../agent/trajectory'

const trajectoryMock = vi.hoisted(() => ({
  fetchTrajectoryPage: vi.fn(),
  fetchTrajectorySummary: vi.fn()
}))

vi.mock('../../agent/trajectory', () => trajectoryMock)

import { useTrajectoryData } from './useTrajectoryData'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

function summary(): TrajectorySummary {
  return {
    schemaVersion: 2,
    requestCount: 0,
    toolCount: 0,
    runningCount: 1,
    failedCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheHitRate: null,
    avgTtftMs: null,
    avgTokensPerSecond: null,
    totalDurationMs: 0,
    costUsd: 0,
    costCny: 0,
    valueEstimateUsd: 0,
    valueEstimateCny: 0,
    lastStatus: 'running'
  }
}

function page(): TrajectoryPage {
  return {
    schemaVersion: 2,
    records: [],
    summary: summary(),
    warnings: [],
    historyIncomplete: false
  }
}

function Probe({ visible }: { visible: boolean }): ReactElement | null {
  useTrajectoryData({
    threadId: 'thread-1',
    visible,
    threadRunning: true,
    filter: 'all',
    query: ''
  })
  return null
}

function setReactActEnvironment(value: boolean): void {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = value
}

describe('useTrajectoryData polling', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    setReactActEnvironment(true)
    trajectoryMock.fetchTrajectoryPage.mockReset()
    trajectoryMock.fetchTrajectorySummary.mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    setReactActEnvironment(false)
    vi.useRealTimers()
  })

  it('coalesces hidden summary polls while the previous request is in flight', async () => {
    const pending = deferred<TrajectorySummary>()
    trajectoryMock.fetchTrajectorySummary.mockReturnValue(pending.promise)

    await act(async () => root.render(createElement(Probe, { visible: false })))
    expect(trajectoryMock.fetchTrajectorySummary).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTimeAsync(5_000))
    expect(trajectoryMock.fetchTrajectorySummary).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve(summary()))
  })

  it('uses the trajectory page as the visible summary and coalesces page polls', async () => {
    const pending = deferred<TrajectoryPage>()
    trajectoryMock.fetchTrajectoryPage.mockReturnValue(pending.promise)

    await act(async () => root.render(createElement(Probe, { visible: true })))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(trajectoryMock.fetchTrajectorySummary).not.toHaveBeenCalled()
    expect(trajectoryMock.fetchTrajectoryPage).toHaveBeenCalledTimes(1)

    await act(async () => vi.advanceTimersByTimeAsync(5_000))
    expect(trajectoryMock.fetchTrajectoryPage).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve(page()))
  })
})
