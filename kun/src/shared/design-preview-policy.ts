import type { TurnItem } from '../contracts/items.js'
import type { ToolHostContext } from '../ports/tool-host.js'

export const DESIGN_PREVIEW_INSTRUCTION = [
  'Kun renders this artifact in its in-app canvas or component preview; use that preview for visual review.',
  'Do not launch Chrome, Chromium, Playwright, Puppeteer, an external browser MCP, or a shell browser command just to preview, screenshot, or validate this artifact.',
  'Do not start a local HTTP server as a workaround. If an in-app inspection capability is not advertised, review the source and state that visual verification was not performed.'
].join(' ')

export const GUI_BROWSER_ROUTING_INSTRUCTION = [
  'For ordinary web browsing, prefer browser_use when it is advertised; it operates the supervised in-app Browser panel.',
  'Design canvas and component artifacts already have an in-app preview. Do not use an external browser to inspect them.',
  'Do not silently fall back to an external browser MCP or shell-launched browser when browser_use lacks a required capability. Explain the limitation and obtain the user\'s explicit authorization for external-browser automation first.'
].join(' ')

/** A preview fence lasts only for the publishing turn, not later implementation work. */
export function hasPublishedDesignPreview(items: readonly TurnItem[], turnId: string): boolean {
  return items.some((item) => {
    if (item.turnId !== turnId || item.kind !== 'tool_result' || item.isError) return false
    if (!item.output || typeof item.output !== 'object') return false
    const output = item.output as Record<string, unknown>
    const payload = item.toolName === 'design_open' ? output.designRequest
      : item.toolName === 'design_component' ? output.componentPrototype : undefined
    if (!payload || typeof payload !== 'object') return false
    const status = (payload as Record<string, unknown>).status
    return status === 'ready' || status === 'completed'
  })
}

/** Shared by direct MCP wrappers and the search/call facade, including renamed servers. */
export function canUseMcpBrowserTool(toolName: string, context: ToolHostContext): boolean {
  if (!toolName.startsWith('browser_') || context.clientSurface !== 'gui') return true
  return context.agentSurface !== 'design' && context.guiDesignMode !== true &&
    !context.guiDesignArtifact && context.designPreviewOnly !== true
}
