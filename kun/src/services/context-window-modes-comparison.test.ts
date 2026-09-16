import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { FileContextWindowStore } from '../adapters/file/file-context-window-store.js'
import { createImmutablePrefix, type ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { UsageService } from './usage-service.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ContextWindowNotes } from './context-window-notes.js'
import { ContextWindowService } from './context-window-service.js'
import { ContextWindowTurnModes } from './context-window-turn-modes.js'
import { ContextWindowTransitionCoordinator } from './context-window-transition-coordinator.js'
import { ContextWindowBudget } from '../loop/context-window-budget.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { effectiveHistoryAfterLatestCompaction } from '../loop/compaction-history.js'
import { HistoryCompactionService } from '../loop/history-compaction-service.js'
import { ContextWindowStrategyCoordinator } from '../loop/context-window-strategy.js'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
} from '../contracts/context-windows.js'

const CAPACITY = 100_000
const HARD_CAP = 85_000
const SOFT_THRESHOLD = 60_000
const STEPS = 8
const BASE_INPUT = 45_000
const INPUT_GROWTH = 8_000

const NOW = () => '2026-09-14T00:00:00.000Z'

class CountingModel implements ModelClient {
  readonly provider = 'test'
  readonly model: string
  requests = 0
  constructor(model: string) {
    this.model = model
  }
  async *stream(_request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests += 1
    yield { kind: 'assistant_text_delta', text: 'step output' }
    yield { kind: 'usage', usage: { ...emptyUsageSnapshot(), promptTokens: 10, completionTokens: 5, totalTokens: 15 } }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

function stepItems(step: number): TurnItem[] {
  const base = {
    turnId: 'turn-1', threadId: 'thread-run',
    role: 'user' as const, status: 'completed' as const, createdAt: NOW()
  }
  return [
    { ...base, id: `u${step}`, kind: 'user_message', text: `step ${step} request` },
    { ...base, id: `a${step}`, kind: 'assistant_text', role: 'assistant', text: `step ${step} result` }
  ]
}

type RunMetrics = {
  mode: 'summary' | 'windows'
  modelRequests: number
  summaryModelCalls: number
  compactions: number
  transitions: number
  notices: number
  retrievalBytes: number
  resumedTailIds: string[]
  prefixStable: boolean
}

async function runScriptedTask(mode: 'summary' | 'windows', dataDir: string): Promise<RunMetrics> {
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso: NOW
  })
  const mainModel = new CountingModel('main-model')
  const summaryModel = new CountingModel('summary-model')
  const prefix = createImmutablePrefix({
    systemPrompt: 'Stable Kun system prefix for the comparison run.',
    pinnedConstraints: ['system: keep the prefix byte-stable']
  })
  const prefixBefore = JSON.stringify(prefix)
  let promptPressure: { model: string; promptTokens: number } | undefined
  const summary = new HistoryCompactionService({
    sessionStore,
    compactor: new ContextCompactor({
      contextCompaction: {
        defaultSoftThreshold: SOFT_THRESHOLD,
        defaultHardThreshold: HARD_CAP,
        summaryMode: 'model',
        summaryModel: 'summary-model',
        summaryMaxTokens: 256
      }
    }),
    prefix,
    model: summaryModel,
    usage: new UsageService(),
    events,
    ids: new SequentialIdGenerator(),
    telemetry: { consumePromptPressure: () => promptPressure },
    getContextCompaction: () => ({
      defaultSoftThreshold: SOFT_THRESHOLD,
      defaultHardThreshold: HARD_CAP,
      summaryMode: 'model' as const,
      summaryModel: 'summary-model',
      summaryMaxTokens: 256
    }),
    recordGoalUsage: async () => {},
    rewriteThreadItemsFromSession: async () => {}
  })
  const modes = new ContextWindowTurnModes(() => mode)
  modes.freeze({ threadId: 'thread-run', turnId: 'turn-1' })
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
  const transition = new ContextWindowTransitionCoordinator({
    contextWindows,
    events,
    modes,
    budget: new ContextWindowBudget({ nowIso: NOW }),
    ids: new SequentialIdGenerator(),
    requestItemCount: async () => (await sessionStore.loadItems('thread-run')).length,
    committedOperation: (threadId, operationId) =>
      contextWindows.hasWindowOperation(threadId, operationId)
  })
  const strategy = new ContextWindowStrategyCoordinator({
    summary,
    mode: (threadId, turnId) => modes.modeFor(threadId, turnId),
    transition,
    budget: new ContextWindowBudget({ nowIso: NOW }),
    capacityTokens: () => CAPACITY,
    window: (threadId) => modes.windowFor(threadId),
    sessionStore
  })

  const metrics: RunMetrics = {
    mode, modelRequests: 0, summaryModelCalls: 0, compactions: 0,
    transitions: 0, notices: 0, retrievalBytes: 0, resumedTailIds: [], prefixStable: true
  }

  for (let step = 1; step <= STEPS; step += 1) {
    for (const item of stepItems(step)) await sessionStore.appendItem('thread-run', item)
    const items = await sessionStore.loadItems('thread-run')
    const requestInput = BASE_INPUT + step * INPUT_GROWTH
    promptPressure = { model: 'main-model', promptTokens: requestInput }
    const outcome = await strategy.compactIfNeeded({
      items,
      model: 'main-model',
      signal: new AbortController().signal,
      threadId: 'thread-run',
      turnId: 'turn-1',
      requestOverheadTokens: 8_000,
      requestInputTokens: requestInput,
      outputBudgetTokens: 4_000,
      reserveModelRequest: async () => ({ allowed: true })
    })
    metrics.modelRequests += 1
    metrics.summaryModelCalls = summaryModel.requests
    if (outcome.compacted && outcome.windowTransition) metrics.transitions += 1
    else if (outcome.compacted) metrics.compactions += 1
    if (outcome.notice) metrics.notices += 1

    if (mode === 'windows' && step === STEPS - 1) {
      // Representative recovery work: search + read + note round trip.
      const search = await contextWindows.searchContents('thread-run', { query: 'step 1' })
      for (const match of search.matches) {
        const read = await contextWindows.readItem('thread-run', {
          windowId: match.windowId, itemId: match.itemId
        })
        metrics.retrievalBytes += Buffer.byteLength(read.segments.map((s) => s.text).join(''), 'utf8')
      }
      await contextWindows.notes.appendToFile('thread-run', {
        path: 'progress/log.md', text: '- checkpoint', operationId: `note-${step}`
      })
      const note = await contextWindows.notes.readFile('thread-run', { path: 'progress/log.md' })
      metrics.retrievalBytes += Buffer.byteLength(note.segments.map((s) => s.text).join(''), 'utf8')
    }
  }

  metrics.prefixStable = JSON.stringify(prefix) === prefixBefore
  // Simulated restart: reload canonical items and project the model history.
  const reloaded = JSON.parse(JSON.stringify(await sessionStore.loadItems('thread-run'))) as TurnItem[]
  const resumed = effectiveHistoryAfterLatestCompaction(reloaded)
  metrics.resumedTailIds = resumed.slice(-2).map((item) => item.id)
  return metrics
}

describe('6.3 window vs summary scripted-task comparison', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-cw-comparison-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('runs the same scripted task under both strategies and reports the deltas', async () => {
    const summaryRun = await runScriptedTask('summary', dataDir)
    const windowRun = await runScriptedTask('windows', dataDir)

    console.log([
      '',
      'strategy | model reqs | summary-model calls | summary compactions | window transitions | budget notices | retrieval bytes | resumed tail | prefix stable',
      `${summaryRun.mode} | ${summaryRun.modelRequests} | ${summaryRun.summaryModelCalls} | ${summaryRun.compactions} | ${summaryRun.transitions} | ${summaryRun.notices} | ${summaryRun.retrievalBytes} | ${summaryRun.resumedTailIds.join(',')} | ${summaryRun.prefixStable}`,
      `${windowRun.mode} | ${windowRun.modelRequests} | ${windowRun.summaryModelCalls} | ${windowRun.compactions} | ${windowRun.transitions} | ${windowRun.notices} | ${windowRun.retrievalBytes} | ${windowRun.resumedTailIds.join(',')} | ${windowRun.prefixStable}`,
      ''
    ].join('\n'))

    // Both strategies carry the task to completion. The summary run's
    // resumed history ends with the final step's assistant output (summary
    // compaction may fold the last user request into the summary). The
    // window run transitioned again on the final crossing (P1-c: same-turn
    // transitions are now per-window), so its active window is fresh and the
    // model continues from the durable initialization + history tools.
    expect(summaryRun.resumedTailIds.at(-1)).toBe(`a${STEPS}`)
    expect(windowRun.resumedTailIds).toEqual([])
    expect(windowRun.transitions).toBeGreaterThanOrEqual(2)
    // The pressure path in window mode never calls the summary model.
    expect(windowRun.summaryModelCalls).toBe(0)
    expect(summaryRun.summaryModelCalls).toBeGreaterThan(0)
    // Window mode resolves hard pressure with deterministic transitions, not
    // summary compactions; summary mode compacts instead.
    expect(windowRun.transitions).toBeGreaterThanOrEqual(1)
    expect(windowRun.compactions).toBe(0)
    expect(summaryRun.compactions).toBeGreaterThanOrEqual(1)
    // Retrieval is bounded and paid only in window mode.
    expect(windowRun.retrievalBytes).toBeGreaterThan(0)
    expect(windowRun.retrievalBytes).toBeLessThan(16 * 1024 * 4)
    // The immutable system prefix stays byte-stable through the window run.
    expect(windowRun.prefixStable).toBe(true)
  })
})
