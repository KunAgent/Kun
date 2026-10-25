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

describe('DelegationRuntime resume handling', () => {
  it('appends a follow-up turn to the same persisted child snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-resume-'))
    try {
      const calls: Parameters<ChildRunExecutor>[0][] = []
      const externalUsage: Array<{ promptTokens: number; completionTokens: number; totalTokens: number; turns: number }> = []
      const store = new FileDelegationStore(dir)
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store,
        idGenerator: () => 'child_ppt',
        nowIso: (() => {
          let tick = 0
          return () => `2026-07-04T00:00:0${tick++}.000Z`
        })(),
        recordExternalUsage: (_threadId, usage) => externalUsage.push(usage),
        executor: async (input) => {
          calls.push(input)
          return {
            summary: input.resumeChild ? 'revised' : 'initial',
            usage: input.resumeChild
              ? { promptTokens: 30, completionTokens: 12, totalTokens: 42, turns: 2 }
              : { promptTokens: 10, completionTokens: 5, totalTokens: 15, turns: 1 }
          }
        }
      })
      const first = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        label: 'PPT review',
        prompt: 'generate previews',
        source: {
          prompt: 'generate previews',
          attachmentIds: [],
          composerContexts: [],
          fileReferences: [],
          agentSurface: 'write'
        },
        agentSurface: 'write',
        guiDesignCanvas: true,
        workspace: '/workspace',
        inlineProfile: {
          id: 'ppt',
          source: 'builtin',
          profile: {
            mode: 'subagent',
            toolPolicy: 'inherit',
            allowedTools: ['generate_image'],
            systemPrompt: 'PPT child'
          }
        },
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        signal: new AbortController().signal
      })
      const resumed = await runtime.resumeChild({
        childId: first.id,
        parentThreadId: 'parent',
        parentTurnId: 'turn-2',
        prompt: 'revise slide 2',
        source: {
          prompt: 'revise slide 2',
          attachmentIds: [],
          composerContexts: [],
          fileReferences: [],
          agentSurface: 'design'
        },
        signal: new AbortController().signal
      })

      expect(first.id).toBe('child_ppt')
      expect(resumed).toMatchObject({
        id: 'child_ppt',
        parentTurnId: 'turn-2',
        prompt: 'revise slide 2',
        agentSurface: 'design',
        summary: 'revised',
        resumeCount: 1,
        usage: { promptTokens: 30, completionTokens: 12, totalTokens: 42, turns: 2 },
        durationMs: 2_000
      })
      expect(calls).toHaveLength(2)
      expect(calls[1]).toMatchObject({
        resumeChild: true,
        childId: 'child_ppt',
        parentThreadId: 'parent',
        parentTurnId: 'turn-2',
        workspace: '/workspace',
        agentSurface: 'design',
        clientSurface: 'gui',
        systemPrompt: 'PPT child',
        allowedTools: ['generate_image']
      })
      expect((await store.list('parent'))).toHaveLength(1)
      expect(externalUsage).toMatchObject([
        { promptTokens: 10, completionTokens: 5, totalTokens: 15, turns: 1 },
        { promptTokens: 20, completionTokens: 7, totalTokens: 27, turns: 1 }
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('intersects the current parent boundary on resume', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-resume-boundary-'))
    try {
      const calls: Parameters<ChildRunExecutor>[0][] = []
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        idGenerator: () => 'child_ppt_boundary',
        executor: async (input) => {
          calls.push(input)
          return { summary: 'review ready' }
        }
      })
      const first = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        prompt: 'generate previews',
        workspace: '/workspace',
        inlineProfile: {
          id: 'ppt',
          source: 'builtin',
          profile: { mode: 'subagent', toolPolicy: 'inherit', allowedTools: ['generate_image', 'write'] }
        },
        security: {
          sandboxRoot: '/workspace',
          allowedToolNames: ['generate_image', 'write'],
          allowedWritePaths: ['/workspace'],
          memoryEnabled: true
        },
        signal: new AbortController().signal
      })

      await runtime.resumeChild({
        childId: first.id,
        parentThreadId: 'parent',
        parentTurnId: 'turn-2',
        prompt: 'revise slide',
        expectedProfile: 'ppt',
        security: {
          sandboxRoot: '/workspace',
          allowedToolNames: ['generate_image'],
          allowedWritePaths: ['/workspace/deck'],
          blockedToolNames: ['bash'],
          memoryEnabled: false
        },
        signal: new AbortController().signal
      })

      expect(calls[1]?.security).toMatchObject({
        sandboxRoot: '/workspace',
        allowedToolNames: ['generate_image'],
        allowedWritePaths: ['/workspace/deck'],
        blockedToolNames: ['bash'],
        memoryEnabled: false
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects concurrent follow-ups for the same persistent child', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-resume-lock-'))
    try {
      let releaseResume = (): void => undefined
      const resumeGate = new Promise<void>((resolve) => { releaseResume = resolve })
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store: new FileDelegationStore(dir),
        idGenerator: () => 'child_ppt_lock',
        executor: async (input) => {
          if (input.resumeChild) await resumeGate
          return { summary: input.resumeChild ? 'revised' : 'initial' }
        }
      })
      const first = await runtime.runChild({
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        prompt: 'generate previews',
        workspace: '/workspace',
        inlineProfile: {
          id: 'ppt',
          source: 'builtin',
          profile: { mode: 'subagent', toolPolicy: 'inherit' }
        },
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        signal: new AbortController().signal
      })
      const running = runtime.resumeChild({
        childId: first.id,
        parentThreadId: 'parent',
        parentTurnId: 'turn-2',
        prompt: 'first follow-up',
        signal: new AbortController().signal
      })
      await expect(runtime.resumeChild({
        childId: first.id,
        parentThreadId: 'parent',
        parentTurnId: 'turn-3',
        prompt: 'racing follow-up',
        signal: new AbortController().signal
      })).rejects.toThrow('is still running')
      releaseResume()
      await expect(running).resolves.toMatchObject({ summary: 'revised', resumeCount: 1 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('enforces generic ownership, resumable state, and optimistic resume count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-generic-resume-'))
    try {
      const store = new FileDelegationStore(dir)
      await store.upsert(ChildRunRecord.parse({
        id: 'child_generic',
        parentThreadId: 'parent',
        parentTurnId: 'turn-1',
        launcher: 'delegate_task',
        prompt: 'inspect the repository',
        workspace: '/workspace',
        profile: 'general',
        profileSnapshot: { mode: 'subagent', toolPolicy: 'inherit' },
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        status: 'aborted',
        terminationReason: 'manual_stop',
        resumable: true,
        resumeCount: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:01.000Z'
      }))
      const runtime = new DelegationRuntime({
        config: subagentConfig(),
        store,
        executor: async () => ({ summary: 'finished' })
      })

      await expect(runtime.resumeChild({
        childId: 'child_generic',
        parentThreadId: 'another_parent',
        parentTurnId: 'turn-2',
        prompt: 'cross-parent resume',
        expectedResumeCount: 0,
        expectedLaunchers: ['delegate_task'],
        requireResumable: true,
        signal: new AbortController().signal
      })).rejects.toThrow('does not belong to this parent thread')

      const resumed = await runtime.resumeChild({
        childId: 'child_generic',
        parentThreadId: 'parent',
        parentTurnId: 'turn-2',
        prompt: 'continue',
        expectedResumeCount: 0,
        expectedLaunchers: ['delegate_task', 'fast_context'],
        requireResumable: true,
        signal: new AbortController().signal
      })
      expect(resumed).toMatchObject({
        id: 'child_generic',
        parentTurnId: 'turn-2',
        status: 'completed',
        resumable: false,
        resumeCount: 1
      })

      await expect(runtime.resumeChild({
        childId: 'child_generic',
        parentThreadId: 'parent',
        parentTurnId: 'turn-3',
        prompt: 'duplicate',
        expectedResumeCount: 0,
        expectedLaunchers: ['delegate_task'],
        requireResumable: true,
        signal: new AbortController().signal
      })).rejects.toThrow('resume count changed from 0 to 1')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('never resumes a persisted Fast Context child, even when an old record says resumable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-fast-context-no-resume-'))
    try {
      const store = new FileDelegationStore(dir)
      await store.upsert(ChildRunRecord.parse({
        id: 'child_fast_context', parentThreadId: 'parent', parentTurnId: 'turn-1',
        launcher: 'fast_context', fastContext: true,
        fastContextTasks: [{ title: 'Auth', query: 'Find createSession.' }],
        prompt: 'retrieve auth', workspace: '/workspace', profile: 'explore',
        profileSnapshot: { mode: 'subagent', toolPolicy: 'readOnly', allowedTools: ['grep', 'glob', 'read'] },
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        status: 'aborted', terminationReason: 'manual_stop', resumable: true, resumeCount: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:01.000Z'
      }))
      const runtime = new DelegationRuntime({ config: subagentConfig(), store, executor: async () => ({ summary: 'must not run' }) })
      await expect(runtime.resumeChild({
        childId: 'child_fast_context', parentThreadId: 'parent', parentTurnId: 'turn-2',
        prompt: 'leak child summary', expectedLaunchers: ['fast_context'], requireResumable: true,
        signal: new AbortController().signal
      })).rejects.toThrow('Fast Context retrieval children cannot be resumed')
      await expect(runtime.resumableParentThreadIds()).resolves.toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('marks only generic orphaned children resumable after restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-delegation-restart-resume-'))
    try {
      const store = new FileDelegationStore(dir)
      const base = {
        parentTurnId: 'turn-1',
        prompt: 'work',
        workspace: '/workspace',
        profileSnapshot: { mode: 'subagent' as const, toolPolicy: 'inherit' as const },
        security: { sandboxRoot: '/workspace', memoryEnabled: false },
        status: 'running' as const,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:01.000Z'
      }
      await store.upsert(ChildRunRecord.parse({
        ...base,
        id: 'child_generic_restart',
        parentThreadId: 'parent_generic',
        launcher: 'fast_context',
        detached: true
      }))
      await store.upsert(ChildRunRecord.parse({
        ...base,
        id: 'child_graph_restart',
        parentThreadId: 'parent_graph',
        launcher: 'graph'
      }))
      const runtime = new DelegationRuntime({ config: subagentConfig(), store })

      await expect(runtime.reconcileOrphanedChildRuns()).resolves.toBe(2)
      await expect(runtime.resumableParentThreadIds()).resolves.toEqual(['parent_generic'])
      await expect(store.get('child_generic_restart')).resolves.toMatchObject({
        status: 'failed', terminationReason: 'runtime_restart', resumable: true
      })
      await expect(store.get('child_graph_restart')).resolves.toMatchObject({
        status: 'failed', terminationReason: 'runtime_restart', resumable: false
      })
      await expect(runtime.resumeChild({
        childId: 'child_graph_restart',
        parentThreadId: 'parent_graph',
        parentTurnId: 'turn-2',
        prompt: 'generic resume must not own Graph',
        expectedLaunchers: ['delegate_task', 'fast_context'],
        requireResumable: true,
        signal: new AbortController().signal
      })).rejects.toThrow('is owned by graph')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('createChildAgentExecutor abort handling', () => {
  it('connects the parent signal to the child turn interrupt', async () => {
    const model = new HangingModel()
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ registry: new CapabilityRegistry() }),
      prefix: createImmutablePrefix({ systemPrompt: 'You are Kun.' }),
      defaultModel: 'test-model'
    })
    const parent = new AbortController()
    const run = executor({
      childId: 'child',
      parentThreadId: 'parent',
      parentTurnId: 'turn',
      prompt: 'work until interrupted',
      toolPolicy: 'inherit',
      signal: parent.signal
    })

    await model.requestStarted
    parent.abort()

    await expect(run).rejects.toThrow('Child agent aborted.')
    expect(model.requests[0].abortSignal.aborted).toBe(true)
  })
})

function subagentConfig() {
  return SubagentsCapabilityConfig.parse({
    enabled: true,
    maxParallel: 1
  })
}

function makeRuntime(dir: string): {
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
    executor: async () => ({
      summary: 'done'
    })
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
