import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { FileContextWindowStateStore } from '../adapters/file/file-context-window-state.js'
import { ContextWindowBudget } from '../loop/context-window-budget.js'
import { collectWindowContextInstructions } from '../loop/context-window-instructions.js'
import { ContextWindowStrategyCoordinator } from '../loop/context-window-strategy.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ContextWindowNotes } from './context-window-notes.js'
import { ContextWindowService } from './context-window-service.js'
import { ContextWindowTurnModes } from './context-window-turn-modes.js'
import { ContextWindowTransitionCoordinator } from './context-window-transition-coordinator.js'
import { ContextWindowStateRestore } from './context-window-state.js'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
} from '../contracts/context-windows.js'

const NOW = () => '2026-09-15T00:00:00.000Z'
const LIMITS = {
  maxFileBytes: CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  maxFilesPerThread: CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  maxTotalBytes: CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
}

describe('FileContextWindowStateStore', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-cw-state-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('saves, loads, and deletes per-thread window state atomically', async () => {
    const store = new FileContextWindowStateStore({ dataDir })
    expect(await store.load('thread1')).toBeNull()
    const state = {
      schemaVersion: 1 as const,
      threadId: 'thread1',
      windowId: 'win_2',
      windowSeq: 2,
      model: 'm',
      capacityTokens: 100_000,
      coveredThresholds: [0.25, 0.5],
      noticeTokens: 42,
      lastReason: 'model',
      updatedAt: NOW()
    }
    await store.save(state)
    expect(await store.load('thread1')).toEqual(state)
    await store.deleteThreadData('thread1')
    expect(await store.load('thread1')).toBeNull()
  })

  it('returns null for a corrupted state file instead of crashing', async () => {
    const store = new FileContextWindowStateStore({ dataDir })
    await store.save({
      schemaVersion: 1, threadId: 'thread1', windowId: 'win_1', windowSeq: 1,
      model: 'm', capacityTokens: 100_000, coveredThresholds: [], noticeTokens: 0,
      lastReason: 'model', updatedAt: NOW()
    })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dataDir, 'threads', 'thread1', 'context-window-state.json'), '{broken')
    expect(await store.load('thread1')).toBeNull()
  })
})

describe('ContextWindowStateRestore (P2-1)', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-cw-restore-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('continues window numbering and previousWindowId after a restart', async () => {
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const events = new RuntimeEventRecorder({
      eventBus, sessionStore, allocateSeq: (t) => eventBus.allocateSeq(t), nowIso: NOW
    })
    const makeCoordinator = () => {
      const modes = new ContextWindowTurnModes(() => 'windows')
      const budget = new ContextWindowBudget({ nowIso: NOW })
      const stateStore = new FileContextWindowStateStore({ dataDir })
      const restore = new ContextWindowStateRestore({ store: stateStore, modes, budget, sessionStore, nowIso: NOW })
      const contextWindows = new ContextWindowService({
        sessionStore,
        notes: new ContextWindowNotes({
          store: new (class {
            async listNoteFiles() { return [] }
            async readNote() { return null }
            async writeNote() { return { status: 'conflict' as const, path: '', expectedRevision: 0, actualRevision: 0 } }
            async appendNote() { return { status: 'replayed' as const, revision: 0 } }
            async copyThreadData() {}
            async deleteThreadData() {}
          })() as never
        }),
        ids: new (class { next(p: string) { return `${p}_x` } })() as never
      })
      const coordinator = new ContextWindowTransitionCoordinator({
        contextWindows, events, modes, budget, ids: undefined, sessionStore, stateRestore: restore,
        requestItemCount: async () => (await sessionStore.loadItems('threadA')).length,
        committedOperation: (t, op) => contextWindows.hasWindowOperation(t, op)
      })
      return { modes, budget, coordinator, restore }
    }

    const first = makeCoordinator()
    await sessionStore.appendItem('threadA', {
      id: 'u1', turnId: 'turn-1', threadId: 'threadA',
      kind: 'user_message', role: 'user', status: 'completed', createdAt: NOW(), text: 'task'
    })
    const t1 = await first.coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-1'
    })
    expect(t1.status).toBe('committed')
    await sessionStore.appendItem('threadA', {
      id: 'u2', turnId: 'turn-1', threadId: 'threadA',
      kind: 'user_message', role: 'user', status: 'completed', createdAt: NOW(), text: 'progress'
    })
    const t2 = await first.coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-2'
    })
    if (t2.status !== 'committed') throw new Error('expected committed')
    expect(t2.windowSeq).toBe(2)

    // Simulated restart: every in-memory map is dropped and rebuilt from disk.
    const restarted = makeCoordinator()
    expect(restarted.modes.windowFor('threadA')).toBeUndefined()
    const t3 = await restarted.coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-3'
    })
    expect(t3.status).toBe('committed')
    if (t3.status !== 'committed') return
    expect(t3.windowSeq).toBe(3)
    expect(t3.windowId).not.toBe(t2.windowId)
    const boundaries = (await sessionStore.loadItems('threadA')).filter((i) => i.kind === 'context_window')
    const third = boundaries[boundaries.length - 1]!
    expect(third.kind === 'context_window' && third.previousWindowId).toBe(t2.windowId)
  })

  it('restores covered threshold marks so notices do not re-fire after restart', async () => {
    const sessionStore = new InMemorySessionStore()
    const modes = new ContextWindowTurnModes(() => 'windows')
    const budget = new ContextWindowBudget({ profiles: [], nowIso: NOW })
    const stateStore = new FileContextWindowStateStore({ dataDir })
    const restore = new ContextWindowStateRestore({ store: stateStore, modes, budget, sessionStore, nowIso: NOW })

    await restore.restore('threadA')
    modes.setWindow('threadA', { windowId: 'win_1', windowSeq: 1 })
    budget.startWindow({ threadId: 'threadA', windowId: 'win_1', windowSeq: 1, model: 'm', capacityTokens: 1_000 })
    const state = budget.stateFor('threadA', 'win_1')!
    const fired = budget.thresholdNotice(state, { estimatedInputTokens: 300, outputReserveTokens: 0 })
    expect(fired.threshold).toBe(0.25)
    await restore.persist('threadA', 'threshold-notice')

    // Restart: fresh maps, restore from the state file. Restore stays
    // budget-read-only: marks are handed to the strategy via takeBudgetMarks
    // so they hydrate onto the current model's capacity.
    const modes2 = new ContextWindowTurnModes(() => 'windows')
    const budget2 = new ContextWindowBudget({ profiles: [], nowIso: NOW })
    const restore2 = new ContextWindowStateRestore({
      store: new FileContextWindowStateStore({ dataDir }), modes: modes2, budget: budget2, sessionStore, nowIso: NOW
    })
    await restore2.restore('threadA')
    expect(modes2.windowFor('threadA')).toEqual({ windowId: 'win_1', windowSeq: 1 })
    expect(budget2.stateFor('threadA', 'win_1')).toBeUndefined()
    const marks = restore2.takeBudgetMarks('threadA')
    expect(marks?.coveredThresholds).toEqual([0.25])
    expect(restore2.takeBudgetMarks('threadA')).toBeUndefined()
    const hydrated = budget2.startWindow({
      threadId: 'threadA', windowId: 'win_1', windowSeq: 1, model: 'm', capacityTokens: 1_000
    })
    hydrated.coveredThresholds = [...(marks?.coveredThresholds ?? [])]
    const again = budget2.thresholdNotice(hydrated, { estimatedInputTokens: 300, outputReserveTokens: 0 })
    expect(again.notice).toBeNull()
  })

  it('P1-b: a stale state file loses to the newest committed checkpoint', async () => {
    const sessionStore = new InMemorySessionStore()
    const make = () => {
      const modes = new ContextWindowTurnModes(() => 'windows')
      const budget = new ContextWindowBudget({ nowIso: NOW })
      const store = new FileContextWindowStateStore({ dataDir })
      const restore = new ContextWindowStateRestore({ store, modes, budget, sessionStore, nowIso: NOW })
      return { modes, budget, restore }
    }
    const first = make()
    // Window 1 transitions normally: state file written, checkpoint committed.
    first.modes.setWindow('threadA', { windowId: 'win_1', windowSeq: 1 })
    await first.restore.persist('threadA', 'model')
    // The window-1 checkpoint exists in canonical history too.
    await sessionStore.appendItem('threadA', {
      id: 'cw1', turnId: 'turn-1', threadId: 'threadA',
      kind: 'context_window', role: 'system', status: 'completed', createdAt: NOW(),
      schemaVersion: 1, windowId: 'win_1', previousWindowId: null, reason: 'model',
      sourceHistoryRevision: 1, splitBefore: { kind: 'seq', seq: 0 },
      initializationRef: 'init', operationId: 'op-1', replacedTokens: 0
    })
    // Crash sequence: window 2 checkpoint commits but the state write never
    // lands (simulated by direct checkpoint append without persist).
    await sessionStore.appendItem('threadA', {
      id: 'cw2', turnId: 'turn-1', threadId: 'threadA',
      kind: 'context_window', role: 'system', status: 'completed', createdAt: NOW(),
      schemaVersion: 1, windowId: 'win_2', previousWindowId: 'win_1', reason: 'model',
      sourceHistoryRevision: 2, splitBefore: { kind: 'seq', seq: 0 },
      initializationRef: 'init', operationId: 'op-2', replacedTokens: 0
    })

    // Restart: restore must converge to the checkpoint, not the stale file.
    const second = make()
    await second.restore.restore('threadA')
    expect(second.modes.windowFor('threadA')).toEqual({ windowId: 'win_2', windowSeq: 2 })
    // Restore never creates budget state (capacity comes from the live model
    // profile), and stale-window marks are not handed out at all.
    expect(second.budget.stateFor('threadA', 'win_2')).toBeUndefined()
    expect(second.restore.takeBudgetMarks('threadA')).toBeUndefined()
  })

  it('P1: restart restore backfills a missing initialization without an operation replay', async () => {
    const sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const events = new RuntimeEventRecorder({
      eventBus, sessionStore, allocateSeq: (t) => eventBus.allocateSeq(t), nowIso: NOW
    })
    const makeStack = () => {
      const modes = new ContextWindowTurnModes(() => 'windows')
      const budget = new ContextWindowBudget({ nowIso: NOW })
      const restore = new ContextWindowStateRestore({
        store: new FileContextWindowStateStore({ dataDir }), modes, budget, sessionStore, nowIso: NOW
      })
      const contextWindows = new ContextWindowService({
        sessionStore,
        notes: new ContextWindowNotes({
          store: new (class {
            async listNoteFiles() { return [] }
            async readNote() { return null }
            async writeNote() { return { status: 'conflict' as const, path: '', expectedRevision: 0, actualRevision: 0 } }
            async appendNote() { return { status: 'replayed' as const, revision: 0 } }
            async copyThreadData() {}
            async deleteThreadData() {}
          })() as never
        }),
        ids: new (class { next(p: string) { return `${p}_x` } })() as never
      })
      const coordinator = new ContextWindowTransitionCoordinator({
        contextWindows, events, modes, budget, ids: undefined, sessionStore, stateRestore: restore,
        requestItemCount: async () => 0,
        committedOperation: (t, op) => contextWindows.hasWindowOperation(t, op)
      })
      // Late binding, mirroring the composition root.
      restore.ensureInitialization = (checkpoint) => coordinator.ensureInitialization(checkpoint)
      return { modes, budget, restore, coordinator }
    }

    const first = makeStack()
    await sessionStore.appendItem('threadA', {
      id: 'u1', turnId: 'turn-1', threadId: 'threadA',
      kind: 'user_message', role: 'user', status: 'completed', createdAt: NOW(), text: 'task'
    })
    const committed = await first.coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-crash'
    })
    expect(committed.status).toBe('committed')
    if (committed.status !== 'committed') return

    // Simulated crash: checkpoint durable, initialization lost.
    const items = await sessionStore.loadItems('threadA')
    await sessionStore.rewriteItems('threadA', items.filter((item) => !item.id.startsWith('cw_init_')))
    expect((await sessionStore.loadItems('threadA')).some((item) => item.id.startsWith('cw_init_')))
      .toBe(false)

    // Fresh restart with NO operation replay: restore records the checkpoint;
    // the model preflight establishes the current route capacity before it
    // completes initialization.
    const restarted = makeStack()
    const strategy = new ContextWindowStrategyCoordinator({
      summary: {} as never,
      mode: () => 'windows',
      budget: restarted.budget,
      capacityTokens: () => 100_000,
      window: (threadId) => restarted.modes.windowFor(threadId),
      establishWindow: (threadId, window) => restarted.modes.setWindow(threadId, window),
      sessionStore,
      stateRestore: restarted.restore
    })
    const outcome = await strategy.compactIfNeeded({
      items: await sessionStore.loadItems('threadA'),
      threadId: 'threadA',
      turnId: 'turn-1',
      model: 'current-model',
      signal: new AbortController().signal,
      requestOverheadTokens: 1_000,
      requestInputTokens: 1_000,
      outputBudgetTokens: 0
    })
    const initItems = (await sessionStore.loadItems('threadA'))
      .filter((item) => item.id.startsWith('cw_init_'))
    expect(initItems).toHaveLength(1)
    expect(initItems[0]!.kind === 'runtime_context_source' ? initItems[0]!.content : '')
      .toContain('Current task message:')
    expect(initItems[0]!.kind === 'runtime_context_source' ? initItems[0]!.content : '')
      .toContain('about 100k of 100k tokens')
    expect(collectWindowContextInstructions(outcome.history, outcome.notice).join('\n'))
      .toContain('Current task message: u1')

    // A second restore adds nothing.
    const second = makeStack()
    await second.restore.restore('threadA')
    await second.restore.ensureRestoredInitialization('threadA')
    expect((await sessionStore.loadItems('threadA')).filter((item) => item.id.startsWith('cw_init_')))
      .toHaveLength(1)
  })

  it('derives window identity from committed checkpoints when no state file exists', async () => {
    const sessionStore = new InMemorySessionStore()
    const modes = new ContextWindowTurnModes(() => 'windows')
    const budget = new ContextWindowBudget({ nowIso: NOW })
    const restore = new ContextWindowStateRestore({
      store: new FileContextWindowStateStore({ dataDir }), modes, budget, sessionStore, nowIso: NOW
    })
    for (const [index, windowId] of ['win-a', 'win-b'].entries()) {
      await sessionStore.appendItem('threadA', {
        id: `cw${index}`, turnId: 'turn-1', threadId: 'threadA',
        kind: 'context_window', role: 'system', status: 'completed', createdAt: NOW(),
        schemaVersion: 1, windowId, previousWindowId: null, reason: 'model',
        sourceHistoryRevision: 1, splitBefore: { kind: 'seq', seq: 0 },
        initializationRef: 'init', operationId: `op-${windowId}`, replacedTokens: 0
      })
    }
    await restore.restore('threadA')
    expect(modes.windowFor('threadA')).toEqual({ windowId: 'win-b', windowSeq: 2 })

    // A thread that never enabled the feature stays untouched.
    await restore.restore('threadB')
    expect(modes.windowFor('threadB')).toBeUndefined()
    expect(budget.stateFor('threadB', 'win-0')).toBeUndefined()
  })
})
