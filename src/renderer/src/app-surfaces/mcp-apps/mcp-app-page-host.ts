import { AppBridge, type McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { CallToolResult } from '@modelcontextprotocol/client'
import type { AppSandboxTheme } from '@shared/app-sandbox'
import i18n from '../../i18n'
import { confirmDialog } from '../../lib/confirm-dialog'
import { openAppLink, saveAppDownload, sendAppFollowUp } from '../app-surface-actions'
import { attachAppSurfaceContext, threadWorkspaceRoot } from '../app-surface-composer-context'
import { appRuntimeRequest } from '../app-runtime-request'
import type { McpAppToolCallSnapshot } from '../app-surface-store'
import { AppSandboxTransport } from './mcp-app-transport'

export type McpAppDisplayMode = 'inline' | 'fullscreen'

export type McpAppPageHost = {
  /** Deliver a later tool call to the already connected page (shared panel). */
  pushToolCall: (call: McpAppToolCallSnapshot) => void
  dispose: () => void
}

/** Servers whose page tool calls run without a per-thread consent prompt. */
const MANAGED_APP_SERVERS = new Set(['kun_canvas'])
const consentedServers = new Set<string>()

const STYLE_TOKENS: Record<string, string> = {
  '--color-text-primary': 'foreground',
  '--color-text-secondary': 'mutedForeground',
  '--color-background-primary': 'surface',
  '--color-background-secondary': 'muted',
  '--color-border-primary': 'border',
  '--color-ring-primary': 'ring',
  '--color-text-danger': 'danger',
  '--color-text-success': 'success',
  '--color-text-warning': 'warning',
  '--color-text-info': 'accent'
}

function hostStyles(theme: AppSandboxTheme): Record<string, string> {
  const variables: Record<string, string> = {
    '--font-sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    '--border-radius-md': '8px'
  }
  for (const [variable, key] of Object.entries(STYLE_TOKENS)) {
    const value = theme.colors[key]
    if (value) variables[variable] = value
  }
  return variables
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
      ? String((block as { text?: unknown }).text ?? '')
      : ''))
    .filter(Boolean)
    .join('\n\n')
}

async function ensureToolConsent(threadId: string, serverId: string, appLabel: string): Promise<boolean> {
  const key = `${threadId}\u0000${serverId}`
  if (MANAGED_APP_SERVERS.has(serverId) || consentedServers.has(key)) return true
  const allowed = await confirmDialog(
    i18n.t('common:appSurfaceToolConsent', { app: appLabel }),
    i18n.t('common:appSurfaceToolConsentDetail')
  )
  if (allowed) consentedServers.add(key)
  return allowed
}

export function buildMcpAppHostContext(input: {
  theme: AppSandboxTheme
  displayMode: McpAppDisplayMode
}): McpUiHostContext {
  return {
    theme: input.theme.mode,
    locale: input.theme.locale,
    platform: 'desktop',
    userAgent: 'Kun',
    displayMode: input.displayMode,
    availableDisplayModes: ['inline', 'fullscreen'],
    styles: { variables: hostStyles(input.theme) },
    containerDimensions: input.displayMode === 'inline' ? { maxHeight: 1_200 } : {}
  } as McpUiHostContext
}

/**
 * Connect one sandboxed MCP App page to Kun through the official AppBridge.
 * Every server request is pinned to the card's thread and MCP server; tool
 * calls additionally require the server's app visibility (checked by the
 * runtime) and a one-time consent per conversation for third-party servers.
 */
export function attachMcpAppPageHost(input: {
  instanceId: string
  threadId: string
  serverId: string
  title: string
  theme: AppSandboxTheme
  displayMode: McpAppDisplayMode
  toolCall?: McpAppToolCallSnapshot
  onHeight: (height: number) => void
  onRequestDisplayMode: (mode: McpAppDisplayMode) => McpAppDisplayMode
  onPageError: (message: string) => void
}): McpAppPageHost {
  let initialized = false
  let pendingCall: McpAppToolCallSnapshot | undefined = input.toolCall
  const bridge = new AppBridge(
    null,
    { name: 'Kun', version: '1.0.0' },
    {
      openLinks: {},
      downloadFile: {},
      serverTools: {},
      serverResources: {},
      logging: {},
      message: { text: {} },
      updateModelContext: { text: {}, structuredContent: {} }
    },
    { hostContext: buildMcpAppHostContext({ theme: input.theme, displayMode: input.displayMode }) }
  )
  const transport = new AppSandboxTransport(input.instanceId)
  const scope = { serverId: input.serverId, threadId: input.threadId }

  const deliver = (call: McpAppToolCallSnapshot): void => {
    void bridge.sendToolInput({ arguments: call.arguments }).catch(() => undefined)
    if (call.result) void bridge.sendToolResult(call.result as CallToolResult).catch(() => undefined)
  }
  bridge.oninitialized = () => {
    initialized = true
    if (pendingCall) deliver(pendingCall)
    pendingCall = undefined
  }
  bridge.oncalltool = async (params, extra) => {
    if (!(await ensureToolConsent(input.threadId, input.serverId, input.title))) {
      return { isError: true, content: [{ type: 'text', text: 'The user declined this action.' }] }
    }
    const response = await appRuntimeRequest<{ result: CallToolResult }>('/v1/mcp-apps/tool', 'POST', {
      ...scope,
      name: params.name,
      arguments: params.arguments ?? {}
    }, extra.mcpReq.signal)
    if (!response.ok) return { isError: true, content: [{ type: 'text', text: response.message }] }
    return response.value.result
  }
  bridge.onreadresource = async (params, extra) => {
    const response = await appRuntimeRequest('/v1/mcp-apps/resource', 'POST', { ...scope, uri: params.uri }, extra.mcpReq.signal)
    if (!response.ok) throw new Error(response.message)
    return response.value as never
  }
  bridge.onlistresources = async (params, extra) => {
    const response = await appRuntimeRequest('/v1/mcp-apps/resources', 'POST', {
      ...scope,
      ...(params?.cursor ? { cursor: params.cursor } : {})
    }, extra.mcpReq.signal)
    if (!response.ok) throw new Error(response.message)
    return response.value as never
  }
  bridge.onopenlink = async (params) => {
    const opened = await openAppLink({ instanceId: input.instanceId, url: params.url, appLabel: input.title })
    return opened ? {} : { isError: true }
  }
  bridge.ondownloadfile = async (params) => {
    const saved = await saveAppDownload(input.instanceId, input.title, params.contents)
    return saved ? {} : { isError: true }
  }
  bridge.onmessage = async (params) => {
    const sent = await sendAppFollowUp({
      instanceId: input.instanceId,
      threadId: input.threadId,
      prompt: textFromContent(params.content),
      appLabel: input.title
    })
    return sent ? {} : { isError: true }
  }
  bridge.onupdatemodelcontext = async (params) => {
    await attachAppSurfaceContext({
      threadId: input.threadId,
      workspaceRoot: threadWorkspaceRoot(input.threadId),
      key: `mcp-app:${input.serverId}:${input.title}`,
      kind: 'mcp-app-context',
      title: i18n.t('common:appSurfaceAppContextChip', { title: input.title }),
      summary: textFromContent(params.content).slice(0, 200) || i18n.t('common:appSurfaceAppContextSummary'),
      label: input.title,
      data: {
        ...(params.content ? { text: textFromContent(params.content) } : {}),
        ...(params.structuredContent ? { structured: params.structuredContent } : {})
      }
    })
    return {}
  }
  bridge.onsizechange = (params) => {
    if (typeof params.height === 'number' && Number.isFinite(params.height)) input.onHeight(params.height)
  }
  bridge.onrequestdisplaymode = async (params) => {
    const requested = params.mode === 'fullscreen' ? 'fullscreen' : 'inline'
    return { mode: input.onRequestDisplayMode(requested) }
  }
  bridge.onloggingmessage = (params) => {
    if (params.level === 'error' || params.level === 'critical' || params.level === 'alert' || params.level === 'emergency') {
      input.onPageError(String(typeof params.data === 'string' ? params.data : JSON.stringify(params.data)).slice(0, 300))
    }
  }

  void bridge.connect(transport).catch((error: unknown) => {
    input.onPageError(error instanceof Error ? error.message : String(error))
  })
  return {
    pushToolCall(call) {
      if (initialized) deliver(call)
      else pendingCall = call
    },
    dispose() {
      void bridge.teardownResource({}, { timeout: 1_000 }).catch(() => undefined).finally(() => {
        void transport.close()
      })
    }
  }
}
