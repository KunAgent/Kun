import { describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildMcpToolProviders, type McpClientLike } from './mcp-tool-provider.js'

const context: ToolHostContext = {
  threadId: 'thread_1', turnId: 'turn_1', workspace: '/workspace',
  clientSurface: 'gui', agentSurface: 'code', approvalPolicy: 'auto',
  sandboxMode: 'danger-full-access', abortSignal: new AbortController().signal,
  awaitApproval: async () => 'allow'
}

async function setup(search: boolean) {
  const callTool = vi.fn(async () => ({ ok: true }))
  const client: McpClientLike = {
    listTools: async () => ({ tools: ['browser_snapshot', 'browser_resize', 'lookup'].map((name) => ({
      name, description: name, inputSchema: { type: 'object' }
    })) }),
    callTool, close: async () => undefined
  }
  const config = McpCapabilityConfig.parse({
    enabled: true,
    servers: { renamed_browser: {
      transport: 'stdio', command: 'unused-mock', trustScope: 'user',
      planModeReadOnlyTools: ['browser_snapshot']
    } },
    search: { enabled: search, mode: 'search', minScore: 0 }
  })
  const built = await buildMcpToolProviders(config, { clientFactory: async () => client })
  return { tools: built.providers.flatMap((provider) => provider.tools), callTool }
}

const previewContexts: Partial<ToolHostContext>[] = [
  { agentSurface: 'design' },
  { guiDesignMode: true },
  { designPreviewOnly: true },
  { guiDesignArtifact: { kind: 'html', artifactId: 'page', relativePath: '.kun-design/page.html' } }
]

describe('design preview MCP browser boundary', () => {
  it.each(previewContexts)('blocks direct browser wrappers before any client call: %j', async (overrides) => {
    const { tools, callTool } = await setup(false)
    const preview = { ...context, ...overrides }
    const browser = tools.find((tool) => tool.name === 'mcp_renamed_browser_browser_snapshot')!
    expect(browser.shouldAdvertise?.(preview)).toBe(false)
    await expect(browser.execute({}, preview)).resolves.toMatchObject({ isError: true })
    expect(callTool).not.toHaveBeenCalled()
    const lookup = tools.find((tool) => tool.name === 'mcp_renamed_browser_lookup')!
    expect(lookup.shouldAdvertise?.(preview)).toBe(true)
    await lookup.execute({}, preview)
    expect(callTool).toHaveBeenCalledExactlyOnceWith(
      { name: 'lookup', arguments: {} }, expect.anything()
    )
  })

  it.each([false, true])('blocks call/describe/plan facades even with a known id, search=%s', async (search) => {
    const { tools, callTool } = await setup(search)
    const preview = { ...context, designPreviewOnly: true }
    for (const name of ['mcp_call', 'mcp_read_only_call', 'mcp_describe']) {
      const tool = tools.find((candidate) => candidate.name === name)!
      await expect(tool.execute({
        toolId: 'mcp_renamed_browser_browser_snapshot', arguments: {}
      }, preview)).resolves.toMatchObject({ isError: true })
    }
    const searchTool = tools.find((tool) => tool.name === 'mcp_search')!
    const result = await searchTool.execute({ query: 'browser snapshot', topK: 10 }, preview)
    expect(JSON.stringify(result)).not.toContain('mcp_renamed_browser_browser_snapshot')
    expect(JSON.stringify(result)).not.toContain('mcp_renamed_browser_browser_resize')
    expect(callTool).not.toHaveBeenCalled()
  })

  it.each<Partial<ToolHostContext>>([
    {}, { guiDesignCanvas: true },
    { clientSurface: 'tui', agentSurface: 'design' },
    { clientSurface: 'api', designPreviewOnly: true }
  ])('preserves ordinary Code browsing and non-GUI automation: %j', async (overrides) => {
    const { tools, callTool } = await setup(false)
    const browser = tools.find((tool) => tool.name === 'mcp_renamed_browser_browser_resize')!
    const normal = { ...context, ...overrides }
    expect(browser.shouldAdvertise?.(normal)).toBe(true)
    await browser.execute({}, normal)
    expect(callTool).toHaveBeenCalledOnce()
  })
})
