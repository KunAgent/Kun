import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost, echoTool, type LocalTool } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import { emptyUsageSnapshot } from '../contracts/usage.js'
import { createThreadRecord } from '../domain/thread.js'
import type { ApprovalRequest } from '../domain/approval.js'
import { InflightTracker } from './inflight-tracker.js'
import { SteeringQueue } from './steering-queue.js'
import { ContextCompactor } from './context-compactor.js'
import {
  AgentLoop,
  buildRuntimeContextInstruction,
  isStalePlanContext,
  resolvePlanModeToolSpecs,
  shouldInjectInitialRuntimeContext,
  svgArtifactCompletionState,
  turnHasUnverifiedSourceChanges
} from './agent-loop.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import type { ModelClient, ModelRequest, ModelStreamChunk, ModelToolSpec } from '../ports/model-client.js'
import type { UserInputGate, UserInputRequest, UserInputResolution } from '../ports/user-input-gate.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'

class AllowApprovalGate {
  request(_approval: ApprovalRequest): Promise<'allow' | 'deny'> {
    return Promise.resolve('allow')
  }

  decide(): boolean {
    return false
  }

  reserveDecision(): boolean {
    return false
  }

  commitDecision(): boolean {
    return false
  }

  rollbackDecision(): boolean {
    return false
  }

  expire(): boolean {
    return false
  }

  pending(): ApprovalRequest[] {
    return []
  }

  get(): ApprovalRequest | undefined {
    return undefined
  }
}

class NoopUserInputGate implements UserInputGate {
  request(_input: UserInputRequest): Promise<UserInputResolution> {
    return Promise.resolve({ status: 'cancelled' })
  }

  get(): UserInputRequest | undefined {
    return undefined
  }

  claimResolution() {
    return undefined
  }

  resolve(): boolean {
    return false
  }

  pending(): UserInputRequest[] {
    return []
  }

  reset(): void {}
}

class AbortAwareModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'abort-aware-model'
  readonly requests: ModelRequest[] = []
  abortObserved = false
  private readonly streamStartedListeners: Array<() => void> = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    for (const listener of this.streamStartedListeners.splice(0)) listener()
    if (!request.abortSignal.aborted) {
      await new Promise<void>((resolve) => {
        request.abortSignal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
    this.abortObserved = request.abortSignal.aborted
    for (const chunk of [] as ModelStreamChunk[]) yield chunk
  }

  waitForStreamStart(): Promise<void> {
    if (this.requests.length > 0) return Promise.resolve()
    return new Promise((resolve) => this.streamStartedListeners.push(resolve))
  }
}

class RepeatingToolModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'repeating-tool-model'
  private calls = 0

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.calls += 1
    yield {
      kind: 'tool_call_complete',
      callId: `call_${this.calls}`,
      toolName: 'echo',
      arguments: { text: 'again' }
    }
    yield { kind: 'completed', stopReason: 'tool_calls' }
  }
}

class CapturingCompleteModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'capturing-complete-model'
  readonly requests: ModelRequest[] = []

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    yield { kind: 'assistant_text_delta', text: 'Done.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

class FinalResponseGateModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'final-response-gate-model'
  readonly requests: ModelRequest[] = []
  private releaseFirstResponse: (() => void) | undefined
  private markFirstStarted: (() => void) | undefined
  private readonly firstResponseStarted = new Promise<void>((resolve) => {
    this.markFirstStarted = resolve
  })
  private readonly firstResponseReleased = new Promise<void>((resolve) => {
    this.releaseFirstResponse = resolve
  })

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    if (this.requests.length === 1) {
      this.markFirstStarted?.()
      await this.firstResponseReleased
    }
    yield { kind: 'assistant_text_delta', text: `response ${this.requests.length}` }
    yield { kind: 'completed', stopReason: 'stop' }
  }

  waitForFirstResponse(): Promise<void> {
    return this.firstResponseStarted
  }

  release(): void {
    this.releaseFirstResponse?.()
  }
}

class RoutedFailureModel implements ModelClient {
  readonly provider = 'compat-multi'
  readonly model = 'gpt-5.3-codex-spark'
  readonly config = {
    model: this.model,
    baseUrl: 'https://chatgpt.example/codex',
    endpointFormat: 'custom_endpoint'
  }
  request?: ModelRequest

  configFor(providerId?: string) {
    if (providerId !== 'deepseek') throw new Error(`unknown model provider: ${providerId}`)
    return {
      model: 'deepseek-v4-pro',
      baseUrl: 'https://api.deepseek.com',
      endpointFormat: 'chat_completions'
    }
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.request = request
    yield* [] as ModelStreamChunk[]
    throw new Error('upstream transport failed')
  }
}

type SvgModelAction = 'stop' | 'edit' | 'validate'

class ScriptedSvgModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'scripted-svg-model'
  readonly requests: ModelRequest[] = []
  private index = 0

  constructor(private readonly actions: readonly SvgModelAction[]) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    this.requests.push(request)
    const action = this.actions[this.index] ?? 'stop'
    this.index += 1
    if (action !== 'stop') {
      yield {
        kind: 'tool_call_complete',
        callId: `${action}_${this.index}`,
        toolName: action === 'edit' ? 'design_svg_edit' : 'design_svg_validate',
        arguments: { attempt: this.index }
      }
      yield { kind: 'completed', stopReason: 'tool_calls' }
      return
    }
    yield { kind: 'assistant_text_delta', text: 'Done.' }
    yield { kind: 'completed', stopReason: 'stop' }
  }
}

function svgGateTool(
  name: 'design_svg_edit' | 'design_svg_validate' | 'write',
  result: { output: unknown; isError?: boolean }
): LocalTool {
  return LocalToolHost.defineTool({
    name,
    description: name,
    inputSchema: { type: 'object', additionalProperties: true },
    toolKind: name === 'design_svg_validate' ? 'tool_call' : 'file_change',
    policy: 'auto',
    shouldAdvertise: (context) => context.guiDesignArtifact?.kind === 'svg',
    execute: async () => result
  })
}

async function svgLoopHarness(input: {
  model: ModelClient
  tools: LocalTool[]
  skillRuntime?: ConstructorParameters<typeof AgentLoop>[0]['skillRuntime']
}) {
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const eventBus = new InMemoryEventBus()
  const inflight = new InflightTracker()
  const steering = new SteeringQueue()
  const ids = new SequentialIdGenerator()
  const nowIso = () => '2026-07-10T00:00:00.000Z'
  const events = new RuntimeEventRecorder({
    eventBus, sessionStore, allocateSeq: (id) => eventBus.allocateSeq(id), nowIso
  })
  const turns = new TurnService({
    threadStore, sessionStore, events, inflight, steering, compactor: new ContextCompactor(), ids, nowIso
  })
  const loop = new AgentLoop({
    threadStore,
    sessionStore,
    approvalGate: new AllowApprovalGate(),
    userInputGate: new NoopUserInputGate(),
    model: input.model,
    toolHost: new LocalToolHost({ tools: input.tools }),
    usage: new UsageService(),
    events,
    turns,
    inflight,
    steering,
    compactor: new ContextCompactor(),
    prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
    ids,
    nowIso,
    ...(input.skillRuntime ? { skillRuntime: input.skillRuntime } : {})
  })
  const threadId = 'thr_svg_gate'
  await threadStore.upsert(createThreadRecord({
    id: threadId,
    title: 'SVG gate',
    workspace: '/tmp/workspace',
    model: input.model.model,
    mode: 'plan'
  }))
  const started = await turns.startTurn({
    threadId,
    request: {
      prompt: 'make the reserved svg',
      model: input.model.model,
      guiDesignCanvas: true,
      guiDesignMode: true,
      guiDesignArtifact: {
        kind: 'svg', artifactId: 'motion', relativePath: '.kun-design/doc/motion/v1.svg'
      }
    }
  })
  return { loop, sessionStore, threadId, turnId: started.turnId }
}

describe('AgentLoop interruption', () => {
  it('continues after a final streamed response when steering was accepted mid-step', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-16T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new FinalResponseGateModel()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new AllowApprovalGate(),
      userInputGate: new NoopUserInputGate(),
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso
    })
    const threadId = 'thr_mid_turn_guidance'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Mid-turn guidance',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: { prompt: 'start with the original request', model: model.model }
    })

    const run = loop.runTurn(threadId, started.turnId)
    await model.waitForFirstResponse()
    await turns.steerTurn({
      threadId,
      turnId: started.turnId,
      text: 'use the compact logo instead',
      displayText: 'Use the compact logo instead'
    })
    model.release()

    await expect(run).resolves.toBe('completed')
    expect(model.requests).toHaveLength(2)
    expect(model.requests[1]?.history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'user_message',
        text: 'use the compact logo instead',
        displayText: 'Use the compact logo instead'
      })
    ]))
    // Turn finalization clears transient queue state, including its seal.
    expect(steering.isSealed(started.turnId)).toBe(false)
  })

  it('injects the Design intent policy as a system mode instruction on canvas turns', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-10T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new CapturingCompleteModel()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new AllowApprovalGate(),
      userInputGate: new NoopUserInputGate(),
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso
    })
    const threadId = 'thr_design_mode'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Design mode test',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: '做一套完整 CRM',
        model: model.model,
        guiDesignCanvas: true,
        guiDesignMode: true
      }
    })

    await expect(loop.runTurn(threadId, started.turnId)).resolves.toBe('completed')

    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]?.modeInstruction).toContain('SINGLE SCREEN')
    expect(model.requests[0]?.modeInstruction).toContain('COMPLETE MULTI-SCREEN EXPERIENCE')
    expect(model.requests[0]?.modeInstruction).toContain('MODIFY EXISTING DESIGN')
  })

  it('recovers a dedicated SVG turn until mutation and matching validation succeed', async () => {
    const model = new ScriptedSvgModel(['stop', 'edit', 'stop', 'validate', 'stop'])
    const harness = await svgLoopHarness({
      model,
      tools: [
        svgGateTool('design_svg_edit', { output: { ok: true, revision: 'rev_1' } }),
        svgGateTool('design_svg_validate', { output: { ok: true, revision: 'rev_1' } }),
        svgGateTool('write', { output: { ok: true } })
      ],
      skillRuntime: {
        resolveTurn: async () => ({
          activeSkillIds: ['unrelated-restricted-skill'],
          activations: [],
          instructions: [],
          injectedBytes: 0,
          allowedToolNames: ['read']
        })
      } as never
    })

    await expect(harness.loop.runTurn(harness.threadId, harness.turnId)).resolves.toBe('completed')
    expect(model.requests).toHaveLength(5)
    expect(model.requests[0].modeInstruction).toContain('dedicated Kun SVG artifact turn')
    expect(model.requests[0].modeInstruction).not.toContain('PLAN MODE')
    expect(model.requests[0].tools.map((tool) => tool.name)).toEqual([
      'design_svg_edit', 'design_svg_validate'
    ])
    expect(model.requests[2].requiredToolName).toBe('design_svg_validate')
    const items = await harness.sessionStore.loadItems(harness.threadId)
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'error', code: 'required_svg_mutation_missing' }),
      expect.objectContaining({ kind: 'error', code: 'required_svg_validation_missing' })
    ]))
  })

  it('fails after three structured SVG calls make no completion progress', async () => {
    const model = new ScriptedSvgModel(['edit', 'edit', 'edit', 'stop'])
    const harness = await svgLoopHarness({
      model,
      tools: [
        svgGateTool('design_svg_edit', { output: { ok: false, error: 'bad edit' }, isError: true }),
        svgGateTool('design_svg_validate', { output: { ok: true, revision: 'unused' } })
      ]
    })

    await expect(harness.loop.runTurn(harness.threadId, harness.turnId)).resolves.toBe('failed')
    expect(model.requests).toHaveLength(3)
    const items = await harness.sessionStore.loadItems(harness.threadId)
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'error', code: 'svg_completion_gate_exhausted' })
    ]))
  })

  it('aborts an in-flight model stream when the turn service interrupts the turn', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-08T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const model = new AbortAwareModel()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new AllowApprovalGate(),
      userInputGate: new NoopUserInputGate(),
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso
    })
    const threadId = 'thr_interrupt'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Interrupt test',
      workspace: '/tmp/workspace',
      model: model.model
    }))
    const started = await turns.startTurn({
      threadId,
      request: { prompt: 'keep streaming until interrupted', model: model.model }
    })

    const run = loop.runTurn(threadId, started.turnId)
    await model.waitForStreamStart()
    const interrupted = await turns.interruptTurn({ threadId, turnId: started.turnId })
    const status = await Promise.race([
      run,
      new Promise<'timed_out'>((resolve) => setTimeout(() => resolve('timed_out'), 500))
    ])

    expect(interrupted.status).toBe('aborted')
    expect(status).toBe('aborted')
    expect(model.abortObserved).toBe(true)
    expect(steering.isSealed(started.turnId)).toBe(false)
    expect((await threadStore.get(threadId))?.status).toBe('idle')
    expect((await threadStore.get(threadId))?.turns[0]?.status).toBe('aborted')
  })

  it('fails a tool loop that exceeds the configured hard step limit', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-08T00:00:00.000Z'
    const events = new RuntimeEventRecorder({ eventBus, sessionStore, allocateSeq: (id) => eventBus.allocateSeq(id), nowIso })
    const model = new RepeatingToolModel()
    const turns = new TurnService({
      threadStore, sessionStore, events, inflight, steering, compactor: new ContextCompactor(), ids, nowIso
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new AllowApprovalGate(),
      userInputGate: new NoopUserInputGate(),
      model,
      toolHost: new LocalToolHost({ tools: [echoTool] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso,
      turnLimits: { maxSteps: 2, maxWallTimeMs: 60_000 }
    })
    const threadId = 'thr_step_limit'
    await threadStore.upsert(createThreadRecord({ id: threadId, title: 'Step limit', workspace: '/tmp', model: model.model }))
    const started = await turns.startTurn({ threadId, request: { prompt: 'loop', model: model.model } })

    await expect(loop.runTurn(threadId, started.turnId)).resolves.toBe('failed')
    const eventsAfter = await sessionStore.loadEventsSince(threadId, 0)
    expect(eventsAfter).toContainEqual(expect.objectContaining({ kind: 'error', code: 'turn_step_limit' }))
  })

  it('reports the effective routed model and provider instead of the runtime default', async () => {
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const eventBus = new InMemoryEventBus()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const ids = new SequentialIdGenerator()
    const nowIso = () => '2026-07-11T00:00:00.000Z'
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (id) => eventBus.allocateSeq(id),
      nowIso
    })
    const model = new RoutedFailureModel()
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      ids,
      nowIso
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new AllowApprovalGate(),
      userInputGate: new NoopUserInputGate(),
      model,
      toolHost: new LocalToolHost({ tools: [] }),
      usage: new UsageService(),
      events,
      turns,
      inflight,
      steering,
      compactor: new ContextCompactor(),
      prefix: createImmutablePrefix({ systemPrompt: 'test system prompt' }),
      ids,
      nowIso
    })
    const threadId = 'child_routed_failure'
    await threadStore.upsert(createThreadRecord({
      id: threadId,
      title: 'Routed child',
      workspace: '/tmp',
      model: 'deepseek-v4-pro',
      providerId: 'deepseek',
      accountId: 'account_extension'
    }))
    const started = await turns.startTurn({
      threadId,
      request: {
        prompt: 'fail accurately',
        model: 'deepseek-v4-pro',
        providerId: 'deepseek',
        accountId: 'account_extension'
      }
    })

    await expect(loop.runTurn(threadId, started.turnId)).resolves.toBe('failed')
    const failed = (await threadStore.get(threadId))?.turns[0]
    expect(failed?.error).toContain('model=deepseek-v4-pro')
    expect(failed?.error).toContain('providerId=deepseek')
    expect(failed?.error).toContain('baseUrl=https://api.deepseek.com')
    expect(failed?.error).toContain('endpointFormat=chat_completions')
    expect(failed?.error).not.toContain('model=gpt-5.3-codex-spark')
    expect(model.request).toMatchObject({
      providerId: 'deepseek',
      accountId: 'account_extension'
    })
  })
})

function spec(name: string): ModelToolSpec {
  return {
    name,
    description: `Tool: ${name}`,
    toolKind: name === 'create_plan' || name === 'write' || name === 'edit'
      ? 'file_change'
      : 'tool_call',
    inputSchema: { type: 'object', properties: {} }
  }
}

function result(input: {
  id: string
  toolName: string
  toolKind: 'file_change' | 'command_execution'
  path?: string
  turnId?: string
  isError?: boolean
}) {
  return {
    id: input.id,
    threadId: 'thread_1',
    turnId: input.turnId ?? 'turn_1',
    role: 'tool' as const,
    kind: 'tool_result' as const,
    toolName: input.toolName,
    callId: `call_${input.id}`,
    toolKind: input.toolKind,
    output: input.path ? { relative_path: input.path } : {},
    isError: input.isError ?? false,
    status: 'completed' as const,
    createdAt: '2000-01-02T03:04:05.000Z'
  }
}

function svgResult(
  id: string,
  toolName: 'design_svg_edit' | 'design_svg_animate' | 'design_svg_validate',
  revision: string,
  options: { isError?: boolean; ok?: boolean; turnId?: string } = {}
) {
  return {
    id,
    threadId: 'thread_1',
    turnId: options.turnId ?? 'turn_1',
    role: 'tool' as const,
    kind: 'tool_result' as const,
    toolName,
    callId: `call_${id}`,
    toolKind: toolName === 'design_svg_validate' ? 'tool_call' as const : 'file_change' as const,
    output: { ok: options.ok ?? true, revision },
    isError: options.isError ?? false,
    status: 'completed' as const,
    createdAt: '2000-01-02T03:04:05.000Z'
  }
}

describe('svgArtifactCompletionState', () => {
  it('requires a successful mutation followed by matching-revision validation', () => {
    expect(svgArtifactCompletionState([
      svgResult('edit', 'design_svg_edit', 'r1'),
      svgResult('validate', 'design_svg_validate', 'r1')
    ], 'turn_1')).toMatchObject({
      mutationSucceeded: true,
      validationAfterMutation: true,
      mutationRevision: 'r1',
      validationRevision: 'r1'
    })
  })

  it('rejects validation before mutation, stale revisions, failed results, and other turns', () => {
    expect(svgArtifactCompletionState([
      svgResult('before', 'design_svg_validate', 'r0'),
      svgResult('failed', 'design_svg_edit', 'r1', { isError: true }),
      svgResult('other', 'design_svg_edit', 'r2', { turnId: 'turn_2' }),
      svgResult('edit', 'design_svg_animate', 'r2'),
      svgResult('stale', 'design_svg_validate', 'r1')
    ], 'turn_1')).toMatchObject({
      mutationSucceeded: true,
      validationAfterMutation: false,
      mutationRevision: 'r2',
      validationRevision: 'r1'
    })
  })
})

describe('turnHasUnverifiedSourceChanges', () => {
  it('flags an unverified source edit so the optional nudge can appear', () => {
    expect(turnHasUnverifiedSourceChanges([
      result({ id: 'write', toolName: 'write', toolKind: 'file_change', path: 'src/app.ts' })
    ], 'turn_1')).toBe(true)
  })

  it('ignores non-source changes (docs/HTML written in write/design/SDD modes)', () => {
    expect(turnHasUnverifiedSourceChanges([
      result({ id: 'doc', toolName: 'write', toolKind: 'file_change', path: 'notes.md' }),
      result({ id: 'page', toolName: 'write', toolKind: 'file_change', path: '.kun-design/a/v1.html' })
    ], 'turn_1')).toBe(false)
  })

  it('ignores failed edits and create_plan artifacts', () => {
    expect(turnHasUnverifiedSourceChanges([
      result({ id: 'failed', toolName: 'edit', toolKind: 'file_change', path: 'src/a.ts', isError: true }),
      result({ id: 'plan', toolName: 'create_plan', toolKind: 'file_change', path: 'plan.md' })
    ], 'turn_1')).toBe(false)
  })

  it('clears after a verify_changes run and re-arms on the next source edit', () => {
    expect(turnHasUnverifiedSourceChanges([
      result({ id: 'write', toolName: 'write', toolKind: 'file_change', path: 'src/a.ts' }),
      result({ id: 'verify', toolName: 'verify_changes', toolKind: 'command_execution' })
    ], 'turn_1')).toBe(false)

    expect(turnHasUnverifiedSourceChanges([
      result({ id: 'write', toolName: 'write', toolKind: 'file_change', path: 'src/a.ts' }),
      result({ id: 'verify', toolName: 'verify_changes', toolKind: 'command_execution' }),
      result({ id: 'repair', toolName: 'edit', toolKind: 'file_change', path: 'src/a.ts' })
    ], 'turn_1')).toBe(true)
  })

  it('ignores changes from other turns', () => {
    expect(turnHasUnverifiedSourceChanges([
      result({ id: 'other', toolName: 'write', toolKind: 'file_change', path: 'src/a.ts', turnId: 'turn_2' })
    ], 'turn_1')).toBe(false)
  })
})

const ALL_TOOLS: ModelToolSpec[] = [
  spec('read'),
  spec('write'),
  spec('edit'),
  spec('ls'),
  spec('find'),
  spec('grep'),
  spec('bash'),
  spec('web_search'),
  spec('web_fetch'),
  spec('create_plan')
]

const READ_ONLY_TOOLS = new Set([
  'read', 'ls', 'find', 'grep', 'web_search', 'web_fetch'
])

describe('isStalePlanContext', () => {
  it('treats a workspace-mismatched plan context as stale (the fork bug)', () => {
    // A fork keeps the source thread's workspace; a plan context pointing at a
    // different workspace must be ignored, not passed to create_plan.
    expect(isStalePlanContext({ workspaceRoot: '/work/a' }, '/work/b')).toBe(true)
  })

  it('keeps a matching plan context (normalizing trailing slash / case)', () => {
    expect(isStalePlanContext({ workspaceRoot: '/work/a' }, '/work/a')).toBe(false)
    expect(isStalePlanContext({ workspaceRoot: '/work/a/' }, '/work/a')).toBe(false)
    expect(isStalePlanContext({ workspaceRoot: '/Work/A' }, '/work/a')).toBe(false)
  })

  it('is not stale when there is no plan context', () => {
    expect(isStalePlanContext(undefined, '/work/a')).toBe(false)
  })
})

describe('resolvePlanModeToolSpecs', () => {
  it('step 0: read-only tools + create_plan only', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 0,
      readOnlyToolNames: READ_ONLY_TOOLS
    })
    const names = result.map((t) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('ls')
    expect(names).toContain('find')
    expect(names).toContain('grep')
    expect(names).toContain('web_search')
    expect(names).toContain('web_fetch')
    expect(names).toContain('create_plan')
    expect(names).not.toContain('write')
    expect(names).not.toContain('edit')
    expect(names).not.toContain('bash')
  })

  it('step > 0: only create_plan', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 1,
      readOnlyToolNames: READ_ONLY_TOOLS
    })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('create_plan')
  })

  it('plan satisfied: returns all tools unchanged (pass-through)', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: true,
      stepIndex: 0,
      readOnlyToolNames: READ_ONLY_TOOLS
    })
    expect(result).toBe(ALL_TOOLS)
  })

  it('not plan-active: returns all tools unchanged (pass-through)', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: false,
      createPlanSatisfied: false,
      stepIndex: 0,
      readOnlyToolNames: READ_ONLY_TOOLS
    })
    expect(result).toBe(ALL_TOOLS)
  })

  it('uses PLAN_READ_ONLY_TOOL_NAMES default when readOnlyToolNames omitted', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 0
    })
    const names = result.map((t) => t.name)
    // Default set excludes bash
    expect(names).not.toContain('bash')
    expect(names).toContain('create_plan')
    expect(names).toContain('read')
  })

  it('uses CREATE_PLAN_TOOL_NAME default when planToolName omitted', () => {
    const result = resolvePlanModeToolSpecs(ALL_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 1
    })
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('create_plan')
  })

  it('custom readOnlyToolNames and planToolName', () => {
    const customTools: ModelToolSpec[] = [
      spec('custom-read'),
      spec('custom-plan'),
      spec('write'),
      spec('bash')
    ]
    const result = resolvePlanModeToolSpecs(customTools, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 0,
      readOnlyToolNames: new Set(['custom-read']),
      planToolName: 'custom-plan'
    })
    const names = result.map((t) => t.name)
    expect(names).toContain('custom-read')
    expect(names).toContain('custom-plan')
    expect(names).not.toContain('write')
    expect(names).not.toContain('bash')
  })

  const WITH_INPUT_TOOLS: ModelToolSpec[] = [
    spec('read'),
    spec('write'),
    spec('create_plan'),
    spec('user_input'),
    spec('request_user_input')
  ]

  it('step 0: allows the structured user-input tools (so plan turns can ask)', () => {
    const result = resolvePlanModeToolSpecs(WITH_INPUT_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 0,
      readOnlyToolNames: READ_ONLY_TOOLS
    })
    const names = result.map((t) => t.name)
    expect(names).toContain('user_input')
    expect(names).toContain('request_user_input')
    expect(names).toContain('create_plan')
    expect(names).not.toContain('write')
  })

  it('step > 0: drops the user-input tools, leaving only create_plan', () => {
    const result = resolvePlanModeToolSpecs(WITH_INPUT_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 1,
      readOnlyToolNames: READ_ONLY_TOOLS
    })
    expect(result.map((t) => t.name)).toEqual(['create_plan'])
  })

  it('custom interactiveToolNames overrides the default user-input set', () => {
    const result = resolvePlanModeToolSpecs(WITH_INPUT_TOOLS, {
      planTurnActive: true,
      createPlanSatisfied: false,
      stepIndex: 0,
      readOnlyToolNames: READ_ONLY_TOOLS,
      interactiveToolNames: new Set(['user_input'])
    })
    const names = result.map((t) => t.name)
    expect(names).toContain('user_input')
    expect(names).not.toContain('request_user_input')
  })
})

describe('buildRuntimeContextInstruction', () => {
  it('includes the opened project absolute path and formatted local time context', () => {
    const instruction = buildRuntimeContextInstruction({
      workspace: '/tmp/kun-test-project',
      nowIso: '2000-01-02T03:04:05.000Z',
      timeZone: 'UTC'
    })

    expect(instruction).toContain('Current opened project absolute path: `/tmp/kun-test-project`')
    expect(instruction).toContain('Current user local time: 2000-01-02 03:04:05 Sunday (UTC')
    expect(instruction).toContain('GMT')
    expect(instruction).toContain('Treat this block as environment context')
  })

  it('normalizes relative workspace paths to absolute paths', () => {
    const instruction = buildRuntimeContextInstruction({
      workspace: 'relative-project',
      nowIso: '2026-06-21T04:30:15.000Z',
      timeZone: 'UTC'
    })

    expect(instruction).toContain(`Current opened project absolute path: \`${resolve('relative-project')}\``)
  })
})

describe('shouldInjectInitialRuntimeContext', () => {
  it('injects only for the first model step of the first thread turn', () => {
    expect(shouldInjectInitialRuntimeContext({
      stepIndex: 0,
      turnId: 'turn_1',
      historyItems: [
        {
          id: 'item_turn_1_user',
          threadId: 'thread_1',
          turnId: 'turn_1',
          role: 'user',
          kind: 'user_message',
          text: 'hello',
          status: 'completed',
          createdAt: '2000-01-02T03:04:05.000Z'
        }
      ]
    })).toBe(true)
  })

  it('does not inject for tool continuations or later turns', () => {
    const currentTurnItem = {
      id: 'item_turn_2_user',
      threadId: 'thread_1',
      turnId: 'turn_2',
      role: 'user' as const,
      kind: 'user_message' as const,
      text: 'next',
      status: 'completed' as const,
      createdAt: '2000-01-02T03:04:05.000Z'
    }
    expect(shouldInjectInitialRuntimeContext({
      stepIndex: 1,
      turnId: 'turn_2',
      historyItems: [currentTurnItem]
    })).toBe(false)
    expect(shouldInjectInitialRuntimeContext({
      stepIndex: 0,
      turnId: 'turn_2',
      historyItems: [
        {
          ...currentTurnItem,
          id: 'item_turn_1_user',
          turnId: 'turn_1',
          text: 'previous'
        },
        currentTurnItem
      ]
    })).toBe(false)
  })
})
