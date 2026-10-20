import { describe, expect, it, vi } from 'vitest'
import { applyHistoryDelta } from '@kun/remote-protocol'
import { LiveHistory, LIVE_READ_SPACING_MS } from './live-history'
import { MobileSubscriptions } from './subscriptions'

function page(latestSeq: number, texts: string[]) {
  return { id: 'thread', historyVersion: 'v1', latestSeq, turns: [{ id: 'turn', items: texts.map((text, index) => ({ id: 'item' + index, turnId: 'turn', kind: 'assistant_text', text })) }] }
}
const live = (frame: any) => frame.payload.live
describe('desktop live history', () => {
  it('sends the page once, then only deltas that rebuild the same page, and nothing for an unchanged read', async () => {
    vi.useFakeTimers()
    try {
      let current: any = page(4, ['hello'])
      const sent: any[] = []
      const read = vi.fn(async (method: string, _params?: Record<string, unknown>) => method === 'approval.list' ? { approvals: [], inputs: [] } : current)
      const history = new LiveHistory('phone', 'code', 'thread', { send: (frame) => sent.push(frame), read, failed: vi.fn() })
      expect(await history.start()).toBe(4)
      expect(sent).toHaveLength(1)
      expect(live(sent[0])).toMatchObject({ rev: 1, snapshot: { latestSeq: 4, liveApprovals: { approvals: [], inputs: [] } } })
      expect(read.mock.calls.map(([method, params]) => [method, params])).toEqual([['code.history', { threadId: 'thread' }], ['approval.list', { threadId: 'thread' }]])
      current = page(6, ['hello world', 'second'])
      history.changed(); history.changed(); history.changed()
      await vi.advanceTimersByTimeAsync(LIVE_READ_SPACING_MS)
      expect(sent).toHaveLength(2)
      expect(sent[1].lossy).toBe(true)
      expect(live(sent[1])).toMatchObject({ rev: 2, base: 1 })
      expect(applyHistoryDelta('code', live(sent[0]).snapshot, live(sent[1]).delta)).toEqual({ ...current, liveApprovals: { approvals: [], inputs: [] } })
      expect(JSON.stringify(live(sent[1]).delta)).not.toContain('"hello"')
      history.changed()
      await vi.advanceTimersByTimeAsync(LIVE_READ_SPACING_MS)
      expect(sent).toHaveLength(2)
      history.stop()
    } finally { vi.useRealTimers() }
  })
  it('re-reads no more often than the spacing while a stream is busy, and keeps the last change', async () => {
    vi.useFakeTimers()
    try {
      let seq = 1
      const reads: number[] = []
      const read = vi.fn(async (method: string) => { if (method !== 'approval.list') reads.push(Date.now()); return method === 'approval.list' ? undefined : page(seq, ['x'.repeat(seq)]) })
      const history = new LiveHistory('phone', 'agent', 'agent', { send: () => {}, read, failed: vi.fn() })
      await history.start()
      const started = Date.now()
      for (let i = 0; i < 50; i++) { seq++; history.changed(); await vi.advanceTimersByTimeAsync(40) }
      await vi.advanceTimersByTimeAsync(2000)
      const during = reads.filter((at) => at >= started)
      for (let i = 1; i < during.length; i++) expect(during[i] - during[i - 1]).toBeGreaterThanOrEqual(LIVE_READ_SPACING_MS)
      expect(during.length).toBeLessThanOrEqual(Math.ceil(2000 / LIVE_READ_SPACING_MS) + 2)
      expect(read).toHaveBeenCalledWith('agent.history', { agentId: 'agent' })
      history.stop()
    } finally { vi.useRealTimers() }
  })
  it('ends the subscription when the page cannot be read and reports an oversized page as unavailable', async () => {
    vi.useFakeTimers()
    try {
      const failed = vi.fn(), sent: any[] = []
      let fail = false
      const history = new LiveHistory('phone', 'group', 'room', { send: (frame) => sent.push(frame), failed,
        read: vi.fn(async () => { if (fail) throw new Error('NOT_FOUND'); return { cursor: 1, messages: [] } }) })
      await history.start()
      fail = true; history.changed()
      await vi.advanceTimersByTimeAsync(LIVE_READ_SPACING_MS)
      expect(failed).toHaveBeenCalledOnce()
      const huge = new LiveHistory('phone', 'agent', 'agent', { send: (frame) => sent.push(frame), failed: vi.fn(),
        read: vi.fn(async () => ({ messages: [{ id: 'm', body: 'x'.repeat(4 * 1024 * 1024) }] })) })
      await huge.start()
      expect(live(sent.at(-1))).toEqual({ rev: 0, error: 'LIVE_UNAVAILABLE' })
    } finally { vi.useRealTimers() }
  })
})

describe('live subscriptions over the runtime stream', () => {
  it('reads the page first, watches from its cursor and turns runtime events into page deltas', async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>, current: any = page(9, ['a'])
    const sent: any[] = [], fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { writer = controller } }))) as unknown as typeof fetch
    const read = vi.fn(async (_device: string, _authority: unknown, method: string) => method === 'approval.list' ? undefined : current)
    const service = new MobileSubscriptions({ lease: async () => ({ baseUrl: 'http://runtime.test', runtimeToken: 'runtime', request: vi.fn() }) as any,
      fetch: fetcher, send: (frame) => sent.push(frame), read })
    const authority = { accountId: 'owner', deviceId: 'phone', authorizationId: 'authority', scopes: ['personal'] }
    const watching = service.subscribe('phone', { kind: 'code', id: 'thread', since: 0, live: true }, authority)
    await vi.waitFor(() => expect(sent.some((frame) => frame.payload?.kind === 'subscribed')).toBe(true))
    expect(fetcher).toHaveBeenCalledWith('http://runtime.test/v1/remote/events/code/thread?since=9', expect.any(Object))
    expect(sent.map((frame) => frame.payload?.live?.snapshot ? 'snapshot' : frame.payload?.kind)).toEqual(['snapshot', 'subscribed'])
    expect(sent[1].payload.live).toBe(true)
    writer.enqueue(new TextEncoder().encode('data: {"kind":"heartbeat","seq":9}\n\n'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(read.mock.calls.filter(([, , method]) => method === 'code.history')).toHaveLength(1)
    current = page(10, ['ab'])
    writer.enqueue(new TextEncoder().encode('data: {"kind":"item.delta","seq":10}\n\n'))
    await vi.waitFor(() => expect(sent.some((frame) => frame.payload?.live?.delta)).toBe(true), { timeout: 2000 })
    expect(sent.some((frame) => frame.payload?.event)).toBe(false)
    await service.subscribe('phone', { kind: 'code', id: 'thread', active: false })
    // The fixture stream ignores abort signals; ending it lets the reader observe the unsubscription.
    writer.close()
    await watching
    expect(sent.at(-1).kind).not.toBe('resync_required')
  })
  it('keeps the event-forwarding path for phones that did not ask for live pages', async () => {
    const sent: any[] = [], read = vi.fn()
    const service = new MobileSubscriptions({ lease: async () => ({ baseUrl: 'http://runtime.test', runtimeToken: 'runtime', request: vi.fn() }) as any,
      fetch: vi.fn(async () => new Response('data: {"seq":5}\n\n')) as unknown as typeof fetch, send: (frame) => sent.push(frame), read })
    await service.subscribe('phone', { kind: 'code', id: 'thread', since: 4 }, { accountId: 'owner', deviceId: 'phone', authorizationId: 'a', scopes: ['personal'] })
    expect(read).not.toHaveBeenCalled()
    expect(sent.map((frame) => frame.kind)).toEqual(['event', 'event', 'resync_required'])
    expect(sent[0].payload).toEqual({ kind: 'subscribed', resource: 'code', resourceId: 'thread' })
  })
})
