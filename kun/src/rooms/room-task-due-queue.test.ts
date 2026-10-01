import { describe, expect, it, vi } from 'vitest'
import type { RoomStore, RoomStoredDocument } from './room-store.js'
import type { RoomTaskExecution } from './room-runtime-types.js'
import { RoomTaskDueQueue } from './room-task-due-queue.js'

type Row = RoomStoredDocument<RoomTaskExecution>
function row(id: number, status = 'needs_input'): Row {
  return { kind: 'task', id: String(id), roomId: 'room', revision: 0, seq: id + 1,
    value: { task: { id: String(id), status, executionThreadId: 'thread-' + id }, dependencyTaskIds: [] } as unknown as RoomTaskExecution }
}
function fixture(size: number) {
  const rows = Array.from({ length: size }, (_, id) => row(id))
  const events: Array<{ seq: number; kind: string; payload: { id: string } }> = []
  const list = vi.fn(async (_kind, options) => rows.filter((r) => r.seq > (options.afterSeq ?? 0)).slice(0, options.limit))
  const store = { list, get: vi.fn(async (_kind, id) => rows.find((r) => r.id === id) ?? null),
    latestEventSeq: async () => 0,
    events: vi.fn(async (_room, since, limit) => events.filter((event) => event.seq > since).slice(0, limit)) } as unknown as RoomStore
  return { queue: new RoomTaskDueQueue(store), rows, events, list, store }
}

describe('bounded room task due projection', () => {
  it('bootstraps large histories in bounded pages and blocks admission until all live owners are known', async () => {
    const f = fixture(1025)
    await f.queue.refresh(0)
    expect(f.queue.ready).toBe(false)
    expect(f.queue.all()).toHaveLength(128)
    expect(f.list).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 8; i++) await f.queue.refresh(0)
    expect(f.queue.ready).toBe(true)
    expect(f.queue.all()).toHaveLength(1025)
    expect(f.list.mock.calls.every(([, options]) => options.limit === 128)).toBe(true)
  })

  it('does not reload or reconcile indefinite waits every second; resolution wakes the exact task', async () => {
    const f = fixture(100)
    await f.queue.refresh(0)
    for (const value of f.queue.due(0)) f.queue.observed(value, 0)
    expect(f.queue.due(1000)).toHaveLength(0)
    expect(f.queue.nextWakeAt).toBe(15_000)
    await f.queue.refresh(1000)
    expect(f.list).toHaveBeenCalledTimes(1)
    f.queue.invalidateThread('thread-50')
    await f.queue.refresh(1000)
    expect(f.queue.due(1000).map((value) => value.id)).toEqual(['50'])
  })

  it('replays durable changes and prioritizes cancellation over a long runnable queue', async () => {
    const f = fixture(128)
    await f.queue.refresh(0)
    await f.queue.refresh(0)
    for (const value of f.queue.due(0)) f.queue.observed(value, 0)
    f.rows[127] = { ...f.rows[127], revision: 1, value: { ...f.rows[127].value,
      task: { ...f.rows[127].value.task, status: 'stopping' } } }
    f.events.push({ seq: 1, kind: 'task.updated', payload: { id: '127' } })
    await f.queue.refresh(1000)
    expect(f.queue.due(1000)[0].id).toBe('127')
    expect(f.queue.due(1000)).toHaveLength(1)
  })

  it('visits newer queued tasks while old members remain busy', async () => {
    const f = fixture(129)
    for (const value of f.rows) value.value.task.status = 'queued'
    await f.queue.refresh(0)
    await f.queue.refresh(0)
    f.queue.due(0).forEach((value) => f.queue.observed(value, 0))
    expect(f.queue.due(1000)[0].id).toBe('128')
  })

  it('invalidates waiting dependents when their prerequisite changes', async () => {
    const f = fixture(2)
    f.rows[1].value.dependencyTaskIds = ['0']
    await f.queue.refresh(0)
    f.queue.due(0).forEach((value) => f.queue.observed(value, 0))
    f.events.push({ seq: 1, kind: 'task.updated', payload: { id: '0' } })
    await f.queue.refresh(10)
    expect(f.queue.due(10)).toHaveLength(2)
  })
})
