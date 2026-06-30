import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SecretEncryptor } from '../../security/secret-store.js'
import { isEncryptedEnvelope } from '../../security/secret-store.js'

/**
 * Persisted OAuth credential material for a single remote MCP server.
 *
 * Tokens, client registration, the in-flight code verifier, and discovery
 * metadata are stored on disk (mode 0600) so an authorized server keeps
 * working across runtime restarts without re-prompting the user. The store
 * also records lifecycle metadata used by diagnostics:
 *
 * - `tokensObtainedAt` lets diagnostics compute access-token expiry.
 * - `lastError` / `lastErrorAt` surface the most recent failed authorization
 *   attempt (e.g. a loopback callback error) so the GUI can explain why a
 *   server is not authorized instead of showing a bare "error".
 */
export type McpOAuthState = {
  clientInformation?: OAuthClientInformationMixed
  tokens?: OAuthTokens
  codeVerifier?: string
  discoveryState?: OAuthDiscoveryState
  /** Epoch milliseconds when the current tokens were saved. */
  tokensObtainedAt?: number
  /** Sanitized message from the most recent failed authorization attempt. */
  lastError?: string
  /** ISO timestamp of the most recent failed authorization attempt. */
  lastErrorAt?: string
}

type EncryptedMcpOAuthState = { __enc: string }

/**
 * Atomic, single-file JSON persistence for one server's OAuth state.
 *
 * Writes go through a temp file + rename so a crash mid-write cannot leave a
 * partially serialized credential file behind. The directory and file are
 * created with restrictive permissions because they hold bearer tokens.
 */
export class FileMcpOAuthStore {
  constructor(
    private readonly storagePath: string,
    /** Optional encryptor; when present, bearer tokens are encrypted at rest. */
    private readonly encryptor?: SecretEncryptor
  ) {}

  get path(): string {
    return this.storagePath
  }

  async read(): Promise<McpOAuthState> {
    try {
      const parsed = JSON.parse(await readFile(this.storagePath, 'utf8')) as unknown
      if (isEncryptedMcpOAuthState(parsed)) return this.decryptEnvelope(parsed)
      if (!isMcpOAuthState(parsed)) return {}
      return this.decryptLegacyState(parsed)
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) return {}
      throw error
    }
  }

  async update(update: (state: McpOAuthState) => McpOAuthState): Promise<void> {
    const next = update(await this.read())
    await mkdir(dirname(this.storagePath), { recursive: true, mode: 0o700 })
    const temporaryPath = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(this.encryptState(next), null, 2)}\n`, { mode: 0o600 })
      await chmod(temporaryPath, 0o600).catch(() => undefined)
      await rename(temporaryPath, this.storagePath)
      await chmod(this.storagePath, 0o600).catch(() => undefined)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }

  async clear(): Promise<void> {
    await rm(this.storagePath, { force: true })
  }

  /** Encrypt all persisted OAuth state, including client secrets and PKCE data. */
  private encryptState(state: McpOAuthState): McpOAuthState | EncryptedMcpOAuthState {
    if (!this.encryptor) return state
    return { __enc: this.encryptor.encrypt(JSON.stringify(state)) }
  }

  private decryptEnvelope(envelope: EncryptedMcpOAuthState): McpOAuthState {
    if (!this.encryptor) throw new Error('MCP OAuth credential store is encrypted but no decryptor is available')
    try {
      const parsed = JSON.parse(this.encryptor.decrypt(envelope.__enc)) as unknown
      if (!isMcpOAuthState(parsed)) throw new Error('decrypted OAuth state is invalid')
      return parsed
    } catch (error) {
      throw new Error('MCP OAuth credential store could not be decrypted; restore the original key or re-authorize the connector', { cause: error })
    }
  }

  /** Transparently migrate the old format that encrypted only the token field. */
  private decryptLegacyState(state: McpOAuthState): McpOAuthState {
    const tokens = state.tokens as unknown as { __enc?: string } | undefined
    if (!this.encryptor || !tokens || typeof tokens.__enc !== 'string') return state
    if (!isEncryptedEnvelope(tokens.__enc)) return state
    try {
      return { ...state, tokens: JSON.parse(this.encryptor.decrypt(tokens.__enc)) as McpOAuthState['tokens'] }
    } catch (error) {
      throw new Error('MCP OAuth token store could not be decrypted; restore the original key or re-authorize the connector', { cause: error })
    }
  }
}

function isEncryptedMcpOAuthState(value: unknown): value is EncryptedMcpOAuthState {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === 1 && '__enc' in value &&
    typeof (value as { __enc?: unknown }).__enc === 'string'
}

export function isMcpOAuthState(value: unknown): value is McpOAuthState {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}
