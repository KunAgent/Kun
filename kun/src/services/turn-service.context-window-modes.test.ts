import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ContextWindowMode } from '../contracts/context-windows.js'
import { createThreadRecord } from '../domain/thread.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { ContextWindowTurnModes } from './context-window-turn-modes.js'
import { TurnService } from './turn-service.js'

describe('TurnService context-window mode freeze', () => {
  it('freezes the accepted mode at admission; hot updates apply to the next turn', async () => {
    let live: ContextWindowMode = 'summary'
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const modes = new ContextWindowTurnModes(() => live)
    const service = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso: () => '2026-09-14T00:00:00.000Z'
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      contextWindowModes: modes,
      ids: new SequentialIdGenerator(),
      nowIso: () => '2026-09-14T00:00:00.000Z'
    })
    await threadStore.upsert(createThreadRecord({
      id: 'threadA',
      title: 'Mode freeze',
      workspace: '/tmp/workspace',
      model: 'test-model'
    }))

    const first = await service.startTurn({
      threadId: 'threadA',
      request: { prompt: 'first' }
    })
    expect(modes.modeFor('threadA', first.turnId)).toBe('summary')

    // Hot update while the first turn exists; the frozen turn is unaffected.
    live = 'windows'
    expect(modes.modeFor('threadA', first.turnId)).toBe('summary')
    // A later turn of the same thread picks the new setting up at admission.
    await service.interruptActiveTurns()
    const second = await service.startTurn({
      threadId: 'threadA',
      request: { prompt: 'second' }
    })
    expect(modes.modeFor('threadA', second.turnId)).toBe('windows')
    await service.interruptActiveTurns()
  })

  it('child threads inherit the parent accepted mode at admission', async () => {
    let live: ContextWindowMode = 'summary'
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const modes = new ContextWindowTurnModes(() => live)
    const service = new TurnService({
      threadStore,
      sessionStore,
      events: new RuntimeEventRecorder({
        eventBus,
        sessionStore,
        allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
        nowIso: () => '2026-09-14T00:00:00.000Z'
      }),
      inflight: new InflightTracker(),
      steering: new SteeringQueue(),
      compactor: new ContextCompactor(),
      contextWindowModes: modes,
      ids: new SequentialIdGenerator(),
      nowIso: () => '2026-09-14T00:00:00.000Z'
    })
    await threadStore.upsert(createThreadRecord({
      id: 'parent', title: 'Parent', workspace: '/tmp/workspace', model: 'test-model'
    }))

    const parent = await service.startTurn({ threadId: 'parent', request: { prompt: 'task' } })
    expect(modes.modeFor('parent', parent.turnId)).toBe('summary')
    await service.interruptActiveTurns()

    // Config flips to windows, then a child thread is delegated from the
    // parent: the child inherits the parent's accepted summary mode.
    live = 'windows'
    await threadStore.upsert({
      ...createThreadRecord({
        id: 'child', title: 'Child', workspace: '/tmp/workspace', model: 'test-model'
      }),
      parentThreadId: 'parent'
    })
    const child = await service.startTurn({ threadId: 'child', request: { prompt: 'subtask' } })
    expect(modes.modeFor('child', child.turnId)).toBe('summary')
    // Independent window state: the parent's window identity is not shared.
    modes.setWindow('parent', { windowId: 'win-1', windowSeq: 1 })
    expect(modes.windowFor('child')).toBeUndefined()
    await service.interruptActiveTurns()
  })
})
