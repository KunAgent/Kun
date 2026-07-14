export const NETWORK_ACCESS_MODES = ['none', 'approved', 'full'] as const
export type NetworkAccessMode = typeof NETWORK_ACCESS_MODES[number]

export type NetworkOperation = 'read' | 'mutation'
export type NetworkApprovalScope = 'call' | 'host-port'

export type NetworkApprovalRequest = {
  requestId: string
  host: string
  port: number
  operation: NetworkOperation
}

export type NetworkApprovalGrant = {
  scope: NetworkApprovalScope
  requestId?: string
  host: string
  port: number
  operation: NetworkOperation
  allowLocalhost?: boolean
}

export type NetworkApprovalDecision = {
  allowed: boolean
  reason: 'full-access' | 'already-approved' | 'approval-required' | 'denied-by-policy' | 'invalid-request'
}

/** Pure network permission matching. It performs no DNS lookup or socket I/O. */
export function evaluateNetworkApproval(
  mode: NetworkAccessMode,
  request: NetworkApprovalRequest,
  grants: readonly NetworkApprovalGrant[] = []
): NetworkApprovalDecision {
  if (!NETWORK_ACCESS_MODES.includes(mode)) return { allowed: false, reason: 'denied-by-policy' }
  const normalized = normalizeRequest(request)
  if (!normalized) return { allowed: false, reason: 'invalid-request' }
  if (mode === 'none') return { allowed: false, reason: 'denied-by-policy' }
  if (mode === 'full') return { allowed: true, reason: 'full-access' }
  if (grants.some((grant) => matchesGrant(grant, normalized))) {
    return { allowed: true, reason: 'already-approved' }
  }
  return { allowed: false, reason: 'approval-required' }
}

export function normalizeNetworkHost(host: string): string | null {
  if (typeof host !== 'string') return null
  const normalized = host.trim().toLowerCase().replace(/\.$/, '')
  if (!normalized || /[\s/@?#]/.test(normalized) || normalized.includes('..')) return null
  if (normalized.startsWith('[') && !normalized.endsWith(']')) return null
  return normalized
}

export function isLocalNetworkHost(host: string): boolean {
  const normalized = normalizeNetworkHost(host)
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}

function normalizeRequest(request: NetworkApprovalRequest): NetworkApprovalRequest | null {
  if (!request || typeof request !== 'object' ||
      Object.keys(request).some((key) => !['requestId', 'host', 'port', 'operation'].includes(key))) return null
  const host = normalizeNetworkHost(request?.host)
  if (!host || !isRequestId(request?.requestId) || !isPort(request?.port)) return null
  if (request.operation !== 'read' && request.operation !== 'mutation') return null
  return { requestId: request.requestId, host, port: request.port, operation: request.operation }
}

function matchesGrant(grant: NetworkApprovalGrant, request: NetworkApprovalRequest): boolean {
  if (!isValidGrant(grant)) return false
  const host = normalizeNetworkHost(grant.host)
  if (host !== request.host || grant.port !== request.port) return false
  if (request.operation === 'mutation' && grant.operation !== 'mutation') return false
  if (isLocalNetworkHost(request.host) && grant.allowLocalhost !== true) return false
  return grant.scope === 'host-port' || grant.requestId === request.requestId
}

function isValidGrant(grant: NetworkApprovalGrant): boolean {
  return Boolean(
    grant &&
      typeof grant === 'object' &&
      Object.keys(grant).every((key) => ['scope', 'requestId', 'host', 'port', 'operation', 'allowLocalhost'].includes(key)) &&
      (grant.scope === 'call' || grant.scope === 'host-port') &&
      normalizeNetworkHost(grant.host) &&
      isPort(grant.port) &&
      (grant.operation === 'read' || grant.operation === 'mutation') &&
      (grant.scope === 'host-port' || isRequestId(grant.requestId)) &&
      (grant.allowLocalhost === undefined || typeof grant.allowLocalhost === 'boolean')
  )
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 65_535
}
