/** Secret-free desktop view of public gateway client credentials. */
export type GatewayClientCredential = { clientId: string; name: string; createdAt: string; revokedAt?: string }
export type GatewayClientAction = { action: 'list' } | { action: 'create'; name: string } | { action: 'revoke' | 'usage'; clientId: string }
export type GatewayClientResult = {
  ok: boolean
  status: number
  clients?: GatewayClientCredential[]
  client?: GatewayClientCredential
  copied?: boolean
  revoked?: boolean
  usage?: GatewayClientUsage
  error?: string
}

export type GatewayClientUsage = {
  clientId: string
  totalRequests: number
  totalTokens: number
  requests: Array<{
    timestamp: string
    requestedModelId?: string
    actualProviderId?: string
    actualModelId?: string
    sessionId?: string
    status?: string
    latencyMs?: number
    retryCount?: number
    failoverCount?: number
    promptTokens?: number
    completionTokens?: number
    cacheHitTokens?: number
    tokenUsage?: string
  }>
}
