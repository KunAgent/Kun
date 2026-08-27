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

  test('lets native SDK tools run in Full access without any Kun approval lifecycle', async () => {
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
          approvalPolicy: 'auto',
          sandboxMode: 'danger-full-access',
          approvalReviewer: 'agent'
        })
      } as never,
      events: { record } as never,
      ids: { next: (prefix) => `${prefix}_full` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      defaultSandboxMode: 'danger-full-access',
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
        ): Promise<{ allow: boolean }>
      }
    }).deps

    await expect(deps.decideToolApproval(
      'th',
      'tn',
      'Bash',
      { command: 'pwd' }
    )).resolves.toEqual({ allow: true })
    expect(review).not.toHaveBeenCalled()
    expect(gateRequest).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  test('requires approval for SDK Bash under auto workspace-write policy', async () => {
    const events: Array<{ kind: string; approvalPolicy?: string; sandboxMode?: string }> = []
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: {
        get: async () => threadWith({
          approvalPolicy: 'auto',
          sandboxMode: 'workspace-write'
        })
      } as never,
      events: {
        record: async (event: { kind: string; approvalPolicy?: string; sandboxMode?: string }) => {
          events.push(event)
        }
      } as never,
      ids: { next: (prefix) => `${prefix}_workspace` },
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
        decideToolApproval(
          threadId: string,
          turnId: string,
          toolName: string,
          input: Record<string, unknown>
        ): Promise<{ allow: boolean }>
      }
    }).deps

    await expect(
      deps.decideToolApproval('th', 'tn', 'Bash', { command: 'pwd' })
    ).resolves.toEqual({ allow: true })
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'approval_requested',
      approvalPolicy: 'auto',
      sandboxMode: 'workspace-write'
    }))
  })

  test('arms SDK approvals before publishing approval_requested', async () => {
    const approvalGate = new InMemoryApprovalGate()
    let immediatelyAllowed = false
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: { get: async () => threadWith({ approvalPolicy: 'always' }) } as never,
      events: {
        record: async (event: { kind: string; approvalId?: string }) => {
          if (event.kind === 'approval_requested' && event.approvalId) {
            immediatelyAllowed = approvalGate.decide(event.approvalId, 'allow')
          }
        }
      } as never,
      ids: { next: (prefix) => `${prefix}_1` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      approvalGate
    })
    const deps = (runtime as unknown as {
      deps: {
        decideToolApproval(threadId: string, turnId: string, toolName: string, input: Record<string, unknown>): Promise<{ allow: boolean }>
      }
    }).deps

    await expect(deps.decideToolApproval('th', 'tn', 'Bash', { command: 'pwd' })).resolves.toEqual({ allow: true })
    expect(immediatelyAllowed).toBe(true)
  })

  test('aborts while approval_requested persistence is blocked and records one expired resolution', async () => {
    type ApprovalEvent = { kind: string; approvalId?: string; status?: string; reason?: string }
    const approvalGate = new InMemoryApprovalGate()
    const calls: ApprovalEvent[] = []
    const persisted: ApprovalEvent[] = []
    let releaseRequested!: () => void
    const requestedBarrier = new Promise<void>((resolve) => {
      releaseRequested = resolve
    })
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: { get: async () => threadWith({ approvalPolicy: 'always' }) } as never,
      events: {
        record: async (event: ApprovalEvent) => {
          calls.push(event)
          if (event.kind === 'approval_requested') await requestedBarrier
          persisted.push(event)
        }
      } as never,
      ids: { next: (prefix) => `${prefix}_1` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      approvalGate
    })
    const deps = (runtime as unknown as {
      deps: {
        decideToolApproval(
          threadId: string,
          turnId: string,
          toolName: string,
          input: Record<string, unknown>,
          signal?: AbortSignal
        ): Promise<{ allow: boolean }>
      }
    }).deps
    const controller = new AbortController()

    const waiting = deps.decideToolApproval('th', 'tn', 'Bash', { command: 'pwd' }, controller.signal)
    await vi.waitFor(() => {
      expect(calls).toContainEqual(expect.objectContaining({ kind: 'approval_requested' }))
      expect(approvalGate.pending('th')).toHaveLength(1)
    })
    const approval = approvalGate.pending('th')[0]
    if (!approval) throw new Error('expected a pending SDK approval')

    controller.abort()

    await expect(waiting).resolves.toMatchObject({ allow: false })
    expect(approvalGate.get(approval.id)).toMatchObject({
      status: 'expired',
      reason: 'turn aborted while awaiting approval'
    })
    expect(persisted).toEqual([])

    releaseRequested()
    await vi.waitFor(() => {
      expect(persisted.map((event) => event.kind)).toEqual([
        'approval_requested',
        'approval_resolved'
      ])
    })
    expect(persisted.filter((event) => event.kind === 'approval_resolved')).toEqual([
      expect.objectContaining({
        approvalId: approval.id,
        status: 'expired',
        reason: 'turn aborted while awaiting approval'
      })
    ])
  })

  test('consumes a delayed approval_requested failure after abort without publishing an orphan resolution', async () => {
    type ApprovalEvent = { kind: string; approvalId?: string; status?: string }
    const approvalGate = new InMemoryApprovalGate()
    const calls: ApprovalEvent[] = []
    let rejectRequested!: (error: Error) => void
    const requestedFailure = new Promise<never>((_resolve, reject) => {
      rejectRequested = reject
    })
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: { get: async () => threadWith({ approvalPolicy: 'always' }) } as never,
      events: {
        record: async (event: ApprovalEvent) => {
          calls.push(event)
          if (event.kind === 'approval_requested') await requestedFailure
        }
      } as never,
      ids: { next: (prefix) => `${prefix}_1` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      approvalGate
    })
    const deps = (runtime as unknown as {
      deps: {
        decideToolApproval(
          threadId: string,
          turnId: string,
          toolName: string,
          input: Record<string, unknown>,
          signal?: AbortSignal
        ): Promise<{ allow: boolean }>
      }
    }).deps
    const controller = new AbortController()

    const waiting = deps.decideToolApproval('th', 'tn', 'Bash', { command: 'pwd' }, controller.signal)
    await vi.waitFor(() => {
      expect(calls).toContainEqual(expect.objectContaining({ kind: 'approval_requested' }))
    })
    controller.abort()
    await expect(waiting).resolves.toMatchObject({ allow: false })

    rejectRequested(new Error('approval request persistence failed'))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(calls.filter((event) => event.kind === 'approval_resolved')).toEqual([])
  })

  test('denies SDK built-in tools under a thread never policy', async () => {
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: { get: async () => threadWith({ approvalPolicy: 'never' }) } as never,
      events: {} as never,
      ids: { next: (prefix) => `${prefix}_1` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto'
    })
    const deps = (runtime as unknown as {
      deps: {
        decideToolApproval(threadId: string, turnId: string, toolName: string, input: Record<string, unknown>): Promise<{ allow: boolean; message?: string }>
      }
    }).deps

    await expect(deps.decideToolApproval('th', 'tn', 'Bash', { command: 'pwd' })).resolves.toMatchObject({
      allow: false, message: expect.stringContaining('never')
    })
  })

  test('does not duplicate an HTTP-recorded user input resolution event', async () => {
    const events: Array<{ kind: string; inputId?: string }> = []
    const runtime = createAgentSdkRuntime({
      registry: {
        resolveTool: () => ({
          tool: {
            execute: async (_args: unknown, context: { awaitUserInput?: (input: {
              id: string; itemId: string; prompt: string; questions: []
            }) => Promise<unknown> }) => {
              await context.awaitUserInput?.({ id: 'in_sdk', itemId: 'item_sdk', prompt: 'Pick', questions: [] })
              return { output: {} }
            }
          }
        })
      } as never,
      toolHost: {
        id: 'test-host',
        listTools: async () => [],
        execute: async (_call: unknown, context: { awaitUserInput?: (input: {
          id: string; itemId: string; prompt: string; questions: []
        }) => Promise<unknown> }) => {
          await context.awaitUserInput?.({ id: 'in_sdk', itemId: 'item_sdk', prompt: 'Pick', questions: [] })
          return { item: { kind: 'tool_result', output: {} }, approved: true }
        }
      } as never,
      turns: { applyItem: async () => undefined, updateItem: async () => undefined } as never,
      sessionStore: {
        loadEventsSince: async () => [{ kind: 'user_input_resolved', inputId: 'in_sdk' }]
      } as never,
      threadStore: {
        get: async () => threadWith({
          workspace: '/ws',
          turns: [{ id: 'tn', prompt: 'ask' } as ThreadRecord['turns'][number]]
        })
      } as never,
      events: { record: async (event: { kind: string; inputId?: string }) => { events.push(event) } } as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      userInputGate: {
        request: async () => ({ status: 'submitted', answers: [] }),
        resolve: () => true,
        get: () => undefined,
        pending: () => []
      } as never
    })
    const deps = (runtime as unknown as {
      deps: { executeKunTool(threadId: string, turnId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> }
    }).deps

    await deps.executeKunTool('th', 'tn', 'user_input', {})

    expect(events.filter((event) => event.kind === 'user_input_requested')).toHaveLength(1)
    expect(events.filter((event) => event.kind === 'user_input_resolved')).toHaveLength(0)
  })

  test('arms SDK user input before publishing user_input_requested', async () => {
    const userInputGate = new InMemoryUserInputGate()
    const interactiveTool = LocalToolHost.defineTool({
      name: 'user_input',
      description: 'Ask the user a question',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async (_args, context) => {
        const resolution = await context.awaitUserInput?.({
          id: 'in_sdk_immediate',
          itemId: 'item_sdk_immediate',
          prompt: 'Continue?',
          questions: []
        })
        return { output: resolution ?? { status: 'cancelled' }, isError: resolution?.status === 'cancelled' }
      }
    })
    const registry = CapabilityRegistry.fromLocalTools([interactiveTool])
    let immediatelyResolved = false
    const runtime = createAgentSdkRuntime({
      registry,
      toolHost: new LocalToolHost({ registry }),
      turns: { applyItem: async () => undefined, updateItem: async () => undefined } as never,
      sessionStore: { loadEventsSince: async () => [] } as never,
      threadStore: {
        get: async () => threadWith({
          workspace: '/ws',
          turns: [{ id: 'tn', prompt: 'ask' } as ThreadRecord['turns'][number]]
        })
      } as never,
      events: {
        record: async (event: { kind: string; inputId?: string }) => {
          if (event.kind === 'user_input_requested' && event.inputId) {
            immediatelyResolved = userInputGate.resolve(event.inputId, {
              status: 'submitted',
              answers: []
            }) === 'settled'
          }
        }
      } as never,
      ids: { next: (prefix) => `${prefix}_1` },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      userInputGate
    })
    const deps = (runtime as unknown as {
      deps: {
        executeKunTool(threadId: string, turnId: string, toolName: string, args: Record<string, unknown>): Promise<{ output: unknown; isError?: boolean }>
      }
    }).deps

    await expect(deps.executeKunTool('th', 'tn', 'user_input', {})).resolves.toEqual({
      output: { status: 'submitted', answers: [] },
      isError: false
    })
    expect(immediatelyResolved).toBe(true)
  })


})
