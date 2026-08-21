import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import {
  ChildRunRecord,
  DelegationRuntime,
  FileDelegationStore,
  type ChildRunExecutor
} from './delegation-runtime.js'

function config(enabled = true) {
  return SubagentsCapabilityConfig.parse({
    enabled: true,
    maxParallel: 2,
    proactiveRetry: { enabled, maxAttempts: 3 }
  })
}

function failedRecord(patch: Partial<ReturnType<typeof ChildRunRecord.parse>> = {}) {
  return ChildRunRecord.parse({
    id: 'child_retry',
    parentThreadId: 'parent',
    parentTurnId: 'turn-1',
    launcher: 'delegate_task',
    prompt: 'review the implementation',
    workspace: '/workspace',
    profile: 'reviewer',
    profileSnapshot: { mode: 'subagent', toolPolicy: 'readOnly' },
    security: { sandboxRoot: '/workspace', memoryEnabled: false },
    status: 'failed',
    terminationReason: 'child_error',
    resumable: true,
    failure: {
      source: 'model', code: 'http_520', category: 'unavailable', httpStatus: 520
    },
    usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110, turns: 4 },
    resumeCount: 0,
    proactiveRetryCount: 0,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:01:00.000Z',
    ...patch
  })
}

async function fixture(input: {
  enabled?: boolean
  record?: ReturnType<typeof failedRecord>
  executor?: ChildRunExecutor
  proactiveRetryWait?: (delayMs: number, signal: AbortSignal) => Promise<boolean>
}) {
  const dir = await mkdtemp(join(tmpdir(), 'kun-proactive-retry-'))
  const store = new FileDelegationStore(dir)
  await store.upsert(input.record ?? failedRecord())
  const calls: Parameters<ChildRunExecutor>[0][] = []
  const delays: number[] = []
  const runtime = new DelegationRuntime({
    config: config(input.enabled ?? true),
    store,
    nowIso: () => '2026-08-19T00:02:00.000Z',
    proactiveRetryWait: input.proactiveRetryWait ?? (async (delayMs, signal) => {
      delays.push(delayMs)
      return signal.aborted
    }),
    executor: input.executor ?? (async (execution) => {
      calls.push(execution)
      return {
        summary: 'review completed',
        usage: { promptTokens: 120, completionTokens: 20, totalTokens: 140, turns: 5 }
      }
    })
  })
  return { dir, store, runtime, calls, delays }
}

describe('DelegationRuntime proactive retry', () => {
  it('waits, appends to the same child, and increments only proactive state', async () => {
    const { dir, runtime, calls, delays } = await fixture({})
    try {
      const resumedPromise = runtime.resumeChild({
        childId: 'child_retry',
        parentThreadId: 'parent',
        parentTurnId: 'turn-2',
        prompt: 'continue from existing history',
        expectedResumeCount: 0,
        expectedLaunchers: ['delegate_task'],
        requireResumable: true,
        proactive: true,
        signal: new AbortController().signal
      })
      const resumed = await resumedPromise

      expect(resumed).toMatchObject({
        id: 'child_retry',
        status: 'completed',
        parentTurnId: 'turn-2',
        resumeCount: 1,
        proactiveRetryCount: 1
      })
      expect(calls).toHaveLength(1)
      expect(delays).toEqual([3_000])
      expect(calls[0]).toMatchObject({ childId: 'child_retry', resumeChild: true })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('enforces disablement and the three-attempt ceiling while manual resume stays available', async () => {
    const disabled = await fixture({ enabled: false })
    try {
      await expect(disabled.runtime.resumeChild({
        childId: 'child_retry', parentThreadId: 'parent', parentTurnId: 'turn-2',
        prompt: 'retry', expectedResumeCount: 0, expectedLaunchers: ['delegate_task'],
        requireResumable: true, proactive: true, signal: new AbortController().signal
      })).rejects.toThrow('proactive subagent retry is disabled')
    } finally {
      await rm(disabled.dir, { recursive: true, force: true })
    }

    const exhausted = await fixture({ record: failedRecord({ proactiveRetryCount: 3 }) })
    try {
      await expect(exhausted.runtime.resumeChild({
        childId: 'child_retry', parentThreadId: 'parent', parentTurnId: 'turn-2',
        prompt: 'retry', expectedResumeCount: 0, expectedLaunchers: ['delegate_task'],
        requireResumable: true, proactive: true, signal: new AbortController().signal
      })).rejects.toThrow('exhausted its 3 proactive retries')

      const manual = await exhausted.runtime.resumeChild({
        childId: 'child_retry', parentThreadId: 'parent', parentTurnId: 'turn-manual',
        prompt: 'user requested continuation', expectedResumeCount: 0,
        expectedLaunchers: ['delegate_task'], requireResumable: true,
        signal: new AbortController().signal
      })
      expect(manual).toMatchObject({
        status: 'completed', resumeCount: 1, proactiveRetryCount: 3
      })
    } finally {
      await rm(exhausted.dir, { recursive: true, force: true })
    }
  })

  it('uses 3/6/12 second backoff and honors a longer provider delay', async () => {
    for (const [count, expectedDelay] of [[0, 3_000], [1, 6_000], [2, 12_000]] as const) {
      const current = await fixture({
        record: failedRecord({ resumeCount: count, proactiveRetryCount: count })
      })
      try {
        await current.runtime.resumeChild({
          childId: 'child_retry', parentThreadId: 'parent', parentTurnId: `turn-${count + 2}`,
          prompt: 'retry', expectedResumeCount: count, expectedLaunchers: ['delegate_task'],
          requireResumable: true, proactive: true, signal: new AbortController().signal
        })
        expect(current.delays).toEqual([expectedDelay])
      } finally {
        await rm(current.dir, { recursive: true, force: true })
      }
    }

    const providerDelayed = await fixture({
      record: failedRecord({
        failure: {
          source: 'model', code: 'rate_limited', category: 'rate_limit',
          httpStatus: 429, retryAfterMs: 20_000
        }
      })
    })
    try {
      await providerDelayed.runtime.resumeChild({
        childId: 'child_retry', parentThreadId: 'parent', parentTurnId: 'turn-provider-delay',
        prompt: 'retry', expectedResumeCount: 0, expectedLaunchers: ['delegate_task'],
        requireResumable: true, proactive: true, signal: new AbortController().signal
      })
      expect(providerDelayed.delays).toEqual([20_000])
    } finally {
      await rm(providerDelayed.dir, { recursive: true, force: true })
    }
  })

  it('never proactively restarts a deliberately stopped child', async () => {
    const stopped = await fixture({
      record: failedRecord({ status: 'aborted', terminationReason: 'user_stop' })
    })
    try {
      await expect(stopped.runtime.resumeChild({
        childId: 'child_retry', parentThreadId: 'parent', parentTurnId: 'turn-2',
        prompt: 'retry', expectedResumeCount: 0, expectedLaunchers: ['delegate_task'],
        requireResumable: true, proactive: true, signal: new AbortController().signal
      })).rejects.toThrow('not eligible for proactive retry')
    } finally {
      await rm(stopped.dir, { recursive: true, force: true })
    }
  })

  it('cancels during backoff without consuming the retry generation', async () => {
    const controller = new AbortController()
    const { dir, store, runtime } = await fixture({
      proactiveRetryWait: async (_delayMs, signal) => await new Promise<boolean>((resolve) => {
        if (signal.aborted) return resolve(true)
        signal.addEventListener('abort', () => resolve(true), { once: true })
      })
    })
    try {
      const resumed = runtime.resumeChild({
        childId: 'child_retry', parentThreadId: 'parent', parentTurnId: 'turn-2',
        prompt: 'retry', expectedResumeCount: 0, expectedLaunchers: ['delegate_task'],
        requireResumable: true, proactive: true, signal: controller.signal
      })
      controller.abort()
      await expect(resumed).rejects.toThrow('cancelled during backoff')
      await expect(store.get('child_retry')).resolves.toMatchObject({
        resumeCount: 0, proactiveRetryCount: 0, status: 'failed'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps an originally detached child detached when proactively resumed', async () => {
    const { dir, store, runtime } = await fixture({ record: failedRecord({ detached: true }) })
    try {
      const resumedPromise = runtime.resumeChild({
        childId: 'child_retry', parentThreadId: 'parent', parentTurnId: 'turn-2',
        prompt: 'retry in background', expectedResumeCount: 0,
        expectedLaunchers: ['delegate_task'], requireResumable: true,
        proactive: true, signal: new AbortController().signal
      })
      const queued = await resumedPromise
      expect(queued).toMatchObject({
        id: 'child_retry', status: 'queued', detached: true,
        resumeCount: 1, proactiveRetryCount: 1
      })
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          if ((await store.get('child_retry'))?.status === 'completed') break
        } catch {
          // The test store uses plain writes outside manager-owned data paths;
          // tolerate observing one in-flight write before polling again.
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      await expect(store.get('child_retry')).resolves.toMatchObject({
        id: 'child_retry', status: 'completed', detached: true
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
