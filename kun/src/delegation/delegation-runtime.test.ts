import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import { createThreadRecord } from '../domain/thread.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../ports/model-client.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { createChildAgentExecutor } from './child-agent-executor.js'
import { ChildRunRecord, DelegationRuntime, FileDelegationStore } from './delegation-runtime.js'
import type { ChildRunExecutor } from './delegation-runtime.js'
import { ChildResultExecutionError } from './child-result-materializer.js'

class HangingModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'test-model'
  readonly requests: ModelRequest[] = []
  private resolveRequest: (() => void) | undefined
  readonly requestStarted = new Promise<void>((resolve) => {
    this.resolveRequest = resolve
  })

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    this.resolveRequest?.()
    await new Promise<void>((resolve) => {
      if (request.abortSignal.aborted) {
        resolve()
        return
      }
      request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
    })
    if (!request.abortSignal.aborted) {
      yield { kind: 'usage', usage: emptyUsageSnapshot() }
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }
}

describe('DelegationRuntime abort handling', () => {
  it('redacts legacy host control from diagnostics without rewriting the store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-diagnostics-'))
    try {
      const store = new FileDelegationStore(dir)
      await store.upsert(ChildRunRecord.parse({
        id: 'legacy-child',
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        prompt: 'legacy task',
        controlPrompt: 'PRIVATE LEGACY HOST CONTROL',
        status: 'completed',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:01.000Z'
      }))
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store,
        executor: async () => ({ summary: 'unused' })
      })

      expect((await store.get('legacy-child'))?.controlPrompt).toBe('PRIVATE LEGACY HOST CONTROL')
      expect((await runtime.diagnostics('parent')).childRuns[0]).not.toHaveProperty('controlPrompt')
      expect((await store.get('legacy-child'))?.controlPrompt).toBe('PRIVATE LEGACY HOST CONTROL')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not make an ordinary child failure resumable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-failure-'))
    try {
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        executor: async () => { throw new Error('provider rejected the request') }
      })

      const record = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        launcher: 'delegate_task',
        prompt: 'ordinary business failure',
        signal: new AbortController().signal
      })

      expect(record).toMatchObject({
        status: 'failed',
        terminationReason: 'child_error',
        resumable: false
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not abort detached children when the parent signal aborts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-'))
    try {
      let childSignal: AbortSignal | undefined
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        executor: async (input) => {
          childSignal = input.signal
          await new Promise<void>((resolve) => {
            input.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          throw new Error('aborted')
        }
      })
      const parent = new AbortController()
      const record = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        prompt: 'background work',
        detach: true,
        signal: parent.signal
      })

      await waitFor(() => childSignal !== undefined)
      parent.abort()
      expect(childSignal?.aborted).toBe(false)

      expect(runtime.abortChild(record.id)).toBe(true)
      await waitFor(() => childSignal?.aborted === true)
      await runtime.abortDetachedChildrenForThread('parent')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('aborts detached children when their parent thread is deleted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-'))
    try {
      let childSignal: AbortSignal | undefined
      let releaseAbortCleanup = (): void => undefined
      const abortCleanup = new Promise<void>((resolve) => {
        releaseAbortCleanup = resolve
      })
      const store = new FileDelegationStore(dir)
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store,
        executor: async (input) => {
          childSignal = input.signal
          await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
          await abortCleanup
          throw new Error('aborted')
        }
      })
      await runtime.runChild({
        parentThreadId: 'thr_delete',
        parentTurnId: 'turn_delete',
        launcher: 'delegate_task',
        prompt: 'background work',
        detach: true,
        signal: new AbortController().signal
      })

      await waitFor(() => childSignal !== undefined)
      expect(await runtime.abortDetachedChildrenForThread('thr_other')).toBe(0)
      const aborting = runtime.abortDetachedChildrenForThread('thr_delete')
      await waitFor(() => childSignal?.aborted === true)
      let drained = false
      void aborting.then(() => {
        drained = true
      })
      await Promise.resolve()
      expect(drained).toBe(false)

      releaseAbortCleanup()
      expect(await aborting).toBe(1)
      expect(await runtime.abortDetachedChildrenForThread('thr_delete')).toBe(0)
      expect((await store.list())[0]).toMatchObject({
        status: 'aborted',
        terminationReason: 'manual_stop',
        resumable: false,
        detached: true
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('drains a foreground child detached immediately before its parent thread is deleted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-'))
    try {
      let childId = ''
      let childSignal: AbortSignal | undefined
      let releaseAbortCleanup = (): void => undefined
      const abortCleanup = new Promise<void>((resolve) => {
        releaseAbortCleanup = resolve
      })
      const store = new FileDelegationStore(dir)
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store,
        executor: async (input) => {
          childSignal = input.signal
          await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }))
          await abortCleanup
          throw new Error('aborted')
        }
      })
      const running = runtime.runChild({
        parentThreadId: 'thr_dynamic_delete',
        parentTurnId: 'turn_dynamic_delete',
        prompt: 'foreground work',
        signal: new AbortController().signal,
        onStart: (startedChildId) => {
          childId = startedChildId
        }
      })

      await waitFor(() => childId.length > 0 && childSignal !== undefined)
      expect(await runtime.detachChild(childId)).toBe(true)
      const aborting = runtime.abortDetachedChildrenForThread('thr_dynamic_delete')
      await waitFor(() => childSignal?.aborted === true)
      let drained = false
      void aborting.then(() => {
        drained = true
      })
      await Promise.resolve()
      expect(drained).toBe(false)

      releaseAbortCleanup()
      expect(await aborting).toBe(1)
      await running
      expect(await runtime.abortDetachedChildrenForThread('thr_dynamic_delete')).toBe(0)
      expect((await store.list())[0]?.status).toBe('aborted')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('wakes the parent thread when a detached child settles after the parent turn was interrupted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-'))
    try {
      const { runtime, threadStore, turns } = makeRuntime(dir)
      await threadStore.upsert(createThreadRecord({
        id: 'parent',
        title: 'Parent',
        workspace: '/ws',
        model: 'test-model'
      }))
      const parentTurn = await turns.startTurn({
        threadId: 'parent',
        request: { prompt: 'start parent' }
      })
      await turns.interruptTurn({
        threadId: 'parent',
        turnId: parentTurn.turnId
      })
      const runTurn = vi.fn(async (_threadId: string, _turnId: string) => undefined)
      runtime.bindAgentLoop({ runTurn })

      await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: parentTurn.turnId,
        label: 'research',
        prompt: 'background work',
        detach: true,
        signal: new AbortController().signal
      })

      await waitFor(() => runTurn.mock.calls.length === 1)
      expect(runTurn.mock.calls[0][0]).toBe('parent')
      const thread = await threadStore.get('parent')
      expect(thread?.status).toBe('running')
      const resumedTurn = thread?.turns.at(-1)
      expect(resumedTurn?.prompt).toContain('<background_subagent_completed>')
      expect(resumedTurn?.prompt).toContain('<label>research</label>')
      expect(resumedTurn?.items?.[0]).toMatchObject({
        kind: 'user_message',
        messageSource: 'background_subagent',
        displayText: 'Background subagent research completed'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('includes proactive retry facts in one detached failure notice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-detached-retry-'))
    try {
      const { runtime, threadStore, turns } = makeRuntime(dir, async () => {
        throw new ChildResultExecutionError(
          'model request failed with status 520',
          { summary: 'review interrupted' },
          {
            failure: {
              source: 'model', code: 'http_520', category: 'unavailable', httpStatus: 520
            }
          }
        )
      })
      await threadStore.upsert(createThreadRecord({
        id: 'parent_retry', title: 'Parent', workspace: '/ws', model: 'test-model'
      }))
      const parentTurn = await turns.startTurn({
        threadId: 'parent_retry', request: { prompt: 'start parent' }
      })
      await turns.interruptTurn({ threadId: 'parent_retry', turnId: parentTurn.turnId })
      const runTurn = vi.fn(async () => undefined)
      runtime.bindAgentLoop({ runTurn })

      await runtime.runChild({
        parentThreadId: 'parent_retry', parentTurnId: parentTurn.turnId,
        launcher: 'delegate_task', label: 'review', prompt: 'background review',
        workspace: '/ws', detach: true,
        inlineProfile: {
          id: 'reviewer', source: 'builtin',
          profile: { mode: 'subagent', toolPolicy: 'readOnly' }
        },
        security: { sandboxRoot: '/ws', memoryEnabled: false },
        signal: new AbortController().signal
      })

      await waitFor(() => runTurn.mock.calls.length === 1)
      const thread = await threadStore.get('parent_retry')
      const notice = thread?.turns.at(-1)?.prompt ?? ''
      expect(notice).toContain('<code>http_520</code>')
      expect(notice).toContain('<resumable>true</resumable>')
      expect(notice).toContain('proactive_retry enabled="true" eligible="true"')
      expect(runTurn).toHaveBeenCalledTimes(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('DelegationRuntime model provider selection', () => {
  it('records and publishes the snapshotted profile name with the effective model', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-observability-'))
    try {
      const events = { record: vi.fn(async () => undefined) }
      const lifecycle: unknown[] = []
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({
          enabled: true,
          maxParallel: 1,
          profiles: {
            auditor: {
              name: 'Security Auditor',
              model: 'gpt-5.6-sol',
              providerId: 'openai',
              toolPolicy: 'readOnly'
            }
          }
        }),
        store: new FileDelegationStore(dir),
        events: events as unknown as RuntimeEventRecorder,
        executor: async () => ({ summary: 'done' })
      })

      await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        profile: 'auditor',
        prompt: 'audit the change',
        onQueued: (_childId, _profile, metadata) => {
          lifecycle.push(metadata)
        },
        onRunning: (_childId, _profile, metadata) => {
          lifecycle.push(metadata)
        },
        signal: new AbortController().signal
      })

      expect(lifecycle).toEqual([
        {
          model: 'gpt-5.6-sol',
          providerId: 'openai',
          profile: 'auditor',
          profileName: 'Security Auditor'
        },
        {
          model: 'gpt-5.6-sol',
          providerId: 'openai',
          profile: 'auditor',
          profileName: 'Security Auditor'
        }
      ])
      expect(events.record).toHaveBeenCalledWith(expect.objectContaining({
        child: expect.objectContaining({
          childModel: 'gpt-5.6-sol',
          childProviderId: 'openai',
          childProfile: 'auditor',
          childProfileName: 'Security Auditor'
        })
      }))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses a complete profile pair instead of mixing it with the parent pair', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-selection-'))
    try {
      let captured: Parameters<ChildRunExecutor>[0] | undefined
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({
          enabled: true,
          maxParallel: 1,
          profiles: {
            general: {
              model: 'deepseek-v4-pro',
              providerId: 'deepseek',
              toolPolicy: 'inherit'
            }
          }
        }),
        store: new FileDelegationStore(dir),
        executor: async (input) => {
          captured = input
          return { summary: 'done' }
        }
      })

      await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        profile: 'general',
        prompt: 'work',
        inheritedModel: 'gpt-5.3-codex-spark',
        inheritedProviderId: 'codex',
        signal: new AbortController().signal
      })

      expect(captured).toMatchObject({
        model: 'deepseek-v4-pro',
        providerId: 'deepseek'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('inherits the complete parent pair when the profile has no model override', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-selection-'))
    try {
      let captured: Parameters<ChildRunExecutor>[0] | undefined
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({
          enabled: true,
          maxParallel: 1,
          profiles: { general: { toolPolicy: 'inherit' } }
        }),
        store: new FileDelegationStore(dir),
        executor: async (input) => {
          captured = input
          return { summary: 'done' }
        }
      })

      await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        profile: 'general',
        prompt: 'work',
        inheritedModel: 'gpt-5.3-codex-spark',
        inheritedProviderId: 'codex',
        inheritedAccountId: 'acct_input_model',
        approvalReviewer: 'agent',
        signal: new AbortController().signal
      })

      expect(captured).toMatchObject({
        model: 'gpt-5.3-codex-spark',
        providerId: 'codex',
        accountId: 'acct_input_model',
        approvalReviewer: 'agent'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('forces a custom inline profile to inherit the parent pair over conflicting overrides', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-custom-selection-'))
    try {
      let captured: Parameters<ChildRunExecutor>[0] | undefined
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({
          enabled: true,
          maxParallel: 1
        }),
        store: new FileDelegationStore(dir),
        executor: async (input) => {
          captured = input
          return { summary: 'done' }
        }
      })

      const record = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        prompt: 'work',
        model: 'deepseek-v4-flash',
        providerId: 'deepseek',
        inheritedModel: 'gpt-5.6-luna',
        inheritedProviderId: 'openai',
        inheritedReasoningEffort: 'high',
        inlineProfile: {
          id: 'custom:greeting-agent',
          source: 'custom',
          profile: {
            name: 'Greeting Agent',
            mode: 'subagent',
            model: 'deepseek-v4-pro',
            providerId: 'deepseek',
            toolPolicy: 'readOnly',
            reasoningEffort: 'low'
          }
        },
        signal: new AbortController().signal
      })

      expect(captured).toMatchObject({
        model: 'gpt-5.6-luna',
        providerId: 'openai',
        reasoningEffort: 'high'
      })
      expect(record).toMatchObject({
        model: 'gpt-5.6-luna',
        providerId: 'openai',
        reasoningEffort: 'high',
        profile: 'custom:greeting-agent'
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses automatic reasoning when a custom inline profile has no inherited effort metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-custom-reasoning-'))
    try {
      let captured: Parameters<ChildRunExecutor>[0] | undefined
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({
          enabled: true,
          maxParallel: 1
        }),
        store: new FileDelegationStore(dir),
        executor: async (input) => {
          captured = input
          return { summary: 'done' }
        }
      })

      const record = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        prompt: 'work',
        inlineProfile: {
          id: 'custom:auto-agent',
          source: 'custom',
          profile: {
            name: 'Auto Agent',
            mode: 'subagent',
            toolPolicy: 'readOnly',
            reasoningEffort: 'low'
          }
        },
        signal: new AbortController().signal
      })

      expect(captured?.reasoningEffort).toBe('auto')
      expect(record.reasoningEffort).toBe('auto')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects partial model/provider sources before allocating a child run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-selection-'))
    try {
      expect(() => SubagentsCapabilityConfig.parse({
        enabled: true,
        maxParallel: 1,
        profiles: { partial: { model: 'deepseek-v4-pro' } }
      })).toThrow(/model and providerId must be configured together/)

      const executor = vi.fn(async () => ({ summary: 'done' }))
      const runtime = new DelegationRuntime({
        config: SubagentsCapabilityConfig.parse({
          enabled: true,
          maxParallel: 1,
          profiles: {}
        }),
        store: new FileDelegationStore(dir),
        executor
      })

      await expect(runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        prompt: 'work',
        model: 'gpt-5.3-codex-spark',
        inheritedModel: 'deepseek-v4-pro',
        inheritedProviderId: 'deepseek',
        signal: new AbortController().signal
      })).rejects.toThrow(
        /explicit child override must configure model and providerId together; missing providerId/
      )

      await expect(runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn',
        prompt: 'work',
        inheritedProviderId: 'codex',
        signal: new AbortController().signal
      })).rejects.toThrow(
        /inherited parent selection must configure model and providerId together; missing model/
      )

      expect(executor).not.toHaveBeenCalled()
      expect((await runtime.diagnostics('parent')).childRuns).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function subagentConfig() {
  return SubagentsCapabilityConfig.parse({
    enabled: true,
    maxParallel: 1
  })
}

function makeRuntime(dir: string, executor: ChildRunExecutor = async () => ({ summary: 'done' })): {
  runtime: DelegationRuntime
  threadStore: InMemoryThreadStore
  turns: TurnService
} {
  const nowIso = () => '2026-07-04T00:00:00.000Z'
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso
  })
  const turns = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor(),
    ids: new SequentialIdGenerator(),
    nowIso
  })
  const runtime = new DelegationRuntime({
    config: subagentConfig(),
    store: new FileDelegationStore(dir),
    events,
    threadStore,
    turns,
    nowIso,
    executor
  })
  return { runtime, threadStore, turns }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
