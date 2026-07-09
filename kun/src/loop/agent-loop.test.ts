import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
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
  }

  waitForStreamStart(): Promise<void> {
    if (this.requests.length > 0) return Promise.resolve()
    return new Promise((resolve) => this.streamStartedListeners.push(resolve))
  }
}

describe('AgentLoop interruption', () => {
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
    expect((await threadStore.get(threadId))?.status).toBe('idle')
    expect((await threadStore.get(threadId))?.turns[0]?.status).toBe('aborted')
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
