import { describe, expect, it, vi } from 'vitest'
import { makeGoalContextItem } from '../domain/item.js'
import {
  ExtensionBrokerError,
  type ExtensionAgentEvent
} from './extension-agent-service.js'
import {
  createExtensionAgentHarness as createHarness,
  extensionAgentPrincipal as principal,
  workspace
} from './extension-agent-service.test-support.js'

describe('ExtensionAgentService', () => {
  it('creates an owned run with a clamped immutable profile snapshot', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), {
      input: 'Review this workspace',
      workspace,
      profileId: 'reviewer',
      visibility: 'workspace',
      budget: { maxTokens: 900_000 },
      allowedTools: ['read']
    })

    expect(run).toMatchObject({
      ownerExtensionId: 'com.example.agent',
      ownerExtensionVersion: '1.2.3',
      workspace,
      status: 'running',
      visibility: 'workspace',
      effectiveBudget: { maxTokens: 500_000 },
      profile: {
        id: 'reviewer',
        model: 'example-model',
        providerId: 'example-provider',
        accountId: 'account_1',
        allowedToolScopes: ['read']
      },
      toolCatalogEpoch: { id: 'epoch_1' }
    })
    expect(h.launched).toEqual([{ threadId: run.threadId, turnId: run.id }])
    const persisted = await h.threads.get(run.threadId)
    expect(persisted).toMatchObject({
      ownerExtensionId: 'com.example.agent',
      accountId: 'account_1',
      extensionBudget: { maxTokens: 500_000 },
      turns: [expect.objectContaining({ accountId: 'account_1' })]
    })

    await h.turns.finishTurn({
      threadId: run.threadId,
      turnId: run.id,
      status: 'completed'
    })
    const resumed = await h.service.createRun(principal(), {
      threadId: run.threadId,
      input: 'Continue with the same account',
      workspace
    })
    expect((await h.threads.get(run.threadId))?.turns.find(({ id }) => id === resumed.id))
      .toMatchObject({ accountId: 'account_1' })
  })

  it('does not reveal foreign threads or permit owner spoofing', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'Owned run', workspace })

    await expect(h.service.getRun(principal('com.example.foreign'), run.id)).rejects.toMatchObject({
      code: 'not_found'
    })
    await expect(h.service.getOwnThread(principal('com.example.foreign'), run.threadId)).rejects.toBeInstanceOf(
      ExtensionBrokerError
    )
  })

  it('pages owned threads with a safe latest run and filters completed conversations', async () => {
    const h = createHarness()
    const completedRun = await h.service.createRun(principal(), {
      input: 'Completed conversation',
      workspace
    })
    await h.turns.finishTurn({
      threadId: completedRun.threadId,
      turnId: completedRun.id,
      status: 'completed'
    })
    const activeRun = await h.service.createRun(principal(), {
      input: 'Active conversation',
      workspace
    })
    await h.events.record({
      kind: 'approval_requested',
      threadId: activeRun.threadId,
      turnId: activeRun.id,
      approvalId: 'approval-listing',
      toolName: 'write',
      status: 'pending'
    })
    const getThread = vi.spyOn(h.threads, 'get')
    const iterateEvents = vi.spyOn(h.sessions, 'iterateEventsSince')

    const first = await h.service.listOwnThreads(principal(), { limit: 1 })
    expect(getThread).toHaveBeenCalledTimes(1)
    expect(iterateEvents).toHaveBeenCalledTimes(1)
    const second = await h.service.listOwnThreads(principal(), {
      limit: 1,
      cursor: first.nextCursor
    })
    const items = [...first.items, ...second.items]

    expect(first.nextCursor).toBeDefined()
    expect(second.nextCursor).toBeUndefined()
    expect(items.map((thread) => thread.latestRun?.id).sort()).toEqual(
      [activeRun.id, completedRun.id].sort()
    )
    expect(items.find((thread) => thread.id === completedRun.threadId)?.latestRun).toMatchObject({
      id: completedRun.id,
      status: 'completed',
      finishedAt: expect.any(String),
      ownerExtensionId: 'com.example.agent'
    })
    expect(items.find((thread) => thread.id === activeRun.threadId)?.latestRun).toMatchObject({
      id: activeRun.id,
      status: 'waiting-approval'
    })
    await expect(h.service.getOwnThread(principal(), completedRun.threadId)).resolves.toMatchObject({
      latestRun: { id: completedRun.id, status: 'completed' }
    })
    getThread.mockClear()
    iterateEvents.mockClear()
    await expect(h.service.listOwnThreads(principal(), { state: 'completed' })).resolves.toMatchObject({
      items: [{ id: completedRun.threadId, latestRun: { id: completedRun.id, status: 'completed' } }]
    })
    expect(getThread).toHaveBeenCalledTimes(2)
    expect(iterateEvents).toHaveBeenCalledTimes(2)
    await expect(h.service.listOwnThreads(principal(), { state: 'waiting-approval' })).resolves.toMatchObject({
      items: [{ id: activeRun.threadId, latestRun: { id: activeRun.id, status: 'waiting-approval' } }]
    })
  })

  it('enforces permission, workspace, account, steering, and idempotent cancellation', async () => {
    const h = createHarness()
    const denied = { ...principal(), permissions: ['agent.threads.readOwn'] }
    await expect(h.service.createRun(denied, { input: 'Denied', workspace })).rejects.toMatchObject({
      code: 'permission_denied'
    })
    await expect(h.service.createRun(principal(), {
      input: 'Outside', workspace: '/tmp/not-granted'
    })).rejects.toMatchObject({ code: 'workspace_denied' })

    const run = await h.service.createRun(principal(), { input: 'Control me', workspace })
    await h.service.steer(principal(), run.id, 'Use the smaller scope')
    expect((await h.service.getRun(principal(), run.id)).status).toBe('running')
    expect((await h.service.cancel(principal(), run.id)).status).toBe('cancelled')
    expect((await h.service.cancel(principal(), run.id)).status).toBe('cancelled')
  })

  it('admits concurrent run creation atomically per extension', async () => {
    const h = createHarness()
    const results = await Promise.allSettled([
      h.service.createRun(principal(), {
        input: 'Concurrent run A',
        workspace,
        budget: { maxConcurrentRuns: 1 }
      }),
      h.service.createRun(principal(), {
        input: 'Concurrent run B',
        workspace,
        budget: { maxConcurrentRuns: 1 }
      })
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'conflict' })
    })
    expect(await h.threads.list({ includeArchived: true, includeSide: true })).toHaveLength(1)
  })

  it('replays ordered owner-scoped events and redacts protected gate identifiers', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'Stream events', workspace })
    await h.events.record({
      kind: 'approval_requested',
      threadId: run.threadId,
      turnId: run.id,
      approvalId: 'approval_secret',
      toolName: 'write',
      status: 'pending'
    })
    const received: Array<{ seq: number; payload: Record<string, unknown> }> = []
    const subscription = await h.service.subscribe(principal(), { runId: run.id }, (event) => {
      received.push({ seq: event.seq, payload: event.payload })
    })

    expect(received.length).toBeGreaterThanOrEqual(3)
    expect(received.map((event) => event.seq)).toEqual(
      [...received.map((event) => event.seq)].sort((a, b) => a - b)
    )
    expect(received.at(-1)?.payload).not.toHaveProperty('approvalId')
    subscription.close()
  })

  it('consumes internal goal-context sequence numbers without delivering them to extensions', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'Keep working toward the goal', workspace })
    const privateEvent = await h.events.record({
      kind: 'item_created',
      threadId: run.threadId,
      turnId: run.id,
      item: makeGoalContextItem({
        id: 'goal_context_private',
        threadId: run.threadId,
        turnId: run.id,
        goalKey: 'goal_private',
        text: 'Internal objective: do not expose this text',
        createdAt: '2026-07-11T08:00:01.000Z'
      })
    })
    const received: ExtensionAgentEvent[] = []
    const subscription = await h.service.subscribe(principal(), { runId: run.id }, (event) => {
      received.push(event)
    })

    expect(JSON.stringify(received)).not.toContain('Internal objective: do not expose this text')
    expect(received.some((event) => event.seq === privateEvent.seq)).toBe(false)
    expect(subscription.lastDeliveredSeq).toBe(privateEvent.seq)

    const livePrivateEvent = await h.events.record({
      kind: 'item_created',
      threadId: run.threadId,
      turnId: run.id,
      item: makeGoalContextItem({
        id: 'goal_context_private_live',
        threadId: run.threadId,
        turnId: run.id,
        goalKey: 'goal_private_live',
        text: 'Live internal objective: do not expose this text',
        createdAt: '2026-07-11T08:00:02.000Z'
      })
    })
    await vi.waitFor(() => {
      expect(subscription.lastDeliveredSeq).toBe(livePrivateEvent.seq)
    })
    expect(JSON.stringify(received)).not.toContain('Live internal objective: do not expose this text')
    expect(received.some((event) => event.seq === livePrivateEvent.seq)).toBe(false)

    const resumed: ExtensionAgentEvent[] = []
    const replay = await h.service.subscribe(principal(), {
      runId: run.id,
      afterSeq: subscription.lastDeliveredSeq
    }, (event) => {
      resumed.push(event)
    })
    expect(resumed).toEqual([])
    subscription.close()
    replay.close()
  })

  it('treats public afterSequence zero as the point before runtime sequence zero', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'Sequence zero boundary', workspace })
    const iterate = vi.spyOn(h.sessions, 'iterateEventsSince').mockImplementation(async function* (
      threadId,
      afterSeq
    ) {
      expect(threadId).toBe(run.threadId)
      expect(afterSeq).toBe(-1)
      yield {
        seq: 0,
        timestamp: '2026-07-11T08:00:01.000Z',
        kind: 'turn_steered',
        threadId: run.threadId,
        turnId: run.id,
        text: 'First durable message'
      }
    })

    const page = await h.service.listRunEvents(principal(), {
      runId: run.id,
      afterSequence: 0
    })

    expect(iterate).toHaveBeenCalledWith(
      run.threadId,
      -1,
      expect.objectContaining({ maxRecordBytes: expect.any(Number) })
    )
    expect(page).toMatchObject({ cursor: 1, hasMore: false, historyIncomplete: false })
    expect(page.items).toEqual([
      expect.objectContaining({ seq: 0, payload: expect.objectContaining({ content: 'First durable message' }) })
    ])
  })

  it('continues a paged history with live subscription without duplicate or missing events', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'History to live handoff', workspace })
    const afterSequence = (await h.sessions.highestSeq(run.threadId)) + 1
    const durable = []
    for (const text of ['First', 'Second', 'Third']) {
      durable.push(await h.events.record({
        kind: 'turn_steered',
        threadId: run.threadId,
        turnId: run.id,
        text
      }))
    }

    const page = await h.service.listRunEvents(principal(), {
      runId: run.id,
      afterSequence,
      limit: 2
    })
    const replayed: ExtensionAgentEvent[] = []
    const subscription = await h.service.subscribe(principal(), {
      runId: run.id,
      afterSeq: page.cursor - 1
    }, (event) => {
      replayed.push(event)
    })

    expect(page.hasMore).toBe(true)
    expect([...page.items, ...replayed].map(({ seq }) => seq)).toEqual(durable.map(({ seq }) => seq))
    expect(new Set([...page.items, ...replayed].map(({ seq }) => seq)).size).toBe(durable.length)
    subscription.close()
  })

  it('marks an incomplete durable history and bounds each page by bytes', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'Bound history', workspace })
    const afterSequence = (await h.sessions.highestSeq(run.threadId)) + 1
    for (let index = 0; index < 10; index += 1) {
      await h.events.record({
        kind: 'item_completed',
        threadId: run.threadId,
        turnId: run.id,
        item: {
          kind: 'assistant_text', id: `large-assistant-${index}`, threadId: run.threadId, turnId: run.id,
          role: 'assistant', status: 'completed', createdAt: '2026-07-11T08:00:02.000Z',
          text: `${index}:${'x'.repeat(70 * 1024)}`
        }
      })
    }
    const eventReplayFloorSeq = vi.fn(async () => afterSequence + 5)
    Object.defineProperty(h.sessions, 'eventReplayFloorSeq', {
      configurable: true,
      value: eventReplayFloorSeq
    })

    const page = await h.service.listRunEvents(principal(), { runId: run.id, afterSequence, limit: 200 })

    expect(page.historyIncomplete).toBe(true)
    expect(page.hasMore).toBe(true)
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.length).toBeLessThan(10)
    expect(Buffer.byteLength(JSON.stringify(page.items), 'utf8')).toBeLessThanOrEqual(512 * 1024 + 1024)

    eventReplayFloorSeq.mockResolvedValue(afterSequence)
    await expect(h.service.listRunEvents(principal(), {
      runId: run.id,
      afterSequence,
      limit: 1
    })).resolves.toMatchObject({ historyIncomplete: false })

    eventReplayFloorSeq.mockResolvedValue(1)
    await expect(h.service.listRunEvents(principal(), {
      runId: run.id,
      afterSequence: 0,
      limit: 1
    })).resolves.toMatchObject({ historyIncomplete: false })
  })

  it('summarizes run status with forward-only event iteration', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'Inspect status', workspace })
    await h.events.record({
      kind: 'error',
      threadId: run.threadId,
      turnId: run.id,
      code: 'stream_resource_limit',
      message: 'model stream limit exceeded'
    })
    const loadEventsSince = vi.spyOn(h.sessions, 'loadEventsSince')
    const iterateEventsSince = vi.spyOn(h.sessions, 'iterateEventsSince')

    const projected = await h.service.getRun(principal(), run.id)

    expect(projected.status).toBe('budget-exhausted')
    expect(iterateEventsSince).toHaveBeenCalledWith(
      run.threadId,
      -1,
      expect.objectContaining({ maxRecordBytes: expect.any(Number) })
    )
    expect(loadEventsSince).not.toHaveBeenCalled()
  })

  it('fails closed instead of materializing full history when bounded iteration is unavailable', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'Require bounded replay', workspace })
    Object.defineProperty(h.sessions, 'iterateEventsSince', {
      configurable: true,
      value: undefined
    })
    const loadEventsSince = vi.spyOn(h.sessions, 'loadEventsSince')

    await expect(h.service.getRun(principal(), run.id)).rejects.toMatchObject({
      code: 'conflict',
      message: expect.stringMatching(/bounded extension event replay is unavailable/i)
    })
    expect(loadEventsSince).not.toHaveBeenCalled()
  })

  it('projects usage for a resumed run as a delta from prior thread usage', async () => {
    const h = createHarness()
    const first = await h.service.createRun(principal(), { input: 'First run', workspace })
    await h.events.record({
      kind: 'usage',
      threadId: first.threadId,
      turnId: first.id,
      model: 'default-model',
      usage: {
        promptTokens: 6,
        completionTokens: 4,
        reasoningTokens: 1,
        totalTokens: 10,
        cacheHitTokens: 2,
        cacheMissTokens: 4,
        cacheHitRate: 2 / 6,
        cacheMissReasons: ['cold'],
        cacheSuggestions: ['keep prefix stable'],
        turns: 1,
        costUsd: 0.1,
        costByCurrency: { USD: 0.1 },
        hasError: true
      }
    })
    await h.turns.finishTurn({
      threadId: first.threadId,
      turnId: first.id,
      status: 'completed'
    })
    const resumed = await h.service.createRun(principal(), {
      threadId: first.threadId,
      input: 'Second run',
      workspace
    })
    await h.events.record({
      kind: 'usage',
      threadId: resumed.threadId,
      turnId: resumed.id,
      model: 'default-model',
      usage: {
        promptTokens: 11,
        completionTokens: 6,
        reasoningTokens: 2,
        totalTokens: 17,
        cacheHitTokens: 3,
        cacheMissTokens: 5,
        cacheHitRate: 3 / 8,
        cacheMissReasons: ['cold'],
        cacheSuggestions: ['keep prefix stable'],
        turns: 2,
        costUsd: 0.17,
        costByCurrency: { USD: 0.17 },
        hasError: true
      }
    })
    await h.events.record({
      kind: 'usage',
      threadId: resumed.threadId,
      turnId: resumed.id,
      model: 'default-model',
      usage: {
        promptTokens: 16,
        completionTokens: 9,
        reasoningTokens: 4,
        totalTokens: 25,
        cacheHitTokens: 5,
        cacheMissTokens: 7,
        cacheHitRate: 5 / 12,
        cacheMissReasons: ['provider'],
        cacheSuggestions: ['check provider cache'],
        turns: 2,
        costUsd: 0.26,
        costByCurrency: { USD: 0.26, EUR: 0.2 },
        hasError: false
      }
    })

    const projected = await h.service.getRun(principal(), resumed.id)

    expect(projected.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 5,
      reasoningTokens: 3,
      totalTokens: 15,
      cacheHitTokens: 3,
      cacheMissTokens: 3,
      cacheHitRate: 0.5,
      cacheMissReasons: ['cold', 'provider'],
      cacheSuggestions: ['keep prefix stable', 'check provider cache'],
      turns: 1,
      costByCurrency: { USD: 0.16, EUR: 0.2 },
      hasError: true
    })
    expect(projected.usage?.costUsd).toBeCloseTo(0.16)
  })

  it('streams a large persisted history and retains only the bounded replay tail', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), {
      input: 'Replay a large history',
      workspace,
      budget: { maxRetainedEvents: 5 }
    })
    const afterSeq = await h.sessions.highestSeq(run.threadId)
    const recordedSeqs: number[] = []
    for (let index = 0; index < 2_000; index += 1) {
      const event = await h.events.record({
        kind: 'turn_steered',
        threadId: run.threadId,
        turnId: run.id,
        text: `event-${index}`
      })
      recordedSeqs.push(event.seq)
    }
    const loadEventsSince = vi.spyOn(h.sessions, 'loadEventsSince')
    const iterateEventsSince = vi.spyOn(h.sessions, 'iterateEventsSince')
    const received: number[] = []

    const subscription = await h.service.subscribe(principal(), { runId: run.id, afterSeq }, (event) => {
      received.push(event.seq)
    })

    expect(received).toEqual(recordedSeqs.slice(-5))
    expect(iterateEventsSince).toHaveBeenCalledWith(
      run.threadId,
      afterSeq,
      expect.objectContaining({ maxRecordBytes: expect.any(Number) })
    )
    expect(loadEventsSince).not.toHaveBeenCalled()
    subscription.close()
  })

  it('bounds persisted replay by serialized bytes as well as event count', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), {
      input: 'Replay large events',
      workspace,
      budget: { maxRetainedEvents: 100 }
    })
    const afterSeq = await h.sessions.highestSeq(run.threadId)
    const recordedSeqs: number[] = []
    for (let index = 0; index < 4; index += 1) {
      const event = await h.events.record({
        kind: 'turn_steered',
        threadId: run.threadId,
        turnId: run.id,
        text: `${index}:${'x'.repeat(200 * 1024)}`
      })
      recordedSeqs.push(event.seq)
    }
    const received: number[] = []

    const subscription = await h.service.subscribe(principal(), { runId: run.id, afterSeq }, (event) => {
      received.push(event.seq)
    })

    expect(received).toEqual(recordedSeqs.slice(-2))
    subscription.close()
  })

  it('closes with a resumable overflow when live events exceed the replay buffer byte budget', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'Overflow replay', workspace })
    const afterSeq = await h.sessions.highestSeq(run.threadId)
    const originalIterate = h.sessions.iterateEventsSince!.bind(h.sessions)
    let releaseReplay!: () => void
    let markStarted!: () => void
    const replayBlocked = new Promise<void>((resolve) => { releaseReplay = resolve })
    const replayStarted = new Promise<void>((resolve) => { markStarted = resolve })
    vi.spyOn(h.sessions, 'iterateEventsSince').mockImplementation(async function* (
      threadId: string,
      sinceSeq: number
    ) {
      markStarted()
      await replayBlocked
      yield* originalIterate(threadId, sinceSeq)
    })
    const received: Array<{ type: string; payload: Record<string, unknown> }> = []
    const subscribing = h.service.subscribe(principal(), { runId: run.id, afterSeq }, (event) => {
      received.push({ type: event.type, payload: event.payload })
    })
    await replayStarted

    for (let index = 0; index < 3; index += 1) {
      await h.events.record({
        kind: 'turn_steered',
        threadId: run.threadId,
        turnId: run.id,
        text: `${index}:${'y'.repeat(200 * 1024)}`
      })
    }
    releaseReplay()
    const subscription = await subscribing

    expect(received).toEqual([{
      type: 'subscription_overflow',
      payload: expect.objectContaining({
        message: expect.stringMatching(/live replay buffer overflowed/),
        resumeAfterSeq: afterSeq
      })
    }])
    expect(subscription.closed).toBe(true)
    expect(subscription.lastDeliveredSeq).toBe(afterSeq)
  })

  it('bounds the number of live events retained while persisted replay is blocked', async () => {
    const h = createHarness()
    const run = await h.service.createRun(principal(), { input: 'Overflow replay count', workspace })
    const afterSeq = await h.sessions.highestSeq(run.threadId)
    const originalIterate = h.sessions.iterateEventsSince!.bind(h.sessions)
    let releaseReplay!: () => void
    let markStarted!: () => void
    const replayBlocked = new Promise<void>((resolve) => { releaseReplay = resolve })
    const replayStarted = new Promise<void>((resolve) => { markStarted = resolve })
    vi.spyOn(h.sessions, 'iterateEventsSince').mockImplementation(async function* (
      threadId: string,
      sinceSeq: number
    ) {
      markStarted()
      await replayBlocked
      yield* originalIterate(threadId, sinceSeq)
    })
    const received: Array<{ type: string; payload: Record<string, unknown> }> = []
    const subscribing = h.service.subscribe(principal(), { runId: run.id, afterSeq }, (event) => {
      received.push({ type: event.type, payload: event.payload })
    })
    await replayStarted

    for (let index = 0; index < 1_025; index += 1) {
      await h.events.record({
        kind: 'turn_steered',
        threadId: run.threadId,
        turnId: run.id,
        text: `event-${index}`
      })
    }
    releaseReplay()
    const subscription = await subscribing

    expect(received).toEqual([{
      type: 'subscription_overflow',
      payload: expect.objectContaining({ resumeAfterSeq: afterSeq })
    }])
    expect(subscription.closed).toBe(true)
  })

  it('runs headlessly without exposing an extension path for protected user-input gates', async () => {
    const h = createHarness(true)
    const run = await h.service.createRun(principal(), { input: 'Headless run', workspace })
    const thread = await h.threads.get(run.threadId)

    expect(thread?.turns.find((turn) => turn.id === run.id)?.disableUserInput).toBe(true)
  })
})
