import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KunCapabilitiesConfig, type SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { EventBus } from '../ports/event-bus.js'
import {
  type ChildRunExecutor,
  type ChildRunRecord,
  DelegationRuntime,
  FileDelegationStore
} from './delegation-runtime.js'
import { deferred, waitFor } from '../../tests/support/delegation-runtime-fixtures.js'

describe('DelegationRuntime live concurrency reconfiguration', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'kun-delegation-reconfigure-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('admits existing FIFO waiters before later arrivals after raising maxParallel', async () => {
    const firstGate = deferred<void>()
    const startOrder: string[] = []
    const runtime = createRuntime({
      maxParallel: 1,
      executor: async ({ prompt }) => {
        startOrder.push(prompt)
        if (prompt === 'first') await firstGate.promise
        return { summary: prompt }
      }
    })
    const signal = new AbortController().signal
    const first = run(runtime, 'first', signal)
    await waitFor(() => startOrder.length === 1)
    const second = run(runtime, 'second', signal)
    await waitFor(async () => (await runtime.diagnostics()).childRuns.some(
      (child) => child.prompt === 'second' && child.status === 'queued'
    ))

    runtime.replaceConfig(subagentConfig(2))
    const third = run(runtime, 'third', signal)
    await waitFor(() => startOrder.length >= 2)
    expect(startOrder.slice(0, 2)).toEqual(['first', 'second'])

    firstGate.resolve()
    await Promise.all([first, second, third])
    expect(startOrder).toEqual(['first', 'second', 'third'])
  })

  it('does not admit another waiter above a lowered maxParallel', async () => {
    const gates = {
      first: deferred<void>(),
      second: deferred<void>(),
      third: deferred<void>()
    }
    const startOrder: string[] = []
    const runtime = createRuntime({
      maxParallel: 2,
      executor: async ({ prompt }) => {
        startOrder.push(prompt)
        await gates[prompt as keyof typeof gates].promise
        return { summary: prompt }
      }
    })
    const signal = new AbortController().signal
    const first = run(runtime, 'first', signal)
    const second = run(runtime, 'second', signal)
    await waitFor(() => startOrder.length === 2)
    const third = run(runtime, 'third', signal)
    await waitFor(async () => (await runtime.diagnostics()).childRuns.some(
      (child) => child.prompt === 'third' && child.status === 'queued'
    ))

    runtime.replaceConfig(subagentConfig(1))
    gates.first.resolve()
    await first
    expect(startOrder).toHaveLength(2)
    expect(startOrder).toEqual(expect.arrayContaining(['first', 'second']))
    expect((await runtime.diagnostics()).childRuns.find((child) => child.prompt === 'third'))
      .toMatchObject({ status: 'queued' })

    gates.second.resolve()
    await second
    await waitFor(() => startOrder.includes('third'))
    gates.third.resolve()
    await expect(third).resolves.toMatchObject({ status: 'completed' })
  })

  it('temporarily caps admission under memory pressure without rewriting config', async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
    const started: string[] = []
    const runtime = createRuntime({
      maxParallel: 3,
      executor: async ({ prompt }) => {
        started.push(prompt)
        await gates[Number(prompt) - 1]!.promise
        return { summary: prompt }
      }
    })
    runtime.setMemoryPressureParallelLimit(1)
    const signal = new AbortController().signal
    const runs = ['1', '2', '3'].map((prompt) => run(runtime, prompt, signal))
    await waitFor(() => started.length === 1)
    // Admission is capped at one here; concurrent callers may reach the
    // shared slot in any order before a FIFO waiter exists.
    expect(started).toHaveLength(1)
    expect(['1', '2', '3']).toContain(started[0])

    runtime.setMemoryPressureParallelLimit(undefined)
    await waitFor(() => started.length === 3)
    gates.forEach((gate) => gate.resolve())
    await Promise.all(runs)
  })

  it('keeps queued children paused while delegation is disabled', async () => {
    const firstGate = deferred<void>()
    const startOrder: string[] = []
    const runtime = createRuntime({
      maxParallel: 1,
      executor: async ({ prompt }) => {
        startOrder.push(prompt)
        if (prompt === 'first') await firstGate.promise
        return { summary: prompt }
      }
    })
    const signal = new AbortController().signal
    const first = run(runtime, 'first', signal)
    await waitFor(() => startOrder.length === 1)
    const second = run(runtime, 'second', signal)
    await waitFor(async () => (await runtime.diagnostics()).childRuns.some(
      (child) => child.prompt === 'second' && child.status === 'queued'
    ))

    runtime.replaceConfig({ ...subagentConfig(1), enabled: false })
    firstGate.resolve()
    await first
    expect(startOrder).toEqual(['first'])

    runtime.replaceConfig(subagentConfig(1))
    await expect(second).resolves.toMatchObject({ status: 'completed' })
    expect(startOrder).toEqual(['first', 'second'])
  })

  it('keeps queued Fast Context children paused while delegation is disabled', async () => {
const firstGate = deferred<void>()
const started: string[] = []
const runtime = createRuntime({
maxParallel: 1,
executor: async ({ prompt }) => {
started.push(prompt)
if (prompt === 'fast-first') await firstGate.promise
return { summary: prompt }
}
})
const signal = new AbortController().signal
const first = run(runtime, 'fast-first', signal, undefined, {
fastContext: true,
parentThreadId: 'parent_fast'
})
await waitFor(() => started.includes('fast-first'))
const second = run(runtime, 'fast-second', signal, undefined, {
fastContext: true,
parentThreadId: 'parent_fast'
})
await waitFor(async () => (await runtime.diagnostics('parent_fast')).childRuns.some(
(child) => child.prompt === 'fast-second' && child.status === 'queued'
))

runtime.replaceConfig({ ...subagentConfig(1), enabled: false })
firstGate.resolve()
await first
expect(started).toEqual(['fast-first'])

runtime.replaceConfig(subagentConfig(1))
await expect(second).resolves.toMatchObject({ status: 'completed' })
expect(started).toEqual(['fast-first', 'fast-second'])
})

it('fails a queued child at its deadline without leaking the slot or FIFO waiter', async () => {
    const firstGate = deferred<void>()
    const started: string[] = []
    const runtime = createRuntime({
      maxParallel: 1,
      executor: async ({ prompt }) => {
        started.push(prompt)
        if (prompt === 'first') await firstGate.promise
        return { summary: prompt }
      }
    })
    const signal = new AbortController().signal
    const first = run(runtime, 'first', signal)
    await waitFor(() => started.length === 1)

    const timedOutPromise = run(runtime, 'timed-out', signal, 100)
    await waitFor(async () => (await runtime.diagnostics()).childRuns.some(
      (child) => child.prompt === 'timed-out' && child.status === 'queued'
    ))
    const afterTimeout = run(runtime, 'after-timeout', signal)
    await waitFor(async () => (await runtime.diagnostics()).childRuns.some(
      (child) => child.prompt === 'after-timeout' && child.status === 'queued'
    ))

    const timedOut = await timedOutPromise
    expect(timedOut).toMatchObject({
      status: 'failed',
      terminationReason: 'child_error',
      failure: { source: 'runtime', code: 'child_queue_timeout', category: 'timeout' }
    })
    expect(timedOut.queuedMs).toBeGreaterThanOrEqual(0)
    expect(timedOut.error).toContain('could not start within 100ms')
    expect(started).toEqual(['first'])
    expect(await runtime.diagnostics()).toMatchObject({
      active: 1,
      childRuns: expect.arrayContaining([
        expect.objectContaining({ prompt: 'timed-out', status: 'failed' })
      ])
    })

    firstGate.resolve()
    await first
    await expect(afterTimeout).resolves.toMatchObject({ status: 'completed' })
    expect(started).toEqual(['first', 'after-timeout'])
    await expect(runtime.diagnostics()).resolves.toMatchObject({ active: 0 })
  })

  it('keeps user cancellation authoritative when it happens before the queue deadline', async () => {
    const firstGate = deferred<void>()
    const runtime = createRuntime({
      maxParallel: 1,
      executor: async ({ prompt }) => {
        if (prompt === 'first') await firstGate.promise
        return { summary: prompt }
      }
    })
    const first = run(runtime, 'first', new AbortController().signal)
    await waitFor(async () => (await runtime.diagnostics()).active === 1)
    const controller = new AbortController()
    const queued = run(runtime, 'cancelled', controller.signal, 1_000)
    await waitFor(async () => (await runtime.diagnostics()).childRuns.some(
      (child) => child.prompt === 'cancelled' && child.status === 'queued'
    ))

    controller.abort()
    await expect(queued).resolves.toMatchObject({ status: 'aborted' })
    expect((await runtime.diagnostics()).childRuns.find((child) => child.prompt === 'cancelled')?.failure)
      .toBeUndefined()

    firstGate.resolve()
    await first
  })

  it('clears the queue deadline after admission so it cannot fail a running child', async () => {
    const firstGate = deferred<void>()
    const secondGate = deferred<void>()
    const runtime = createRuntime({
      maxParallel: 1,
      executor: async ({ prompt }) => {
        if (prompt === 'first') await firstGate.promise
        if (prompt === 'second') await secondGate.promise
        return { summary: prompt }
      }
    })
    const signal = new AbortController().signal
    const first = run(runtime, 'first', signal)
    await waitFor(async () => (await runtime.diagnostics()).active === 1)
    const second = run(runtime, 'second', signal, 100)
    await waitFor(async () => (await runtime.diagnostics()).childRuns.some(
      (child) => child.prompt === 'second' && child.status === 'queued'
    ))

    firstGate.resolve()
    await first
    await waitFor(async () => (await runtime.diagnostics()).childRuns.some(
      (child) => child.prompt === 'second' && child.status === 'running'
    ))
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect((await runtime.diagnostics()).childRuns.find((child) => child.prompt === 'second'))
      .toMatchObject({ status: 'running' })

    secondGate.resolve()
    await expect(second).resolves.toMatchObject({ status: 'completed' })
  })

  it('isolates Fast Context child lanes by parent session and from ordinary global slots', async () => {
const gates = {
ordinary: deferred<void>(),
fastA: deferred<void>(),
fastB: deferred<void>(),
fastASecond: deferred<void>()
}
const started: string[] = []
const runtime = createRuntime({
maxParallel: 1,
executor: async ({ prompt }) => {
started.push(prompt)
await gates[prompt as keyof typeof gates].promise
return { summary: prompt }
}
})
const signal = new AbortController().signal
const ordinary = run(runtime, 'ordinary', signal)
await waitFor(() => started.includes('ordinary'))

const fastA = run(runtime, 'fastA', signal, undefined, { fastContext: true, parentThreadId: 'parent_a' })
const fastB = run(runtime, 'fastB', signal, undefined, { fastContext: true, parentThreadId: 'parent_b' })
await waitFor(() => started.includes('fastA') && started.includes('fastB'))
expect((await runtime.diagnostics()).active).toBe(3)

const fastASecond = run(runtime, 'fastASecond', signal, undefined, {
fastContext: true,
parentThreadId: 'parent_a'
})
await waitFor(async () => (await runtime.diagnostics('parent_a')).childRuns.some(
(child) => child.prompt === 'fastASecond' && child.status === 'queued'
))
expect(started).not.toContain('fastASecond')

gates.fastA.resolve()
await fastA
await waitFor(() => started.includes('fastASecond'))
gates.fastASecond.resolve()
gates.fastB.resolve()
gates.ordinary.resolve()
await Promise.all([ordinary, fastB, fastASecond])
expect(await runtime.diagnostics()).toMatchObject({ active: 0 })
})

it('times out only a competing Fast Context call in the same parent session', async () => {
const gate = deferred<void>()
const started: string[] = []
const runtime = createRuntime({
maxParallel: 1,
executor: async ({ prompt }) => {
started.push(prompt)
if (prompt === 'holder') await gate.promise
return { summary: prompt }
}
})
const signal = new AbortController().signal
const holder = run(runtime, 'holder', signal, undefined, { fastContext: true, parentThreadId: 'parent_a' })
await waitFor(() => started.includes('holder'))
const timedOut = run(runtime, 'timed-out-fast', signal, 50, {
fastContext: true,
parentThreadId: 'parent_a'
})
const otherSession = run(runtime, 'other-session', signal, 50, {
fastContext: true,
parentThreadId: 'parent_b'
})
await expect(otherSession).resolves.toMatchObject({ status: 'completed' })
await expect(timedOut).resolves.toMatchObject({
status: 'failed',
failure: { source: 'runtime', code: 'child_queue_timeout', category: 'timeout' }
})
expect(started).toEqual(['holder', 'other-session'])
gate.resolve()
await holder
})

it('releases the slot when persisting the running transition fails', async () => {
    const store = new FailFirstRunningTransitionStore(join(directory, 'children'))
    let executions = 0
    const runtime = createRuntime({
      maxParallel: 1,
      store,
      executor: async ({ prompt }) => {
        executions += 1
        return { summary: prompt }
      }
    })
    const signal = new AbortController().signal

    await expect(run(runtime, 'first', signal)).resolves.toMatchObject({
      status: 'failed',
      error: 'simulated running write failure'
    })
    await expect(run(runtime, 'second', signal)).resolves.toMatchObject({ status: 'completed' })
    await expect(runtime.diagnostics()).resolves.toMatchObject({ active: 0 })
    expect(executions).toBe(1)
  })

  it('releases the slot when activity subscription cleanup throws', async () => {
    const eventBus = new ThrowingUnsubscribeEventBus()
    const runtime = createRuntime({
      maxParallel: 1,
      eventBus,
      executor: async ({ prompt }) => ({ summary: prompt })
    })
    const signal = new AbortController().signal

    await expect(run(runtime, 'first', signal)).resolves.toMatchObject({ status: 'completed' })
    await expect(run(runtime, 'second', signal)).resolves.toMatchObject({ status: 'completed' })
    await expect(runtime.diagnostics()).resolves.toMatchObject({ active: 0 })
    expect(eventBus.unsubscribeCalls).toBe(2)
  })

  function createRuntime(options: {
    maxParallel: number
    store?: FileDelegationStore
    eventBus?: EventBus
    executor: ChildRunExecutor
  }): DelegationRuntime {
    let sequence = 0
    return new DelegationRuntime({
      config: subagentConfig(options.maxParallel),
      store: options.store ?? new FileDelegationStore(join(directory, 'children')),
      idGenerator: () => `child_${++sequence}`,
      eventBus: options.eventBus,
      executor: options.executor
    })
  }
})

function subagentConfig(maxParallel: number): SubagentsCapabilityConfig {
  return KunCapabilitiesConfig.parse({
    subagents: {
      enabled: true,
      useExistingAgents: true,
      maxParallel,
      profiles: { general: { toolPolicy: 'inherit' } }
    }
  }).subagents
}

function run(
  runtime: DelegationRuntime,
  prompt: string,
  signal: AbortSignal,
  queueTimeoutMs?: number,
  options: { fastContext?: boolean; parentThreadId?: string } = {}
): Promise<ChildRunRecord> {
  return runtime.runChild({
    parentThreadId: options.parentThreadId ?? 'parent',
    parentTurnId: `turn_${prompt}`,
    prompt,
    ...(options.fastContext ? { fastContext: true } : {}),
    ...(queueTimeoutMs !== undefined ? { queueTimeoutMs } : {}),
    signal
  })
}

class FailFirstRunningTransitionStore extends FileDelegationStore {
  private failed = false

  override async upsert(record: ChildRunRecord): Promise<void> {
    if (!this.failed && record.status === 'running') {
      this.failed = true
      throw new Error('simulated running write failure')
    }
    await super.upsert(record)
  }
}

class ThrowingUnsubscribeEventBus implements EventBus {
  unsubscribeCalls = 0

  publish(_event: RuntimeEvent): void {}

  subscribe(_threadId: string, _handler: (event: RuntimeEvent) => void): () => void {
    return () => {
      this.unsubscribeCalls += 1
      throw new Error('simulated unsubscribe failure')
    }
  }

  snapshotSince(_threadId: string, _sinceSeq: number): RuntimeEvent[] {
    return []
  }

  highestSeq(_threadId: string): number {
    return 0
  }

  reset(): void {}
}
