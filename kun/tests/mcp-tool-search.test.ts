import { describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { canUseMcpServer } from '../src/adapters/tool/mcp-tool-provider.js'
import {
  createMcpSearchProvider,
  type McpSearchCatalogRecord
} from '../src/adapters/tool/mcp-tool-search.js'
import { KunCapabilitiesConfig, McpServerConfig } from '../src/contracts/capabilities.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'

const SEARCH_CONFIG = KunCapabilitiesConfig.parse({
  mcp: { enabled: true, search: { enabled: true, mode: 'search' } }
}).mcp.search

const SERVER = McpServerConfig.parse({ transport: 'stdio', command: 'noop', trustScope: 'user' })

function record(
  serverId: string,
  toolName: string,
  calls: string[],
  server: McpServerConfig = SERVER
): McpSearchCatalogRecord {
  return {
    toolId: `${serverId}/${toolName}`,
    serverId,
    server,
    client: {
      async callTool(input) {
        calls.push(`${serverId}/${input.name}`)
        return { ok: true }
      }
    },
    descriptor: { name: toolName, description: `${toolName} on ${serverId}` },
    normalizedName: `mcp_${serverId}_${toolName}`,
    policy: 'auto'
  }
}

function ctx(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 't',
    turnId: 'u',
    workspace: '/ws',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...overrides
  }
}

describe('MCP search provider honors blockedProviderIds', () => {
  it('hides a blocked server from mcp_search/mcp_describe/mcp_call but leaves others reachable', async () => {
    const calls: string[] = []
    const records = [record('github', 'create_issue', calls), record('files', 'read_file', calls)]
    const host = new LocalToolHost({
      registry: new CapabilityRegistry([
        createMcpSearchProvider({
          config: SEARCH_CONFIG,
          state: { records },
          refreshCatalog: async () => records,
          isServerAvailable: () => true
        })
      ])
    })
    const blocked = ctx({ blockedProviderIds: ['mcp:github'] })

    // mcp_search must not surface the blocked server's tool, and reports a
    // reduced searched-tools count.
    const search = await host.execute(
      { callId: 'c0', toolName: 'mcp_search', arguments: { query: 'create issue github' } },
      blocked
    )
    expect(search.item.kind).toBe('tool_result')
    if (search.item.kind === 'tool_result') {
      const output = search.item.output as { searchedTools: number; results: Array<{ serverId: string }> }
      expect(output.searchedTools).toBe(1)
      expect(output.results.every((r) => r.serverId !== 'github')).toBe(true)
    }

    // mcp_describe (schema disclosure) is refused for the blocked server.
    const describeBlocked = await host.execute(
      { callId: 'c1', toolName: 'mcp_describe', arguments: { toolId: 'github/create_issue' } },
      blocked
    )
    expect(describeBlocked.item).toMatchObject({ kind: 'tool_result', isError: true })

    // mcp_call (execution) is refused AND the underlying client is never invoked.
    const callBlocked = await host.execute(
      { callId: 'c2', toolName: 'mcp_call', arguments: { toolId: 'github/create_issue', arguments: {} } },
      blocked
    )
    expect(callBlocked.item).toMatchObject({ kind: 'tool_result', isError: true })
    expect(calls).toEqual([])

    // A non-blocked server still works.
    const callOk = await host.execute(
      { callId: 'c3', toolName: 'mcp_call', arguments: { toolId: 'files/read_file', arguments: {} } },
      blocked
    )
    expect(callOk.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(calls).toEqual(['files/read_file'])

    // Without a deny-list the blocked server is reachable again (the deny is
    // per-turn, not baked into the catalog).
    const callDefault = await host.execute(
      { callId: 'c4', toolName: 'mcp_call', arguments: { toolId: 'github/create_issue', arguments: {} } },
      ctx()
    )
    expect(callDefault.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(calls).toEqual(['files/read_file', 'github/create_issue'])
  })
})

describe('MCP search provider honors workspace visibility roots', () => {
  it('hides scoped servers from search, describe, and call outside matching workspaces', async () => {
    const calls: string[] = []
    const scopedServer = McpServerConfig.parse({
      transport: 'stdio',
      command: 'noop',
      workspaceRoots: ['/ws/project'],
      trustScope: 'user'
    })
    const records = [
      record('codegraph-a', 'read_symbol', calls, scopedServer),
      record('global', 'read_file', calls)
    ]
    const host = new LocalToolHost({
      registry: new CapabilityRegistry([
        createMcpSearchProvider({
          config: SEARCH_CONFIG,
          state: { records },
          refreshCatalog: async () => records,
          isServerAvailable: canUseMcpServer
        })
      ])
    })

    const outside = ctx({ workspace: '/ws/other' })
    const search = await host.execute(
      { callId: 'c0', toolName: 'mcp_search', arguments: { query: 'read symbol' } },
      outside
    )
    expect(search.item.kind).toBe('tool_result')
    if (search.item.kind === 'tool_result') {
      const output = search.item.output as { searchedTools: number; results: Array<{ serverId: string }> }
      expect(output.searchedTools).toBe(1)
      expect(output.results.every((result) => result.serverId !== 'codegraph-a')).toBe(true)
    }

    const describeBlocked = await host.execute(
      { callId: 'c1', toolName: 'mcp_describe', arguments: { toolId: 'codegraph-a/read_symbol' } },
      outside
    )
    expect(describeBlocked.item).toMatchObject({ kind: 'tool_result', isError: true })

    const callBlocked = await host.execute(
      { callId: 'c2', toolName: 'mcp_call', arguments: { toolId: 'codegraph-a/read_symbol', arguments: {} } },
      outside
    )
    expect(callBlocked.item).toMatchObject({ kind: 'tool_result', isError: true })
    expect(calls).toEqual([])

    const describeInside = await host.execute(
      { callId: 'c3', toolName: 'mcp_describe', arguments: { toolId: 'codegraph-a/read_symbol' } },
      ctx({ workspace: '/ws/project/sub' })
    )
    expect(describeInside.item).toMatchObject({ kind: 'tool_result', isError: false })
  })
})

describe('MCP search provider freezes its virtual catalog per turn', () => {
  it('defers refreshed tools and schema changes until the next turn', async () => {
    const calls: string[] = []
    const original = record('github', 'search_issues', calls)
    original.descriptor.description = 'Search issues with the old schema'
    const replacement = record('github', 'search_issues', calls)
    replacement.descriptor.description = 'Search issues with the new schema'
    replacement.descriptor.inputSchema = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query']
    }
    const added = record('github', 'create_issue', calls)
    const state = { records: [original] }
    const host = new LocalToolHost({
      registry: new CapabilityRegistry([
        createMcpSearchProvider({
          config: SEARCH_CONFIG,
          state,
          refreshCatalog: async () => {
            state.records = [replacement, added]
            return state.records
          },
          isServerAvailable: () => true
        })
      ])
    })
    const firstTurn = ctx({ turnId: 'turn_1' })

    const before = await host.execute(
      { callId: 'c0', toolName: 'mcp_describe', arguments: { toolId: 'github/search_issues' } },
      firstTurn
    )
    expect(before.item.kind === 'tool_result' ? before.item.output : {}).toMatchObject({
      description: 'Search issues with the old schema'
    })

    const refresh = await host.execute(
      { callId: 'c1', toolName: 'mcp_refresh_catalog', arguments: {} },
      firstTurn
    )
    expect(refresh.item.kind === 'tool_result' ? refresh.item.output : {}).toMatchObject({
      totalIndexed: 2,
      catalogUpdatePending: true
    })

    const stillFrozen = await host.execute(
      { callId: 'c2', toolName: 'mcp_describe', arguments: { toolId: 'github/search_issues' } },
      firstTurn
    )
    expect(stillFrozen.item.kind === 'tool_result' ? stillFrozen.item.output : {}).toMatchObject({
      description: 'Search issues with the old schema'
    })
    const hiddenUntilNextTurn = await host.execute(
      { callId: 'c3', toolName: 'mcp_call', arguments: { toolId: 'github/create_issue', arguments: {} } },
      firstTurn
    )
    expect(hiddenUntilNextTurn.item).toMatchObject({ kind: 'tool_result', isError: true })
    expect(calls).toEqual([])

    const nextTurn = ctx({ turnId: 'turn_2' })
    const updated = await host.execute(
      { callId: 'c4', toolName: 'mcp_describe', arguments: { toolId: 'github/search_issues' } },
      nextTurn
    )
    expect(updated.item.kind === 'tool_result' ? updated.item.output : {}).toMatchObject({
      description: 'Search issues with the new schema',
      inputSchema: { required: ['query'] }
    })
    const callable = await host.execute(
      { callId: 'c5', toolName: 'mcp_call', arguments: { toolId: 'github/create_issue', arguments: {} } },
      nextTurn
    )
    expect(callable.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(calls).toEqual(['github/create_issue'])
  })
})
