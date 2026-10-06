import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// These are the installed-application OAuth identifiers published by the
// Apache-2.0 licensed official Gemini CLI. Installed-app client secrets are
// intentionally embedded application identifiers, not user credentials.
export const GEMINI_CLI_OAUTH_CLIENT_ID =
  '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com'
export const GEMINI_CLI_OAUTH_CLIENT_SECRET =
  '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'
export const GEMINI_CLI_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export type GeminiCliOAuthCredential = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  scope?: string
}

export type GeminiCliOAuthSourceOptions = {
  credentialPath?: string
  fetchImpl?: typeof fetch
  now?: () => number
  loadCredential?: () => Promise<GeminiCliOAuthCredential | null>
}

/**
 * Loads the OAuth login owned by the official Gemini CLI and refreshes it in
 * memory. Kun never copies the credential into settings, config.json, traces,
 * or its own account store.
 */
export class GeminiCliOAuthSource {
  private readonly credentialPath: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly loadCredentialOverride?: () => Promise<GeminiCliOAuthCredential | null>
  private credential: GeminiCliOAuthCredential | null = null

  constructor(options: GeminiCliOAuthSourceOptions = {}) {
    this.credentialPath = options.credentialPath ??
      process.env.KUN_GEMINI_CLI_OAUTH_PATH?.trim() ??
      join(homedir(), '.gemini', 'oauth_creds.json')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.loadCredentialOverride = options.loadCredential
  }

  async accessToken(rejectedAccessToken?: string): Promise<string> {
    const credential = this.credential ?? await this.loadCredential()
    this.credential = credential

    const accessToken = credential.accessToken?.trim()
    const usable = Boolean(
      accessToken &&
      accessToken !== rejectedAccessToken &&
      (!credential.expiresAt || credential.expiresAt > this.now() + 60_000)
    )
    if (usable) return accessToken!

    const refreshToken = credential.refreshToken?.trim()
    if (!refreshToken) {
      throw geminiCliLoginRequired()
    }
    const refreshed = await this.refresh(refreshToken)
    this.credential = {
      ...credential,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
      tokenType: refreshed.tokenType ?? credential.tokenType,
      scope: refreshed.scope ?? credential.scope
    }
    return refreshed.accessToken
  }

  private async loadCredential(): Promise<GeminiCliOAuthCredential> {
    const loaded = this.loadCredentialOverride
      ? await this.loadCredentialOverride()
      : await loadOfficialGeminiCliCredential(this.credentialPath)
    if (!loaded || (!loaded.accessToken?.trim() && !loaded.refreshToken?.trim())) {
      throw geminiCliLoginRequired()
    }
    return loaded
  }

  private async refresh(refreshToken: string): Promise<{
    accessToken: string
    expiresAt?: number
    tokenType?: string
    scope?: string
  }> {
    let response: Response
    try {
      response = await this.fetchImpl(GEMINI_CLI_OAUTH_TOKEN_URL, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GEMINI_CLI_OAUTH_CLIENT_ID,
          client_secret: GEMINI_CLI_OAUTH_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        })
      })
    } catch (error) {
      throw new Error(`Gemini CLI OAuth refresh failed: ${safeErrorMessage(error)}`)
    }
    const payload = await response.json().catch(() => null) as {
      access_token?: unknown
      expires_in?: unknown
      token_type?: unknown
      scope?: unknown
      error?: unknown
      error_description?: unknown
    } | null
    const nextAccessToken =
      typeof payload?.access_token === 'string' ? payload.access_token.trim() : ''
    if (!response.ok || !nextAccessToken) {
      const detail = typeof payload?.error_description === 'string'
        ? payload.error_description
        : typeof payload?.error === 'string'
          ? payload.error
          : `HTTP ${response.status}`
      throw new Error(
        `Gemini CLI OAuth refresh failed: ${boundedText(detail)}. Run \`gemini\` and sign in with Google again.`
      )
    }
    const expiresIn = typeof payload?.expires_in === 'number' && Number.isFinite(payload.expires_in)
      ? Math.max(0, payload.expires_in)
      : undefined
    return {
      accessToken: nextAccessToken,
      ...(expiresIn !== undefined ? { expiresAt: this.now() + expiresIn * 1_000 } : {}),
      ...(typeof payload?.token_type === 'string' ? { tokenType: payload.token_type } : {}),
      ...(typeof payload?.scope === 'string' ? { scope: payload.scope } : {})
    }
  }
}

export async function loadOfficialGeminiCliCredential(
  legacyCredentialPath = join(homedir(), '.gemini', 'oauth_creds.json')
): Promise<GeminiCliOAuthCredential | null> {
  // New Gemini CLI releases use the OS credential store. macOS exposes the
  // same service/account pair through the `security` command without adding a
  // native keychain dependency to the packaged Kun runtime.
  if (process.platform === 'darwin') {
    const fromKeychain = await loadMacKeychainCredential()
    if (fromKeychain) return fromKeychain
  }
  try {
    const parsed = JSON.parse(await readFile(legacyCredentialPath, 'utf8')) as unknown
    return normalizeGeminiCliCredential(parsed)
  } catch (error) {
    if (isMissingFile(error)) return null
    if (error instanceof SyntaxError) {
      throw new Error(
        `Gemini CLI OAuth credential is malformed. Run \`gemini\` and sign in again.`
      )
    }
    throw new Error(`Unable to read Gemini CLI OAuth credential: ${safeErrorMessage(error)}`)
  }
}

export function normalizeGeminiCliCredential(value: unknown): GeminiCliOAuthCredential | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const token = record.token && typeof record.token === 'object' && !Array.isArray(record.token)
    ? record.token as Record<string, unknown>
    : null
  const accessToken = stringValue(record.access_token) ?? stringValue(token?.accessToken)
  const refreshToken = stringValue(record.refresh_token) ?? stringValue(token?.refreshToken)
  const expiresAt = numberValue(record.expiry_date) ?? numberValue(token?.expiresAt)
  const tokenType = stringValue(record.token_type) ?? stringValue(token?.tokenType)
  const scope = stringValue(record.scope) ?? stringValue(token?.scope)
  if (!accessToken && !refreshToken) return null
  return {
    ...(accessToken ? { accessToken } : {}),
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(tokenType ? { tokenType } : {}),
    ...(scope ? { scope } : {})
  }
}

async function loadMacKeychainCredential(): Promise<GeminiCliOAuthCredential | null> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password',
      '-s',
      'gemini-cli-oauth',
      '-a',
      'main-account',
      '-w'
    ], {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 512 * 1024
    })
    return normalizeGeminiCliCredential(JSON.parse(stdout.trim()) as unknown)
  } catch {
    return null
  }
}

function geminiCliLoginRequired(): Error {
  return new Error(
    'Gemini CLI Google login was not found. Run `gemini`, choose “Login with Google”, and then retry this turn.'
  )
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

function safeErrorMessage(error: unknown): string {
  return boundedText(error instanceof Error ? error.message : String(error))
}

function boundedText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 1_000 ? `${normalized.slice(0, 1_000)}…` : normalized
}
