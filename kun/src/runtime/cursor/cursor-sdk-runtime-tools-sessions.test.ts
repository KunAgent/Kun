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
  test('injects Kun instructions and custom tools into Cursor capabilities, context, and traces', async () => {
    const debugSink = new LlmDebugRecorder()
    const mcpExecute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'mcp result' }]
    }))
    const h = harness({
      debugSink,
      contextProfile: () => ({
        contextWindowTokens: 100_000,
        softThresholdTokens: 80_000,
        hardThresholdTokens: 90_000
      }),
      kunContext: {
        instructionBlocks: ['Workspace AGENTS instructions', 'Active skill instructions'],
        activeSkillIds: ['docs-skill'],
        tools: [{
          name: 'mcp_call_tool',
          description: 'Call an MCP tool',
          inputSchema: { type: 'object' },
          providerId: 'mcp:facade',
          providerKind: 'mcp'
        }],
        customTools: {
          mcp_call_tool: {
            description: 'Call an MCP tool',
            inputSchema: { type: 'object' },
            execute: mcpExecute
          }
        }
      }
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.createOptions[0]?.local?.customTools).toHaveProperty('mcp_call_tool')
    // The per-send local override must carry the same Kun custom tools so
    // resumed and forced recovery runs never lose the tool catalog.
    expect(h.sentOptions[0]).toMatchObject({
      local: expect.objectContaining({
        customTools: expect.objectContaining({
          mcp_call_tool: expect.objectContaining({ execute: mcpExecute })
        })
      })
    })
    expect(String(h.sentMessages[0])).toContain('Kun system prompt')
    expect(String(h.sentMessages[0])).toContain('Workspace AGENTS instructions')
    expect(String(h.sentMessages[0])).toContain('Active skill instructions')
    expect(h.recorded).toContainEqual(expect.objectContaining({
      kind: 'delegated_runtime',
      capabilities: expect.objectContaining({
        kunTools: true,
        externalApproval: true
      })
    }))
    expect(h.recorded).toContainEqual(expect.objectContaining({
      kind: 'context_snapshot',
      toolCount: 1,
      activeSkillIds: ['docs-skill'],
      breakdown: expect.objectContaining({ tools: expect.any(Number) })
    }))
    const trace = debugSink.snapshot()[0]?.exchanges[0]
    expect(trace?.toolCatalog).toEqual([{
      name: 'mcp_call_tool',
      providerId: 'mcp:facade',
      providerKind: 'mcp'
    }])
    const traceBody = JSON.parse(trace?.request?.body?.text ?? '{}') as Record<string, unknown>
    expect(traceBody).toMatchObject({
      instructions: expect.arrayContaining([
        'Kun system prompt',
        'Workspace AGENTS instructions'
      ]),
      tools: [{
        name: 'mcp_call_tool',
        description: 'Call an MCP tool'
      }]
    })
    expect(JSON.stringify(traceBody)).not.toContain('mcpExecute')
  })

  test('resumes a compatible persisted agent and sends only the current request', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-resume-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const priorItems = [{
      id: 'user_old',
      threadId: 'thread_1',
      turnId: 'turn_old',
      role: 'user',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      kind: 'user_message',
      text: 'portable old context'
    }] as const
    const route = {
      providerKind: 'cursor-sdk' as const,
      providerId: 'cursor-subscription',
      credentialIdentity: delegatedCredentialIdentity({
        providerId: 'cursor-subscription',
        credentialSecret: 'cursor-secret'
      }),
      workspace: '/tmp/cursor-workspace',
      model: 'auto',
      capabilityFingerprint: delegatedCapabilityFingerprint({
        systemPrompt: 'Kun system prompt',
        threadPersona: '',
        mode: 'agent',
        sandbox: false,
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access',
        settingSources: [],
        capabilities: cursorSdkCapabilities()
      }),
      continuationMode: 'native' as const
    }
    const prepared = await coordinator.prepare({
      threadId: 'thread_1',
      route,
      priorItems: []
    })
    await coordinator.commit({
      preparation: prepared,
      committedItems: priorItems as never,
      lastCommittedTurnId: 'turn_old',
      nativeSessionId: 'agent_persisted'
    })
    expect((await coordinator.store.load('thread_1'))?.synchronizedHistoryDigest)
      .toBe(delegatedHistoryDigest(priorItems as never))
    const h = harness({
      sessionCoordinator: coordinator,
      thread: {
        turns: [{ id: 'turn_1', model: 'auto', mode: 'agent' }]
      },
      items: [
        ...priorItems,
        {
          id: 'user_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          role: 'user',
          status: 'completed',
          createdAt: '2026-01-01T00:01:00.000Z',
          kind: 'user_message',
          text: 'current only'
        }
      ]
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.resumedAgentIds).toEqual(['agent_persisted'])
    expect(
      (h.resumedOptions[0]?.local?.store as unknown as { rootDir?: string })?.rootDir
    ).toContain('provider-state')
    expect(String(h.sentMessages[0])).toContain('current only')
    expect(String(h.sentMessages[0])).not.toContain('portable old context')
  })
  test('updates request-local context inside the existing native session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-dynamic-rebase-'))
    const coordinator = new DelegatedSessionCoordinator(new FileDelegatedSessionBindingStore(root))
    const route = {
      providerKind: 'cursor-sdk' as const, providerId: 'cursor-subscription',
      credentialIdentity: delegatedCredentialIdentity({
        providerId: 'cursor-subscription', credentialSecret: 'cursor-secret'
      }),
      workspace: '/tmp/cursor-workspace', model: 'auto',
      capabilityFingerprint: delegatedCapabilityFingerprint({
        systemPrompt: 'Kun system prompt', threadPersona: '', mode: 'agent', sandbox: false,
        approvalPolicy: 'auto', sandboxMode: 'danger-full-access', settingSources: [],
        capabilities: cursorSdkCapabilities()
      }), continuationMode: 'native' as const
    }
    const prepared = await coordinator.prepare({ threadId: 'thread_1', route, priorItems: [] })
    await coordinator.commit({
      preparation: prepared, committedItems: [], lastCommittedTurnId: 'turn_old',
      nativeSessionId: 'agent_persisted'
    })
    const hostControl = 'Current private host control.'
    const h = harness({
      sessionCoordinator: coordinator,
      thread: { turns: [{ id: 'turn_1', model: 'auto', persona: 'Be precise.' }] },
      items: [{
        id: 'private', threadId: 'thread_1', turnId: 'turn_1', role: 'system',
        status: 'completed', createdAt: '2026-08-13T00:00:00.000Z',
        kind: 'runtime_context_source', contextKind: 'host-control', content: hostControl
      }, {
        id: 'user_1', threadId: 'thread_1', turnId: 'turn_1', role: 'user',
        status: 'completed', createdAt: '2026-08-13T00:00:00.000Z',
        kind: 'user_message', text: 'current request'
      }]
    })
    await expect(h.runtime.runTurn(
      'thread_1', 'turn_1', new AbortController().signal, 'cursor-subscription'
    )).resolves.toBe('completed')
    expect(h.resumedAgentIds).toEqual(['agent_persisted'])
    expect(String(h.sentMessages[0])).toContain(hostControl)
    expect((await coordinator.store.load('thread_1'))?.nativeSessionId).toBe('agent_1')
  })
  test('rebases a native session when the current turn introduces active goal context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-goal-rebase-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const priorItems = [{
      id: 'user_old_goal_rebase',
      threadId: 'thread_1',
      turnId: 'turn_old',
      role: 'user',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      kind: 'user_message',
      text: 'portable context before the goal'
    }] as const
    const route = {
      providerKind: 'cursor-sdk' as const,
      providerId: 'cursor-subscription',
      credentialIdentity: delegatedCredentialIdentity({
        providerId: 'cursor-subscription',
        credentialSecret: 'cursor-secret'
      }),
      workspace: '/tmp/cursor-workspace',
      model: 'auto',
      capabilityFingerprint: delegatedCapabilityFingerprint({
        systemPrompt: 'Kun system prompt',
        threadPersona: '',
        mode: 'agent',
        sandbox: false,
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access',
        settingSources: [],
        capabilities: cursorSdkCapabilities()
      }),
      continuationMode: 'native' as const
    }
    const prepared = await coordinator.prepare({
      threadId: 'thread_1',
      route,
      priorItems: []
    })
    await coordinator.commit({
      preparation: prepared,
      committedItems: priorItems as never,
      lastCommittedTurnId: 'turn_old',
      nativeSessionId: 'agent_persisted'
    })
    const createdAt = '2026-08-06T00:00:00.000Z'
    const goal = {
      threadId: 'thread_1',
      objective: 'Finish the migration before answering anything else.',
      status: 'active' as const,
      tokenBudget: 1_000,
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt,
      updatedAt: createdAt
    }
    const h = harness({
      sessionCoordinator: coordinator,
      thread: {
        goal,
        turns: [{ id: 'turn_1', model: 'auto', mode: 'agent' }]
      },
      items: [
        ...priorItems,
        {
          id: 'user_goal_rebase',
          threadId: 'thread_1',
          turnId: 'turn_1',
          role: 'user',
          status: 'completed',
          createdAt,
          kind: 'user_message',
          text: 'continue now'
        },
        {
          id: 'goal_context_rebase',
          threadId: 'thread_1',
          turnId: 'turn_1',
          role: 'system',
          status: 'completed',
          createdAt,
          kind: 'goal_context',
          goalKey: goalContextKey(goal)!,
          text: 'Finish the migration before answering anything else.'
        }
      ]
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.resumedAgentIds).toEqual([])
    expect(String(h.sentMessages[0])).toContain('<kun_handoff')
    expect(String(h.sentMessages[0])).toContain('portable context before the goal')
    expect(String(h.sentMessages[0])).toContain(
      'Finish the migration before answering anything else.'
    )
  })

  test('rotates native continuation when the bridged Kun tool catalog changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-cursor-tool-rotation-'))
    const coordinator = new DelegatedSessionCoordinator(
      new FileDelegatedSessionBindingStore(root)
    )
    const priorItems = [{
      id: 'user_old',
      threadId: 'thread_1',
      turnId: 'turn_old',
      role: 'user',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      kind: 'user_message',
      text: 'portable old context'
    }] as const
    const prepared = await coordinator.prepare({
      threadId: 'thread_1',
      route: {
        providerKind: 'cursor-sdk',
        providerId: 'cursor-subscription',
        credentialIdentity: delegatedCredentialIdentity({
          providerId: 'cursor-subscription',
          credentialSecret: 'cursor-secret'
        }),
        workspace: '/tmp/cursor-workspace',
        model: 'auto',
        capabilityFingerprint: delegatedCapabilityFingerprint({
          systemPrompt: 'Kun system prompt',
          threadPersona: '',
          mode: 'agent',
          sandbox: false,
          settingSources: [],
          capabilities: cursorSdkCapabilities(true),
          instructions: [],
          tools: [{
            name: 'old_mcp_tool',
            description: 'Old MCP tool',
            inputSchema: { type: 'object' },
            providerId: 'mcp:old',
            providerKind: 'mcp'
          }]
        }),
        continuationMode: 'native'
      },
      priorItems: []
    })
    await coordinator.commit({
      preparation: prepared,
      committedItems: priorItems as never,
      lastCommittedTurnId: 'turn_old',
      nativeSessionId: 'agent_old_catalog'
    })
    const h = harness({
      sessionCoordinator: coordinator,
      kunContext: {
        instructionBlocks: [],
        activeSkillIds: [],
        tools: [{
          name: 'new_mcp_tool',
          description: 'New MCP tool',
          inputSchema: { type: 'object' },
          providerId: 'mcp:new',
          providerKind: 'mcp'
        }],
        customTools: {}
      },
      items: [
        ...priorItems,
        {
          id: 'user_1',
          threadId: 'thread_1',
          turnId: 'turn_1',
          role: 'user',
          status: 'completed',
          createdAt: '2026-01-01T00:01:00.000Z',
          kind: 'user_message',
          text: 'current request'
        }
      ]
    })

    await expect(h.runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    expect(h.resumedAgentIds).toEqual([])
    expect(h.createOptions).toHaveLength(1)
    expect(String(h.sentMessages[0])).toContain('portable old context')
    expect(h.recorded).toContainEqual(expect.objectContaining({
      kind: 'delegated_runtime',
      phase: 'rebased',
      reason: 'capabilities_changed'
    }))
  })


})
