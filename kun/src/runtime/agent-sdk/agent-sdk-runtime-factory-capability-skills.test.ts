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

  test('applies a child capability boundary to SDK discovery and execution', async () => {
    const executionContexts: Array<{
      allowedToolNames?: readonly string[]
      allowedProviderIds?: readonly string[]
      allowedReadPaths?: readonly string[]
      allowedWritePaths?: readonly string[]
      blockedToolNames?: readonly string[]
      blockedProviderIds?: readonly string[]
      blockedSkillIds?: readonly string[]
    }> = []
    // Names that no SDK builtin overlaps, so discovery shows the boundary itself.
    const readTool = LocalToolHost.defineTool({
      name: 'inspect_notes',
      description: 'Read safely',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async (_args, context) => {
        executionContexts.push(context)
        return { output: 'safe' }
      }
    })
    const writeTool = LocalToolHost.defineTool({
      name: 'mutate_notes',
      description: 'Write a file',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      execute: async () => ({ output: 'mutated' })
    })
    const registry = CapabilityRegistry.fromLocalTools([readTool, writeTool])
    const host = new LocalToolHost({ registry })
    const skillRuntime = {
      resolveTurn: vi.fn(async () => ({
        activeSkillIds: [],
        activations: [],
        instructions: [],
        injectedBytes: 0
      })),
      availableSkillIdsForWorkspace: vi.fn(async () => ['safe-skill', 'blocked-skill'])
    }
    const sdkTurn = {
      id: 'tn',
      prompt: 'inspect',
      persona: 'Use a concise presenter voice.',
      clientSurface: 'tui'
    } as ThreadRecord['turns'][number]
    const hostControl = 'Private PPT host control.'
    const runtime = createAgentSdkRuntime({
      registry,
      toolHost: host,
      turns: { updateTurnMetadata: async () => undefined } as never,
      sessionStore: {
        loadItems: async () => [{
          id: 'item_private', turnId: 'tn', threadId: 'th',
          kind: 'runtime_context_source', role: 'system', status: 'completed',
          contextKind: 'host-control', content: hostControl,
          createdAt: '2026-07-10T00:00:00.000Z'
        }, {
          id: 'item_user', turnId: 'tn', threadId: 'th', kind: 'user_message',
          role: 'user', status: 'completed', text: 'inspect',
          createdAt: '2026-07-10T00:00:00.000Z'
        }]
      } as never,
      threadStore: {
        get: async () => threadWith({
          id: 'th',
          providerId: 'claude-subscription',
          turns: [sdkTurn]
        })
      } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {
        'claude-subscription': { kind: 'agent-sdk', apiKey: 'sk-ant-oat01-tok' }
      } as never,
      agentSdkProviderIds: new Set(['claude-subscription']),
      defaultApprovalPolicy: 'auto',
      allowSdkBuiltins: false,
      skillRuntime: skillRuntime as never,
      toolContextBoundary: {
        allowedProviderIds: ['builtin'],
        allowedToolNames: ['inspect_notes'],
        allowedReadPaths: ['.kun/ppt/ppt_test', '.kun/images'],
        allowedWritePaths: ['.kun/ppt/ppt_test', 'presentations'],
        blockedProviderIds: ['mcp:private'],
        blockedToolNames: ['mutate_notes'],
        blockedSkillIds: ['blocked-skill']
      }
    })
    const deps = (runtime as unknown as {
      deps: {
        loadTurnContext(threadId: string, turnId: string): Promise<{
          bridgeableTools: Array<{ name: string }>
          allowSdkBuiltins?: boolean
          bridgeKunBuiltinOverlaps?: boolean
          preserveExactUserPrompt?: boolean
          userText: string
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
    expect(context).toMatchObject({
      allowSdkBuiltins: false,
      userText: 'inspect',
      bridgeableTools: [{ name: 'inspect_notes' }]
    })
    expect(context?.preserveExactUserPrompt).toBeUndefined()
    expect(context?.contextInstructions?.join('\n')).toContain(hostControl)
    expect(context?.contextInstructions?.join('\n')).toContain('Use a concise presenter voice.')
    await expect(deps.executeKunTool('th', 'tn', 'inspect_notes', {})).resolves.toEqual({
      output: 'safe',
      isError: false
    })
    await expect(deps.executeKunTool('th', 'tn', 'mutate_notes', {})).resolves.toMatchObject({
      isError: true
    })
    expect(executionContexts).toEqual([
      expect.objectContaining({
        allowedProviderIds: ['builtin'],
        allowedToolNames: ['inspect_notes'],
        allowedReadPaths: ['.kun/ppt/ppt_test', '.kun/images'],
        allowedWritePaths: ['.kun/ppt/ppt_test', 'presentations'],
        blockedProviderIds: ['mcp:private'],
        blockedToolNames: ['mutate_notes'],
        blockedSkillIds: ['blocked-skill'],
        clientSurface: 'tui'
      })
    ])
    expect(skillRuntime.resolveTurn).toHaveBeenCalledWith(expect.objectContaining({
      blockedSkillIds: ['blocked-skill']
    }))
  })

  test('scopes dedicated SVG turns to structured tools and the artifact-specific policy', async () => {
    type DesignContext = {
      guiDesignCanvas?: boolean
      guiDesignArtifact?: { kind: 'svg'; artifactId: string; relativePath: string }
      allowedToolNames?: readonly string[]
    }
    const listedContexts: DesignContext[] = []
    const executedContexts: DesignContext[] = []
    const designTurn = {
      id: 'tn',
      prompt: '制作轨道动画',
      mode: 'plan',
      guiDesignMode: true,
      guiDesignArtifact: {
        kind: 'svg',
        artifactId: 'motion',
        relativePath: '.kun-design/doc/motion/v1.svg'
      }
    } as ThreadRecord['turns'][number]
    const runtime = createAgentSdkRuntime({
      registry: {
        listTools: (context: DesignContext) => {
          listedContexts.push(context)
          return [
            { name: 'write', description: 'Raw write', inputSchema: {} },
            { name: 'design_svg_edit', description: 'Edit SVG', inputSchema: {} },
            { name: 'design_svg_validate', description: 'Validate SVG', inputSchema: {} }
          ].filter((tool) => !context.allowedToolNames || context.allowedToolNames.includes(tool.name))
        },
        resolveTool: (_name: string, context: DesignContext) => ({
          tool: {
            execute: async () => {
              executedContexts.push(context)
              return { output: { ok: true } }
            }
          }
        })
      } as never,
      toolHost: {
        id: 'test-host',
        listTools: async () => [],
        execute: async (_call: unknown, context: DesignContext) => {
          executedContexts.push(context)
          return { item: { kind: 'tool_result', output: { ok: true } }, approved: true }
        }
      } as never,
      turns: { updateTurnMetadata: async () => undefined } as never,
      sessionStore: {
        loadItems: async () => [{
          id: 'item_user',
          turnId: 'tn',
          threadId: 'th',
          kind: 'user_message',
          role: 'user',
          status: 'completed',
          text: '制作轨道动画',
          createdAt: '2026-07-10T00:00:00.000Z'
        }]
      } as never,
      threadStore: {
        get: async () => threadWith({
          id: 'th',
          providerId: 'claude-subscription',
          turns: [designTurn]
        })
      } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {
        'claude-subscription': { kind: 'agent-sdk', apiKey: 'sk-ant-oat01-tok' }
      } as never,
      agentSdkProviderIds: new Set(['claude-subscription']),
      defaultApprovalPolicy: 'auto'
    })
    const deps = (runtime as unknown as {
      deps: {
        loadTurnContext(threadId: string, turnId: string): Promise<{
          contextInstructions?: string[]
          bridgeableTools: Array<{ name: string }>
          allowSdkBuiltins?: boolean
          requireSvgCompletion?: boolean
          planMode?: boolean
        } | null>
        executeKunTool(
          threadId: string,
          turnId: string,
          toolName: string,
          args: Record<string, unknown>
        ): Promise<unknown>
      }
    }).deps

    const context = await deps.loadTurnContext('th', 'tn')
    await deps.executeKunTool('th', 'tn', 'design_svg_edit', { ops: [] })

    expect(listedContexts).toEqual([expect.objectContaining({
      guiDesignArtifact: { kind: 'svg', artifactId: 'motion', relativePath: '.kun-design/doc/motion/v1.svg' },
      allowedToolNames: expect.arrayContaining(['design_svg_edit', 'design_svg_validate'])
    })])
    expect(executedContexts).toEqual([expect.objectContaining({
      guiDesignArtifact: { kind: 'svg', artifactId: 'motion', relativePath: '.kun-design/doc/motion/v1.svg' },
      allowedToolNames: expect.arrayContaining(['design_svg_edit', 'design_svg_validate'])
    })])
    expect(context?.bridgeableTools.map((tool) => tool.name)).toEqual(['design_svg_edit', 'design_svg_validate'])
    expect(context).toMatchObject({
      allowSdkBuiltins: false,
      requireSvgCompletion: true,
      planMode: false
    })
    expect(context?.contextInstructions?.join('\n')).toContain('already-reserved file')
    expect(context?.contextInstructions?.join('\n')).not.toContain('SINGLE SCREEN')
  })

  test('clears turn-scoped skill activation when an SDK turn finishes', async () => {
    const clearTurnActivation = vi.fn()
    const finishTurn = vi.fn(async () => undefined)
    const suspendGraphLeadTurn = vi.fn(async () => 'not_graph' as const)
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
    const deps = (runtime as unknown as {
      deps: {
        finishTurn(
          threadId: string,
          turnId: string,
          status: 'completed' | 'failed' | 'aborted',
          error?: string
        ): Promise<void>
      }
    }).deps

    await deps.finishTurn('thread_1', 'turn_1', 'completed')

    expect(suspendGraphLeadTurn).toHaveBeenCalledWith({
      threadId: 'thread_1',
      turnId: 'turn_1'
    })
    expect(finishTurn).toHaveBeenCalledWith({
      threadId: 'thread_1',
      turnId: 'turn_1',
      status: 'completed'
    })
    expect(clearTurnActivation).toHaveBeenCalledWith('thread_1', 'turn_1')
  })


})
