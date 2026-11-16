import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { validateClaudeSubscriptionToken } from '../shared/claude-subscription-auth'
import type { ModelProviderProfileV1 } from '../shared/app-settings'
import type { ProviderQuotaMetric } from '../shared/provider-quota'
import {
  GeminiCliOAuthSource
} from '../../kun/src/adapters/model/gemini-cli-oauth.js'
import { geminiCliRequestHeaders } from '../../kun/src/adapters/model/provider-cli-identity.js'
import {
  readOpenCodeGoLocalQuota,
  type OpenCodeGoLocalQuotaResult
} from '../../kun/src/services/opencode-go-local-quota.js'
import {
  clearOpenCodeGoCookieCache,
  getOpenCodeGoCookieFailureReason,
  OPENCODE_GO_KEYCHAIN_MESSAGE,
  OPENCODE_GO_SIGN_IN_MESSAGE,
  resolveOpenCodeGoCookie as resolveOpenCodeGoCookieImpl
} from '../../kun/src/services/provider-subscription-quota.js'
import {
  fetchOpenCodeGoWebQuota as fetchOpenCodeGoWebQuotaImpl,
  OpenCodeGoWebQuotaError,
  type OpenCodeGoWebQuotaResult
} from '../../kun/src/services/opencode-go-web-quota.js'
import {
  decodeAntigravityUnifiedOAuth,
  discoverAntigravityOAuthClients,
  resolveAntigravityQuotaCredential
} from '../../kun/src/services/antigravity-quota-credentials.js'
import {
  mergeAntigravityQuotaPools,
  mergeAntigravitySummaryWithBuckets,
  parseAntigravityQuotaSummary
} from '../../kun/src/services/antigravity-quota-pools.js'

export { decodeAntigravityUnifiedOAuth }
import {
  codexUserAgent,
  parseCodexCredentials,
  refreshCodexToken,
  type CodexOAuthCredentials
} from './codex-auth'
import {
  isGrokCredentialExpired,
  parseGrokCredentials,
  refreshGrokToken,
  type GrokOAuthCredentials
} from './grok-auth'

import {
  JsonRecord,
  googleSetupSummary,
  isoDateValue,
  numberValue,
  optionalRecord,
  parseGoogleCodeAssistQuota,
  parseGrokSubscriptionQuota,
  requireRecord,
  stringValue
} from './provider-subscription-quota-parsers'
import {
  assertGrokGrpcStatus,
  boundedResponseBytes,
  grpcWebTrailerFields,
  requestSubscriptionJson,
  requestSubscriptionResponse
} from './provider-subscription-quota-transport'
import {
  CodexQuotaCredential,
  CursorQuotaSession,
  GoogleQuotaCredential,
  GrokQuotaCredential,
  ProviderQuotaAuthorizationError,
  SubscriptionProbeContext,
  SubscriptionQuotaRuntime
} from './provider-subscription-quota-types'

export const execFileAsync = promisify(execFile)

export const SUBSCRIPTION_QUOTA_TIMEOUT_MS = 12_000

export const SUBSCRIPTION_QUOTA_MAX_RESPONSE_BYTES = 256 * 1024

export const CODEX_QUOTA_EARLY_REFRESH_MS = 5 * 60 * 1000

export const codexQuotaCredentialCache = new Map<string, CodexOAuthCredentials>()

export const grokQuotaCredentialCache = new Map<string, GrokOAuthCredentials>()

export const defaultSubscriptionQuotaRuntime: SubscriptionQuotaRuntime = {
  resolveClaudeToken,
  resolveCodexCredential,
  resolveGrokCredential,
  resolveCursorSession,
  resolveAntigravityCredential,
  resolveOpenCodeGoQuota: readOpenCodeGoLocalQuota,
  resolveOpenCodeGoCookie: resolveOpenCodeGoCookieImpl,
  async fetchOpenCodeGoWebQuota(cookieHeader, context) {
    const fetcher = ((input: string | URL | Request, init?: RequestInit) =>
      context.fetcher(
        typeof input === 'string' || input instanceof URL ? input : input.url,
        init,
        context.proxyUrl
      )) as typeof fetch
    return fetchOpenCodeGoWebQuotaImpl({ cookieHeader, fetcher })
  },
  async resolveGeminiCliToken(context) {
    const fetchImpl = ((input: string | URL | Request, init?: RequestInit) =>
      context.fetcher(
        typeof input === 'string' || input instanceof URL ? input : input.url,
        init,
        context.proxyUrl
      )) as typeof fetch
    try {
      return await new GeminiCliOAuthSource({ fetchImpl }).accessToken()
    } catch {
      return undefined
    }
  }
}

export async function probeGrokSubscriptionQuota(
  credential: GrokQuotaCredential,
  context: SubscriptionProbeContext
): Promise<ProviderQuotaMetric[]> {
  const response = await requestSubscriptionResponse(
    'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig',
    {
      method: 'POST',
      headers: {
        Accept: '*/*',
        Authorization: `Bearer ${credential.accessToken}`,
        'Content-Type': 'application/grpc-web+proto',
        Origin: 'https://grok.com',
        Referer: 'https://grok.com/?_s=usage',
        'User-Agent': 'Kun',
        'x-grpc-web': '1',
        'x-user-agent': 'connect-es/2.1.1'
      },
      body: new Uint8Array([0, 0, 0, 0, 0])
    },
    context
  )
  assertGrokGrpcStatus(
    response.headers.get('grpc-status'),
    response.headers.get('grpc-message')
  )
  const bytes = await boundedResponseBytes(response)
  const trailers = grpcWebTrailerFields(bytes)
  assertGrokGrpcStatus(trailers['grpc-status'], trailers['grpc-message'])
  return parseGrokSubscriptionQuota(bytes)
}

export async function probeGoogleCodeAssistQuota(
  credential: GoogleQuotaCredential,
  context: SubscriptionProbeContext,
  client: 'antigravity' | 'gemini-cli'
): Promise<{ metrics: ProviderQuotaMetric[]; summary?: string }> {
  const clientHeaders = client === 'gemini-cli'
    ? geminiCliRequestHeaders()
    : { 'User-Agent': 'antigravity' }
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${credential.accessToken}`,
    'Content-Type': 'application/json',
    ...clientHeaders
  }
  const setup = await requestSubscriptionJson(
    'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        metadata: {
          ideType: client === 'antigravity' ? 'ANTIGRAVITY' : 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI'
        }
      })
    },
    context
  )
  const setupRecord = requireRecord(setup, 'Google Code Assist returned an invalid setup response.')
  const projectValue = setupRecord.cloudaicompanionProject
  const project = typeof projectValue === 'string'
    ? projectValue.trim()
    : stringValue(optionalRecord(projectValue)?.id) ||
      stringValue(optionalRecord(projectValue)?.projectId)
  if (!project) {
    const reason = Array.isArray(setupRecord.ineligibleTiers)
      ? setupRecord.ineligibleTiers
        .map((value) => stringValue(optionalRecord(value)?.reasonMessage))
        .filter(Boolean)
        .join('; ')
      : ''
    throw new Error(
      reason ||
      'Google Code Assist account setup is incomplete. Finish provider onboarding and retry.'
    )
  }
  const body = JSON.stringify(project ? { project } : {})
  let summaryMetrics: ProviderQuotaMetric[] = []
  let prefetchedQuotaPayload: unknown
  if (client === 'antigravity') {
    try {
      const aicodePayload = await requestSubscriptionJson(
        'https://aicode.googleapis.com/v1alpha:fetchQuotaStatus',
        { method: 'GET', headers },
        context
      )
      summaryMetrics = parseAntigravityQuotaSummary(aicodePayload)
      const hasGeminiGroup = summaryMetrics.some((metric) => /\bgemini\b/i.test(metric.label))
      const hasThirdPartyGroup = summaryMetrics.some((metric) => /\b(?:claude|gpt|3p)\b/i.test(metric.label))
      if (summaryMetrics.length > 0 && hasGeminiGroup && hasThirdPartyGroup) {
        return {
          metrics: summaryMetrics,
          ...googleSetupSummary(setupRecord, credential.accountEmail)
        }
      }
      if (summaryMetrics.length === 0) {
        prefetchedQuotaPayload = aicodePayload
      }
    } catch (error) {
      if (error instanceof ProviderQuotaAuthorizationError && error.status === 401) throw error
    }
    if (summaryMetrics.length === 0) {
      try {
        const summaryPayload = await requestSubscriptionJson(
          'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
          { method: 'POST', headers, body },
          context
        )
        summaryMetrics = parseAntigravityQuotaSummary(summaryPayload)
        if (summaryMetrics.length === 0 && !prefetchedQuotaPayload) {
          prefetchedQuotaPayload = summaryPayload
        }
      } catch (error) {
        if (error instanceof ProviderQuotaAuthorizationError && error.status === 401) throw error
      }
    }
    if (summaryMetrics.length === 0 && prefetchedQuotaPayload !== undefined) {
      try {
        const parsed = parseGoogleCodeAssistQuota(prefetchedQuotaPayload)
        return {
          metrics: mergeAntigravityQuotaPools(parsed),
          ...googleSetupSummary(setupRecord, credential.accountEmail)
        }
      } catch {
        // Fall through to retrieveUserQuota.
      }
    }
  }
  let quotaPayload: unknown
  try {
    quotaPayload = await requestSubscriptionJson(
      'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
      { method: 'POST', headers, body },
      context
    )
    const parsed = parseGoogleCodeAssistQuota(quotaPayload)
    return {
      metrics: client === 'antigravity'
        ? mergeAntigravitySummaryWithBuckets(summaryMetrics, parsed)
        : parsed,
      ...googleSetupSummary(setupRecord, credential.accountEmail)
    }
  } catch (error) {
    if (error instanceof ProviderQuotaAuthorizationError) throw error
    try {
      quotaPayload = await requestSubscriptionJson(
        'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
        { method: 'POST', headers, body },
        context
      )
    } catch (fallbackError) {
      if (summaryMetrics.length > 0) {
        return {
          metrics: summaryMetrics,
          ...googleSetupSummary(setupRecord, credential.accountEmail)
        }
      }
      throw fallbackError
    }
  }
  const parsed = parseGoogleCodeAssistQuota(quotaPayload)
  return {
    metrics: client === 'antigravity'
      ? mergeAntigravitySummaryWithBuckets(summaryMetrics, parsed)
      : parsed,
    ...googleSetupSummary(setupRecord, credential.accountEmail)
  }
}

export async function resolveClaudeToken(provider: ModelProviderProfileV1): Promise<string | undefined> {
  const configured = validateClaudeSubscriptionToken(provider.apiKey)
  if (configured.ok) return configured.token
  const file = await readJsonFile(join(homedir(), '.claude', '.credentials.json'))
  const fromFile = claudeAccessToken(file)
  if (fromFile) return fromFile
  if (process.platform !== 'darwin') return undefined
  try {
    const { stdout } = await execFileAsync('/usr/bin/security', [
      'find-generic-password',
      '-s',
      'Claude Code-credentials',
      '-w'
    ], {
      encoding: 'utf8',
      timeout: 5_000,
      maxBuffer: 512 * 1024
    })
    return claudeAccessToken(JSON.parse(stdout.trim()) as unknown)
  } catch {
    return undefined
  }
}

export async function resolveCodexCredential(
  provider: ModelProviderProfileV1,
  rejectedAccessToken?: string,
  context?: SubscriptionProbeContext
): Promise<CodexQuotaCredential | undefined> {
  const ambient = provider.apiKey.trim()
    ? undefined
    : await readJsonFile(join(
        configuredHomeDirectory('CODEX_HOME', '.codex'),
        'auth.json'
      ))
  const root = optionalRecord(ambient)
  const tokens = optionalRecord(root?.tokens)
  const configured = parseCodexCredentials(provider.apiKey.trim())
  const accessToken = stringValue(tokens?.access_token) || stringValue(tokens?.accessToken)
  const refreshToken = stringValue(tokens?.refresh_token) || stringValue(tokens?.refreshToken)
  const accountId = stringValue(tokens?.account_id) || stringValue(tokens?.accountId)
  const source = configured ?? (
    accessToken && refreshToken && accountId
      ? {
          kind: 'codex-oauth' as const,
          accessToken,
          refreshToken,
          expiresAt: jwtExpiryMs(accessToken),
          accountId
        }
      : undefined
  )
  if (!source) {
    if (!accessToken) return undefined
    return { accessToken, ...(accountId ? { accountId } : {}) }
  }

  const cached = codexQuotaCredentialCache.get(source.refreshToken)
  const credential = cached ?? source
  const rejectedCurrentToken = Boolean(
    rejectedAccessToken && credential.accessToken === rejectedAccessToken
  )
  const expiresSoon = !Number.isFinite(credential.expiresAt) ||
    credential.expiresAt <= 0 ||
    Date.now() >= credential.expiresAt - CODEX_QUOTA_EARLY_REFRESH_MS
  if (!rejectedCurrentToken && !expiresSoon) return codexQuotaCredential(credential)

  const refreshed = await refreshCodexToken(credential, context
    ? { fetcher: context.fetcher, proxyUrl: context.proxyUrl }
    : {})
  if (!refreshed) {
    if (!rejectedCurrentToken && Date.now() < credential.expiresAt) {
      return codexQuotaCredential(credential)
    }
    return undefined
  }
  codexQuotaCredentialCache.set(source.refreshToken, refreshed)
  codexQuotaCredentialCache.set(refreshed.refreshToken, refreshed)
  return codexQuotaCredential(refreshed)
}

export function codexQuotaCredential(credentials: CodexOAuthCredentials): CodexQuotaCredential {
  return {
    accessToken: credentials.accessToken,
    accountId: credentials.accountId
  }
}

export function jwtExpiryMs(token: string): number {
  const body = token.split('.')[1]
  if (!body) return 0
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp)
      ? claims.exp * 1_000
      : 0
  } catch {
    return 0
  }
}

export async function resolveGrokCredential(
  provider: ModelProviderProfileV1,
  rejectedAccessToken?: string,
  context?: SubscriptionProbeContext
): Promise<GrokQuotaCredential | undefined> {
  const configured = parseGrokCredentials(provider.apiKey.trim())
  if (configured) {
    return refreshableGrokQuotaCredential(configured, rejectedAccessToken, context)
  }
  const configuredToken = provider.apiKey.trim()
  if (configuredToken && !configuredToken.startsWith('{') && configuredToken !== rejectedAccessToken) {
    return { accessToken: configuredToken }
  }

  const ambient = optionalRecord(await readJsonFile(join(
    configuredHomeDirectory('GROK_HOME', '.grok'),
    'auth.json'
  )))
  if (!ambient) return undefined
  const candidates = Object.entries(ambient)
    .filter(([scope, value]) =>
      (
        scope.startsWith('https://auth.x.ai::') ||
        scope === 'https://accounts.x.ai/sign-in' ||
        scope.includes('/sign-in')
      ) &&
      optionalRecord(value)
    )
    .sort(([left], [right]) => {
      const leftPreferred = left.startsWith('https://auth.x.ai::') ? 0 : 1
      const rightPreferred = right.startsWith('https://auth.x.ai::') ? 0 : 1
      return leftPreferred - rightPreferred
    })
  for (const [, rawEntry] of candidates) {
    const entry = optionalRecord(rawEntry)
    const accessToken = stringValue(entry?.key)
    if (!accessToken || accessToken === rejectedAccessToken) continue
    const email = stringValue(entry?.email)
    const refreshToken = stringValue(entry?.refresh_token)
    const expiresAtValue = isoDateValue(entry?.expires_at)
    const expiresAt = expiresAtValue ? new Date(expiresAtValue).getTime() : jwtExpiryMs(accessToken)
    if (refreshToken) {
      const credential = await refreshableGrokQuotaCredential({
        kind: 'grok-oauth',
        accessToken,
        refreshToken,
        expiresAt,
        ...(email ? { email } : {}),
        ...(stringValue(entry?.user_id) ? { userId: stringValue(entry?.user_id) } : {}),
        ...(stringValue(entry?.oidc_issuer) ? { issuer: stringValue(entry?.oidc_issuer) } : {}),
        ...(stringValue(entry?.oidc_client_id) ? { clientId: stringValue(entry?.oidc_client_id) } : {})
      }, rejectedAccessToken, context)
      if (credential) return credential
      continue
    }
    if (expiresAt > 0 && expiresAt <= Date.now()) continue
    return {
      accessToken,
      ...(email ? { email } : {})
    }
  }
  return undefined
}

export async function refreshableGrokQuotaCredential(
  source: GrokOAuthCredentials,
  rejectedAccessToken?: string,
  context?: SubscriptionProbeContext
): Promise<GrokQuotaCredential | undefined> {
  const cached = grokQuotaCredentialCache.get(source.refreshToken)
  const credential = cached ?? source
  const rejectedCurrentToken = Boolean(
    rejectedAccessToken && credential.accessToken === rejectedAccessToken
  )
  if (!rejectedCurrentToken && !isGrokCredentialExpired(credential)) {
    return grokQuotaCredential(credential)
  }
  const refreshed = await refreshGrokToken(credential, context
    ? { fetcher: context.fetcher, proxyUrl: context.proxyUrl }
    : {})
  if (!refreshed) {
    if (!rejectedCurrentToken && credential.expiresAt > Date.now()) {
      return grokQuotaCredential(credential)
    }
    return undefined
  }
  grokQuotaCredentialCache.set(source.refreshToken, refreshed)
  grokQuotaCredentialCache.set(refreshed.refreshToken, refreshed)
  return grokQuotaCredential(refreshed)
}

export function grokQuotaCredential(credentials: GrokOAuthCredentials): GrokQuotaCredential {
  return {
    accessToken: credentials.accessToken,
    ...(credentials.email ? { email: credentials.email } : {})
  }
}

export async function resolveCursorSession(): Promise<CursorQuotaSession | undefined> {
  const dbPath = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
    : process.platform === 'linux'
      ? join(homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb')
      : ''
  if (!dbPath) return undefined
  const accessToken = await readSqliteValue(dbPath, 'cursorAuth/accessToken')
  if (!accessToken) return undefined
  const claims = jwtClaims(accessToken)
  const subject = stringValue(claims?.sub)
  const userId = subject.split('|').filter(Boolean).at(-1) ?? ''
  const expiry = numberValue(claims?.exp)
  if (!/^[\w.-]+$/.test(userId) || (expiry !== undefined && expiry * 1_000 <= Date.now() + 60_000)) {
    return undefined
  }
  return {
    cookieHeader: `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}`
  }
}

export async function resolveAntigravityCredential(
  context: SubscriptionProbeContext,
  rejectedAccessToken?: string
): Promise<GoogleQuotaCredential | undefined> {
  return resolveAntigravityQuotaCredential(context, rejectedAccessToken)
}

export async function discoverAntigravityOAuthClient(): Promise<{
  clientId: string
  clientSecret: string
} | undefined> {
  const clients = await discoverAntigravityOAuthClients()
  return clients[0]
}

export async function refreshAntigravityAccessToken(
  refreshToken: string,
  client: { clientId: string; clientSecret: string },
  context: SubscriptionProbeContext
): Promise<string> {
  const response = await context.fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString(),
    signal: AbortSignal.timeout(SUBSCRIPTION_QUOTA_TIMEOUT_MS)
  }, context.proxyUrl)
  if (!response.ok) throw new Error('Antigravity OAuth refresh was rejected.')
  const payload = optionalRecord(await response.json().catch(() => undefined))
  const accessToken = stringValue(payload?.access_token)
  if (!accessToken) throw new Error('Antigravity OAuth refresh returned no access token.')
  return accessToken
}

export function claudeAccessToken(value: unknown): string | undefined {
  const root = optionalRecord(value)
  const oauth = optionalRecord(root?.claudeAiOauth)
  const token = stringValue(oauth?.accessToken)
  return token && validateClaudeSubscriptionToken(token).ok ? token : undefined
}

export async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

export function configuredHomeDirectory(
  environmentName: 'CODEX_HOME' | 'GROK_HOME',
  fallbackDirectory: string
): string {
  const override = process.env[environmentName]?.trim()
  if (!override) return join(homedir(), fallbackDirectory)
  if (override === '~') return homedir()
  if (override.startsWith('~/') || override.startsWith('~\\')) {
    return join(homedir(), override.slice(2))
  }
  return override
}

export async function readSqliteValue(dbPath: string, key: string): Promise<string | undefined> {
  const binary = process.platform === 'darwin' ? '/usr/bin/sqlite3' : 'sqlite3'
  try {
    const escapedKey = key.replaceAll("'", "''")
    const { stdout } = await execFileAsync(binary, [
      dbPath,
      `SELECT value FROM ItemTable WHERE key='${escapedKey}' LIMIT 1;`
    ], {
      encoding: 'utf8',
      timeout: 2_000,
      maxBuffer: 512 * 1024
    })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

export function jwtClaims(token: string): JsonRecord | undefined {
  const payload = token.split('.')[1]
  if (!payload) return undefined
  try {
    return optionalRecord(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
  } catch {
    return undefined
  }
}

export function protobufLengthFields(buffer: Buffer): Array<{ number: number; value: Buffer }> {
  const fields: Array<{ number: number; value: Buffer }> = []
  let offset = 0
  while (offset < buffer.length) {
    const tag = protobufVarint(buffer, offset)
    if (!tag) return []
    offset = tag.offset
    const number = Math.floor(tag.value / 8)
    const wireType = tag.value % 8
    if (number <= 0 || wireType !== 2) return []
    const length = protobufVarint(buffer, offset)
    if (!length) return []
    offset = length.offset
    const end = offset + length.value
    if (length.value < 0 || end > buffer.length) return []
    fields.push({ number, value: buffer.subarray(offset, end) })
    offset = end
  }
  return fields
}

export function protobufVarint(
  buffer: Buffer,
  initialOffset: number
): { value: number; offset: number } | undefined {
  let value = 0
  let shift = 0
  let offset = initialOffset
  while (offset < buffer.length && shift <= 49) {
    const byte = buffer[offset]
    offset += 1
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return { value, offset }
    shift += 7
  }
  return undefined
}

export function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}
