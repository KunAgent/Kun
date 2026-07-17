import { describe, expect, it, vi } from 'vitest'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { MemoryRecord } from '../contracts/memory.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { MemoryStore } from '../memory/memory-store.js'
import { TurnContextResolver, resolveTurnModeContext } from './turn-context-resolver.js'

function capabilities(inputModalities: ModelCapabilityMetadata['inputModalities']): ModelCapabilityMetadata {
  return {
    id: 'model_1',
    inputModalities,
    outputModalities: ['text'],
    supportsToolCalling: true,
    messageParts: ['text']
  }
}

function thread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: 'thread_1',
    title: 'Thread',
    workspace: '/workspace',
    model: 'model_1',
    mode: 'agent',
    status: 'running',
    approvalPolicy: 'always',
    sandboxMode: 'workspace-write',
    relation: 'primary',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    turns: [],
    ...overrides
  }
}

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: 'turn_1',
    threadId: 'thread_1',
    status: 'running',
    prompt: 'Implement the requested plan',
    createdAt: '2026-01-01T00:00:00.000Z',
    attachmentIds: ['attachment_1'],
    activeSkillIds: [],
    injectedMemoryIds: [],
    injectedMemorySummaries: [],
    injectedInstructionSources: [],
    items: [],
    steering: [],
    ...overrides
  }
}

describe('TurnContextResolver', () => {
  it('snapshots plan, policy, attachments, memory, skills, instructions, and discovered tools', async () => {
    const resolutionOrder: string[] = []
    const listTools = vi.fn(async (context) => {
      resolutionOrder.push('tools')
      return [{
      name: 'create_plan', description: 'Create plan', inputSchema: {}, providerId: 'gui'
      }]
    })
    const retrieve = vi.fn(async (): Promise<MemoryRecord[]> => {
      resolutionOrder.push('memories')
      return [{
      id: 'memory_1', content: 'Prefer tests', scope: 'workspace',
      tags: [], confidence: 1,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
      }]
    })
    const setLastInjected = vi.fn()
    const resolver = new TurnContextResolver({
      toolHost: { listTools },
      resolveAttachments: vi.fn(async () => {
        resolutionOrder.push('attachments')
        return {
        imageAttachments: [{ id: 'attachment_1', name: 'diagram.png', mimeType: 'image/png', dataBase64: 'aW1hZ2U=' }],
        textFallbacks: [],
        documents: []
        }
      }),
      skillRuntime: {
        resolveTurn: vi.fn(async () => {
          resolutionOrder.push('skills')
          return {
          activeSkillIds: ['skill_1'], activations: [], instructions: ['Use the skill.'],
          catalogInstruction: 'Available skills', allowedToolNames: ['create_plan'], injectedBytes: 42
          }
        })
      },
      instructionRuntime: {
        resolveTurn: vi.fn(async () => {
          resolutionOrder.push('instructions')
          return {
          instruction: 'Project instructions', sources: [], injectedBytes: 12
          }
        })
      },
      memoryStore: { retrieve, setLastInjected },
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) },
      forcedAllowedToolNames: ['create_plan', 'read'],
      runtimeDataDir: '/runtime'
    })
    const planTurn = turn({
      mode: 'plan',
      guiPlan: {
        operation: 'draft', workspaceRoot: '/workspace', relativePath: '.kunsdd/plan/plan.md', planId: 'plan_1'
      }
    })
    const mode = resolveTurnModeContext({ turn: planTurn, workspace: '/workspace', threadMode: 'agent' })
    const resolved = await resolver.resolve({
      threadId: 'thread_1',
      turnId: 'turn_1',
      thread: thread(),
      turn: planTurn,
      history: [],
      model: 'model_1',
      modelCapabilities: capabilities(['image']),
      signal: new AbortController().signal,
      mode,
      goalNoToolRecoverySteps: 0
    })

    expect(resolved).toMatchObject({
      mode: 'plan',
      planTurnActive: true,
      activePlanContext: expect.objectContaining({ planId: 'plan_1', turnId: 'turn_1' }),
      approvalPolicy: 'always',
      sandboxMode: 'workspace-write',
      allowedToolNames: ['create_plan'],
      userInputDisabled: false,
      attachments: expect.objectContaining({ imageAttachments: [expect.objectContaining({ id: 'attachment_1' })] }),
      skillResolution: expect.objectContaining({ activeSkillIds: ['skill_1'] }),
      instructionResolution: expect.objectContaining({ instruction: 'Project instructions' }),
      memories: [expect.objectContaining({ id: 'memory_1' })],
      tools: [expect.objectContaining({ name: 'create_plan' })]
    })
    expect(setLastInjected).toHaveBeenCalledWith(['memory_1'])
    expect(resolutionOrder).toEqual(['attachments', 'skills', 'instructions', 'memories', 'tools'])
    expect(listTools).toHaveBeenCalledWith(expect.objectContaining({
      guiPlan: expect.objectContaining({ planId: 'plan_1' }),
      activeSkillIds: ['skill_1'],
      allowedToolNames: ['create_plan'],
      runtimeDataDir: '/runtime'
    }))
  })

  it('drops stale plan state and forces SVG turns to agent mode', () => {
    const stalePlan = turn({
      mode: 'plan',
      guiPlan: {
        operation: 'draft', workspaceRoot: '/other-workspace', relativePath: '.kunsdd/plan/plan.md', planId: 'plan_1'
      }
    })
    expect(resolveTurnModeContext({ turn: stalePlan, workspace: '/workspace', threadMode: 'agent' })).toMatchObject({
      planContextStale: true,
      effectiveMode: 'plan'
    })

    const svg = turn({
      mode: 'plan',
      guiDesignArtifact: { kind: 'svg', artifactId: 'artifact_1', relativePath: '.kun-design/a/v1.svg' }
    })
    expect(resolveTurnModeContext({ turn: svg, workspace: '/workspace', threadMode: 'agent' })).toEqual({
      dedicatedSvgTurn: true,
      planContextStale: false,
      effectiveMode: 'agent'
    })
  })

  it('reads the live memory store after runtime replacement', async () => {
    let currentMemoryStore: Pick<MemoryStore, 'retrieve' | 'setLastInjected'> | undefined
    const resolver = new TurnContextResolver({
      toolHost: { listTools: async () => [] },
      resolveAttachments: async () => ({
        imageAttachments: [], textFallbacks: [], documents: []
      }),
      getMemoryStore: () => currentMemoryStore,
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })
    const input = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      thread: thread(),
      turn: turn({ attachmentIds: [] }),
      history: [],
      model: 'model_1',
      modelCapabilities: capabilities(['text']),
      signal: new AbortController().signal,
      mode: resolveTurnModeContext({ turn: turn(), workspace: '/workspace', threadMode: 'agent' as const }),
      goalNoToolRecoverySteps: 0
    }

    await expect(resolver.resolve(input)).resolves.toMatchObject({ memories: [] })

    currentMemoryStore = {
      retrieve: vi.fn(async (): Promise<MemoryRecord[]> => [{
        id: 'memory_live',
        content: 'live memory',
        scope: 'workspace',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        tags: [],
        confidence: 1
      }]),
      setLastInjected: vi.fn()
    }
    await expect(resolver.resolve(input)).resolves.toMatchObject({
      memories: [expect.objectContaining({ id: 'memory_live' })]
    })
    expect(currentMemoryStore.setLastInjected).toHaveBeenCalledWith(['memory_live'])
  })

  it('intersects a turn-scoped tool policy with activated skill tools', async () => {
    const listTools = vi.fn(async () => [])
    const scopedTurn = turn({ attachmentIds: [], allowedToolNames: ['read', 'grep'] })
    const resolver = new TurnContextResolver({
      toolHost: { listTools },
      resolveAttachments: async () => ({ imageAttachments: [], textFallbacks: [], documents: [] }),
      skillRuntime: {
        resolveTurn: async () => ({
          activeSkillIds: ['review'],
          activations: [],
          instructions: [],
          injectedBytes: 0,
          allowedToolNames: ['grep', 'write']
        })
      },
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })

    await resolver.resolve({
      threadId: 'thread_1',
      turnId: 'turn_1',
      thread: thread(),
      turn: scopedTurn,
      history: [],
      model: 'model_1',
      modelCapabilities: capabilities(['text']),
      signal: new AbortController().signal,
      mode: resolveTurnModeContext({ turn: scopedTurn, workspace: '/workspace', threadMode: 'agent' }),
      goalNoToolRecoverySteps: 0
    })

    expect(listTools).toHaveBeenCalledWith(expect.objectContaining({ allowedToolNames: ['grep'] }))
  })
})
