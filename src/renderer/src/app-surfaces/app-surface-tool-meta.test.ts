import { describe, expect, it } from 'vitest'
import type { ToolBlock } from '../agent/types'
import {
  applyAppSurfaceToolMeta,
  boundedMcpToolResult,
  genUiRefFromBlock,
  isAppSurfaceBlock,
  mcpAppArgumentsFromBlock,
  mcpAppFromBlock
} from './app-surface-tool-meta'

const widget = {
  widgetId: `gw_${'a'.repeat(64)}`,
  sha256: 'a'.repeat(64),
  bytes: 10,
  title: 'Explorer',
  mode: 'inline'
}

function block(meta: Record<string, unknown>, status: ToolBlock['status'] = 'success'): ToolBlock {
  return { kind: 'tool', id: 'tool_1', summary: 'x', status, meta }
}

describe('app surface tool meta', () => {
  it('projects Gen UI widgets from the result sideband only', () => {
    const meta: Record<string, unknown> = {}
    applyAppSurfaceToolMeta(meta, { kind: 'tool_result', toolName: 'render_widget', output: { genUi: widget }, meta: { genUi: widget } })
    expect(genUiRefFromBlock(block(meta))).toEqual(widget)
    const fromOutput: Record<string, unknown> = {}
    applyAppSurfaceToolMeta(fromOutput, { kind: 'tool_result', toolName: 'render_widget', output: { genUi: widget } })
    expect(fromOutput.genUi).toBeUndefined()
    const failed: Record<string, unknown> = {}
    applyAppSurfaceToolMeta(failed, { kind: 'tool_result', isError: true, meta: { genUi: widget } })
    expect(failed.genUi).toBeUndefined()
  })

  it('merges MCP App arguments from the call with the bounded result', () => {
    const meta: Record<string, unknown> = {}
    applyAppSurfaceToolMeta(meta, { kind: 'tool_call', toolName: 'mcp_kun_canvas_canvas_create', arguments: { title: 'A' } })
    applyAppSurfaceToolMeta(meta, {
      kind: 'tool_result',
      toolName: 'mcp_kun_canvas_canvas_create',
      output: { result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { boardId: 'cb_1' }, extra: 'drop' } },
      meta: { mcpApp: { serverId: 'kun_canvas', toolName: 'canvas_create', resourceUri: 'ui://kun-canvas/index.html', surface: 'canvas' } }
    })
    const app = mcpAppFromBlock(block(meta))
    expect(app).toMatchObject({ serverId: 'kun_canvas', surface: 'canvas', result: { structuredContent: { boardId: 'cb_1' } } })
    expect(app?.result).not.toHaveProperty('extra')
    expect(mcpAppArgumentsFromBlock(block(meta))).toEqual({ title: 'A' })
    expect(isAppSurfaceBlock(block(meta))).toBe(true)
    expect(isAppSurfaceBlock(block(meta, 'running'))).toBe(false)
  })

  it('reads fallback MCP App arguments from recorded tool_result sidebands and mcp_read_only_call', () => {
    const standalone: Record<string, unknown> = {}
    applyAppSurfaceToolMeta(standalone, {
      kind: 'tool_result',
      toolName: 'mcp_kun_canvas_canvas_open',
      output: { result: { structuredContent: { boardId: 'cb_9' } } },
      meta: {
        mcpApp: { serverId: 'kun_canvas', toolName: 'canvas_open', resourceUri: 'ui://kun-canvas/index.html', surface: 'canvas' },
        mcpAppArguments: { boardId: 'cb_9' }
      }
    })
    expect(mcpAppArgumentsFromBlock(block(standalone))).toEqual({ boardId: 'cb_9' })
    expect(mcpAppFromBlock(block(standalone))).toMatchObject({
      serverId: 'kun_canvas',
      toolName: 'canvas_open',
      result: { structuredContent: { boardId: 'cb_9' } }
    })

    const readOnly: Record<string, unknown> = {}
    applyAppSurfaceToolMeta(readOnly, {
      kind: 'tool_call',
      toolName: 'mcp_read_only_call',
      arguments: { toolId: 'mcp_kun_canvas_canvas_read', arguments: { boardId: 'cb_9' } }
    })
    expect(mcpAppArgumentsFromBlock(block(readOnly))).toEqual({ boardId: 'cb_9' })
  })

  it('omits oversized result fields so pages re-read from their server', () => {
    const bounded = boundedMcpToolResult({ structuredContent: { big: 'x'.repeat(70_000) }, content: [], isError: true })
    expect(bounded.omitted).toEqual(['structuredContent'])
    expect(bounded.result).toEqual({ content: [], isError: true })
  })
})
