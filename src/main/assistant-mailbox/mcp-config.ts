import { join, posix } from 'node:path'
import type { AppSettingsV1 } from '../../shared/app-settings'
import { getKunRuntimeSettings } from '../../shared/app-settings-kun-defaults'
import { resolveClawScheduleMcpCommand, type ClawScheduleMcpLaunchConfig } from '../claw-schedule-mcp-config'
import { assistantToolEndpointPaths } from './tool-endpoint'

// Kept apart from mcp-server.ts so the runtime config sync does not load the MCP SDK.
export const ASSISTANT_MCP_SERVER_ID = 'kun_assistants'
const NODE_ENTRY = 'out/main/assistant-mcp-node-entry.js'

export function assistantMailboxEnabled(settings: AppSettingsV1 | undefined): boolean {
  return settings ? getKunRuntimeSettings(settings).lab.assistantMailbox?.enabled === true : false
}

/** Host-managed stdio server; it reaches Main through the local endpoint under userData. */
export function buildAssistantKunMcpServer(launch: ClawScheduleMcpLaunchConfig & { userDataDir: string }): Record<string, unknown> {
  const entry = launch.appPath.includes('/') && !launch.appPath.includes('\\')
    ? posix.join(launch.appPath, NODE_ENTRY)
    : join(launch.appPath, NODE_ENTRY)
  const paths = assistantToolEndpointPaths(launch.userDataDir)
  return {
    enabled: true,
    transport: 'stdio',
    command: resolveClawScheduleMcpCommand(launch),
    args: [entry, '--kun-assistant-mcp-server', '--socket', paths.socketPath, '--secret-file', paths.secretPath],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    trustScope: 'user',
    timeoutMs: 60_000
  }
}
