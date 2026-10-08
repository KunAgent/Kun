import { describe, expect, test, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentOptions,
  Run,
  RunResult,
  SDKAgent,
  SDKMessage
} from '@cursor/sdk'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { TurnItem } from '../../contracts/items.js'
import {
  applyRuntimeEvent,
  createRuntimeEventProjection
} from '../../domain/runtime-event-reducer.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import {
  CursorSdkRuntime,
  cursorSdkCapabilities,
  cursorAgentExecutionOptions,
  sanitizeCursorSdkError,
  type CursorSdkApi,
  type CursorKunTurnContext,
  type CursorSdkRuntimeDeps
} from './cursor-sdk-runtime.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  delegatedCapabilityFingerprint,
  delegatedCredentialIdentity,
  delegatedHistoryDigest
} from '../delegated-session-binding.js'
import { goalContextKey } from '../../loop/continuation-instructions.js'
import { setHarnessTimingClock } from '../harness-turn-timing.js'

function messages(values: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  return (async function* () {
    for (const value of values) yield value
  })()
}

function fakeRun(input: {
  stream?: SDKMessage[]
  result?: Partial<RunResult>
  cancel?: () => Promise<void>
} = {}): Run {
  const result: RunResult = {
    id: 'run_1',
    status: 'finished',
    result: 'hello',
    ...input.result
  }
  return {
    id: 'run_1',
    agentId: 'agent_1',
    supports: (operation) => operation === 'stream' || operation === 'wait' || operation === 'cancel',
    unsupportedReason: () => undefined,
    stream: () => messages(input.stream ?? [{
      type: 'assistant',
      agent_id: 'agent_1',
      run_id: 'run_1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
    }]),
    conversation: async () => [],
    wait: async () => result,
    cancel: input.cancel ?? (async () => undefined),
    status: result.status,
    onDidChangeStatus: () => () => undefined,
    result: result.result,
    error: result.error,
    model: result.model,
    durationMs: result.durationMs,
    usage: result.usage,
    git: result.git,
    createdAt: 1
  }
}

function harness(input: {
  apiKey?: string
  credentialSourceId?: string
  resolveCredentialSource?: CursorSdkRuntimeDeps['resolveCredentialSource']
  run?: Run
  sendResults?: Array<Run | Error>
  thread?: Record<string, unknown>
  items?: Array<Record<string, unknown>>
  attachmentStore?: CursorSdkRuntimeDeps['attachmentStore']
  debugSink?: LlmDebugRecorder
  turnLimits?: { maxWallTimeMs?: number }
  loadError?: Error
  sessionCoordinator?: CursorSdkRuntimeDeps['sessionCoordinator']
  omitLocalStore?: boolean
  kunContext?: CursorKunTurnContext
  onLoadKunTurnContext?: () => void | Promise<void>
  contextProfile?: CursorSdkRuntimeDeps['contextProfile']
  streamLimits?: CursorSdkRuntimeDeps['streamLimits']
  todoSyncError?: Error
  suspendGraphLeadTurn?: (
    input: Record<string, unknown>
  ) => Promise<
    | 'not_graph'
    | 'suspended'
    | 'supervision_pending'
    | 'suspended_pending_supervision'
  >
}) {
  const applied: unknown[] = []
  const updated: unknown[] = []
  const materialized = new Map<string, TurnItem>()
  const recorded: unknown[] = []
  const recordedDeltaSnapshots: Array<{
    event: unknown
    item: TurnItem
  }> = []
  const finished: unknown[] = []
  const createOptions: AgentOptions[] = []
  const sentMessages: unknown[] = []
  const sentOptions: unknown[] = []
  const resumedAgentIds: string[] = []
  const resumedOptions: Array<Partial<AgentOptions> | undefined> = []
  const kunContextSignals: AbortSignal[] = []
  const syncedTodos: unknown[] = []
  const loadItems = vi.fn(async () => input.items ?? [{
    id: 'user_1',
    threadId: 'thread_1',
    turnId: 'turn_1',
    role: 'user',
    status: 'completed',
    createdAt: new Date().toISOString(),
    kind: 'user_message',
    text: 'hi'
  }])
  const sendResults = input.sendResults ?? [input.run ?? fakeRun()]
  let sendIndex = 0
  const reload = vi.fn(async () => undefined)
  const dispose = vi.fn(async () => undefined)
  const agent = {
    agentId: 'agent_1',
    model: { id: 'auto' },
    send: async (message: unknown, options: unknown) => {
      sentMessages.push(message)
      sentOptions.push(options)
      const result = sendResults[Math.min(sendIndex, sendResults.length - 1)]
      sendIndex += 1
      if (result instanceof Error) throw result
      return result
    },
    close: vi.fn(),
    reload,
    listArtifacts: async () => [],
    downloadArtifact: async () => Buffer.alloc(0),
    [Symbol.asyncDispose]: dispose
  } as SDKAgent
  const sdk: CursorSdkApi = {
    Agent: {
      create: async (options) => {
        createOptions.push(options)
        return agent
      },
      resume: async (agentId, options) => {
        resumedAgentIds.push(agentId)
        resumedOptions.push(options)
        return agent
      }
    },
    ...(input.sessionCoordinator && !input.omitLocalStore
      ? {
          JsonlLocalAgentStore: class {
            constructor(readonly rootDir: string) {}
          } as never
        }
      : {})
  }
  const thread = {
    id: 'thread_1',
    title: 'Cursor test',
    workspace: '/tmp/cursor-workspace',
    model: 'auto',
    mode: 'agent',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    systemPrompt: '',
    turns: [{ id: 'turn_1', model: 'auto', mode: 'agent' }],
    ...input.thread
  }
  const deps = {
    providerConfigs: {
      'cursor-subscription': {
        kind: 'cursor-sdk',
        apiKey: input.apiKey ?? 'cursor-secret',
        ...(input.credentialSourceId ? { credentialSourceId: input.credentialSourceId } : {})
      }
    },
    providerIds: new Set(['cursor-subscription']),
    defaultIsCursor: false,
    defaultModel: 'auto',
    systemPrompt: 'Kun system prompt',
    threadStore: { get: async () => thread },
    sessionStore: {
      loadItems
    },
    turns: {
      applyItem: async (_threadId: string, item: TurnItem) => {
        applied.push(item)
        materialized.set(item.id, item)
      },
      updateItem: async (_threadId: string, itemId: string, patch: Partial<TurnItem>) => {
        const existing = materialized.get(itemId)
        if (!existing) return null
        const item = { ...existing, ...patch } as TurnItem
        updated.push(item)
        materialized.set(itemId, item)
        return item
      },
      updateTurnMetadata: async (_threadId: string, turnId: string, patch: Record<string, unknown>) => {
        const turn = thread.turns.find((candidate) => candidate.id === turnId)
        if (turn) Object.assign(turn, patch)
      },
      ...(input.suspendGraphLeadTurn
        ? { suspendGraphLeadTurn: input.suspendGraphLeadTurn }
        : {}),
      finishTurn: async (value: unknown) => { finished.push(value) }
    },
    events: {
      record: async (value: unknown) => {
        recorded.push(value)
        const event = value as { kind?: unknown; itemId?: unknown }
        if (
          (event.kind === 'assistant_text_delta' ||
            event.kind === 'assistant_reasoning_delta') &&
          typeof event.itemId === 'string'
        ) {
          const item = materialized.get(event.itemId)
          if (item) recordedDeltaSnapshots.push({ event: value, item: structuredClone(item) })
        }
      }
    },
    ids: { next: (prefix: string) => `${prefix}_1` },
    setThreadTodos: async (threadId: string, request: unknown) => {
      if (input.todoSyncError) throw input.todoSyncError
      syncedTodos.push({ threadId, request })
    },
    loadSdk: async () => {
      if (input.loadError) throw input.loadError
      return sdk
    },
    ...(input.resolveCredentialSource
      ? { resolveCredentialSource: input.resolveCredentialSource }
      : {}),
    debugSink: input.debugSink,
    attachmentStore: input.attachmentStore,
    turnLimits: input.turnLimits,
    sessionCoordinator: input.sessionCoordinator,
    contextProfile: input.contextProfile,
    streamLimits: input.streamLimits,
    ...(input.kunContext
      ? {
          loadKunTurnContext: async ({ signal }: { signal: AbortSignal }) => {
            kunContextSignals.push(signal)
            await input.onLoadKunTurnContext?.()
            return input.kunContext!
          }
        }
      : {})
  } as unknown as CursorSdkRuntimeDeps
  return {
    runtime: new CursorSdkRuntime(deps),
    createOptions,
    applied,
    updated,
    materialized,
    recorded,
    recordedDeltaSnapshots,
    finished,
    sentMessages,
    sentOptions,
    loadItems,
    kunContextSignals,
    resumedAgentIds,
    resumedOptions,
    syncedTodos,
    agent,
    reload,
    dispose
  }
}

describe('CursorSdkRuntime', () => {
  test('claims only configured Cursor providers', () => {
    const h = harness({})
    expect(h.runtime.handlesProvider('cursor-subscription')).toBe(true)
    expect(h.runtime.handlesProvider('claude-subscription')).toBe(false)
    expect(h.runtime.handlesProvider(undefined)).toBe(false)
  })

  test('runs a complete local SDK turn with isolated settings and an SDK trace', async () => {
    const debugSink = new LlmDebugRecorder()
    const h = harness({
      debugSink,
      run: fakeRun({
        stream: [{
          type: 'tool_call',
          agent_id: 'agent_1',
          run_id: 'run_1',
          call_id: 'call_1',
          name: 'shell',
          status: 'running',
          args: { command: 'pwd' }
        }, {
          type: 'tool_call',
          agent_id: 'agent_1',
          run_id: 'run_1',
          call_id: 'call_1',
          name: 'shell',
          status: 'completed',
          result: { stdout: '/tmp' }
        }, {
          type: 'assistant',
          agent_id: 'agent_1',
          run_id: 'run_1',
          message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
        }]
      })
    })
    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.createOptions[0]).toMatchObject({
      apiKey: 'cursor-secret',
      model: { id: 'auto' },
      mode: 'agent',
      local: {
        cwd: '/tmp/cursor-workspace',
        settingSources: [],
        sandboxOptions: { enabled: false }
      }
    })
    expect(h.applied).toContainEqual(expect.objectContaining({
      kind: 'assistant_text',
      text: 'hello',
      status: 'completed'
    }))
    expect(h.finished).toContainEqual(expect.objectContaining({ status: 'completed' }))
    const trace = debugSink.snapshot()[0]?.exchanges[0]
    expect(trace).toMatchObject({
      transport: 'sdk',
      endpointFormat: 'cursor-sdk',
      request: { method: 'SDK', url: 'cursor-sdk://local/agent' },
      delegated: {
        providerKind: 'cursor-sdk',
        phase: 'rebased',
        contextManagement: 'sdk-managed',
        nativeHistory: 'none'
      },
      decoded: {
        toolResults: [{
          callId: 'call_1',
          toolName: 'shell',
          output: '{"stdout":"/tmp"}',
          isError: false
        }]
      }
    })
    expect(JSON.stringify(trace)).not.toContain('cursor-secret')
  })

  test('reloads canonical history after Kun context materializes a goal', async () => {
    const createdAt = '2026-08-06T00:00:00.000Z'
    const goal = {
      threadId: 'thread_1',
      objective: 'Finish the migration safely.',
      status: 'active' as const,
      tokenBudget: 10_000,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt,
      updatedAt: createdAt
    }
    const items: Array<Record<string, unknown>> = [{
      id: 'user_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      role: 'user',
      status: 'completed',
      createdAt,
      kind: 'user_message',
      text: 'continue the migration'
    }]
    const debugSink = new LlmDebugRecorder()
    const h = harness({
      items,
      debugSink,
      kunContext: {
        instructionBlocks: [],
        activeSkillIds: [],
        tools: [],
        customTools: {}
      },
      thread: { goal },
      onLoadKunTurnContext: () => {
        items.push({
          id: 'item_turn_1_goal_context',
          threadId: 'thread_1',
          turnId: 'turn_1',
          role: 'system',
          status: 'completed',
          goalKey: goalContextKey(goal)!,
          createdAt,
          kind: 'goal_context',
          text: 'Finish the migration safely.'
        })
      }
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.loadItems).toHaveBeenCalledTimes(2)
    expect(String(h.sentMessages[0])).toContain(
      '[active goal] Finish the migration safely.'
    )
    expect(String(h.sentMessages[0])).toContain('<prior_conversation>')
    const trace = (await debugSink.listThread('thread_1')).records[0]
    if (!trace?.request) throw new Error('expected a request payload in the captured trace')
    expect(trace.request.body.text).not.toContain('Finish the migration safely.')
    expect(trace.request.body.text).toContain('[REDACTED]')
  })

  test('keeps Graph in plan mode and gives pending review a real second Cursor exchange', async () => {
    const suspendGraphLeadTurn = vi.fn()
      .mockResolvedValueOnce('supervision_pending')
      .mockResolvedValueOnce('supervision_pending')
      .mockResolvedValueOnce('suspended_pending_supervision')
    const h = harness({
      thread: {
        turns: [{
          id: 'turn_1',
          model: 'auto',
          mode: 'agent',
          orchestration: 'graph'
        }]
      },
      kunContext: {
        instructionBlocks: [],
        activeSkillIds: [],
        tools: [],
        customTools: {},
        graphPhase: 'supervising'
      },
      sendResults: [fakeRun(), fakeRun()],
      suspendGraphLeadTurn
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('suspended_pending_supervision')

    expect(h.createOptions[0]).toMatchObject({
      mode: 'plan',
      local: { sandboxOptions: { enabled: true } }
    })
    expect(h.sentMessages).toHaveLength(2)
    expect(h.sentMessages[1]).toContain('Host supervision gate')
    expect(h.sentMessages[1]).toContain('call `graph_review_node`')
    expect(suspendGraphLeadTurn).toHaveBeenNthCalledWith(1, {
      threadId: 'thread_1',
      turnId: 'turn_1'
    })
    expect(suspendGraphLeadTurn).toHaveBeenNthCalledWith(2, {
      threadId: 'thread_1',
      turnId: 'turn_1'
    })
    expect(suspendGraphLeadTurn).toHaveBeenNthCalledWith(3, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      force: true,
      preserveDeliveryCursor: true,
      allowPendingSupervision: true
    })
    expect(h.finished).toEqual([])
  })

  test('reminds Graph planning once before a second prose response becomes needs-correction', async () => {
    const suspendGraphLeadTurn = vi.fn(async () => 'suspended' as const)
    const h = harness({
      thread: {
        turns: [{
          id: 'turn_1',
          model: 'auto',
          mode: 'agent',
          orchestration: 'graph'
        }]
      },
      kunContext: {
        instructionBlocks: [],
        activeSkillIds: [],
        tools: [],
        customTools: {},
        graphPhase: 'planning',
        graphPlanWasCommitted: () => false
      },
      sendResults: [fakeRun(), fakeRun()],
      suspendGraphLeadTurn
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('suspended')

    expect(h.sentMessages).toHaveLength(2)
    expect(h.sentMessages[1]).toContain('Host planning gate')
    expect(h.sentMessages[1]).toContain('call `graph_define_plan` now')
    // Planning is not suspended on the first prose response. The only
    // suspension happens after the bounded second exchange is exhausted.
    expect(suspendGraphLeadTurn).toHaveBeenCalledTimes(1)
    expect(h.finished).toEqual([])
  })

  test('syncs successful Cursor updateTodos results without redispatching the tool', async () => {
    const h = harness({
      run: fakeRun({
        stream: [{
          type: 'tool_call',
          agent_id: 'agent_1',
          run_id: 'run_1',
          call_id: 'call_todos',
          name: 'updateTodos',
          status: 'completed',
          result: {
            status: 'success',
            value: {
              todos: [
                { content: 'Finished step', status: 'completed' },
                { content: 'Current step', status: 'inProgress' },
                { content: 'Later step', status: 'pending' }
              ],
              totalCount: 3
            }
          }
        }]
      })
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.syncedTodos).toEqual([{
      threadId: 'thread_1',
      request: {
        todos: [
          { content: 'Finished step', status: 'completed' },
          { content: 'Current step', status: 'in_progress' },
          { content: 'Later step', status: 'pending' }
        ]
      }
    }])
    expect(h.recorded).not.toContainEqual(expect.objectContaining({
      kind: 'tool_call_ready',
      toolName: 'updateTodos'
    }))
  })

  test('keeps a Cursor turn successful when todo mirroring fails', async () => {
    const h = harness({
      todoSyncError: new Error('todo store unavailable'),
      run: fakeRun({
        stream: [{
          type: 'tool_call',
          agent_id: 'agent_1',
          run_id: 'run_1',
          call_id: 'call_todos',
          name: 'updateTodos',
          status: 'completed',
          result: {
            status: 'success',
            value: {
              todos: [{ content: 'Current step', status: 'inProgress' }],
              totalCount: 1
            }
          }
        }]
      })
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')
    expect(h.recorded).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'cursor_sdk_todo_sync_failed',
      severity: 'warning',
      message: expect.stringContaining('todo store unavailable')
    }))
    expect(h.finished).toContainEqual(expect.objectContaining({ status: 'completed' }))
  })

  test('stamps the turn usage with the TTFT and speed of the streamed answer', async () => {
    let clock = 0
    setHarnessTimingClock(() => clock)
    try {
      const base = fakeRun({
        result: { usage: { inputTokens: 500, outputTokens: 120, totalTokens: 620, cacheReadTokens: 0, cacheWriteTokens: 0 } }
      })
      const assistant = (index: number): SDKMessage => ({
        type: 'assistant',
        agent_id: 'agent_1',
        run_id: 'run_1',
        // 35 ASCII chars = 10 estimated tokens; distinct text so each message is a new fragment
        message: { role: 'assistant', content: [{ type: 'text', text: String.fromCharCode(65 + index).repeat(35) }] }
      })
      const run = {
        ...base,
        stream: () => (async function* () {
          for (let i = 0; i < 10; i += 1) {
            clock = 800 + i * 100
            yield assistant(i)
          }
        })()
      } as Run
      const h = harness({ run })
      await expect(h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal, 'cursor-subscription'))
        .resolves.toBe('completed')
      const usage = h.recorded.find((event) => (event as { kind?: string }).kind === 'usage') as
        { usage: Record<string, unknown> } | undefined
      expect(usage?.usage).toMatchObject({
        completionTokens: 120,
        requestTtftMs: 800, // prompt handed to the agent at 0, first fragment at 800
        requestGenerationMs: 900,
        requestGenerationTokens: 90
      })
    } finally {
      setHarnessTimingClock(undefined)
    }
  })



})
