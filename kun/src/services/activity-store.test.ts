import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityStore } from './activity-store.js'
import { projectRuntimeEvent } from './activity-event-projection.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { RegisterUnit } from '../contracts/activity.js'

const NOW = '2026-09-01T12:00:00.000Z'

function ev(kind: RuntimeEvent['kind'], threadId: string, extra: Record<string, unknown> = {}): RuntimeEvent {
  return { kind, threadId, seq: 1, timestamp: NOW, ...extra } as RuntimeEvent
}

function makeStore(options: Omit<ConstructorParameters<typeof ActivityStore>[0], 'nowIso'> = {}) {
  return new ActivityStore({ nowIso: () => NOW, ...options })
}

function registerThread(store: ActivityStore, unitId: string, extra: Partial<RegisterUnit> = {}) {
  return store.register({
    unitId,
    kind: 'thread',
    threadId: unitId,
    harnessId: 'kun',
    title: unitId,
    workspace: { path: '/ws', kind: 'local' },
    ...extra
  })
}

describe('projectRuntimeEvent', () => {
  const projections: Array<[string, RuntimeEvent, Record<string, unknown>]> = [
    ['turn_queued', ev('turn_queued', 't1'), { mainState: 'initializing' }],
    [
      'turn_started',
      ev('turn_started', 't1', { turnId: 'turn-1' }),
      { mainState: 'working', turnId: 'turn-1', stalled: false }
    ],
    [
      'approval_requested',
      ev('approval_requested', 't1', { status: 'pending' }),
      { mainState: 'waiting', waitingReason: 'approval' }
    ],
    [
      'user_input_requested',
      ev('user_input_requested', 't1', { status: 'pending' }),
      { mainState: 'waiting', waitingReason: 'user_input' }
    ],
    [
      'approval_resolved',
      ev('approval_resolved', 't1', { status: 'allowed' }),
      { mainState: 'working', waitingReason: undefined }
    ],
    [
      'user_input_resolved',
      ev('user_input_resolved', 't1', { status: 'submitted' }),
      { mainState: 'working', waitingReason: undefined }
    ],
    [
      'tool_call_started',
      ev('tool_call_started', 't1', { item: { kind: 'tool_call', toolName: 'read' } }),
      { currentTool: 'read' }
    ],
    ['tool_call_finished', ev('tool_call_finished', 't1'), { currentTool: undefined }],
    [
      'assistant_text_delta',
      ev('assistant_text_delta', 't1', { item: { kind: 'assistant_text', text: 'hello world' } }),
      { lastMessagePreview: 'hello world' }
    ],
    [
      'turn_completed',
      ev('turn_completed', 't1', { turnId: 'turn-1' }),
      { mainState: 'done', lastOutcome: 'completed', turnId: 'turn-1' }
    ],
    [
      'turn_failed',
      ev('turn_failed', 't1', { turnId: 'turn-1' }),
      { mainState: 'failed', lastOutcome: 'failed', turnId: 'turn-1' }
    ],
    [
      'turn_aborted',
      ev('turn_aborted', 't1', { turnId: 'turn-1' }),
      { mainState: 'idle', lastOutcome: 'cancelled', turnId: 'turn-1' }
    ],
    ['thread_updated', ev('thread_updated', 't1', { title: 'Renamed' }), { title: 'Renamed' }],
    [
      'harness_runtime',
      ev('harness_runtime', 't1', { harnessId: 'claude-code' }),
      { harnessId: 'claude-code' }
    ]
  ]

  it.each(projections.map(([name, event, patch]) => [name, event, patch] as const))(
    '%s maps to the §4.2 patch',
    (_name, event, patch) => {
      expect(projectRuntimeEvent(event)).toEqual([{ unitId: 't1', patch }])
    }
  )

  it('routes child lifecycle events to the child unit only', () => {
    const child = {
      parentThreadId: 'parent-1',
      parentTurnId: 'pturn-1',
      childId: 'child-1',
      childStatus: 'completed' as const,
      childSeq: 3
    }
    expect(projectRuntimeEvent(ev('turn_completed', 'parent-1', { child }))).toEqual([
      {
        unitId: 'child-1',
        patch: {
          parentThreadId: 'parent-1',
          mainState: 'done',
          lastOutcome: 'completed'
        }
      }
    ])
  })

  it('ignores unrelated event kinds', () => {
    expect(projectRuntimeEvent(ev('heartbeat', 't1'))).toEqual([])
    expect(projectRuntimeEvent(ev('assistant_reasoning_delta', 't1'))).toEqual([])
  })
})

describe('ActivityStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse(NOW))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-registers a thread on turn_started and drives it through a turn', () => {
    const store = makeStore()
    store.record(ev('turn_started', 't1', { turnId: 'turn-1' }))
    expect(store.get('t1')).toMatchObject({
      kind: 'thread',
      state: 'working',
      mainState: 'working',
      turnId: 'turn-1'
    })
    store.record(ev('approval_requested', 't1', { status: 'pending' }))
    expect(store.get('t1')).toMatchObject({ state: 'waiting', waitingReason: 'approval' })
    store.record(ev('approval_resolved', 't1', { status: 'allowed' }))
    expect(store.get('t1')?.state).toBe('working')
    store.record(ev('turn_completed', 't1', { turnId: 'turn-1' }))
    expect(store.get('t1')).toMatchObject({ state: 'done', mainState: 'done', lastOutcome: 'completed' })
  })

  it('fills title and workspace from thread metadata asynchronously', async () => {
    const store = makeStore({
      threadMetadata: async () =>
        ({
          id: 't1',
          title: 'Real title',
          workspace: '/real/ws',
          status: 'idle',
          turns: []
        }) as never
    })
    store.record(ev('turn_started', 't1'))
    await vi.waitFor(() => {
      expect(store.get('t1')).toMatchObject({
        title: 'Real title',
        workspace: { path: '/real/ws', kind: 'local' }
      })
    })
  })

  it('ignores writes for unregistered units', () => {
    const store = makeStore()
    store.apply('missing', { mainState: 'done' }, 'runtime')
    expect(store.get('missing')).toBeUndefined()
    store.record(ev('turn_completed', 'missing'))
    expect(store.get('missing')).toBeUndefined()
  })

  it('enforces producer authority on mainState', () => {
    const store = makeStore()
    store.register({
      unitId: 'w1',
      kind: 'worker',
      threadId: 'w1',
      harnessId: 'kun',
      title: 'worker',
      workspace: { path: '/w', kind: 'worktree' }
    })
    // A worker callback cannot mark itself done.
    store.apply('w1', { mainState: 'done' }, 'callback')
    expect(store.get('w1')?.mainState).toBe('initializing')
    // But a question wait is allowed through.
    store.apply('w1', { mainState: 'waiting', waitingReason: 'question' }, 'callback')
    expect(store.get('w1')).toMatchObject({ mainState: 'waiting', waitingReason: 'question' })
    // Supplementary fields are always allowed.
    store.apply('w1', { phase: 'verifying', progressNote: 'checking' }, 'callback')
    expect(store.get('w1')).toMatchObject({ phase: 'verifying', progressNote: 'checking' })
  })

  it('rolls children counts into the parent state', () => {
    const store = makeStore()
    registerThread(store, 'p1')
    store.apply('p1', { mainState: 'working' }, 'runtime')
    for (const id of ['c1', 'c2']) {
      store.register({
        unitId: id,
        kind: 'worker',
        threadId: id,
        parentThreadId: 'p1',
        harnessId: 'kun',
        title: id,
        workspace: { path: '/w', kind: 'worktree' }
      })
      store.apply(id, { mainState: 'working' }, 'runtime')
    }
    expect(store.get('p1')?.children).toEqual({ working: 2, waiting: 0, done: 0, failed: 0 })
    // Parent finishes its own turn but children still run: stays working.
    store.apply('p1', { mainState: 'done', lastOutcome: 'completed' }, 'runtime')
    expect(store.get('p1')).toMatchObject({ mainState: 'done', state: 'working' })
    store.apply('c1', { mainState: 'done', lastOutcome: 'completed' }, 'runtime')
    expect(store.get('p1')?.children).toEqual({ working: 1, waiting: 0, done: 1, failed: 0 })
    store.apply('c2', { mainState: 'done', lastOutcome: 'completed' }, 'runtime')
    expect(store.get('p1')?.state).toBe('done')
  })

  it('surfaces a waiting child on the parent', () => {
    const store = makeStore()
    registerThread(store, 'p1')
    store.register({
      unitId: 'c1',
      kind: 'worker',
      threadId: 'c1',
      parentThreadId: 'p1',
      harnessId: 'kun',
      title: 'c1',
      workspace: { path: '/w', kind: 'worktree' }
    })
    store.apply('c1', { mainState: 'waiting', waitingReason: 'question' }, 'callback')
    expect(store.get('p1')?.state).toBe('waiting')
    expect(store.get('p1')?.children.waiting).toBe(1)
  })

  it('throttles assistant deltas to one bump per window and keeps the last text', () => {
    const store = makeStore({ previewThrottleMs: 2_000 })
    let bumps = 0
    registerThread(store, 't1')
    store.subscribe(() => { bumps += 1 })
    for (let i = 0; i < 100; i += 1) {
      vi.setSystemTime(Date.parse(NOW) + i * 10)
      store.record(
        ev('assistant_text_delta', 't1', { item: { kind: 'assistant_text', text: `frag-${i}` } })
      )
    }
    // First delta flushed immediately; the rest coalesce into the timer flush.
    expect(bumps).toBe(1)
    vi.advanceTimersByTime(2_000)
    expect(bumps).toBe(2)
    expect(store.get('t1')?.lastMessagePreview).toBe('frag-99')
  })

  it('processes a hot delta stream within a generous bound', () => {
    vi.useRealTimers()
    const store = makeStore()
    registerThread(store, 't1')
    const started = Date.now()
    for (let i = 0; i < 10_000; i += 1) {
      store.record(
        ev('assistant_text_delta', 't1', { item: { kind: 'assistant_text', text: `x${i}` } })
      )
    }
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('reports resetRequired on epoch mismatch and expired cursors', () => {
    const store = makeStore({ changesCapacity: 4 })
    registerThread(store, 't1')
    const early = store.cursor()
    for (let i = 0; i < 6; i += 1) {
      store.apply('t1', { progressNote: `n${i}` }, 'runtime')
    }
    expect(store.changesSince(early)).toMatchObject({ resetRequired: true, reason: 'cursor_expired' })
    expect(store.changesSince('bogus-cursor')).toMatchObject({
      resetRequired: true,
      reason: 'runtime_epoch_changed'
    })
  })

  it('returns only the latest change per unit', () => {
    const store = makeStore()
    registerThread(store, 't1')
    const cursor = store.cursor()
    store.apply('t1', { mainState: 'working' }, 'runtime')
    store.apply('t1', { mainState: 'done' }, 'runtime')
    const result = store.changesSince(cursor)
    expect(result.resetRequired).toBe(false)
    if (result.resetRequired) return
    expect(result.batch.changes).toHaveLength(1)
    expect(result.batch.changes[0].row).toMatchObject({ mainState: 'done' })
  })

  it('clearThread removes the parent row and its children', () => {
    const store = makeStore()
    registerThread(store, 'p1')
    store.register({
      unitId: 'c1',
      kind: 'worker',
      threadId: 'c1',
      parentThreadId: 'p1',
      harnessId: 'kun',
      title: 'c1',
      workspace: { path: '/w', kind: 'worktree' }
    })
    const cursor = store.cursor()
    store.clearThread('p1')
    expect(store.get('p1')).toBeUndefined()
    expect(store.get('c1')).toBeUndefined()
    const result = store.changesSince(cursor)
    expect(result.resetRequired).toBe(false)
    if (result.resetRequired) return
    expect(result.batch.changes).toEqual([
      { unitId: 'p1', removed: true },
      { unitId: 'c1', removed: true }
    ])
  })

  it('registers child units from child lifecycle events and counts them', () => {
    const store = makeStore()
    registerThread(store, 'p1')
    store.apply('p1', { mainState: 'done' }, 'runtime')
    store.record(
      ev('turn_started', 'p1', {
        child: {
          parentThreadId: 'p1',
          parentTurnId: 'pt-1',
          childId: 'child-1',
          childStatus: 'running',
          childSeq: 1
        }
      })
    )
    expect(store.get('child-1')).toMatchObject({
      kind: 'worker',
      parentThreadId: 'p1',
      state: 'working'
    })
    expect(store.get('p1')?.state).toBe('working')
  })

  it('rebuilds rows from durable thread state on hydrate', async () => {
    const recent = new Date(Date.parse(NOW) - 60_000).toISOString()
    const store = makeStore()
    await store.hydrate({
      list: async () => [{ id: 't-done' }, { id: 't-run' }, { id: 't-old' }, { id: 't-none' }],
      getMetadata: async (id) =>
        (({
          't-done': {
            id: 't-done', title: 'd', workspace: '/w', status: 'idle', updatedAt: recent,
            turns: [{ id: 'turn-1', status: 'completed' }]
          },
          't-run': {
            id: 't-run', title: 'r', workspace: '/w', status: 'running', updatedAt: recent,
            turns: [{ id: 'turn-2', status: 'running' }]
          },
          't-old': {
            id: 't-old', title: 'o', workspace: '/w', status: 'idle',
            updatedAt: '2020-01-01T00:00:00.000Z',
            turns: [{ id: 'turn-3', status: 'completed' }]
          },
          't-none': {
            id: 't-none', title: 'n', workspace: '/w', status: 'idle', updatedAt: recent, turns: []
          }
        })[id] ?? null) as never
    })
    expect(store.get('t-done')).toMatchObject({ mainState: 'done', provenance: 'restored' })
    expect(store.get('t-run')).toMatchObject({ mainState: 'working', provenance: 'restored' })
    expect(store.get('t-old')).toBeUndefined()
    expect(store.get('t-none')).toBeUndefined()
  })

  it('clears stalled on the next runtime event', () => {
    const store = makeStore()
    registerThread(store, 't1')
    store.apply('t1', { mainState: 'working' }, 'runtime')
    store.apply('t1', { stalled: true }, 'inferred')
    expect(store.get('t1')?.stalled).toBe(true)
    store.record(ev('tool_call_started', 't1', { item: { kind: 'tool_call', toolName: 'read' } }))
    expect(store.get('t1')?.stalled).toBe(false)
  })

  it('waitForChange resolves early when a change lands', async () => {
    const store = makeStore()
    registerThread(store, 't1')
    const controller = new AbortController()
    const waited = store.waitForChange(controller.signal, 30_000)
    store.apply('t1', { mainState: 'working' }, 'runtime')
    await expect(waited).resolves.toBeUndefined()
  })
})
