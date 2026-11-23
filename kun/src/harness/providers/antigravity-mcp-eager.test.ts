import { describe, expect, it } from 'vitest'
import {
  ANTIGRAVITY_EAGER_MAX_BYTES,
  estimateAntigravityMcpToolBytes,
  selectAntigravityMcpToolListMeta
} from './antigravity-mcp-eager.js'
import type { AcpMcpListedTool } from './provider-module.js'

function tool(
  name: string,
  opts: { description?: string; providerKind?: string; providerId?: string; inputSchema?: Record<string, unknown> } = {}
): AcpMcpListedTool {
  return {
    name,
    description: opts.description ?? `Tool ${name}`,
    inputSchema: opts.inputSchema ?? { type: 'object', properties: {} },
    ...(opts.providerKind ? { providerKind: opts.providerKind } : {}),
    ...(opts.providerId ? { providerId: opts.providerId } : {})
  }
}

describe('selectAntigravityMcpToolListMeta', () => {
  it('prioritizes design_open and core GUI/MCP gateway tools over external MCP tools and enforces the byte budget', () => {
    const externalTools = Array.from({ length: 80 }, (_, idx) =>
      tool(`mcp_playwright_action_${idx}`, {
        providerKind: 'mcp',
        providerId: 'mcp:playwright',
        description: 'x'.repeat(400)
      })
    )
    const oversizedBuiltin = tool('browser_use', {
      providerKind: 'built-in',
      description: 'b'.repeat(9_000)
    })
    const designOpen = tool('design_open', {
      providerKind: 'built-in',
      description: 'd'.repeat(3_400)
    })
    const mcpCall = tool('mcp_call', {
      providerKind: 'mcp',
      providerId: 'mcp:search',
      description: 'Call a connected MCP tool'
    })
    const smallSecondary = Array.from({ length: 40 }, (_, idx) =>
      tool(`notes_helper_${idx}`, {
        providerKind: 'built-in',
        description: 'n'.repeat(1_500)
      })
    )

    const catalog = [...externalTools, oversizedBuiltin, ...smallSecondary, mcpCall, designOpen]
    const metas = selectAntigravityMcpToolListMeta(catalog)

    const eagerNames = catalog.filter((_, index) => metas[index]?.['antigravity/alwaysLoad'] === true).map((entry) => entry.name)
    const eagerBytes = catalog
      .filter((_, index) => metas[index]?.['antigravity/alwaysLoad'] === true)
      .reduce((sum, entry) => sum + estimateAntigravityMcpToolBytes(entry), 0)

    expect(eagerNames).toContain('design_open')
    expect(eagerNames).toContain('mcp_call')
    expect(eagerNames.some((name) => name.startsWith('mcp_playwright_'))).toBe(false)
    expect(eagerBytes).toBeLessThanOrEqual(ANTIGRAVITY_EAGER_MAX_BYTES)
    // Leaving non-priority tools unmarked ensures Antigravity exposes lazy loading (`call_mcp_tool`)
    // instead of silently dropping overflowed alwaysLoad entries.
    expect(metas.some((entry) => entry === undefined)).toBe(true)
  })

  it('skips tools whose names exceed Gemini 64-char limit after mcp_kun-tools_ prefixing', () => {
    const longName = 'tool_name_exceeding_fifty_characters_for_gemini_limit'
    const catalog = [tool('design_open'), tool(longName)]
    const metas = selectAntigravityMcpToolListMeta(catalog)
    expect(metas[0]).toEqual({ 'antigravity/alwaysLoad': true })
    expect(metas[1]).toBeUndefined()
  })

  it('respects custom maxBytes and maxTools limits while prioritizing Tier 0 over Tier 2', () => {
    const catalog = [
      tool('custom_filler_a', { description: 'a'.repeat(500) }),
      tool('custom_filler_b', { description: 'b'.repeat(500) }),
      tool('design_open', { description: 'd'.repeat(500) }),
      tool('report_open', { description: 'r'.repeat(500) })
    ]
    const metas = selectAntigravityMcpToolListMeta(catalog, { maxBytes: 1_200, maxTools: 2 })
    expect(metas[0]).toBeUndefined()
    expect(metas[1]).toBeUndefined()
    expect(metas[2]).toEqual({ 'antigravity/alwaysLoad': true })
    expect(metas[3]).toEqual({ 'antigravity/alwaysLoad': true })
  })
})
