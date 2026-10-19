import { runCanvasMcpServerFromArgv } from './canvas-mcp-server'

void runCanvasMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[kun-canvas-mcp] missing --kun-canvas-mcp-server launch flags')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[kun-canvas-mcp] server failed:', error)
    process.exit(1)
  })
