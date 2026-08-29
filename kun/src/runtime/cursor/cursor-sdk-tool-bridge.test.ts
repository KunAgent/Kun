import { describe, expect, test, vi } from 'vitest'
import { CapabilityRegistry } from '../../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  buildCursorCustomTools,
  selectCursorBridgeTools,
  type CursorBridgeTool
} from './cursor-sdk-tool-bridge.js'

const tools: CursorBridgeTool[] = [{
  name: 'mcp_call_tool',
  description: 'Call an MCP tool',
  toolKind: 'tool_call',
  inputSchema: {
    type: 'object',
    properties: { serverId: { type: 'string' } },
    required: ['serverId']
  },
  providerId: 'mcp:facade',
  providerKind: 'mcp'
}, {
  name: 'extension_render',
  description: 'Render through an extension',
  toolKind: 'tool_call',
  inputSchema: { type: 'object' },
  providerId: 'extension:render',
  providerKind: 'extension'
}, {
  name: 'render_chart',
  description: 'Render a governed chart',
  toolKind: 'tool_call',
  inputSchema: { type: 'object' },
  providerId: 'chart',
  providerKind: 'gui'
}, {
  name: 'read',
  description: 'Overlaps Cursor built-in read',
  toolKind: 'tool_call',
  inputSchema: { type: 'object' },
  providerId: 'builtin',
  providerKind: 'built-in'
}, {
  name: 'bash',
  description: 'Overlaps Cursor built-in shell',
  toolKind: 'command_execution',
  inputSchema: { type: 'object' },
  providerId: 'builtin',
  providerKind: 'built-in'
}, {
  name: 'edit',
  description: 'Overlaps Cursor built-in edit',
  toolKind: 'file_change',
  inputSchema: { type: 'object' },
  providerId: 'builtin',
  providerKind: 'built-in'
}, {
  name: 'write',
  description: 'Overlaps Cursor built-in write',
  toolKind: 'file_change',
  inputSchema: { type: 'object' },
  providerId: 'builtin',
  providerKind: 'built-in'
}, {
  name: 'grep',
  description: 'Overlaps Cursor built-in grep',
  toolKind: 'tool_call',
  inputSchema: { type: 'object' },
  providerId: 'builtin',
  providerKind: 'built-in'
}, {
  name: 'glob',
  description: 'Overlaps Cursor built-in glob',
  toolKind: 'tool_call',
  inputSchema: { type: 'object' },
  providerId: 'builtin',
  providerKind: 'built-in'
}, {
  name: 'find',
  description: 'Overlaps Cursor built-in find',
  toolKind: 'tool_call',
  inputSchema: { type: 'object' },
  providerId: 'builtin',
  providerKind: 'built-in'
}, {
  name: 'ls',
  description: 'Overlaps Cursor built-in ls',
  toolKind: 'tool_call',
  inputSchema: { type: 'object' },
  providerId: 'builtin',
  providerKind: 'built-in'
}, {
  name: '  padded_tool  ',
  description: 'Padded name',
  toolKind: 'command_execution',
  inputSchema: { type: 'object' },
  providerId: 'builtin',
  providerKind: 'built-in'
}, {
  name: 'echo',
  description: 'Internal echo',
  inputSchema: { type: 'object' },
  providerId: 'builtin',
  providerKind: 'built-in'
}]

const toolContext: ToolHostContext = {
  threadId: 'thread_1',
  turnId: 'turn_1',
  workspace: '/workspace',
  approvalPolicy: 'auto',
  sandboxMode: 'danger-full-access',
  abortSignal: new AbortController().signal,
  awaitApproval: async () => 'allow'
}

function localTool(name: string) {
  return LocalToolHost.defineTool({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object' },
    policy: 'auto',
    execute: async () => ({ output: null })
  })
}

describe('Cursor SDK Kun custom-tool bridge', () => {
  test('bridges Kun-exclusive tools while excluding overlap and internal-only tools', () => {
    expect(selectCursorBridgeTools(tools).map((tool) => [
      tool.name,
      tool.toolKind,
      tool.providerId,
      tool.providerKind
    ])).toEqual([
      ['mcp_call_tool', 'tool_call', 'mcp:facade', 'mcp'],
      ['extension_render', 'tool_call', 'extension:render', 'extension'],
      ['render_chart', 'tool_call', 'chart', 'gui'],
      ['  padded_tool  ', 'command_execution', 'builtin', 'built-in']
    ])
  })

  test('receives one canonical input tool with a legacy-only fallback', () => {
    const both = CapabilityRegistry.fromLocalTools([
      localTool('user_input'),
      localTool('request_user_input')
    ])
    const legacy = CapabilityRegistry.fromLocalTools([localTool('request_user_input')])

    expect(selectCursorBridgeTools(both.listTools(toolContext)).map((entry) => entry.name))
      .toEqual(['user_input'])
    expect(selectCursorBridgeTools(legacy.listTools(toolContext)).map((entry) => entry.name))
      .toEqual(['request_user_input'])
  })

  test('does not advertise overlapping Cursor built-ins as custom tools', () => {
    const customTools = buildCursorCustomTools(tools, async () => ({ output: 'ok' }))
    for (const name of ['read', 'bash', 'edit', 'write', 'grep', 'glob', 'find', 'ls', 'echo']) {
      expect(customTools[name]).toBeUndefined()
    }
    expect(customTools.mcp_call_tool).toBeDefined()
    expect(customTools.extension_render).toBeDefined()
    expect(customTools.render_chart).toBeDefined()
  })

  test('maps Cursor callbacks to Kun execution and preserves call identity and provenance', async () => {
    const execute = vi.fn(async () => ({
      output: { ok: true, value: 42 }
    }))
    const customTools = buildCursorCustomTools(tools, execute)

    await expect(customTools.mcp_call_tool?.execute(
      { serverId: 'docs' },
      { toolCallId: 'cursor-call-1' }
    )).resolves.toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, value: 42 }, null, 2)
      }]
    })
    expect(execute).toHaveBeenCalledWith({
      toolName: 'mcp_call_tool',
      args: { serverId: 'docs' },
      toolCallId: 'cursor-call-1',
      providerId: 'mcp:facade',
      toolKind: 'tool_call'
    })
    expect(customTools.mcp_call_tool?.inputSchema).toMatchObject({
      required: ['serverId']
    })
    expect(customTools.echo).toBeUndefined()
  })

  test('normalizes padded tool names so the SDK key and Kun lookup agree', async () => {
    const execute = vi.fn(async () => ({ output: 'ok' }))
    const customTools = buildCursorCustomTools(tools, execute)

    expect(customTools.padded_tool).toBeDefined()
    expect(customTools['  padded_tool  ']).toBeUndefined()
    await customTools.padded_tool?.execute({}, {})
    expect(execute).toHaveBeenCalledWith({
      toolName: 'padded_tool',
      args: {},
      providerId: 'builtin',
      toolKind: 'command_execution'
    })
  })

  test('returns callback failures to Cursor as tool errors', async () => {
    const customTools = buildCursorCustomTools(tools, async () => {
      throw new Error('MCP disconnected')
    })
    await expect(customTools.mcp_call_tool?.execute({}, {})).resolves.toEqual({
      content: [{
        type: 'text',
        text: 'Kun tool "mcp_call_tool" failed: MCP disconnected'
      }],
      isError: true
    })
  })
})
