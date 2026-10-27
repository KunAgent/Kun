import { AppConnectionError, type AppConnectionStatus, type AppPreset } from '../contracts/app-connections.js'
import { APP_PRESETS, appPreset } from '../contracts/app-connection-catalog.js'
import type { GitHubAuthorization, GitHubConnectionStatus } from '../contracts/github-app.js'
import type { GmailConnectionStatus } from '../contracts/gmail.js'
import type { McpCapabilityConfig, McpServerConfig } from '../contracts/capabilities-core.js'
import type { RuntimeConfigApplyResponse } from '../contracts/runtime-config.js'
import type { McpOAuthAuthorizeResult, McpOAuthClearResult, McpOAuthDiagnostic } from '../adapters/tool/mcp-types.js'
import type { FigmaAccount, FigmaReadServicePort } from '../figma/ports.js'
import type { FigmaCredentialStore } from '../figma/figma-credential-store.js'
import type { FigmaToolState } from '../adapters/tool/figma-tool-provider.js'
import { GITHUB_READ_TOOLS } from '../github-app/mcp.js'

/** figma_read_file, figma_read_nodes, figma_export_images. */
const FIGMA_TOOL_COUNT = 3
const SUPPORTED_PLATFORMS = ['darwin', 'win32', 'linux'] as const

/** Narrow GitHub surface: account login only, never a conversation grant. */
export type AppConnectionsGitHub = {
  status(scopeId?: string, refresh?: boolean): Promise<GitHubConnectionStatus>
  authorizeAccount(): Promise<GitHubAuthorization>
  pollAccount(id: string): Promise<unknown>
  cancelAccount(id: string): Promise<void>
  disconnect(): Promise<void>
}

export type AppConnectionsGmail = {
  status(scopeId?: string): Promise<GmailConnectionStatus>
}

/** Existing MCP configuration authorities; presets reuse them instead of a second store. */
export type AppConnectionsMcp = {
  config(): McpCapabilityConfig
  oauth(): McpOAuthDiagnostic[] | Promise<McpOAuthDiagnostic[]>
  setServer(serverId: string, server: McpServerConfig | null): Promise<RuntimeConfigApplyResponse>
  authorize(serverId: string): Promise<McpOAuthAuthorizeResult>
  clear(serverId: string): Promise<McpOAuthClearResult>
}

export type AppConnectionsDeps = {
  github?: AppConnectionsGitHub
  gmail?: AppConnectionsGmail
  figma?: { credentials: FigmaCredentialStore; service: FigmaReadServicePort; state: FigmaToolState }
  mcp?: AppConnectionsMcp
  platform?: NodeJS.Platform
}

export type AppConnectionAttempt = { presetId: string; attemptId: string; url?: string }

type Snapshot = {
  github?: GitHubConnectionStatus
  gmail?: GmailConnectionStatus
  figmaToken: boolean
  figmaAccount?: FigmaAccount
  figmaError?: { code: string; message: string }
  mcpConfig?: McpCapabilityConfig
  mcpOAuth?: McpOAuthDiagnostic[]
}

/**
 * Thin application layer over the existing connection backends.
 *
 * It owns the catalog, the aggregated safe status, and operation dispatch. It
 * never stores credentials itself, never fabricates a conversation scope, and
 * never reports that a conversation may use an app: account readiness and
 * per-conversation permission stay separate.
 */
export class AppConnectionsService {
  private readonly revisions = new Map<string, number>()
  private readonly figmaAccounts = new Map<string, FigmaAccount>()
  private readonly platform: NodeJS.Platform

  constructor(private readonly deps: AppConnectionsDeps) {
    this.platform = deps.platform ?? process.platform
  }

  catalog(): readonly AppPreset[] {
    return APP_PRESETS
  }

  async list(): Promise<AppConnectionStatus[]> {
    const snapshot = await this.snapshot()
    return APP_PRESETS.map((preset) => this.project(preset, snapshot))
  }

  async status(presetId: string): Promise<AppConnectionStatus> {
    const preset = requirePreset(presetId)
    return this.project(preset, await this.snapshot())
  }

  /** Starts an account-level login. Only presets that are ready may be connected. */
  async connect(presetId: string): Promise<AppConnectionAttempt> {
    const preset = requireReady(presetId, this.platform)
    if (preset.kind === 'native_github') {
      const github = this.deps.github
      if (!github) throw new AppConnectionError('connect_failed', 'GitHub is unavailable in this build')
      try {
        const flow = await github.authorizeAccount()
        this.bump(preset.id)
        return { presetId: preset.id, attemptId: flow.id }
      } catch (error) {
        throw new AppConnectionError('connect_failed', message(error, 'GitHub could not start a login'))
      }
    }
    if (preset.kind === 'native_figma') {
      const figma = this.deps.figma
      if (!figma) throw new AppConnectionError('connect_failed', 'Figma is unavailable in this build')
      if (!(await figma.credentials.status()).stored) {
        throw new AppConnectionError('credential_required', 'Add a Figma personal access token to connect Figma')
      }
      await this.identifyFigma(preset.id)
      figma.state.connected = true
      this.bump(preset.id)
      return { presetId: preset.id, attemptId: preset.id, url: preset.docsUrl }
    }
    if (preset.kind === 'native_gmail') {
      throw new AppConnectionError(
        'unsupported_operation',
        'Gmail connects from a conversation so its data-use acknowledgement stays in context'
      )
    }
    const attempt = await this.connectMcp(preset)
    this.bump(preset.id)
    return attempt
  }

  async pollAttempt(presetId: string, attemptId: string): Promise<unknown> {
    const preset = requirePreset(presetId)
    if (preset.kind === 'native_github') {
      const github = this.deps.github
      if (!github) throw new AppConnectionError('connect_failed', 'GitHub is unavailable in this build')
      return await github.pollAccount(attemptId)
    }
    throw new AppConnectionError('unsupported_operation', 'This connection has no pending authorization')
  }

  async cancelAttempt(presetId: string, attemptId: string): Promise<void> {
    const preset = requirePreset(presetId)
    if (preset.kind === 'native_github') {
      await this.deps.github?.cancelAccount(attemptId)
      this.bump(preset.id)
      return
    }
    throw new AppConnectionError('unsupported_operation', 'This connection has no pending authorization')
  }

  /**
   * Stores a Figma PAT only after the token proves usable. An invalid token is
   * never persisted, and the response never echoes it.
   */
  async setCredential(presetId: string, token: string, expiresAt?: string): Promise<AppConnectionStatus> {
    const preset = requirePreset(presetId)
    if (preset.kind !== 'native_figma') {
      throw new AppConnectionError('unsupported_operation', 'This app does not accept a stored credential')
    }
    const figma = this.deps.figma
    if (!figma) throw new AppConnectionError('connect_failed', 'Figma is unavailable in this build')
    const trimmed = token.trim()
    if (!trimmed) throw new AppConnectionError('credential_required', 'A Figma personal access token is required')
    try {
      await figma.credentials.saveToken(trimmed, expiresAt)
    } catch {
      throw new AppConnectionError('credential_store_unavailable', 'Kun could not store the Figma token securely')
    }
    try {
      await this.identifyFigma(preset.id)
    } catch (error) {
      await figma.credentials.clearToken().catch(() => undefined)
      figma.state.connected = false
      this.bump(preset.id)
      const detail = message(error, 'Figma rejected this token')
      throw new AppConnectionError('credential_rejected', detail)
    }
    figma.state.connected = true
    this.bump(preset.id)
    return this.status(preset.id)
  }

  /** Re-reads identity and tools from the provider without changing credentials. */
  async check(presetId: string): Promise<AppConnectionStatus> {
    const preset = requirePreset(presetId)
    if (preset.kind === 'native_github') await this.deps.github?.status(undefined, true).catch(() => undefined)
    if (preset.kind === 'native_figma' && this.deps.figma) {
      try {
        await this.identifyFigma(preset.id)
        this.deps.figma.state.connected = true
      } catch {
        this.deps.figma.state.connected = false
      }
      this.bump(preset.id)
    }
    return this.status(preset.id)
  }

  /**
   * Local disconnect: credentials and tools stop here. Provider-side revocation
   * is a separate, explicit action and is never implied by this result.
   */
  async disconnect(presetId: string): Promise<AppConnectionStatus> {
    const preset = requirePreset(presetId)
    if (preset.kind === 'native_github') {
      await this.deps.github?.disconnect()
    } else if (preset.kind === 'native_figma') {
      await this.deps.figma?.credentials.clearToken()
      if (this.deps.figma) this.deps.figma.state.connected = false
      this.figmaAccounts.delete(preset.id)
    } else if (preset.kind === 'mcp_oauth' || preset.kind === 'mcp_local') {
      const mcp = this.deps.mcp
      if (!mcp) throw new AppConnectionError('connect_failed', 'MCP configuration is unavailable')
      await mcp.clear(preset.id)
      const server = mcp.config().servers[preset.id]
      if (server) await mcp.setServer(preset.id, { ...server, enabled: false })
    } else {
      throw new AppConnectionError(
        'unsupported_operation',
        'Gmail disconnects from its conversation card so the model-sharing consent is withdrawn together'
      )
    }
    this.bump(preset.id)
    return this.status(preset.id)
  }

  private async connectMcp(preset: AppPreset): Promise<AppConnectionAttempt> {
    const mcp = this.deps.mcp
    if (!mcp || (preset.kind !== 'mcp_oauth' && preset.kind !== 'mcp_local')) {
      throw new AppConnectionError('connect_failed', 'MCP configuration is unavailable')
    }
    const endpoint = preset.endpoint
    if (!endpoint) throw new AppConnectionError('not_ready', 'This app has no verified endpoint yet')
    const existing = mcp.config().servers[preset.id]
    if (existing && !sameTarget(existing, endpoint)) {
      throw new AppConnectionError(
        'connect_failed',
        `A different MCP server already uses the id ${preset.id}; rename it before connecting ${preset.name}`
      )
    }
    if (!existing) {
      const server: McpServerConfig = {
        enabled: true,
        transport: 'streamable-http',
        url: endpoint,
        trustScope: 'user',
        ...(preset.kind === 'mcp_oauth'
          ? { oauth: { enabled: true, scopes: [], callbackTimeoutMs: 120_000 } }
          : {})
      } as McpServerConfig
      const applied = await mcp.setServer(preset.id, server)
      if (!applied.ok) throw new AppConnectionError('connect_failed', applied.message)
    }
    if (preset.kind === 'mcp_local') return { presetId: preset.id, attemptId: preset.id, url: endpoint }
    const result = await mcp.authorize(preset.id)
    if (!result.authorized) {
      throw new AppConnectionError('connect_failed', `${preset.name} did not finish authorization`)
    }
    return { presetId: preset.id, attemptId: preset.id, url: endpoint }
  }

  private async identifyFigma(presetId: string): Promise<FigmaAccount> {
    const figma = this.deps.figma
    if (!figma) throw new AppConnectionError('connect_failed', 'Figma is unavailable in this build')
    const account = await figma.service.identify()
    this.figmaAccounts.set(presetId, account)
    return account
  }

  private async snapshot(): Promise<Snapshot> {
    const [github, gmail, mcpConfig, mcpOAuth] = await Promise.all([
      this.deps.github?.status(undefined, false).catch(() => undefined),
      this.deps.gmail?.status().catch(() => undefined),
      Promise.resolve(this.deps.mcp?.config()),
      Promise.resolve(this.deps.mcp?.oauth()).catch(() => undefined)
    ])
    const figmaToken = await this.deps.figma?.credentials.status().then((value) => value.stored).catch(() => false)
    return {
      ...(github ? { github } : {}),
      ...(gmail ? { gmail } : {}),
      figmaToken: figmaToken ?? false,
      ...(this.figmaAccounts.get('figma-api') ? { figmaAccount: this.figmaAccounts.get('figma-api')! } : {}),
      ...(mcpConfig ? { mcpConfig } : {}),
      ...(mcpOAuth ? { mcpOAuth } : {})
    }
  }

  private project(preset: AppPreset, snapshot: Snapshot): AppConnectionStatus {
    const base = {
      presetId: preset.id,
      appId: preset.appId,
      runtimeProviderId: preset.runtimeProviderId,
      name: preset.name,
      kind: preset.kind,
      availability: preset.availability,
      platformSupported: supportsPlatform(preset.platforms, this.platform),
      revision: this.revisions.get(preset.id) ?? 0
    }
    if (preset.kind === 'native_github') {
      const status = snapshot.github
      const connected = status?.connected === true && status?.reconnectRequired !== true
      return {
        ...base,
        installed: Boolean(status?.configured),
        accountStatus: status?.pendingAccountAuthorization?.status === 'pending'
          ? 'pending'
          : connected ? 'connected' : status?.configured ? 'disconnected' : 'unavailable',
        transportStatus: connected ? 'ready' : 'unknown',
        ...(status?.login ? { accountLabel: status.login } : {}),
        toolCount: connected ? GITHUB_READ_TOOLS.length : 0,
        ...(status?.configured ? {} : { errorCode: 'app_not_configured' }),
        ...(status?.reconnectRequired ? { nextAction: 'reconnect' } : {}),
        ...(status?.pendingAccountAuthorization ? { nextAction: 'authorize' } : {})
      }
    }
    if (preset.kind === 'native_gmail') {
      const status = snapshot.gmail
      const connected = status?.connected === true && status?.reconnectRequired !== true
      return {
        ...base,
        installed: Boolean(status?.configured),
        accountStatus: connected ? 'connected' : status?.configured ? 'disconnected' : 'unavailable',
        transportStatus: 'not_applicable',
        ...(status?.email ? { accountLabel: status.email } : {}),
        toolCount: connected ? 1 : 0,
        ...(status?.configured ? {} : { errorCode: 'app_not_configured' }),
        nextAction: connected ? 'manage' : 'connect_in_conversation'
      }
    }
    if (preset.kind === 'native_figma') {
      const account = snapshot.figmaAccount
      return {
        ...base,
        installed: snapshot.figmaToken,
        accountStatus: snapshot.figmaToken ? 'connected' : 'disconnected',
        transportStatus: snapshot.figmaToken ? 'ready' : 'not_applicable',
        ...(account?.handle ? { accountLabel: account.handle } : {}),
        ...(account?.email ? { workspaceLabel: account.email } : {}),
        toolCount: snapshot.figmaToken ? FIGMA_TOOL_COUNT : 0,
        nextAction: snapshot.figmaToken ? 'manage' : 'add_credential'
      }
    }
    const server = snapshot.mcpConfig?.servers[preset.id]
    const oauth = snapshot.mcpOAuth?.find((entry) => entry.serverId === preset.id)
    const authorized = oauth?.status === 'authorized'
    const needsAuth = preset.kind === 'mcp_oauth' ? authorized : Boolean(server)
    return {
      ...base,
      installed: Boolean(server),
      accountStatus: needsAuth ? 'connected' : oauth?.status === 'expired' ? 'error' : 'disconnected',
      transportStatus: needsAuth ? 'ready' : 'unknown',
      toolCount: 0,
      ...(oauth?.lastError ? { errorMessage: oauth.lastError.slice(0, 512) } : {}),
      nextAction: needsAuth ? 'manage' : 'connect'
    }
  }

  private bump(presetId: string): void {
    this.revisions.set(presetId, (this.revisions.get(presetId) ?? 0) + 1)
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.slice(0, 512) : fallback
}

function requirePreset(presetId: string): AppPreset {
  const preset = appPreset(presetId)
  if (!preset) throw new AppConnectionError('not_found', `Unknown app connection preset: ${presetId}`)
  return preset
}

function requireReady(presetId: string, platform: NodeJS.Platform): AppPreset {
  const preset = requirePreset(presetId)
  if (preset.availability !== 'ready') {
    throw new AppConnectionError('not_ready', `${preset.name} is not available yet`)
  }
  if (!supportsPlatform(preset.platforms, platform)) {
    throw new AppConnectionError('platform_unsupported', `${preset.name} is not supported on this platform`)
  }
  return preset
}

function supportsPlatform(platforms: readonly string[], platform: NodeJS.Platform): boolean {
  return (SUPPORTED_PLATFORMS as readonly string[]).includes(platform) && platforms.includes(platform)
}

function sameTarget(server: McpServerConfig, endpoint: string): boolean {
  return server.transport === 'streamable-http' && server.url === endpoint
}
