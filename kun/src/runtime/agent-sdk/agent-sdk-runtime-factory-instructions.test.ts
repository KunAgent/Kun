import { describe, expect, test, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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

  test('injects native AGENTS.md instructions and records turn metadata', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'kun-sdk-instructions-')))
    try {
      const home = join(root, 'home')
      const workspace = join(root, 'workspace')
      await mkdir(workspace, { recursive: true })
      await writeFile(join(workspace, 'AGENTS.md'), 'SDK workspace rule.', 'utf8')
      const updatedMetadata: unknown[] = []
      const currentHostControl = 'Current private PPT host control.'
      const oldHostControl = 'Old private PPT host control.'
      const runtime = createAgentSdkRuntime({
        registry: { listTools: () => [] } as never,
        turns: {
          updateTurnMetadata: async (_threadId: string, _turnId: string, patch: unknown) => {
            updatedMetadata.push(patch)
          }
        } as never,
        sessionStore: {
          loadItems: async () => [
            runtimeSource('old-turn', oldHostControl),
            runtimeSource('tn', currentHostControl),
            {
              id: 'item_user',
              turnId: 'tn',
              threadId: 'th',
              kind: 'user_message',
              role: 'user',
              status: 'completed',
              text: 'hello',
              createdAt: '2026-07-03T00:00:00.000Z'
            }
          ]
        } as never,
        threadStore: {
          get: async () => threadWith({
            id: 'th',
            workspace,
            providerId: 'claude-subscription',
            turns: [{
              id: 'tn',
              prompt: 'hello',
              persona: 'Write with a precise editorial voice.',
              actingModelRoute: undefined
            } as ThreadRecord['turns'][number]]
          })
        } as never,
        events: {} as never,
        ids: { next: (p: string) => p },
        prefix: { systemPrompt: '' },
        providerConfigs: {
          'claude-subscription': { kind: 'agent-sdk', apiKey: 'sk-ant-oat01-tok' }
        } as never,
        agentSdkProviderIds: new Set(['claude-subscription']),
        defaultApprovalPolicy: 'auto',
        instructionRuntime: new InstructionRuntime(
          KunCapabilitiesConfig.parse({ instructions: { enabled: true } }).instructions,
          { homeDir: home }
        )
      })
      const deps = (runtime as unknown as {
        deps: {
          loadTurnContext(threadId: string, turnId: string): Promise<{
            contextInstructions?: string[]
            historyTranscript?: string
            redactedRequestValues?: string[]
            actingModelRoute?: {
              model: string
              providerId?: string
              accountId?: string
            }
          } | null>
        }
      }).deps

      const ctx = await deps.loadTurnContext('th', 'tn')

      expect(ctx?.contextInstructions?.join('\n')).toContain('SDK workspace rule.')
      expect(ctx?.contextInstructions?.join('\n')).toContain(
        '<kun_context_block kind="persona" authority="user">'
      )
      expect(ctx?.contextInstructions?.join('\n')).toContain('Write with a precise editorial voice.')
      expect(ctx?.contextInstructions?.join('\n')).toContain(
        '<kun_context_block kind="host-control" authority="runtime">'
      )
      expect(ctx?.contextInstructions?.join('\n')).toContain(currentHostControl)
      expect(ctx?.contextInstructions?.join('\n')).not.toContain(oldHostControl)
      expect(ctx?.historyTranscript).toBeUndefined()
      expect(ctx?.redactedRequestValues).toEqual([currentHostControl])
      expect(ctx?.actingModelRoute).toEqual({
        model: 'claude-haiku-4-5',
        providerId: 'claude-subscription'
      })
      expect(updatedMetadata).toEqual(expect.arrayContaining([
        {
          actingModelRoute: {
            model: 'claude-haiku-4-5',
            providerId: 'claude-subscription'
          }
        },
        expect.objectContaining({
          injectedInstructionSources: [
            expect.objectContaining({
              scope: 'workspace',
              path: join(workspace, 'AGENTS.md')
            })
          ],
          instructionInjectionBytes: expect.any(Number)
        })
      ]))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function runtimeSource(turnId: string, content: string) {
  return {
    id: `item-${turnId}`,
    threadId: 'th',
    turnId,
    kind: 'runtime_context_source' as const,
    role: 'system' as const,
    status: 'completed' as const,
    contextKind: 'host-control' as const,
    content,
    createdAt: '2026-07-03T00:00:00.000Z'
  }
}
