import { ROOM_GOAL_MAX_TIME_SECONDS, ROOM_GOAL_MAX_TOKENS } from './goal-execution-budget.js'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import type { TurnItem } from '../contracts/items.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord, startTurn } from '../domain/turn.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { TurnService } from '../services/turn-service.js'
import type { UsageService } from '../services/usage-service.js'
import { TurnBudgetGate } from './turn-budget-gate.js'

const threadId = 'thread_budget_gate'
const turnId = 'turn_budget_gate'

function harness(costUsd: number, totalTokens = 0) {
  let currentCostUsd = costUsd
  let currentTotalTokens = totalTokens
  const threadStore = new InMemoryThreadStore()
  const effects: string[] = []
  const items: TurnItem[] = []
  const events = {
    record: vi.fn(async (draft: { kind?: string; code?: string }) => {
      effects.push(`event:${draft.code}`)
      return draft
    })
  } as unknown as Pick<RuntimeEventRecorder, 'record'>
  const turns = {
    applyItem: vi.fn(async (_threadId: string, item: TurnItem) => {
      effects.push(`item:${item.kind === 'error' ? item.code : item.kind}`)
      items.push(item)
    })
  } as Pick<TurnService, 'applyItem'>
  const usage = {
    forThread: () => ({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: currentTotalTokens,
      cacheHitRate: null,
      turns: 0,
      costUsd: currentCostUsd
    })
  } satisfies Pick<UsageService, 'forThread'>
  const gate = new TurnBudgetGate({
    threadStore,
    turns,
    events,
    usage,
    nowIso: () => '2026-07-11T00:00:00.000Z'
  })
  return {
    gate,
    threadStore,
    effects,
    items,
    events,
    turns,
    setUsage: (next: { costUsd?: number; totalTokens?: number }) => {
      if (next.costUsd !== undefined) currentCostUsd = next.costUsd
      if (next.totalTokens !== undefined) currentTotalTokens = next.totalTokens
    }
  }
}

describe('TurnBudgetGate', () => {
  it('blocks a usage-limited goal without adding a duplicate visible item', async () => {
    const h = harness(0)
    const thread = createThreadRecord({
      id: threadId,
      title: 'goal budget',
      workspace: '/',
      model: 'm',
      goal: {
        threadId,
        objective: 'work',
        status: 'usageLimited',
        tokenBudget: 10,
        tokensUsed: 10,
        timeUsedSeconds: 0,
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z'
      }
    })

    await expect(h.gate.check(thread, threadId, turnId)).resolves.toBe('blocked')
    expect(h.effects).toEqual(['event:goal_token_budget_limited'])
    expect(h.items).toEqual([])
  })

  it('checks private goal ceilings before another request and persists the limit across restart', async () => {
    for (const kind of ['tokens', 'time'] as const) {
      const h = harness(0)
      const thread = createThreadRecord({ id: threadId, title: 'private goal', workspace: '/', model: 'm',
        goal: { threadId, objective: 'finish', status: 'active', tokenBudget: null,
          tokensUsed: kind === 'tokens' ? ROOM_GOAL_MAX_TOKENS : 0,
          timeUsedSeconds: kind === 'time' ? ROOM_GOAL_MAX_TIME_SECONDS - 1 : 0,
          createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z' }
      })
      thread.roomContext = { roomId: 'room', memberId: 'member', kind: 'conversation',
        blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] }
      thread.turns = [startTurn(createTurnRecord({ id: turnId, threadId, prompt: 'continue',
        createdAt: '2026-07-10T23:59:58.000Z' }), '2026-07-10T23:59:58.000Z')]
      await h.threadStore.upsert(thread)
      expect(await h.gate.check(thread, threadId, turnId)).toBe('blocked')
      const persisted = (await h.threadStore.get(threadId))!
      expect(persisted.goal?.status).toBe(kind === 'tokens' ? 'usageLimited' : 'budgetLimited')
      expect(await h.gate.check(persisted, threadId, turnId)).toBe('blocked')
      expect(h.effects.filter((effect) => effect === 'event:undefined')).toHaveLength(1)
    }
  })

  it('persists the exhausted-cost item before its event', async () => {
    const h = harness(2)
    const thread = createThreadRecord({
      id: threadId,
      title: 'cost budget',
      workspace: '/',
      model: 'm',
      costBudgetUsd: 1
    })

    await expect(h.gate.check(thread, threadId, turnId)).resolves.toBe('blocked')
    expect(h.effects).toEqual(['item:budget_limited', 'event:budget_limited'])
  })

  it('marks and emits the 80 percent warning only once', async () => {
    const h = harness(0.85)
    const thread = createThreadRecord({
      id: threadId,
      title: 'cost warning',
      workspace: '/',
      model: 'm',
      costBudgetUsd: 1
    })
    await h.threadStore.upsert(thread)

    await expect(h.gate.check(thread, threadId, turnId)).resolves.toBe('allow')
    const updated = await h.threadStore.get(threadId)
    expect(updated?.costBudgetWarningSent).toBe(true)
    await expect(h.gate.check(updated!, threadId, turnId)).resolves.toBe('allow')
    expect(h.effects).toEqual(['item:budget_warning', 'event:budget_warning'])
  })

  it('enforces extension token budgets relative to the persisted run baseline', async () => {
    const h = harness(0, 15)
    const thread = createThreadRecord({
      id: threadId,
      title: 'extension budget',
      workspace: '/',
      model: 'm',
      extensionBudget: extensionBudget()
    })
    thread.turns = [startTurn(createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'run',
      extensionBudgetTokenBaseline: 5,
      createdAt: '2026-07-11T00:00:00.000Z'
    }), '2026-07-11T00:00:00.000Z')]
    await h.threadStore.upsert(thread)

    await expect(h.gate.check(thread, threadId, turnId)).resolves.toBe('blocked')
    expect(h.effects).toEqual([
      'item:extension_budget_exhausted',
      'event:extension_budget_exhausted'
    ])
  })

  it('persists the model-request count before an allowed extension request', async () => {
    const h = harness(0, 4)
    const thread = createThreadRecord({
      id: threadId,
      title: 'extension request count',
      workspace: '/',
      model: 'm',
      extensionBudget: { ...extensionBudget(), maxTokens: 100 }
    })
    thread.turns = [{
      ...startTurn(createTurnRecord({
        id: turnId,
        threadId,
        prompt: 'run',
        extensionBudgetTokenBaseline: 0,
        createdAt: '2026-07-11T00:00:00.000Z'
      }), '2026-07-11T00:00:00.000Z'),
      extensionModelRequests: 1
    }]
    await h.threadStore.upsert(thread)

    await expect(h.gate.check(thread, threadId, turnId)).resolves.toBe('allow')
    expect((await h.threadStore.get(threadId))?.turns[0]?.extensionModelRequests).toBe(2)
  })

  it('atomically preserves concurrent main and compaction model-request reservations', async () => {
    const h = harness(0)
    const thread = createThreadRecord({
      id: threadId,
      title: 'atomic request count',
      workspace: '/',
      model: 'm',
      extensionBudget: { ...extensionBudget(), maxTokens: 100 }
    })
    thread.turns = [startTurn(createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'run',
      extensionBudgetTokenBaseline: 0,
      createdAt: '2026-07-11T00:00:00.000Z'
    }), '2026-07-11T00:00:00.000Z')]
    await h.threadStore.upsert(thread)

    const [main, compaction] = await Promise.all([
      h.gate.check(thread, threadId, turnId),
      h.gate.reserveAdditionalModelRequest(threadId, turnId)
    ])

    expect(main).toBe('allow')
    expect(compaction.allowed).toBe(true)
    expect((await h.threadStore.get(threadId))?.turns[0]?.extensionModelRequests).toBe(2)
  })

  it('rechecks auxiliary usage without consuming a second main-request reservation', async () => {
    const h = harness(0)
    const thread = createThreadRecord({
      id: threadId,
      title: 'post-compaction budget',
      workspace: '/',
      model: 'm',
      extensionBudget: extensionBudget()
    })
    thread.turns = [startTurn(createTurnRecord({
      id: turnId,
      threadId,
      prompt: 'run',
      extensionBudgetTokenBaseline: 0,
      createdAt: '2026-07-11T00:00:00.000Z'
    }), '2026-07-11T00:00:00.000Z')]
    await h.threadStore.upsert(thread)

    await expect(h.gate.check(thread, threadId, turnId)).resolves.toBe('allow')
    expect((await h.threadStore.get(threadId))?.turns[0]?.extensionModelRequests).toBe(1)

    h.setUsage({ totalTokens: 10 })
    await expect(h.gate.recheckReservedMainModelRequest(threadId, turnId)).resolves.toBe('blocked')
    expect((await h.threadStore.get(threadId))?.turns[0]?.extensionModelRequests).toBe(1)
    expect(h.effects).toEqual([
      'item:extension_budget_exhausted',
      'event:extension_budget_exhausted'
    ])
  })
})

function extensionBudget() {
  return {
    maxTokens: 10,
    maxElapsedMs: 60_000,
    maxConcurrentRuns: 1,
    maxModelRequests: 2,
    maxToolInvocations: 2,
    maxRetainedEvents: 100
  }
}
