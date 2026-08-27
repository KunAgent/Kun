import { describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { LocalToolHost } from './local-tool-host.js'
import { CapabilityRegistry } from './capability-registry.js'

function tool(name: string, sideEffect?: 'read-only' | 'unknown') {
  return LocalToolHost.defineTool({
    name,
    description: name,
    inputSchema: { type: 'object', properties: {} },
    policy: 'auto',
    ...(sideEffect ? { sideEffect } : {}),
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
        tool('read', 'read-only'),
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
      tools: [tool('delegate_task'), tool('list_subagent_profiles', 'read-only')]
    },
    {
      id: 'fast-context',
      kind: 'delegation' as const,
      enabled: true,
      available: true,
      tools: [tool('fast_context', 'read-only')]
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
      tools: [tool('generate_image')]
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

  it('allows host-classified read-only tools and blocks unknown external tools', () => {
    const registry = new CapabilityRegistry([{
      id: 'mcp:test',
      kind: 'mcp',
      enabled: true,
      available: true,
      tools: [tool('mcp_test_lookup', 'read-only'), tool('mcp_test_mutate')]
    }])
    const planContext = context([], 'plan')

    expect(registry.listTools(planContext).map((spec) => spec.name)).toEqual(['mcp_test_lookup'])
    expect(registry.listTools(planContext)[0]).toMatchObject({ sideEffect: 'read-only' })
    expect(() => registry.resolveTool('mcp_test_mutate', planContext))
      .toThrow('tool mcp_test_mutate is not advertised by active tool policy')
  })

  it('hides generic file mutation tools while retaining create_plan and user input', () => {
    const registry = CapabilityRegistry.fromLocalTools([
      tool('read', 'read-only'),
      tool('write'),
      tool('edit'),
      tool('generate_image'),
      tool('create_plan'),
      tool('user_input'),
      tool('request_user_input')
    ])
    const planContext = context([], 'plan')

    expect(registry.listTools(planContext).map((spec) => spec.name)).toEqual([
      'read',
      'generate_image',
      'create_plan',
      'user_input'
    ])
    expect(registry.resolveTool('request_user_input', planContext).tool.name)
      .toBe('request_user_input')
    expect(registry.resolveTool('generate_image', planContext).provider.id).toBe('builtin')
    for (const name of ['write', 'edit']) {
      expect(() => registry.resolveTool(name, planContext))
        .toThrow(`tool ${name} is not advertised by active tool policy`)
    }
  })

  it('advertises the legacy user-input name only when the canonical name is unavailable', () => {
    const legacyOnly = CapabilityRegistry.fromLocalTools([tool('request_user_input')])
    const onlyLegacyAllowed = CapabilityRegistry.fromLocalTools([
      tool('user_input'),
      tool('request_user_input')
    ])
    const agentContext = context([], 'agent')

    expect(legacyOnly.listTools(agentContext).map((spec) => spec.name))
      .toEqual(['request_user_input'])
    expect(onlyLegacyAllowed.listTools({
      ...agentContext,
      allowedToolNames: ['request_user_input']
    }).map((spec) => spec.name)).toEqual(['request_user_input'])
  })

  it('keeps read-only fast_context visible in plan mode while hiding delegate_task', () => {
    const registry = new CapabilityRegistry([
      {
        id: 'delegation',
        kind: 'delegation',
        enabled: true,
        available: true,
        tools: [tool('delegate_task'), tool('list_subagent_profiles', 'read-only')]
      },
      {
        id: 'fast-context',
        kind: 'delegation',
        enabled: true,
        available: true,
        tools: [tool('fast_context', 'read-only')]
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
})
