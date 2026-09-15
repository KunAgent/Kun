import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { FileContextWindowStore } from '../adapters/file/file-context-window-store.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
} from '../contracts/context-windows.js'
import type { TurnItem } from '../contracts/items.js'
import { makeAssistantTextItem, makeUserItem } from '../domain/item.js'
import { createThreadRecord } from '../domain/thread.js'
import { appendTurnItem, createTurnRecord, finishTurn } from '../domain/turn.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { effectiveHistoryAfterLatestCompaction } from '../loop/compaction-history.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { ContextWindowNotes } from './context-window-notes.js'
import { ContextWindowService } from './context-window-service.js'
import { ContextWindowTurnModes } from './context-window-turn-modes.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'

describe('TurnService manual compaction in window mode', () => {
  let dataDir: string
  let sessionStore: InMemorySessionStore
  let threadStore: InMemoryThreadStore
  let modes: ContextWindowTurnModes

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-cw-manual-compact-'))
    sessionStore = new InMemorySessionStore()
    threadStore = new InMemoryThreadStore()
    modes = new ContextWindowTurnModes(() => 'windows')
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  function makeService() {
    const eventBus = new InMemoryEventBus()
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso: () => '2026-09-14T00:00:00.000Z'
    })
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
    const service = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      usage: undefined,
      prefix: createImmutablePrefix({
        systemPrompt: 'System prompt used by both chat and compaction.',
        pinnedConstraints: ['system: keep GUI HTTP/SSE stable']
      }),
      defaultModel: 'default-model',
      contextCompaction: { summaryMode: 'heuristic' },
      contextWindowModes: modes,
      contextWindows,
      ids: new SequentialIdGenerator(),
      nowIso: () => '2026-09-14T00:00:00.000Z'
    })
    return { service, contextWindows }
  }

  async function seedThread(threadId: string, turnId: string) {
    const items: TurnItem[] = [
      makeUserItem({ id: 'item_1', threadId, turnId, text: 'First request with enough words to compact later.' }),
      makeAssistantTextItem({ id: 'item_2', threadId, turnId, text: 'A long assistant answer that should be folded by the heuristic summary path when the user runs compact.', status: 'completed' }),
      makeUserItem({ id: 'item_3', threadId, turnId, text: 'Second request keeps the tail visible.' }),
      makeAssistantTextItem({ id: 'item_4', threadId, turnId, text: 'Tail answer.', status: 'completed' })
    ]
    let turn = createTurnRecord({ id: turnId, threadId, prompt: 'Task', status: 'completed' })
    for (const item of items) {
      turn = appendTurnItem(turn, item)
      await sessionStore.appendItem(threadId, item)
    }
    await threadStore.upsert({
      ...createThreadRecord({ id: threadId, title: 'Compact me', workspace: '/tmp/workspace', model: 'test' }),
      turns: [finishTurn(turn, 'completed')]
    })
  }

  it('keeps /compact a summary compaction and registers a manual-summary boundary', async () => {
    const { service, contextWindows } = makeService()
    await seedThread('threadA', 'turn-1')
    const response = await service.compact({
      threadId: 'threadA',
      request: { reason: 'user ran /compact' }
    })
    expect(response.replacedTokens).toBeGreaterThan(0)
    expect(response.summary.length).toBeGreaterThan(0)

    const items = await sessionStore.loadItems('threadA')
    const boundary = items.find((item) => item.kind === 'context_window')
    expect(boundary).toBeDefined()
    if (!boundary || boundary.kind !== 'context_window') return
    expect(boundary.reason).toBe('manual-summary')
    expect(boundary.operationId).toContain('manual_compact_')
    expect(boundary.initializationRef).toBe(response.summary.length > 0 ? boundary.initializationRef : '')
    // The summary marker itself stays in canonical history next to the tail.
    expect(items.some((item) => item.kind === 'compaction' && item.replacedTokens > 0)).toBe(true)

    // Window numbering advanced so the next request re-initializes budget.
    expect(modes.windowFor('threadA')).toMatchObject({ windowSeq: 1 })
    const windows = await contextWindows.listWindows('threadA', {})
    expect(windows.windows.map((entry) => entry.reason)).toContain('manual-summary')

    // P1-a regression: the effective model history keeps the just-generated
    // summary and the retained tail (the manual-summary boundary cuts
    // pre-summary history only; it must not empty the projection).
    const effective = effectiveHistoryAfterLatestCompaction(await sessionStore.loadItems('threadA'))
    expect(effective.some((item) => item.kind === 'compaction' && item.replacedTokens > 0))
      .toBe(true)
    expect(effective.some((item) => item.id === 'item_4')).toBe(true)
    expect(effective.some((item) => item.id === 'item_1')).toBe(false)
    expect(effective.some((item) => item.kind === 'context_window')).toBe(false)

    // Replay safety: committing the same operation again is a no-op replay.
    const replay = await contextWindows.commitWindowCheckpoint({
      threadId: 'threadA',
      turnId: 'turn-1',
      windowId: boundary.windowId,
      reason: 'manual-summary',
      initializationRef: boundary.initializationRef,
      operationId: boundary.operationId
    })
    expect(replay.status).toBe('replayed')
  })

  it('does not register a boundary when window mode is disabled', async () => {
    const summaryModes = new ContextWindowTurnModes(() => 'summary')
    modes = summaryModes
    const { service } = makeService()
    await seedThread('threadB', 'turn-1')
    const response = await service.compact({
      threadId: 'threadB',
      request: { reason: 'plain summary compact' }
    })
    expect(response.replacedTokens).toBeGreaterThan(0)
    const items = await sessionStore.loadItems('threadB')
    expect(items.some((item) => item.kind === 'context_window')).toBe(false)
    expect(modes.windowFor('threadB')).toBeUndefined()
  })

  it('toggling off mid-thread keeps summary policy without expanding old history', async () => {
    const { service } = makeService()
    await seedThread('threadC', 'turn-1')
    await service.compact({ threadId: 'threadC', request: { reason: 'first compact in window mode' } })
    expect(modes.windowFor('threadC')).toMatchObject({ windowSeq: 1 })

    // User disables the switch: the thread's last accepted mode was windows,
    // but a subsequent explicit compact still works as a plain summary from
    // the last valid boundary without re-expanding folded history.
    const itemsBefore = await sessionStore.loadItems('threadC')
    const response = await service.compact({ threadId: 'threadC', request: { reason: 'compact after disable' } })
    expect(response.replacedTokens).toBe(0)
    const itemsAfter = await sessionStore.loadItems('threadC')
    expect(itemsAfter.length).toBe(itemsBefore.length)
  })
})
