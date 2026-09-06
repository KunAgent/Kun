import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../../src/adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../../src/adapters/in-memory-session-store.js'
import { CapabilityRegistry } from '../../src/adapters/tool/capability-registry.js'
import { buildDelegationToolProviders } from '../../src/adapters/tool/delegation-tool-provider.js'
import { LocalToolHost } from '../../src/adapters/tool/local-tool-host.js'
import { KunCapabilitiesConfig, type SubagentProfileConfig } from '../../src/contracts/capabilities.js'
import { emptyUsageSnapshot } from '../../src/contracts/usage.js'
import { BUILTIN_SUBAGENT_PROFILES } from '../../src/delegation/builtin-profiles.js'
import {
  ChildRunRecord,
  DelegationRuntime,
  FileDelegationStore,
  type ChildRunExecutor
} from '../../src/delegation/delegation-runtime.js'
import { SubagentRouter } from '../../src/delegation/subagent-router.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../src/ports/model-client.js'
import type { ToolHostContext } from '../../src/ports/tool-host.js'
import { RuntimeEventRecorder } from '../../src/services/runtime-event-recorder.js'
import { StaticRouterModel, deferred, waitFor } from '../support/delegation-runtime-fixtures.js'

describe('DelegationRuntime', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-delegation-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('rejects an unknown profile name', async () => {
    const runtime = createRuntime({ profiles: { reviewer: { toolPolicy: 'readOnly' } } })
    await expect(runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'x',
      profile: 'ghost',
      signal: new AbortController().signal
    })).rejects.toThrow(/unknown subagent profile/)
  })

  it('rejects inherited Object.prototype names as unknown profiles without creating children', async () => {
    const runtime = createRuntime({ profiles: { reviewer: { toolPolicy: 'readOnly' } } })
    for (const profile of ['constructor', 'toString', '__proto__']) {
      await expect(runtime.runChild({
        parentThreadId: 'thr_prototype_profile',
        parentTurnId: 'turn_1',
        prompt: 'x',
        profile,
        signal: new AbortController().signal
      })).rejects.toThrow(/unknown subagent profile/)
    }
    expect((await runtime.diagnostics('thr_prototype_profile')).childRuns).toEqual([])
  })

  it('defaults the tool policy to inherit (follow the main agent) when no profile resolves', async () => {
    const seen: string[] = []
    const runtime = createRuntime({
      executor: async (input) => {
        seen.push(input.toolPolicy)
        return { summary: 'ok' }
      }
    })
    const record = await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'investigate',
      signal: new AbortController().signal
    })
    expect(seen[0]).toBe('inherit')
    expect(record.toolPolicy).toBe('inherit')
  })

  it('still honors an explicit read-only default tool policy', async () => {
    const seen: string[] = []
    const runtime = createRuntime({
      defaultToolPolicy: 'readOnly',
      executor: async (input) => {
        seen.push(input.toolPolicy)
        return { summary: 'ok' }
      }
    })
    const record = await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'investigate',
      signal: new AbortController().signal
    })
    expect(seen[0]).toBe('readOnly')
    expect(record.toolPolicy).toBe('readOnly')
  })

  it('emits queued -> running -> completed events with observability metrics', async () => {
    const sessionStore = new InMemorySessionStore()
    const runtime = createRuntime({
      sessionStore,
      executor: async () => ({
        summary: 'ok',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, cacheHitRate: 0.5, costUsd: 0.01 },
        toolInvocations: 4,
        prefixReused: true,
        inheritedHistoryItems: 0
      })
    })
    const record = await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'go',
      signal: new AbortController().signal
    })
    const events = await sessionStore.loadEventsSince('thr_1', 0)
    const statuses = events
      .filter((event) => event.child?.childId === record.id)
      .map((event) => event.child?.childStatus)
    expect(statuses).toEqual(['queued', 'running', 'completed'])
    const completed = events.find((event) => event.child?.childId === record.id && event.child.childStatus === 'completed')
    expect(completed?.child).toMatchObject({
      toolInvocations: 4,
      prefixReused: true,
      totalTokens: 3,
      cacheHitRate: 0.5,
      childToolPolicy: 'inherit'
    })
  })

  it('returns immediately when detach=true and keeps executing in the background', async () => {
    const start = deferred<void>()
    const release = deferred<void>()
    let executorStarted = false
    const runtime = createRuntime({
      executor: async () => {
        executorStarted = true
        start.resolve()
        await release.promise
        return { summary: 'background done' }
      }
    })
    const queued = await runtime.runChild({
      parentThreadId: 'thr_detach',
      parentTurnId: 'turn_detach',
      prompt: 'long running task',
      detach: true,
      signal: new AbortController().signal
    })
    // Immediately returns with status 'queued' — synchronous runs would
    // have returned 'completed' here.
    expect(queued.status).toBe('queued')
    // The executor actually runs in the background.
    await start.promise
    expect(executorStarted).toBe(true)
    let diagnostics = await runtime.diagnostics('thr_detach')
    expect(diagnostics.childRuns[0]?.status).toBe('running')
    // Release the executor and wait for the record to flip to completed.
    release.resolve()
    await waitFor(async () => {
      diagnostics = await runtime.diagnostics('thr_detach')
      return diagnostics.childRuns[0]?.status === 'completed'
    })
    expect(diagnostics.childRuns[0]?.summary).toBe('background done')
  })

  it('moves a live foreground child into the background without restarting it', async () => {
    const start = deferred<void>()
    const release = deferred<void>()
    let childSignal: AbortSignal | undefined
    let executions = 0
    const runtime = createRuntime({
      executor: async ({ signal }) => {
        executions += 1
        childSignal = signal
        start.resolve()
        await release.promise
        if (signal.aborted) throw new Error('unexpected abort')
        return {
          summary: 'continued in background',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
        }
      }
    })
    const parent = new AbortController()
    const foreground = runtime.runChild({
      parentThreadId: 'thr_dynamic_detach',
      parentTurnId: 'turn_dynamic_detach',
      prompt: 'long foreground task',
      signal: parent.signal
    })
    await start.promise
    const diagnostics = await runtime.diagnostics('thr_dynamic_detach')
    const childId = diagnostics.childRuns[0]!.id

    expect(await runtime.detachChild(childId)).toBe(true)
    const released = await foreground
    expect(released).toMatchObject({ id: childId, status: 'running', detached: true })
    expect(await runtime.detachChild(childId)).toBe(false)
    parent.abort()
    expect(childSignal?.aborted).toBe(false)
    expect(executions).toBe(1)

    release.resolve()
    await waitFor(async () => {
      const latest = await runtime.diagnostics('thr_dynamic_detach')
      return latest.childRuns[0]?.status === 'completed' && latest.active === 0
    })
    const completed = (await runtime.diagnostics('thr_dynamic_detach')).childRuns[0]
    expect(completed).toMatchObject({
      id: childId,
      status: 'completed',
      detached: true,
      summary: 'continued in background',
      usage: { totalTokens: 15 }
    })
    expect(runtime.abortChild(childId)).toBe(false)
    expect(await runtime.detachChild('child_unknown')).toBe(false)
  })

  it('mirrors safe child activity phases onto the parent without reasoning text', async () => {
    const bus = new InMemoryEventBus()
    const sessionStore = new InMemorySessionStore()
    const started = deferred<string>()
    const release = deferred<void>()
    const runtime = createRuntime({
      eventBus: bus,
      sessionStore,
      executor: async ({ childId }) => {
        started.resolve(childId)
        await release.promise
        return { summary: 'activity complete' }
      }
    })
    const running = runtime.runChild({
      parentThreadId: 'thr_activity',
      parentTurnId: 'turn_activity',
      prompt: 'inspect activity',
      signal: new AbortController().signal
    })
    const childId = await started.promise
    bus.publish({
      kind: 'assistant_reasoning_delta',
      seq: 1,
      timestamp: '2026-06-03T00:00:01.000Z',
      threadId: childId,
      turnId: 'turn_child',
      itemId: 'reason_child',
      item: {
        id: 'reason_child',
        threadId: childId,
        turnId: 'turn_child',
        role: 'assistant',
        status: 'running',
        kind: 'assistant_reasoning',
        text: 'private chain of thought',
        createdAt: '2026-06-03T00:00:01.000Z'
      }
    })
    await waitFor(async () => {
      const child = (await runtime.diagnostics('thr_activity')).childRuns[0]
      return child?.activity?.phase === 'thinking'
    })
    bus.publish({
      kind: 'tool_call_started',
      seq: 2,
      timestamp: '2026-06-03T00:00:02.000Z',
      threadId: childId,
      turnId: 'turn_child',
      itemId: 'tool_child',
      item: {
        id: 'tool_child',
        threadId: childId,
        turnId: 'turn_child',
        role: 'assistant',
        status: 'running',
        kind: 'tool_call',
        toolName: 'search',
        callId: 'call_child',
        toolKind: 'tool_call',
        arguments: { query: 'secret query' },
        summary: 'Searching the workspace',
        createdAt: '2026-06-03T00:00:02.000Z'
      }
    })
    await waitFor(async () => {
      const child = (await runtime.diagnostics('thr_activity')).childRuns[0]
      return child?.activity?.phase === 'tool'
    })

    const child = (await runtime.diagnostics('thr_activity')).childRuns[0]
    expect(child?.activity).toMatchObject({
      phase: 'tool',
      label: 'Searching the workspace',
      toolName: 'search'
    })
    const parentEvents = await sessionStore.loadEventsSince('thr_activity', 0)
    const progress = parentEvents.filter((event) => event.child?.childId === childId && event.child.activity)
    expect(progress.map((event) => event.child?.activity?.phase)).toEqual(['thinking', 'tool'])
    expect(JSON.stringify(progress)).not.toContain('private chain of thought')
    expect(JSON.stringify(progress)).not.toContain('secret query')

    release.resolve()
    await expect(running).resolves.toMatchObject({ status: 'completed' })
  })

  it('abortChild signals a detached run and false-returns for unknown ids', async () => {
    const start = deferred<void>()
    const runtime = createRuntime({
      executor: async ({ signal }) => {
        start.resolve()
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
        return { summary: 'unreachable' }
      }
    })
    const queued = await runtime.runChild({
      parentThreadId: 'thr_abort',
      parentTurnId: 'turn_abort',
      prompt: 'long task',
      detach: true,
      signal: new AbortController().signal
    })
    await start.promise
    expect(runtime.abortChild(queued.id)).toBe(true)
    await waitFor(async () => {
      const diagnostics = await runtime.diagnostics('thr_abort')
      return diagnostics.childRuns[0]?.status === 'aborted'
    })
    // After the run finished the controller is cleaned up via .finally.
    // Poll because the cleanup runs in a microtask after the run resolves.
    await waitFor(() => runtime.abortChild(queued.id) === false)
    expect(runtime.abortChild('child_unknown')).toBe(false)
  })

  it('aggregates child runs by label and model for dashboards', async () => {
    const runtime = createRuntime()
    await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      label: 'research',
      prompt: 'first',
      model: 'deepseek-v4-flash',
      providerId: 'deepseek',
      signal: new AbortController().signal
    })
    await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      label: 'research',
      prompt: 'second',
      model: 'deepseek-v4-flash',
      providerId: 'deepseek',
      signal: new AbortController().signal
    })

    const diagnostics = await runtime.diagnostics('thr_1')
    expect(diagnostics.aggregates[0]).toMatchObject({
      key: 'research:deepseek-v4-flash',
      runs: 2,
      completed: 2,
      totalTokens: 6,
      averageTotalTokens: 3
    })
  })

  it('records child failure and parent interruption states', async () => {
    const failed = createRuntime({
      executor: async () => {
        throw new Error('child failed')
      }
    })
    await expect(failed.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'fail',
      signal: new AbortController().signal
    })).resolves.toMatchObject({ status: 'failed', error: 'child failed' })

    const controller = new AbortController()
    controller.abort()
    const aborted = createRuntime({
      executor: async ({ signal }) => {
        if (signal.aborted) throw new Error('aborted')
        return { summary: 'unreachable' }
      }
    })
    await expect(aborted.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'abort',
      signal: controller.signal
    })).rejects.toThrow('aborted before routing completed')
  })

  it('reconciles child runs left running/queued by a previous process, leaving terminal ones', async () => {
    const store = new FileDelegationStore(join(dir, 'children'))
    const base = {
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'x',
      toolPolicy: 'inherit' as const,
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    }
    await store.upsert(ChildRunRecord.parse({ ...base, id: 'child_run', status: 'running' }))
    await store.upsert(ChildRunRecord.parse({ ...base, id: 'child_queued', status: 'queued' }))
    await store.upsert(ChildRunRecord.parse({ ...base, id: 'child_done', status: 'completed' }))
    if (process.platform !== 'win32') {
      expect((await stat(join(dir, 'children'))).mode & 0o777).toBe(0o700)
      expect((await stat(join(dir, 'children', 'child_run.json'))).mode & 0o777).toBe(0o600)
    }

    const runtime = createRuntime({})
    const reconciled = await runtime.reconcileOrphanedChildRuns()
    expect(reconciled).toBe(2)

    const byId = new Map((await store.list('thr_1')).map((run) => [run.id, run]))
    expect(byId.get('child_run')?.status).toBe('failed')
    expect(byId.get('child_run')?.error).toMatch(/interrupted by a runtime restart/)
    expect(byId.get('child_queued')?.status).toBe('failed')
    // Terminal records are left exactly as they were.
    expect(byId.get('child_done')?.status).toBe('completed')

    // Idempotent: a second sweep finds nothing new.
    expect(await runtime.reconcileOrphanedChildRuns()).toBe(0)
  })

  function createRuntime(options: {
    enabled?: boolean
    useExistingAgents?: boolean
    maxParallel?: number
    defaultToolPolicy?: 'readOnly' | 'inherit'
    defaultProfile?: string
    profiles?: Record<string, Partial<SubagentProfileConfig>>
    sessionStore?: InMemorySessionStore
    eventBus?: InMemoryEventBus
    executor?: ConstructorParameters<typeof DelegationRuntime>[0]['executor']
    recordExternalUsage?: ConstructorParameters<typeof DelegationRuntime>[0]['recordExternalUsage']
  } = {}) {
    const sessionStore = options.sessionStore ?? new InMemorySessionStore()
    const bus = options.eventBus ?? new InMemoryEventBus()
    const recorder = new RuntimeEventRecorder({
      eventBus: bus,
      sessionStore,
      allocateSeq: (threadId) => bus.allocateSeq(threadId),
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })
    const profiles = options.profiles ?? {
      general: { description: 'General worker', toolPolicy: 'inherit' as const }
    }
    const defaultProfile = options.defaultProfile
    const config = KunCapabilitiesConfig.parse({
      subagents: {
        enabled: options.enabled ?? true,
        useExistingAgents: options.useExistingAgents ?? true,
        maxParallel: options.maxParallel ?? 1,
        ...(options.defaultToolPolicy ? { defaultToolPolicy: options.defaultToolPolicy } : {}),
        ...(defaultProfile ? { defaultProfile } : {}),
        profiles
      }
    }).subagents
    let idSeq = 0
    return new DelegationRuntime({
      config,
      store: new FileDelegationStore(join(dir, 'children')),
      events: recorder,
      eventBus: bus,
      nowIso: () => '2026-06-03T00:00:00.000Z',
      idGenerator: () => `child_${++idSeq}_${Math.random().toString(36).slice(2, 6)}`,
      recordExternalUsage: options.recordExternalUsage,
      executor: options.executor ?? (async ({ prompt }) => ({
        summary: `done: ${prompt}`,
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
      }))
    })
  }
})
