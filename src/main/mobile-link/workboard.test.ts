import { afterEach, expect, it, vi } from 'vitest'
import type { RemoteApi } from '@kun/remote-protocol'
import { MobileWorkboard } from './workboard'
afterEach(() => vi.useRealTimers())
function fixture() {
  const now = Date.now(), request = vi.fn(async (path: string, _method?: string, _body?: unknown) => path === '/workboard/publisher' ? { epoch: 'epoch' } : { ok: true })
  const snapshot = { schemaVersion: 1, complete: true, observedAt: now, sessions: [{ kind: 'code', id: 'thread', runId: 'turn', phase: 'running', updatedAt: now }] }
  const read = vi.fn(async () => ({ ok: true, status: 200, body: JSON.stringify(snapshot) }))
  const publisher = new MobileWorkboard({ lease: async () => ({ runtimeToken: 'private-runtime-token', request: read }) })
  return { publisher, request, read, snapshot, api: { request } as unknown as RemoteApi }
}
it('publishes one bounded metadata stream, reuses its epoch and stops completely when phone access ends', async () => {
  vi.useFakeTimers(); const f = fixture()
  try {
    f.publisher.start(f.api, () => true); f.publisher.start(f.api, () => true)
    await vi.advanceTimersByTimeAsync(0)
    expect(f.read).toHaveBeenCalledWith('/v1/remote/workboard', 'GET')
    expect(f.request.mock.calls.map(call => call[0])).toEqual(['/workboard/publisher', '/workboard/snapshot'])
    expect(f.request.mock.calls[1][2]).toMatchObject({ epoch: 'epoch', sequence: 1, snapshot: f.snapshot })
    await vi.advanceTimersByTimeAsync(15000)
    expect(f.request.mock.calls.filter(call => call[0] === '/workboard/publisher')).toHaveLength(1)
    f.publisher.stop(); const count = f.request.mock.calls.length
    await vi.advanceTimersByTimeAsync(60000); expect(f.request.mock.calls).toHaveLength(count)
  } finally { f.publisher.stop() }
})
it('a revoked host cannot publish a late runtime read; unallowlisted private fields are rejected', async () => {
  vi.useFakeTimers(); const f = fixture(); let eligible = true, finish!: (value: any) => void
  f.read.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  try {
    f.publisher.start(f.api, () => eligible); await vi.advanceTimersByTimeAsync(0)
    eligible = false; finish({ ok: true, status: 200, body: JSON.stringify(f.snapshot) }); await vi.advanceTimersByTimeAsync(0)
    expect(f.request.mock.calls.filter(call => call[0] === '/workboard/snapshot')).toHaveLength(0)
  } finally { f.publisher.stop() }
  const g = fixture()
  g.read.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ ...g.snapshot, title: 'private' }) })
  try { g.publisher.start(g.api, () => true); await vi.advanceTimersByTimeAsync(0); expect(g.request.mock.calls.filter(call => call[0] === '/workboard/snapshot')).toHaveLength(0) }
  finally { g.publisher.stop() }
})
