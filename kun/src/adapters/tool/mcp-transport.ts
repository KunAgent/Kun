import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type ClientOptions,
  type OAuthClientProvider,
  type Transport
} from '@modelcontextprotocol/client'
import { OwnedStdioClientTransport } from './mcp-owned-stdio.js'
import type { McpOAuthLifetime } from './mcp-oauth-lifetime.js'
import type { McpServerConfig } from '../../contracts/capabilities.js'
import { isKunManagedGitHubMcpServer } from '../../contracts/builtin-mcp.js'
import { KUN_VERSION } from '../../version.js'
import { resolveMcpServerCwd } from './mcp-naming.js'
import {
  FileMcpOAuthProvider,
  createMcpOAuthProvider,
  defaultOpenExternal
} from './mcp-oauth-provider.js'
import { MCP_APP_HTML_MIME_TYPE, MCP_APPS_EXTENSION_ID } from '../../contracts/mcp-apps.js'
import { McpElicitationRuntime } from './mcp-elicitation.js'
import { buildMcpStdioEnvironment, errorMessage } from './mcp-stdio-environment.js'
import { redactSecretText } from '../../config/secret-redaction.js'
import {
  GITHUB_MCP_AUTHORIZATION_REJECTED_MESSAGE,
  resolveBuiltinGitHubMcpCredentials
} from './github-mcp-credential.js'
import {
  McpAuthorizationRequiredError,
  isMcpAuthorizationRequiredError,
  type McpClientLike,
  type McpOAuthAuthorizeResult
} from './mcp-types.js'

type OAuthTransport = Transport & {
  finishAuth?: (callbackParams: URLSearchParams) => Promise<void>
}

/** Custom fetch handed to the SDK transports; see {@link createTransport}. */
export type McpTransportFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const MCP_HEADER_ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

type SdkClientFacade = Client & {
  listResources?: (params?: { cursor?: string }, options?: { signal?: AbortSignal; timeout?: number }) => Promise<unknown>
  readResource?: (input: { uri: string }, options?: { signal?: AbortSignal; timeout?: number }) => Promise<unknown>
  listResourceTemplates?: (params?: { cursor?: string }, options?: { signal?: AbortSignal; timeout?: number }) => Promise<unknown>
  listPrompts?: (params?: { cursor?: string }, options?: { signal?: AbortSignal; timeout?: number }) => Promise<unknown>
  getPrompt?: (input: { name: string; arguments?: Record<string, unknown> }, options?: { signal?: AbortSignal; timeout?: number }) => Promise<unknown>
}

export type SdkMcpClientOptions = {
  storageDir?: string
  openExternal?: (url: URL) => void | Promise<void>
  /**
   * Whether an unauthorized remote server may launch the interactive browser
   * authorization flow. Defaults to `false` so the startup connect pass never
   * blocks the runtime on a user completing an OAuth handshake; an explicit,
   * user-triggered authorize call passes `true`. The flag is forwarded to the
   * OAuth provider so the browser/callback is refused at the source, not just
   * after the connect throws.
   */
  interactive?: boolean
  /** Optional encryptor; when present, persisted OAuth tokens are encrypted at rest. */
  encryptor?: import('../../security/secret-store.js').SecretEncryptor
  lifetime?: McpOAuthLifetime
}

export { McpAuthorizationRequiredError, isMcpAuthorizationRequiredError }

export async function createSdkMcpClient(
  serverId: string,
  server: McpServerConfig,
  options: SdkMcpClientOptions = {}
): Promise<McpClientLike> {
  options.lifetime?.signal.throwIfAborted()
  const managedGitHub = isKunManagedGitHubMcpServer(server)
  const connectionServer = await resolveBuiltinGitHubMcpCredentials(serverId, server)
  options.lifetime?.signal.throwIfAborted()
  const client = new Client(
    { name: `kun-${serverId}`, version: KUN_VERSION },
    mcpClientOptions(connectionServer)
  )
  const elicitation = new McpElicitationRuntime(serverId, options.openExternal ?? defaultOpenExternal)
  client.setRequestHandler('elicitation/create', async (request) => elicitation.handle(request.params))
  const sdk = client as SdkClientFacade
  // Observe transport-level failures explicitly (#639). The SDK routes a
  // dropped SSE stream / exhausted reconnect to `onerror`; with no handler it
  // is silently swallowed and can escape as an unhandled rejection that
  // destabilizes the runtime. A default logging handler keeps a streamable-http
  // disconnect from taking down the runtime; per-call reconnect still recovers
  // the connection on the next tool use. `setLifecycleHandlers` lets the
  // orchestration override this to drive the reconnect state machine.
  ;(client as { onerror?: (error: Error) => void }).onerror = (error) => {
    process.stderr.write(`kun mcp[${serverId}]: transport error: ${redactSecretText(errorMessage(error))}\n`)
  }
  const authProvider = createMcpOAuthProvider(serverId, server, {
    storageDir: options.storageDir ?? '',
    openExternal: options.openExternal,
    interactive: options.interactive ?? false,
    lifetime: options.lifetime,
    ...(options.encryptor ? { encryptor: options.encryptor } : {})
  })
  let transport = createTransport(connectionServer, authProvider, authProvider?.oauthFetch)
  try {
    await client.connect(transport, { timeout: connectionServer.timeoutMs })
  } catch (error) {
    // The non-interactive provider throws this synchronously from
    // redirectToAuthorization (before any browser/callback), so it surfaces
    // here as the connect rejection. Propagate it untouched.
    if (isMcpAuthorizationRequiredError(error)) {
      await client.close().catch(() => undefined)
      throw error
    }
    if (managedGitHub && isGitHubCredentialRejection(error)) {
      await client.close().catch(() => undefined)
      throw new McpAuthorizationRequiredError(
        serverId,
        GITHUB_MCP_AUTHORIZATION_REJECTED_MESSAGE
      )
    }
    if (!(error instanceof UnauthorizedError) || !authProvider || typeof transport.finishAuth !== 'function') {
      await client.close().catch(() => undefined)
      throw error
    }
    // Defensive: an UnauthorizedError on a non-interactive connect means the
    // SDK reached auth() without the provider throwing — still never open a
    // browser; report "needs authorization".
    if (!options.interactive) {
      await client.close().catch(() => undefined)
      throw new McpAuthorizationRequiredError(serverId)
    }
    try {
      const callbackParams = await authProvider.waitForAuthorizationCallback()
      options.lifetime?.signal.throwIfAborted()
      await transport.finishAuth(callbackParams)
      options.lifetime?.signal.throwIfAborted()
    } catch (authError) {
      await authProvider.recordAuthorizationError(errorMessage(authError)).catch(() => undefined)
      await client.close().catch(() => undefined)
      throw authError
    }
    transport = createTransport(connectionServer, authProvider, authProvider?.oauthFetch)
    try {
      await client.connect(transport, { timeout: connectionServer.timeoutMs })
    } catch (error) {
      await client.close().catch(() => undefined)
      throw error
    }
  }
  if (options.lifetime?.signal.aborted) {
    await client.close().catch(() => undefined)
    options.lifetime.signal.throwIfAborted()
  }
  return {
    listTools: (listOptions) => {
      const params = listOptions?.cursor !== undefined ? { cursor: listOptions.cursor } : undefined
      return client.listTools(params, {
        signal: listOptions?.signal,
        timeout: listOptions?.timeout,
        cacheMode: listOptions?.cacheMode
      })
    },
    callTool: (input, callOptions) => elicitation.run(
      callOptions?.context,
      () => client.callTool(input, {
        signal: callOptions?.signal,
        timeout: callOptions?.timeout
      })
    ),
    ...(sdk.listResources ? {
      listResources: async (listOptions) => {
        const params = listOptions?.cursor !== undefined ? { cursor: listOptions.cursor } : undefined
        return await sdk.listResources?.(params, {
          signal: listOptions?.signal,
          timeout: listOptions?.timeout
        }) as Awaited<ReturnType<NonNullable<McpClientLike['listResources']>>>
      }
    } : {}),
    ...(sdk.readResource ? {
      readResource: async (input, callOptions) => await elicitation.run(
        callOptions?.context,
        () => sdk.readResource?.(input, {
          signal: callOptions?.signal,
          timeout: callOptions?.timeout
        }) as Promise<unknown>
      )
    } : {}),
    ...(sdk.listResourceTemplates ? {
      listResourceTemplates: async (listOptions) => {
        const params = listOptions?.cursor !== undefined ? { cursor: listOptions.cursor } : undefined
        return await sdk.listResourceTemplates?.(params, {
          signal: listOptions?.signal,
          timeout: listOptions?.timeout
        }) as Awaited<ReturnType<NonNullable<McpClientLike['listResourceTemplates']>>>
      }
    } : {}),
    ...(sdk.listPrompts ? {
      listPrompts: async (listOptions) => {
        const params = listOptions?.cursor !== undefined ? { cursor: listOptions.cursor } : undefined
        return await sdk.listPrompts?.(params, {
          signal: listOptions?.signal,
          timeout: listOptions?.timeout
        }) as Awaited<ReturnType<NonNullable<McpClientLike['listPrompts']>>>
      }
    } : {}),
    ...(sdk.getPrompt ? {
      getPrompt: async (input, callOptions) => await elicitation.run(
        callOptions?.context,
        () => sdk.getPrompt?.(input, {
          signal: callOptions?.signal,
          timeout: callOptions?.timeout
        }) as Promise<unknown>
      )
    } : {}),
    protocolEra: client.getProtocolEra(),
    protocolVersion: client.getNegotiatedProtocolVersion(),
    serverInfo: client.getServerVersion(),
    serverCapabilities: client.getServerCapabilities(),
    close: () => client.close(),
    setLifecycleHandlers: (handlers) => {
      ;(client as { onerror?: (error: Error) => void }).onerror = handlers.onError
      ;(client as { onclose?: () => void }).onclose = handlers.onClose
    }
  }
}

function isGitHubCredentialRejection(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true
  return /\b401\b|unauthori[sz]ed|bad credentials/i.test(errorMessage(error))
}

export function mcpClientOptions(server: McpServerConfig): ClientOptions {
  return {
    capabilities: {
      elicitation: { form: {}, url: {} },
      // MCP Apps: servers built on the official template only register their
      // interactive tools when the client advertises the UI extension.
      extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_HTML_MIME_TYPE] } }
    },
    inputRequired: { maxRounds: 10 },
    versionNegotiation: server.transport === 'sse'
      ? { mode: 'legacy' }
      : {
          mode: 'auto',
          probe: {
            timeoutMs: Math.min(server.timeoutMs, 10_000),
            maxRetries: 0
          }
        }
  }
}

/**
 * Run the interactive OAuth authorization flow for one remote MCP server and
 * report the resulting credential status. This is the explicit, user-triggered
 * entry point: it opens the browser, waits for the loopback callback, persists
 * the tokens, then tears the probe connection down. It never participates in
 * the runtime startup path.
 */
export async function authorizeMcpServerOAuth(
  serverId: string,
  server: McpServerConfig,
  options: {
    storageDir: string
    openExternal?: (url: URL) => void | Promise<void>
    encryptor?: import('../../security/secret-store.js').SecretEncryptor
    lifetime?: McpOAuthLifetime
  }
): Promise<McpOAuthAuthorizeResult> {
  const provider = createMcpOAuthProvider(serverId, server, {
    storageDir: options.storageDir,
    openExternal: options.openExternal ?? defaultOpenExternal,
    interactive: true,
    encryptor: options.encryptor,
    lifetime: options.lifetime
  })
  if (!provider) {
    return { serverId, status: 'disabled', authorized: false }
  }
  let client: McpClientLike | undefined
  try {
    client = await createSdkMcpClient(serverId, server, {
      storageDir: options.storageDir,
      openExternal: options.openExternal ?? defaultOpenExternal,
      interactive: true,
      encryptor: options.encryptor,
      lifetime: options.lifetime
    })
  } catch (error) {
    await provider.recordAuthorizationError(errorMessage(error)).catch(() => undefined)
  } finally {
    await client?.close().catch(() => undefined)
  }
  const diagnostics = await provider.diagnostics()
  return { serverId, status: diagnostics.status, authorized: diagnostics.status === 'authorized' }
}

export function createTransport(
  server: McpServerConfig,
  authProvider?: OAuthClientProvider,
  /**
   * Fetch used by the SDK for this transport's traffic *and* for the OAuth
   * discovery/token-endpoint calls of `auth()`. Passing the provider's
   * coordinated fetch keeps a refresh POST and the credential write in one
   * grant-scoped transaction shared across connections and runtime processes.
   */
  oauthFetch?: McpTransportFetch
): OAuthTransport {
  switch (server.transport) {
    case 'stdio': {
      const cwd = resolveMcpServerCwd(server)
      return new OwnedStdioClientTransport({
        command: server.command ?? '',
        args: server.args,
        env: buildMcpStdioEnvironment(server.env),
        ...(cwd ? { cwd } : {}),
        stderr: 'pipe'
      })
    }
    case 'streamable-http': {
      const headers = resolveMcpHeaders(server.headers)
      return new StreamableHTTPClientTransport(new URL(server.url ?? ''), {
        ...(authProvider ? { authProvider } : {}),
        ...(oauthFetch ? { fetch: oauthFetch } : {}),
        requestInit: { headers }
      })
    }
    case 'sse': {
      const headers = resolveMcpHeaders(server.headers)
      return new SSEClientTransport(new URL(server.url ?? ''), {
        ...(authProvider ? { authProvider } : {}),
        ...(oauthFetch ? { fetch: oauthFetch } : {}),
        requestInit: { headers },
        eventSourceInit: { fetch: fetchWithHeaders(headers, oauthFetch) }
      })
    }
  }
}

/**
 * Resolve ${ENV_VAR} references in remote MCP header values without mutating
 * the persisted server configuration. Errors name only the header and missing
 * variable so a partially resolved secret can never reach logs or diagnostics.
 */
export function resolveMcpHeaders(
  headers: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [headerName, headerValue] of Object.entries(headers)) {
    resolved[headerName] = headerValue.replace(MCP_HEADER_ENV_REFERENCE, (_reference, variableName: string) => {
      const value = env[variableName]
      if (value === undefined) {
        throw new Error(
          `MCP header "${headerName}" references missing environment variable "${variableName}"`
        )
      }
      return value
    })
  }
  return resolved
}

export function fetchWithHeaders(headers: Record<string, string>, baseFetch: McpTransportFetch = fetch): typeof fetch {
  return (input, init) => {
    const mergedHeaders = new Headers(init?.headers)
    for (const [key, value] of Object.entries(headers)) {
      mergedHeaders.set(key, value)
    }
    return baseFetch(input, { ...init, headers: mergedHeaders })
  }
}

// Re-export so callers that build providers directly (e.g. an authorize flow)
// can stay on this module's surface.
export { FileMcpOAuthProvider }
