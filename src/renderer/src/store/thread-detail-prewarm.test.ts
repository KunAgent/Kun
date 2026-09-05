import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread, ThreadDetail } from '../agent/types'
import {
  cancelThreadPrewarm,
  getThreadPrewarmHandle,
  requestThreadPrewarm,
  resetThreadPrewarmState,
  THREAD_DETAIL_PREWARM_FAILURE_BACKOFF_MS,
  threadPrewarmHandleIsCurrent,
  threadPrewarmStats
} from './thread-detail-prewarm'
import {
  clearThreadSnapshotCache,
  getThreadSnapshot,
  invalidateThreadSnapshot,
  threadSnapshotFingerprint
} from './thread-snapshot-cache'
import { resetThreadRecoveryCoordinator } from './thread-recovery-coordinator'

const registryMock = vi.hoisted(() => ({ getProvider: vi.fn() }))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

function thread(id: string, overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-08-23T00:00:00.000Z',
    model: 'deepseek-chat',
    mode: 'agent',
    status: 'idle',
    ...overrides
  }
}

function detail(id: string): ThreadDetail {
  return {
    blocks: [{ kind: 'assistant', id: `${id}-answer`, text: id }],
    latestSeq: 1,
    threadStatus: 'idle',
    payloadBytes: 100
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('thread detail prewarm coordinator', () => {
  beforeEach(() => {
    clearThreadSnapshotCache()
    resetThreadPrewarmState()
    resetThreadRecoveryCoordinator()
    registryMock.getProvider.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetThreadPrewarmState()
    resetThreadRecoveryCoordinator()
    clearThreadSnapshotCache()
  })

  it('deduplicates requests and never runs more than two background loads', async () => {
    const pending = new Map<string, Deferred<ThreadDetail>>()
    const getThreadDetail = vi.fn((id: string) => {
      const job = deferred<ThreadDetail>()
      pending.set(id, job)
      return job.promise
    })
    registryMock.getProvider.mockReturnValue({ getThreadDetail })

    requestThreadPrewarm(thread('one'))
    requestThreadPrewarm(thread('two'))
    requestThreadPrewarm(thread('three'))
    requestThreadPrewarm(thread('three'))
    requestThreadPrewarm(thread('one'))

    expect(getThreadDetail).toHaveBeenCalledTimes(2)
    expect(threadPrewarmStats()).toEqual({ queued: 1, inFlight: 2, active: 2 })

    pending.get('one')!.resolve(detail('one'))
    await flushAsyncWork()

    expect(getThreadDetail).toHaveBeenCalledTimes(3)
    expect(getThreadDetail).toHaveBeenLastCalledWith('three', expect.objectContaining({
      priority: 'background', signal: expect.any(AbortSignal)
    }))
    expect(threadPrewarmStats().active).toBe(2)

    pending.get('two')!.resolve(detail('two'))
    pending.get('three')!.resolve(detail('three'))
    await flushAsyncWork()

    expect(threadPrewarmStats()).toEqual({ queued: 0, inFlight: 0, active: 0 })
  })

  it('waits for dwell intent and cancels abandoned hover work', async () => {
    vi.useFakeTimers()
    const getThreadDetail = vi.fn(async (id: string) => detail(id))
    registryMock.getProvider.mockReturnValue({ getThreadDetail })
    const target = thread('dwell')

    requestThreadPrewarm(target, { dwell: true })
    await vi.advanceTimersByTimeAsync(249)
    expect(getThreadDetail).not.toHaveBeenCalled()
    cancelThreadPrewarm(target.id)
    await vi.advanceTimersByTimeAsync(1)
    expect(getThreadDetail).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('keeps a newer authoritative result when an older request lands last', async () => {
    const oldDetail = deferred<ThreadDetail>()
    const freshDetail = deferred<ThreadDetail>()
    const getThreadDetail = vi.fn()
      .mockImplementationOnce(() => oldDetail.promise)
      .mockImplementationOnce(() => freshDetail.promise)
    registryMock.getProvider.mockReturnValue({ getThreadDetail })
    const oldThread = thread('same', { updatedAt: '2026-08-23T00:00:00.000Z' })
    const freshThread = thread('same', {
      updatedAt: '2026-08-23T00:01:00.000Z',
      latestSeq: 2
    })

    requestThreadPrewarm(oldThread)
    requestThreadPrewarm(freshThread)
    expect(getThreadDetail).toHaveBeenCalledTimes(2)

    freshDetail.resolve(detail('fresh'))
    await flushAsyncWork()
    expect(getThreadSnapshot('same', threadSnapshotFingerprint(freshThread))?.blocks).toEqual([
      { kind: 'assistant', id: 'fresh-answer', text: 'fresh' }
    ])

    oldDetail.resolve(detail('old'))
    await flushAsyncWork()
    expect(getThreadSnapshot('same', threadSnapshotFingerprint(freshThread))?.blocks).toEqual([
      { kind: 'assistant', id: 'fresh-answer', text: 'fresh' }
    ])
  })

  it('isolates a background failure and continues warming queued conversations', async () => {
    const failed = deferred<ThreadDetail>()
    const next = deferred<ThreadDetail>()
    const queued = deferred<ThreadDetail>()
    const getThreadDetail = vi.fn()
      .mockImplementationOnce(() => failed.promise)
      .mockImplementationOnce(() => next.promise)
      .mockImplementationOnce(() => queued.promise)
    registryMock.getProvider.mockReturnValue({ getThreadDetail })

    requestThreadPrewarm(thread('failed'))
    requestThreadPrewarm(thread('next'))
    requestThreadPrewarm(thread('queued'))
    failed.reject(new Error('background failure'))
    await flushAsyncWork()

    expect(getThreadDetail).toHaveBeenCalledTimes(3)
    next.resolve(detail('next'))
    queued.resolve(detail('queued'))
    await flushAsyncWork()
    expect(getThreadSnapshot('queued')).not.toBeNull()
  })

  it('backs off repeated hover prewarms after a failed request', async () => {
    let now = 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const getThreadDetail = vi.fn(async () => {
      throw new Error('runtime overloaded')
    })
    registryMock.getProvider.mockReturnValue({ getThreadDetail })
    const target = thread('failed-hover')

    requestThreadPrewarm(target)
    await flushAsyncWork()
    requestThreadPrewarm(target)
    expect(getThreadDetail).toHaveBeenCalledTimes(1)

    now += THREAD_DETAIL_PREWARM_FAILURE_BACKOFF_MS
    requestThreadPrewarm(target)
    expect(getThreadDetail).toHaveBeenCalledTimes(2)
  })

  it('backs off when a successful detail response cannot be cached', async () => {
    const getThreadDetail = vi.fn(async (): Promise<ThreadDetail> => ({
      ...detail('became-running'),
      threadStatus: 'running'
    }))
    registryMock.getProvider.mockReturnValue({ getThreadDetail })
    const target = thread('became-running')

    requestThreadPrewarm(target)
    await flushAsyncWork()
    requestThreadPrewarm(target)

    expect(getThreadDetail).toHaveBeenCalledTimes(1)
    expect(getThreadSnapshot(target.id)).toBeNull()
  })

  it('exposes an in-flight prewarm as a revalidatable handle', async () => {
    const pending = deferred<ThreadDetail>()
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise) })
    const target = thread('handle')

    expect(getThreadPrewarmHandle(target)).toBeNull()

    requestThreadPrewarm(target)
    const handle = getThreadPrewarmHandle(target)
    expect(handle).not.toBeNull()
    expect(handle?.threadId).toBe('handle')
    expect(handle?.fingerprint).toBe(threadSnapshotFingerprint(target))
    expect(threadPrewarmHandleIsCurrent(handle!, target)).toBe(true)
    expect(threadPrewarmHandleIsCurrent(handle!, thread('other'))).toBe(false)
    expect(threadPrewarmHandleIsCurrent(handle!, null)).toBe(false)

    pending.resolve(detail('handle'))
    await flushAsyncWork()
    expect(getThreadPrewarmHandle(target)).toBeNull()
  })

  it('invalidates a prewarm handle when the fingerprint advances or the cache token expires', async () => {
    const pending = deferred<ThreadDetail>()
    registryMock.getProvider.mockReturnValue({
      getThreadDetail: vi.fn(() => pending.promise) })
    const target = thread('invalidate', { updatedAt: '2026-08-23T00:00:00.000Z' })

    requestThreadPrewarm(target)
    const handle = getThreadPrewarmHandle(target)!

    const advanced = thread('invalidate', {
      updatedAt: '2026-08-23T00:01:00.000Z',
      latestSeq: 2
    })
    expect(threadPrewarmHandleIsCurrent(handle, advanced)).toBe(false)

    const unchanged = thread('invalidate', { updatedAt: '2026-08-23T00:00:00.000Z' })
    invalidateThreadSnapshot('invalidate')
    expect(threadPrewarmHandleIsCurrent(handle, unchanged)).toBe(false)

    pending.resolve(detail('invalidate'))
    await flushAsyncWork()
  })
})
