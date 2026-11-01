import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { SubagentsCapabilityConfig } from '../contracts/capabilities.js'
import { DelegationRuntime, FileDelegationStore, type ChildRunExecutor } from './delegation-runtime.js'

function makeRuntime(dir: string, executor: ChildRunExecutor): DelegationRuntime {
  const nowIso = () => '2026-07-08T00:00:00.000Z'
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
  return new DelegationRuntime({
    config: SubagentsCapabilityConfig.parse({
      enabled: true,
      maxParallel: 1,
      profiles: { general: { mode: 'subagent', toolPolicy: 'inherit' } }
    }),
    store: new FileDelegationStore(dir),
    events,
    threadStore,
    turns,
    nowIso,
    executor
  })
}

describe('delegation serviceTier propagation', () => {
  let dir: string
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('inherits the parent service tier for default-inherit tools and records it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'delegation-tier-'))
    let executorInput: Record<string, unknown> | undefined
    const runtime = makeRuntime(dir, async (input) => {
      executorInput = { ...input, signal: undefined }
      return { summary: 'ok' }
    })
    const record = await runtime.runChild({
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'explore the repo',
      profile: 'general',
      inheritedModel: 'gpt-5.4',
      inheritedProviderId: 'codex-2',
      inheritedServiceTier: 'priority',
      inheritSessionDefaults: true,
      signal: new AbortController().signal
    })
    expect(record.serviceTier).toBe('priority')
    expect(executorInput?.serviceTier).toBe('priority')
  })

  it('lets an explicit tool override win over the inherited parent tier', async () => {
    dir = await mkdtemp(join(tmpdir(), 'delegation-tier-'))
    let executorInput: Record<string, unknown> | undefined
    const runtime = makeRuntime(dir, async (input) => {
      executorInput = { ...input, signal: undefined }
      return { summary: 'ok' }
    })
    const record = await runtime.runChild({
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'explore',
      profile: 'general',
      serviceTier: 'priority',
      inheritedServiceTier: undefined,
      inheritSessionDefaults: true,
      signal: new AbortController().signal
    })
    expect(record.serviceTier).toBe('priority')
    expect(executorInput?.serviceTier).toBe('priority')
  })

  it('never records a tier for delegate_task-style children even when the parent turn is fast', async () => {
    dir = await mkdtemp(join(tmpdir(), 'delegation-tier-'))
    let executorInput: Record<string, unknown> | undefined
    const runtime = makeRuntime(dir, async (input) => {
      executorInput = { ...input, signal: undefined }
      return { summary: 'ok' }
    })
    const record = await runtime.runChild({
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'review',
      profile: 'general',
      inheritedModel: 'gpt-5.4',
      inheritedProviderId: 'codex-2',
      inheritedServiceTier: 'priority',
      signal: new AbortController().signal
    })
    expect(record.serviceTier).toBeUndefined()
    expect(executorInput?.serviceTier).toBeUndefined()
  })

  it.each(['off', 'max', 'auto', 'xhigh'] as const)('keeps an explicit worker %s choice through the child request and resume', async (reasoningEffort) => {
    dir = await mkdtemp(join(tmpdir(), 'delegation-reasoning-'))
    const inputs: Array<Record<string, unknown>> = []
    const runtime = makeRuntime(dir, async (input) => { inputs.push({ ...input }); return { summary: 'ok' } })
    const record = await runtime.runChild({ parentThreadId: 'thr_parent', parentTurnId: 'turn_parent', launcher: 'manager-worker',
      prompt: 'implement', profile: 'general', reasoningEffort, inheritedReasoningEffort: 'high', inheritSessionDefaults: true,
      workspace: dir, security: { sandboxRoot: dir, memoryEnabled: false },
      signal: new AbortController().signal })
    expect(record.reasoningEffort).toBe(reasoningEffort)
    expect(inputs[0].reasoningEffort).toBe(reasoningEffort)
    const resumed = await runtime.resumeChild({ childId: record.id, parentThreadId: 'thr_parent', parentTurnId: 'turn_followup',
      prompt: 'continue', expectedResumeCount: 0, expectedLaunchers: ['manager-worker'], signal: new AbortController().signal })
    expect(resumed.reasoningEffort).toBe(reasoningEffort)
    expect(inputs[1].reasoningEffort).toBe(reasoningEffort)
  })

  it('inherits the parent reasoning effort for default-inherit tools without a profile override', async () => {
    dir = await mkdtemp(join(tmpdir(), 'delegation-tier-'))
    let executorInput: Record<string, unknown> | undefined
    const runtime = makeRuntime(dir, async (input) => {
      executorInput = { ...input, signal: undefined }
      return { summary: 'ok' }
    })
    const record = await runtime.runChild({
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'explore',
      profile: 'general',
      inheritedReasoningEffort: 'high',
      inheritSessionDefaults: true,
      signal: new AbortController().signal
    })
    expect(record.reasoningEffort).toBe('high')
    expect(executorInput?.reasoningEffort).toBe('high')
  })
})
