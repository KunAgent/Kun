import { join, posix } from 'node:path'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { getKunRuntimeSettings } from '../../shared/app-settings-kun-defaults'
import { resolveClawScheduleMcpCommand, type ClawScheduleMcpLaunchConfig } from '../claw-schedule-mcp-config'

const CANVAS_NODE_ENTRY = 'out/main/canvas-mcp-node-entry.js'
const CANVAS_APP_DIR = 'out/canvas-app'

// Kept here, not in canvas-mcp-server.ts: importing that module from the main
// process would load the MCP SDK eagerly at startup.
export const CANVAS_MCP_SERVER_ID = 'kun_canvas'

function appJoin(appPath: string, path: string): string {
  return appPath.includes('/') && !appPath.includes('\\') ? posix.join(appPath, path) : join(appPath, path)
}

export function canvasMcpEnabled(settings: AppSettingsV1 | undefined): boolean {
  return settings ? getKunRuntimeSettings(settings).lab.mcpApps?.enabled === true : false
}

/**
 * Host-managed stdio server for the built-in editable canvas MCP App. It runs
 * as Node inside the Electron helper and keeps boards in the Kun data dir.
 */
export function buildCanvasKunMcpServer(launch: ClawScheduleMcpLaunchConfig, dataDir: string): Record<string, unknown> {
  return {
    enabled: true,
    transport: 'stdio',
    command: resolveClawScheduleMcpCommand(launch),
    args: [
      appJoin(launch.appPath, CANVAS_NODE_ENTRY),
      '--kun-canvas-mcp-server',
      '--data-dir',
      join(dataDir, 'canvas-boards'),
      '--app-dir',
      appJoin(launch.appPath, CANVAS_APP_DIR),
      '--fonts-dir',
      appJoin(launch.appPath, launch.isPackaged ? 'out/renderer/excalidraw/fonts' : 'src/renderer/public/excalidraw/fonts')
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    trustScope: 'user',
    timeoutMs: 30_000
  }
}
