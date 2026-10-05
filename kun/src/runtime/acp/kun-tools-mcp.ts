/**
 * Native-session MCP descriptors stay stable while exact-turn grants are
 * activated/revoked around each prompt. A new native session gets a new opaque
 * identity. Revoked/in-flight grants cannot borrow authority from a later turn.
 * Tokens travel only in headers/env; never on argv or in persisted bindings.
 */
import type { HarnessId } from '../../contracts/harness.js'
import {
  HARNESS_TOKEN_PREFIX,
  type HarnessTokenService
} from '../../harness/harness-token-service.js'
import { capabilityFlagOn, type McpServer } from './acp-schema.js'

/** What an agent's `initialize` response advertises for MCP transports. */
export type AcpMcpCapabilities = {
  http?: boolean | Record<string, unknown> | null
  sse?: boolean | Record<string, unknown> | null
  stdio?: boolean | Record<string, unknown> | null
}

export type KunToolsMcpProviderDeps = {
  tokens: HarnessTokenService
  /** Loopback `kun serve` endpoint; empty when the runtime is not serve-hosted. */
  endpoint: () => string | undefined
  /** Spawn-ready kun CLI invocation (`kunCommandParts`). */
  command: () => { command: string; args: string[] }
  /** Token env var handed to the stdio `mcp-bridge` child. */
  tokenEnvVar?: string
}

export type KunToolsMcpInput = {
  threadId: string
  turnId: string
  harnessId: HarnessId
  credentialIdentity: string
  /** Opaque connection-local native session identity; never shared across sessions. */
  sessionKey?: string
  mcpCapabilities?: AcpMcpCapabilities | undefined
}

export class KunToolsMcpProvider {
  private readonly turnGrants = new Map<string, string[]>()
  private issueCount = 0

  constructor(private readonly deps: KunToolsMcpProviderDeps) {}

  /**
   * Build the `mcpServers` entries for one session request. Returns `[]` when
   * the runtime is not serve-hosted — the agent then sees no Kun tools,
   * matching the `kunTools` capability declaration.
   */
  servers(input: KunToolsMcpInput): McpServer[] {
    const baseUrl = this.deps.endpoint()?.trim()
    if (!baseUrl) return []
    const url = `${baseUrl.replace(/\/$/, '')}/mcp/kun`
    const token = this.deps.tokens.issue({
      threadId: input.threadId,
      harnessId: input.harnessId,
      // Live native sessions retain their bearer; every activation carries a
      // new exact-turn grant object. Legacy callers still rotate per issue.
      credentialIdentity: `${input.credentialIdentity}\u0000kun-tools\u0000${input.sessionKey ?? `${input.turnId}:${this.issueCount++}`}`,
      turnId: input.turnId,
      scopes: ['kun-tools']
    })
    const grants = this.turnGrants.get(input.turnId) ?? []
    grants.push(token.slice(HARNESS_TOKEN_PREFIX.length, token.indexOf('.')))
    this.turnGrants.set(input.turnId, grants)

    const mcp = input.mcpCapabilities
    // An agent that explicitly disables stdio and does not advertise http
    // cannot take a descriptor at all — report none instead of lying.
    if (mcp && !capabilityFlagOn(mcp.http) && mcp.stdio === false) return []
    if (mcp && capabilityFlagOn(mcp.http)) {
      return [
        {
          type: 'http',
          name: 'kun-tools',
          url,
          headers: [{ name: 'Authorization', value: `Bearer ${token}` }]
        }
      ]
    }
    // ACP stdio descriptors carry no `type` field — presence of command/args
    // implies the stdio transport.
    const { command, args } = this.deps.command()
    return [
      {
        name: 'kun-tools',
        command,
        args: [...args, 'mcp-bridge', '--token-env', this.deps.tokenEnvVar ?? 'KUN_TOOLS_TOKEN'],
        env: [
          { name: this.deps.tokenEnvVar ?? 'KUN_TOOLS_TOKEN', value: token },
          { name: 'KUN_MCP_URL', value: url }
        ]
      }
    ]
  }

  /** Whether this runtime can hand out descriptors (serve-hosted endpoint). */
  canDeliver(): boolean {
    return Boolean(this.deps.endpoint()?.trim())
  }

  /** Revoke every grant issued for this turn (success, failure, or abort). */
  revokeTurn(turnId: string): void {
    const grants = this.turnGrants.get(turnId)
    if (!grants) return
    this.turnGrants.delete(turnId)
    for (const grantId of grants) this.deps.tokens.revokeGrant(grantId, turnId)
  }
}


