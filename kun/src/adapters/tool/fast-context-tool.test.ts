import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../in-memory-event-bus.js'
import { InMemorySessionStore } from '../in-memory-session-store.js'
import { InMemoryThreadStore } from '../in-memory-thread-store.js'
import { ContextCompactor } from '../../loop/context-compactor.js'
import { InflightTracker } from '../../loop/inflight-tracker.js'
import { SteeringQueue } from '../../loop/steering-queue.js'
import { SequentialIdGenerator } from '../../ports/id-generator.js'
import { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import { TurnService } from '../../services/turn-service.js'
import {
  DelegationRuntime,
  FileDelegationStore,
  type ChildRunExecutor
} from '../../delegation/delegation-runtime.js'
import type { FastContextTask } from '../../delegation/fast-context-evidence.js'
import { SubagentsCapabilityConfig } from '../../contracts/capabilities.js'
import {
  FAST_CONTEXT_ALLOWED_TOOLS,
  FAST_CONTEXT_PROVIDER_ID,
  FAST_CONTEXT_QUEUE_TIMEOUT_MS,
  FAST_CONTEXT_TOOL_NAME,
  buildFastContextToolProvider
} from './fast-context-tool-provider.js'

function makeRuntime(dir: string, executor: ChildRunExecutor): DelegationRuntime {
  const nowIso = () => '2026-08-13T00:00:00.000Z'
  const threadStore = new InMemoryThreadStore()
  const sessionStore = new InMemorySessionStore()
  const eventBus = new InMemoryEventBus()
  const events = new RuntimeEventRecorder({ eventBus, sessionStore, allocateSeq: (threadId) => eventBus.allocateSeq(threadId), nowIso })
  const turns = new TurnService({
    threadStore, sessionStore, events, inflight: new InflightTracker(), steering: new SteeringQueue(),
    compactor: new ContextCompactor(), ids: new SequentialIdGenerator(), nowIso
  })
  return new DelegationRuntime({
    config: SubagentsCapabilityConfig.parse({ enabled: true, maxParallel: 4, profiles: { general: { mode: 'subagent', toolPolicy: 'inherit' } } }),
    store: new FileDelegationStore(dir), events, threadStore, turns, nowIso, executor
  })
}

const baseContext = {
  threadId: 'thr_main', turnId: 'turn_main', workspace: '/workspace', agentSurface: 'code' as const,
  clientSurface: 'gui' as const, approvalPolicy: 'auto' as const, approvalReviewer: 'user' as const,
  awaitApproval: async () => 'allow' as const,
  model: { id: 'main-model', inputModalities: ['text'] as ('text' | 'image')[], outputModalities: ['text'] as ('text' | 'image')[], supportsToolCalling: true, messageParts: ['text'] as ('text' | 'image_url' | 'input_image')[], contextWindowTokens: 128_000 },
  actingModelRoute: { model: 'main-model', providerId: 'deepseek' }, reasoningEffort: 'high', serviceTier: 'priority' as const,
  abortSignal: new AbortController().signal
}

function tasks(count = 2): FastContextTask[] {
  return Array.from({ length: count }, (_, index) => ({ title: `Scope ${index + 1}`, query: `inspect scope ${index + 1}` }))
}

function evidencePack(input: readonly FastContextTask[]) {
  return {
    version: 1 as const,
    tasks: input.map((task, index) => ({
      index, title: task.title, query: task.query,
      evidence: [{ path: `src/scope-${index + 1}.ts`, ranges: [[index + 1, index + 2] as [number, number]], excerpt: 'matching source', reason: 'targeted grep result' }],
      conclusion: `Task ${index + 1} conclusion`, uncertainties: []
    })),
    uncertainties: []
  }
}

describe('fast_context Fast Context provider', () => {
  let dir: string | undefined
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

  it('retains the Lab gate and 1-4 task schema while advertising only Fast Context semantics', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fast-context-tool-'))
    const runtime = makeRuntime(dir, async () => ({ summary: 'ok' }))
    const provider = buildFastContextToolProvider(runtime, () => ({ enabled: true }))[0]
    expect(provider.id).toBe(FAST_CONTEXT_PROVIDER_ID)
    expect(provider.tools[0]?.name).toBe(FAST_CONTEXT_TOOL_NAME)
    expect(provider.tools[0]?.sideEffect).toBe('read-only')
    expect(provider.tools[0]?.shouldAdvertise?.(baseContext)).toBe(true)
    expect(provider.tools[0]?.description).toContain('one budgeted child')
    expect(provider.tools[0]?.inputSchema).toMatchObject({
      properties: { tasks: { type: 'array', minItems: 1, maxItems: 4, items: { required: ['title', 'query'] } } }, required: ['tasks']
    })
    expect((provider.tools[0]?.inputSchema as { properties?: Record<string, unknown> }).properties).not.toHaveProperty('workspace')
    const disabled = buildFastContextToolProvider(runtime, () => ({ enabled: false }))[0]?.tools[0]
    expect(disabled?.shouldAdvertise?.(baseContext)).toBe(false)
  })

  it('rejects malformed batches before allocating a child', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fast-context-tool-'))
    let runs = 0
    const runtime = makeRuntime(dir, async () => { runs += 1; return { summary: 'ok' } })
    const tool = buildFastContextToolProvider(runtime, () => ({ enabled: true }))[0]!.tools[0]!
    for (const args of [{}, { tasks: [] }, { tasks: Array.from({ length: 5 }, () => ({ title: 'x', query: 'x' })) }, { tasks: [{ title: 'x' }] }]) {
      const result = await tool.execute(args, baseContext)
      expect(result.isError).toBe(true)
    }
    expect(runs).toBe(0)
  })

  it('merges every task into one strict Fast Context child and returns only its compact evidence pack', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fast-context-tool-'))
    let received: Record<string, unknown> | undefined
    let runs = 0
    const runtime = makeRuntime(dir, async (input) => {
      runs += 1
      received = { ...input, signal: undefined }
      return { summary: 'Task 1: first\nTask 2: second', toolInvocations: 3, evidencePack: evidencePack(input.fastContextTasks ?? []) }
    })
    const tool = buildFastContextToolProvider(runtime, () => ({ enabled: true }))[0]!.tools[0]!
    const updates: Record<string, unknown>[] = []
    const result = await tool.execute({ tasks: tasks(), workspace: '/' }, baseContext, async (update) => { updates.push(update.output as Record<string, unknown>) })

    expect(runs).toBe(1)
    expect(result.isError).toBeFalsy()
    expect(result.output).toMatchObject({
      status: 'completed', label: 'Fast Context retrieval', title: 'Fast Context retrieval', launcher: 'fast_context',
      profile: 'explore', child: { status: 'completed', profile: 'explore' },
      evidencePack: { version: 1, tasks: [{ index: 0, title: 'Scope 1' }, { index: 1, title: 'Scope 2' }] }
    })
    expect(result.output as Record<string, unknown>).not.toHaveProperty('children')
    expect(result.output as Record<string, unknown>).not.toHaveProperty('summary')
    expect(result.output as Record<string, unknown>).not.toHaveProperty('evidence')
    expect(typeof (result.output as { childId?: string }).childId).toBe('string')
    expect(updates[0]).toMatchObject({
      status: 'queued',
      childId: expect.any(String),
      child: { status: 'queued', childId: expect.any(String) }
    })
    expect(updates.map((update) => update.status)).toContain('queued')
    expect(updates.map((update) => update.status)).toContain('running')
    // ChildRunExecutor receives the resolved child boundary rather than the
    // provider's routing-only inputs, so assert the durable execution shape.
    expect(received).toMatchObject({
      label: 'Fast Context retrieval', profile: 'explore', fastContext: true,
      fastContextTasks: tasks(), model: 'main-model', providerId: 'deepseek', reasoningEffort: 'high',
      serviceTier: 'priority', toolPolicy: 'readOnly', allowedTools: ['grep', 'glob', 'read'], returnFormat: 'summary',
      workspace: '/workspace', security: { sandboxRoot: '/workspace', allowedReadPaths: ['.'] }
    })
    expect(received?.prompt).toContain('Task 1: Scope 1')
    expect(received?.prompt).toContain('Task 2: Scope 2')
    expect(received?.prompt).toContain('Round 4 is final synthesis only')
    expect(received?.prompt).toContain('no more than four')
    expect(received?.prompt).toContain('Do not call a tool in round 4')
    expect(received?.prompt).toContain('task_indexes array')
    expect(received?.systemPrompt).toContain('only use grep, glob, and read')
    expect(received?.systemPrompt).not.toContain('列目录')
  })

  it('starts exactly one retrieval child for every accepted batch size', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fast-context-tool-'))
    const childTaskCounts: number[] = []
    const runtime = makeRuntime(dir, async (input) => {
      childTaskCounts.push(input.fastContextTasks?.length ?? 0)
      return { summary: 'done', evidencePack: evidencePack(input.fastContextTasks ?? []) }
    })
    const tool = buildFastContextToolProvider(runtime, () => ({ enabled: true }))[0]!.tools[0]!

    for (const count of [1, 2, 3, 4]) {
      await expect(tool.execute({ tasks: tasks(count) }, baseContext)).resolves.toMatchObject({ isError: false })
    }
    expect(childTaskCounts).toEqual([1, 2, 3, 4])
  })

  it('preserves Lab model, provider, reasoning, and priority overrides on the one child', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fast-context-tool-'))
    let received: Record<string, unknown> | undefined
    const runtime = makeRuntime(dir, async (input) => {
      received = { ...input, signal: undefined }
      return { summary: 'done', evidencePack: evidencePack(input.fastContextTasks ?? []) }
    })
    const tool = buildFastContextToolProvider(runtime, () => ({ enabled: true, model: 'gpt-5.4', providerId: 'codex', reasoningEffort: 'medium', fast: true }))[0]!.tools[0]!
    await tool.execute({ tasks: tasks(1) }, baseContext)
    expect(received).toMatchObject({
      model: 'gpt-5.4', providerId: 'codex', reasoningEffort: 'medium', serviceTier: 'priority',
      fastContext: true, allowedTools: ['grep', 'glob', 'read']
    })
    expect(received?.serviceTier).toBe('priority')
  })

  it('projects one aborted child with grouped uncertainties instead of a synthetic failed task batch', async () => {
    dir = await mkdtemp(join(tmpdir(), 'fast-context-tool-'))
    const controller = new AbortController()
    const runtime = makeRuntime(dir, async (input) => {
      await new Promise<void>((_resolve, reject) => input.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
      return { summary: 'unreachable' }
    })
    const tool = buildFastContextToolProvider(runtime, () => ({ enabled: true }))[0]!.tools[0]!
    const pending = tool.execute({ tasks: tasks(3) }, { ...baseContext, abortSignal: controller.signal })
    controller.abort()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({ status: 'aborted', evidencePack: { version: 1, tasks: [{ index: 0 }, { index: 1 }, { index: 2 }] } })
  })

  it('settles a queue timeout as a failed tool result with the stable runtime failure', async () => {
    let receivedTimeout: number | undefined
    const runtime = {
      enabled: () => true,
      runChild: async (input: Parameters<DelegationRuntime['runChild']>[0]) => {
        receivedTimeout = input.queueTimeoutMs
        await input.onQueued?.('child_timeout', 'explore', { profileName: 'Repository Explorer' })
        return {
          id: 'child_timeout',
          status: 'failed' as const,
          model: 'main-model',
          parentThreadId: input.parentThreadId,
          parentTurnId: input.parentTurnId,
          failure: { source: 'runtime' as const, code: 'child_queue_timeout', category: 'timeout' as const },
          queuedMs: FAST_CONTEXT_QUEUE_TIMEOUT_MS,
          error: `Child run could not start within ${FAST_CONTEXT_QUEUE_TIMEOUT_MS}ms because all execution slots remained occupied.`
        } as Awaited<ReturnType<DelegationRuntime['runChild']>>
      }
    } as unknown as DelegationRuntime
    const tool = buildFastContextToolProvider(runtime, () => ({ enabled: true }))[0]!.tools[0]!
    const updates: Record<string, unknown>[] = []

    const result = await tool.execute({ tasks: tasks(1) }, baseContext, async (update) => {
      updates.push(update.output as Record<string, unknown>)
    })

    expect(receivedTimeout).toBe(30_000)
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      status: 'failed',
      childId: 'child_timeout',
      failure: { source: 'runtime', code: 'child_queue_timeout', category: 'timeout' },
      queuedMs: 30_000,
      evidencePack: {
        version: 1,
        tasks: [{ index: 0, title: 'Scope 1' }],
        uncertainties: expect.arrayContaining([expect.stringContaining('could not start within 30000ms')])
      }
    })
    expect(updates.at(-1)).toMatchObject({ status: 'failed', childId: 'child_timeout' })
  })

  it('keeps mutation, shell, web, map, and delegation tools outside the child boundary', () => {
    expect(FAST_CONTEXT_ALLOWED_TOOLS).toEqual(['grep', 'glob', 'read'])
    for (const forbidden of ['bash', 'web_search', 'web_fetch', 'repo_map', 'find', 'ls', 'write', 'edit', 'delegate_task']) {
      expect(FAST_CONTEXT_ALLOWED_TOOLS).not.toContain(forbidden)
    }
  })
})
