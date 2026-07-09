import { describe, expect, it, vi } from 'vitest'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'

function buildRecorder(): {
  recorder: RuntimeEventRecorder
  bus: InMemoryEventBus
  sessionStore: InMemorySessionStore
} {
  const bus = new InMemoryEventBus()
  const sessionStore = new InMemorySessionStore()
  const recorder = new RuntimeEventRecorder({
    eventBus: bus,
    sessionStore,
    allocateSeq: (threadId) => bus.allocateSeq(threadId),
    nowIso: () => new Date().toISOString()
  })
  return { recorder, bus, sessionStore }
}

describe('runtime event recorder', () => {
  it('persists an event before publishing it to live subscribers', async () => {
    const { recorder, bus, sessionStore } = buildRecorder()
    const order: string[] = []
    vi.spyOn(sessionStore, 'appendEvent').mockImplementation(async () => {
      order.push('persist')
    })
    vi.spyOn(bus, 'publish').mockImplementation(() => {
      order.push('publish')
    })

    await recorder.record({ kind: 'heartbeat', threadId: 'thr_1' })

    expect(order).toEqual(['persist', 'publish'])
  })

  it('never stamps the same seq twice for concurrent records', async () => {
    const { recorder, sessionStore } = buildRecorder()
    // Pre-existing history: the persisted high-water mark is well above the
    // fresh in-memory counter, which used to make concurrent first records
    // collide on persistedSeq + 1.
    await sessionStore.appendEvent('thr_1', {
      kind: 'heartbeat',
      threadId: 'thr_1',
      seq: 100,
      timestamp: new Date().toISOString()
    })

    const events = await Promise.all(
      Array.from({ length: 5 }, () => recorder.record({ kind: 'heartbeat', threadId: 'thr_1' }))
    )

    const seqs = events.map((event) => event.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(Math.min(...seqs)).toBeGreaterThan(100)
  })

  it('reads the persisted high-water mark only once per thread', async () => {
    const { recorder, sessionStore } = buildRecorder()
    const highestSeq = vi.spyOn(sessionStore, 'highestSeq')

    await recorder.record({ kind: 'heartbeat', threadId: 'thr_1' })
    await recorder.record({ kind: 'heartbeat', threadId: 'thr_1' })
    await recorder.record({ kind: 'heartbeat', threadId: 'thr_1' })

    expect(highestSeq).toHaveBeenCalledTimes(1)
  })

  it('does not let observer failures break event persistence or publishing', async () => {
    const bus = new InMemoryEventBus()
    const sessionStore = new InMemorySessionStore()
    const publish = vi.spyOn(bus, 'publish')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const recorder = new RuntimeEventRecorder({
      eventBus: bus,
      sessionStore,
      allocateSeq: (threadId) => bus.allocateSeq(threadId),
      nowIso: () => new Date().toISOString(),
      observers: [{ record: () => { throw new Error('observer down') } }]
    })

    await recorder.record({ kind: 'heartbeat', threadId: 'thr_1' })

    expect(await sessionStore.loadEventsSince('thr_1', 0)).toHaveLength(1)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('observer down'))
    warn.mockRestore()
  })
})
