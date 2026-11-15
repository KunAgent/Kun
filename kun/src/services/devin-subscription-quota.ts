import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ProviderQuotaMetric } from '../contracts/provider-quota.js'
import type { KunServeRuntimeOptions } from '../server/runtime-factory-types.js'
import type { ProviderQuotaProbeProfile } from './provider-subscription-quota-service.js'
import { clampPercentage, isoDateValue, numberValue, optionalRecord, stringValue } from './provider-subscription-quota-support.js'

export const DEFAULT_DEVIN_API_SERVER_URL = 'https://server.codeium.com'
export const DEVIN_QUOTA_ALLOWED_HOSTS = ['server.codeium.com', 'server-beta.codeium.com'] as const
export const DEVIN_DASHBOARD_URL = 'https://app.devin.ai/settings/usage'

const LOCAL_LOGIN_CACHE_TTL_MS = 15_000
const ONE_DAY_SECONDS = 86_400
const ONE_WEEK_SECONDS = 7 * ONE_DAY_SECONDS
const ONE_MONTH_SECONDS = 30 * ONE_DAY_SECONDS
const DEVIN_CLI_VERSION = '3000.11.92'

export type DevinQuotaCredential = {
  apiKey: string
  apiServerUrl: string
}

export type DevinLocalLoginEvidence = {
  configured: boolean
  fingerprint: string
  apiServerUrl: string
}

export type DevinQuotaDeps = {
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  home?: string
  readText?: (path: string) => Promise<string>
  detectLogin?: () => Promise<DevinLocalLoginEvidence>
}

export type DevinJsonRequester = (
  url: string,
  input: {
    method: string
    headers: Record<string, string>
    body: string
  }
) => Promise<unknown>

let cachedLoginEvidence: {
  homeKey: string
  checkedAt: number
  value: DevinLocalLoginEvidence
} | undefined

export function clearDevinLocalLoginCache(): void {
  cachedLoginEvidence = undefined
}

export function isOfficialDevinQuotaServerUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl?.trim()) return false
  try {
    const parsed = new URL(rawUrl.trim())
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      (DEVIN_QUOTA_ALLOWED_HOSTS as readonly string[]).includes(parsed.host)
    )
  } catch {
    return false
  }
}

export function normalizeDevinApiServerUrl(rawUrl: string | undefined): string | undefined {
  const candidate = rawUrl?.trim() ? rawUrl.trim().replace(/\/+$/u, '') : DEFAULT_DEVIN_API_SERVER_URL
  return isOfficialDevinQuotaServerUrl(candidate) ? candidate : undefined
}

export function devinCredentialsTomlPath(options?: {
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  home?: string
}): string {
  const env = options?.env ?? process.env
  const platform = options?.platform ?? process.platform
  const home = options?.home || env.HOME || env.USERPROFILE || homedir()
  const baseDir = platform === 'win32'
    ? env.APPDATA || join(home, 'AppData', 'Roaming')
    : env.XDG_DATA_HOME || join(home, '.local', 'share')
  return join(baseDir, 'devin', 'credentials.toml')
}

export function parseDevinCredentialsToml(raw: string): {
  apiKey: string
  apiServerUrl?: string
} | undefined {
  if (!raw.trim()) return undefined
  const values: Record<string, string> = {}
  for (const rawLine of raw.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('[')) continue
    const match = /^([A-Za-z0-9_]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s#]+))/.exec(line)
    if (!match) continue
    const key = match[1]!
    const value = (
      match[2] !== undefined
        ? match[2].replace(/\\(["\\ntr])/gu, (_all, ch: string) =>
            ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '\r' : ch
          )
        : match[3] ?? match[4] ?? ''
    ).trim()
    if (value) values[key] = value
  }
  const apiKey = values.windsurf_api_key ?? ''
  if (!apiKey) return undefined
  return {
    apiKey,
    ...(values.api_server_url ? { apiServerUrl: values.api_server_url } : {})
  }
}

async function readBoundedToml(path: string): Promise<string> {
  const handle = await open(path, 'r').catch(() => undefined)
  if (!handle) return ''
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size <= 0 || info.size > 64 * 1024) return ''
    const buffer = Buffer.alloc(64 * 1024)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return ''
  } finally {
    await handle.close()
  }
}

export async function resolveDevinQuotaCredential(
  provider?: Pick<ProviderQuotaProbeProfile, 'apiKey' | 'baseUrl' | 'credentialSourceId'>,
  deps?: DevinQuotaDeps
): Promise<DevinQuotaCredential | undefined> {
  const explicitKey = provider?.apiKey?.trim() ?? ''
  if (explicitKey) {
    const apiServerUrl = normalizeDevinApiServerUrl(provider?.baseUrl)
    return apiServerUrl ? { apiKey: explicitKey, apiServerUrl } : undefined
  }
  if (provider?.credentialSourceId) {
    return undefined
  }
  const env = deps?.env ?? process.env
  const backendOverride = env.ACP_BACKEND?.trim().toLowerCase()
  if (backendOverride && backendOverride !== 'windsurf') {
    return undefined
  }
  const envKey = env.WINDSURF_API_KEY?.trim() ?? ''
  if (envKey) {
    const apiServerUrl = normalizeDevinApiServerUrl(env.WINDSURF_API_SERVER_URL ?? provider?.baseUrl)
    return apiServerUrl ? { apiKey: envKey, apiServerUrl } : undefined
  }
  const read = deps?.readText ?? readBoundedToml
  const tomlPath = devinCredentialsTomlPath(deps)
  const parsed = parseDevinCredentialsToml(await read(tomlPath))
  if (!parsed) return undefined
  const apiServerUrl = normalizeDevinApiServerUrl(
    env.WINDSURF_API_SERVER_URL ?? parsed.apiServerUrl ?? provider?.baseUrl
  )
  return apiServerUrl ? { apiKey: parsed.apiKey, apiServerUrl } : undefined
}

export async function detectDevinLocalLogin(
  deps?: DevinQuotaDeps
): Promise<DevinLocalLoginEvidence> {
  if (deps?.detectLogin) return deps.detectLogin()
  const hasExplicitDeps = Boolean(deps?.env || deps?.platform || deps?.home || deps?.readText)
  if (process.env.VITEST && !hasExplicitDeps) {
    return { configured: false, fingerprint: '', apiServerUrl: DEFAULT_DEVIN_API_SERVER_URL }
  }
  const env = deps?.env ?? process.env
  const home = deps?.home || env.HOME || env.USERPROFILE || homedir()
  const homeKey = resolve(home)
  if (
    !hasExplicitDeps &&
    cachedLoginEvidence?.homeKey === homeKey &&
    Date.now() - cachedLoginEvidence.checkedAt < LOCAL_LOGIN_CACHE_TTL_MS
  ) {
    return cachedLoginEvidence.value
  }
  const credential = await resolveDevinQuotaCredential(undefined, { ...deps, env, home })
  const value: DevinLocalLoginEvidence = credential
    ? {
        configured: true,
        fingerprint: createHash('sha256')
          .update(`${credential.apiServerUrl}\n${credential.apiKey}`)
          .digest('hex'),
        apiServerUrl: credential.apiServerUrl
      }
    : { configured: false, fingerprint: '', apiServerUrl: DEFAULT_DEVIN_API_SERVER_URL }
  if (!hasExplicitDeps) {
    cachedLoginEvidence = { homeKey, checkedAt: Date.now(), value }
  }
  return value
}

/**
 * Surfaces an automatic Devin subscription quota card whenever the user enabled
 * the Devin Agent or already signed in locally via `devin auth login`, without
 * duplicating an explicit Devin provider entry.
 */
export async function appendNativeDevinQuotaProfile(
  profiles: ProviderQuotaProbeProfile[],
  options: Pick<KunServeRuntimeOptions, 'harnesses' | 'modelProxyUrl'>,
  deps?: DevinQuotaDeps
): Promise<ProviderQuotaProbeProfile[]> {
  if (profiles.some((profile) =>
    profile.presetId === 'devin-subscription' ||
    profile.id === 'native:devin' ||
    profile.id === 'devin-subscription'
  )) {
    return profiles
  }
  if (options.harnesses?.disabledIds?.includes('devin')) {
    return profiles
  }
  const enabled = Boolean(
    options.harnesses?.enabledProfiles?.some((profile) => profile.harnessId === 'devin') ||
    options.harnesses?.defaultHarnessId === 'devin'
  )
  const evidence = await detectDevinLocalLogin(deps)
  if (!enabled && !evidence.configured) {
    return profiles
  }
  return [
    ...profiles,
    {
      id: 'native:devin',
      name: 'Devin',
      ...(evidence.configured && evidence.fingerprint
        ? { accountId: `native:${evidence.fingerprint.slice(0, 16)}` }
        : {}),
      presetId: 'devin-subscription',
      kind: 'http',
      authType: 'subscription',
      baseUrl: evidence.apiServerUrl,
      configured: true,
      apiKey: '',
      proxyUrl: options.modelProxyUrl ?? ''
    }
  ]
}

function unixSecondsToIso(value: unknown): string | undefined {
  const seconds = numberValue(value)
  if (seconds === undefined || !(seconds > 0)) return undefined
  const date = new Date(seconds * 1_000)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function formatDevinTierName(planName: string, teamsTier: string): string | undefined {
  if (planName) return planName
  const cleaned = teamsTier
    .replace(/^TEAMS_TIER_(?:DEVIN_)?/iu, '')
    .replace(/_/gu, ' ')
    .trim()
  if (!cleaned || /^UNSPECIFIED$/iu.test(cleaned)) return undefined
  return cleaned
    .toLowerCase()
    .replace(/\b[a-z]/gu, (ch) => ch.toUpperCase())
}

function amountLimitMetric(input: {
  id: string
  label: string
  unit: string
  used?: number
  available?: number
  limit: number
  resetsAt?: string
  windowSeconds?: number
}): ProviderQuotaMetric | undefined {
  if (!(input.limit > 0)) return undefined
  const used = input.used !== undefined && input.used >= 0
    ? input.used
    : input.available !== undefined && input.available >= 0
      ? Math.max(0, input.limit - input.available)
      : undefined
  if (used === undefined) return undefined
  const remaining = input.available !== undefined && input.available >= 0
    ? input.available
    : Math.max(0, input.limit - used)
  const usedPercent = clampPercentage(Math.round((used / input.limit) * 10_000) / 100)
  return {
    id: input.id,
    label: input.label,
    unit: input.unit,
    used: Math.round(used * 100) / 100,
    limit: Math.round(input.limit * 100) / 100,
    remaining: Math.round(remaining * 100) / 100,
    usedPercent,
    ...(input.windowSeconds ? { windowSeconds: input.windowSeconds } : {}),
    ...(input.resetsAt ? { resetsAt: input.resetsAt } : {})
  }
}

export function parseDevinSubscriptionQuota(payload: unknown): {
  metrics: ProviderQuotaMetric[]
  summary?: string
} {
  const root = optionalRecord(payload)
  if (!root) {
    throw new Error('Devin returned an invalid user status response.')
  }
  const errorCode = stringValue(root.code).toLowerCase()
  if (errorCode === 'unauthenticated' || errorCode === 'permission_denied') {
    const authError = new Error('Devin did not authorize quota access for the existing login.')
    authError.name = 'DevinQuotaAuthorizationError'
    throw authError
  }
  const userStatus = optionalRecord(root.userStatus ?? root.user_status)
  const planStatus = optionalRecord(userStatus?.planStatus ?? userStatus?.plan_status)
  const planInfo = optionalRecord(planStatus?.planInfo ?? planStatus?.plan_info)
  if (!userStatus || !planStatus) {
    throw new Error('Devin did not return subscription plan status.')
  }

  const metrics: ProviderQuotaMetric[] = []
  const planEnd = isoDateValue(planStatus.planEnd ?? planStatus.plan_end)
  const hideDaily = (planInfo?.hideDailyQuota ?? planInfo?.hide_daily_quota) === true
  const hideWeekly = (planInfo?.hideWeeklyQuota ?? planInfo?.hide_weekly_quota) === true

  const dailyRemaining = numberValue(
    planStatus.dailyQuotaRemainingPercent ?? planStatus.daily_quota_remaining_percent
  )
  if (!hideDaily && dailyRemaining !== undefined && dailyRemaining >= 0) {
    const remaining = clampPercentage(dailyRemaining)
    const resetsAt = unixSecondsToIso(
      planStatus.dailyQuotaResetAtUnix ?? planStatus.daily_quota_reset_at_unix
    )
    metrics.push({
      id: 'daily',
      label: 'Daily quota',
      unit: 'percent',
      usedPercent: Math.round((100 - remaining) * 100) / 100,
      windowSeconds: ONE_DAY_SECONDS,
      ...(resetsAt ? { resetsAt } : {})
    })
  }

  const weeklyRemaining = numberValue(
    planStatus.weeklyQuotaRemainingPercent ?? planStatus.weekly_quota_remaining_percent
  )
  if (!hideWeekly && weeklyRemaining !== undefined && weeklyRemaining >= 0) {
    const remaining = clampPercentage(weeklyRemaining)
    const resetsAt = unixSecondsToIso(
      planStatus.weeklyQuotaResetAtUnix ?? planStatus.weekly_quota_reset_at_unix
    )
    metrics.push({
      id: 'weekly',
      label: 'Weekly quota',
      unit: 'percent',
      usedPercent: Math.round((100 - remaining) * 100) / 100,
      windowSeconds: ONE_WEEK_SECONDS,
      ...(resetsAt ? { resetsAt } : {})
    })
  }

  const acuLimit = numberValue(planStatus.acuLimit ?? planStatus.acu_limit)
  const acuConsumed = numberValue(planStatus.acuConsumed ?? planStatus.acu_consumed)
  if (acuLimit !== undefined && acuLimit > 0) {
    const acuMetric = amountLimitMetric({
      id: 'monthly-acu',
      label: 'Monthly ACU',
      unit: 'ACU',
      used: acuConsumed ?? 0,
      limit: acuLimit,
      resetsAt: planEnd,
      windowSeconds: ONE_MONTH_SECONDS
    })
    if (acuMetric) metrics.push(acuMetric)
  }

  const dollarsLimit = numberValue(planStatus.dollarsLimit ?? planStatus.dollars_limit)
  const dollarsConsumed = numberValue(planStatus.dollarsConsumed ?? planStatus.dollars_consumed)
  if (dollarsLimit !== undefined && dollarsLimit > 0) {
    const spendMetric = amountLimitMetric({
      id: 'monthly-spend',
      label: 'Monthly spend',
      unit: 'USD',
      used: dollarsConsumed ?? 0,
      limit: dollarsLimit,
      resetsAt: planEnd,
      windowSeconds: ONE_MONTH_SECONDS
    })
    if (spendMetric) metrics.push(spendMetric)
  }

  const topUp = optionalRecord(planStatus.topUpStatus ?? planStatus.top_up_status)
  const topUpAmount = numberValue(topUp?.monthlyTopUpAmount ?? topUp?.monthly_top_up_amount)
  if ((topUp?.topUpEnabled ?? topUp?.top_up_enabled) === true && topUpAmount !== undefined && topUpAmount > 0) {
    const topUpSpent = numberValue(topUp?.topUpSpent ?? topUp?.top_up_spent) ?? 0
    const topUpMetric = amountLimitMetric({
      id: 'monthly-top-up',
      label: 'Monthly top-up',
      unit: 'USD',
      used: topUpSpent,
      limit: topUpAmount,
      resetsAt: planEnd
    })
    if (topUpMetric) metrics.push(topUpMetric)
  }

  // Negative credit limits (e.g. -1) indicate unlimited/unapplicable under rolling quota plans.
  const promptLimit = numberValue(planInfo?.monthlyPromptCredits ?? planInfo?.monthly_prompt_credits)
  if (promptLimit !== undefined && promptLimit > 0) {
    const promptMetric = amountLimitMetric({
      id: 'prompt-credits',
      label: 'Prompt credits',
      unit: 'credits',
      used: numberValue(planStatus.usedPromptCredits ?? planStatus.used_prompt_credits),
      available: numberValue(planStatus.availablePromptCredits ?? planStatus.available_prompt_credits),
      limit: promptLimit,
      resetsAt: planEnd,
      windowSeconds: ONE_MONTH_SECONDS
    })
    if (promptMetric) metrics.push(promptMetric)
  }

  const flowLimit = numberValue(planInfo?.monthlyFlowCredits ?? planInfo?.monthly_flow_credits)
  if (flowLimit !== undefined && flowLimit > 0) {
    const flowMetric = amountLimitMetric({
      id: 'flow-credits',
      label: 'Flow credits',
      unit: 'credits',
      used: numberValue(planStatus.usedFlowCredits ?? planStatus.used_flow_credits),
      available: numberValue(planStatus.availableFlowCredits ?? planStatus.available_flow_credits),
      limit: flowLimit,
      resetsAt: planEnd,
      windowSeconds: ONE_MONTH_SECONDS
    })
    if (flowMetric) metrics.push(flowMetric)
  }

  const flexLimit = numberValue(
    planInfo?.monthlyFlexCreditPurchaseAmount ?? planInfo?.monthly_flex_credit_purchase_amount
  )
  if (flexLimit !== undefined && flexLimit > 0) {
    const flexMetric = amountLimitMetric({
      id: 'flex-credits',
      label: 'Flex credits',
      unit: 'credits',
      used: numberValue(planStatus.usedFlexCredits ?? planStatus.used_flex_credits),
      available: numberValue(planStatus.availableFlexCredits ?? planStatus.available_flex_credits),
      limit: flexLimit,
      resetsAt: planEnd
    })
    if (flexMetric) metrics.push(flexMetric)
  }

  const overageMicros = numberValue(planStatus.overageBalanceMicros ?? planStatus.overage_balance_micros)
  if (overageMicros !== undefined && overageMicros > 0) {
    metrics.push({
      id: 'overage-balance',
      label: 'Extra usage balance',
      unit: 'USD',
      remaining: Math.round((overageMicros / 1_000_000) * 100) / 100
    })
  }

  if (metrics.length === 0) {
    throw new Error('Devin did not return a recognized quota or ACU limit.')
  }

  const planLabel = formatDevinTierName(
    stringValue(planInfo?.planName ?? planInfo?.plan_name),
    stringValue(planInfo?.teamsTier ?? planInfo?.teams_tier ?? userStatus.teamsTier ?? userStatus.teams_tier)
  )
  const email = stringValue(userStatus.email)
  const summary = [planLabel, email].filter(Boolean).join(' · ')
  return {
    metrics,
    ...(summary ? { summary } : {})
  }
}

export async function probeDevinSubscriptionQuota(
  credential: DevinQuotaCredential,
  requestJsonFn: DevinJsonRequester
): Promise<{ metrics: ProviderQuotaMetric[]; summary?: string }> {
  const payload = await requestJsonFn(
    `${credential.apiServerUrl}/exa.seat_management_pb.SeatManagementService/GetUserStatus`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1'
      },
      body: JSON.stringify({
        metadata: {
          apiKey: credential.apiKey,
          ideName: 'devin-cli',
          ideVersion: DEVIN_CLI_VERSION,
          extensionName: 'chisel',
          extensionVersion: DEVIN_CLI_VERSION,
          locale: 'en'
        }
      })
    }
  )
  return parseDevinSubscriptionQuota(payload)
}
