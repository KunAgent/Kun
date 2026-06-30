import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig } from '../../contracts/capabilities.js'
import { resolveMcpServerCwd } from './mcp-naming.js'
import {
  FileMcpOAuthProvider,
  createMcpOAuthProvider,
  defaultOpenExternal
} from './mcp-oauth-provider.js'
import { buildMcpStdioEnvironment, errorMessage } from './mcp-stdio-environment.js'
import { redactSecretText } from '../../config/secret-redaction.js'
import {
  McpAuthorizationRequiredError,
  isMcpAuthorizationRequiredError,
  type McpClientLike,
  type McpOAuthAuthorizeResult
} from './mcp-types.js'

type OAuthTransport = Transport & {
  finishAuth?: (authorizationCode: string) => Promise<void>
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
}

export { McpAuthorizationRequiredError, isMcpAuthorizationRequiredError }

export async function createSdkMcpClient(
  serverId: string,
  server: McpServerConfig,
  options: SdkMcpClientOptions = {}
): Promise<McpClientLike> {
  const client = new Client({ name: `kun-${serverId}`, version: '0.1.0' })
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
    ...(options.encryptor ? { encryptor: options.encryptor } : {})
  })
  let transport = createTransport(server, authProvider)
  try {
    await client.connect(transport, { timeout: server.timeoutMs })
  } catch (error) {
    // The non-interactive provider throws this synchronously from
    // redirectToAuthorization (before any browser/callback), so it surfaces
    // here as the connect rejection. Propagate it untouched.
    if (isMcpAuthorizationRequiredError(error)) {
      await client.close().catch(() => undefined)
      throw error
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
      const authorizationCode = await authProvider.waitForAuthorizationCode()
      await transport.finishAuth(authorizationCode)
    } catch (authError) {
      await authProvider.recordAuthorizationError(errorMessage(authError)).catch(() => undefined)
      await client.close().catch(() => undefined)
      throw authError
    }
    transport = createTransport(server, authProvider)
    await client.connect(transport, { timeout: server.timeoutMs })
  }
  return {
    listTools: (listOptions) => {
      const params = listOptions?.cursor ? { cursor: listOptions.cursor } : undefined
      return client.listTools(params, {
        signal: listOptions?.signal,
        timeout: listOptions?.timeout
      })
    },
    callTool: (input, callOptions) => client.callTool(input, undefined, callOptions),
    close: () => client.close(),
    setLifecycleHandlers: (handlers) => {
      ;(client as { onerror?: (error: Error) => void }).onerror = handlers.onError
      ;(client as { onclose?: () => void }).onclose = handlers.onClose
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
  }
): Promise<McpOAuthAuthorizeResult> {
  const provider = createMcpOAuthProvider(serverId, server, {
    storageDir: options.storageDir,
    openExternal: options.openExternal ?? defaultOpenExternal,
    interactive: true,
    encryptor: options.encryptor
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
      encryptor: options.encryptor
    })
  } catch (error) {
    await provider.recordAuthorizationError(errorMessage(error)).catch(() => undefined)
  } finally {
    await client?.close().catch(() => undefined)
  }
  const diagnostics = await provider.diagnostics()
  return { serverId, status: diagnostics.status, authorized: diagnostics.status === 'authorized' }
}

export function createTransport(server: McpServerConfig, authProvider?: OAuthClientProvider): OAuthTransport {
  switch (server.transport) {
    case 'stdio': {
      const cwd = resolveMcpServerCwd(server)
      return new StdioClientTransport({
        command: server.command ?? '',
        args: server.args,
        env: buildMcpStdioEnvironment(server.env),
        ...(cwd ? { cwd } : {}),
        stderr: 'pipe'
      })
    }
    case 'streamable-http':
      return new StreamableHTTPClientTransport(new URL(server.url ?? ''), {
        ...(authProvider ? { authProvider } : {}),
        requestInit: { headers: server.headers }
      })
    case 'sse':
      return new SSEClientTransport(new URL(server.url ?? ''), {
        ...(authProvider ? { authProvider } : {}),
        requestInit: { headers: server.headers },
        eventSourceInit: { fetch: fetchWithHeaders(server.headers) }
      })
  }
}

export function fetchWithHeaders(headers: Record<string, string>): typeof fetch {
  return (input, init) => {
    const mergedHeaders = new Headers(init?.headers)
    for (const [key, value] of Object.entries(headers)) {
      mergedHeaders.set(key, value)
    }
    return fetch(input, { ...init, headers: mergedHeaders })
  }
}

// Re-export so callers that build providers directly (e.g. an authorize flow)
// can stay on this module's surface.
export { FileMcpOAuthProvider }
