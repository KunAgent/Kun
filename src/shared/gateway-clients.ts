/** Secret-free desktop view of public gateway client credentials. */
export { GatewayClientPolicySchema, legacyGatewayClientPolicy } from '../../kun/src/contracts/gateway-client-policy.js'
export type GatewayClientCredential = { clientId: string; name: string; createdAt: string; revokedAt?: string; rotatedAt?: string; scopeMode?: 'scoped' | 'legacy-unrestricted' }
export type { GatewayClientLimit } from '../../kun/src/contracts/gateway-client-limit.js'
import type { GatewayClientLimit } from '../../kun/src/contracts/gateway-client-limit.js'
export type GatewayClientAction = { action: 'list' } | { action: 'create'; name: string; modelId?: string } |
  { action: 'revoke'; clientId: string; cancelActive?: boolean } | { action: 'usage' | 'rotate' | 'limit'; clientId: string }
export type GatewayClientResult = {
  ok: boolean
  status: number
  clients?: GatewayClientCredential[]
  client?: GatewayClientCredential
  copied?: boolean
  revoked?: boolean
  usage?: GatewayClientUsage
  limit?: GatewayClientLimit
  error?: string
}

export type GatewayClientUsage = {
  clientId: string
  totalRequests: number
  totalTokens: number
  budget?: { measured: number; reserved: number; limit?: number; endsAt: number }
  costEstimate?: { usd: number; limitUsd: number; unknownAttempts: number; exceeded: boolean }
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
