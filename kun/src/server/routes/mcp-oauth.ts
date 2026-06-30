import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

export async function mcpOAuthDiagnostics(runtime: ServerRuntime): Promise<JsonResponse> {
  if (!runtime.mcpOAuth) return ERRORS.unavailable('MCP OAuth diagnostics are not available')
  return jsonResponse({ servers: await runtime.mcpOAuth() })
}

export async function clearMcpOAuth(runtime: ServerRuntime, serverId?: string): Promise<JsonResponse> {
  if (!runtime.clearMcpOAuth) return ERRORS.unavailable('MCP OAuth credential reset is not available')
  return jsonResponse(await runtime.clearMcpOAuth(serverId))
}

export async function authorizeMcpOAuth(runtime: ServerRuntime, serverId: string): Promise<JsonResponse> {
  if (!runtime.authorizeMcpOAuth) return ERRORS.unavailable('MCP OAuth authorization is not available')
  return jsonResponse(await runtime.authorizeMcpOAuth(serverId))
}
