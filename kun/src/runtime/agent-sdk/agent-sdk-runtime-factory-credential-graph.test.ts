import { describe, expect, test, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentSdkRuntime, resolveTurnPlanContext, waitForGate } from './agent-sdk-runtime-factory.js'
import { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type { UserInputGate, UserInputRequest, UserInputResolution } from '../../ports/user-input-gate.js'
import { InstructionRuntime } from '../../instructions/instruction-runtime.js'
import { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'
import { InMemoryApprovalGate } from '../../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../../adapters/in-memory-user-input-gate.js'
import { goalContextKey } from '../../loop/continuation-instructions.js'
import type { TurnRunOutcome } from '../../loop/turn-execution-types.js'
import {
  DelegatedSessionCoordinator,
  FileDelegatedSessionBindingStore,
  type DelegatedSessionPreparation
} from '../delegated-session-binding.js'

function fakeGate(pending: Promise<UserInputResolution>): {
  gate: UserInputGate
  resolvedWith: UserInputResolution[]
} {
  const resolvedWith: UserInputResolution[] = []
  const gate = {
    request: () => pending,
    resolve: (_id: string, resolution: UserInputResolution) => {
      resolvedWith.push(resolution)
      return true
    },
    get: () => undefined,
    pending: () => []
  } as unknown as UserInputGate
  return { gate, resolvedWith }
}

const req: UserInputRequest = { id: 'in1', threadId: 'th', turnId: 'tn', itemId: 'it1', prompt: 'pick', questions: [] }

function threadWith(partial: Partial<ThreadRecord>): ThreadRecord {
  const thread = {
    id: 'th',
    title: 't',
    workspace: '/ws',
    model: 'claude-haiku-4-5',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    approvalReviewer: 'user',
    relation: 'primary',
    createdAt: '2026-06-27T00:00:00Z',
    updatedAt: '2026-06-27T00:00:00Z',
    turns: [{ id: 'tn', prompt: 'test turn' } as ThreadRecord['turns'][number]],
    ...partial
  } as ThreadRecord
  return {
    ...thread,
    turns: thread.turns.map((turn) => ({
      actingModelRoute: {
        model: turn.model?.trim() || thread.model,
        ...(turn.providerId?.trim() || thread.providerId?.trim()
          ? { providerId: turn.providerId?.trim() || thread.providerId?.trim() }
          : {}),
        ...(turn.accountId?.trim() || thread.accountId?.trim()
          ? { accountId: turn.accountId?.trim() || thread.accountId?.trim() }
          : {})
      },
      approvalReviewer: turn.approvalReviewer ?? thread.approvalReviewer ?? 'user',
      ...turn
    }))
  } as ThreadRecord
}

const planTurn = (id: string, workspaceRoot: string): ThreadRecord['turns'][number] =>
  ({
    id,
    prompt: 'plan it',
    guiPlan: { operation: 'draft', workspaceRoot, relativePath: '.kun/plan.md', planId: 'p1' }
  }) as ThreadRecord['turns'][number]

// handlesProvider only reads providerConfigs / agentSdkProviderIds / defaultIsAgentSdk,
// so the heavy service deps can be stubbed for this routing test.
function make(opts: { agentSdk: string[]; http: string[]; defaultIsAgentSdk: boolean }): {
  handlesProvider(id: string | undefined): boolean
} {
  const providerConfigs: Record<string, { baseUrl?: string; apiKey: string; kind?: 'http' | 'agent-sdk' }> = {}
  for (const id of opts.agentSdk) {
    providerConfigs[id] = { kind: 'agent-sdk', apiKey: 'sk-ant-oat01-tok' }
  }
  for (const id of opts.http) providerConfigs[id] = { baseUrl: 'https://x', apiKey: 'key' }
  return createAgentSdkRuntime({
    registry: {} as never,
    turns: {} as never,
    sessionStore: {} as never,
    threadStore: {} as never,
    events: {} as never,
    ids: { next: (p: string) => p },
    prefix: { systemPrompt: '' },
    providerConfigs: providerConfigs as never,
    agentSdkProviderIds: new Set(opts.agentSdk),
    defaultApprovalPolicy: 'auto',
    defaultIsAgentSdk: opts.defaultIsAgentSdk,
    defaultToken: 'sk-ant-oat01-tok'
  })
}

describe('createAgentSdkRuntime turn context', () => {
  type CredentialContextOptions = {
    providerId?: string
    providerToken?: string
    defaultToken?: string
    credentialSourceId?: string
    defaultIsAgentSdk?: boolean
    resolveCredentialSource?: (sourceId: string) => Promise<{ apiKey: string } | null>
  }
  type CredentialContext = {
    oauthToken?: string
    actingModelRoute?: {
      model: string
      providerId?: string
      accountId?: string
    }
  } | null
  const credentialContextLoader = (options: CredentialContextOptions): (() => Promise<CredentialContext>) => {
    const runtime = createAgentSdkRuntime({
      registry: CapabilityRegistry.fromLocalTools([]),
      turns: { updateTurnMetadata: async () => undefined } as never,
      sessionStore: {
        loadItems: async () => [{
          id: 'item_user',
          turnId: 'tn',
          threadId: 'th',
          kind: 'user_message',
          role: 'user',
          status: 'completed',
          text: 'check credentials',
          createdAt: '2026-07-25T00:00:00.000Z'
        }]
      } as never,
      threadStore: {
        get: async () => threadWith({
          ...(options.providerId ? { providerId: options.providerId } : {}),
          turns: [{
            id: 'tn',
            prompt: 'check credentials',
            // Exercise first-resolution behavior rather than the test helper's
            // synthesized legacy route snapshot.
            actingModelRoute: undefined
          } as ThreadRecord['turns'][number]]
        })
      } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: 'Kun system prompt' },
      providerConfigs: options.providerId
        ? {
            [options.providerId]: {
              kind: 'agent-sdk',
              apiKey: options.providerToken ?? '',
              ...(options.credentialSourceId
                ? { credentialSourceId: options.credentialSourceId }
                : {})
            }
          } as never
        : {},
      agentSdkProviderIds: new Set(options.providerId ? [options.providerId] : []),
      defaultApprovalPolicy: 'auto',
      defaultIsAgentSdk: options.defaultIsAgentSdk ?? !options.providerId,
      defaultToken: options.defaultToken,
      ...(options.credentialSourceId && !options.providerId
        ? { defaultCredentialSourceId: options.credentialSourceId }
        : {}),
      ...(options.resolveCredentialSource
        ? { resolveCredentialSource: options.resolveCredentialSource }
        : {})
    })
    const deps = (runtime as unknown as {
      deps: {
        loadTurnContext(
          threadId: string,
          turnId: string
        ): Promise<{
          oauthToken?: string
          actingModelRoute?: {
            model: string
            providerId?: string
            accountId?: string
          }
        } | null>
      }
    }).deps
    return () => deps.loadTurnContext('th', 'tn')
  }
  const credentialContext = (options: CredentialContextOptions): Promise<CredentialContext> =>
    credentialContextLoader(options)()

  test('keeps an explicit Claude provider on ambient login instead of inheriting the default token', async () => {
    const context = await credentialContext({
      providerId: 'claude-subscription',
      providerToken: '',
      defaultToken: 'sk-ant-oat01-unrelated-provider'
    })
    expect(context?.oauthToken).toBeUndefined()
  })

  test('uses the default token only for the implicit default Agent SDK route', async () => {
    const context = await credentialContext({
      defaultToken: 'sk-ant-oat01-default-agent-sdk'
    })
    expect(context?.oauthToken).toBe('sk-ant-oat01-default-agent-sdk')
    expect(context?.actingModelRoute).toMatchObject({
      providerId: 'default'
    })
  })

  test('a harness-pinned native-login turn on a mixed runtime uses ambient login', async () => {
    // The serve apiKey is an HTTP provider credential here (e.g. DeepSeek);
    // routing it into CLAUDE_CODE_OAUTH_TOKEN both crashes OAuth normalization
    // and would silently swap the account detection reported.
    const context = await credentialContext({
      defaultToken: 'sk-ant-oat01-unrelated-serve-key',
      defaultIsAgentSdk: false
    })
    expect(context?.oauthToken).toBeUndefined()
    expect(context?.actingModelRoute?.providerId).toBeUndefined()
  })

  test('persists an active goal context before assembling delegated history', async () => {
    const createdAt = '2026-08-06T00:00:00.000Z'
    const goal = {
      threadId: 'th',
      objective: 'Finish the migration safely.',
      status: 'active' as const,
      tokenBudget: 10_000,
      tokensUsed: 250,
      timeUsedSeconds: 12,
      createdAt,
      updatedAt: createdAt
    }
    const sessionItems = [{
      id: 'item_user',
      turnId: 'tn',
      threadId: 'th',
      kind: 'user_message',
      role: 'user',
      status: 'completed',
      text: 'continue the migration',
      createdAt
    }]
    const loadItems = vi.fn(async () => sessionItems)
    const ensureGoalContext = vi.fn(async () => {
      sessionItems.push({
        id: 'item_tn_goal_context',
        turnId: 'tn',
        threadId: 'th',
        kind: 'goal_context',
        role: 'system',
        status: 'completed',
        goalKey: goalContextKey(goal)!,
        text: 'Finish the migration safely.',
        createdAt
      } as never)
    })
    const runtime = createAgentSdkRuntime({
      registry: CapabilityRegistry.fromLocalTools([]),
      turns: {
        updateTurnMetadata: async () => undefined,
        ensureGoalContext
      } as never,
      sessionStore: { loadItems } as never,
      threadStore: {
        get: async () => threadWith({
          goal
        })
      } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: 'Kun system prompt' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      defaultIsAgentSdk: true
    })
    const deps = (runtime as unknown as {
      deps: {
        loadTurnContext(threadId: string, turnId: string): Promise<{
          historyTranscript?: string
          contextInstructions?: string[]
          redactedRequestValues?: string[]
        } | null>
      }
    }).deps

    const context = await deps.loadTurnContext('th', 'tn')

    expect(ensureGoalContext).toHaveBeenCalledWith('th', 'tn', undefined)
    expect(loadItems).toHaveBeenCalledTimes(2)
    expect(context?.historyTranscript).toContain('[active goal] Finish the migration safely.')
    expect(context?.redactedRequestValues).toEqual(['Finish the migration safely.'])
    expect(context?.contextInstructions?.join('\n')).not.toContain(
      'Continue working toward the active thread goal.'
    )
  })

  test('re-resolves a managed Claude credential for every turn on the same Runtime', async () => {
    let authoritativeToken = ''
    const resolveCredentialSource = vi.fn(async (sourceId: string) =>
      authoritativeToken ? { apiKey: authoritativeToken } : null)
    const load = credentialContextLoader({
      providerId: 'claude-subscription',
      providerToken: 'sk-ant-oat01-stale-constructor-token',
      credentialSourceId: 'model-connection:claude-subscription',
      resolveCredentialSource
    })

    await expect(load()).rejects.toMatchObject({
      code: 'agent_sdk_credential_unavailable'
    })
    authoritativeToken = 'sk-ant-oat01-authoritative-token'
    await expect(load()).resolves.toMatchObject({
      oauthToken: 'sk-ant-oat01-authoritative-token'
    })
    expect(resolveCredentialSource).toHaveBeenNthCalledWith(
      1,
      'model-connection:claude-subscription'
    )
    expect(resolveCredentialSource).toHaveBeenNthCalledWith(
      2,
      'model-connection:claude-subscription'
    )
  })

  test('rejects an invalid explicit token without disclosing it', async () => {
    const raw = 'Bearer sk-ant-oat01-private-value'
    const loading = credentialContext({
      providerId: 'claude-subscription',
      providerToken: raw
    })
    await expect(loading).rejects.toThrow('Claude subscription token format is invalid')
    await loading.catch((error) => {
      expect(String(error)).not.toContain('sk-ant-oat01-private-value')
    })
  })

  test('prepares lazy extension tools and preserves MCP/extension provenance', async () => {
    const extensionExecute = vi.fn(async () => ({ output: 'extension result' }))
    const registry = new CapabilityRegistry([{
      id: 'mcp:docs',
      kind: 'mcp',
      enabled: true,
      available: true,
      tools: [LocalToolHost.defineTool({
        name: 'mcp_docs_lookup',
        description: 'Look up MCP docs',
        inputSchema: { type: 'object' },
        sideEffect: 'read-only',
        execute: async () => ({ output: 'mcp result' })
      })]
    }])
    let prepared = false
    const host = new LocalToolHost({
      registry,
      prepare: () => {
        if (prepared) return
        prepared = true
        registry.registerProvider({
          id: 'extension:demo',
          kind: 'extension',
          enabled: true,
          available: true,
          tools: [LocalToolHost.defineTool({
            name: 'extension_render',
            description: 'Render with an extension',
            inputSchema: { type: 'object' },
            sideEffect: 'read-only',
            execute: extensionExecute
          })]
        })
      }
    })
    const runtime = createAgentSdkRuntime({
      registry,
      toolHost: host,
      turns: { updateTurnMetadata: async () => undefined } as never,
      sessionStore: {
        loadItems: async () => [{
          id: 'item_user',
          turnId: 'tn',
          threadId: 'th',
          kind: 'user_message',
          role: 'user',
          status: 'completed',
          text: 'use the configured tools',
          createdAt: '2026-07-25T00:00:00.000Z'
        }]
      } as never,
      threadStore: {
        get: async () => threadWith({
          providerId: 'claude-subscription',
          turns: [{ id: 'tn', prompt: 'use the configured tools' } as ThreadRecord['turns'][number]]
        })
      } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: 'Kun system prompt' },
      providerConfigs: {
        'claude-subscription': { kind: 'agent-sdk', apiKey: 'sk-ant-oat01-tok' }
      } as never,
      agentSdkProviderIds: new Set(['claude-subscription']),
      defaultApprovalPolicy: 'auto'
    })
    const deps = (runtime as unknown as {
      deps: {
        loadTurnContext(threadId: string, turnId: string): Promise<{
          bridgeableTools: Array<{
            name: string
            providerId?: string
            providerKind?: string
          }>
          contextInstructions?: string[]
        } | null>
        executeKunTool(
          threadId: string,
          turnId: string,
          toolName: string,
          args: Record<string, unknown>
        ): Promise<{ output: unknown; isError?: boolean }>
      }
    }).deps

    const context = await deps.loadTurnContext('th', 'tn')
    expect(context?.bridgeableTools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'mcp_docs_lookup',
        providerId: 'mcp:docs',
        providerKind: 'mcp'
      }),
      expect.objectContaining({
        name: 'extension_render',
        providerId: 'extension:demo',
        providerKind: 'extension'
      })
    ]))
    expect(context?.contextInstructions?.join('\n')).toContain(
      'Kun-managed capabilities are available through the mcp__kun__ tools.'
    )
    await expect(deps.executeKunTool('th', 'tn', 'extension_render', {})).resolves.toEqual({
      output: 'extension result',
      isError: false
    })
    expect(extensionExecute).toHaveBeenCalledOnce()
  })

  test('uses the bounded Graph catalog and disables SDK built-ins across planning and supervision', async () => {
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
    const host = new LocalToolHost({ registry })
    const graphTurn = {
      id: 'tn',
      prompt: 'plan with Graph',
      orchestration: 'graph',
      graphPlanningLifecycle: {
        version: 1,
        draftId: 'draft_1',
        reservedRunId: 'run_1',
        state: 'planning',
        draftRevision: 1
      }
    } as ThreadRecord['turns'][number]
    const thread = threadWith({
      providerId: 'claude-subscription',
      turns: [graphTurn]
    })
    const runtime = createAgentSdkRuntime({
      registry,
      toolHost: host,
      turns: { updateTurnMetadata: async () => undefined } as never,
      sessionStore: {
        loadItems: async () => [{
          id: 'item_user',
          turnId: 'tn',
          threadId: 'th',
          kind: 'user_message',
          role: 'user',
          status: 'completed',
          text: 'plan with Graph',
          createdAt: '2026-07-30T00:00:00.000Z'
        }]
      } as never,
      threadStore: { get: async () => thread } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: 'Kun system prompt' },
      providerConfigs: {
        'claude-subscription': { kind: 'agent-sdk', apiKey: 'sk-ant-oat01-token' }
      } as never,
      agentSdkProviderIds: new Set(['claude-subscription']),
      defaultApprovalPolicy: 'auto'
    })
    const deps = (runtime as unknown as {
      deps: {
        loadTurnContext(threadId: string, turnId: string): Promise<{
          bridgeableTools: Array<{ name: string }>
          allowSdkBuiltins?: boolean
          bridgeKunBuiltinOverlaps?: boolean
          graphPhase?: 'planning' | 'supervising'
          contextInstructions?: string[]
        } | null>
        executeKunTool(
          threadId: string,
          turnId: string,
          toolName: string,
          args: Record<string, unknown>
        ): Promise<{ output: unknown; isError?: boolean }>
      }
    }).deps

    const planning = await deps.loadTurnContext('th', 'tn')
    expect(planning).toMatchObject({
      allowSdkBuiltins: false,
      bridgeKunBuiltinOverlaps: true,
      graphPhase: 'planning'
    })
    expect(planning?.bridgeableTools.map((tool) => tool.name).sort()).toEqual([
      'graph_define_plan',
      'read'
    ])
    expect(planning?.contextInstructions?.join('\n')).toContain(
      'Graph Mode: source Lead operating contract'
    )
    await expect(deps.executeKunTool('th', 'tn', 'write', {})).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining('active tool policy')
    })

    const incompleteRaw = '{"plan":{"title":"truncated"'
    await expect(deps.executeKunTool(
      'th',
      'tn',
      'graph_define_plan',
      { __raw: incompleteRaw }
    )).resolves.toEqual({
      output: {
        code: 'graph_plan_invalid',
        retryable: true,
        receivedArguments: { __raw: incompleteRaw }
      },
      isError: true
    })
    expect(graphDefinePlan).toHaveBeenLastCalledWith(
      { __raw: incompleteRaw },
      expect.objectContaining({ threadId: 'th', turnId: 'tn' }),
      expect.any(Function)
    )

    const correctedArguments = {
      plan: {
        title: 'Bounded Graph plan',
        tasks: [{ id: 'task_1', objective: 'Apply the requested change' }]
      }
    }
    await expect(deps.executeKunTool(
      'th',
      'tn',
      'graph_define_plan',
      { __raw: JSON.stringify(correctedArguments) }
    )).resolves.toEqual({
      output: {
        status: 'committed',
        receivedArguments: correctedArguments
      },
      isError: false
    })
    expect(graphDefinePlan).toHaveBeenLastCalledWith(
      correctedArguments,
      expect.objectContaining({ threadId: 'th', turnId: 'tn' }),
      expect.any(Function)
    )

    thread.turns[0]!.graphPlanningLifecycle = {
      ...thread.turns[0]!.graphPlanningLifecycle!,
      state: 'committed',
      draftRevision: 2
    }
    const supervising = await deps.loadTurnContext('th', 'tn')
    expect(supervising?.graphPhase).toBe('supervising')
    expect(supervising?.bridgeableTools.map((tool) => tool.name).sort()).toEqual([
      'graph_review_node',
      'read'
    ])
  })


})
