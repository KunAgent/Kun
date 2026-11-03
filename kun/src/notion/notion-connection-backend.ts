import type { McpCapabilityConfig } from '../contracts/capabilities-core.js'
import type { RuntimeConfigApplyResponse } from '../contracts/runtime-config.js'
import type { McpOAuthDiagnostic, McpOAuthStatus } from '../adapters/tool/mcp-types.js'
import {
  NOTION_MCP_ENDPOINT,
  NOTION_MCP_SERVER_ID,
  NotionConnectionError,
  createNotionMcpServer,
  isNotionMcpTarget,
  mapNotionCapabilities,
  notionOAuthConfigured,
  type NotionCapability,
  type NotionConnectionSnapshot,
  type NotionDiscoveryPort,
  type NotionInstallOutcome,
  type NotionInstallResult,
  type NotionMcpPort
} from './notion-connection-contract.js'

/**
 * Dedicated Notion connection backend.
 *
 * It delegates installation, OAuth, and capability discovery to the existing
 * MCP services. The only local decisions are catalog-specific: exact target
 * matching, refusing to overwrite an ID collision, and never auto-enabling a
 * server the user disabled.
 */
export class NotionConnectionBackend {
  constructor(
    private readonly mcp: NotionMcpPort,
    private readonly discovery?: NotionDiscoveryPort
  ) {}

  async status(): Promise<NotionConnectionSnapshot> {
    return await this.inspect(false)
  }

  /** Inspect current state and re-run tools/list discovery when authorized. */
  async check(): Promise<NotionConnectionSnapshot> {
    return await this.inspect(true)
  }

  /**
   * Install the controlled Notion MCP descriptor when absent. A matching
   * disabled server is returned as `disabled` and is never enabled implicitly.
   */
  async install(): Promise<NotionInstallResult> {
    // A holder keeps the union type across the mutation callback: TypeScript
    // ignores assignments made inside a closure when narrowing a local.
    const outcome = { value: 'reused' as NotionInstallOutcome }
    let applied: RuntimeConfigApplyResponse
    try {
      applied = await this.mcp.setServer(NOTION_MCP_SERVER_ID, (current) => {
        if (!current) {
          outcome.value = 'installed'
          return createNotionMcpServer()
        }
        if (!isNotionMcpTarget(current)) {
          outcome.value = 'conflict'
          return 'exists'
        }
        if (!current.enabled) {
          outcome.value = 'disabled'
          return 'unchanged'
        }
        if (!notionOAuthConfigured(current)) {
          outcome.value = 'oauth_disabled'
          return 'unchanged'
        }
        outcome.value = 'reused'
        return 'unchanged'
      })
    } catch (error) {
      throw new NotionConnectionError('apply_failed', safeMessage(error, 'Notion MCP configuration could not be read'))
    }
    if (outcome.value !== 'conflict') this.assertApplied(applied)
    return { outcome: outcome.value, snapshot: await this.inspect(false) }
  }

  /**
   * Install/reuse, run the existing SDK OAuth flow, then discover tools. A
   * disabled or conflicting server stops before authorization.
   */
  async connect(): Promise<NotionConnectionSnapshot> {
    const installed = await this.install()
    if (installed.outcome === 'conflict' || installed.snapshot.state === 'conflict') {
      throw new NotionConnectionError(
        'conflict',
        `A different MCP server already uses the id ${NOTION_MCP_SERVER_ID}; rename it before connecting Notion`
      )
    }
    if (installed.outcome === 'disabled' || installed.snapshot.state === 'disabled') {
      throw new NotionConnectionError(
        'disabled',
        'Notion is installed but disabled; enable it explicitly before connecting'
      )
    }
    if (installed.outcome === 'oauth_disabled' || installed.snapshot.state === 'oauth_disabled') {
      throw new NotionConnectionError(
        'oauth_disabled',
        'Notion OAuth is disabled in the existing server configuration; enable OAuth explicitly'
      )
    }
    let result: Awaited<ReturnType<NotionMcpPort['authorize']>>
    try {
      result = await this.mcp.authorize(NOTION_MCP_SERVER_ID)
    } catch (error) {
      throw new NotionConnectionError('authorization_failed', safeMessage(error, 'Notion authorization failed'))
    }
    if (!result.authorized) {
      throw new NotionConnectionError('authorization_failed', 'Notion did not finish authorization')
    }
    return await this.inspect(true)
  }

  /** Explicit user action for a matching server that exists but is disabled. */
  async enable(): Promise<NotionConnectionSnapshot> {
    const outcome = { value: 'unchanged' as 'enabled' | 'unchanged' | 'missing' | 'conflict' }
    let applied: RuntimeConfigApplyResponse
    try {
      applied = await this.mcp.setServer(NOTION_MCP_SERVER_ID, (current) => {
        if (!current) {
          outcome.value = 'missing'
          return 'missing'
        }
        if (!isNotionMcpTarget(current)) {
          outcome.value = 'conflict'
          return 'exists'
        }
        if (current.enabled) {
          outcome.value = 'unchanged'
          return 'unchanged'
        }
        outcome.value = 'enabled'
        return { ...current, enabled: true }
      })
    } catch (error) {
      throw new NotionConnectionError('apply_failed', safeMessage(error, 'Notion MCP configuration could not be updated'))
    }
    if (outcome.value === 'conflict') {
      throw new NotionConnectionError(
        'conflict',
        `A different MCP server already uses the id ${NOTION_MCP_SERVER_ID}; it was not changed`
      )
    }
    if (outcome.value === 'missing') {
      throw new NotionConnectionError('not_installed', 'Notion is not installed for this profile')
    }
    this.assertApplied(applied)
    return await this.inspect(false)
  }

  /**
   * Local disconnect: disable only the matching Notion server, then clear its
   * OAuth credentials. A conflicting server is left untouched.
   */
  async disconnect(): Promise<NotionConnectionSnapshot> {
    const outcome = { value: 'unchanged' as 'disabled' | 'unchanged' | 'conflict' }
    let applied: RuntimeConfigApplyResponse
    try {
      applied = await this.mcp.setServer(NOTION_MCP_SERVER_ID, (current) => {
        if (!current) {
          outcome.value = 'unchanged'
          return 'unchanged'
        }
        if (!isNotionMcpTarget(current)) {
          outcome.value = 'conflict'
          return 'exists'
        }
        outcome.value = 'disabled'
        return { ...current, enabled: false }
      })
    } catch (error) {
      throw new NotionConnectionError('disconnect_failed', safeMessage(error, 'Notion MCP could not be disabled'))
    }
    if (outcome.value === 'conflict') {
      throw new NotionConnectionError(
        'conflict',
        `A different MCP server already uses the id ${NOTION_MCP_SERVER_ID}; it was not disconnected`
      )
    }
    this.assertApplied(applied)
    try {
      await this.mcp.clear(NOTION_MCP_SERVER_ID)
    } catch (error) {
      throw new NotionConnectionError('disconnect_failed', safeMessage(error, 'Notion OAuth credentials could not be cleared'))
    }
    return await this.inspect(false)
  }

  private async inspect(discover: boolean): Promise<NotionConnectionSnapshot> {
    let config: McpCapabilityConfig
    try {
      config = await this.mcp.config()
    } catch (error) {
      return snapshot({
        state: 'error',
        nextAction: 'reconnect',
        errorCode: 'configuration_unavailable',
        errorMessage: safeMessage(error, 'Notion MCP configuration is unavailable')
      })
    }
    const server = config.servers[NOTION_MCP_SERVER_ID]
    if (!server) return snapshot({ state: 'not_installed', nextAction: 'install' })
    if (!isNotionMcpTarget(server)) {
      return snapshot({
        state: 'conflict',
        installed: true,
        enabled: server.enabled,
        nextAction: 'resolve_conflict',
        errorCode: 'conflict',
        errorMessage: `A different MCP server already uses the id ${NOTION_MCP_SERVER_ID}`
      })
    }
    if (!server.enabled) {
      return snapshot({ state: 'disabled', installed: true, nextAction: 'enable', errorCode: 'disabled' })
    }
    if (!notionOAuthConfigured(server)) {
      return snapshot({
        state: 'oauth_disabled',
        installed: true,
        enabled: true,
        nextAction: 'configure_oauth',
        errorCode: 'oauth_disabled'
      })
    }
    let oauth: readonly McpOAuthDiagnostic[]
    try {
      oauth = await this.mcp.oauth()
    } catch (error) {
      return snapshot({
        state: 'error',
        installed: true,
        enabled: true,
        nextAction: 'reconnect',
        errorCode: 'oauth_diagnostics_failed',
        errorMessage: safeMessage(error, 'Notion OAuth diagnostics are unavailable')
      })
    }
    const diagnostic = oauth.find((entry) => entry.serverId === NOTION_MCP_SERVER_ID)
    const oauthStatus = diagnostic?.status
    const base = { installed: true, enabled: true, ...(oauthStatus ? { oauthStatus } : {}) }
    if (!oauthStatus || oauthStatus === 'empty' || oauthStatus === 'partial') {
      return snapshot({
        ...base,
        state: 'authorization_required',
        nextAction: 'authorize'
      })
    }
    if (oauthStatus === 'disabled') {
      return snapshot({
        ...base,
        state: 'oauth_disabled',
        nextAction: 'configure_oauth',
        errorCode: 'oauth_disabled'
      })
    }
    if (oauthStatus === 'expired') {
      return snapshot({
        ...base,
        state: 'reauth_required',
        nextAction: 'reconnect'
      })
    }
    if (oauthStatus === 'error') {
      return snapshot({
        ...base,
        state: 'error',
        nextAction: 'reconnect',
        ...(diagnostic?.lastError ? { errorMessage: diagnostic.lastError.slice(0, 512) } : {})
      })
    }
    if (!discover) {
      return snapshot({ ...base, state: 'authorized', nextAction: 'manage' })
    }
    const discovered = await this.discoverCapabilities()
    return snapshot({
      ...base,
      state: discovered.errorCode ? 'error' : 'authorized',
      nextAction: discovered.errorCode ? 'reconnect' : 'manage',
      capabilities: discovered.capabilities,
      toolNames: discovered.toolNames,
      warnings: discovered.warnings,
      ...(discovered.errorCode ? { errorCode: discovered.errorCode, errorMessage: discovered.errorMessage } : {})
    })
  }

  private async discoverCapabilities(): Promise<{
    capabilities: readonly NotionCapability[]
    toolNames: readonly string[]
    warnings: readonly string[]
    errorCode?: 'discovery_failed'
    errorMessage?: string
  }> {
    if (!this.discovery) {
      return {
        capabilities: [],
        toolNames: [],
        warnings: ['Notion capability discovery is unavailable; tools were not listed.'],
        errorCode: 'discovery_failed',
        errorMessage: 'Notion capability discovery is unavailable'
      }
    }
    try {
      const result = await this.discovery.discover(NOTION_MCP_SERVER_ID)
      const mapped = mapNotionCapabilities(result.tools)
      return {
        capabilities: mapped.capabilities,
        toolNames: mapped.toolNames,
        warnings: [...(result.warnings ?? []), ...mapped.warnings]
      }
    } catch (error) {
      return {
        capabilities: [],
        toolNames: [],
        warnings: [`Notion tools/list failed: ${safeMessage(error, 'discovery failed')}`],
        errorCode: 'discovery_failed',
        errorMessage: safeMessage(error, 'Notion tools/list failed')
      }
    }
  }

  private assertApplied(response: RuntimeConfigApplyResponse): void {
    if (!response.ok) throw new NotionConnectionError('apply_failed', response.message)
    const rejected = response.rejectedSections?.mcp
    if (rejected) throw new NotionConnectionError('apply_failed', rejected.message)
  }
}

function snapshot(overrides: Partial<NotionConnectionSnapshot> & Pick<NotionConnectionSnapshot, 'state' | 'nextAction'>): NotionConnectionSnapshot {
  return {
    serverId: NOTION_MCP_SERVER_ID,
    endpoint: NOTION_MCP_ENDPOINT,
    state: overrides.state,
    installed: overrides.installed ?? false,
    enabled: overrides.enabled ?? false,
    nextAction: overrides.nextAction,
    capabilities: overrides.capabilities ?? [],
    toolNames: overrides.toolNames ?? [],
    warnings: overrides.warnings ?? [],
    ...(overrides.oauthStatus ? { oauthStatus: overrides.oauthStatus } : {}),
    ...(overrides.errorCode ? { errorCode: overrides.errorCode } : {}),
    ...(overrides.errorMessage ? { errorMessage: overrides.errorMessage } : {})
  }
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.slice(0, 512) : fallback
}
