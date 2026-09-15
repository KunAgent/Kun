import { describe, expect, test, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentSdkRuntime, resolveTurnPlanContext, waitForGate } from './agent-sdk-runtime-factory.js'
import { KunCapabilitiesConfig } from '../../contracts/capabilities.js'
import type { TurnItem } from '../../contracts/items.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type { UserInputGate, UserInputRequest, UserInputResolution } from '../../ports/user-input-gate.js'
import { InstructionRuntime } from '../../instructions/instruction-runtime.js'
import { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'
import { InMemoryApprovalGate } from '../../adapters/in-memory-approval-gate.js'
import { InMemoryUserInputGate } from '../../adapters/in-memory-user-input-gate.js'
import { goalContextKey } from '../../loop/continuation-instructions.js'
import { MemoryRecord } from '../../contracts/memory.js'
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

describe('waitForGate', () => {
  test('resolves with the gate answer when the user submits', async () => {
    const answer: UserInputResolution = { status: 'submitted', answers: [] }
    const { gate } = fakeGate(Promise.resolve(answer))
    expect(await waitForGate(gate, req, new AbortController().signal)).toEqual(answer)
  })

  test('an already-aborted turn cancels the request immediately', async () => {
    const { gate, resolvedWith } = fakeGate(new Promise(() => {})) // never resolves
    const ac = new AbortController()
    ac.abort()
    expect(await waitForGate(gate, req, ac.signal)).toEqual({ status: 'cancelled' })
    expect(resolvedWith).toEqual([{ status: 'cancelled' }])
  })

  test('aborting mid-wait cancels the pending request and rejects', async () => {
    const { gate, resolvedWith } = fakeGate(new Promise(() => {}))
    const ac = new AbortController()
    const waiting = waitForGate(gate, req, ac.signal)
    ac.abort()
    await expect(waiting).rejects.toThrow(/cancelled/)
    expect(resolvedWith).toEqual([{ status: 'cancelled' }])
  })
})

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

describe('resolveTurnPlanContext', () => {
  test('exposes the GUI plan + planMode for a plan turn in the same workspace', () => {
    const thread = threadWith({ workspace: '/ws', turns: [planTurn('tn', '/ws')] })
    const resolved = resolveTurnPlanContext(thread, 'tn')
    expect(resolved.planMode).toBe(true)
    expect(resolved.guiPlan?.relativePath).toBe('.kun/plan.md')
    expect(resolved.guiPlan?.turnId).toBe('tn')
  })

  test('drops a stale plan whose workspace does not match the thread', () => {
    const thread = threadWith({ workspace: '/ws', turns: [planTurn('tn', '/other-ws')] })
    const resolved = resolveTurnPlanContext(thread, 'tn')
    expect(resolved.guiPlan).toBeUndefined()
    // mode falls back to the thread mode (no live plan to force plan mode)
    expect(resolved.planMode).toBe(false)
  })

  test('plan mode via thread.mode without a GUI plan', () => {
    const thread = threadWith({ mode: 'plan', turns: [{ id: 'tn', prompt: 'x' } as ThreadRecord['turns'][number]] })
    const resolved = resolveTurnPlanContext(thread, 'tn')
    expect(resolved.planMode).toBe(true)
    expect(resolved.guiPlan).toBeUndefined()
  })

  test('a normal agent turn is not a plan turn', () => {
    const thread = threadWith({ turns: [{ id: 'tn', prompt: 'x' } as ThreadRecord['turns'][number]] })
    expect(resolveTurnPlanContext(thread, 'tn')).toEqual({ planMode: false })
  })
})

describe('createAgentSdkRuntime delegated session binding', () => {
  test('records only Agent SDK memories included in the assembled context', async () => {
    const createdAt = '2026-09-15T03:00:00.000Z'
    const thread = threadWith({
      id: 'thread_memory',
      providerId: 'claude-subscription',
      workspace: '/tmp/agent-sdk-memory',
      turns: [{
        id: 'turn_memory',
        prompt: 'Use my saved preference.',
        createdAt
      } as ThreadRecord['turns'][number]]
    })
    const memory = MemoryRecord.parse({
      id: 'memory_agent_sdk',
      content: 'Prefer concise release notes.',
      scope: 'workspace',
      workspace: '/tmp/agent-sdk-memory',
      createdAt: '2026-09-15T02:00:00.000Z',
      updatedAt: '2026-09-15T02:00:00.000Z'
    })
    const memoryStore = {
      retrieve: vi.fn(async () => [memory]),
      setLastInjected: vi.fn()
    }
    const append = vi.fn(async () => ({ status: 'appended' as const }))
    const runtime = createAgentSdkRuntime({
      registry: CapabilityRegistry.fromLocalTools([]),
      turns: { updateTurnMetadata: async () => undefined } as never,
      sessionStore: {
        loadItems: async () => [{
          id: 'item_memory',
          turnId: 'turn_memory',
          threadId: 'thread_memory',
          kind: 'user_message',
          role: 'user',
          status: 'completed',
          text: 'Use my saved preference.',
          createdAt
        }]
      } as never,
      threadStore: { get: async () => thread } as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: 'Kun system prompt' },
      providerConfigs: {
        'claude-subscription': { kind: 'agent-sdk', apiKey: 'sk-ant-oat01-oauth-secret' }
      } as never,
      agentSdkProviderIds: new Set(['claude-subscription']),
      defaultApprovalPolicy: 'auto',
      memoryStore: memoryStore as never,
      memoryFeedback: { enabled: () => true, append }
    })
    const loadTurnContext = (runtime as unknown as {
      deps: {
        loadTurnContext(threadId: string, turnId: string): Promise<{
          contextInstructions?: string[]
        } | null>
      }
    }).deps.loadTurnContext

    const context = await loadTurnContext('thread_memory', 'turn_memory')

    expect(context?.contextInstructions?.join('\n')).toContain('Prefer concise release notes.')
    expect(memoryStore.setLastInjected).toHaveBeenCalledWith(['memory_agent_sdk'])
    expect(append).toHaveBeenCalledOnce()
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'retrieved',
      memoryId: 'memory_agent_sdk',
      threadId: 'thread_memory',
      turnId: 'turn_memory',
      occurredAt: createdAt
    }))
  })

  test('restores a compatible Claude session and scopes OAuth state under Kun data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-claude-binding-'))
    try {
      let items: TurnItem[] = [{
        id: 'item_t1',
        turnId: 't1',
        threadId: 'th',
        kind: 'user_message',
        role: 'user',
        status: 'completed',
        text: 'first',
        createdAt: '2026-07-25T00:00:00.000Z'
      }]
      let thread = threadWith({
        id: 'th',
        providerId: 'claude-subscription',
        workspace: '/ws',
        turns: [{ id: 't1', prompt: 'first' } as ThreadRecord['turns'][number]]
      })
      const buildRuntime = (sessionCoordinator: DelegatedSessionCoordinator) =>
        createAgentSdkRuntime({
          registry: CapabilityRegistry.fromLocalTools([]),
          turns: { updateTurnMetadata: async () => undefined } as never,
          sessionStore: { loadItems: async () => items } as never,
          threadStore: { get: async () => thread } as never,
          events: {} as never,
          ids: { next: (prefix) => prefix },
          prefix: { systemPrompt: 'Kun system prompt' },
          providerConfigs: {
            'claude-subscription': { kind: 'agent-sdk', apiKey: 'sk-ant-oat01-oauth-secret' }
          } as never,
          agentSdkProviderIds: new Set(['claude-subscription']),
          defaultApprovalPolicy: 'auto',
          sessionCoordinator
        })
      const firstCoordinator = new DelegatedSessionCoordinator(
        new FileDelegatedSessionBindingStore(root)
      )
      const firstRuntime = buildRuntime(firstCoordinator)
      const firstDeps = (firstRuntime as unknown as {
        deps: {
          loadTurnContext(threadId: string, turnId: string): Promise<{
            claudeConfigDir?: string
            sessionPreparation?: DelegatedSessionPreparation
          } | null>
        }
      }).deps
      const first = await firstDeps.loadTurnContext('th', 't1')
      expect(first?.claudeConfigDir).toContain('provider-state')
      await firstCoordinator.commit({
        preparation: first!.sessionPreparation!,
        committedItems: items as never,
        lastCommittedTurnId: 't1',
        nativeSessionId: 'session_persisted'
      })

      items = [...items, {
        id: 'item_t2',
        turnId: 't2',
        threadId: 'th',
        kind: 'user_message',
        role: 'user',
        status: 'completed',
        text: 'second',
        createdAt: '2026-07-25T00:01:00.000Z'
      }]
      thread = {
        ...thread,
        turns: [
          ...thread.turns,
          { id: 't2', prompt: 'second' } as ThreadRecord['turns'][number]
        ]
      }
      const restarted = buildRuntime(new DelegatedSessionCoordinator(
        new FileDelegatedSessionBindingStore(root)
      ))
      const restartedDeps = (restarted as unknown as {
        deps: {
          loadTurnContext(threadId: string, turnId: string): Promise<{
            resumeSessionId?: string
            historyTranscript?: string
          } | null>
        }
      }).deps
      const second = await restartedDeps.loadTurnContext('th', 't2')
      expect(second?.resumeSessionId).toBe('session_persisted')
      expect(second?.historyTranscript).toContain('first')

      items = [...items, {
        id: 'item_private_t2', turnId: 't2', threadId: 'th',
        kind: 'runtime_context_source', role: 'system', status: 'completed',
        contextKind: 'host-control', content: 'private current host control',
        createdAt: '2026-07-25T00:01:00.000Z'
      }]
      thread = {
        ...thread,
        turns: thread.turns.map((turn) => turn.id === 't2'
          ? { ...turn, persona: 'Be precise.' }
          : turn)
      }
      const isolated = await restartedDeps.loadTurnContext('th', 't2')
      expect(isolated?.resumeSessionId).toBeUndefined()
      expect(isolated?.historyTranscript).toContain('first')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rotates Claude continuation when a bridged tool changes provider identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-claude-tool-provider-'))
    try {
      let items = [{
        id: 'item_t1',
        turnId: 't1',
        threadId: 'th',
        kind: 'user_message',
        role: 'user',
        status: 'completed',
        text: 'first',
        createdAt: '2026-07-25T00:00:00.000Z'
      }]
      let thread = threadWith({
        id: 'th',
        providerId: 'claude-subscription',
        turns: [{ id: 't1', prompt: 'first' } as ThreadRecord['turns'][number]]
      })
      const coordinator = new DelegatedSessionCoordinator(
        new FileDelegatedSessionBindingStore(root)
      )
      const buildRegistry = (providerId: string) => new CapabilityRegistry([{
        id: providerId,
        kind: 'mcp',
        enabled: true,
        available: true,
        tools: [LocalToolHost.defineTool({
          name: 'remote_lookup',
          description: 'Look up remote documentation',
          inputSchema: { type: 'object' },
          sideEffect: 'read-only',
          execute: async () => ({ output: 'ok' })
        })]
      }])
      const buildRuntime = (registry: CapabilityRegistry) => createAgentSdkRuntime({
        registry,
        toolHost: new LocalToolHost({ registry }),
        turns: { updateTurnMetadata: async () => undefined } as never,
        sessionStore: { loadItems: async () => items } as never,
        threadStore: { get: async () => thread } as never,
        events: {} as never,
        ids: { next: (prefix) => prefix },
        prefix: { systemPrompt: 'Kun system prompt' },
        providerConfigs: {
          'claude-subscription': { kind: 'agent-sdk', apiKey: 'sk-ant-oat01-oauth-secret' }
        } as never,
        agentSdkProviderIds: new Set(['claude-subscription']),
        defaultApprovalPolicy: 'auto',
        sessionCoordinator: coordinator
      })
      const firstRuntime = buildRuntime(buildRegistry('mcp:first'))
      const firstDeps = (firstRuntime as unknown as {
        deps: {
          loadTurnContext(threadId: string, turnId: string): Promise<{
            sessionPreparation?: DelegatedSessionPreparation
          } | null>
        }
      }).deps
      const first = await firstDeps.loadTurnContext('th', 't1')
      await coordinator.commit({
        preparation: first!.sessionPreparation!,
        committedItems: items as never,
        lastCommittedTurnId: 't1',
        nativeSessionId: 'session_first_provider'
      })

      items = [...items, {
        id: 'item_t2',
        turnId: 't2',
        threadId: 'th',
        kind: 'user_message',
        role: 'user',
        status: 'completed',
        text: 'second',
        createdAt: '2026-07-25T00:01:00.000Z'
      }]
      thread = {
        ...thread,
        turns: [
          ...thread.turns,
          { id: 't2', prompt: 'second' } as ThreadRecord['turns'][number]
        ]
      }
      const secondRuntime = buildRuntime(buildRegistry('mcp:second'))
      const secondDeps = (secondRuntime as unknown as {
        deps: {
          loadTurnContext(threadId: string, turnId: string): Promise<{
            resumeSessionId?: string
            bridgeableTools: Array<{ providerId?: string }>
            sessionPreparation?: DelegatedSessionPreparation
          } | null>
        }
      }).deps
      const second = await secondDeps.loadTurnContext('th', 't2')

      expect(second?.resumeSessionId).toBeUndefined()
      expect(second?.sessionPreparation?.rebaseReason).toBe('capabilities_changed')
      expect(second?.bridgeableTools).toContainEqual(expect.objectContaining({
        name: 'remote_lookup',
        providerId: 'mcp:second',
        providerKind: 'mcp'
      }))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

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

describe('createAgentSdkRuntime handlesProvider', () => {
  test('claims only explicit agent-sdk providers when default is not agent-sdk', () => {
    const r = make({ agentSdk: ['claude-subscription'], http: ['deepseek'], defaultIsAgentSdk: false })
    expect(r.handlesProvider('claude-subscription')).toBe(true)
    expect(r.handlesProvider('deepseek')).toBe(false)
    expect(r.handlesProvider(undefined)).toBe(false)
  })

  test('when the default provider is agent-sdk, also claims absent/default providerId', () => {
    const r = make({ agentSdk: ['claude-subscription'], http: ['deepseek'], defaultIsAgentSdk: true })
    expect(r.handlesProvider(undefined)).toBe(true) // default turn → SDK (the reported 401 case)
    expect(r.handlesProvider('claude-subscription')).toBe(true)
    expect(r.handlesProvider('deepseek')).toBe(false) // an explicit HTTP provider stays HTTP
  })

  test('forwards every native turn limit to delegated SDK turns', () => {
    const turnLimits = { maxSteps: 9, maxWallTimeMs: 12_345, maxToolCallsPerStep: 4 }
    const runtime = createAgentSdkRuntime({
      registry: {} as never,
      turns: {} as never,
      sessionStore: {} as never,
      threadStore: {} as never,
      events: {} as never,
      ids: { next: (prefix) => prefix },
      prefix: { systemPrompt: '' },
      providerConfigs: {},
      agentSdkProviderIds: new Set(),
      defaultApprovalPolicy: 'auto',
      turnLimits
    })
    const deps = (runtime as unknown as {
      deps: { getTurnLimits?(): typeof turnLimits | undefined }
    }).deps

    expect(deps.getTurnLimits?.()).toEqual(turnLimits)
  })
})
