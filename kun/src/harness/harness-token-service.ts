import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { HarnessId } from '../contracts/harness.js'

/**
 * Process-local bearer tokens scoped to a spawned harness (docs/ade/04 §4,
 * docs/ade/05 §4). Grants live only in memory: Kun restarts invalidate every
 * token, and harness child processes are rebuilt with the restart, so no
 * persisted credential can outlive its owner. Token bytes are deterministic
 * for a given (harnessId, credentialIdentity, threadId, scopes) tuple so the
 * environment injected into a spawned harness is byte-stable across retries.
 *
 * Token values must never be logged or placed on argv; only `grantId` prefixes
 * may appear in debug output.
 */
export type HarnessTokenScope = 'gateway' | 'kun-tools' | 'worker-callback' | 'hook-ingest'

export const HARNESS_TOKEN_SCOPES: readonly HarnessTokenScope[] = [
  'gateway',
  'kun-tools',
  'worker-callback',
  'hook-ingest'
]

export type HarnessTokenRoute = {
  providerId: string
  model: string
  role: 'main' | 'small'
}

export type HarnessTokenGrant = {
  grantId: string
  threadId: string
  harnessId: HarnessId
  scopes: readonly HarnessTokenScope[]
  /** Route-pool models this grant may address through the gateway. */
  routes: readonly HarnessTokenRoute[]
  maxConcurrent: number
  maxBodyBytes: number
  /** Process lifetime by default; Kun restarts invalidate all grants. */
  expiresAt: number
}

export type HarnessTokenIssueInput = {
  threadId: string
  harnessId: HarnessId
  /** Stable identity of the harness credential/env the token is bound to. */
  credentialIdentity: string
  scopes: readonly HarnessTokenScope[]
  routes?: readonly HarnessTokenRoute[]
  maxConcurrent?: number
  maxBodyBytes?: number
  expiresAt?: number
}

export const DEFAULT_HARNESS_TOKEN_MAX_CONCURRENT = 4
export const DEFAULT_HARNESS_TOKEN_MAX_BODY_BYTES = 32 * 1024 * 1024
export const HARNESS_TOKEN_PREFIX = 'kgw_'

export class HarnessTokenService {
  private readonly secret: Buffer
  private readonly grants = new Map<string, HarnessTokenGrant>()

  constructor(options: { secret?: Buffer } = {}) {
    this.secret = options.secret ?? randomBytes(32)
  }

  /** Issue (or re-issue) the deterministic token for this identity + scope set. */
  issue(input: HarnessTokenIssueInput): string {
    const scopes = normalizeScopes(input.scopes)
    const grantId = hmacHex(
      this.secret,
      `${input.harnessId}\u0000${input.credentialIdentity}\u0000${input.threadId}\u0000${scopes.join(',')}`
    ).slice(0, 32)
    const grant: HarnessTokenGrant = {
      grantId,
      threadId: input.threadId,
      harnessId: input.harnessId,
      scopes,
      routes: input.routes ?? [],
      maxConcurrent: input.maxConcurrent ?? DEFAULT_HARNESS_TOKEN_MAX_CONCURRENT,
      maxBodyBytes: input.maxBodyBytes ?? DEFAULT_HARNESS_TOKEN_MAX_BODY_BYTES,
      expiresAt: input.expiresAt ?? Number.MAX_SAFE_INTEGER
    }
    this.grants.set(grantId, grant)
    return `${HARNESS_TOKEN_PREFIX}${grantId}.${hmacHex(this.secret, grantId)}`
  }

  /** Verify a token's signature and return its grant (or null). */
  verify(token: string | null | undefined): HarnessTokenGrant | null {
    if (!token) return null
    const dot = token.indexOf('.')
    if (dot < 0) return null
    const prefix = token.slice(0, dot)
    const signature = token.slice(dot + 1)
    if (!prefix.startsWith(HARNESS_TOKEN_PREFIX) || !signature) return null
    const grantId = prefix.slice(HARNESS_TOKEN_PREFIX.length)
    if (!timingSafeEqualHex(signature, hmacHex(this.secret, grantId))) return null
    const grant = this.grants.get(grantId)
    if (!grant || grant.expiresAt <= Date.now()) return null
    return grant
  }

  /** Verify a token and require it carries the given scope. */
  verifyScope(
    token: string | null | undefined,
    scope: HarnessTokenScope
  ): HarnessTokenGrant | null {
    const grant = this.verify(token)
    return grant && grant.scopes.includes(scope) ? grant : null
  }

  /**
   * Revoke every grant bound to a thread (thread delete/archive, worker
   * release). Returns the number of grants removed.
   */
  revokeThread(threadId: string): number {
    let revoked = 0
    for (const [grantId, grant] of this.grants) {
      if (grant.threadId !== threadId) continue
      this.grants.delete(grantId)
      revoked += 1
    }
    return revoked
  }

  /** Revoke a single grant by id (turn-scoped expiry such as `kun-tools`). */
  revokeGrant(grantId: string): boolean {
    return this.grants.delete(grantId)
  }

  /** Non-sensitive debug identity; token bytes are never exposed. */
  describe(token: string | null | undefined): string | null {
    if (!token?.startsWith(HARNESS_TOKEN_PREFIX)) return null
    const grantId = token.slice(HARNESS_TOKEN_PREFIX.length, token.indexOf('.'))
    return `${HARNESS_TOKEN_PREFIX}${grantId.slice(0, 8)}…`
  }
}

function normalizeScopes(scopes: readonly HarnessTokenScope[]): HarnessTokenScope[] {
  return [...new Set(scopes)].sort()
}

function hmacHex(secret: Buffer, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]+$/i.test(left) || left.length !== right.length) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}
