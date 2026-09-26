import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { FileSessionStore } from '../adapters/file/file-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { FileContextWindowStore } from '../adapters/file/file-context-window-store.js'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
} from '../contracts/context-windows.js'
import type { TurnItem } from '../contracts/items.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { SessionStore } from '../ports/session-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { appendTurnItem, createTurnRecord } from '../domain/turn.js'
import { ContextWindowBudget } from '../loop/context-window-budget.js'
import { ContextWindowNotes } from './context-window-notes.js'
import { ContextWindowService } from './context-window-service.js'
import { ContextWindowTurnModes } from './context-window-turn-modes.js'
import { ContextWindowTransitionCoordinator } from './context-window-transition-coordinator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ThreadService } from './thread-service.js'
import { buildWindowInitializationText } from './context-window-initialization.js'
import { QuotaExceededError } from '../adapters/file/file-context-window-store.js'

const NOW = () => '2026-09-14T00:00:00.000Z'
const NOTE_LIMITS = {
  maxFileBytes: CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  maxFilesPerThread: CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  maxTotalBytes: CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
}

function message(id: string, text: string, turnId = 'turn-1'): TurnItem {
  return {
    id, turnId, threadId: 'threadA',
    kind: 'user_message', role: 'user', status: 'completed',
    createdAt: NOW(), text
  }
}

describe('context-window end-to-end scenario (6.1)', () => {
  let dataDir: string

  const makeRuntime = () => {
    const sessionStore: SessionStore = new FileSessionStore({ dataDir })
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso: NOW
    })
    const modes = new ContextWindowTurnModes(() => 'windows')
    const contextWindows = new ContextWindowService({
      sessionStore,
      notes: new ContextWindowNotes({
        store: new FileContextWindowStore({ dataDir, limits: NOTE_LIMITS })
      }),
      ids: new SequentialIdGenerator()
    })
    return { sessionStore, threadStore, events, modes, contextWindows }
  }

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-cw-scenario-'))
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('note -> transition with concurrent input -> recovery -> continue -> restart -> fork', async () => {
    const runtime = makeRuntime()
    const { sessionStore, threadStore, events, modes, contextWindows } = runtime

    // 1. Seed history containing an earlier decision.
    await sessionStore.appendItem('threadA', message('u1', 'Decision: use Postgres for the ledger.'))
    await sessionStore.appendItem('threadA', message('a1', 'Acknowledged, Postgres it is.', 'turn-1'))

    // 2. Save a progress note before transitioning.
    await contextWindows.notes.writeFile('threadA', {
      path: 'progress/log.md',
      text: '- Chose Postgres; schema migration pending.',
      expectedRevision: 0
    })

    // 3. Transition WHILE new steering input races the commit: input that
    //    lands after the committed cut stays in the new window. The
    //    post-commit pressure-clear hook models that late arrival.
    let injected = false
    const coordinator = new ContextWindowTransitionCoordinator({
      contextWindows,
      events,
      modes,
      budget: new ContextWindowBudget({ nowIso: NOW }),
      ids: new SequentialIdGenerator(),
      requestItemCount: async (threadId) => (await sessionStore.loadItems(threadId)).length,
      committedOperation: (threadId, operationId) =>
        contextWindows.hasWindowOperation(threadId, operationId),
      clearRequestPressure: async (threadId) => {
        if (injected) return
        injected = true
        await sessionStore.appendItem(threadId, message('u-steer', 'Also handle EUR currency.'))
      }
    })
    const transition = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-transition'
    })
    expect(transition.status).toBe('committed')
    expect(injected).toBe(true)
    if (transition.status !== 'committed') return

    // The concurrent input landed AFTER the committed cut: it belongs to the
    // new window and was not overwritten by the transition.
    const items = await sessionStore.loadItems('threadA')
    const ids = items.map((item) => item.id)
    expect(ids.indexOf('u-steer')).toBeGreaterThan(ids.indexOf(transition.itemId))

    // 4. Search and recover the earlier decision from the old window.
    const search = await contextWindows.searchContents('threadA', { query: 'Postgres' })
    expect(search.matches.map((match) => [match.windowId, match.itemId]))
      .toContainEqual(['win-0', 'u1'])
    const recovered = await contextWindows.readItem('threadA', {
      windowId: 'win-0', itemId: 'u1'
    })
    expect(recovered.segments[0]?.text).toContain('Decision: use Postgres')
    const note = await contextWindows.notes.readFile('threadA', { path: 'progress/log.md' })
    expect(note.segments[0]?.text).toContain('schema migration pending')

    // 5. Continue the task in the new window.
    await sessionStore.appendItem('threadA', message('a2', 'Migration plan drafted.', 'turn-1'))
    const newWindow = await contextWindows.listItems('threadA', { windowId: transition.windowId })
    expect(newWindow.items.map((entry) => entry.itemId)).toEqual(['u-steer', 'a2'])
    const windows = await contextWindows.listWindows('threadA', {})
    expect(windows.windows.map((entry) => entry.windowId))
      .toEqual([transition.windowId, 'win-0'])

    // 6. Simulated restart: every runtime object is rebuilt from the persisted
    //    data dir, and the full scenario state is still queryable.
    const restarted = makeRuntime()
    const restartedWindows = await restarted.contextWindows.listWindows('threadA', {})
    expect(restartedWindows).toEqual(windows)
    const restartedRead = await restarted.contextWindows.readItem('threadA', {
      windowId: 'win-0', itemId: 'u1'
    })
    expect(restartedRead.segments[0]?.text).toContain('Decision: use Postgres')
    const restartedNote = await restarted.contextWindows.notes.readFile('threadA', {
      path: 'progress/log.md'
    })
    expect(restartedNote).toMatchObject({ revision: 1 })

    // 7. Fork history: the child gets the fork point's visible history,
    //    boundaries, and the note snapshot; later writes stay isolated.
    //    Mirror production: the thread record's turn items carry the same
    //    public items as canonical session history at the fork point.
    const allItems = await sessionStore.loadItems('threadA')
    const syncedTurn = allItems
      .filter((item) => item.turnId === 'turn-1')
      .reduce(
        (turn, item) => appendTurnItem(turn, item),
        createTurnRecord({ id: 'turn-1', threadId: 'threadA', prompt: 'Ledger task' })
      )
    await threadStore.upsert({
      ...createThreadRecord({
        id: 'threadA', title: 'Ledger task', workspace: '/tmp/ws', model: 'test'
      }),
      turns: [syncedTurn]
    })
    const threadService = new ThreadService({
      threadStore,
      sessionStore,
      events,
      ids: new SequentialIdGenerator(),
      nowIso: NOW,
      onForked: (source, target) => contextWindows.forkThreadData(source, target)
    })
    const fork = await threadService.fork('threadA')
    const childWindows = await contextWindows.listWindows(fork.id, {})
    expect(childWindows.windows.map((entry) => entry.windowId))
      .toEqual([transition.windowId, 'win-0'])
    const childItems = await sessionStore.loadItems(fork.id)
    expect(childItems.some((item) => item.kind === 'context_window')).toBe(true)
    const childNote = await contextWindows.notes.readFile(fork.id, { path: 'progress/log.md' })
    expect(childNote.segments[0]?.text).toContain('schema migration pending')

    await contextWindows.notes.appendToFile(fork.id, {
      path: 'progress/log.md', text: '\n- child only line', operationId: 'op-child'
    })
    const parentNoteAfter = await contextWindows.notes.readFile('threadA', {
      path: 'progress/log.md'
    })
    expect(parentNoteAfter.segments[0]?.text).not.toContain('child only line')

    // 8. Storage failure mid-scenario: appends accumulate until the per-file
    //    quota trips; the failing append is rejected wholesale and no
    //    existing data is lost or partially mutated.
    let lastGoodRevision = 1
    for (let index = 1; index <= 16; index += 1) {
      const outcome = await contextWindows.notes.appendToFile('threadA', {
        path: 'progress/log.md',
        text: `${index}:`.padEnd(9, 'x') + 'y'.repeat(16_000) + '\n',
        operationId: `op-fill-${index}`
      })
      lastGoodRevision = outcome.revision
    }
    expect(lastGoodRevision).toBe(17)
    await expect(contextWindows.notes.appendToFile('threadA', {
      path: 'progress/log.md',
      text: 'z'.repeat(16_000),
      operationId: 'op-overflow'
    })).rejects.toThrow(QuotaExceededError)
    const filesAfter = await contextWindows.notes.listFilesByPrefix('threadA', {})
    expect(filesAfter.files.map((file) => file.path)).toEqual(['progress/log.md'])
    const intact = await contextWindows.notes.readFile('threadA', { path: 'progress/log.md' })
    expect(intact.revision).toBe(17)
    expect(intact.segments[0]?.text.endsWith('z')).toBe(false)
  })

  it('recovers with no notes via the task pointer in window initialization', async () => {
    const { sessionStore, modes, contextWindows, events } = makeRuntime()
    await sessionStore.appendItem('threadB', {
      ...message('u-task', 'Build the invoice export.'),
      threadId: 'threadB'
    })
    const coordinator = new ContextWindowTransitionCoordinator({
      contextWindows,
      events,
      modes,
      ids: new SequentialIdGenerator(),
      requestItemCount: async () => 1
    })
    const transition = await coordinator.transition({
      threadId: 'threadB', turnId: 'turn-1', reason: 'model', operationId: 'op-no-notes'
    })
    expect(transition.status).toBe('committed')
    if (transition.status !== 'committed') return

    // No notes exist; the initialization text is the recovery anchor.
    const files = await contextWindows.notes.listFilesByPrefix('threadB', {})
    expect(files.files).toEqual([])
    const init = await buildWindowInitializationText({
      service: contextWindows,
      threadId: 'threadB',
      windowId: transition.windowId,
      windowSeq: 1,
      taskMessageId: 'u-task',
      remainingTokens: 800_000,
      capacityTokens: 1_000_000
    })
    expect(init).toContain('Current task message: u-task')
    expect(init).toContain('- (none yet)')

    // The model recovers the original task from window 0 via the history
    // tools without any note.
    const search = await contextWindows.searchContents('threadB', { query: 'invoice export' })
    expect(search.matches.map((match) => match.windowId)).toEqual(['win-0'])
    const read = await contextWindows.readItem('threadB', { windowId: 'win-0', itemId: 'u-task' })
    expect(read.segments[0]?.text).toBe('Build the invoice export.')
  })
})
