import {
  McpAppResourceListRequestSchema,
  McpAppResourceReadRequestSchema,
  McpAppToolCallRequestSchema
} from '../../contracts/mcp-apps.js'
import { McpAppsAccessError, type McpAppsAccess } from '../../adapters/tool/mcp-apps-access.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse } from '../response.js'
import type { Router } from '../router.js'
import { authorize } from './route-auth.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'

const TOOL_BODY_LIMIT = 4 * 1024 * 1024

function accessError(error: unknown) {
  if (error instanceof McpAppsAccessError) {
    if (error.code === 'not_found') return ERRORS.notFound(error.message)
    if (error.code === 'forbidden') return ERRORS.forbidden(error.message)
    if (error.code === 'too_large') return ERRORS.validation(error.message)
    return ERRORS.unavailable(error.message)
  }
  return ERRORS.unavailable(error instanceof Error ? error.message.slice(0, 500) : 'MCP request failed')
}

/**
 * Desktop MCP Apps host routes. The workbench renderer calls them on behalf of
 * a sandboxed page; the page itself never reaches the runtime. Every request
 * is scoped to a thread so server visibility and trust follow its workspace.
 */
export function registerMcpAppsRoutes(router: Router, runtime: ServerRuntime): void {
  const access = (): McpAppsAccess | undefined => runtime.mcpApps?.()
  const workspaceFor = async (threadId: string | undefined): Promise<string | null> => {
    if (!threadId) return null
    const thread = await runtime.threadStore?.get(threadId)
    return thread?.workspace ?? null
  }

  router.add('GET', '/v1/mcp-apps/catalog', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const apps = access()
    if (!apps) return jsonResponse({ entries: [] })
    const threadId = new URL(request.url).searchParams.get('threadId') ?? undefined
    const workspace = await workspaceFor(threadId)
    if (!workspace) return ERRORS.notFound('thread not found')
    return jsonResponse({ entries: apps.catalog(workspace) })
  })

  router.add('POST', '/v1/mcp-apps/resource', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const apps = access()
    if (!apps) return ERRORS.unavailable('MCP is not available')
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = McpAppResourceReadRequestSchema.safeParse(body.value)
    if (!parsed.success) return ERRORS.validation('invalid resource request', parsed.error.issues)
    const workspace = await workspaceFor(parsed.data.threadId)
    if (!workspace) return ERRORS.notFound('thread not found')
    try {
      return jsonResponse(await apps.readResource(parsed.data.serverId, parsed.data.uri, workspace, request.signal))
    } catch (error) {
      return accessError(error)
    }
  })

  router.add('POST', '/v1/mcp-apps/resources', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const apps = access()
    if (!apps) return jsonResponse({ resources: [] })
    const body = await readJsonBody(request)
    if (!body.ok) return body.response
    const parsed = McpAppResourceListRequestSchema.safeParse(body.value)
    if (!parsed.success) return ERRORS.validation('invalid resource list request', parsed.error.issues)
    const workspace = await workspaceFor(parsed.data.threadId)
    if (!workspace) return ERRORS.notFound('thread not found')
    try {
      return jsonResponse(await apps.listResources(parsed.data.serverId, workspace, parsed.data.cursor, request.signal))
    } catch (error) {
      return accessError(error)
    }
  })

  router.add('POST', '/v1/mcp-apps/tool', async (request) => {
    if (!authorize(request, runtime)) return ERRORS.unauthorized()
    const apps = access()
    if (!apps) return ERRORS.unavailable('MCP is not available')
    const body = await readJsonBody(request, TOOL_BODY_LIMIT)
    if (!body.ok) return body.response
    const parsed = McpAppToolCallRequestSchema.safeParse(body.value)
    if (!parsed.success) return ERRORS.validation('invalid tool request', parsed.error.issues)
    const thread = await runtime.threadStore?.get(parsed.data.threadId)
    if (!thread) return ERRORS.notFound('thread not found')
    const context: ToolHostContext = {
      threadId: thread.id,
      turnId: `mcp-app:${parsed.data.serverId}`,
      workspace: thread.workspace,
      clientSurface: 'gui',
      abortSignal: request.signal,
      // The workbench obtained the user's consent before forwarding the page
      // request; the page-initiated call never opens a model approval card.
      approvalPolicy: 'never',
      awaitApproval: async () => 'deny'
    }
    try {
      const { result } = await apps.callTool({
        serverId: parsed.data.serverId,
        name: parsed.data.name,
        arguments: parsed.data.arguments,
        workspace: thread.workspace,
        context
      })
      return jsonResponse({ result })
    } catch (error) {
      if (error instanceof McpAppsAccessError) return accessError(error)
      // Server-side tool failures are reported to the page as a tool error result.
      return jsonResponse({
        result: {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message.slice(0, 2_000) : 'Tool call failed' }]
        }
      })
    }
  })
}
