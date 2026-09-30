import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEventSink } from '../../agent/provider-types'

const provider = vi.hoisted(() => ({ getThreadDetail: vi.fn(), subscribeThreadEvents: vi.fn(), interrupt: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => provider }))
import { useWorkerTranscript } from './use-worker-transcript'

let current: ReturnType<typeof useWorkerTranscript>
let renderer: ReactTestRenderer
let sink: ThreadEventSink
let signal: AbortSignal
function Consumer({ id }: { id: string }) {
  current = useWorkerTranscript(id, 'stable')
  return null
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  provider.getThreadDetail.mockResolvedValue({ blocks: [], latestSeq: 7 })
  provider.subscribeThreadEvents.mockImplementation((_id, _seq, receivedSink, receivedSignal) => {
    sink = receivedSink
    signal = receivedSignal
    return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
  })
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  vi.useRealTimers()
})
async function mount(id = 'worker'): Promise<void> {
  await act(async () => { renderer = create(createElement(Consumer, { id })) })
}

describe('visible worker transcript subscription', () => {
  it('subscribes from the worker snapshot cursor and coalesces streaming updates', async () => {
    await mount()
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith('worker', 7, expect.any(Object), expect.any(AbortSignal))
    provider.getThreadDetail.mockResolvedValue({ blocks: [], latestSeq: 9, liveProjection: { assistant: { text: 'worker output' } } })
    await act(async () => { for (let i = 0; i < 20; i += 1) sink.onDeltas([]) })
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(provider.getThreadDetail).toHaveBeenCalledTimes(2)
    expect(current.detail?.liveProjection?.assistant?.text).toBe('worker output')
    await act(async () => renderer.unmount())
    expect(signal.aborted).toBe(true)
    expect(provider.interrupt).not.toHaveBeenCalled()
  })

  it('does not retain older live windows unless the user explicitly paged into history', async () => {
    provider.getThreadDetail.mockResolvedValueOnce({ blocks: [{ id: 'old', kind: 'user', text: 'old window' }], latestSeq: 7 })
    await mount()
    provider.getThreadDetail.mockResolvedValue({ blocks: [{ id: 'new', kind: 'user', text: 'current window' }], latestSeq: 8 })
    await act(async () => { sink.onDeltas([]); await vi.advanceTimersByTimeAsync(600) })
    expect(current.detail?.blocks.map((block) => block.id)).toEqual(['new'])
  })

  it('loads earlier pages into only the selected worker', async () => {
    provider.getThreadDetail.mockResolvedValueOnce({
      blocks: [{ id: 'new', kind: 'user', text: 'recent' }], latestSeq: 7,
      historyCursor: 'older-page', hasMoreHistory: true
    }).mockResolvedValueOnce({ blocks: [{ id: 'old', kind: 'user', text: 'earlier' }], latestSeq: 7, hasMoreHistory: false })
    await mount()
    await act(async () => current.loadOlder())
    expect(provider.getThreadDetail).toHaveBeenLastCalledWith('worker', expect.objectContaining({ before: 'older-page' }))
    expect(current.detail?.blocks.map((block) => block.id)).toEqual(['old', 'new'])
    expect(current.detail?.hasMoreHistory).toBe(false)
  })

  it('discards a late response after the preview changes thread', async () => {
    let finish!: (value: unknown) => void
    provider.getThreadDetail.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await mount('old-worker')
    await act(async () => renderer.update(createElement(Consumer, { id: 'new-worker' })))
    await act(async () => finish({ blocks: [{ id: 'stale', kind: 'user', text: 'old' }], latestSeq: 100 }))
    expect(current.detail?.latestSeq).toBe(7)
    expect(provider.subscribeThreadEvents).toHaveBeenCalledTimes(1)
    expect(provider.subscribeThreadEvents.mock.calls[0][0]).toBe('new-worker')
  })
})
