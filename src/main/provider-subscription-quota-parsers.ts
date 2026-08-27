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
  ProtobufScan,
  grpcWebDataFrames,
  looksLikeProtobufPayload,
  mergeProtobufScan,
  sameNumberPath,
  scanProtobuf,
  startsWithNumberPath
} from './provider-subscription-quota-transport'

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
  for (const [index, value] of limits.entries()) {
    const limit = optionalRecord(value)
    if (!limit || limit.is_active === false) continue
    const scope = optionalRecord(limit.scope)
    const model = optionalRecord(scope?.model)
    const label = stringValue(model?.display_name) ||
      stringValue(limit.kind) ||
      stringValue(limit.group) ||
      `Usage limit ${index + 1}`
    const usedPercent = numberValue(limit.percent)
    if (usedPercent === undefined) continue
    metrics.push({
      id: `limit-${index}`,
      label,
      unit: 'percent',
      usedPercent: clampPercentage(usedPercent),
      ...(isoDateValue(limit.resets_at) ? { resetsAt: isoDateValue(limit.resets_at)! } : {})
    })
  }
  if (metrics.length === 0) throw new Error('Claude did not return a recognized usage window.')
  return metrics
}

export function parseCodexSubscriptionQuota(payload: unknown, resetCreditsPayload?: unknown): {
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
  if (metrics.length === 0) throw new Error('Codex did not return a recognized rate-limit window.')
  const resetCredits = codexResetCreditsMetric(root, resetCreditsPayload)
  if (resetCredits) metrics.push(resetCredits)
  const summary = stringValue(root.plan_type)
  return { metrics, ...(summary ? { summary } : {}) }
}

function codexResetCreditsMetric(
  root: JsonRecord,
  detailsPayload: unknown
): ProviderQuotaMetric | null {
  const usageSummary = optionalRecord(root.rate_limit_reset_credits)
  const details = optionalRecord(detailsPayload)
  const credits = Array.isArray(details?.credits) ? details.credits : []
  const now = Date.now()
  let earliestExpiryMs: number | undefined
  let availableDetails = 0
  for (const value of credits) {
    const credit = optionalRecord(value)
    if (!credit) continue
    const status = stringValue(credit.status)
    if (status && status !== 'available') continue
    const resetType = stringValue(credit.reset_type)
    if (resetType && resetType !== 'codex_rate_limits') continue
    const expiresAt = isoDateValue(credit.expires_at)
    if (expiresAt) {
      const expiryMs = new Date(expiresAt).getTime()
      if (expiryMs <= now) continue
      earliestExpiryMs = earliestExpiryMs === undefined
        ? expiryMs
        : Math.min(earliestExpiryMs, expiryMs)
    }
    availableDetails += 1
  }
  // available_count is authoritative; the backend may cap the detail rows.
  const count = numberValue(details?.available_count) ??
    numberValue(usageSummary?.available_count) ??
    (credits.length > 0 ? availableDetails : undefined)
  if (count === undefined || count <= 0) return null
  return {
    id: 'reset-credits',
    label: 'Rate-limit resets',
    unit: 'credits',
    remaining: Math.floor(count),
    ...(earliestExpiryMs === undefined ? {} : { resetsAt: new Date(earliestExpiryMs).toISOString() })
  }
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
  const metrics: ProviderQuotaMetric[] = []
  const reset = isoDateValue(root.billingCycleEnd)

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
    metrics.push({
      id: 'auto-composer',
      label: 'Auto + Composer usage',
      unit: 'percent',
      usedPercent: clampPercentage(autoPercent),
      ...(reset ? { resetsAt: reset } : {})
    })
  }
  const apiPercent = numberValue(plan?.apiPercentUsed)
  if (apiPercent !== undefined) {
    metrics.push({
      id: 'api-models',
      label: 'Named model usage',
      unit: 'percent',
      usedPercent: clampPercentage(apiPercent),
      ...(reset ? { resetsAt: reset } : {})
    })
  }
  const onDemand = cursorMoneyMetric(
    'on-demand',
    'On-demand usage',
    optionalRecord(individual?.onDemand),
    reset
  )
  if (onDemand) metrics.push(onDemand)
  const teamOnDemand = cursorMoneyMetric(
    'team-on-demand',
    'Team on-demand usage',
    optionalRecord(team?.onDemand),
    reset
  )
  if (teamOnDemand) metrics.push(teamOnDemand)
  if (metrics.length === 0) throw new Error('Cursor did not return a recognized plan allowance.')
  const summary = stringValue(root.membershipType)
  return { metrics, ...(summary ? { summary } : {}) }
}

export function parseGrokSubscriptionQuota(
  input: Uint8Array,
  now: Date = new Date()
): ProviderQuotaMetric[] {
  let payloads = grpcWebDataFrames(input)
  if (payloads.length === 0 && looksLikeProtobufPayload(input)) {
    payloads = [input]
  }
  if (payloads.length === 0) {
    throw new Error('Grok billing returned no protobuf quota payload.')
  }

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
    .map((field) => ({
      ...field,
      date: new Date(field.value * 1_000)
    }))
    .filter((field) => field.date > now)
  const preferredReset = resets
    .filter((field) => sameNumberPath(field.path, [1, 5, 1]))
    .sort((left, right) => left.date.getTime() - right.date.getTime())[0]
  const reset = preferredReset ?? resets
    .sort((left, right) => left.date.getTime() - right.date.getTime())[0]
  const hasUsagePeriod = scan.varintFields.some((field) =>
    startsWithNumberPath(field.path, [1, 6]) ||
    (sameNumberPath(field.path, [1, 8, 1]) && (field.value === 1 || field.value === 2))
  )
  const noUsageYet =
    percent === undefined &&
    scan.fixed32Fields.length === 0 &&
    reset !== undefined &&
    hasUsagePeriod
  const usedPercent = percent ?? (noUsageYet ? 0 : undefined)
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

export function parseGoogleCodeAssistQuota(payload: unknown): ProviderQuotaMetric[] {
  const root = requireRecord(payload, 'Google Code Assist returned an invalid quota response.')
  const metrics: ProviderQuotaMetric[] = []
  if (Array.isArray(root.buckets)) {
    root.buckets.forEach((value, index) => {
      const bucket = optionalRecord(value)
      const remainingFraction = numberValue(bucket?.remainingFraction)
      if (!bucket || remainingFraction === undefined) return
      const model = stringValue(bucket.modelId) || `Model ${index + 1}`
      metrics.push(googleQuotaMetric(`bucket-${index}`, model, remainingFraction, bucket.resetTime))
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
  if (metrics.length === 0) {
    throw new Error('Google Code Assist did not return a recognized model quota.')
  }
  return metrics
}

export function codexWindowMetric(
  id: string,
  fallbackLabel: string,
  value: unknown,
  scopeLabel?: string
): ProviderQuotaMetric | null {
  const window = optionalRecord(value)
  if (!window) return null
  const usedPercent = numberValue(window.used_percent)
  if (usedPercent === undefined) return null
  const seconds = numberValue(window.limit_window_seconds)
  const windowLabel = seconds === undefined ? fallbackLabel : `${formatWindowSeconds(seconds)} usage`
  const label = scopeLabel ? `${scopeLabel} - ${windowLabel}` : windowLabel
  const resetsAt = epochToIso(window.reset_at)
  return {
    id,
    label,
    unit: 'percent',
    usedPercent: clampPercentage(usedPercent),
    ...(resetsAt ? { resetsAt } : {})
  }
}

export function codexAdditionalLimitLabel(
  item: Record<string, unknown> | undefined,
  index: number
): string {
  const rawLabel = stringValue(item?.limit_name) || stringValue(item?.metered_feature)
  if (!rawLabel) return `Additional limit ${index + 1}`
  if (/^(?:gpt-[\d.]+-)?codex[-_\s]+spark$/i.test(rawLabel) || /^spark$/i.test(rawLabel)) {
    return 'Spark'
  }
  return rawLabel
}

export function percentageWindowMetric(
  id: string,
  label: string,
  value: unknown,
  percentKey: string
): ProviderQuotaMetric | null {
  const window = optionalRecord(value)
  const usedPercent = numberValue(window?.[percentKey])
  if (usedPercent === undefined) return null
  const resetsAt = isoDateValue(window?.resets_at)
  return {
    id,
    label,
    unit: 'percent',
    usedPercent: clampPercentage(usedPercent),
    ...(resetsAt ? { resetsAt } : {})
  }
}

export function cursorMoneyMetric(
  id: string,
  label: string,
  value: JsonRecord | undefined,
  resetsAt?: string
): ProviderQuotaMetric | null {
  if (!value || value.enabled === false) return null
  const usedCents = numberValue(value.used)
  const limitCents = numberValue(value.limit)
  const remainingCents = numberValue(value.remaining)
  if (usedCents === undefined && limitCents === undefined && remainingCents === undefined) return null
  const used = usedCents === undefined ? undefined : usedCents / 100
  const limit = limitCents === undefined ? undefined : limitCents / 100
  const remaining = remainingCents === undefined ? undefined : remainingCents / 100
  return {
    id,
    label,
    unit: 'USD',
    ...(used === undefined ? {} : { used }),
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...percentageFields(used, limit),
    ...(resetsAt ? { resetsAt } : {})
  }
}

export function firstUsageRecord(
  ...values: Array<JsonRecord | undefined>
): JsonRecord | undefined {
  return values.find((value) => value && (
    numberValue(value.used) !== undefined ||
    numberValue(value.limit) !== undefined ||
    numberValue(value.remaining) !== undefined
  ))
}

export function googleQuotaMetric(
  id: string,
  label: string,
  remainingFraction: number,
  resetTime: unknown
): ProviderQuotaMetric {
  const remainingPercent = clampPercentage(remainingFraction * 100)
  const resetsAt = isoDateValue(resetTime)
  return {
    id,
    label,
    unit: 'percent',
    usedPercent: 100 - remainingPercent,
    ...(resetsAt ? { resetsAt } : {})
  }
}

export function googleSetupSummary(
  setup: JsonRecord,
  accountEmail?: string
): { summary?: string } {
  const tier = optionalRecord(setup.currentTier)
  const paidTier = optionalRecord(setup.paidTier)
  const plan = stringValue(tier?.name) ||
    stringValue(tier?.id) ||
    stringValue(paidTier?.name) ||
    stringValue(paidTier?.id)
  const parts = [plan, accountEmail].filter(Boolean)
  return parts.length ? { summary: parts.join(' · ') } : {}
}

export function formatWindowSeconds(seconds: number): string {
  if (seconds % 604_800 === 0) return `${seconds / 604_800}-week`
  if (seconds % 86_400 === 0) return `${seconds / 86_400}-day`
  if (seconds % 3_600 === 0) return `${seconds / 3_600}-hour`
  return `${seconds}-second`
}

export function percentageFields(
  used: number | undefined,
  limit: number | undefined
): { usedPercent?: number } {
  if (used === undefined || limit === undefined || limit <= 0) return {}
  return { usedPercent: clampPercentage((used / limit) * 100) }
}

export function epochToIso(value: unknown): string | undefined {
  const numeric = numberValue(value)
  if (numeric === undefined || numeric <= 0) return undefined
  const date = new Date(numeric < 100_000_000_000 ? numeric * 1_000 : numeric)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export function isoDateValue(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export type JsonRecord = Record<string, unknown>

export function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function optionalRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

export function requireRecord(value: unknown, message: string): JsonRecord {
  const record = optionalRecord(value)
  if (!record) throw new Error(message)
  return record
}

export function clampPercentage(value: number): number {
  return Math.min(100, Math.max(0, value))
}
