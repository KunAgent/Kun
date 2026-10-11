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
import { clampPercentage, epochToIso, formatWindowSeconds, isoDateValue, type JsonRecord, numberValue, optionalRecord, percentageFields, stringValue } from './provider-subscription-quota-support.js'

export function codexWindowMetric(
  id: string,
  fallbackLabel: string,
  value: unknown,
  scopeLabel?: string
): ProviderQuotaMetric | null {
  const window = optionalRecord(value)
  const usedPercent = numberValue(window?.used_percent)
  if (usedPercent === undefined) return null
  const seconds = numberValue(window?.limit_window_seconds)
  const resetsAt = epochToIso(window?.reset_at)
  const windowLabel = seconds === undefined ? fallbackLabel : `${formatWindowSeconds(seconds)} usage`
  return {
    id,
    label: scopeLabel ? `${scopeLabel} - ${windowLabel}` : windowLabel,
    unit: 'percent',
    usedPercent: clampPercentage(usedPercent),
    ...(resetsAt ? { resetsAt } : {}),
    ...(seconds !== undefined && Number.isInteger(seconds) && seconds > 0 ? { windowSeconds: seconds } : {})
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
  percentKey: string,
  windowSeconds?: number
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
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowSeconds ? { windowSeconds } : {})
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

export function percentageMetric(
  id: string,
  label: string,
  usedPercent: number,
  resetsAt?: string
): ProviderQuotaMetric {
  return {
    id,
    label,
    unit: 'percent',
    usedPercent: clampPercentage(usedPercent),
    ...(resetsAt ? { resetsAt } : {})
  }
}

export function firstUsageRecord(...values: Array<JsonRecord | undefined>): JsonRecord | undefined {
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

export function claudeAccessToken(value: unknown): string | undefined {
  const oauth = optionalRecord(optionalRecord(value)?.claudeAiOauth)
  const token = stringValue(oauth?.accessToken)
  return validClaudeToken(token) ? token : undefined
}

export function validClaudeToken(value: string): boolean {
  return /^sk-ant-oat[\w-]+$/u.test(value.trim())
}

export function appStateDbPath(app: 'Cursor' | 'Antigravity'): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', app, 'User', 'globalStorage', 'state.vscdb')
  }
  if (process.platform === 'linux') {
    return join(homedir(), '.config', app, 'User', 'globalStorage', 'state.vscdb')
  }
  return ''
}
