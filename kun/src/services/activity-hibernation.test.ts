import { describe, expect, it, vi } from 'vitest'
import { ActivityStore } from './activity-store.js'
import { ActivityHibernation } from './activity-hibernation.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { ActivityRow, RegisterUnit } from '../contracts/activity.js'

function ev(kind: RuntimeEvent['kind'], threadId: string, extra: Record<string, unknown> = {}): RuntimeEvent {
  return { kind, threadId, seq: 1, timestamp: '2026-09-01T12:00:00.000Z', ...extra } as RuntimeEvent
}

const MIN = 60_000

function harness(input: {
  thresholds?: Partial<{
    enabled: boolean
    stallStructuredMs: number
    stallTerminalMs: number
    dormantMs: number
  }>
  hasOpenWork?: (row: ActivityRow) => Promise<boolean>
  canResume?: (row: ActivityRow) => boolean
  releaseResident?: (row: ActivityRow) => void | Promise<void>
} = {}) {
  let isoNow = Date.parse('2026-09-01T12:00:00.000Z')
  let msNow = isoNow
  const store = new ActivityStore({ nowIso: () => new Date(isoNow).toISOString(), nowMs: () => msNow })
  const releaseResident = vi.fn(input.releaseResident ?? (() => undefined))
  const hibernation = new ActivityHibernation(
    {
      apply: (unitId, patch) => store.apply(unitId, patch, 'inferred'),
      list: () => store.list(),
      lastEventAt: (unitId) => store.lastEventAt(unitId),
      hasOpenWork: input.hasOpenWork ?? (() => Promise.resolve(false)),
      canResume: input.canResume ?? (() => true),
      releaseResident
    },
    {
      now: () => msNow,
      thresholds: () => ({
        enabled: input.thresholds?.enabled ?? true,
        stallStructuredMs: input.thresholds?.stallStructuredMs ?? 10 * MIN,
        stallTerminalMs: input.thresholds?.stallTerminalMs ?? 20 * MIN,
        dormantMs: input.thresholds?.dormantMs ?? 30 * MIN
      })
    }
  )
  return {
    store,
    hibernation,
    releaseResident,
    advance: (ms: number) => {
      msNow += ms
      isoNow += ms
    }
  }
}

function registerWorker(store: ActivityStore, unitId: string, extra: Partial<RegisterUnit> = {}) {
  return store.register({
    unitId,
    kind: 'worker',
    threadId: unitId,
    parentThreadId: 'manager-1',
    harnessId: 'kun',
    title: unitId,
    workspace: { path: '/ws', kind: 'local' },
    ...extra
  })
}

describe('ActivityHibernation stall detection', () => {
  it('marks a quiet working row stalled after the structured threshold', async () => {
    const { store, hibernation, advance } = harness()
    registerWorker(store, 'w1')
    store.record(ev('turn_started', 'w1', { turnId: 'turn-1' }))
    advance(11 * MIN)
    await hibernation.scanOnce()
    expect(store.get('w1')).toMatchObject({ stalled: true, mainState: 'working', provenance: 'inferred' })
  })

  it('leaves a row under the threshold alone', async () => {
    const { store, hibernation, advance } = harness()
    registerWorker(store, 'w1')
    store.record(ev('turn_started', 'w1', { turnId: 'turn-1' }))
    advance(5 * MIN)
    await hibernation.scanOnce()
    expect(store.get('w1')?.stalled).toBe(false)
  })

  it('does not stall a row waiting on a manager question', async () => {
    const { store, hibernation, advance } = harness()
    registerWorker(store, 'w1')
    store.record(ev('turn_started', 'w1', { turnId: 'turn-1' }))
    store.apply('w1', { mainState: 'waiting', waitingReason: 'question' }, 'runtime')
    // A question-wait shows as waiting; even if the projection leaves the row
    // working the waitingReason guard skips it.
    store.apply('w1', { mainState: 'working', waitingReason: 'question' }, 'runtime')
    advance(30 * MIN)
    await hibernation.scanOnce()
    expect(store.get('w1')?.stalled).toBe(false)
  })

  it('applies the longer terminal-agent threshold to terminal rows', async () => {
    const { store, hibernation, advance } = harness()
    store.register({
      unitId: 'term-1',
      kind: 'terminal-agent',
      threadId: 'term-1',
      harnessId: 'kun',
      title: 'term-1',
      workspace: { path: '/ws', kind: 'local' }
    })
    store.apply('term-1', { mainState: 'working' }, 'runtime')
    advance(15 * MIN)
    await hibernation.scanOnce()
    expect(store.get('term-1')?.stalled).toBe(false)
    advance(10 * MIN)
    await hibernation.scanOnce()
    expect(store.get('term-1')?.stalled).toBe(true)
  })

  it('clears the marker when a fresh event arrives', async () => {
    const { store, hibernation, advance } = harness()
    registerWorker(store, 'w1')
    store.record(ev('turn_started', 'w1', { turnId: 'turn-1' }))
    advance(11 * MIN)
    await hibernation.scanOnce()
    expect(store.get('w1')?.stalled).toBe(true)
    store.record(ev('tool_call_started', 'w1', { item: { kind: 'tool_call', toolName: 'read' } }))
    expect(store.get('w1')?.stalled).toBe(false)
  })

  it('ignores non-working and dormant rows', async () => {
    const { store, hibernation, advance } = harness()
    registerWorker(store, 'w-done', { mainState: 'done' })
    registerWorker(store, 'w-dormant', { mainState: 'idle', residency: 'dormant' })
    advance(60 * MIN)
    await hibernation.scanOnce()
    expect(store.get('w-done')?.stalled).toBe(false)
    expect(store.get('w-dormant')?.stalled).toBe(false)
  })
})

describe('ActivityHibernation dormancy', () => {
  async function dormantCandidate(input: Parameters<typeof harness>[0] = {}) {
    const h = harness(input)
    registerWorker(h.store, 'w1')
    h.store.record(ev('turn_started', 'w1', { turnId: 'turn-1' }))
    h.store.apply('w1', { mainState: 'done' }, 'runtime')
    h.advance(60 * MIN)
    await h.hibernation.scanOnce()
    return h
  }

  it('releases a fully idle worker and marks it dormant', async () => {
    const h = await dormantCandidate()
    expect(h.store.get('w1')?.residency).toBe('dormant')
    expect(h.releaseResident).toHaveBeenCalledWith(
      expect.objectContaining({ unitId: 'w1' })
    )
  })

  it.each([
    ['mainState is working', async (h: ReturnType<typeof harness>) => {
      registerWorker(h.store, 'w1')
      h.store.record(ev('turn_started', 'w1', { turnId: 'turn-1' }))
      h.advance(60 * MIN)
    }],
    ['children are active', async (h: ReturnType<typeof harness>) => {
      registerWorker(h.store, 'w1', { mainState: 'done' })
      h.store.register({
        unitId: 'child-1',
        kind: 'worker',
        threadId: 'child-1',
        parentThreadId: 'w1',
        harnessId: 'kun',
        title: 'child-1',
        workspace: { path: '/ws', kind: 'local' },
        mainState: 'working'
      })
      h.advance(60 * MIN)
    }],
    ['open work exists', async (h: ReturnType<typeof harness>) => {
      registerWorker(h.store, 'w1', { mainState: 'done' })
      h.advance(60 * MIN)
    }],
    ['session is foreground', async (h: ReturnType<typeof harness>) => {
      registerWorker(h.store, 'w1', { mainState: 'done' })
      h.advance(60 * MIN)
      h.hibernation.markForeground('w1')
    }],
    ['idle window not reached', async (h: ReturnType<typeof harness>) => {
      registerWorker(h.store, 'w1', { mainState: 'done' })
      h.advance(5 * MIN)
    }],
    ['harness cannot resume', async (h: ReturnType<typeof harness>) => {
      registerWorker(h.store, 'w1', { mainState: 'done' })
      h.advance(60 * MIN)
    }]
  ])('stays live when %s', async (_label, arrange) => {
    const h = harness(
      _label === 'open work exists'
        ? { hasOpenWork: () => Promise.resolve(true) }
        : _label === 'harness cannot resume'
          ? { canResume: () => false }
          : {}
    )
    await arrange(h)
    await h.hibernation.scanOnce()
    expect(h.store.get('w1')?.residency).toBe('live')
    expect(h.releaseResident).not.toHaveBeenCalled()
  })

  it('skips thread and manager rows even when idle', async () => {
    const h = harness()
    h.store.register({
      unitId: 't1',
      kind: 'thread',
      threadId: 't1',
      harnessId: 'kun',
      title: 't1',
      workspace: { path: '/ws', kind: 'local' },
      mainState: 'done'
    })
    h.advance(60 * MIN)
    await h.hibernation.scanOnce()
    expect(h.store.get('t1')?.residency).toBe('live')
    expect(h.releaseResident).not.toHaveBeenCalled()
  })

  it('does not release a row that is already dormant', async () => {
    const h = harness()
    registerWorker(h.store, 'w1', { mainState: 'done', residency: 'dormant' })
    h.advance(60 * MIN)
    await h.hibernation.scanOnce()
    expect(h.releaseResident).not.toHaveBeenCalled()
  })

  it('still detects stalls when hibernation is disabled', async () => {
    const h = harness({ thresholds: { enabled: false } })
    registerWorker(h.store, 'w1')
    h.store.record(ev('turn_started', 'w1', { turnId: 'turn-1' }))
    h.advance(60 * MIN)
    await h.hibernation.scanOnce()
    expect(h.store.get('w1')).toMatchObject({ stalled: true, residency: 'live' })
    expect(h.releaseResident).not.toHaveBeenCalled()
  })

  it('foreground marks expire so the session may dorm', async () => {
    const h = harness()
    registerWorker(h.store, 'w1', { mainState: 'done' })
    h.hibernation.markForeground('w1')
    expect(h.hibernation.isForeground('w1')).toBe(true)
    h.advance(31_000)
    expect(h.hibernation.isForeground('w1')).toBe(false)
    h.advance(60 * MIN)
    await h.hibernation.scanOnce()
    expect(h.store.get('w1')?.residency).toBe('dormant')
  })

  it('wakes a dormant row on fresh runtime events', async () => {
    const h = await dormantCandidate()
    expect(h.store.get('w1')?.residency).toBe('dormant')
    // A user message lands as a new turn on the worker thread.
    h.store.record(ev('turn_started', 'w1', { turnId: 'turn-2' }))
    expect(h.store.get('w1')?.residency).toBe('live')
    expect(h.store.get('w1')?.mainState).toBe('working')
  })

  it('keeps scanning other rows when one release fails', async () => {
    const h = harness({
      releaseResident: (row) => {
        if (row.unitId === 'w1') throw new Error('release boom')
      }
    })
    registerWorker(h.store, 'w1', { mainState: 'done' })
    registerWorker(h.store, 'w2', { mainState: 'done' })
    h.advance(60 * MIN)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await h.hibernation.scanOnce()
    warn.mockRestore()
    expect(h.store.get('w1')?.residency).toBe('dormant')
    expect(h.store.get('w2')?.residency).toBe('dormant')
    expect(h.releaseResident).toHaveBeenCalledTimes(2)
  })
})
