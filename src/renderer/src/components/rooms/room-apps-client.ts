import { kunMcpRemoteAppPath, kunMcpOAuthServerPath, KUN_MCP_CONFIG_TEMPLATE, KUN_MCP_OAUTH_PATH, KUN_RUNTIME_TOOLS_PATH } from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { isHiddenRoomGoogleApp } from '@shared/rooms-api'

export type RoomAppServer = {
  id: string
  enabled: boolean
  transport: string
  target: string
  oauth: boolean
}

export type RoomAppInventory = {
  servers: RoomAppServer[]
  statuses: Record<string, string>
  oauth: Record<string, string>
}

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const response = await rendererRuntimeClient.runtimeRequest(path, method, body ? JSON.stringify(body) : undefined)
  if (!response.ok) {
    let message = `Kun returned HTTP ${response.status}`
    try {
      const value = JSON.parse(response.body) as { error?: string | { message?: string }; message?: string }
      message = typeof value.error === 'string' ? value.error : value.error?.message ?? value.message ?? message
    } catch { /* Keep the status without exposing a raw upstream response. */ }
    throw new Error(message)
  }
  return JSON.parse(response.body) as T
}

export async function listRoomApps(): Promise<RoomAppInventory> {
  const [config, tools, oauth] = await Promise.all([
    request<{ servers: RoomAppServer[] }>(KUN_MCP_CONFIG_TEMPLATE),
    request<{ mcpServers?: Array<{ id?: string; status?: string }> }>(KUN_RUNTIME_TOOLS_PATH),
    request<{ servers?: Array<{ serverId?: string; status?: string }> }>(KUN_MCP_OAUTH_PATH)
  ])
  return {
    servers: config.servers.filter((server) => !isHiddenRoomGoogleApp(server.id)),
    statuses: Object.fromEntries((tools.mcpServers ?? []).flatMap((server) =>
      server.id && server.status && !isHiddenRoomGoogleApp(server.id) ? [[server.id, server.status]] : [])),
    oauth: Object.fromEntries((oauth.servers ?? []).flatMap((server) =>
      server.serverId && server.status && !isHiddenRoomGoogleApp(server.serverId) ? [[server.serverId, server.status]] : []))
  }
}

export async function addRoomApp(id: string, url: string): Promise<void> {
  if (isHiddenRoomGoogleApp(id)) throw new Error('This app is unavailable in Rooms')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) throw new Error('Use letters, numbers, dots, underscores, or hyphens for the app ID')
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Use an HTTPS app endpoint without embedded credentials, a query, or a fragment')
  }
  await request(kunMcpRemoteAppPath(id), 'POST', { url: endpoint.toString() })
}

export async function authorizeRoomApp(id: string): Promise<void> {
  if (isHiddenRoomGoogleApp(id)) throw new Error('This app is unavailable in Rooms')
  const result = await request<{ authorized: boolean; status: string }>(kunMcpOAuthServerPath(id), 'POST')
  if (!result.authorized) throw new Error(`App authorization did not complete (${result.status})`)
}
