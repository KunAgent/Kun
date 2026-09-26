import { describe, expect, test, vi } from 'vitest'
import type {
  AgentOptions,
  Run,
  RunResult,
  SDKAgent,
  SDKMessage
} from '@cursor/sdk'
import { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import { InMemoryApprovalGate } from '../../adapters/in-memory-approval-gate.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'
import { createCreatePlanTool } from '../../adapters/tool/create-plan-tool.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import {
  createCursorSdkRuntime,
  type CursorSdkRuntimeFactoryDeps
} from './cursor-sdk-runtime-factory.js'
import type { CursorSdkApi } from './cursor-sdk-runtime.js'
import { MemoryRecord } from '../../contracts/memory.js'

function messages(values: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  return (async function* () {
    for (const value of values) yield value
  })()
}

function completedRun(): Run {
  const result: RunResult = {
    id: 'run_1',
    status: 'finished',
    result: 'done'
  }
  return {
    id: 'run_1',
    agentId: 'agent_1',
    supports: (operation) => operation === 'stream' || operation === 'wait' || operation === 'cancel',
    unsupportedReason: () => undefined,
    stream: () => messages([{
      type: 'assistant',
      agent_id: 'agent_1',
      run_id: 'run_1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
    }]),
    conversation: async () => [],
    wait: async () => result,
    cancel: async () => undefined,
    status: result.status,
    onDidChangeStatus: () => () => undefined,
    result: result.result,
    error: undefined,
    model: undefined,
    durationMs: undefined,
    usage: undefined,
    git: undefined,
    createdAt: 1
  }
}

describe('Cursor SDK runtime factory', () => {
  test('uses the bounded Graph tool catalog and Graph Lead instruction by durable phase', async () => {
    const graphOnly = (context: { orchestration?: string }) =>
      context.orchestration === 'graph'
    const graphDefinePlan = vi.fn(async (args: Record<string, unknown>) => {
      if (Object.prototype.hasOwnProperty.call(args, '__raw')) {
        return {
          output: {
            code: 'graph_plan_invalid',
            retryable: true,
            receivedArguments: args
          },
          isError: true
        }
      }
      return { output: { status: 'committed', receivedArguments: args } }
    })
    const registry = CapabilityRegistry.fromLocalTools([
      LocalToolHost.defineTool({
        name: 'read',
        description: 'Read safely',
        inputSchema: { type: 'object' },
        sideEffect: 'read-only',
        execute: async () => ({ output: 'read' })
      }),
      LocalToolHost.defineTool({
        name: 'write',
        description: 'Write',
        inputSchema: { type: 'object' },
        sideEffect: 'unknown',
        execute: async () => ({ output: 'write' })
      }),
      LocalToolHost.defineTool({
        name: 'graph_define_plan',
        description: 'Define Graph plan',
        inputSchema: { type: 'object' },
        shouldAdvertise: graphOnly,
        execute: graphDefinePlan
      }),
      LocalToolHost.defineTool({
        name: 'graph_review_node',
        description: 'Review Graph node',
        inputSchema: { type: 'object' },
        shouldAdvertise: graphOnly,
        execute: async () => ({ output: { status: 'accepted' } })
      })
    ])
    const graphTurn = {
      id: 'turn_graph',
      prompt: 'plan with Graph',
      orchestration: 'graph',
      actingModelRoute: {
        model: 'cursor-model',
        providerId: 'cursor-provider'
      },
      graphPlanningLifecycle: {
        version: 1,
        draftId: 'draft_1',
        reservedRunId: 'run_1',
        state: 'planning',
        draftRevision: 1
      }
    }
    const thread = {
      id: 'thread_graph',
      title: 'Cursor Graph',
      workspace: '/tmp/cursor-graph',
      model: 'cursor-model',
      mode: 'agent',
      approvalPolicy: 'auto',
      approvalReviewer: 'user',
      sandboxMode: 'danger-full-access',
      turns: [graphTurn]
    }
    const runtime = createCursorSdkRuntime({
      registry,
      toolHost: new LocalToolHost({ registry }),
      providerConfigs: {},
      providerIds: new Set(['cursor-provider']),
      defaultIsCursor: false,
      defaultModel: 'cursor-model',
      defaultApprovalPolicy: 'auto',
      defaultSandboxMode: 'danger-full-access',
      threadStore: { get: async () => thread } as never,
      sessionStore: {} as never,
      turns: { updateTurnMetadata: async () => undefined } as never,
      events: { record: async () => undefined } as never,
      ids: { next: (prefix) => `${prefix}_1` }
    })
    const loadKunTurnContext = (runtime as unknown as {
      deps: {
        loadKunTurnContext(input: {
          threadId: string
          turnId: string
          userText: string
          actingModelRoute: {
            model: string
            providerId?: string
          }
          signal: AbortSignal
        }): Promise<{
          tools: Array<{ name: string }>
          instructionBlocks: string[]
          customTools: Record<string, {
            execute(
              args: Record<string, unknown>,
              context: { toolCallId: string }
            ): Promise<unknown>
          }>
          graphPhase?: 'planning' | 'supervising'
          graphPlanWasCommitted?: () => boolean
          graphPlanCanRetry?: () => boolean
        }>
      }
    }).deps.loadKunTurnContext
    const input = {
      threadId: 'thread_graph',
      turnId: 'turn_graph',
      userText: 'plan with Graph',
      actingModelRoute: graphTurn.actingModelRoute,
      signal: new AbortController().signal
    }

    const planning = await loadKunTurnContext(input)
    expect(planning.graphPhase).toBe('planning')
    // Overlapping Cursor built-ins (read/write) are not bridged as custom tools.
    expect(planning.tools.map((tool) => tool.name).sort()).toEqual([
      'graph_define_plan'
    ])
    expect(planning.instructionBlocks.join('\n')).toContain(
      'Graph Mode: source Lead operating contract'
    )
    expect(Object.keys(planning.customTools).sort()).toEqual([
      'graph_define_plan'
    ])
    expect(planning.graphPlanWasCommitted?.()).toBe(false)
    expect(planning.graphPlanCanRetry?.()).toBe(true)

    const incompleteRaw = '{"plan":{"title":"truncated"'
    await expect(planning.customTools.graph_define_plan!.execute(
      { __raw: incompleteRaw },
      { toolCallId: 'call_define_plan_invalid' }
    )).resolves.toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({
          code: 'graph_plan_invalid',
          retryable: true,
          receivedArguments: { __raw: incompleteRaw }
        }, null, 2)
      }],
      isError: true
    })
    expect(graphDefinePlan).toHaveBeenLastCalledWith(
      { __raw: incompleteRaw },
      expect.objectContaining({
        threadId: 'thread_graph',
        turnId: 'turn_graph'
      }),
      expect.any(Function)
    )
    expect(planning.graphPlanWasCommitted?.()).toBe(false)
    expect(planning.graphPlanCanRetry?.()).toBe(true)

    const correctedArguments = {
      plan: {
        title: 'Bounded Graph plan',
        tasks: [{ id: 'task_1', objective: 'Apply the requested change' }]
      }
    }
    await expect(planning.customTools.graph_define_plan!.execute(
      { __raw: JSON.stringify(correctedArguments) },
      { toolCallId: 'call_define_plan_valid' }
    )).resolves.toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'committed',
          receivedArguments: correctedArguments
        }, null, 2)
      }]
    })
    expect(graphDefinePlan).toHaveBeenLastCalledWith(
      correctedArguments,
      expect.objectContaining({
        threadId: 'thread_graph',
        turnId: 'turn_graph'
      }),
      expect.any(Function)
    )
    expect(planning.graphPlanWasCommitted?.()).toBe(true)
    expect(planning.graphPlanCanRetry?.()).toBe(false)

    graphTurn.graphPlanningLifecycle = {
      ...graphTurn.graphPlanningLifecycle,
      state: 'committed',
      draftRevision: 2
    }
    const supervising = await loadKunTurnContext(input)
    expect(supervising.graphPhase).toBe('supervising')
    expect(supervising.tools.map((tool) => tool.name).sort()).toEqual([
      'graph_review_node'
    ])
  })

  test('materializes an active goal context only for non-plan Cursor turns', async () => {
    const ensureGoalContext = vi.fn(async () => undefined)
    const createdAt = '2026-08-06T00:00:00.000Z'
    const thread = {
      id: 'thread_goal',
      title: 'Cursor goal',
      workspace: '/tmp/cursor-goal',
      model: 'cursor-model',
      mode: 'agent',
      approvalPolicy: 'auto',
      approvalReviewer: 'user',
      sandboxMode: 'danger-full-access',
      goal: {
        threadId: 'thread_goal',
        objective: 'Finish the migration safely.',
        status: 'active',
        tokenBudget: 10_000,
        tokensUsed: 250,
        timeUsedSeconds: 12,
        createdAt,
        updatedAt: createdAt
      },
      turns: [{
        id: 'turn_goal',
        prompt: 'continue the migration',
        actingModelRoute: { model: 'cursor-model', providerId: 'cursor-provider' }
      }]
    }
    const registry = CapabilityRegistry.fromLocalTools([])
    const runtime = createCursorSdkRuntime({
      registry,
      toolHost: new LocalToolHost({ registry }),
      providerConfigs: {},
      providerIds: new Set(['cursor-provider']),
      defaultIsCursor: false,
      defaultModel: 'cursor-model',
      defaultApprovalPolicy: 'auto',
      defaultSandboxMode: 'danger-full-access',
      threadStore: { get: async () => thread } as never,
      sessionStore: {} as never,
      turns: {
        ensureGoalContext,
        updateTurnMetadata: async () => undefined
      } as never,
      events: { record: async () => undefined } as never,
      ids: { next: (prefix) => `${prefix}_1` }
    })
    const loadKunTurnContext = (runtime as unknown as {
      deps: {
        loadKunTurnContext(input: {
          threadId: string
          turnId: string
          userText: string
          actingModelRoute: { model: string, providerId?: string }
          signal: AbortSignal
        }): Promise<{ instructionBlocks: string[] }>
      }
    }).deps.loadKunTurnContext
    const input = {
      threadId: 'thread_goal',
      turnId: 'turn_goal',
      userText: 'continue the migration',
      actingModelRoute: { model: 'cursor-model', providerId: 'cursor-provider' },
      signal: new AbortController().signal
    }

    const agentContext = await loadKunTurnContext(input)

    expect(ensureGoalContext).toHaveBeenCalledWith(
      'thread_goal',
      'turn_goal',
      expect.any(AbortSignal)
    )
    expect(agentContext.instructionBlocks.join('\n')).not.toContain(
      'Continue working toward the active thread goal.'
    )

    thread.mode = 'plan'
    await loadKunTurnContext(input)
    expect(ensureGoalContext).toHaveBeenCalledTimes(1)
  })

  test('records only Cursor memories included after retrieval', async () => {
    const registry = CapabilityRegistry.fromLocalTools([])
    const thread = {
      id: 'thread_memory',
      title: 'Cursor memory',
      workspace: '/tmp/cursor-memory',
      model: 'cursor-model',
      mode: 'agent',
      approvalPolicy: 'auto',
      approvalReviewer: 'user',
      sandboxMode: 'danger-full-access',
      turns: [{
        id: 'turn_memory',
        prompt: 'Use my saved preference.',
        createdAt: '2026-09-15T03:00:00.000Z',
        actingModelRoute: { model: 'cursor-model', providerId: 'cursor-provider' }
      }]
    }
    const memory = MemoryRecord.parse({
      id: 'memory_cursor',
      content: 'Prefer concise release notes.',
      scope: 'workspace',
      workspace: '/tmp/cursor-memory',
      createdAt: '2026-09-15T02:00:00.000Z',
      updatedAt: '2026-09-15T02:00:00.000Z'
    })
    const memoryStore = {
      retrieve: vi.fn(async () => [memory]),
      setLastInjected: vi.fn()
    }
    const append = vi.fn(async () => ({ status: 'appended' as const }))
    const runtime = createCursorSdkRuntime({
      registry,
      toolHost: new LocalToolHost({ registry }),
      providerConfigs: {},
      providerIds: new Set(['cursor-provider']),
      defaultIsCursor: false,
      defaultModel: 'cursor-model',
      defaultApprovalPolicy: 'auto',
      defaultSandboxMode: 'danger-full-access',
      threadStore: { get: async () => thread } as never,
      sessionStore: {} as never,
      turns: { updateTurnMetadata: async () => undefined } as never,
      events: { record: async () => undefined } as never,
      ids: { next: (prefix) => `${prefix}_1` },
      memoryStore: memoryStore as never,
      memoryFeedback: { enabled: () => true, append }
    })
    const loadKunTurnContext = (runtime as unknown as {
      deps: {
        loadKunTurnContext(input: {
          threadId: string
          turnId: string
          userText: string
          actingModelRoute: { model: string, providerId?: string }
          signal: AbortSignal
        }): Promise<{ instructionBlocks: string[] }>
      }
    }).deps.loadKunTurnContext

    const context = await loadKunTurnContext({
      threadId: 'thread_memory',
      turnId: 'turn_memory',
      userText: 'Use my saved preference.',
      actingModelRoute: { model: 'cursor-model', providerId: 'cursor-provider' },
      signal: new AbortController().signal
    })

    expect(context.instructionBlocks.join('\n')).toContain('Prefer concise release notes.')
    expect(memoryStore.setLastInjected).toHaveBeenCalledWith(['memory_cursor'])
    expect(append).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'retrieved',
      memoryId: 'memory_cursor',
      threadId: 'thread_memory',
      turnId: 'turn_memory'
    }))
  })

  test('bridges policy-filtered MCP and extension tools through Kun ToolHost', async () => {
    const mcpExecute = vi.fn(async (args: Record<string, unknown>) => ({
      output: { server: args.serverId, ok: true }
    }))
    const extensionExecute = vi.fn(async () => ({ output: 'extension result' }))
    const registry = new CapabilityRegistry([{
      id: 'mcp:facade',
      kind: 'mcp',
      enabled: true,
      available: true,
      tools: [LocalToolHost.defineTool({
        name: 'mcp_call_tool',
        description: 'Call an MCP tool through Kun',
        inputSchema: {
          type: 'object',
          properties: { serverId: { type: 'string' } },
          required: ['serverId']
        },
        sideEffect: 'read-only',
        execute: mcpExecute
      })]
    }, {
      id: 'extension:demo',
      kind: 'extension',
      enabled: true,
      available: true,
      tools: [LocalToolHost.defineTool({
        name: 'extension_render',
        description: 'Render through a Kun extension',
        inputSchema: { type: 'object' },
        execute: extensionExecute
      })]
    }])
    const toolHost = new LocalToolHost({ registry })
    const executeSpy = vi.spyOn(toolHost, 'execute')
    const createOptions: AgentOptions[] = []
    const sentMessages: unknown[] = []
    const recorded: unknown[] = []
    const updatedMetadata: unknown[] = []
    let bridgedToolResult: unknown
    const debugSink = new LlmDebugRecorder()
    const currentHostControl = 'Current private Cursor host control.'
    const oldHostControl = 'Old private Cursor host control.'
    const agent = {
      agentId: 'agent_1',
      model: { id: 'auto' },
      send: async (message: unknown) => {
        sentMessages.push(message)
        bridgedToolResult = await createOptions[0]?.local?.customTools?.mcp_call_tool?.execute(
          { serverId: 'docs' },
          { toolCallId: 'cursor-mcp-call' }
        )
        return completedRun()
      },
      close: vi.fn(),
      reload: async () => undefined,
      listArtifacts: async () => [],
      downloadArtifact: async () => Buffer.alloc(0),
      [Symbol.asyncDispose]: async () => undefined
    } as SDKAgent
    const sdk: CursorSdkApi = {
      Agent: {
        create: async (options) => {
          createOptions.push(options)
          return agent
        },
        resume: async () => agent
      }
    }
    const thread = {
      id: 'thread_1',
      title: 'Cursor bridge',
      workspace: '/tmp/cursor-bridge',
      model: 'auto',
      mode: 'agent',
      approvalPolicy: 'always',
      sandboxMode: 'workspace-write',
      systemPrompt: 'Thread persona',
      turns: [{
        id: 'turn_1',
        model: 'auto',
        mode: 'agent',
        persona: 'Write with a precise editorial voice.'
      }]
    }
    const userItem = {
      id: 'user_1',
      threadId: 'thread_1',
      turnId: 'turn_1',
      role: 'user',
      status: 'completed',
      createdAt: '2026-07-25T00:00:00.000Z',
      kind: 'user_message',
      text: 'Use the MCP server'
    }
    const approvalGate = {
      request: vi.fn(async () => 'allow' as const),
      decide: vi.fn(() => true),
      reserveDecision: vi.fn(() => true),
      commitDecision: vi.fn(() => true),
      rollbackDecision: vi.fn(() => true),
      expire: vi.fn(() => true),
      pending: vi.fn(() => []),
      get: vi.fn(() => undefined)
    }
    const runtime = createCursorSdkRuntime({
      registry,
      toolHost,
      providerConfigs: {
        'cursor-subscription': { kind: 'cursor-sdk', apiKey: 'cursor-secret' }
      },
      providerIds: new Set(['cursor-subscription']),
      defaultIsCursor: false,
      defaultModel: 'auto',
      defaultApprovalPolicy: 'always',
      defaultSandboxMode: 'workspace-write',
      systemPrompt: 'Kun canonical system prompt',
      threadStore: { get: async () => thread } as never,
      sessionStore: {
        loadItems: async () => [
          runtimeSource('turn_old', oldHostControl),
          runtimeSource('turn_1', currentHostControl),
          userItem
        ],
        loadEventsSince: async () => []
      } as never,
      turns: {
        applyItem: async () => undefined,
        updateItem: async () => undefined,
        updateTurnMetadata: async (_threadId: string, _turnId: string, metadata: unknown) => {
          updatedMetadata.push(metadata)
        },
        finishTurn: async () => undefined
      } as never,
      events: {
        record: async (event: unknown) => {
          recorded.push(event)
          return event
        }
      } as never,
      ids: { next: (prefix) => `${prefix}_1` },
      debugSink,
      approvalGate,
      instructionRuntime: {
        resolveTurn: async () => ({
          instruction: 'Workspace AGENTS.md instruction',
          sources: [{ kind: 'workspace', path: '/tmp/cursor-bridge/AGENTS.md' }],
          injectedBytes: 31
        })
      } as never,
      loadSdk: async () => sdk
    } satisfies CursorSdkRuntimeFactoryDeps)

    await expect(runtime.runTurn(
      'thread_1',
      'turn_1',
      new AbortController().signal,
      'cursor-subscription'
    )).resolves.toBe('completed')

    const customTools = createOptions[0]?.local?.customTools
    expect(Object.keys(customTools ?? {}).sort()).toEqual([
      'extension_render',
      'mcp_call_tool'
    ])
    expect(String(sentMessages[0])).toContain('Kun canonical system prompt')
    expect(String(sentMessages[0])).toContain('Thread persona')
    expect(String(sentMessages[0])).toContain(
      '<kun_context_block kind="persona" authority="user">'
    )
    expect(String(sentMessages[0])).toContain('Write with a precise editorial voice.')
    expect(String(sentMessages[0])).toContain(
      '<kun_context_block kind="host-control" authority="runtime">'
    )
    expect(String(sentMessages[0])).toContain(currentHostControl)
    expect(String(sentMessages[0])).not.toContain(oldHostControl)
    expect(JSON.stringify(createOptions[0])).not.toContain(currentHostControl)
    expect(String(sentMessages[0])).toContain('Workspace AGENTS.md instruction')
    expect(String(sentMessages[0])).toContain('Prefer Cursor built-in tools')
    expect(String(sentMessages[0])).toContain('Kun-managed capabilities are available')
    expect(updatedMetadata).toContainEqual(expect.objectContaining({
      instructionInjectionBytes: 31
    }))

    expect(bridgedToolResult).toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({ server: 'docs', ok: true }, null, 2)
      }]
    })
    expect(executeSpy).toHaveBeenCalled()
    expect(executeSpy.mock.calls[0]?.[0]).toMatchObject({
      toolName: 'mcp_call_tool',
      providerId: 'mcp:facade',
      toolKind: 'tool_call',
      callId: 'cursor-mcp-call'
    })
    await expect(customTools?.mcp_call_tool?.execute(
      { serverId: 'late' },
      { toolCallId: 'cursor-late-call' }
    )).resolves.toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'tool call aborted before start' }]
    })
    expect(mcpExecute).toHaveBeenCalledWith(
      { serverId: 'docs' },
      expect.objectContaining({
        threadId: 'thread_1',
        turnId: 'turn_1',
        workspace: '/tmp/cursor-bridge',
        approvalPolicy: 'always',
        sandboxMode: 'workspace-write'
      }),
      expect.any(Function)
    )
    expect(approvalGate.request).toHaveBeenCalled()
    expect(recorded).toContainEqual(expect.objectContaining({
      kind: 'approval_requested',
      toolName: 'mcp_call_tool'
    }))
    expect(recorded).toContainEqual(expect.objectContaining({
      kind: 'delegated_runtime',
      capabilities: expect.objectContaining({
        kunTools: true,
        externalApproval: true
      })
    }))

    const trace = debugSink.snapshot()[0]?.exchanges[0]
    expect(trace?.request?.body.text).not.toContain(currentHostControl)
    expect(trace?.request?.body.text).toContain('[REDACTED]')
    expect(trace?.toolCatalog).toEqual(expect.arrayContaining([
      {
        name: 'mcp_call_tool',
        providerId: 'mcp:facade',
        providerKind: 'mcp'
      },
      {
        name: 'extension_render',
        providerId: 'extension:demo',
        providerKind: 'extension'
      }
    ]))
  })


})

function runtimeSource(turnId: string, content: string) {
  return {
    id: `item-${turnId}`,
    threadId: 'thread_1',
    turnId,
    role: 'system' as const,
    status: 'completed' as const,
    createdAt: '2026-07-25T00:00:00.000Z',
    kind: 'runtime_context_source' as const,
    contextKind: 'host-control' as const,
    content
  }
}
