import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
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
import { defaultRuntime, probeGoogleCodeAssistQuota, probeGrokSubscriptionQuota, resolveAntigravityCredential, resolveClaudeToken, resolveCursorSession } from './provider-subscription-quota-credentials.js'
import { grpcWebDataFrames, looksLikeProtobufPayload, mergeProtobufScan, type ProtobufScan, requestCodexSubscriptionQuota, requestJson, sameNumberPath, scanProtobuf, startsWithNumberPath } from './provider-subscription-quota-transport.js'
import { codexAdditionalLimitLabel, codexWindowMetric, cursorMoneyMetric, firstUsageRecord, googleQuotaMetric, percentageMetric, percentageWindowMetric } from './provider-subscription-quota-metrics.js'
import { clearOpenCodeGoCookieCache, getOpenCodeGoCookieFailureReason, OPENCODE_GO_KEYCHAIN_MESSAGE, OPENCODE_GO_SIGN_IN_MESSAGE, resolveOpenCodeGoCookie } from './provider-subscription-quota-opencode-cookie.js'
import { clampPercentage, isoDateValue, numberValue, optionalRecord, requireRecord, stringValue } from './provider-subscription-quota-support.js'

export const execFileAsync = promisify(execFile)

export const QUOTA_TIMEOUT_MS = 12_000

export const MAX_RESPONSE_BYTES = 256 * 1024

export const codexQuotaCredentialCache = new Map<string, StoredCodexOAuthCredentials>()

export const grokQuotaCredentialCache = new Map<string, StoredGrokOAuthCredentials>()

export type ProviderQuotaProbeProfile = {
  id: string
  name: string
  presetId?: string
  kind: 'http' | 'agent-sdk' | 'antigravity-cli' | 'cursor-sdk' | 'gemini-cli-api' | 'gemini-code-assist'
  baseUrl?: string
  apiKey: string
  headers?: Record<string, string>
  credentialSourceId?: string
  proxyUrl?: string
}

export type SubscriptionQuotaProbeKind =
  | 'claude-subscription'
  | 'codex-subscription'
  | 'grok-subscription'
  | 'cursor-subscription'
  | 'antigravity-subscription'
  | 'gemini-cli-subscription'
  | 'opencode-go-local'

export type ProviderQuotaFetch = (
  input: string | URL,
  init: RequestInit | undefined,
  proxyUrl: string
) => Promise<Response>

export type ProbeContext = {
  fetcher: ProviderQuotaFetch
  proxyUrl: string
}

export type CodexCredential = {
  accessToken: string
  accountId?: string
}

export type GrokCredential = {
  accessToken: string
  email?: string
}

export type CursorSession = {
  cookieHeader: string
}

export type GoogleCredential = {
  accessToken: string
  accountEmail?: string
}

export type SubscriptionQuotaRuntime = {
  resolveClaudeToken(provider: ProviderQuotaProbeProfile): Promise<string | undefined>
  resolveCodexCredential(
    provider: ProviderQuotaProbeProfile,
    rejectedAccessToken?: string,
    context?: ProbeContext
  ): Promise<CodexCredential | undefined>
  resolveGrokCredential(
    provider: ProviderQuotaProbeProfile,
    rejectedAccessToken?: string,
    context?: ProbeContext
  ): Promise<GrokCredential | undefined>
  resolveCursorSession(): Promise<CursorSession | undefined>
  resolveAntigravityCredential(context: ProbeContext): Promise<GoogleCredential | undefined>
  resolveGeminiCliToken(context: ProbeContext): Promise<string | undefined>
  resolveOpenCodeGoQuota(): Promise<OpenCodeGoLocalQuotaResult | undefined>
  resolveOpenCodeGoCookie(): Promise<string | undefined>
  fetchOpenCodeGoWebQuota(
    cookieHeader: string,
    context: ProbeContext
  ): Promise<OpenCodeGoWebQuotaResult>
}

export class ProviderQuotaMissingCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderQuotaMissingCredentialError'
  }
}

export class ProviderQuotaAuthorizationError extends Error {
  constructor(readonly status: number) {
    super('The provider did not authorize quota access for the existing login.')
    this.name = 'ProviderQuotaAuthorizationError'
  }
}

export async function runSubscriptionQuotaProbe(
  kind: SubscriptionQuotaProbeKind,
  provider: ProviderQuotaProbeProfile,
  context: ProbeContext,
  runtimeOverrides: Partial<SubscriptionQuotaRuntime> = {}
): Promise<{ metrics: ProviderQuotaMetric[]; summary?: string; source?: string }> {
  const runtime = { ...defaultRuntime, ...runtimeOverrides }
  if (kind === 'claude-subscription') {
    const accessToken = await runtime.resolveClaudeToken(provider)
    if (!accessToken) {
      throw new ProviderQuotaMissingCredentialError(
        'Sign in with Claude Code or connect the Claude subscription first.'
      )
    }
    return {
      metrics: parseClaudeSubscriptionQuota(await requestJson(
        'https://api.anthropic.com/api/oauth/usage',
        {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'anthropic-beta': 'oauth-2025-04-20',
            'User-Agent': 'claude-code/2.1.0'
          }
        },
        context
      ))
    }
  }
  if (kind === 'codex-subscription') {
    let credential = await runtime.resolveCodexCredential(provider, undefined, context)
    if (!credential) {
      throw new ProviderQuotaMissingCredentialError(
        'Connect the ChatGPT subscription or sign in with Codex CLI first.'
      )
    }
    try {
      return parseCodexSubscriptionQuota(await requestCodexSubscriptionQuota(credential, context))
    } catch (error) {
      if (!(error instanceof ProviderQuotaAuthorizationError)) throw error
      const refreshed = await runtime.resolveCodexCredential(
        provider,
        credential.accessToken,
        context
      )
      if (!refreshed || refreshed.accessToken === credential.accessToken) {
        throw new ProviderQuotaMissingCredentialError(
          'The Codex login expired. Sign in to the ChatGPT subscription or Codex CLI again.'
        )
      }
      credential = refreshed
      return parseCodexSubscriptionQuota(await requestCodexSubscriptionQuota(credential, context))
    }
  }
  if (kind === 'grok-subscription') {
    let credential = await runtime.resolveGrokCredential(provider, undefined, context)
    if (!credential) {
      throw new ProviderQuotaMissingCredentialError(
        'Connect Grok or run `grok login` before refreshing quota.'
      )
    }
    try {
      return {
        metrics: await probeGrokSubscriptionQuota(credential, context),
        ...(credential.email ? { summary: credential.email } : {})
      }
    } catch (error) {
      if (!(error instanceof ProviderQuotaAuthorizationError)) throw error
      const refreshed = await runtime.resolveGrokCredential(
        provider,
        credential.accessToken,
        context
      )
      if (!refreshed || refreshed.accessToken === credential.accessToken) {
        throw new ProviderQuotaMissingCredentialError(
          'The Grok login expired. Connect Grok or run `grok login` again.'
        )
      }
      credential = refreshed
      return {
        metrics: await probeGrokSubscriptionQuota(credential, context),
        ...(credential.email ? { summary: credential.email } : {})
      }
    }
  }
  if (kind === 'cursor-subscription') {
    const session = await runtime.resolveCursorSession()
    if (!session) {
      throw new ProviderQuotaMissingCredentialError(
        'Sign in to Cursor.app on this computer before refreshing quota.'
      )
    }
    return parseCursorSubscriptionQuota(await requestJson(
      'https://cursor.com/api/usage-summary',
      { headers: { Accept: 'application/json', Cookie: session.cookieHeader } },
      context
    ))
  }
  if (kind === 'antigravity-subscription') {
    const credential = await runtime.resolveAntigravityCredential(context)
    if (!credential) {
      throw new ProviderQuotaMissingCredentialError(
        'Sign in to the official Antigravity app before refreshing quota.'
      )
    }
    return probeGoogleCodeAssistQuota(credential, context, 'antigravity')
  }
  if (kind === 'opencode-go-local') {
    return probeOpenCodeGoLocalQuota(runtime, context)
  }
  const accessToken = await runtime.resolveGeminiCliToken(context)
  if (!accessToken) {
    throw new ProviderQuotaMissingCredentialError(
      'Run Gemini CLI and sign in with Google before refreshing quota.'
    )
  }
  return probeGoogleCodeAssistQuota({ accessToken }, context, 'gemini-cli')
}

export async function probeOpenCodeGoLocalQuota(
  runtime: SubscriptionQuotaRuntime,
  context: ProbeContext
): Promise<{ metrics: ProviderQuotaMetric[]; summary?: string; source?: string }> {
  const tryWeb = async (cookieHeader: string) => {
    const web = await runtime.fetchOpenCodeGoWebQuota(cookieHeader, context)
    if (web.metrics.length > 0) {
      return {
        metrics: web.metrics,
        ...(web.summary ? { summary: web.summary } : {}),
        source: 'OpenCode Go subscription usage'
      } as const
    }
    return undefined
  }

  let cookieHeader = await runtime.resolveOpenCodeGoCookie()
  if (cookieHeader) {
    try {
      const web = await tryWeb(cookieHeader)
      if (web) return web
    } catch (error) {
      if (!(error instanceof OpenCodeGoWebQuotaError)) throw error
      if (error.code === 'invalid_credentials') {
        clearOpenCodeGoCookieCache()
        cookieHeader = await runtime.resolveOpenCodeGoCookie()
        if (cookieHeader) {
          try {
            const web = await tryWeb(cookieHeader)
            if (web) return web
          } catch (retryError) {
            if (!(retryError instanceof OpenCodeGoWebQuotaError)) throw retryError
          }
        }
      }
    }
  }

  const quota = await runtime.resolveOpenCodeGoQuota()
  if (quota) {
    return {
      ...quota,
      source: 'OpenCode Go local usage estimate'
    }
  }

  throw new ProviderQuotaMissingCredentialError(
    getOpenCodeGoCookieFailureReason() === 'decrypt_failed'
      ? OPENCODE_GO_KEYCHAIN_MESSAGE
      : OPENCODE_GO_SIGN_IN_MESSAGE
  )
}

export function parseClaudeSubscriptionQuota(payload: unknown): ProviderQuotaMetric[] {
  const root = requireRecord(payload, 'Claude returned an invalid usage response.')
  const metrics: ProviderQuotaMetric[] = []
  const windows: Array<[string, string, unknown]> = [
    ['five-hour', '5-hour usage', root.five_hour],
    ['seven-day', '7-day usage', root.seven_day],
    ['seven-day-sonnet', '7-day Sonnet usage', root.seven_day_sonnet],
    ['seven-day-opus', '7-day Opus usage', root.seven_day_opus],
    ['seven-day-oauth-apps', '7-day OAuth apps usage', root.seven_day_oauth_apps]
  ]
  for (const [id, label, value] of windows) {
    const metric = percentageWindowMetric(id, label, value, 'utilization')
    if (metric) metrics.push(metric)
  }
  const limits = Array.isArray(root.limits) ? root.limits : []
  limits.forEach((value, index) => {
    const limit = optionalRecord(value)
    if (!limit || limit.is_active === false) return
    const model = optionalRecord(optionalRecord(limit.scope)?.model)
    const usedPercent = numberValue(limit.percent)
    if (usedPercent === undefined) return
    const resetsAt = isoDateValue(limit.resets_at)
    metrics.push({
      id: `limit-${index}`,
      label: stringValue(model?.display_name) ||
        stringValue(limit.kind) ||
        stringValue(limit.group) ||
        `Usage limit ${index + 1}`,
      unit: 'percent',
      usedPercent: clampPercentage(usedPercent),
      ...(resetsAt ? { resetsAt } : {})
    })
  })
  if (!metrics.length) throw new Error('Claude did not return a recognized usage window.')
  return metrics
}

export function parseCodexSubscriptionQuota(payload: unknown): {
  metrics: ProviderQuotaMetric[]
  summary?: string
} {
  const root = requireRecord(payload, 'Codex returned an invalid usage response.')
  const rateLimit = optionalRecord(root.rate_limit)
  const metrics: ProviderQuotaMetric[] = []
  const primary = codexWindowMetric('primary', 'Primary usage window', rateLimit?.primary_window)
  const secondary = codexWindowMetric('secondary', 'Weekly usage window', rateLimit?.secondary_window)
  if (primary) metrics.push(primary)
  if (secondary) metrics.push(secondary)
  const additional = Array.isArray(root.additional_rate_limits) ? root.additional_rate_limits : []
  additional.forEach((value, index) => {
    const item = optionalRecord(value)
    const windows = optionalRecord(item?.rate_limit)
    const label = codexAdditionalLimitLabel(item, index)
    const first = codexWindowMetric(
      `additional-${index}-primary`,
      'Primary usage window',
      windows?.primary_window,
      label
    )
    const second = codexWindowMetric(
      `additional-${index}-secondary`,
      'Weekly usage window',
      windows?.secondary_window,
      label
    )
    if (first) metrics.push(first)
    if (second) metrics.push(second)
  })
  if (!metrics.length) throw new Error('Codex did not return a recognized rate-limit window.')
  const summary = stringValue(root.plan_type)
  return { metrics, ...(summary ? { summary } : {}) }
}

export function parseGrokSubscriptionQuota(
  input: Uint8Array,
  now: Date = new Date()
): ProviderQuotaMetric[] {
  let payloads = grpcWebDataFrames(input)
  if (!payloads.length && looksLikeProtobufPayload(input)) payloads = [input]
  if (!payloads.length) throw new Error('Grok billing returned no protobuf quota payload.')

  const scan: ProtobufScan = { fixed32Fields: [], varintFields: [] }
  for (const payload of payloads) {
    mergeProtobufScan(scan, scanProtobuf(payload, 0, [], { value: 0 }))
  }
  const percent = scan.fixed32Fields
    .filter((field) =>
      field.path.at(-1) === 1 &&
      Number.isFinite(field.value) &&
      field.value >= 0 &&
      field.value <= 100
    )
    .sort((left, right) =>
      left.path.length === right.path.length
        ? left.order - right.order
        : left.path.length - right.path.length
    )[0]?.value
  const resets = scan.varintFields
    .filter((field) => field.value >= 1_700_000_000 && field.value <= 2_100_000_000)
    .map((field) => ({ ...field, date: new Date(field.value * 1_000) }))
    .filter((field) => field.date > now)
  const reset = resets
    .filter((field) => sameNumberPath(field.path, [1, 5, 1]))
    .sort((left, right) => left.date.getTime() - right.date.getTime())[0] ??
    resets.sort((left, right) => left.date.getTime() - right.date.getTime())[0]
  const hasUsagePeriod = scan.varintFields.some((field) =>
    startsWithNumberPath(field.path, [1, 6]) ||
    (sameNumberPath(field.path, [1, 8, 1]) && (field.value === 1 || field.value === 2))
  )
  const usedPercent = percent ?? (
    !scan.fixed32Fields.length && reset && hasUsagePeriod ? 0 : undefined
  )
  if (usedPercent === undefined) {
    throw new Error('Grok billing returned an unrecognized quota payload.')
  }
  return [{
    id: 'credits',
    label: 'Credits usage',
    unit: 'percent',
    usedPercent: clampPercentage(usedPercent),
    ...(reset ? { resetsAt: reset.date.toISOString() } : {})
  }]
}

export function parseCursorSubscriptionQuota(payload: unknown): {
  metrics: ProviderQuotaMetric[]
  summary?: string
} {
  const root = requireRecord(payload, 'Cursor returned an invalid usage response.')
  const individual = optionalRecord(root.individualUsage)
  const team = optionalRecord(root.teamUsage)
  const plan = optionalRecord(individual?.plan)
  const overall = optionalRecord(individual?.overall)
  const pooled = optionalRecord(team?.pooled)
  const reset = isoDateValue(root.billingCycleEnd)
  const metrics: ProviderQuotaMetric[] = []
  const primary = firstUsageRecord(plan, overall, pooled)
  const primaryMetric = cursorMoneyMetric('included-plan', 'Included plan usage', primary, reset)
  if (primaryMetric) {
    const explicitPercent = numberValue(plan?.totalPercentUsed)
    metrics.push({
      ...primaryMetric,
      ...(explicitPercent === undefined ? {} : { usedPercent: clampPercentage(explicitPercent) })
    })
  }
  const autoPercent = numberValue(plan?.autoPercentUsed)
  if (autoPercent !== undefined) {
    metrics.push(percentageMetric('auto-composer', 'Auto + Composer usage', autoPercent, reset))
  }
  const apiPercent = numberValue(plan?.apiPercentUsed)
  if (apiPercent !== undefined) {
    metrics.push(percentageMetric('api-models', 'Named model usage', apiPercent, reset))
  }
  const onDemand = cursorMoneyMetric(
    'on-demand',
    'On-demand usage',
    optionalRecord(individual?.onDemand),
    reset
  )
  const teamOnDemand = cursorMoneyMetric(
    'team-on-demand',
    'Team on-demand usage',
    optionalRecord(team?.onDemand),
    reset
  )
  if (onDemand) metrics.push(onDemand)
  if (teamOnDemand) metrics.push(teamOnDemand)
  if (!metrics.length) throw new Error('Cursor did not return a recognized plan allowance.')
  const summary = stringValue(root.membershipType)
  return { metrics, ...(summary ? { summary } : {}) }
}

export function parseGoogleCodeAssistQuota(payload: unknown): ProviderQuotaMetric[] {
  const root = requireRecord(payload, 'Google Code Assist returned an invalid quota response.')
  const metrics: ProviderQuotaMetric[] = []
  if (Array.isArray(root.buckets)) {
    root.buckets.forEach((value, index) => {
      const bucket = optionalRecord(value)
      const remainingFraction = numberValue(bucket?.remainingFraction)
      if (!bucket || remainingFraction === undefined) return
      metrics.push(googleQuotaMetric(
        `bucket-${index}`,
        stringValue(bucket.modelId) || `Model ${index + 1}`,
        remainingFraction,
        bucket.resetTime
      ))
    })
  } else {
    const models = optionalRecord(root.models)
    Object.entries(models ?? {}).forEach(([modelId, value]) => {
      const model = optionalRecord(value)
      const quota = optionalRecord(model?.quotaInfo)
      const remainingFraction = numberValue(quota?.remainingFraction)
      if (remainingFraction === undefined) return
      metrics.push(googleQuotaMetric(
        `model-${modelId}`,
        stringValue(model?.displayName) || stringValue(model?.label) || modelId,
        remainingFraction,
        quota?.resetTime
      ))
    })
  }
  if (!metrics.length) throw new Error('Google Code Assist did not return a recognized model quota.')
  return metrics
}
