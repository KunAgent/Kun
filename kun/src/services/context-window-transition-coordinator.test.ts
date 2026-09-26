import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { FileContextWindowStore } from '../adapters/file/file-context-window-store.js'
import {
  CONTEXT_WINDOWS_NOTE_FILE_MAX_BYTES,
  CONTEXT_WINDOWS_NOTE_MAX_FILES_PER_THREAD,
  CONTEXT_WINDOWS_NOTE_TOTAL_MAX_BYTES
} from '../contracts/context-windows.js'
import type { TurnItem } from '../contracts/items.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { ContextWindowBudget } from '../loop/context-window-budget.js'
import { ContextWindowNotes } from './context-window-notes.js'
import { ContextWindowService } from './context-window-service.js'
import { ContextWindowTurnModes } from './context-window-turn-modes.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import {
  ContextWindowTransitionCoordinator,
  countOrdinaryWorkItems,
  exclusiveNewContextBatchError
} from './context-window-transition-coordinator.js'

const NOW = () => '2026-09-14T00:00:00.000Z'

function message(id: string, text: string): TurnItem {
  return {
    id, turnId: 'turn-1', threadId: 'threadA',
    kind: 'user_message', role: 'user', status: 'completed',
    createdAt: '2026-09-14T00:00:00.000Z', text
  }
}

describe('exclusiveNewContextBatchError', () => {
  it('allows a lone new_context call and batches without it', () => {
    expect(exclusiveNewContextBatchError([{ toolName: 'new_context' }])).toBeNull()
    expect(exclusiveNewContextBatchError([{ toolName: 'read' }, { toolName: 'bash' }])).toBeNull()
    expect(exclusiveNewContextBatchError([])).toBeNull()
  })

  it('rejects mixed batches before any side effect', () => {
    const error = exclusiveNewContextBatchError([
      { toolName: 'read' },
      { toolName: 'new_context' }
    ])
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toContain('on its own')
  })
})

describe('ContextWindowTransitionCoordinator', () => {
  let dataDir: string
  let sessionStore: InMemorySessionStore
  let events: RuntimeEventRecorder
  let eventBus: InMemoryEventBus
  let modes: ContextWindowTurnModes
  let budget: ContextWindowBudget
  let coordinator: ContextWindowTransitionCoordinator
  let contextWindows: ContextWindowService
  let runtimeEvents: RuntimeEvent[]

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'kun-cw-transition-'))
    sessionStore = new InMemorySessionStore()
    eventBus = new InMemoryEventBus()
    runtimeEvents = []
    eventBus.subscribe('threadA', (event) => runtimeEvents.push(event))
    events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso: () => '2026-09-14T00:00:00.000Z'
    })
    modes = new ContextWindowTurnModes(() => 'windows')
    budget = new ContextWindowBudget({ nowIso: () => '2026-09-14T00:00:00.000Z' })
    contextWindows = new ContextWindowService({
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
    coordinator = new ContextWindowTransitionCoordinator({
      contextWindows,
      events,
      modes,
      budget,
      ids: new SequentialIdGenerator(),
      sessionStore,
      requestItemCount: async (threadId) =>
        countOrdinaryWorkItems(await sessionStore.loadItems(threadId)),
      committedOperation: (threadId, operationId) =>
        contextWindows.hasWindowOperation(threadId, operationId)
    })
  })

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('commits one boundary, records one SSE event, and restarts the budget', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    const result = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-1', model: 'm'
    })
    expect(result.status).toBe('committed')
    if (result.status !== 'committed') return
    expect(result.windowSeq).toBe(1)

    const boundaryEvents = runtimeEvents.filter((event) => event.kind === 'context_window')
    expect(boundaryEvents).toHaveLength(1)
    expect(boundaryEvents[0]).toMatchObject({
      threadId: 'threadA', turnId: 'turn-1', itemId: result.itemId
    })
    expect(budget.stateFor('threadA', result.windowId)).toMatchObject({ windowSeq: 1, model: 'm' })
    expect(modes.windowFor('threadA')).toEqual({ windowId: result.windowId, windowSeq: 1 })

    // The turn continues in the same window: post-cut input stays queryable.
    await sessionStore.appendItem('threadA', message('u2', 'steered input'))
    const items = await sessionStore.loadItems('threadA')
    const ids = items.map((item) => item.id)
    expect(ids.indexOf('u2')).toBeGreaterThan(ids.indexOf(result.itemId))
  })

  it('replays the same operation id without a second boundary or event', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    const first = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-1'
    })
    const replay = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-1'
    })
    expect(first.status).toBe('committed')
    expect(replay.status).toBe('replayed')
    if (first.status === 'committed' && replay.status === 'replayed') {
      expect(replay.itemId).toBe(first.itemId)
      expect(replay.windowSeq).toBe(1)
    }
    expect(runtimeEvents.filter((event) => event.kind === 'context_window')).toHaveLength(1)
    expect(modes.windowFor('threadA')?.windowSeq).toBe(1)
  })

  it('blocks transitions while interactions are unresolved', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    const gated = new ContextWindowTransitionCoordinator({
      contextWindows: new ContextWindowService({
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
        })
      }),
      events, modes, ids: new SequentialIdGenerator(),
      hasPendingInteractions: () => true
    })
    const result = await gated.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-blocked'
    })
    expect(result.status).toBe('blocked')
    expect(result.status === 'blocked' ? result.reason : '').toContain('unresolved')
    expect((await sessionStore.loadItems('threadA')).every((item) => item.kind !== 'context_window'))
      .toBe(true)
  })

  it('rejects consecutive transitions without model or tool progress', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    const first = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-1'
    })
    expect(first.status).toBe('committed')

    const second = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-2'
    })
    expect(second.status).toBe('blocked')
    expect(second.status === 'blocked' ? second.reason : '').toContain('no model or tool progress')

    // Ordinary progress (a new persisted item) unblocks the next transition.
    await sessionStore.appendItem('threadA', message('u2', 'assistant did work'))
    const third = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-3'
    })
    expect(third.status).toBe('committed')
    if (third.status === 'committed') expect(third.windowSeq).toBe(2)
  })

  it('leaves the old window untouched when cancelled before commit', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    const controller = new AbortController()
    controller.abort()
    const result = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-cancel', signal: controller.signal
    })
    expect(result.status).toBe('cancelled')
    expect((await sessionStore.loadItems('threadA')).map((item) => item.id)).toEqual(['u1'])
    expect(modes.windowFor('threadA')).toBeUndefined()
  })

  it('excludes the invoking control call from the pending gate but blocks on other inflight tools', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    let gateCall = 0
    const gatedCoordinator = new ContextWindowTransitionCoordinator({
      contextWindows,
      events,
      modes,
      ids: new SequentialIdGenerator(),
      requestItemCount: async () => (await sessionStore.loadItems('threadA')).length,
      committedOperation: (threadId, operationId) =>
        contextWindows.hasWindowOperation(threadId, operationId),
      hasPendingInteractions: (_threadId, excludedCallId) => {
        gateCall += 1
        // Simulate one inflight tool record: the control call itself when no
        // exclusion is given, or a genuinely different parallel call.
        return excludedCallId !== 'call_nc1'
      }
    })
    const blocked = await gatedCoordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-blocked-gate'
    })
    expect(blocked.status).toBe('blocked')

    const committed = await gatedCoordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-self-gate',
      excludeInflightCallId: 'call_nc1'
    })
    expect(committed.status).toBe('committed')
    expect(gateCall).toBe(2)
  })

  it('P2-a: control records (init item, new_context pair) do not satisfy the progress guard', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    const first = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-p2a-1'
    })
    expect(first.status).toBe('committed')

    // The transition already appended the durable init item; add the
    // new_context control call/result pair. Raw item count grew, but none of
    // it is ordinary work.
    const controlCall: TurnItem = {
      id: 'tc_nc', turnId: 'turn-1', threadId: 'threadA',
      kind: 'tool_call', role: 'assistant', status: 'completed', createdAt: NOW(),
      toolName: 'new_context', callId: 'call_nc', toolKind: 'tool_call', arguments: {}
    }
    const controlResult: TurnItem = {
      id: 'tr_nc', turnId: 'turn-1', threadId: 'threadA',
      kind: 'tool_result', role: 'tool', status: 'completed', createdAt: NOW(),
      toolName: 'new_context', callId: 'call_nc', toolKind: 'tool_call', output: {}, isError: false
    }
    await sessionStore.appendItem('threadA', controlCall)
    await sessionStore.appendItem('threadA', controlResult)

    const second = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-p2a-2'
    })
    expect(second.status).toBe('blocked')
    expect(second.status === 'blocked' ? second.reason : '').toContain('no model or tool progress')

    // Ordinary assistant work unlocks the next transition.
    await sessionStore.appendItem('threadA', {
      id: 'a-real', turnId: 'turn-1', threadId: 'threadA',
      kind: 'assistant_text', role: 'assistant', status: 'completed', createdAt: NOW(),
      text: 'real progress'
    })
    const third = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-p2a-3'
    })
    expect(third.status).toBe('committed')
    if (third.status === 'committed') expect(third.windowSeq).toBe(2)
  })

  it('P1-b: replaying a committed operation backfills a lost initialization once', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    const first = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-crash'
    })
    expect(first.status).toBe('committed')
    if (first.status !== 'committed') return

    // Simulate the crash window: the checkpoint committed but the init item
    // was lost before durability.
    const items = await sessionStore.loadItems('threadA')
    await sessionStore.rewriteItems('threadA', items.filter((item) => !item.id.startsWith('cw_init_')))
    expect((await sessionStore.loadItems('threadA')).some((item) => item.id.startsWith('cw_init_')))
      .toBe(false)

    // Replay (same operation id) returns the committed result and backfills.
    const replay = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-crash'
    })
    expect(replay.status).toBe('replayed')
    const after = await sessionStore.loadItems('threadA')
    const initItems = after.filter((item) => item.id.startsWith('cw_init_'))
    expect(initItems).toHaveLength(1)
    expect(initItems[0]!.kind === 'runtime_context_source' ? initItems[0]!.content : '')
      .toContain('Current task message:')

    // A second replay does not duplicate the backfill.
    const again = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-crash'
    })
    expect(again.status).toBe('replayed')
    expect((await sessionStore.loadItems('threadA')).filter((item) => item.id.startsWith('cw_init_')))
      .toHaveLength(1)
  })

  it('exposes the transition to the tool provider seam', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    const run = coordinator.asToolTransition('m')
    const toolContext: ToolHostContext = {
      threadId: 'threadA',
      turnId: 'turn-1',
      workspace: '/tmp',
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow' as const
    }
    const argsRejected = await run(
      toolContext,
      { unexpected: true }
    )
    expect(argsRejected.isError).toBe(true)

    const committed = await run(
      toolContext,
      {}
    )
    expect(committed.isError).toBeUndefined()
    expect(committed.output).toMatchObject({ windowSeq: 1 })
    expect(budget.stateFor('threadA', (committed.output as { windowId: string }).windowId))
      .toMatchObject({ model: 'm' })
  })

  it('replays a committed new_context transition for a retried tool call', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    const run = coordinator.asToolTransition('m')
    const toolContext = (callId: string): ToolHostContext => ({
      threadId: 'threadA',
      turnId: 'turn-1',
      workspace: '/tmp',
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow' as const,
      activeToolCallId: callId
    })

    const first = await run(toolContext('call_nc1'), {})
    expect(first.isError).toBeUndefined()

    // Retried execution of the SAME call replays the committed boundary
    // instead of minting a new operation that the progress guard rejects.
    const retry = await run(toolContext('call_nc1'), {})
    expect(retry.isError).toBeUndefined()
    expect(retry.output).toMatchObject({ replayed: true })
    expect(
      (await sessionStore.loadItems('threadA'))
        .filter((item) => item.kind === 'context_window')
    ).toHaveLength(1)

    // A genuinely new call still hits the no-progress guard.
    const fresh = await run(toolContext('call_nc2'), {})
    expect(fresh.isError).toBe(true)
    expect(JSON.stringify(fresh.output)).toContain('no model or tool progress')
  })

  it('keeps the no-progress guard after a coordinator restart via durable history', async () => {
    await sessionStore.appendItem('threadA', message('u1', 'task'))
    const first = await coordinator.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-rs-1'
    })
    expect(first.status).toBe('committed')

    // A fresh coordinator (runtime restart) has no in-memory progress marker;
    // the guard must still see the latest boundary has no ordinary work after
    // it, derived from the persisted items themselves.
    const restarted = new ContextWindowTransitionCoordinator({
      contextWindows,
      events,
      modes,
      ids: new SequentialIdGenerator(),
      sessionStore,
      requestItemCount: async (threadId) =>
        countOrdinaryWorkItems(await sessionStore.loadItems(threadId)),
      committedOperation: (threadId, operationId) =>
        contextWindows.hasWindowOperation(threadId, operationId)
    })
    const second = await restarted.transition({
      threadId: 'threadA', turnId: 'turn-1', reason: 'model', operationId: 'op-rs-2'
    })
    expect(second.status).toBe('blocked')
    expect(second.status === 'blocked' ? second.reason : '')
      .toContain('no model or tool progress')
    expect((await sessionStore.loadItems('threadA'))
      .filter((item) => item.kind === 'context_window')).toHaveLength(1)
  })
})
