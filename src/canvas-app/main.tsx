import './asset-path'
import { createRoot } from 'react-dom/client'
import { App } from '@modelcontextprotocol/ext-apps'
import '@excalidraw/excalidraw/index.css'
import './canvas-app.css'
import { CanvasEditor, type ToolResult } from './CanvasEditor'

/**
 * Built-in Kun canvas MCP App. The page talks to the host only through the
 * official MCP Apps SDK; documents live in the canvas MCP server.
 */
async function main(): Promise<void> {
  const app = new App(
    { name: 'kun-canvas', version: '1.0.0' },
    { availableDisplayModes: ['fullscreen', 'inline'] },
    { autoResize: false }
  )
  // Keep the latest tool result from before the editor mounted; the host sends
  // the initial result right after the handshake.
  let latest: ToolResult | null = null
  const listeners = new Set<(result: ToolResult) => void>()
  app.addEventListener('toolresult', (params) => {
    latest = params
    for (const listener of listeners) listener(params)
  })
  const subscribeToolResult = (listener: (result: ToolResult) => void): (() => void) => {
    listeners.add(listener)
    if (latest) listener(latest)
    return () => listeners.delete(listener)
  }
  await app.connect()
  if (app.getHostContext()?.displayMode !== 'fullscreen') void app.sendSizeChanged({ height: 560 })
  const root = document.getElementById('root')
  if (root) createRoot(root).render(<CanvasEditor app={app} subscribeToolResult={subscribeToolResult} />)
}

void main()
