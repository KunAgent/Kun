import { describe, expect, it, vi } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import type { StartTurnRequest } from '../contracts/turns.js'
import type { DesignTaskProfileInput } from '../contracts/design-task-profile.js'
import { createThreadRecord } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnService } from './turn-service.js'

const profile: DesignTaskProfileInput = {
  version: 1, documentTarget: { documentId: 'doc', boardArtifactId: 'board' },
  outputMedium: 'html', target: 'web', preset: 'none', context: { tone: [] }
}
const design: Partial<StartTurnRequest> = {
  agentSurface: 'design', designProfile: profile, designDocumentTarget: profile.documentTarget
}

async function createHarness(harnessId?: string, providerId?: string) {
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const nowIso = () => new Date().toISOString()
  const createGraphPlanningDraft = vi.fn()
  const turns = new TurnService({
    threadStore, sessionStore,
    events: new RuntimeEventRecorder({ eventBus, sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId), nowIso }),
    inflight: new InflightTracker(), steering: new SteeringQueue(), compactor: new ContextCompactor(),
    ids: new SequentialIdGenerator(), nowIso, createGraphPlanningDraft,
    providerKinds: () => ({ byId: { subscription: 'agent-sdk' }, defaultKind: 'http' })
  })
  await threadStore.upsert({ ...createThreadRecord({ id: 'thread', title: 'Task',
    workspace: '/tmp/workspace', model: 'test', agentSurface: 'code' }),
    ...(harnessId ? { harnessId } : {}), ...(providerId ? { providerId } : {}) })
  return { turns, threadStore, sessionStore, createGraphPlanningDraft }
}

const intents: Partial<StartTurnRequest>[] = [design, { guiDesignMode: true },
  { guiDesignCanvas: true }, { guiExcalidrawCanvas: true }, { mode: 'plan' },
  { orchestration: 'graph' }, { planBuild: true },
  { guiPlan: { operation: 'refine', workspaceRoot: '/repo', relativePath: '.kunsdd/plan/a.md', planId: 'a' } }]

describe('Kun workflow admission', () => {
  it('checks the effective thread mode for direct callers that omit mode', async () => {
    const h = await createHarness('claude-code')
    const thread = (await h.threadStore.get('thread'))!
    await h.threadStore.upsert({ ...thread, mode: 'plan' })
    await expect(h.turns.startTurn({ threadId: 'thread', request: { prompt: 'Continue' } }))
      .rejects.toThrow('require Kun Agent')
    await expect(h.turns.startTurn({ threadId: 'thread', request: { prompt: 'Ordinary task', mode: 'agent' } }))
      .resolves.toMatchObject({ threadId: 'thread' })
  })

  it('freezes omitted agent mode for an external worker before later thread settings change', async () => {
    const h = await createHarness('claude-code')
    const thread = (await h.threadStore.get('thread'))!
    await h.threadStore.upsert({ ...thread, relation: 'side', parentThreadId: 'kun-parent' })
    const first = await h.turns.startTurn({ threadId: 'thread', request: { prompt: 'Worker task' } })
    const queued = await h.turns.startTurn({ threadId: 'thread', request: { prompt: 'Next task', enqueueIfBusy: true } })
    const current = (await h.threadStore.get('thread'))!
    await h.threadStore.upsert({ ...current, mode: 'plan' })
    await h.turns.finishTurn({ threadId: 'thread', turnId: first.turnId, status: 'completed' })
    expect(await h.turns.startNextQueuedTurn('thread')).toEqual({ turnId: queued.turnId })
    expect((await h.threadStore.get('thread'))?.turns[1]).toMatchObject({
      status: 'running', harnessId: 'claude-code', mode: 'agent', orchestration: 'direct'
    })
  })

  it.each(intents)('rejects external workflow before persisting an admitted or queued turn: %j', async (intent) => {
    for (const enqueue of [false, true]) {
      const h = await createHarness('claude-code')
      if (enqueue) await h.turns.startTurn({ threadId: 'thread', request: { prompt: 'Ordinary Agent task' } })
      const before = await h.sessionStore.loadItems('thread')
      await expect(h.turns.startTurn({ threadId: 'thread', request: {
        prompt: 'Use a Kun workflow', enqueueIfBusy: enqueue, ...intent
      } })).rejects.toThrow('require Kun Agent')
      expect((await h.threadStore.get('thread'))?.turns).toHaveLength(enqueue ? 1 : 0)
      expect(await h.sessionStore.loadItems('thread')).toEqual(before)
      expect(h.createGraphPlanningDraft).not.toHaveBeenCalled()
    }
  })

  it('preserves old unpinned provider-kind inference for admission', async () => {
    const h = await createHarness(undefined, 'subscription')
    await expect(h.turns.startTurn({ threadId: 'thread', request: {
      prompt: 'Design', ...design
    } })).rejects.toThrow('require Kun Agent')
    const response = await h.turns.startTurn({ threadId: 'thread', request: {
      prompt: 'Fix this code', agentSurface: 'code', mode: 'agent'
    } })
    expect((await h.threadStore.get('thread'))?.turns[0]).toMatchObject({
      id: response.turnId, harnessId: 'claude-code', agentSurface: 'code'
    })
  })

  it('allows an explicit handoff from an external Agent to Kun Design', async () => {
    const h = await createHarness('codex', 'subscription')
    await h.turns.startTurn({ threadId: 'thread', request: {
      prompt: 'Design with Kun', harnessId: 'kun', providerId: 'http', ...design
    } })
    expect((await h.threadStore.get('thread'))?.turns[0]).toMatchObject({
      harnessId: 'kun', agentSurface: 'design', designProfile: { documentTarget: profile.documentTarget }
    })
  })

  it.each([false, true])('rejects explicit Kun with a native provider before persistence (enqueue %s)', async (enqueue) => {
    const h = await createHarness()
    if (enqueue) await h.turns.startTurn({ threadId: 'thread', request: { prompt: 'First task' } })
    const before = await h.sessionStore.loadItems('thread')
    await expect(h.turns.startTurn({ threadId: 'thread', request: {
      prompt: 'Run a disabled subscription', harnessId: 'kun', providerId: 'subscription', enqueueIfBusy: enqueue
    } })).rejects.toThrow('Kun Agent cannot use an external Agent provider')
    expect((await h.threadStore.get('thread'))?.turns).toHaveLength(enqueue ? 1 : 0)
    expect(await h.sessionStore.loadItems('thread')).toEqual(before)
  })

  it('keeps a queued Kun Design route when the thread later selects an external Agent', async () => {
    const h = await createHarness('kun')
    const first = await h.turns.startTurn({ threadId: 'thread', request: { prompt: 'First' } })
    const queued = await h.turns.startTurn({ threadId: 'thread', request: {
      prompt: 'Design next', enqueueIfBusy: true, ...design
    } })
    const thread = (await h.threadStore.get('thread'))!
    await h.threadStore.upsert({ ...thread, harnessId: 'codex' })
    await h.turns.finishTurn({ threadId: 'thread', turnId: first.turnId, status: 'completed' })
    expect(await h.turns.startNextQueuedTurn('thread')).toEqual({ turnId: queued.turnId })
    expect((await h.threadStore.get('thread'))?.turns[1]).toMatchObject({
      status: 'running', harnessId: 'kun', agentSurface: 'design'
    })
  })
})
