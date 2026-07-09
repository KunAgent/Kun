import type { McpServerConfig } from '../../contracts/capabilities.js'

export type McpToolDescriptor = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  execution?: unknown
  icons?: unknown
  _meta?: Record<string, unknown>
}

export type McpResourceDescriptor = {
  uri: string
  name?: string
  title?: string
  description?: string
  mimeType?: string
  size?: number
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export type McpResourceTemplateDescriptor = {
  uriTemplate: string
  name?: string
  title?: string
  description?: string
  mimeType?: string
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export type McpPromptDescriptor = {
  name: string
  title?: string
  description?: string
  arguments?: Array<{
    name: string
    title?: string
    description?: string
    required?: boolean
  }>
  _meta?: Record<string, unknown>
}

export type McpClientLifecycleHandlers = {
  onError?: (error: Error) => void
  onClose?: () => void
}

export type McpClientLike = {
  listTools(options?: {
    cursor?: string
    signal?: AbortSignal
    timeout?: number
  }): Promise<{ tools: McpToolDescriptor[]; nextCursor?: string }>
  callTool(
    input: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<unknown>
  listResources?(options?: {
    cursor?: string
    signal?: AbortSignal
    timeout?: number
  }): Promise<{ resources: McpResourceDescriptor[]; nextCursor?: string }>
  readResource?(
    input: { uri: string },
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<unknown>
  listResourceTemplates?(options?: {
    cursor?: string
    signal?: AbortSignal
    timeout?: number
  }): Promise<{ resourceTemplates: McpResourceTemplateDescriptor[]; nextCursor?: string }>
  listPrompts?(options?: {
    cursor?: string
    signal?: AbortSignal
    timeout?: number
  }): Promise<{ prompts: McpPromptDescriptor[]; nextCursor?: string }>
  getPrompt?(
    input: { name: string; arguments?: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<unknown>
  close(): Promise<void>
  setLifecycleHandlers?(handlers: McpClientLifecycleHandlers): void
}

export type McpServerDiagnostic = {
  id: string
  enabled: boolean
  transport: McpServerConfig['transport']
  trustScope: McpServerConfig['trustScope']
  available: boolean
  status: 'disabled' | 'connected' | 'reconnecting' | 'error' | 'authorization_required'
  toolCount: number
  catalogFingerprint?: string
  catalogDrift?: boolean
  lastConnectedAt?: string
  lastDisconnectedAt?: string
  lastReconnectAt?: string
  nextReconnectAt?: string
  reconnectAttempts?: number
  lastError?: string
}

export type McpOAuthStatus = 'disabled' | 'empty' | 'partial' | 'authorized' | 'expired' | 'error'

export type McpOAuthDiagnostic = {
  serverId: string
  enabled: boolean
  configured: boolean
  transport: McpServerConfig['transport']
  url?: string
  status: McpOAuthStatus
  hasClientInformation: boolean
  hasTokens: boolean
  hasRefreshToken: boolean
  hasCodeVerifier: boolean
  hasDiscoveryState: boolean
  grantedScopes?: string[]
  expiresAt?: string
  lastError?: string
  lastErrorAt?: string
}

export type McpOAuthClearResult = {
  cleared: string[]
}

export type McpOAuthAuthorizeResult = {
  serverId: string
  status: McpOAuthStatus
  authorized: boolean
}

export class McpAuthorizationRequiredError extends Error {
  constructor(public readonly serverId: string) {
    super(`MCP server "${serverId}" requires OAuth authorization`)
    this.name = 'McpAuthorizationRequiredError'
  }
}

export function isMcpAuthorizationRequiredError(error: unknown): error is McpAuthorizationRequiredError {
  return error instanceof McpAuthorizationRequiredError
}
