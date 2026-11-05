import { describe, expect, it, vi } from 'vitest'
import { applyHistorySync, type HistorySyncFrame, type HistorySyncState, type HistorySyncSubscription } from '@kun/remote-protocol'
import type { RuntimeEvent } from '../../contracts/events.js'
import { CodeHistorySync } from './code-sync.js'
import { projectCodeEvent, type CodePage } from './code-events.js'

const item = (text: string) => ({ id: 'reply', threadId: 'thread', turnId: 'turn', kind: 'assistant_text' as const,
  role: 'assistant' as const, status: 'running' as const, text, createdAt: '2026-11-04T00:00:00Z' })
const page = (): CodePage => ({ id: 'thread', historyVersion: 'history', latestSeq: 0, turns: [{ id: 'turn', items: [item('A')] }] })
const input = (after?: HistorySyncSubscription['after']): HistorySyncSubscription => ({ version: 2,
  subscriptionId: 'sub', view: 'conversation', ...(after ? { after } : {}) })
const delta = (seq: number, text: string, offset: number): RuntimeEvent => ({ kind: 'assistant_text_delta',
  seq, threadId: 'thread', turnId: 'turn', itemId: 'reply', deltaOffset: offset, item: item(text), timestamp: 'now' })
function setup(options: { now?: () => number; load?: () => Promise<CodePage>; version?: () => Promise<string | undefined> } = {}) {
  let emit!: (event: RuntimeEvent) => void
  const load = vi.fn(options.load ?? (async () => page()))
  const off = vi.fn()
  const sync = new CodeHistorySync({ load, subscribe: fn => { emit = fn; return off },
    replay: async (_, events) => ({ events, through: 0 }), now: options.now, version: options.version })
  return { sync, load, emit: (event: RuntimeEvent) => emit(event), off }
}
describe('Code event projection and bounded resume', () => {
  it('rejects a snapshot whose canonical generation changed before initialization completed', async () => {
    const f = setup({ version: async () => 'replaced' })
    await expect(f.sync.initialized).rejects.toThrow('HISTORY_SOURCE_GAP')
    expect(f.sync.valid).toBe(false)
    expect(f.off).toHaveBeenCalledOnce()
  })
  it('coalesces a stream without history rereads and replays only missed batches after reconnect', async () => {
    const initial = page(); initial.turns[0]!.items = [item('A'.repeat(8000))]
    const f = setup({ load: async () => initial }), first: HistorySyncFrame[] = []
    try {
      const detach = await f.sync.attach(input(), frame => first.push(frame))
      let state: HistorySyncState = { ready: false }
      for (const frame of first) state = applyHistorySync(state, frame)
      const cursor = state.cursor!
      detach()
      for (let n = 1; n <= 100; n++) f.emit(delta(n, 'x', 7999 + n))
      await f.sync.flush()
      const resumed: HistorySyncFrame[] = []
      await f.sync.attach(input(cursor), frame => resumed.push(frame))
      expect(resumed.map(frame => frame.kind)).toEqual(['patch', 'ready'])
      expect(Buffer.byteLength(JSON.stringify(resumed))).toBeLessThan(1000)
      for (const frame of resumed) state = applyHistorySync(state, frame)
      expect(state.data!.turns[0].items[0].text).toBe('A'.repeat(8000) + 'x'.repeat(100))
      expect(state.ready).toBe(true)
      expect(f.load).toHaveBeenCalledTimes(1)
      const unchanged: HistorySyncFrame[] = []
      await f.sync.attach(input(state.cursor), frame => unchanged.push(frame))
      expect(unchanged.map(frame => frame.kind)).toEqual(['ready'])
    } finally { f.sync.close() }
  })
  it('falls back to a bounded snapshot for old cursors and new projection epochs', async () => {
    let now = 0
    const f = setup({ now: () => now }), frames: HistorySyncFrame[] = []
    try {
      await f.sync.attach(input(), frame => frames.push(frame))
      const epoch = (frames[0] as { epoch: string }).epoch
      f.emit(delta(1, 'B', 1)); await f.sync.flush()
      now = 120001
      const expired: HistorySyncFrame[] = []
      await f.sync.attach(input({ epoch, seq: 0 }), frame => expired.push(frame))
      expect(expired.map(frame => frame.kind)).toEqual(['snapshot', 'ready'])
      const other: HistorySyncFrame[] = []
      await f.sync.attach(input({ epoch: 'old-runtime', seq: 100 }), frame => other.push(frame))
      expect(other[0].kind).toBe('snapshot')
    } finally { f.sync.close() }
  })
  it('closes a source gap instead of advancing beyond missing text and hides private items', async () => {
    const f = setup(), frames: HistorySyncFrame[] = []
    try {
      await f.sync.attach(input(), frame => frames.push(frame))
      const privateEvent = { ...delta(1, 'private', 0), kind: 'item_updated', item: { ...item('private'), kind: 'model_context' } } as unknown as RuntimeEvent
      f.emit(privateEvent); await f.sync.flush()
      expect(frames.map(frame => frame.kind)).toEqual(['snapshot', 'ready'])
      f.emit(delta(2, 'missing-prefix', 99))
      await expect(f.sync.flush()).rejects.toThrow('HISTORY_SOURCE_GAP')
      expect(frames.at(-1)).toMatchObject({ kind: 'reset', reason: 'HISTORY_SOURCE_GAP' })
      expect(f.off).toHaveBeenCalledTimes(1)
    } finally { f.sync.close() }
  })
  it('merges overlapping hydration deltas once and marks oversized text as a preview', () => {
    const initial = page(); initial.turns[0]!.items = [item('ABC')]
    const once = projectCodeEvent(initial, delta(1, 'BC', 1))!
    expect(once.turns[0]!.items[0]).toHaveProperty('text', 'ABC')
    const large = projectCodeEvent(once, { ...delta(2, '', 0), kind: 'item_updated', item: item('x'.repeat(100000)) })!
    expect(large.turns[0]!.items[0]).toHaveProperty('truncated', true)
    expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThan(128 * 1024)
  })
  it('buffers changes during the initial read and never loses the hydration tail', async () => {
    let finish!: (page: CodePage) => void
    const f = setup({ load: () => new Promise(resolve => { finish = resolve }) })
    try {
      f.emit(delta(1, 'B', 1))
      finish(page())
      const frames: HistorySyncFrame[] = []
      await f.sync.attach(input(), frame => frames.push(frame))
      expect(frames[0]).toMatchObject({ kind: 'snapshot', data: { turns: [{ items: [{ text: 'AB' }] }] } })
    } finally { f.sync.close() }
  })
  it('keeps text newer than a metadata snapshot and replaces the baseline after history rewrite', async () => {
    let current = page()
    const f = setup({ load: async () => current }), frames: HistorySyncFrame[] = []
    try {
      await f.sync.attach(input(), frame => frames.push(frame))
      const epoch = (frames[0] as { epoch: string }).epoch
      f.emit(delta(1, 'B', 1)); await f.sync.flush()
      f.emit({ kind: 'approval_resolved', threadId: 'thread', seq: 2 } as RuntimeEvent)
      await f.sync.flush()
      let replica: HistorySyncState = { ready: false }
      for (const frame of frames) replica = applyHistorySync(replica, frame)
      expect(replica.data!.turns[0].items[0].text).toBe('AB')
      current = { ...page(), historyVersion: 'rewritten' }
      f.emit({ kind: 'thread_pruned', threadId: 'thread', seq: 3 } as RuntimeEvent)
      await f.sync.flush()
      const snapshot = frames.filter(frame => frame.kind === 'snapshot').at(-1) as Extract<HistorySyncFrame, { kind: 'snapshot' }>
      expect(snapshot.epoch).not.toBe(epoch)
      expect(snapshot.data).toMatchObject({ historyVersion: 'rewritten', turns: [{ items: [{ text: 'A' }] }] })
    } finally { f.sync.close() }
  })
  it('bounds a stalled source queue and signals a reset on overflow', async () => {
    const f = setup(), frames: HistorySyncFrame[] = []
    await f.sync.attach(input(), frame => frames.push(frame))
    for (let index = 1; index <= 513; index++) f.emit(delta(index, 'x', index))
    expect(f.sync.valid).toBe(false)
    expect(f.sync.bytes).toBeLessThan(256 * 1024)
    expect(frames.at(-1)).toMatchObject({ kind: 'reset', reason: 'HISTORY_SOURCE_OVERFLOW' })
    f.sync.close()
  })
})
