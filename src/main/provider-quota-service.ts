import {
  getModelProviderSettings,
  resolveProviderProxyUrl,
  type AppSettingsV1,
  type ModelProviderProfileV1
} from '../shared/app-settings'
import type {
  ProviderQuotaEntry,
  ProviderQuotaListResult,
  ProviderQuotaMetric
} from '../shared/provider-quota'
import { fetchWithOptionalProxy } from './proxy-fetch'
import {
  ProviderQuotaMissingCredentialError,
  runSubscriptionQuotaProbe,
  type SubscriptionQuotaProbeKind,
  type SubscriptionQuotaRuntime
} from './provider-subscription-quota'

import {
  exactHostname,
  isHttpQuotaPresetKind,
  parseDeepSeekQuota,
  parseKimiCodeQuota,
  parseMiniMaxQuota,
  parseMoonshotQuota,
  parseOpenAiQuota,
  parseOpenRouterQuota,
  parseZaiQuota,
  quotaErrorMessage
} from './provider-quota-parsers'

export const PROVIDER_QUOTA_TIMEOUT_MS = 12_000

export const PROVIDER_QUOTA_MAX_RESPONSE_BYTES = 256 * 1024

export const PROVIDER_QUOTA_CONCURRENCY = 4

export type ProviderQuotaFetch = typeof fetchWithOptionalProxy

export type ProviderQuotaProbeKind =
  | 'deepseek'
  | 'openrouter'
  | 'moonshot-cn'
  | 'moonshot-global'
  | 'zai'
  | 'bigmodel'
  | 'minimax-global'
  | 'minimax-cn'
  | 'kimi-code'
  | 'openai'
  | SubscriptionQuotaProbeKind

export type ProviderQuotaProbe = {
  kind: ProviderQuotaProbeKind
  source: string
  dashboardUrl: string
}

export type ProbeContext = {
  fetcher: ProviderQuotaFetch
  proxyUrl: string
  apiKey: string
}

export type JsonRecord = Record<string, unknown>

export class ProviderQuotaRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'ProviderQuotaRequestError'
  }
}

export async function listProviderQuotas(
  settings: AppSettingsV1,
  fetcher: ProviderQuotaFetch = fetchWithOptionalProxy,
  subscriptionRuntime: Partial<SubscriptionQuotaRuntime> = {}
): Promise<ProviderQuotaListResult> {
  const refreshedAt = new Date().toISOString()
  const providers = getModelProviderSettings(settings).providers
  const entries = await mapWithConcurrency(
    providers,
    PROVIDER_QUOTA_CONCURRENCY,
    async (provider) => refreshProviderQuota(provider, settings, fetcher, subscriptionRuntime)
  )
  return { entries, refreshedAt }
}

export function classifyProviderQuotaProbe(
  provider: ModelProviderProfileV1
): ProviderQuotaProbe | null {
  const presetId = provider.presetSource?.presetId
  const stableId = presetId || provider.id
  if (stableId === 'claude-subscription' && provider.kind === 'agent-sdk') {
    return {
      kind: 'claude-subscription',
      source: 'Claude OAuth usage API',
      dashboardUrl: 'https://claude.ai/settings/usage'
    }
  }
  if (stableId === 'codex' && isHttpQuotaPresetKind(provider.kind)) {
    return {
      kind: 'codex-subscription',
      source: 'ChatGPT Codex usage API',
      dashboardUrl: 'https://chatgpt.com/codex/settings/usage'
    }
  }
  if (stableId === 'grok-subscription' && isHttpQuotaPresetKind(provider.kind)) {
    return {
      kind: 'grok-subscription',
      source: 'Grok web billing API',
      dashboardUrl: 'https://grok.com/?_s=usage'
    }
  }
  if (stableId === 'cursor-subscription' && provider.kind === 'cursor-sdk') {
    return {
      kind: 'cursor-subscription',
      source: 'Cursor usage summary API',
      dashboardUrl: 'https://cursor.com/dashboard?tab=usage'
    }
  }
  if (provider.kind === 'antigravity-cli') {
    return {
      kind: 'antigravity-subscription',
      source: 'Google Antigravity quota API',
      dashboardUrl: 'https://antigravity.google'
    }
  }
  if (provider.kind === 'gemini-cli-api') {
    return {
      kind: 'gemini-cli-subscription',
      source: 'Google Gemini CLI quota API',
      dashboardUrl: 'https://aistudio.google.com/usage'
    }
  }
  const hostname = exactHostname(provider.baseUrl)

  if (
    stableId === 'opencode-go' &&
    isHttpQuotaPresetKind(provider.kind) &&
    hostname === 'opencode.ai'
  ) {
    return {
      kind: 'opencode-go-local',
      source: 'OpenCode Go local usage estimate',
      dashboardUrl: 'https://opencode.ai'
    }
  }
  if (
    stableId === 'kimi-code' &&
    isHttpQuotaPresetKind(provider.kind) &&
    hostname === 'api.kimi.com'
  ) {
    return {
      kind: 'kimi-code',
      source: 'Kimi Code usage API',
      dashboardUrl: 'https://www.kimi.com/code/console'
    }
  }
  if (hostname === 'api.deepseek.com') {
    return {
      kind: 'deepseek',
      source: 'DeepSeek balance API',
      dashboardUrl: 'https://platform.deepseek.com/usage'
    }
  }
  if (
    hostname === 'api.moonshot.cn' ||
    hostname === 'api.moonshot.ai'
  ) {
    return {
      kind: hostname === 'api.moonshot.ai'
        ? 'moonshot-global'
        : 'moonshot-cn',
      source: 'Moonshot balance API',
      dashboardUrl: hostname === 'api.moonshot.ai'
        ? 'https://platform.moonshot.ai/'
        : 'https://platform.moonshot.cn/'
    }
  }
  if (
    hostname === 'api.z.ai' ||
    hostname === 'open.bigmodel.cn'
  ) {
    return {
      kind: hostname === 'open.bigmodel.cn'
        ? 'bigmodel'
        : 'zai',
      source: 'Z.ai Coding Plan quota API',
      dashboardUrl: hostname === 'open.bigmodel.cn'
        ? 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys'
        : 'https://z.ai/manage-apikey/apikey-list'
    }
  }
  if (
    hostname === 'api.minimax.io' ||
    hostname === 'api.minimaxi.com'
  ) {
    return {
      kind: hostname === 'api.minimaxi.com' ? 'minimax-cn' : 'minimax-global',
      source: 'MiniMax Coding Plan quota API',
      dashboardUrl: hostname === 'api.minimaxi.com'
        ? 'https://platform.minimaxi.com/'
        : 'https://platform.minimax.io/'
    }
  }
  if (hostname === 'openrouter.ai') {
    return {
      kind: 'openrouter',
      source: 'OpenRouter credits API',
      dashboardUrl: 'https://openrouter.ai/settings/credits'
    }
  }
  if (hostname === 'api.openai.com') {
    return {
      kind: 'openai',
      source: 'OpenAI credit grants API',
      dashboardUrl: 'https://platform.openai.com/settings/organization/billing/overview'
    }
  }
  return null
}

export async function refreshProviderQuota(
  provider: ModelProviderProfileV1,
  settings: AppSettingsV1,
  fetcher: ProviderQuotaFetch,
  subscriptionRuntime: Partial<SubscriptionQuotaRuntime>
): Promise<ProviderQuotaEntry> {
  const baseEntry = {
    providerId: provider.id,
    providerName: provider.name,
    ...(provider.presetSource?.presetId ? { presetId: provider.presetSource.presetId } : {})
  }
  const probe = classifyProviderQuotaProbe(provider)
  if (!probe) {
    return {
      ...baseEntry,
      status: 'unsupported',
      metrics: [],
      message: 'This provider does not expose a supported quota API in this version.'
    }
  }
  const apiKey = provider.apiKey.trim()
  if (!isSubscriptionQuotaProbe(probe.kind) && !apiKey) {
    return {
      ...baseEntry,
      status: 'missing_credentials',
      source: probe.source,
      dashboardUrl: probe.dashboardUrl,
      metrics: [],
      message: 'Add a provider credential in Settings before refreshing quota.'
    }
  }

  try {
    const proxyUrl = resolveProviderProxyUrl(settings, provider)
    const result = await runProbe(
      probe.kind,
      provider,
      { fetcher, proxyUrl, apiKey },
      subscriptionRuntime
    )
    return {
      ...baseEntry,
      status: 'available',
      source: result.source ?? probe.source,
      dashboardUrl: probe.dashboardUrl,
      metrics: result.metrics,
      ...(result.summary ? { summary: result.summary } : {}),
      updatedAt: new Date().toISOString()
    }
  } catch (error) {
    if (error instanceof ProviderQuotaMissingCredentialError) {
      return {
        ...baseEntry,
        status: 'missing_credentials',
        source: probe.source,
        dashboardUrl: probe.dashboardUrl,
        metrics: [],
        message: error.message
      }
    }
    return {
      ...baseEntry,
      status: 'error',
      source: probe.source,
      dashboardUrl: probe.dashboardUrl,
      metrics: [],
      message: quotaErrorMessage(error),
      updatedAt: new Date().toISOString()
    }
  }
}

export async function runProbe(
  kind: ProviderQuotaProbeKind,
  provider: ModelProviderProfileV1,
  context: ProbeContext,
  subscriptionRuntime: Partial<SubscriptionQuotaRuntime>
): Promise<{ metrics: ProviderQuotaMetric[]; summary?: string; source?: string }> {
  if (isSubscriptionQuotaProbe(kind)) {
    return runSubscriptionQuotaProbe(kind, provider, context, subscriptionRuntime)
  }
  if (kind === 'deepseek') {
    return {
      metrics: parseDeepSeekQuota(
        await requestJson('https://api.deepseek.com/user/balance', context)
      )
    }
  }
  if (kind === 'openrouter') {
    const credits = await requestJson('https://openrouter.ai/api/v1/credits', context)
    let keyPayload: unknown
    try {
      keyPayload = await requestJson('https://openrouter.ai/api/v1/key', context)
    } catch {
      // Credits are useful on their own; key-budget permissions vary by credential.
    }
    return { metrics: parseOpenRouterQuota(credits, keyPayload) }
  }
  if (kind === 'moonshot-cn' || kind === 'moonshot-global') {
    return {
      metrics: parseMoonshotQuota(
        await requestJson(
          kind === 'moonshot-global'
            ? 'https://api.moonshot.ai/v1/users/me/balance'
            : 'https://api.moonshot.cn/v1/users/me/balance',
          context
        )
      )
    }
  }
  if (kind === 'zai' || kind === 'bigmodel') {
    return parseZaiQuota(
      await requestJson(
        kind === 'bigmodel'
          ? 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'
          : 'https://api.z.ai/api/monitor/usage/quota/limit',
        context
      )
    )
  }
  if (kind === 'openai') {
    return {
      metrics: parseOpenAiQuota(
        await requestJson('https://api.openai.com/v1/dashboard/billing/credit_grants', context)
      )
    }
  }
  if (kind === 'kimi-code') {
    return {
      metrics: parseKimiCodeQuota(
        await requestJson('https://api.kimi.com/coding/v1/usages', context)
      )
    }
  }
  return probeMiniMax(kind, context)
}

export function isSubscriptionQuotaProbe(
  kind: ProviderQuotaProbeKind
): kind is SubscriptionQuotaProbeKind {
  return kind === 'claude-subscription' ||
    kind === 'codex-subscription' ||
    kind === 'grok-subscription' ||
    kind === 'cursor-subscription' ||
    kind === 'antigravity-subscription' ||
    kind === 'gemini-cli-subscription' ||
    kind === 'opencode-go-local'
}

export async function probeMiniMax(
  kind: 'minimax-global' | 'minimax-cn',
  context: ProbeContext
): Promise<{ metrics: ProviderQuotaMetric[]; summary?: string }> {
  const hosts = kind === 'minimax-cn'
    ? ['https://api.minimaxi.com']
    : ['https://api.minimax.io', 'https://api.minimaxi.com']
  let lastError: unknown
  for (const host of hosts) {
    for (const path of ['/v1/token_plan/remains', '/v1/api/openplatform/coding_plan/remains']) {
      try {
        return parseMiniMaxQuota(await requestJson(`${host}${path}`, context))
      } catch (error) {
        lastError = error
      }
    }
  }
  throw lastError ?? new Error('MiniMax quota is unavailable.')
}

export async function requestJson(url: string, context: ProbeContext): Promise<unknown> {
  let response: Response
  try {
    response = await context.fetcher(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${context.apiKey}`
      },
      signal: AbortSignal.timeout(PROVIDER_QUOTA_TIMEOUT_MS)
    }, context.proxyUrl)
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || /abort|timeout/i.test(error.message))) {
      throw new ProviderQuotaRequestError('The quota request timed out.')
    }
    throw new ProviderQuotaRequestError('The quota request could not reach the provider.')
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ProviderQuotaRequestError(
        'The provider did not authorize quota access for this credential.',
        response.status
      )
    }
    throw new ProviderQuotaRequestError(
      `The provider quota endpoint returned HTTP ${response.status}.`,
      response.status
    )
  }
  const text = await readBoundedResponseText(response, PROVIDER_QUOTA_MAX_RESPONSE_BYTES)
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderQuotaRequestError('The provider returned malformed quota data.')
  }
}

export async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ProviderQuotaRequestError('The provider quota response was too large.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let totalBytes = 0
  let output = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new ProviderQuotaRequestError('The provider quota response was too large.')
      }
      output += decoder.decode(value, { stream: true })
    }
    output += decoder.decode()
    return output
  } finally {
    reader.releaseLock()
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (true) {
        const index = nextIndex
        nextIndex += 1
        if (index >= items.length) return
        results[index] = await mapper(items[index])
      }
    }
  )
  await Promise.all(workers)
  return results
}
