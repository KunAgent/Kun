import { describe, expect, it } from 'vitest'
import {
  isAppVisibleMcpTool,
  isMcpAppHtmlMimeType,
  isModelVisibleMcpTool,
  mcpAppToolOutputMeta,
  normalizeMcpAppResourceMeta,
  normalizeMcpToolUiMeta,
  parseMcpAppToolOutputMeta,
  resolveMcpAppRelativeResource
} from './mcp-apps.js'

describe('mcp-apps contracts', () => {
  it('reads the UI resource from the nested key, then legacy and compatibility keys', () => {
    expect(normalizeMcpToolUiMeta({ ui: { resourceUri: 'ui://a/one.html' }, 'ui/resourceUri': 'ui://a/two.html' })?.resourceUri)
      .toBe('ui://a/one.html')
    expect(normalizeMcpToolUiMeta({ 'ui/resourceUri': 'ui://a/two.html' })?.resourceUri).toBe('ui://a/two.html')
    expect(normalizeMcpToolUiMeta({ 'openai/outputTemplate': 'ui://a/three.html' })?.resourceUri).toBe('ui://a/three.html')
  })

  it('drops the whole descriptor for a non ui:// resource but keeps valid fields otherwise', () => {
    expect(normalizeMcpToolUiMeta({ ui: { resourceUri: 'https://evil.example/x.html' } })).toBeNull()
    const descriptor = normalizeMcpToolUiMeta({
      ui: {
        resourceUri: 'ui://canvas/index.html',
        surface: 'canvas',
        visibility: ['app', 'bogus'],
        csp: { connectDomains: ['https://api.example.com', 'javascript:alert(1)'] }
      }
    })
    expect(descriptor).toEqual({
      resourceUri: 'ui://canvas/index.html',
      visibility: ['app'],
      surface: 'canvas',
      csp: { connectDomains: ['https://api.example.com'] }
    })
    expect(normalizeMcpToolUiMeta({ ui: { resourceUri: 'ui://x/a.html', surface: '../bad' } })?.surface).toBeUndefined()
  })

  it('defaults visibility to model and app and filters app-only tools from the model', () => {
    expect(isModelVisibleMcpTool({})).toBe(true)
    expect(isAppVisibleMcpTool({})).toBe(true)
    expect(isModelVisibleMcpTool({ _meta: { ui: { visibility: ['app'] } } })).toBe(false)
    expect(isAppVisibleMcpTool({ _meta: { ui: { visibility: ['model'] } } })).toBe(false)
  })

  it('normalizes resource meta, including the host CSP relaxations', () => {
    expect(normalizeMcpAppResourceMeta({
      ui: { prefersBorder: false, csp: { resourceDomains: ['https://cdn.example.com/'] } },
      'kun/csp': { wasmUnsafeEval: true, unsafeEval: 'yes' }
    })).toEqual({
      csp: { resourceDomains: ['https://cdn.example.com'] },
      prefersBorder: false,
      wasmUnsafeEval: true
    })
    expect(isMcpAppHtmlMimeType('text/html;profile=mcp-app')).toBe(true)
    expect(isMcpAppHtmlMimeType('application/json')).toBe(false)
  })

  it('round-trips the tool output sideband', () => {
    const meta = mcpAppToolOutputMeta('kun_canvas', {
      name: 'canvas_create',
      _meta: { ui: { resourceUri: 'ui://kun-canvas/index.html', surface: 'canvas' } }
    })
    expect(meta).toEqual({
      serverId: 'kun_canvas',
      toolName: 'canvas_create',
      resourceUri: 'ui://kun-canvas/index.html',
      surface: 'canvas'
    })
    expect(parseMcpAppToolOutputMeta(meta)).toEqual(meta)
    expect(parseMcpAppToolOutputMeta({ serverId: 'x', toolName: 'y', resourceUri: 'file:///etc' })).toBeNull()
  })

  it('resolves page-relative assets only under the same ui:// authority', () => {
    expect(resolveMcpAppRelativeResource('ui://kun-canvas/index.html', 'assets/app.js')).toBe('ui://kun-canvas/assets/app.js')
    expect(resolveMcpAppRelativeResource('ui://kun-canvas/index.html', 'fonts/../x.woff2')).toBe('ui://kun-canvas/x.woff2')
    expect(resolveMcpAppRelativeResource('ui://kun-canvas/index.html', '../other/x')).toBeNull()
    expect(resolveMcpAppRelativeResource('https://x/index.html', 'a.js')).toBeNull()
  })
})
