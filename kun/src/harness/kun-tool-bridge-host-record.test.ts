import { describe, expect, it } from 'vitest'
import { createKunToolBridgeHost } from './kun-tool-bridge-host.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { WorkspaceRootSet } from '../runtime/workspace-roots.js'
import type { ToolHostContext, ToolHost } from '../ports/tool-host.js'

const thread = {
  id: 'thread_1',
  title: 'Bridge',
  workspace: '/workspace',
  model: 'm1',
  status: 'active',
  turns: [{
    id: 'turn_1',
    threadId: 'thread_1',
    status: 'running',
    prompt: 'design it',
    harnessId: 'codex',
    actingModelRoute: { model: 'm1', providerId: 'deepseek' }
  }]
} as unknown as ThreadRecord

function hostFor(
  output: unknown,
  isError = false,
  current = thread,
  workspaceRootsForTurn?: (threadId: string, turnId: string) => WorkspaceRootSet | undefined,
  opts?: { meta?: Record<string, unknown>; recordAppSurfaceResultItems?: boolean }
) {
  const contexts: ToolHostContext[] = []
  const applied: Array<{ id: string; toolName?: string; output?: unknown; meta?: Record<string, unknown> }> = []
  const toolHost: ToolHost = {
    id: 'fake',
    listTools: async () => [],
    execute: async (call, context) => {
      contexts.push(context)
      return {
        item: {
          kind: 'tool_result',
          id: 'item_native',
          toolName: call.toolName,
          output,
          isError,
          ...(opts?.meta ? { meta: opts.meta } : {})
        },
        approved: false
      } as never
    }
  }
  const host = createKunToolBridgeHost({
    workspaceRootsForTurn,
    threadStore: { get: async () => current } as never,
    sessionStore: {} as never,
    registry: { listTools: () => [] } as never,
    toolHost,
    turns: { applyItem: async (_threadId: string, item: never) => { applied.push(item) }, updateItem: async () => {} } as never,
    events: { record: async () => undefined } as never,
    ids: { next: (prefix: string) => `${prefix}_7` },
    defaultApprovalPolicy: 'never',
    recordResultItemTools: new Set(['design_open']),
    ...(opts?.recordAppSurfaceResultItems ? { recordAppSurfaceResultItems: true } : {})
  })
  return { host, applied, contexts }
}

describe('KunToolBridgeHost result item recording', () => {
  it('applies the Kun result item of a listed tool to the running turn', async () => {
    const { host, applied } = hostFor({ ok: true, designRequest: { title: 'Toast' } })
    const result = await host.execute('thread_1', 'turn_1', {
      toolName: 'design_open', args: {}, callId: 'mcp_3', signal: new AbortController().signal
    })
    expect(result.isError).toBe(false)
    expect(applied).toEqual([expect.objectContaining({
      id: 'item_toolresult_turn_1_mcp_3_kun_7',
      toolName: 'design_open',
      output: { ok: true, designRequest: { title: 'Toast' } }
    })])
  })

  it('records nothing for other tools or failed calls', async () => {
    const other = hostFor('ok')
    await other.host.execute('thread_1', 'turn_1', { toolName: 'memory_search', args: {}, callId: 'c', signal: new AbortController().signal })
    expect(other.applied).toEqual([])
    const failed = hostFor('screen "A" needs html', true)
    await failed.host.execute('thread_1', 'turn_1', { toolName: 'design_open', args: {}, callId: 'c', signal: new AbortController().signal })
    expect(failed.applied).toEqual([])
  })

  it('records MCP App and Gen UI sideband results when recordAppSurfaceResultItems is enabled', async () => {
    const mcpApp = {
      serverId: 'kun_canvas',
      toolName: 'canvas_create',
      resourceUri: 'ui://kun-canvas/index.html',
      surface: 'canvas'
    }
    const direct = hostFor(
      { serverId: 'kun_canvas', toolName: 'canvas_create', result: { structuredContent: { boardId: 'cb_1' } } },
      false,
      thread,
      undefined,
      { meta: { mcpApp }, recordAppSurfaceResultItems: true }
    )
    await direct.host.execute('thread_1', 'turn_1', {
      toolName: 'mcp_kun_canvas_canvas_create',
      args: { title: 'Notebook Redesign' },
      callId: 'mcp_9',
      signal: new AbortController().signal
    })
    expect(direct.applied).toEqual([expect.objectContaining({
      id: 'item_toolresult_turn_1_mcp_9_kun_7',
      toolName: 'mcp_kun_canvas_canvas_create',
      meta: { mcpApp, mcpAppArguments: { title: 'Notebook Redesign' } }
    })])

    const viaMcpCall = hostFor(
      { serverId: 'kun_canvas', toolName: 'canvas_open', result: { structuredContent: { boardId: 'cb_1' } } },
      false,
      thread,
      undefined,
      { meta: { mcpApp: { ...mcpApp, toolName: 'canvas_open' } }, recordAppSurfaceResultItems: true }
    )
    await viaMcpCall.host.execute('thread_1', 'turn_1', {
      toolName: 'mcp_call',
      args: { toolId: 'mcp_kun_canvas_canvas_open', arguments: { boardId: 'cb_1' } },
      callId: 'mcp_10',
      signal: new AbortController().signal
    })
    expect(viaMcpCall.applied[0]?.meta).toEqual({
      mcpApp: { ...mcpApp, toolName: 'canvas_open' },
      mcpAppArguments: { boardId: 'cb_1' }
    })

    const genUiMeta = { genUi: { widgetId: 'gw_1', sha256: 'a'.repeat(64), bytes: 12, title: 'W', mode: 'inline' } }
    const widgetHost = hostFor({ ok: true }, false, thread, undefined, { meta: genUiMeta, recordAppSurfaceResultItems: true })
    await widgetHost.host.execute('thread_1', 'turn_1', {
      toolName: 'render_widget',
      args: {},
      callId: 'mcp_11',
      signal: new AbortController().signal
    })
    expect(widgetHost.applied).toHaveLength(1)
    expect(widgetHost.applied[0]?.meta).toEqual(genUiMeta)

    const disabled = hostFor({ ok: true }, false, thread, undefined, { meta: { mcpApp } })
    await disabled.host.execute('thread_1', 'turn_1', {
      toolName: 'mcp_kun_canvas_canvas_create',
      args: { title: 'Disabled' },
      callId: 'mcp_12',
      signal: new AbortController().signal
    })
    expect(disabled.applied).toEqual([])
  })
})


describe('Kun tool bridge workspace snapshot', () => {
  it.each(['sdk-listing', 'mcp-direct'] as const)('uses the launch roots for %s despite later metadata changes', async (entry) => {
    const current = { ...thread, additionalWorkspaces: ['/raw-extra'] }
    const roots: WorkspaceRootSet = { primary: '/canonical-repo', roots: ['/canonical-repo', '/canonical-extra'],
      extras: ['/canonical-extra'], identity: '["/canonical-repo","/canonical-extra"]' }
    const { host, contexts } = hostFor('ok', false, current, entry === 'mcp-direct' ? () => roots : undefined)
    if (entry === 'sdk-listing') {
      await host.resolveTurnScope(current.id, 'turn_1', { workspaceRoots: roots })
    }
    const call = { toolName: 'read', args: {}, signal: new AbortController().signal }
    expect((await host.execute(current.id, 'turn_1', call)).isError).toBe(false)
    current.workspace = '/new-repo'
    current.additionalWorkspaces = ['/new-extra']
    expect((await host.execute(current.id, 'turn_1', call)).isError).toBe(false)
    expect(contexts).toHaveLength(2)
    for (const context of contexts) {
      expect(context.workspace).toBe(roots.primary)
      expect(context.additionalWorkspaces).toEqual(roots.extras)
    }
  })
})
