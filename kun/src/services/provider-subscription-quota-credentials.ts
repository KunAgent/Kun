import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProviderQuotaMetric } from '../contracts/provider-quota.js'
import { GeminiCliOAuthSource } from '../adapters/model/gemini-cli-oauth.js'
import {
  codexCliUserAgent,
  geminiCliRequestHeaders
} from '../adapters/model/provider-cli-identity.js'
import {
  isStoredCodexCredentialExpired,
  parseStoredCodexOAuthCredentials,
  refreshStoredCodexOAuthCredentials,
  type StoredCodexOAuthCredentials
} from './codex-oauth-credential-refresher.js'
import {
  isStoredGrokCredentialExpired,
  parseStoredGrokOAuthCredentials,
  refreshStoredGrokOAuthCredentials,
  type StoredGrokOAuthCredentials
} from './grok-oauth-credential-refresher.js'
import {
  readOpenCodeGoLocalQuota,
  type OpenCodeGoLocalQuotaResult
} from './opencode-go-local-quota.js'
import {
  fetchOpenCodeGoWebQuota as fetchOpenCodeGoWebQuotaImpl,
  filterOpenCodeGoCookieHeader,
  OpenCodeGoWebQuotaError,
  type OpenCodeGoWebQuotaResult
} from './opencode-go-web-quota.js'
import {
  listChromiumCookieDatabaseCandidates,
  readChromiumCookiesForDomainsWithDiagnosis,
  type ChromiumCookieDatabaseCandidate
} from './chromium-browser-cookies.js'
import { type CodexCredential, codexQuotaCredentialCache, type CursorSession, execFileAsync, type GoogleCredential, type GrokCredential, grokQuotaCredentialCache, parseGoogleCodeAssistQuota, parseGrokSubscriptionQuota, type ProbeContext, ProviderQuotaAuthorizationError, type ProviderQuotaProbeProfile, QUOTA_TIMEOUT_MS, type SubscriptionQuotaRuntime } from './provider-subscription-quota-service.js'
import { assertGrokGrpcStatus, boundedResponseBytes, grpcWebTrailerFields, requestJson, requestResponse } from './provider-subscription-quota-transport.js'
import { appStateDbPath, claudeAccessToken, googleSetupSummary, validClaudeToken } from './provider-subscription-quota-metrics.js'
import { headerValue, jwtClaims, readJsonFile, readSqliteValue, resolveHomePath, resolveOpenCodeGoCookie } from './provider-subscription-quota-opencode-cookie.js'
import { isoDateValue, numberValue, optionalRecord, requireRecord, stringValue } from './provider-subscription-quota-support.js'
import {
  decodeAntigravityUnifiedOAuth,
  discoverAntigravityOAuthClients,
  resolveAntigravityQuotaCredential
} from './antigravity-quota-credentials.js'
import {
  mergeAntigravityQuotaPools,
  mergeAntigravitySummaryWithBuckets,
  parseAntigravityQuotaSummary
} from './antigravity-quota-pools.js'
import { resolveDevinQuotaCredential } from './devin-subscription-quota.js'

export { decodeAntigravityUnifiedOAuth }

export const defaultRuntime: SubscriptionQuotaRuntime = {
  resolveClaudeToken,
  resolveCodexCredential: resolveDefaultCodexQuotaCredential,
  resolveGrokCredential: resolveDefaultGrokQuotaCredential,
  resolveCursorSession,
  resolveAntigravityCredential,
  resolveDevinCredential: (provider) => resolveDevinQuotaCredential(provider),
  resolveOpenCodeGoQuota: readOpenCodeGoLocalQuota,
  resolveOpenCodeGoCookie,
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
  credential: GrokCredential,
  context: ProbeContext
): Promise<ProviderQuotaMetric[]> {
  const response = await requestResponse(
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
  assertGrokGrpcStatus(response.headers.get('grpc-status'), response.headers.get('grpc-message'))
  const bytes = await boundedResponseBytes(response)
  const trailers = grpcWebTrailerFields(bytes)
  assertGrokGrpcStatus(trailers['grpc-status'], trailers['grpc-message'])
  return parseGrokSubscriptionQuota(bytes)
}

export async function probeGoogleCodeAssistQuota(
  credential: GoogleCredential,
  context: ProbeContext,
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
  const setup = requireRecord(await requestJson(
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
  ), 'Google Code Assist returned an invalid setup response.')
  const projectValue = setup.cloudaicompanionProject
  const project = typeof projectValue === 'string'
    ? projectValue.trim()
    : stringValue(optionalRecord(projectValue)?.id) ||
      stringValue(optionalRecord(projectValue)?.projectId)
  if (!project) {
    const reason = Array.isArray(setup.ineligibleTiers)
      ? setup.ineligibleTiers
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
      const aicodePayload = await requestJson(
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
          ...googleSetupSummary(setup, credential.accountEmail)
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
        const summaryPayload = await requestJson(
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
          ...googleSetupSummary(setup, credential.accountEmail)
        }
      } catch {
        // Fall through to retrieveUserQuota.
      }
    }
  }
  let quotaPayload: unknown
  try {
    quotaPayload = await requestJson(
      'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
      { method: 'POST', headers, body },
      context
    )
    const parsed = parseGoogleCodeAssistQuota(quotaPayload)
    return {
      metrics: client === 'antigravity'
        ? mergeAntigravitySummaryWithBuckets(summaryMetrics, parsed)
        : parsed,
      ...googleSetupSummary(setup, credential.accountEmail)
    }
  } catch (error) {
    if (error instanceof ProviderQuotaAuthorizationError) throw error
    try {
      quotaPayload = await requestJson(
        'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
        { method: 'POST', headers, body },
        context
      )
    } catch (fallbackError) {
      if (summaryMetrics.length > 0) {
        return {
          metrics: summaryMetrics,
          ...googleSetupSummary(setup, credential.accountEmail)
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
    ...googleSetupSummary(setup, credential.accountEmail)
  }
}

export async function resolveClaudeToken(
  provider: ProviderQuotaProbeProfile
): Promise<string | undefined> {
  if (validClaudeToken(provider.apiKey)) return provider.apiKey.trim()
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

export async function resolveDefaultCodexQuotaCredential(
  provider: ProviderQuotaProbeProfile,
  rejectedAccessToken?: string,
  context?: ProbeContext
): Promise<CodexCredential | undefined> {
  let stored = parseStoredCodexOAuthCredentials(provider.apiKey)
  if (stored) {
    const cached = codexQuotaCredentialCache.get(stored.refreshToken)
    if (cached) stored = cached
    const rejectedCurrentToken = Boolean(
      rejectedAccessToken && stored.accessToken === rejectedAccessToken
    )
    if (rejectedCurrentToken || isStoredCodexCredentialExpired(stored)) {
      const refreshed = await refreshCodexQuotaCredential(stored, context)
      if (!refreshed) {
        if (!rejectedCurrentToken && Date.now() < stored.expiresAt) {
          return codexCredential(stored)
        }
        return undefined
      }
      return codexCredential(refreshed)
    }
    return codexCredential(stored)
  }
  if (provider.apiKey.trim()) {
    return {
      accessToken: provider.apiKey.trim(),
      ...(headerValue(provider.headers, 'chatgpt-account-id')
        ? { accountId: headerValue(provider.headers, 'chatgpt-account-id') }
        : {})
    }
  }
  const ambient = optionalRecord(await readJsonFile(join(homedir(), '.codex', 'auth.json')))
  const tokens = optionalRecord(ambient?.tokens)
  const accessToken = stringValue(tokens?.access_token) || stringValue(tokens?.accessToken)
  if (!accessToken) return undefined
  const accountId = stringValue(tokens?.account_id) || stringValue(tokens?.accountId)
  const refreshToken = stringValue(tokens?.refresh_token) || stringValue(tokens?.refreshToken)
  if (accountId && refreshToken) {
    stored = {
      kind: 'codex-oauth',
      accessToken,
      refreshToken,
      expiresAt: (numberValue(jwtClaims(accessToken)?.exp) ?? 0) * 1_000,
      accountId
    }
    const cached = codexQuotaCredentialCache.get(stored.refreshToken)
    if (cached) stored = cached
    const rejectedCurrentToken = Boolean(
      rejectedAccessToken && stored.accessToken === rejectedAccessToken
    )
    if (rejectedCurrentToken || isStoredCodexCredentialExpired(stored)) {
      const refreshed = await refreshCodexQuotaCredential(stored, context)
      if (!refreshed) {
        if (!rejectedCurrentToken && Date.now() < stored.expiresAt) {
          return codexCredential(stored)
        }
        return undefined
      }
      return codexCredential(refreshed)
    }
    return codexCredential(stored)
  }
  return { accessToken, ...(accountId ? { accountId } : {}) }
}

export async function refreshCodexQuotaCredential(
  credentials: StoredCodexOAuthCredentials,
  context?: ProbeContext
): Promise<StoredCodexOAuthCredentials | undefined> {
  try {
    const fetchImpl = context
      ? ((input: string | URL | Request, init?: RequestInit) => context.fetcher(
          typeof input === 'string' || input instanceof URL ? input : input.url,
          init,
          context.proxyUrl
        )) as typeof fetch
      : fetch
    const refreshed = await refreshStoredCodexOAuthCredentials(credentials, fetchImpl)
    codexQuotaCredentialCache.set(credentials.refreshToken, refreshed)
    codexQuotaCredentialCache.set(refreshed.refreshToken, refreshed)
    return refreshed
  } catch {
    return undefined
  }
}

export function codexCredential(credentials: StoredCodexOAuthCredentials): CodexCredential {
  return {
    accessToken: credentials.accessToken,
    accountId: credentials.accountId
  }
}

export async function resolveCursorSession(): Promise<CursorSession | undefined> {
  const dbPath = appStateDbPath('Cursor')
  if (!dbPath) return undefined
  const accessToken = await readSqliteValue(dbPath, 'cursorAuth/accessToken')
  if (!accessToken) return undefined
  const claims = jwtClaims(accessToken)
  const userId = stringValue(claims?.sub).split('|').filter(Boolean).at(-1) ?? ''
  const expiry = numberValue(claims?.exp)
  if (!/^[\w.-]+$/u.test(userId) || (expiry !== undefined && expiry * 1_000 <= Date.now() + 60_000)) {
    return undefined
  }
  return { cookieHeader: `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}` }
}

export async function resolveAntigravityCredential(
  context: ProbeContext,
  rejectedAccessToken?: string
): Promise<GoogleCredential | undefined> {
  return resolveAntigravityQuotaCredential(context, rejectedAccessToken)
}

export async function resolveDefaultGrokQuotaCredential(
  provider: ProviderQuotaProbeProfile,
  rejectedAccessToken?: string,
  context?: ProbeContext
): Promise<GrokCredential | undefined> {
  const configured = parseStoredGrokOAuthCredentials(provider.apiKey.trim())
  if (configured) {
    return refreshableGrokQuotaCredential(configured, rejectedAccessToken, context)
  }
  const configuredToken = provider.apiKey.trim()
  if (configuredToken && !configuredToken.startsWith('{') && configuredToken !== rejectedAccessToken) {
    return { accessToken: configuredToken }
  }

  const home = process.env.GROK_HOME?.trim()
    ? resolveHomePath(process.env.GROK_HOME.trim())
    : join(homedir(), '.grok')
  const ambient = optionalRecord(await readJsonFile(join(home, 'auth.json')))
  const candidates = Object.entries(ambient ?? {})
    .filter(([scope, value]) =>
      (
        scope.startsWith('https://auth.x.ai::') ||
        scope === 'https://accounts.x.ai/sign-in' ||
        scope.includes('/sign-in')
      ) &&
      optionalRecord(value)
    )
    .sort(([left], [right]) =>
      Number(!left.startsWith('https://auth.x.ai::')) -
      Number(!right.startsWith('https://auth.x.ai::'))
    )
  for (const [, rawEntry] of candidates) {
    const entry = optionalRecord(rawEntry)
    const accessToken = stringValue(entry?.key)
    if (!accessToken || accessToken === rejectedAccessToken) continue
    const expiresAt = isoDateValue(entry?.expires_at)
    const email = stringValue(entry?.email)
    const refreshToken = stringValue(entry?.refresh_token)
    if (refreshToken) {
      const credential = await refreshableGrokQuotaCredential({
        kind: 'grok-oauth',
        accessToken,
        refreshToken,
        expiresAt: expiresAt ? new Date(expiresAt).getTime() : 0,
        ...(email ? { email } : {}),
        ...(stringValue(entry?.user_id) ? { userId: stringValue(entry?.user_id) } : {}),
        ...(stringValue(entry?.oidc_issuer) ? { issuer: stringValue(entry?.oidc_issuer) } : {}),
        ...(stringValue(entry?.oidc_client_id) ? { clientId: stringValue(entry?.oidc_client_id) } : {})
      }, rejectedAccessToken, context)
      if (credential) return credential
      continue
    }
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) continue
    return { accessToken, ...(email ? { email } : {}) }
  }
  return undefined
}

export async function refreshableGrokQuotaCredential(
  source: StoredGrokOAuthCredentials,
  rejectedAccessToken?: string,
  context?: ProbeContext
): Promise<GrokCredential | undefined> {
  const cached = grokQuotaCredentialCache.get(source.refreshToken)
  const credential = cached ?? source
  const rejectedCurrentToken = Boolean(
    rejectedAccessToken && credential.accessToken === rejectedAccessToken
  )
  if (!rejectedCurrentToken && !isStoredGrokCredentialExpired(credential)) {
    return grokCredential(credential)
  }
  try {
    const fetchImpl = context
      ? ((input: string | URL | Request, init?: RequestInit) => context.fetcher(
          typeof input === 'string' || input instanceof URL ? input : input.url,
          init,
          context.proxyUrl
        )) as typeof fetch
      : fetch
    const refreshed = await refreshStoredGrokOAuthCredentials(credential, fetchImpl)
    grokQuotaCredentialCache.set(source.refreshToken, refreshed)
    grokQuotaCredentialCache.set(refreshed.refreshToken, refreshed)
    return grokCredential(refreshed)
  } catch {
    if (!rejectedCurrentToken && credential.expiresAt > Date.now()) {
      return grokCredential(credential)
    }
    return undefined
  }
}

export function grokCredential(credentials: StoredGrokOAuthCredentials): GrokCredential {
  return {
    accessToken: credentials.accessToken,
    ...(credentials.email ? { email: credentials.email } : {})
  }
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
  context: ProbeContext
): Promise<string> {
  const response = await context.fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString(),
    signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS)
  }, context.proxyUrl)
  if (!response.ok) throw new Error('Antigravity OAuth refresh was rejected.')
  const payload = optionalRecord(await response.json().catch(() => undefined))
  const accessToken = stringValue(payload?.access_token)
  if (!accessToken) throw new Error('Antigravity OAuth refresh returned no access token.')
  return accessToken
}
