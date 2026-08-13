import { describe, expect, it, vi } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { MemoryRecord } from '../contracts/memory.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { MemoryStore } from '../memory/memory-store.js'
import {
  TurnContextResolver,
  resolveTurnClientSurface,
  resolveTurnModeContext
} from './turn-context-resolver.js'

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
    approvalReviewer: 'user',
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
    orchestration: 'direct',
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
  it('uses an explicit client surface and preserves legacy GUI/IM inference', () => {
    expect(resolveTurnClientSurface(turn({ clientSurface: 'tui', agentSurface: 'code' }))).toBe('tui')
    expect(resolveTurnClientSurface(turn({ imContext: { channel: 'lark' } as never }))).toBe('im')
    expect(resolveTurnClientSurface(turn({ guiDesignCanvas: true }))).toBe('gui')
    expect(resolveTurnClientSurface(turn())).toBe('api')
  })

  it('snapshots plan, policy, attachments, memory, skills, instructions, and discovered tools', async () => {
    const resolutionOrder: string[] = []
    const listTools = vi.fn(async (context) => {
      resolutionOrder.push('tools')
      return [{
      name: 'create_plan', description: 'Create plan', inputSchema: {}, providerId: 'gui'
      }]
    })
    const retrieve = vi.fn<MemoryStore['retrieve']>(async (_input) => {
      resolutionOrder.push('memories')
      return [{
      id: 'memory_1', content: 'Prefer tests', scope: 'workspace',
      tags: [], confidence: 1, anchored: false,
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
    expect(retrieve).toHaveBeenCalledWith(expect.objectContaining({
      query: 'Implement the requested plan',
      workspace: '/workspace'
    }))
    expect(retrieve.mock.calls[0]?.[0]).not.toHaveProperty('limit')
    expect(resolutionOrder).toEqual(['attachments', 'skills', 'instructions', 'memories', 'tools'])
    expect(listTools).toHaveBeenCalledWith(expect.objectContaining({
      guiPlan: expect.objectContaining({ planId: 'plan_1' }),
      activeSkillIds: ['skill_1'],
      allowedToolNames: ['create_plan'],
      runtimeDataDir: '/runtime'
    }))
  })

  it('resolves independent attachment, skill, instruction, and memory I/O concurrently', async () => {
    let started = 0
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const joinBarrier = async <T>(value: T): Promise<T> => {
      started += 1
      if (started === 4) release()
      await barrier
      return value
    }
    const resolver = new TurnContextResolver({
      toolHost: { listTools: async () => [] },
      resolveAttachments: async () => joinBarrier({
        imageAttachments: [],
        textFallbacks: [],
        documents: []
      }),
      skillRuntime: {
        resolveTurn: async () => joinBarrier({
          activeSkillIds: [],
          activations: [],
          instructions: [],
          injectedBytes: 0
        })
      },
      instructionRuntime: {
        resolveTurn: async () => joinBarrier({
          instruction: undefined,
          sources: [],
          injectedBytes: 0
        })
      },
      memoryStore: {
        retrieve: async () => joinBarrier([]),
        setLastInjected: async () => undefined
      },
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })
    const inputTurn = turn({ attachmentIds: [] })

    await resolver.resolve({
      threadId: 'thread_1',
      turnId: 'turn_1',
      thread: thread(),
      turn: inputTurn,
      history: [],
      model: 'model_1',
      modelCapabilities: capabilities(['text']),
      signal: new AbortController().signal,
      mode: resolveTurnModeContext({
        turn: inputTurn,
        workspace: '/workspace',
        threadMode: 'agent'
      }),
      goalNoToolRecoverySteps: 0
    })

    expect(started).toBe(4)
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
        confidence: 1,
        anchored: false
      }]),
      setLastInjected: vi.fn()
    }
    await expect(resolver.resolve(input)).resolves.toMatchObject({
      memories: [expect.objectContaining({ id: 'memory_live' })]
    })
    expect(currentMemoryStore.setLastInjected).toHaveBeenCalledWith(['memory_live'])
  })

  it('composes the retrieval query from the active goal and recent history', async () => {
    const retrieve = vi.fn<MemoryStore['retrieve']>(async () => [])
    const resolver = new TurnContextResolver({
      toolHost: { listTools: async () => [] },
      resolveAttachments: async () => ({ imageAttachments: [], textFallbacks: [], documents: [] }),
      memoryStore: { retrieve, setLastInjected: vi.fn() },
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })
    const goalThread = thread({
      goal: {
        threadId: 'thread_1',
        objective: 'Refactor the build pipeline to use pnpm',
        status: 'active',
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    })
    const history: TurnItem[] = [
      { id: 'item_1', turnId: 'turn_1', threadId: 'thread_1', role: 'user', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', kind: 'user_message', text: 'Switch the frontend to Vite 5' },
      { id: 'item_2', turnId: 'turn_1', threadId: 'thread_1', role: 'assistant', status: 'completed', createdAt: '2026-01-01T00:00:01.000Z', kind: 'assistant_text', text: 'I checked the package manager config' },
      { id: 'item_3', turnId: 'turn_1', threadId: 'thread_1', role: 'tool', status: 'completed', createdAt: '2026-01-01T00:00:02.000Z', kind: 'tool_result', toolName: 'read', callId: 'call_1', toolKind: 'tool_call', output: 'package.json uses pnpm', isError: false }
    ]
    await resolver.resolve({
      threadId: 'thread_1',
      turnId: 'turn_1',
      thread: goalThread,
      turn: turn({ attachmentIds: [] }),
      history,
      model: 'model_1',
      modelCapabilities: capabilities(['text']),
      signal: new AbortController().signal,
      mode: resolveTurnModeContext({ turn: turn(), workspace: '/workspace', threadMode: 'agent' }),
      goalNoToolRecoverySteps: 0
    })
    const called = retrieve.mock.calls[0]?.[0]
    expect(called?.query).toContain('Implement the requested plan')
    expect(called?.query).toContain('Refactor the build pipeline')
    expect(called?.query).toContain('Vite 5')
    expect(called?.query).toContain('package.json uses pnpm')
    expect(called?.allowRecencyFallback).toBe(false)
  })

  it('flags degenerate prompts for the store recency fallback', async () => {
    const retrieve = vi.fn<MemoryStore['retrieve']>(async () => [])
    const resolver = new TurnContextResolver({
      toolHost: { listTools: async () => [] },
      resolveAttachments: async () => ({ imageAttachments: [], textFallbacks: [], documents: [] }),
      memoryStore: { retrieve, setLastInjected: vi.fn() },
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })
    const goalThread = thread({
      goal: {
        threadId: 'thread_1',
        objective: 'Refactor the build pipeline to use pnpm',
        status: 'active',
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    })
    await resolver.resolve({
      threadId: 'thread_1',
      turnId: 'turn_1',
      thread: goalThread,
      turn: turn({ prompt: '继续', attachmentIds: [] }),
      history: [],
      model: 'model_1',
      modelCapabilities: capabilities(['text']),
      signal: new AbortController().signal,
      mode: resolveTurnModeContext({ turn: turn(), workspace: '/workspace', threadMode: 'agent' }),
      goalNoToolRecoverySteps: 0
    })
    const called = retrieve.mock.calls[0]?.[0]
    expect(called?.query).toMatch(/^继续 /)
    expect(called?.allowRecencyFallback).toBe(true)
  })
})
