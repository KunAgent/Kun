import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalToolHost, echoTool } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { emptyUsageSnapshot, type UsageSnapshot } from '../contracts/usage.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'
import { createChildAgentExecutor } from './child-agent-executor.js'
import { ChildResultExecutionError } from './child-result-materializer.js'
import { DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'
import type { ChildRunExecutor } from './delegation-runtime.js'
import type { ChildRunRecord } from './delegation-runtime-contracts.js'

function subagentConfig() {
  return SubagentsCapabilityConfig.parse({
    enabled: true,
    maxParallel: 2
  })
}

function failureUsage(): ChildRunRecord['usage'] {
  return {
    promptTokens: 5621,
    completionTokens: 174,
    totalTokens: 5795,
    cacheHitTokens: 2434,
    cacheMissTokens: 3187,
    turns: 53,
    costCny: 9.72
  }
}

function failureExecutor(
  settlement: ConstructorParameters<typeof ChildResultExecutionError>[2]
): ChildRunExecutor {
  return async () => {
    throw new ChildResultExecutionError('insufficient balance', { summary: 'partial work' }, settlement)
  }
}

describe('DelegationRuntime failed/aborted child usage settlement', () => {
  it('retains accrued usage on a failed child and settles it exactly once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-failure-usage-'))
    try {
      const externalUsage: Array<{ threadId: string; usage: UsageSnapshot }> = []
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        recordExternalUsage: (threadId, usage) => externalUsage.push({ threadId, usage }),
        executor: failureExecutor({ usage: failureUsage(), toolInvocations: 12 })
      })
      const record = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        prompt: 'burn tokens then fail',
        signal: new AbortController().signal
      })
      expect(record.status).toBe('failed')
      expect(record.usage).toMatchObject(failureUsage())
      expect(record.toolInvocations).toBe(12)
      expect(externalUsage).toHaveLength(1)
      expect(externalUsage[0]).toMatchObject({
        threadId: record.id,
        usage: { promptTokens: 5621, totalTokens: 5795 }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('persists HTTP 520 classification and makes the ordinary child resumable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-http-520-'))
    try {
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        executor: failureExecutor({
          usage: failureUsage(),
          failure: {
            source: 'model',
            code: 'http_520',
            category: 'unavailable',
            httpStatus: 520
          }
        })
      })
      const record = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        launcher: 'delegate_task',
        prompt: 'review the change',
        workspace: '/workspace',
        inlineProfile: {
          id: 'reviewer', source: 'builtin',
          profile: { mode: 'subagent', toolPolicy: 'readOnly' }
        },
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        signal: new AbortController().signal
      })

      expect(record).toMatchObject({
        status: 'failed',
        terminationReason: 'child_error',
        resumable: true,
        failure: {
          source: 'model',
          code: 'http_520',
          category: 'unavailable',
          httpStatus: 520
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('retains accrued usage on an aborted child', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-abort-usage-'))
    try {
      const externalUsage: UsageSnapshot[] = []
      let executorStarted: (() => void) | undefined
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        recordExternalUsage: (_threadId, usage) => externalUsage.push(usage),
        executor: async () => {
          // Usage accrued before the user stops the child.
          executorStarted?.()
          throw new ChildResultExecutionError(
            'child aborted',
            { summary: 'partial work' },
            { usage: failureUsage() }
          )
        }
      })
      const parent = new AbortController()
      const started = new Promise<void>((resolve) => {
        executorStarted = resolve
      })
      const run = runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        prompt: 'abort after usage',
        signal: parent.signal
      })
      await started
      parent.abort()
      const record = await run
      expect(record.status).toBe('aborted')
      expect(record.usage).toMatchObject(failureUsage())
      expect(externalUsage).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps zero usage and skips settlement when the child fails before any model request', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-failure-zero-'))
    try {
      const externalUsage: UsageSnapshot[] = []
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        recordExternalUsage: (_threadId, usage) => externalUsage.push(usage),
        executor: async () => {
          throw new Error('child exploded before first request')
        }
      })
      const record = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        prompt: 'fail immediately',
        signal: new AbortController().signal
      })
      expect(record.status).toBe('failed')
      expect(record.usage).toMatchObject({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })
      expect(externalUsage).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('settles only the delta when a resumed child fails after previous settlement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-resume-delta-'))
    try {
      const externalUsage: UsageSnapshot[] = []
      const firstUsage: ChildRunRecord['usage'] = {
        promptTokens: 100, completionTokens: 40, totalTokens: 140, turns: 2
      }
      const cumulativeUsage: ChildRunRecord['usage'] = {
        promptTokens: 160, completionTokens: 70, totalTokens: 230, turns: 5
      }
      let call = 0
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        idGenerator: () => 'child_delta',
        nowIso: (() => {
          let tick = 0
          return () => `2026-08-13T00:00:0${tick++}.000Z`
        })(),
        recordExternalUsage: (_threadId, usage) => externalUsage.push(usage),
        executor: async () => {
          call += 1
          if (call === 1) {
            return { summary: 'first leg done', usage: firstUsage }
          }
          throw new ChildResultExecutionError(
            'insufficient balance',
            { summary: 'resume failed' },
            { usage: cumulativeUsage, toolInvocations: 3 }
          )
        }
      })
      const first = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        prompt: 'first leg',
        workspace: '/workspace',
        inlineProfile: {
          id: 'general',
          source: 'builtin',
          profile: { mode: 'subagent', toolPolicy: 'inherit' }
        },
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        signal: new AbortController().signal
      })
      expect(first.status).toBe('completed')
      // Mark the completed child resumable, mirroring the persisted restart state.
      const store = new FileDelegationStore(dir)
      await store.upsert({
        ...first,
        status: 'aborted',
        terminationReason: 'runtime_restart',
        resumable: true
      })
      const resumed = await runtime.resumeChild({
        childId: first.id,
        parentThreadId: 'parent',
        parentTurnId: 'turn-2',
        prompt: 'second leg fails',
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        signal: new AbortController().signal
      })
      expect(resumed.status).toBe('failed')
      expect(resumed.usage).toMatchObject(cumulativeUsage)
      expect(externalUsage).toHaveLength(2)
      expect(externalUsage[0]).toMatchObject({ totalTokens: 140 })
      expect(externalUsage[1]).toMatchObject({ totalTokens: 90 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

class UsageThenFatalModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'usage-then-fatal-model'
  private requests = 0

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.requests += 1
    if (this.requests === 1) {
      // Billable request: usage is recorded before the turn continues.
      yield {
        kind: 'usage',
        usage: {
          ...emptyUsageSnapshot(),
          promptTokens: 5_621,
          cacheHitTokens: 2_434,
          cacheMissTokens: 3_187,
          completionTokens: 174,
          totalTokens: 5_795,
          turns: 1,
          costCny: 9.72
        }
      }
      yield {
        kind: 'tool_call_complete',
        callId: 'call_echo',
        toolName: 'echo',
        arguments: { text: 'billable work' }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    // Next request fails, mirroring an exhausted provider balance.
    throw new Error('insufficient balance')
  }
}

describe('createChildAgentExecutor failed-run usage settlement', () => {
  it('attaches accrued usage to the failure error when the model bills before a fatal error', async () => {
    const executor = createChildAgentExecutor({
      model: new UsageThenFatalModel(),
      toolHost: new LocalToolHost({ tools: [echoTool] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      defaultModel: 'usage-then-fatal-model'
    })

    const run = executor({
      childId: 'child_usage_then_fatal',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'bill then fail',
      workspace: '/tmp/workspace',
      toolPolicy: 'inherit',
      signal: new AbortController().signal
    })
    await expect(run).rejects.toMatchObject({
      name: 'ChildResultExecutionError',
      message: /insufficient balance/,
      usage: {
        promptTokens: 5_621,
        completionTokens: 174,
        totalTokens: 5_795,
        costCny: 9.72
      }
    })
  })
})
