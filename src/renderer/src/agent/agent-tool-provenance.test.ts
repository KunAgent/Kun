import { describe, expect, it } from 'vitest'
import {
  groupToolsByProvenance,
  resolveToolProvenance
} from './agent-tool-provenance'

describe('Agent Perspective tool provenance', () => {
  it('maps exact Kun, managed MCP, extension, and unknown providers', () => {
    expect(resolveToolProvenance('read', [
      { name: 'read', providerKind: 'built-in', providerId: 'builtin' }
    ])).toMatchObject({ source: 'kun', category: 'kun-core', inferred: false })
    expect(resolveToolProvenance('design_canvas', [
      { name: 'design_canvas', providerKind: 'gui', providerId: 'design-canvas' }
    ])).toMatchObject({ source: 'kun', category: 'kun-gui', inferred: false })
    expect(resolveToolProvenance('web_search', [
      { name: 'web_search', providerKind: 'web', providerId: 'web' }
    ])).toMatchObject({ source: 'kun', category: 'kun-runtime', inferred: false })
    expect(resolveToolProvenance('schedule_create', [
      { name: 'schedule_create', providerKind: 'mcp', providerId: 'mcp:gui_schedule' }
    ])).toMatchObject({
      source: 'mcp', providerName: 'gui_schedule', management: 'kun-managed', inferred: false
    })
    expect(resolveToolProvenance('issue_read', [
      { name: 'issue_read', providerKind: 'mcp', providerId: 'mcp:github' }
    ])).toMatchObject({
      source: 'mcp', providerName: 'github', inferred: false
    })
    expect(resolveToolProvenance('issue_read', [
      { name: 'issue_read', providerKind: 'mcp', providerId: 'mcp:github' }
    ])).not.toHaveProperty('management')
    expect(resolveToolProvenance('mcp_search', [
      { name: 'mcp_search', providerKind: 'mcp', providerId: 'mcp:search' }
    ])).toMatchObject({ source: 'mcp', management: 'discovery' })
    expect(resolveToolProvenance('slides_export', [
      { name: 'slides_export', providerKind: 'extension', providerId: 'extension:slides' }
    ])).toMatchObject({ source: 'extension', providerName: 'slides', inferred: false })
    expect(resolveToolProvenance('future_tool', [
      { name: 'future_tool', providerKind: 'future', providerId: 'future:one' }
    ])).toMatchObject({ source: 'unclassified', providerKind: 'future', inferred: false })
  })

  it('uses conservative and explicitly marked inference only without a catalog', () => {
    expect(resolveToolProvenance('read', undefined)).toMatchObject({
      source: 'kun', category: 'kun-core', inferred: true
    })
    expect(resolveToolProvenance('git_inspect', undefined)).toMatchObject({
      source: 'kun', category: 'kun-core', inferred: true
    })
    expect(resolveToolProvenance('design_svg_edit', undefined)).toMatchObject({
      source: 'kun', category: 'kun-gui', inferred: true
    })
    expect(resolveToolProvenance('browser_use', undefined)).toMatchObject({
      source: 'kun', category: 'kun-gui', inferred: true
    })
    expect(resolveToolProvenance('fast_context', undefined)).toMatchObject({
      source: 'kun', category: 'kun-runtime', inferred: true
    })
    expect(resolveToolProvenance('mcp_filesystem_read', undefined)).toMatchObject({
      source: 'mcp', category: 'mcp-server', inferred: true
    })
    expect(resolveToolProvenance('custom_unknown', undefined)).toMatchObject({
      source: 'unclassified', inferred: true
    })
    expect(resolveToolProvenance('read', [])).toMatchObject({
      source: 'unclassified', inferred: false
    })
  })

  it('groups tools in stable source and provider order', () => {
    const tools = [
      ['unknown', resolveToolProvenance('unknown', undefined)],
      ['ext', resolveToolProvenance('ext', [{ name: 'ext', providerKind: 'extension', providerId: 'extension:zeta' }])],
      ['mcp-z', resolveToolProvenance('mcp-z', [{ name: 'mcp-z', providerKind: 'mcp', providerId: 'mcp:zeta' }])],
      ['mcp-a', resolveToolProvenance('mcp-a', [{ name: 'mcp-a', providerKind: 'mcp', providerId: 'mcp:alpha' }])],
      ['gui', resolveToolProvenance('gui', [{ name: 'gui', providerKind: 'gui', providerId: 'goal' }])],
      ['core', resolveToolProvenance('core', [{ name: 'core', providerKind: 'built-in', providerId: 'builtin' }])]
    ].map(([name, provenance]) => ({ name: name as string, provenance: provenance as ReturnType<typeof resolveToolProvenance> }))

    const groups = groupToolsByProvenance(tools)

    expect(groups.map((group) => group.source)).toEqual(['kun', 'mcp', 'extension', 'unclassified'])
    expect(groups[0].subgroups.map((group) => group.category)).toEqual(['kun-core', 'kun-gui'])
    expect(groups[1].subgroups.map((group) => group.providerName)).toEqual(['alpha', 'zeta'])
  })
})
