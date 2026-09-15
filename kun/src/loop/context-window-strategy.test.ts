import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { FileContextWindowStore } from '../adapters/file/file-context-window-store.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
} from '../contracts/context-windows.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelClient } from '../ports/model-client.js'
import type { ModelContextProfile } from './model-context-profile.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { UsageService } from '../services/usage-service.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ContextWindowNotes } from '../services/context-window-notes.js'
import { FileContextWindowStateStore } from '../adapters/file/file-context-window-state.js'
import { ContextWindowStateRestore } from '../services/context-window-state.js'
import { ContextWindowService } from '../services/context-window-service.js'
import { ContextWindowTurnModes } from '../services/context-window-turn-modes.js'
import {
  ContextWindowTransitionCoordinator,
  countOrdinaryWorkItems
} from '../services/context-window-transition-coordinator.js'
import { ContextWindowBudget } from './context-window-budget.js'
import { ContextCompactor } from './context-compactor.js'
import { HistoryCompactionService, type HistoryCompactionOutcome } from './history-compaction-service.js'
import { ContextWindowStrategyCoordinator } from './context-window-strategy.js'

const CAPACITY = 100_000
const HARD_CAP = 85_000

function message(id: string, text: string): TurnItem {
  return {
    id, turnId: 'turn-1', threadId: 'threadA',
    kind: 'user_message', role: 'user', status: 'completed',
    createdAt: '2026-09-14T00:00:00.000Z', text
  }
}

function compactInput(overrides: Record<string, unknown> = {}) {
  return {
    items: [message('u1', 'task')],
    model: 'test-model',
    signal: new AbortController().signal,
    threadId: 'threadA',
    turnId: 'turn-1',
    ...overrides
  } as Parameters<ContextWindowStrategyCoordinator['compactIfNeeded']>[0]
}

describe('ContextWindowStrategyCoordinator', () => {
  let dataDir: string
  let sessionStore: InMemorySessionStore
  let summary: HistoryCompactionService
  let summarySpy: ReturnType<typeof vi.spyOn>
  let modes: ContextWindowTurnModes
  let strategy: ContextWindowStrategyCoordinator
  let transition: ContextWindowTransitionCoordinator

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-cw-strategy-'))
    sessionStore = new InMemorySessionStore()
    const eventBus = new InMemoryEventBus()
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso: () => '2026-09-14T00:00:00.000Z'
    })
    summary = new HistoryCompactionService({
      sessionStore,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'sys' }),
      model: {} as ModelClient,
      usage: new UsageService(),
      events,
      ids: new SequentialIdGenerator(),
      telemetry: { consumePromptPressure: () => undefined },
      recordGoalUsage: async () => {},
      rewriteThreadItemsFromSession: async () => {}
    })
    summarySpy = vi.spyOn(summary, 'compactIfNeeded')
    modes = new ContextWindowTurnModes(() => 'windows')
    const contextWindows = new ContextWindowService({
      sessionStore,
      notes: new ContextWindowNotes({
        store: new FileContextWindowStore({
          dataDir,
          limits: {
            maxFileBytes: CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
            maxFilesPerThread: CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
            maxTotalBytes: CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
          }
        })
      }),
      ids: new SequentialIdGenerator()
    })
    transition = new ContextWindowTransitionCoordinator({
      contextWindows,
      events,
      modes,
      budget: new ContextWindowBudget({ nowIso: () => '2026-09-14T00:00:00.000Z' }),
      ids: new SequentialIdGenerator(),
      sessionStore,
      requestItemCount: async (threadId) =>
        countOrdinaryWorkItems(await sessionStore.loadItems(threadId)),
      committedOperation: (threadId, operationId) =>
        contextWindows.hasWindowOperation(threadId, operationId)
    })
    strategy = new ContextWindowStrategyCoordinator({
      summary,
      mode: (threadId, turnId) => modes.modeFor(threadId, turnId),
      transition,
      budget: new ContextWindowBudget({ nowIso: () => '2026-09-14T00:00:00.000Z' }),
      capacityTokens: () => CAPACITY,
      window: (threadId) => modes.windowFor(threadId),
      sessionStore
    })
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('delegates unchanged to the summary service in summary mode', async () => {
    const summaryModes = new ContextWindowTurnModes(() => 'summary')
    const dispatch = new ContextWindowStrategyCoordinator({
      summary,
      mode: (threadId, turnId) => summaryModes.modeFor(threadId, turnId)
    })
    const outcome = await dispatch.compactIfNeeded(compactInput())
    expect(summarySpy).toHaveBeenCalledTimes(1)
    expect(outcome).toMatchObject({ triggered: false, compacted: false })
  })

  it('emits deduped soft notices without calling the summary path', async () => {
    // 60% usage: crosses 25/50 in one request but must announce only the highest.
    const outcome = await strategy.compactIfNeeded(compactInput({
      requestOverheadTokens: 10_000,
      requestInputTokens: 60_000,
      outputBudgetTokens: 0
    }))
    expect(summarySpy).not.toHaveBeenCalled()
    expect(outcome.compacted).toBe(false)
    expect(outcome.notice).toContain('60% used')

    const repeat = await strategy.compactIfNeeded(compactInput({
      requestOverheadTokens: 10_000,
      requestInputTokens: 60_000,
      outputBudgetTokens: 0
    }))
    expect(repeat.notice).toBeUndefined()
    expect(summarySpy).not.toHaveBeenCalled()
  })

  it('performs exactly one deterministic transition on hard pressure', async () => {
    await sessionStore.appendItem('threadA', message('u-old', 'old work'))
    const outcome = await strategy.compactIfNeeded(compactInput({
      requestOverheadTokens: 10_000,
      requestInputTokens: HARD_CAP + 1,
      outputBudgetTokens: 1_000
    }))
    expect(summarySpy).not.toHaveBeenCalled()
    expect(outcome.compacted).toBe(true)
    expect(outcome.windowTransition).toMatchObject({ windowSeq: 1 })
    expect(outcome.notice).toContain('context window 1')
    // The returned history starts at the new window: pre-boundary items are gone.
    expect(outcome.history.map((item) => item.id)).not.toContain('u-old')

    // A second hard-pressure call without progress must not create another
    // window and must not fall back to summary compaction.
    const again = await strategy.compactIfNeeded(compactInput({
      requestOverheadTokens: 10_000,
      requestInputTokens: HARD_CAP + 1,
      outputBudgetTokens: 1_000
    }))
    expect(again.compacted).toBe(false)
    expect(again.windowTransition).toBeUndefined()
    expect(again.notice).toContain('without summarizing')
    expect(summarySpy).not.toHaveBeenCalled()
    const boundaries = (await sessionStore.loadItems('threadA'))
      .filter((item) => item.kind === 'context_window')
    expect(boundaries).toHaveLength(1)
  })

  it('treats forced overflow recovery as one single transition', async () => {
    const outcome = await strategy.compactIfNeeded(compactInput({
      requestOverheadTokens: 5_000,
      requestInputTokens: 20_000,
      outputBudgetTokens: 1_000,
      force: { reason: 'overflow' }
    }))
    expect(summarySpy).not.toHaveBeenCalled()
    expect(outcome.compacted).toBe(true)
    expect(outcome.windowTransition?.windowSeq).toBe(1)

    const retry = await strategy.compactIfNeeded(compactInput({
      requestOverheadTokens: 5_000,
      requestInputTokens: 20_000,
      outputBudgetTokens: 1_000,
      force: { reason: 'overflow' }
    }))
    expect(retry.compacted).toBe(false)
    expect(summarySpy).not.toHaveBeenCalled()
  })

  it('P1-c: two pressure crossings in one turn commit two distinct windows', async () => {
    const hardInput = () => ({
      requestOverheadTokens: 10_000,
      requestInputTokens: HARD_CAP + 1,
      outputBudgetTokens: 1_000
    })
    const first = await strategy.compactIfNeeded(compactInput(hardInput()))
    expect(first.compacted).toBe(true)
    expect(first.windowTransition?.windowSeq).toBe(1)

    // Ordinary progress between the crossings.
    await sessionStore.appendItem('threadA', message('u-progress', 'model did work'))

    const second = await strategy.compactIfNeeded(compactInput(hardInput()))
    expect(second.compacted).toBe(true)
    expect(second.windowTransition?.windowSeq).toBe(2)
    if (first.windowTransition && second.windowTransition) {
      expect(second.windowTransition.windowId).not.toBe(first.windowTransition.windowId)
    }

    const boundaries = (await sessionStore.loadItems('threadA'))
      .filter((item) => item.kind === 'context_window')
    expect(boundaries).toHaveLength(2)
    const ids = boundaries.map((item) => item.kind === 'context_window' ? item.operationId : '')
    expect(new Set(ids).size).toBe(2)
    expect(ids[0]).toContain('win-0')
    expect(ids[1]).not.toContain('win-0')

    // Same-crossing retry (same window, no progress) adds no third boundary.
    const retry = await strategy.compactIfNeeded(compactInput(hardInput()))
    expect(retry.compacted).toBe(false)
    expect((await sessionStore.loadItems('threadA')).filter((item) => item.kind === 'context_window'))
      .toHaveLength(2)
  })

  it('marks unrecoverable requests without transitioning or summarizing', async () => {
    const outcome = await strategy.compactIfNeeded(compactInput({
      requestOverheadTokens: HARD_CAP + 1,
      requestInputTokens: HARD_CAP + 2_000,
      outputBudgetTokens: 1_000
    }))
    expect(outcome.unrecoverable).toBe(true)
    expect(outcome.compacted).toBe(false)
    expect(outcome.notice).toContain('hard capacity')
    expect(summarySpy).not.toHaveBeenCalled()
    expect((await sessionStore.loadItems('threadA')).some((item) => item.kind === 'context_window'))
      .toBe(false)
  })

  it('P2-c: win-0 threshold marks persist and survive a restart', async () => {
    const localModes = new ContextWindowTurnModes(() => 'windows')
    const localBudget = new ContextWindowBudget({ nowIso: () => '2026-09-14T00:00:00.000Z' })
    const stateStore = new FileContextWindowStateStore({ dataDir })
    const restore = new ContextWindowStateRestore({
      store: stateStore, modes: localModes, budget: localBudget, sessionStore,
      nowIso: () => '2026-09-14T00:00:00.000Z'
    })
    const localStrategy = new ContextWindowStrategyCoordinator({
      summary,
      mode: (threadId, turnId) => localModes.modeFor(threadId, turnId),
      transition,
      budget: localBudget,
      capacityTokens: () => CAPACITY,
      window: (threadId) => localModes.windowFor(threadId),
      establishWindow: (threadId, window) => localModes.setWindow(threadId, window),
      sessionStore,
      stateRestore: restore
    })
    const softInput = () => ({
      requestOverheadTokens: 10_000,
      requestInputTokens: 60_000,
      outputBudgetTokens: 0
    })

    const outcome = await localStrategy.compactIfNeeded(compactInput(softInput()))
    expect(outcome.notice).toContain('60%')
    // Window 0 identity was established, so the marks could persist.
    expect(localModes.windowFor('threadA')).toEqual({ windowId: 'win-0', windowSeq: 0 })
    const persisted = await stateStore.load('threadA')
    expect(persisted?.windowId).toBe('win-0')
    expect(persisted?.coveredThresholds).toEqual([0.25, 0.5])

    // Restart: fresh maps; restore must bring the win-0 marks back.
    const modes2 = new ContextWindowTurnModes(() => 'windows')
    const budget2 = new ContextWindowBudget({ nowIso: () => '2026-09-14T00:00:00.000Z' })
    const restore2 = new ContextWindowStateRestore({
      store: new FileContextWindowStateStore({ dataDir }), modes: modes2, budget: budget2,
      sessionStore, nowIso: () => '2026-09-14T00:00:00.000Z'
    })
    const strategy2 = new ContextWindowStrategyCoordinator({
      summary,
      mode: (threadId, turnId) => modes2.modeFor(threadId, turnId),
      transition,
      budget: budget2,
      capacityTokens: () => CAPACITY,
      window: (threadId) => modes2.windowFor(threadId),
      establishWindow: (threadId, window) => modes2.setWindow(threadId, window),
      sessionStore,
      stateRestore: restore2
    })
    const afterRestart = await strategy2.compactIfNeeded(compactInput(softInput()))
    expect(afterRestart.notice).toBeUndefined()
  })

  it('P2: restored marks hydrate onto the current model capacity (reviewer measurement)', async () => {
    const CAPACITY_BIG = 100_000
    const CAPACITY_SMALL = 1_000
    const makeProfile = (canonicalModel: string, contextWindowTokens: number, maxOutputTokens?: number): ModelContextProfile => ({
      canonicalModel,
      modelIds: [canonicalModel],
      contextWindowTokens,
      softThreshold: Math.floor(contextWindowTokens * 0.75),
      hardThreshold: Math.floor(contextWindowTokens * 0.85),
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text'],
      ...(maxOutputTokens ? { maxOutputTokens } : {})
    })
    const profiles = [
      makeProfile('big-model', CAPACITY_BIG, 8_192),
      makeProfile('small-model', CAPACITY_SMALL, 100)
    ]
    const capacityFor = (model: string) => model === 'small-model' ? CAPACITY_SMALL : CAPACITY_BIG

    // Pre-restart runtime: window 7 exists, the 25% threshold fired, marks
    // persisted to the state file.
    const modes1 = new ContextWindowTurnModes(() => 'windows')
    modes1.setWindow('threadA', { windowId: 'win_7', windowSeq: 7 })
    const budget1 = new ContextWindowBudget({ profiles, nowIso: () => '2026-09-14T00:00:00.000Z' })
    const stateStore = new FileContextWindowStateStore({ dataDir })
    const restore1 = new ContextWindowStateRestore({
      store: stateStore, modes: modes1, budget: budget1, sessionStore,
      nowIso: () => '2026-09-14T00:00:00.000Z'
    })
    const state1 = budget1.startWindow({
      threadId: 'threadA', windowId: 'win_7', windowSeq: 7, model: 'big-model', capacityTokens: CAPACITY_BIG
    })
    const fired = budget1.thresholdNotice(state1, { estimatedInputTokens: 30_000, outputReserveTokens: 0 })
    expect(fired.threshold).toBe(0.25)
    await restore1.persist('threadA', 'threshold-notice')

    // Restart: restore is budget-read-only; the strategy creates the state
    // with the CURRENT model's capacity and applies the persisted marks once.
    const modes2 = new ContextWindowTurnModes(() => 'windows')
    const budget2 = new ContextWindowBudget({ profiles, nowIso: () => '2026-09-14T00:00:00.000Z' })
    const restore2 = new ContextWindowStateRestore({
      store: new FileContextWindowStateStore({ dataDir }), modes: modes2, budget: budget2, sessionStore,
      nowIso: () => '2026-09-14T00:00:00.000Z'
    })
    const strategy2 = new ContextWindowStrategyCoordinator({
      summary,
      mode: (threadId, turnId) => modes2.modeFor(threadId, turnId),
      transition,
      budget: budget2,
      capacityTokens: (model) => capacityFor(model),
      window: (threadId) => modes2.windowFor(threadId),
      establishWindow: (threadId, window) => modes2.setWindow(threadId, window),
      sessionStore,
      stateRestore: restore2
    })

    // Reviewer's measurement: capacity 100,000, request 1,000 tokens.
    const small = await strategy2.compactIfNeeded(compactInput({
      model: 'big-model',
      requestOverheadTokens: 0,
      requestInputTokens: 1_000,
      outputBudgetTokens: 4_000
    }))
    // 25% already covered pre-restart: no re-fire, and usage is 5%, not 100%.
    expect(small.notice).toBeUndefined()
    const state = budget2.stateFor('threadA', 'win_7')!
    expect(state.capacityTokens).toBe(CAPACITY_BIG)
    const reading = budget2.readUsage(state, { estimatedInputTokens: 1_000, outputReserveTokens: 4_000 })
    expect(reading.usageRatio).toBeCloseTo(0.05)
    // Remaining accounts for input + reserve + the persisted notice tokens.
    expect(state.noticeTokens).toBeGreaterThan(0)
    expect(reading.remainingTokens)
      .toBe(CAPACITY_BIG - 1_000 - 4_000 - state.noticeTokens)

    // Thresholds fire progressively: 64% crosses only the 50% mark.
    const mid = await strategy2.compactIfNeeded(compactInput({
      model: 'big-model',
      requestOverheadTokens: 0,
      requestInputTokens: 60_000,
      outputBudgetTokens: 4_000
    }))
    expect(mid.notice).toBeDefined()
    expect(mid.notice).not.toContain('75%')
    expect(state.coveredThresholds).toEqual([0.25, 0.5])

    // The production strategy path recalculates capacity when the selected
    // model changes in the same restored window.
    await strategy2.compactIfNeeded(compactInput({
      model: 'small-model',
      requestOverheadTokens: 0,
      requestInputTokens: 100,
      outputBudgetTokens: 100
    }))
    const switched = budget2.stateFor('threadA', 'win_7')!
    expect(switched.capacityTokens).toBe(CAPACITY_SMALL)
    const smallReading = budget2.readUsage(switched, { estimatedInputTokens: 100, outputReserveTokens: 100 })
    expect(smallReading.usageRatio)
      .toBeCloseTo((100 + 100 + switched.noticeTokens) / CAPACITY_SMALL)
  })

  it('returns summary outcomes untouched when the mode is unknown', async () => {
    const dispatch = new ContextWindowStrategyCoordinator({ summary })
    const outcome = await dispatch.compactIfNeeded(compactInput())
    expect(summarySpy).toHaveBeenCalledTimes(1)
    expect(outcome as HistoryCompactionOutcome).toMatchObject({ triggered: false })
  })
})
