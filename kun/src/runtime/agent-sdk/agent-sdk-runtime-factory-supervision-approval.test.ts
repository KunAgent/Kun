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
      defaultIsAgentSdk: !options.providerId,
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

  test('parks a completed SDK response when the same Graph Lead turn is still supervising', async () => {
    const clearTurnActivation = vi.fn()
    const finishTurn = vi.fn(async () => undefined)
    const suspendGraphLeadTurn = vi.fn(async () => 'suspended' as const)
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: { finishTurn, suspendGraphLeadTurn } as never,
      sessionStore: {} as never,
      threadStore: {} as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      skillRuntime: { clearTurnActivation } as never
    })
    const runtimeDeps = (runtime as unknown as {
      deps: {
        finishTurn(
          threadId: string,
          turnId: string,
          status: 'completed' | 'failed' | 'aborted',
          error?: string
        ): Promise<TurnRunOutcome>
      }
    }).deps

    await expect(runtimeDeps.finishTurn(
      'thread_1',
      'turn_1',
      'completed'
    )).resolves.toBe('suspended')

    expect(finishTurn).not.toHaveBeenCalled()
    expect(clearTurnActivation).toHaveBeenCalledWith('thread_1', 'turn_1')
  })

  test('parks prose-only SDK completion while a Graph node still awaits Lead review', async () => {
    const finishTurn = vi.fn(async () => undefined)
    const suspendGraphLeadTurn = vi.fn()
      .mockResolvedValueOnce('supervision_pending')
      .mockResolvedValueOnce('suspended_pending_supervision')
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: { finishTurn, suspendGraphLeadTurn } as never,
      sessionStore: {} as never,
      threadStore: {} as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto'
    })
    const runtimeDeps = (runtime as unknown as {
      deps: {
        finishTurn(
          threadId: string,
          turnId: string,
          status: 'completed' | 'failed' | 'aborted',
          error?: string
        ): Promise<TurnRunOutcome>
      }
    }).deps

    await expect(runtimeDeps.finishTurn(
      'thread_1',
      'turn_1',
      'completed'
    )).resolves.toBe('suspended_pending_supervision')

    expect(suspendGraphLeadTurn).toHaveBeenNthCalledWith(1, {
      threadId: 'thread_1',
      turnId: 'turn_1'
    })
    expect(suspendGraphLeadTurn).toHaveBeenNthCalledWith(2, {
      threadId: 'thread_1',
      turnId: 'turn_1',
      force: true,
      preserveDeliveryCursor: true,
      allowPendingSupervision: true
    })
    expect(finishTurn).not.toHaveBeenCalled()
  })

  test('does not fall back to the process workspace when a thread or turn has disappeared', async () => {
    const runtime = createAgentSdkRuntime({
      registry: {
        resolveTool: () => {
          throw new Error('a stale turn must not resolve a tool')
        }
      } as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: { get: async () => null } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto'
    })
    const deps = (runtime as unknown as {
      deps: {
        loadTurnContext(threadId: string, turnId: string): Promise<unknown>
        executeKunTool(
          threadId: string,
          turnId: string,
          toolName: string,
          args: Record<string, unknown>,
          signal?: AbortSignal
        ): Promise<{ output: unknown; isError: boolean }>
      }
    }).deps

    await expect(deps.loadTurnContext('deleted-thread', 'deleted-turn')).resolves.toBeNull()
    await expect(deps.executeKunTool(
      'deleted-thread',
      'deleted-turn',
      'bash',
      {},
      new AbortController().signal
    )).resolves.toEqual({
      output: 'turn is no longer active; tool execution was cancelled',
      isError: true
    })
  })

  test('runs bridged Kun tools through the canonical host policy boundary', async () => {
    const executed: string[] = []
    const tools = [
      LocalToolHost.defineTool({
        name: 'approval_required',
        description: 'Requires approval',
        inputSchema: { type: 'object', properties: {} },
        policy: 'on-request',
        toolKind: 'command_execution',
        execute: async () => {
          executed.push('approval_required')
          return { output: 'should not execute' }
        }
      }),
      LocalToolHost.defineTool({
        name: 'disabled_tool',
        description: 'Disabled',
        inputSchema: { type: 'object', properties: {} },
        policy: 'never',
        execute: async () => {
          executed.push('disabled_tool')
          return { output: 'should not execute' }
        }
      })
    ]
    const registry = CapabilityRegistry.fromLocalTools(tools)
    const runtime = createAgentSdkRuntime({
      registry,
      toolHost: new LocalToolHost({ registry }),
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: {
        get: async () => threadWith({
          workspace: '/ws',
          approvalPolicy: 'on-request',
          turns: [{ id: 'tn', prompt: 'run tool' } as ThreadRecord['turns'][number]]
        })
      } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'on-request'
    })
    const deps = (runtime as unknown as {
      deps: {
        executeKunTool(
          threadId: string,
          turnId: string,
          toolName: string,
          args: Record<string, unknown>
        ): Promise<{ output: unknown; isError?: boolean }>
      }
    }).deps

    await expect(deps.executeKunTool('th', 'tn', 'approval_required', {})).resolves.toMatchObject({
      isError: true,
      output: expect.objectContaining({ code: 'approval_denied' })
    })
    await expect(deps.executeKunTool('th', 'tn', 'disabled_tool', {})).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining('disabled by policy')
    })
    expect(executed).toEqual([])
  })

  test('gives concurrent bridged calls distinct approval identities', async () => {
    const approvalGate = new InMemoryApprovalGate()
    const executed: string[] = []
    const registry = CapabilityRegistry.fromLocalTools([
      LocalToolHost.defineTool({
        name: 'approval_required',
        description: 'Requires approval',
        inputSchema: { type: 'object', properties: {} },
        policy: 'on-request',
        toolKind: 'command_execution',
        execute: async () => {
          executed.push('approval_required')
          return { output: 'executed' }
        }
      })
    ])
    let nextId = 0
    const runtime = createAgentSdkRuntime({
      registry,
      toolHost: new LocalToolHost({ registry }),
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: {
        get: async () => threadWith({
          workspace: '/ws',
          approvalPolicy: 'on-request',
          turns: [{ id: 'tn', prompt: 'run tool' } as ThreadRecord['turns'][number]]
        })
      } as never,
      events: { record: async () => undefined } as never,
      ids: { next: (prefix) => `${prefix}_${++nextId}` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'on-request',
      approvalGate
    })
    const deps = (runtime as unknown as {
      deps: {
        executeKunTool(
          threadId: string,
          turnId: string,
          toolName: string,
          args: Record<string, unknown>
        ): Promise<{ output: unknown; isError?: boolean }>
      }
    }).deps

    const first = deps.executeKunTool('th', 'tn', 'approval_required', {})
    const second = deps.executeKunTool('th', 'tn', 'approval_required', {})

    await vi.waitFor(() => {
      expect(approvalGate.pending('th')).toHaveLength(2)
    })
    const approvals = approvalGate.pending('th')
    expect(new Set(approvals.map((approval) => approval.id)).size).toBe(2)
    for (const approval of approvals) approvalGate.decide(approval.id, 'allow')

    await expect(Promise.all([first, second])).resolves.toEqual([
      { output: 'executed', isError: false },
      { output: 'executed', isError: false }
    ])
    expect(executed).toEqual(['approval_required', 'approval_required'])
  })

  test('uses the thread approval policy to gate SDK built-in tools', async () => {
    const events: Array<{ kind: string; approvalPolicy?: string }> = []
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: { get: async () => threadWith({ approvalPolicy: 'always' }) } as never,
      events: { record: async (event: { kind: string; approvalPolicy?: string }) => { events.push(event) } } as never,
      ids: { next: (prefix) => `${prefix}_1` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      approvalGate: {
        request: async () => 'allow', decide: () => false, pending: () => [], get: () => undefined
      } as never
    })
    const deps = (runtime as unknown as {
      deps: {
        decideToolApproval(threadId: string, turnId: string, toolName: string, input: Record<string, unknown>): Promise<{ allow: boolean }>
      }
    }).deps

    await expect(deps.decideToolApproval('th', 'tn', 'Bash', { command: 'pwd' })).resolves.toEqual({ allow: true })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'approval_requested', approvalPolicy: 'always' }))
  })

  test.each([
    { decision: 'allow' as const, reviewStatus: 'approved' as const, allow: true },
    { decision: 'deny' as const, reviewStatus: 'denied' as const, allow: false }
  ])('routes native SDK commands through agent review ($decision)', async ({
    decision,
    reviewStatus,
    allow
  }) => {
    const approvalGate = new InMemoryApprovalGate()
    const gateRequest = vi.spyOn(approvalGate, 'request')
    const review = vi.fn(async () => ({
      decision,
      reviewer: 'agent' as const,
      reviewId: 'review_sdk',
      reviewStatus,
      riskLevel: decision === 'allow' ? 'low' as const : 'high' as const,
      reason: decision === 'allow'
        ? 'Command matches the initiating intent.'
        : 'Command is broader than the initiating intent.'
    }))
    const record = vi.fn(async () => undefined)
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: {
        get: async () => threadWith({
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          approvalReviewer: 'agent',
          providerId: 'selected-provider',
          accountId: 'selected-account',
          turns: [{
            id: 'tn',
            prompt: 'Run the tests',
            model: 'selected-model',
            providerId: 'selected-provider',
            accountId: 'selected-account',
            approvalReviewer: 'agent',
            actingModelRoute: {
              model: 'selected-model',
              providerId: 'selected-provider',
              accountId: 'selected-account'
            }
          } as ThreadRecord['turns'][number]]
        })
      } as never,
      events: { record } as never,
      ids: { next: (prefix) => `${prefix}_sdk` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'on-request',
      defaultSandboxMode: 'workspace-write',
      defaultApprovalReviewer: 'agent',
      approvalGate,
      approvalReview: { review }
    })
    const deps = (runtime as unknown as {
      deps: {
        decideToolApproval(
          threadId: string,
          turnId: string,
          toolName: string,
          input: Record<string, unknown>
        ): Promise<{ allow: boolean; message?: string }>
      }
    }).deps

    await expect(deps.decideToolApproval(
      'th',
      'tn',
      'Bash',
      { command: 'npm test', apiKey: 'sk-sdk-secret-abcdefghijklmnop' }
    )).resolves.toMatchObject({
      allow,
      ...(allow
        ? {}
        : { message: 'Command is broader than the initiating intent.' })
    })
    expect(review).toHaveBeenCalledWith(expect.objectContaining({
      route: {
        model: 'selected-model',
        providerId: 'selected-provider',
        accountId: 'selected-account'
      },
      intent: 'Run the tests',
      approval: expect.objectContaining({
        toolName: 'Bash',
        action: expect.objectContaining({
          kind: 'command',
          arguments: expect.objectContaining({
            command: 'npm test',
            apiKey: '[redacted]'
          })
        })
      })
    }))
    expect(JSON.stringify(review.mock.calls)).not.toContain('sk-sdk-secret')
    expect(gateRequest).not.toHaveBeenCalled()
    expect(approvalGate.pending()).toEqual([])
    expect(record).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: 'approval_requested'
    }))
  })

  test.each(['Read', 'Glob', 'Grep'])(
    'does not review SDK-native safe tool %s under on-request policy',
    async (toolName) => {
      const approvalGate = new InMemoryApprovalGate()
      const gateRequest = vi.spyOn(approvalGate, 'request')
      const review = vi.fn()
      const record = vi.fn()
      const runtime = createAgentSdkRuntime({
        registry: {} as never,
        turns: {} as never,
        sessionStore: {} as never,
        threadStore: {
          get: async () => threadWith({
            approvalPolicy: 'on-request',
            sandboxMode: 'workspace-write',
            approvalReviewer: 'agent',
            turns: [{
              id: 'tn',
              prompt: 'Inspect the workspace',
              model: 'selected-model',
              approvalPolicy: 'on-request',
              sandboxMode: 'workspace-write',
              approvalReviewer: 'agent',
              actingModelRoute: {
                model: 'selected-model',
                providerId: 'selected-provider',
                accountId: 'selected-account'
              }
            } as ThreadRecord['turns'][number]]
          })
        } as never,
        events: { record } as never,
        ids: { next: (prefix) => `${prefix}_safe` },
        prefix: { systemPrompt: '' },
        providerConfigs: {},
        agentSdkProviderIds: new Set(),
        defaultApprovalPolicy: 'on-request',
        defaultSandboxMode: 'workspace-write',
        defaultApprovalReviewer: 'agent',
        approvalGate,
        approvalReview: { review } as never
      })
      const deps = (runtime as unknown as {
        deps: {
          decideToolApproval(
            threadId: string,
            turnId: string,
            toolName: string,
            input: Record<string, unknown>
          ): Promise<{ allow: boolean; message?: string }>
        }
      }).deps

      await expect(deps.decideToolApproval(
        'th',
        'tn',
        toolName,
        toolName === 'Glob' ? { pattern: '**/*.ts' } : { file_path: '/tmp/file.ts' }
      )).resolves.toEqual({ allow: true })
      expect(review).not.toHaveBeenCalled()
      expect(gateRequest).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    }
  )


})
