import { describe, expect, it, vi } from 'vitest'
import { ThreadActivityRegistry } from './thread-activity-registry.js'
import type { RuntimeEvent } from '../contracts/events.js'

function event(kind: RuntimeEvent['kind'], threadId: string, seq: number): RuntimeEvent {
  return { kind, threadId, seq, timestamp: '2026-08-31T00:00:00.000Z' } as RuntimeEvent
}

describe('ThreadActivityRegistry', () => {
  it('replays relevant changes from the initial zero cursor', () => {
    const registry = new ThreadActivityRegistry(8, 'epoch-test')
    registry.record(event('turn_started', 'thread-1', 1))

    expect(registry.changesSince()).toMatchObject({
      resetRequired: false,
      batch: { changes: [{ threadId: 'thread-1', kind: 'runtime' }] }
    })
  })

  it('keeps a monotonic opaque cursor and ignores high-frequency deltas', () => {
    const registry = new ThreadActivityRegistry(8, 'epoch-test')
    const cursor = registry.cursor()

    registry.record(event('assistant_text_delta', 'thread-1', 1))
    expect(registry.changesSince(cursor)).toMatchObject({
      resetRequired: false,
      batch: { changes: [] }
    })

    registry.record(event('turn_started', 'thread-1', 2))
    expect(registry.changesSince(cursor)).toMatchObject({
      resetRequired: false,
      batch: { changes: [{ threadId: 'thread-1', kind: 'runtime', threadSeq: 2 }] }
    })
  })

  it('coalesces a thread by semantic priority and reports deletion', () => {
    const registry = new ThreadActivityRegistry(8, 'epoch-test')
    const cursor = registry.cursor()
    registry.record(event('turn_started', 'thread-1', 1))
    registry.record(event('thread_updated', 'thread-1', 2))
    registry.clearThread('thread-1')

    expect(registry.changesSince(cursor)).toMatchObject({
      resetRequired: false,
      batch: { changes: [{ threadId: 'thread-1', kind: 'deleted' }] }
    })
  })

  it('projects Todo changes as metadata invalidations', () => {
    const registry = new ThreadActivityRegistry(8, 'epoch-test')
    const cursor = registry.cursor()
    registry.record(event('todos_updated', 'thread-1', 4))

    expect(registry.changesSince(cursor)).toMatchObject({
      resetRequired: false,
      batch: { changes: [{ threadId: 'thread-1', kind: 'metadata', threadSeq: 4 }] }
    })
  })

  it('requires reset for another runtime epoch or an expired ring cursor', () => {
    const old = new ThreadActivityRegistry(2, 'old')
    const staleCursor = old.cursor()
    const current = new ThreadActivityRegistry(2, 'current')
    expect(current.changesSince(staleCursor)).toMatchObject({
      resetRequired: true,
      reason: 'runtime_epoch_changed'
    })

    const cursor = current.cursor()
    current.record(event('turn_started', 'one', 1))
    current.record(event('turn_started', 'two', 1))
    current.record(event('turn_started', 'three', 1))
    expect(current.changesSince(cursor)).toMatchObject({
      resetRequired: true,
      reason: 'cursor_expired'
    })
  })

  it('wakes a long poll when a relevant change arrives', async () => {
    vi.useFakeTimers()
    const registry = new ThreadActivityRegistry(8, 'epoch-test')
    const waiting = registry.waitForChange(new AbortController().signal, 25_000)
    registry.record(event('turn_completed', 'thread-1', 3))
    await expect(waiting).resolves.toBeUndefined()
    vi.useRealTimers()
  })
})
