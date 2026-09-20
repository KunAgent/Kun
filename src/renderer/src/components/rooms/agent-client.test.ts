import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { useAgentResource } from './agent-client'

const requests = vi.hoisted(() => ({ request: vi.fn(), listeners: new Set<(event: { kind: string }) => void>() }))
vi.mock('./rooms-client', () => ({ roomsRequest: requests.request }))
vi.mock('./useRoomEvents', () => ({
  subscribeRoomEvents: (listener: (event: { kind: string }) => void) => {
    requests.listeners.add(listener)
    return () => requests.listeners.delete(listener)
  }
}))
let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount())
  renderer = undefined; requests.request.mockReset(); requests.listeners.clear(); vi.useRealTimers()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
describe('Agent query scope and lifecycle', () => {
  it('aborts the old Agent request and discards its late private data after switching', async () => {
    const first = deferred<{ name: string }>(), second = deferred<{ name: string }>()
    requests.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    let latest: ReturnType<typeof useAgentResource<{ name: string }>>
    function Probe({ id, active = true }: { id: string; active?: boolean }) {
      latest = useAgentResource('/v1/agents/' + id, active)
      return createElement('span', null, latest.data?.name ?? '')
    }
    await act(async () => { renderer = create(createElement(Probe, { id: 'a' })) })
    const signal = requests.request.mock.calls[0][3] as AbortSignal
    await act(async () => renderer!.update(createElement(Probe, { id: 'b' })))
    expect(signal.aborted).toBe(true)
    await act(async () => second.resolve({ name: 'B private context' }))
    await act(async () => first.resolve({ name: 'A private context' }))
    expect(latest!.data?.name).toBe('B private context')
    await act(async () => renderer!.update(createElement(Probe, { id: 'b', active: false })))
    expect(latest!.data?.name).toBe('B private context')
    expect(requests.listeners.size).toBe(0)
    expect(requests.request.mock.calls.every((call) => call[1] === 'GET')).toBe(true)
  })
  it('does not let an older live refresh overwrite a newer result', async () => {
    vi.useFakeTimers()
    const initial = deferred<{ revision: number }>(), older = deferred<{ revision: number }>(), newer = deferred<{ revision: number }>()
    requests.request.mockReturnValueOnce(initial.promise).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    let latest: ReturnType<typeof useAgentResource<{ revision: number }>>
    function Probe() { latest = useAgentResource('/v1/agents/a'); return null }
    await act(async () => { renderer = create(createElement(Probe)) })
    await act(async () => initial.resolve({ revision: 1 }))
    const event = () => { for (const listener of requests.listeners) listener({ kind: 'agent.updated' }) }
    await act(async () => { event(); await vi.advanceTimersByTimeAsync(300) })
    await act(async () => { event(); await vi.advanceTimersByTimeAsync(300) })
    await act(async () => newer.resolve({ revision: 3 }))
    await act(async () => older.resolve({ revision: 2 }))
    expect(latest!.data?.revision).toBe(3)
  })
})
