import { expect, it, vi } from 'vitest'
import { KunTimelineTurnSink } from './turn-sink.js'

function fixture(emitAll: (drafts: unknown) => Promise<void>) {
  return new KunTimelineTurnSink({ emitter: { emitAll } as never, approve: async () => 'deny',
    threadId: 'thread', turnId: 'turn', ids: { next: () => 'id' } })
}
it('serializes streamed writes and drains them before a caller can finish the turn', async () => {
  let release!: () => void
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const completed: unknown[] = []
  const emitAll = vi.fn(async (drafts: unknown) => { await blocked; completed.push(drafts) })
  const sink = fixture(emitAll)
  void sink.emit([{ kind: 'first' }] as never)
  void sink.emit([{ kind: 'last' }] as never)
  let finished = false
  const flushing = sink.flush().then(() => { finished = true })
  await Promise.resolve()
  expect(emitAll).toHaveBeenCalledTimes(1)
  expect(finished).toBe(false)
  release(); await flushing
  expect(completed).toEqual([[{ kind: 'first' }], [{ kind: 'last' }]])
})
it('observes asynchronous stream errors and surfaces them from flush instead of silently completing', async () => {
  const sink = fixture(async () => { throw new Error('rejected timeline write') })
  void sink.emit([])
  await expect(sink.flush()).rejects.toThrow('rejected timeline write')
})
