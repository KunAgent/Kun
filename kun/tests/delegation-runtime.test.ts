import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { buildDelegationToolProviders } from '../src/adapters/tool/delegation-tool-provider.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { KunCapabilitiesConfig } from '../src/contracts/capabilities.js'
import { DelegationRuntime, FileDelegationStore } from '../src/delegation/delegation-runtime.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'

describe('DelegationRuntime', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-delegation-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates child runs, persists records, and emits child event metadata', async () => {
    const sessionStore = new InMemorySessionStore()
    const externalUsage: unknown[] = []
    const runtime = createRuntime({ sessionStore, recordExternalUsage: (_threadId, usage) => externalUsage.push(usage) })
    const result = await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      label: 'research',
      prompt: 'Research A',
      workspace: '/tmp/ws',
      signal: new AbortController().signal
    })

    expect(result).toMatchObject({ status: 'completed', summary: 'done: Research A' })
    expect((await runtime.diagnostics('thr_1')).childRuns).toHaveLength(1)
    const events = await sessionStore.loadEventsSince('thr_1', 0)
    expect(events.some((event) => event.child?.childId === result.id && event.child.childStatus === 'completed')).toBe(true)
    expect(externalUsage).toHaveLength(1)
    expect(externalUsage[0]).toMatchObject({ totalTokens: 3 })
  })

  it('fires onStart with the child id (so the tool can surface it mid-run)', async () => {
    const runtime = createRuntime({})
    const started: Array<{ childId: string; profile?: string }> = []
    const result = await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'Research B',
      onStart: (childId, profile) => started.push({ childId, profile }),
      signal: new AbortController().signal
    })
    expect(started).toHaveLength(1)
    expect(started[0]?.childId).toBe(result.id)
  })

  it('denies disabled delegation and exhausted child budgets', async () => {
    const disabled = createRuntime({ enabled: false })
    await expect(disabled.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'x',
      signal: new AbortController().signal
    })).rejects.toThrow(/disabled/)

    const budgeted = createRuntime({ maxChildRuns: 1 })
    await budgeted.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'first',
      signal: new AbortController().signal
    })
    await expect(budgeted.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'second',
      signal: new AbortController().signal
    })).rejects.toThrow(/budget/)
  })

  it('executes delegate_task through the normal tool host', async () => {
    const runtime = createRuntime()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildDelegationToolProviders(runtime))
    })
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'delegate_task',
      arguments: { label: 'A', prompt: 'Investigate A' }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      approvalPolicy: 'auto',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow'
    })

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        status: 'completed',
        summary: 'done: Investigate A',
        usage: { totalTokens: 3 }
      })
    }
  })

  it('caps concurrency at maxParallel and queues the overflow instead of erroring', async () => {
    const gate = deferred<void>()
    let active = 0
    let maxObservedActive = 0
    const runtime = createRuntime({
      maxParallel: 2,
      maxChildRuns: 10,
      executor: async ({ prompt }) => {
        active += 1
        maxObservedActive = Math.max(maxObservedActive, active)
        await gate.promise
        active -= 1
        return { summary: `done: ${prompt}` }
      }
    })
    const signal = new AbortController().signal
    const runs = [0, 1, 2, 3].map((index) =>
      runtime.runChild({ parentThreadId: 'thr_1', parentTurnId: 'turn_1', prompt: `p${index}`, signal })
    )
    // Two children start; the other two wait on a parallel slot.
    await waitFor(() => maxObservedActive >= 2)
    expect(active).toBe(2)
    gate.resolve()
    const results = await Promise.all(runs)
    expect(results.every((record) => record.status === 'completed')).toBe(true)
    expect(maxObservedActive).toBe(2)
    expect((await runtime.diagnostics('thr_1')).childRuns).toHaveLength(4)
  })

  it('marks a child aborted while it is still queued', async () => {
    const gate = deferred<void>()
    const controller = new AbortController()
    const runtime = createRuntime({
      maxParallel: 1,
      executor: async () => {
        await gate.promise
        return { summary: 'blocking' }
      }
    })
    // Drive the only slot to a confirmed running state before enqueuing the
    // second child, so the abort target is deterministically the queued one.
    const blocking = runtime.runChild({ parentThreadId: 'thr_1', parentTurnId: 'turn_1', prompt: 'hold', signal: new AbortController().signal })
    await waitFor(async () => (await runtime.diagnostics('thr_1')).childRuns.some((run) => run.status === 'running'))
    const queued = runtime.runChild({ parentThreadId: 'thr_1', parentTurnId: 'turn_1', prompt: 'wait', signal: controller.signal })
    await waitFor(async () => (await runtime.diagnostics('thr_1')).childRuns.some((run) => run.status === 'queued'))
    controller.abort()
    await expect(queued).resolves.toMatchObject({ status: 'aborted' })
    gate.resolve()
    await expect(blocking).resolves.toMatchObject({ status: 'completed' })
  })

  it('resolves a profile to model, provider, preamble, and tool policy', async () => {
    const seen: Array<{ model?: string; providerId?: string; promptPreamble?: string; toolPolicy: string }> = []
    const runtime = createRuntime({
      defaultProfile: 'reviewer',
      profiles: {
        reviewer: { model: 'deepseek-v4-pro', providerId: 'minimax', promptPreamble: 'Review for bugs.', toolPolicy: 'readOnly' }
      },
      executor: async (input) => {
        seen.push({ model: input.model, providerId: input.providerId, promptPreamble: input.promptPreamble, toolPolicy: input.toolPolicy })
        return { summary: 'reviewed', toolInvocations: 2, prefixReused: true, inheritedHistoryItems: 0 }
      }
    })
    const record = await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'check the diff',
      signal: new AbortController().signal
    })
    expect(seen[0]).toMatchObject({ model: 'deepseek-v4-pro', providerId: 'minimax', promptPreamble: 'Review for bugs.', toolPolicy: 'readOnly' })
    expect(record).toMatchObject({
      profile: 'reviewer',
      toolPolicy: 'readOnly',
      model: 'deepseek-v4-pro',
      providerId: 'minimax',
      toolInvocations: 2,
      prefixReused: true,
      inheritedHistoryItems: 0
    })
  })

  it('threads a profile\'s blocked tool/MCP/skill deny-lists to the child executor', async () => {
    const seen: Array<{ blockedTools?: string[]; blockedMcpServers?: string[]; blockedSkills?: string[] }> = []
    const runtime = createRuntime({
      defaultProfile: 'scoped',
      profiles: {
        scoped: {
          toolPolicy: 'inherit',
          blockedTools: ['bash', 'write'],
          blockedMcpServers: ['github'],
          blockedSkills: ['deep-research']
        }
      },
      executor: async (input) => {
        seen.push({
          blockedTools: input.blockedTools,
          blockedMcpServers: input.blockedMcpServers,
          blockedSkills: input.blockedSkills
        })
        return { summary: 'ok' }
      }
    })
    await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'go',
      signal: new AbortController().signal
    })
    expect(seen[0]).toEqual({
      blockedTools: ['bash', 'write'],
      blockedMcpServers: ['github'],
      blockedSkills: ['deep-research']
    })
  })

  it('routes a child through an explicit providerId, overriding the profile, and surfaces it on the event', async () => {
    const sessionStore = new InMemorySessionStore()
    const seen: Array<{ providerId?: string }> = []
    const runtime = createRuntime({
      sessionStore,
      defaultProfile: 'reviewer',
      profiles: { reviewer: { providerId: 'minimax', toolPolicy: 'readOnly' } },
      executor: async (input) => {
        seen.push({ providerId: input.providerId })
        return { summary: 'ok' }
      }
    })
    // An explicit providerId on the call wins over the profile's providerId.
    const record = await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'go',
      providerId: 'anthropic',
      signal: new AbortController().signal
    })
    expect(seen[0]?.providerId).toBe('anthropic')
    expect(record.providerId).toBe('anthropic')
    const events = await sessionStore.loadEventsSince('thr_1', 0)
    const completed = events.find((event) => event.child?.childId === record.id && event.child.childStatus === 'completed')
    expect(completed?.child?.childProviderId).toBe('anthropic')
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
    const runtime = createRuntime({
      executor: async () => {
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
      signal: new AbortController().signal
    })
    await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      label: 'research',
      prompt: 'second',
      model: 'deepseek-v4-flash',
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
    })).resolves.toMatchObject({ status: 'aborted' })
  })

  function createRuntime(options: {
    enabled?: boolean
    maxParallel?: number
    maxChildRuns?: number
    defaultToolPolicy?: 'readOnly' | 'inherit'
    defaultProfile?: string
    profiles?: Record<string, { model?: string; providerId?: string; promptPreamble?: string; toolPolicy?: 'readOnly' | 'inherit'; blockedTools?: string[]; blockedMcpServers?: string[]; blockedSkills?: string[] }>
    sessionStore?: InMemorySessionStore
    executor?: ConstructorParameters<typeof DelegationRuntime>[0]['executor']
    recordExternalUsage?: ConstructorParameters<typeof DelegationRuntime>[0]['recordExternalUsage']
  } = {}) {
    const sessionStore = options.sessionStore ?? new InMemorySessionStore()
    const bus = new InMemoryEventBus()
    const recorder = new RuntimeEventRecorder({
      eventBus: bus,
      sessionStore,
      allocateSeq: (threadId) => bus.allocateSeq(threadId),
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })
    const config = KunCapabilitiesConfig.parse({
      subagents: {
        enabled: options.enabled ?? true,
        maxParallel: options.maxParallel ?? 1,
        maxChildRuns: options.maxChildRuns ?? 3,
        ...(options.defaultToolPolicy ? { defaultToolPolicy: options.defaultToolPolicy } : {}),
        ...(options.defaultProfile ? { defaultProfile: options.defaultProfile } : {}),
        ...(options.profiles ? { profiles: options.profiles } : {})
      }
    }).subagents
    let idSeq = 0
    return new DelegationRuntime({
      config,
      store: new FileDelegationStore(join(dir, 'children')),
      events: recorder,
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await predicate()) return
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
