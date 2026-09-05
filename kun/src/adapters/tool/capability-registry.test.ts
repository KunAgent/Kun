import { describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { LocalToolHost } from './local-tool-host.js'
import { CapabilityRegistry } from './capability-registry.js'
import { planModeToolBlock } from './plan-mode-tool-policy.js'

type ToolOptions = {
  sideEffect?: 'read-only' | 'unknown'
  toolKind?: 'tool_call' | 'command_execution' | 'file_change'
}

function tool(name: string, options: ToolOptions = {}) {
  return LocalToolHost.defineTool({
    name,
    description: name,
    inputSchema: { type: 'object', properties: {} },
    policy: 'auto',
    ...options,
    execute: async () => ({ output: { ok: true } })
  })
}

function context(
  activeSkillIds: string[],
  threadMode?: 'agent' | 'plan',
  orchestration?: 'direct' | 'graph',
  messageSource?: 'graph_runtime'
): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/workspace',
    ...(threadMode ? { threadMode } : {}),
    ...(orchestration ? { orchestration } : {}),
    ...(messageSource ? { messageSource } : {}),
    activeSkillIds,
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

describe('CapabilityRegistry Graph orchestration policy', () => {
  const providers = () => [
    {
      id: 'builtin',
      kind: 'built-in' as const,
      enabled: true,
      available: true,
      tools: [
        tool('read', { sideEffect: 'read-only' }),
        tool('task_graph'),
        tool('design_component'),
        tool('graph_create_run'),
        tool('graph_control_run')
      ]
    },
    {
      id: 'delegation',
      kind: 'delegation' as const,
      enabled: true,
      available: true,
      tools: [tool('delegate_task'), tool('list_subagent_profiles', { sideEffect: 'read-only' })]
    },
    {
      id: 'fast-context',
      kind: 'delegation' as const,
      enabled: true,
      available: true,
      tools: [tool('fast_context', { sideEffect: 'read-only' })]
    }
  ]

  it('hides and rejects ordinary orchestration tools for Graph user and runtime Lead turns', () => {
    const registry = new CapabilityRegistry(providers())
    const graph = context([], 'agent', 'graph')
    const supervision = context([], 'agent', 'direct', 'graph_runtime')

    for (const current of [graph, supervision]) {
      expect(registry.listTools(current).map((spec) => spec.name)).toEqual([
        'read',
        'graph_create_run',
        'graph_control_run',
        'fast_context'
      ])
      expect(registry.resolveTool('fast_context', current).provider.id).toBe('fast-context')
      for (const name of [
        'delegate_task',
        'list_subagent_profiles',
        'task_graph',
        'design_component'
      ]) {
        expect(() => registry.resolveTool(name, current))
          .toThrow('unavailable in the Graph capability plane')
      }
    }
  })

  it('preserves ordinary delegation and legacy task graphs for direct turns', () => {
    const registry = new CapabilityRegistry(providers())
    const direct = context([], 'agent', 'direct')

    expect(registry.listTools(direct).map((spec) => spec.name)).toEqual([
      'read',
      'task_graph',
      'design_component',
      'graph_create_run',
      'graph_control_run',
      'delegate_task',
      'list_subagent_profiles',
      'fast_context'
    ])
    expect(registry.resolveTool('delegate_task', direct).provider.kind).toBe('delegation')
    expect(registry.resolveTool('task_graph', direct).provider.id).toBe('builtin')
  })
})

describe('CapabilityRegistry Plan mode policy', () => {
  it('keeps image generation visible in Agent, Plan, and Graph modes on every workbench surface', () => {
    const registry = new CapabilityRegistry([{
      id: 'imageGen',
      kind: 'image',
      enabled: true,
      available: true,
      tools: [tool('generate_image', { toolKind: 'file_change' })]
    }])
    const modes = [
      context([], 'agent', 'direct'),
      context([], 'plan', 'direct'),
      context([], 'agent', 'graph')
    ]

    for (const modeContext of modes) {
      for (const agentSurface of ['code', 'write', 'design'] as const) {
        expect(registry.listTools({ ...modeContext, agentSurface }).map((spec) => spec.name))
          .toEqual(['generate_image'])
      }
    }
  })

  it('allows host-classified read-only MCP commands and blocks MCP writes', () => {
    const registry = new CapabilityRegistry([{
      id: 'mcp:test',
      kind: 'mcp',
      enabled: true,
      available: true,
      tools: [
        tool('mcp_test_lookup', { sideEffect: 'read-only', toolKind: 'command_execution' }),
        tool('mcp_test_mutate', { toolKind: 'command_execution' })
      ]
    }])
    const planContext = context([], 'plan')

    expect(registry.listTools(planContext).map((spec) => spec.name)).toEqual(['mcp_test_lookup'])
    expect(registry.listTools(planContext)[0]).toMatchObject({ sideEffect: 'read-only' })
    expect(registry.resolveTool('mcp_test_lookup', planContext).tool.name).toBe('mcp_test_lookup')
    expect(() => registry.resolveTool('mcp_test_mutate', planContext))
      .toThrow('tool mcp_test_mutate is not advertised by active tool policy')
  })

  it('fails closed when metadata is missing or conflicts with a read-only name', () => {
    const registry = CapabilityRegistry.fromLocalTools([
      tool('read', { sideEffect: 'unknown' }),
      tool('missing_metadata'),
      tool('bash', { toolKind: 'command_execution' }),
      tool('future_tool', { toolKind: 'tool_call' }),
      tool('lsp', { sideEffect: 'read-only', toolKind: 'command_execution' })
    ])
    const planContext = context([], 'plan')

    expect(registry.listTools(planContext).map((spec) => spec.name)).toEqual(['lsp'])
    for (const name of ['read', 'missing_metadata', 'bash', 'future_tool']) {
      expect(() => registry.resolveTool(name, planContext))
        .toThrow(`tool ${name} is not advertised by active tool policy`)
    }
  })

  it('retains only explicit exceptions and host-classified interactive tools', () => {
    const registry = CapabilityRegistry.fromLocalTools([
      tool('ls', { sideEffect: 'read-only' }),
      tool('glob', { sideEffect: 'read-only' }),
      tool('grep', { sideEffect: 'read-only' }),
      tool('find', { sideEffect: 'read-only' }),
      tool('create_plan', { toolKind: 'file_change' }),
      tool('generate_image', { toolKind: 'file_change' }),
      tool('user_input', { sideEffect: 'read-only' }),
      tool('request_user_input', { sideEffect: 'read-only' }),
      tool('write', { toolKind: 'file_change' })
    ])
    const planContext = context([], 'plan')

    expect(registry.listTools(planContext).map((spec) => spec.name)).toEqual([
      'ls',
      'glob',
      'grep',
      'find',
      'create_plan',
      'generate_image',
      'user_input'
    ])
    expect(registry.resolveTool('request_user_input', planContext).tool.name)
      .toBe('request_user_input')
    expect(() => registry.resolveTool('write', planContext))
      .toThrow('tool write is not advertised by active tool policy')
  })

  it('keeps read-only fast_context visible in plan mode while hiding delegate_task', () => {
    const registry = new CapabilityRegistry([
      {
        id: 'delegation',
        kind: 'delegation',
        enabled: true,
        available: true,
        tools: [tool('delegate_task'), tool('list_subagent_profiles', { sideEffect: 'read-only' })]
      },
      {
        id: 'fast-context',
        kind: 'delegation',
        enabled: true,
        available: true,
        tools: [tool('fast_context', { sideEffect: 'read-only' })]
      }
    ])
    const planContext = context([], 'plan')

    expect(registry.listTools(planContext).map((spec) => spec.name)).toEqual([
      'list_subagent_profiles',
      'fast_context'
    ])
    expect(() => registry.resolveTool('delegate_task', planContext))
      .toThrow('tool delegate_task is not advertised by active tool policy')
  })

  it('agrees with the runtime Plan mode policy for each advertised classification', async () => {
    const tools = [
      tool('read_only', { sideEffect: 'read-only' }),
      tool('bash', { toolKind: 'command_execution' }),
      tool('mcp_call', { toolKind: 'command_execution' }),
      tool('missing_metadata'),
      tool('create_plan', { toolKind: 'file_change' }),
      tool('generate_image', { toolKind: 'file_change' })
    ]
    const registry = CapabilityRegistry.fromLocalTools(tools)
    const planContext = context([], 'plan')
    const advertised = new Set(registry.listTools(planContext).map((spec) => spec.name))

    for (const current of tools) {
      const runtimeBlock = await planModeToolBlock(current, {}, planContext)
      expect(advertised.has(current.name)).toBe(runtimeBlock === null)
    }
  })
})
