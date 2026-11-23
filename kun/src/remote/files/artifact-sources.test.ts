import { describe, expect, it } from 'vitest'
import { artifactSources as artifactSourcesFromItem, mergeArtifactSources, type ArtifactToolItem } from './artifact-sources.js'

const item = (toolName: string, output: unknown, meta?: unknown): ArtifactToolItem => ({
  id: 'result-1', kind: 'tool_result', toolName, output, meta, turnId: 'turn-1', createdAt: '2026-11-09T00:00:00.000Z'
})
const screen = (artifactId: string, name: string) => ({
  artifactId, name, relativePath: `.kun-design/1234abcd/${artifactId}/v1.html`, width: 390, height: 844
})
const design = (screens: unknown[]) => ({ designRequest: {
  version: 2, status: 'ready', documentId: '1234abcd', title: 'Mobile screens', screens
} })

describe('artifact source extraction', () => {
  it('recognizes real native and delegated tool payloads without depending on renderer metadata', () => {
    const payload = design([screen('1111aaaa', 'Home')])
    for (const name of ['design_open', 'mcp__kun__design_open', 'mcp:kun/design_open']) {
      const wrapped = name === 'design_open' ? payload : { content: [{ type: 'text', text: JSON.stringify(payload) }] }
      const result = artifactSourcesFromItem(item(name, wrapped))
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ kind: 'design', key: 'design:1234abcd', pages: [{ id: '1111aaaa', title: 'Home' }] })
    }
  })

  it('merges the same design and replaces a rewritten page without discarding other calls', () => {
    const earlier = item('design_open', design([screen('1111aaaa', 'Home'), screen('2222bbbb', 'Detail')]))
    const later = { ...item('design_open', design([screen('1111aaaa', 'Home revised')])), id: 'result-2' }
    const merged = mergeArtifactSources([earlier, later])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.pages?.map(page => page.title)).toEqual(['Home revised', 'Detail'])
    expect(merged[0]?.itemId).toBe('result-2')
  })

  it('takes Gen UI from the runtime sideband, not a guessed file path', () => {
    const genUi = { widgetId: 'gw_' + 'a'.repeat(64), sha256: 'a'.repeat(64), bytes: 50, title: 'Explorer', mode: 'inline' }
    const result = artifactSourcesFromItem(item('render_widget', { status: 'completed', summary: 'Displayed' }, { genUi }))
    expect(result[0]).toMatchObject({ kind: 'widget', title: 'Explorer', widget: genUi })
    expect(result[0]?.path).toBeUndefined()
    expect(artifactSourcesFromItem(item('render_widget', { status: 'completed' }, { genUi: { ...genUi, widgetId: '../../secret' } }))).toEqual([])
  })

  it('keeps charts and visualizations as structured data and report identity as a file reference', () => {
    const chart = { version: 1, type: 'bar', title: 'Count', data: [{ name: 'A', value: 2 }], x: { field: 'name' }, series: [{ field: 'value' }] }
    expect(artifactSourcesFromItem(item('render_chart', { chart }))[0]).toMatchObject({ kind: 'chart', data: chart })
    const visualization = { version: 1, title: 'Flow', sections: [{ kind: 'callout', lines: ['Ready'] }] }
    expect(artifactSourcesFromItem(item('show_visualization', { conversationVisualization: visualization }))[0]).toMatchObject({ kind: 'visualization', data: visualization })
    expect(artifactSourcesFromItem(item('report_open', { reportRequest: {
      version: 1, reportId: '123456abcd', title: 'Weekly', relativePath: '.kun-reports/123456abcd.json'
    } }))[0]).toMatchObject({ kind: 'report', path: '.kun-reports/123456abcd.json' })
  })

  it('pairs MCP UI initial input with its actual call and ignores oversized unrelated arguments', () => {
    const call = { id: 'call-1', kind: 'tool_call', callId: 'mcp-call-1', arguments: { query: 'Selected data' } }
    const result = { ...item('mcp:example/show', { content: [{ type: 'text', text: 'Ready' }], mcpApp: {
      serverId: 'example', toolName: 'show', resourceUri: 'ui://example/ui/index.html'
    } }), callId: call.callId }
    expect(mergeArtifactSources([call, result])[0]).toMatchObject({
      kind: 'mcp-app', toolInput: call.arguments, toolOutput: result.output
    })
    expect(mergeArtifactSources([{ ...call, arguments: { value: 'x'.repeat(65537) } }, result])[0]?.toolInput).toBeUndefined()
  })

  it('does not create capabilities from arbitrary text, failed calls, or escaped design paths', () => {
    expect(artifactSourcesFromItem({ ...item('design_open', design([screen('1111aaaa', 'Home')])), kind: 'assistant_text' })).toEqual([])
    expect(artifactSourcesFromItem({ ...item('design_open', design([screen('1111aaaa', 'Home')])), isError: true })).toEqual([])
    expect(artifactSourcesFromItem(item('design_open', design([{ ...screen('1111aaaa', 'Home'), relativePath: '../secret.html' }])))).toEqual([])
    expect(artifactSourcesFromItem(item('bash', { text: 'Created /tmp/private.pdf' }))).toEqual([])
  })
})
