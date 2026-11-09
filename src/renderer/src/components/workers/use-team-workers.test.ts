import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeTeamOverview } from '@shared/ade-teams'
import { useTeamWorkers } from './use-team-workers'

const mocks = vi.hoisted(() => ({ provider: vi.fn(), request: vi.fn(), rows: {} }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({ getTeamOverview: mocks.provider }) }))
vi.mock('../../agent/runtime-client', () => ({ rendererRuntimeClient: { runtimeRequest: mocks.request } }))
vi.mock('../../store/activity-store', () => ({ useActivityStore: (select: (state: unknown) => unknown) => select({ rows: mocks.rows }) }))
let renderer: ReactTestRenderer | undefined
let current: ReturnType<typeof useTeamWorkers>
function Probe(props: { manager?: string; active?: boolean; ids?: readonly string[] }) {
  current = useTeamWorkers(props.manager ?? 'parent', props.active ?? true, props.ids)
  return null
}
function overview(title: string): AdeTeamOverview {
  return { team: { teamId: 'parent', managerThreadId: 'parent', workers: [], title }, dispatches: [], questions: [], races: [] } as unknown as AdeTeamOverview
}
const response = (title: string) => ({ ok: true, status: 200, body: JSON.stringify(overview(title)) })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.provider.mockReset().mockResolvedValue(overview('default'))
  mocks.request.mockReset().mockResolvedValue(response('selected'))
})
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount())
  renderer = undefined
  vi.useRealTimers()
})
async function mount(ids?: readonly string[]) {
  await act(async () => { renderer = create(createElement(Probe, { ids })) })
}

describe('team worker dispatch scope', () => {
  it('keeps default callers on the provider path and encodes explicit empty/bounded selections', async () => {
    await mount()
    expect(mocks.provider).toHaveBeenCalledWith('parent')
    expect(mocks.request).not.toHaveBeenCalled()
    await act(async () => { renderer!.update(createElement(Probe, { ids: [] })) })
    expect(new URL(mocks.request.mock.lastCall![0], 'http://local').searchParams.get('dispatchIds')).toBe('[]')
    await act(async () => { renderer!.update(createElement(Probe, { ids: ['d2', 'd1', 'd1'] })) })
    const count = mocks.request.mock.calls.length
    expect(new URL(mocks.request.mock.lastCall![0], 'http://local').searchParams.get('dispatchIds')).toBe('["d1","d2"]')
    await act(async () => { renderer!.update(createElement(Probe, { ids: ['d1', 'd2'] })) })
    expect(mocks.request).toHaveBeenCalledTimes(count)
    await act(async () => { await current.reload() })
    expect(new URL(mocks.request.mock.lastCall![0], 'http://local').searchParams.get('dispatchIds')).toBe('["d1","d2"]')
  })

  it.each(['resolve', 'reject'] as const)('ignores an old same-manager request that later %s', async (settlement) => {
    const old = deferred<ReturnType<typeof response>>()
    const next = deferred<ReturnType<typeof response>>()
    mocks.request.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    await mount(['old'])
    await act(async () => { renderer!.update(createElement(Probe, { ids: ['new'] })) })
    expect(current.overview).toBeNull()
    expect(current.loaded).toBe(false)
    await act(async () => { next.resolve(response('new')) })
    const latest = current.overview
    await act(async () => {
      if (settlement === 'resolve') old.resolve(response('old'))
      else old.reject(new Error('Old request failed'))
    })
    expect(current.overview).toBe(latest)
    expect(current.loadFailed).toBe(false)
    expect(current.loaded).toBe(true)
  })

  it('hides stale scoped results while inactive and cannot commit a late response after unmount', async () => {
    const pending = deferred<ReturnType<typeof response>>()
    mocks.request.mockReturnValueOnce(pending.promise)
    await mount(['old'])
    await act(async () => { renderer!.update(createElement(Probe, { ids: ['old'], active: false })) })
    await act(async () => { pending.resolve(response('old')) })
    expect(current.overview).toBeNull()
    expect(current.loaded).toBe(false)
    await act(async () => { renderer!.unmount() })
    renderer = undefined
  })

  it('lets a slow request settle despite several poll ticks, then stops polling settled history', async () => {
    const live = { ...overview('live'), dispatches: [{ dispatchId: 'old', workerId: 'w1', teamId: 'parent',
      title: 'Work', state: 'accepted', createdAt: '', updatedAt: '' }] }
    const slow = deferred<ReturnType<typeof response>>()
    mocks.request.mockResolvedValueOnce({ ...response('live'), body: JSON.stringify(live) }).mockReturnValueOnce(slow.promise)
    await mount(['old'])
    await act(async () => { vi.advanceTimersByTime(800) })
    expect(mocks.request).toHaveBeenCalledTimes(2)
    await act(async () => { vi.advanceTimersByTime(6_000) })
    expect(mocks.request).toHaveBeenCalledTimes(2)
    await act(async () => { slow.resolve({ ...response('finished'), body: JSON.stringify({ ...live,
      dispatches: live.dispatches.map((entry) => ({ ...entry, state: 'completed' })) }) }) })
    expect(current.overview?.dispatches[0].state).toBe('completed')
    expect(current.loadFailed).toBe(false)
    await act(async () => { vi.advanceTimersByTime(6_000) })
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh request when reactivated while the previous scope is still in flight', async () => {
    const old = deferred<ReturnType<typeof response>>()
    mocks.request.mockReturnValueOnce(old.promise)
    await mount(['old'])
    await act(async () => { renderer!.update(createElement(Probe, { ids: ['old'], active: false })) })
    await act(async () => { renderer!.update(createElement(Probe, { ids: ['old'], active: true })) })
    expect(mocks.request).toHaveBeenCalledTimes(2)
    expect(current.loaded).toBe(true)
    const latest = current.overview
    await act(async () => { old.resolve(response('outdated')) })
    expect(current.overview).toBe(latest)
  })

  it('exposes a refresh error and retries the same task selection', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Offline'))
    await mount(['old'])
    expect(current.loadFailed).toBe(true)
    await act(async () => { await current.reload() })
    expect(current.loadFailed).toBe(false)
    expect(current.loaded).toBe(true)
    expect(new URL(mocks.request.mock.lastCall![0], 'http://local').searchParams.get('dispatchIds')).toBe('["old"]')
  })
})
