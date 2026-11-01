import { describe, expect, it, vi } from 'vitest'
import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import { MemoryRecord } from '../contracts/memory.js'
import { ToolResultTurnItem } from '../contracts/items.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { MemoryStore } from '../memory/memory-store.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { buildDesignCanvasLocalTools } from '../adapters/tool/design-canvas-tool.js'
import { buildDesignMotionLocalTools } from '../adapters/tool/design-motion-tool.js'
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
    injectedDirectiveIds: [],
    injectedDirectiveSummaries: [],
    injectedInstructionSources: [],
    items: [],
    steering: [],
    ...overrides
  }
}

describe('TurnContextResolver', () => {
  it('fences Code previews after publication without leaking into the next turn', async () => {
    const resolver = new TurnContextResolver({
      toolHost: { listTools: async () => [] },
      resolveAttachments: async () => ({ imageAttachments: [], textFallbacks: [], documents: [] }),
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })
    const history = [ToolResultTurnItem.parse({
      id: 'result_1', threadId: 'thread_1', turnId: 'turn_1', role: 'tool',
      kind: 'tool_result', status: 'completed', createdAt: '2026-10-30T00:00:00Z',
      toolName: 'design_open', callId: 'call_1', toolKind: 'file_change',
      output: { designRequest: { status: 'ready' } }
    })]
    for (const id of ['turn_1', 'turn_2']) {
      const currentTurn = turn({ id, clientSurface: 'gui', agentSurface: 'code' })
      const resolved = await resolver.resolve({
        threadId: 'thread_1', turnId: id, thread: thread(), turn: currentTurn, history,
        model: 'model_1', modelCapabilities: capabilities(['text']),
        signal: new AbortController().signal,
        mode: resolveTurnModeContext({ turn: currentTurn, workspace: '/workspace', threadMode: 'agent' }),
        goalNoToolRecoverySteps: 0
      })
      expect(resolved.toolDiscoveryContext.designPreviewOnly).toBe(id === 'turn_1' ? true : undefined)
    }
  })

  it.each<{
    name: string
    overrides: Partial<Turn>
    expected: string[]
  }>([
    { name: 'Code conversation', overrides: {}, expected: ['design_open'] },
    {
      name: 'Code whiteboard', overrides: { guiDesignCanvas: true },
      expected: ['design_open', 'design_system', 'design_canvas', 'design_export_canvas']
    },
    {
      name: 'Code Excalidraw', overrides: { guiExcalidrawCanvas: true },
      expected: ['design_open', 'design_apply_excalidraw']
    },
    {
      name: 'Design canvas',
      overrides: { agentSurface: 'design', guiDesignCanvas: true, guiDesignMode: true },
      expected: ['design_system', 'design_canvas', 'design_motion_set_timeline']
    },
    {
      name: 'Work conversation', overrides: { agentSurface: 'write' },
      expected: ['design_apply_excalidraw']
    },
    { name: 'TUI conversation', overrides: { clientSurface: 'tui' }, expected: [] },
    { name: 'API conversation', overrides: { clientSurface: 'api' }, expected: [] },
    { name: 'plan conversation', overrides: { mode: 'plan' }, expected: [] },
    {
      name: 'reserved HTML page',
      overrides: {
        agentSurface: 'design', guiDesignCanvas: true, guiDesignMode: true,
        guiDesignArtifact: { kind: 'html', artifactId: 'page_1', relativePath: '.kun-design/doc/page_1/v1.html' }
      },
      expected: []
    },
    {
      name: 'dedicated SVG artifact',
      overrides: {
        agentSurface: 'design', guiDesignCanvas: true, guiDesignMode: true,
        guiDesignArtifact: { kind: 'svg', artifactId: 'svg_1', relativePath: '.kun-design/doc/svg_1/v1.svg' }
      },
      expected: []
    }
  ])('advertises only executable design tools for a $name', async ({ overrides, expected }) => {
    const registry = new CapabilityRegistry([{
      id: 'gui', kind: 'gui', enabled: true, available: true,
      tools: [...buildDesignCanvasLocalTools(), ...buildDesignMotionLocalTools()]
    }])
    const host = new LocalToolHost({ registry })
    const listTools = vi.spyOn(host, 'listTools')
    const resolver = new TurnContextResolver({
      toolHost: host,
      resolveAttachments: async () => ({ imageAttachments: [], textFallbacks: [], documents: [] }),
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })
    const currentTurn = turn({ clientSurface: 'gui', agentSurface: 'code', ...overrides })
    const currentThread = thread()
    const resolved = await resolver.resolve({
      threadId: currentThread.id, turnId: currentTurn.id,
      thread: currentThread, turn: currentTurn, history: [],
      model: 'model_1', modelCapabilities: capabilities(['text']),
      signal: new AbortController().signal,
      mode: resolveTurnModeContext({ turn: currentTurn, workspace: currentThread.workspace, threadMode: currentThread.mode }),
      goalNoToolRecoverySteps: 0
    })

    const names = resolved.tools.map((tool) => tool.name)
    const designTools = [
      'design_open', 'design_system', 'design_canvas', 'design_apply_excalidraw',
      'design_export_canvas', 'design_motion_set_timeline'
    ]
    expect(names.filter((name) => designTools.includes(name)).sort()).toEqual([...expected].sort())
    expect(names).toEqual(registry.listTools(resolved.toolDiscoveryContext).map((tool) => tool.name).sort())
    expect(listTools).toHaveBeenCalledExactlyOnceWith(resolved.toolDiscoveryContext)
    for (const name of names) {
      expect(() => registry.resolveTool(name, resolved.toolDiscoveryContext)).not.toThrow()
    }
    if (Object.keys(overrides).length === 0) {
      await expect(host.execute({
        callId: 'call_design_system', toolName: 'design_system', arguments: {}
      }, resolved.toolDiscoveryContext)).rejects.toThrow('tool design_system is not advertised in this turn context')
    }
  })

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
    const retrieve = vi.fn(async (): Promise<MemoryRecord[]> => {
      resolutionOrder.push('memories')
      return [MemoryRecord.parse({
      id: 'memory_1', content: 'Prefer tests', scope: 'workspace',
      tags: [], confidence: 1,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
      })]
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

  it('sorts the real turn catalog without mutating the host listing', async () => {
    const listing = [
      { name: 'zeta', description: 'zeta', inputSchema: {}, providerId: 'gui' },
      { name: 'shared', description: 'code shared', inputSchema: {}, providerId: 'gui' },
      { name: 'alpha', description: 'alpha', inputSchema: {}, providerId: 'gui' }
    ]
    const listTools = vi.fn(async () => listing)
    const resolver = new TurnContextResolver({
      toolHost: { listTools },
      resolveAttachments: async () => ({ imageAttachments: [], textFallbacks: [], documents: [] }),
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })
    const inputTurn = turn({ clientSurface: 'gui', agentSurface: 'code', attachmentIds: [] })

    const resolved = await resolver.resolve({
      threadId: 'thread_1', turnId: 'turn_1', thread: thread(), turn: inputTurn,
      history: [], model: 'model_1', modelCapabilities: capabilities(['text']),
      signal: new AbortController().signal,
      mode: resolveTurnModeContext({ turn: inputTurn, workspace: '/workspace', threadMode: 'agent' }),
      goalNoToolRecoverySteps: 0
    })

    expect(listTools).toHaveBeenCalledExactlyOnceWith(resolved.toolDiscoveryContext)
    expect(listing.map((tool) => tool.name)).toEqual(['zeta', 'shared', 'alpha'])
    expect(resolved.tools).toEqual([
      expect.objectContaining({ name: 'alpha' }),
      expect.objectContaining({ name: 'shared', description: 'code shared' }),
      expect.objectContaining({ name: 'zeta' })
    ])
  })

  it('gives a reserved HTML page turn one fixed read/write catalog and drops unreachable skills', async () => {
    const contexts: Array<Record<string, unknown>> = []
    const listTools = vi.fn(async (context) => {
      contexts.push(context)
      return [{ name: 'write', description: 'write', inputSchema: {}, providerId: 'local' }]
    })
    const resolveTurn = vi.fn(async () => ({
      activeSkillIds: ['design-system'], activations: [], instructions: [],
      allowedToolNames: ['browser_use'], injectedBytes: 0
    }))
    const resolver = new TurnContextResolver({
      toolHost: { listTools },
      resolveAttachments: async () => ({ imageAttachments: [], textFallbacks: [], documents: [] }),
      skillRuntime: { resolveTurn },
      interactiveToolBridge: { awaitUserInput: async () => ({ status: 'cancelled' }) }
    })
    const inputTurn = turn({
      clientSurface: 'gui', agentSurface: 'design', attachmentIds: [],
      guiDesignArtifact: { kind: 'html', artifactId: 'page_1', relativePath: '.kun-design/doc/page_1/v1.html' }
    })

    await resolver.resolve({
      threadId: 'thread_1', turnId: 'turn_1', thread: thread(), turn: inputTurn,
      history: [], model: 'model_1', modelCapabilities: capabilities(['text']),
      signal: new AbortController().signal,
      mode: resolveTurnModeContext({ turn: inputTurn, workspace: '/workspace', threadMode: 'agent' }),
      goalNoToolRecoverySteps: 0
    })

    expect(contexts).toHaveLength(1)
    expect(contexts[0]?.agentSurface).toBe('design')
    expect([...(contexts[0]?.allowedToolNames as string[])].sort()).toEqual([
      'edit', 'fast_context', 'find', 'get_goal', 'glob', 'grep', 'ls', 'read',
      'task_create', 'task_get', 'task_list', 'task_update', 'update_goal', 'write'
    ])
    expect(resolveTurn).toHaveBeenCalledWith(expect.objectContaining({
      blockedSkillIds: expect.arrayContaining(['automation', 'browser', 'canvas', 'component'])
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
      retrieve: vi.fn(async (): Promise<MemoryRecord[]> => [MemoryRecord.parse({
        id: 'memory_live',
        content: 'live memory',
        scope: 'workspace',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        tags: [],
        confidence: 1
      })]),
      setLastInjected: vi.fn()
    }
    await expect(resolver.resolve(input)).resolves.toMatchObject({
      memories: [expect.objectContaining({ id: 'memory_live' })]
    })
    expect(currentMemoryStore.setLastInjected).toHaveBeenCalledWith(['memory_live'])
  })
})
