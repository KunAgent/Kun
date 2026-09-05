import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadRuntimeStateBatchResult } from '../agent/provider-types'
import type { NormalizedThread } from '../agent/types'
import type { AutoPlanBuildIntentV1 } from './auto-plan-build-intents'
import {
  AUTO_PLAN_BUILD_RECOVERY_RETRY_MS,
  AutoPlanBuildRecoveryCoordinator,
  autoPlanBuildRecoveryThreadSignature
} from './auto-plan-build-recovery-coordinator'

function intent(id: string, overrides: Partial<AutoPlanBuildIntentV1> = {}): AutoPlanBuildIntentV1 {
  return {
    version: 1,
    id: `intent-${id}`,
    planId: `/repo:.kunsdd/plan/${id}.md`,
    relativePath: `.kunsdd/plan/${id}.md`,
    workspaceRoot: '/repo',
    threadId: id,
    planTurnId: `turn-${id}`,
    planClientRequestId: `plan-request-${id}`,
    buildClientRequestId: `build-request-${id}`,
    requestFingerprint: `fingerprint-${id}`,
    buildMode: 'direct',
    useWorktree: false,
    status: 'planning',
    error: '',
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    ...overrides
  }
}

function state(
  id: string,
  overrides: Partial<Extract<ThreadRuntimeStateBatchResult, { ok: true }>['state']> = {}
): ThreadRuntimeStateBatchResult {
  return {
    id,
    ok: true,
    state: {
      status: 'idle',
      updatedAt: '2026-09-04T00:00:00.000Z',
      latestSeq: 1,
      latestTurnId: `turn-${id}`,
      latestTurnStatus: 'completed',
      pendingUserInputIds: [],
      ...overrides
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function coordinator(options: {
  intents: AutoPlanBuildIntentV1[]
  loadThreadStates: (ids: string[]) => Promise<ThreadRuntimeStateBatchResult[]>
  inspectIntent?: (value: AutoPlanBuildIntentV1) => Promise<void>
  onError?: (error: unknown) => void
}) {
  return new AutoPlanBuildRecoveryCoordinator({
    listIntents: () => options.intents,
    intentIsEligible: (value) => value.status !== 'needs_attention',
    loadThreadStates: options.loadThreadStates,
    inspectIntent: options.inspectIntent ?? (async () => undefined),
    errorIsRetryable: (error) =>
      error instanceof Error && error.message.includes('thread_read_overloaded'),
    onError: options.onError
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AutoPlanBuildRecoveryCoordinator', () => {
  it('uses one state batch and no timelines for many running intents', async () => {
    const intents = Array.from({ length: 20 }, (_, index) => intent(`thread-${index}`))
    const loadThreadStates = vi.fn(async (ids: string[]) => ids.map((id) =>
      state(id, { status: 'running', latestTurnStatus: 'running' })
    ))
    const inspectIntent = vi.fn(async () => undefined)
    const recovery = coordinator({ intents, loadThreadStates, inspectIntent })

    await recovery.request()

    expect(loadThreadStates).toHaveBeenCalledOnce()
    expect(loadThreadStates).toHaveBeenCalledWith(intents.map((value) => value.threadId))
    expect(inspectIntent).not.toHaveBeenCalled()
  })

  it('coalesces repeated wakeups into one trailing sweep', async () => {
    const first = deferred<ThreadRuntimeStateBatchResult[]>()
    const target = intent('thread-1')
    const loadThreadStates = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue([state(target.threadId, {
        status: 'running', latestTurnStatus: 'running'
      })])
    const recovery = coordinator({ intents: [target], loadThreadStates })

    const active = recovery.request()
    for (let index = 0; index < 50; index += 1) void recovery.request()
    expect(loadThreadStates).toHaveBeenCalledOnce()

    first.resolve([state(target.threadId, {
      status: 'running', latestTurnStatus: 'running'
    })])
    await active

    expect(loadThreadStates).toHaveBeenCalledTimes(2)
    expect(recovery.diagnostics()).toMatchObject({
      active: false,
      sweepsStarted: 2,
      wakeupsCoalesced: 50
    })
  })

  it('serializes terminal timeline inspections and skips pending input', async () => {
    const intents = [intent('one'), intent('two'), intent('clarification')]
    let activeInspections = 0
    let maximumActiveInspections = 0
    const inspected: string[] = []
    const inspectIntent = vi.fn(async (value: AutoPlanBuildIntentV1) => {
      activeInspections += 1
      maximumActiveInspections = Math.max(maximumActiveInspections, activeInspections)
      await Promise.resolve()
      inspected.push(value.threadId)
      activeInspections -= 1
    })
    const recovery = coordinator({
      intents,
      loadThreadStates: async () => [
        state('one'),
        state('two'),
        state('clarification', { pendingUserInputIds: ['input-1'] })
      ],
      inspectIntent
    })

    await recovery.request()

    expect(inspected).toEqual(['one', 'two'])
    expect(maximumActiveInspections).toBe(1)
  })

  it('delays one retry after a transient timeline overload', async () => {
    vi.useFakeTimers()
    const target = intent('thread-1')
    const error = new Error('{"code":"thread_read_overloaded"}')
    const inspectIntent = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined)
    const onError = vi.fn()
    const recovery = coordinator({
      intents: [target],
      loadThreadStates: async () => [state(target.threadId)],
      inspectIntent,
      onError
    })

    await recovery.request()
    expect(inspectIntent).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(error)
    expect(recovery.diagnostics()).toMatchObject({ retryPending: true, retriesScheduled: 1 })

    await vi.advanceTimersByTimeAsync(AUTO_PLAN_BUILD_RECOVERY_RETRY_MS - 1)
    expect(inspectIntent).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()

    expect(inspectIntent).toHaveBeenCalledTimes(2)
    expect(recovery.diagnostics()).toMatchObject({ retryPending: false, retriesScheduled: 1 })
  })
})

describe('autoPlanBuildRecoveryThreadSignature', () => {
  function thread(overrides: Partial<NormalizedThread> = {}): NormalizedThread {
    return {
      id: 'thread-1',
      title: 'Task',
      model: 'model',
      mode: 'plan',
      updatedAt: '2026-09-04T00:00:00.000Z',
      status: 'running',
      latestTurnId: 'turn-1',
      latestTurnStatus: 'running',
      ...overrides
    }
  }

  it('ignores metadata-only timestamps and changes on lifecycle transitions', () => {
    const original = autoPlanBuildRecoveryThreadSignature([thread()])
    expect(autoPlanBuildRecoveryThreadSignature([
      thread({ updatedAt: '2026-09-04T00:01:00.000Z', latestSeq: 50 })
    ])).toBe(original)
    expect(autoPlanBuildRecoveryThreadSignature([
      thread({ status: 'idle', latestTurnStatus: 'completed' })
    ])).not.toBe(original)
  })
})
