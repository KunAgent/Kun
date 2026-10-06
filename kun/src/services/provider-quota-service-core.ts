import { scopedQuotaFetch, providerQuotaIdentity } from './provider-quota-security.js'
import {
  ProviderQuotaListResponseSchema,
  type ProviderLocalCostSummary,
  type ProviderQuotaEntry,
  type ProviderQuotaListResponse,
  type ProviderQuotaMetric
} from '../contracts/provider-quota.js'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'
import {
  ProviderQuotaMissingCredentialError,
  runSubscriptionQuotaProbe,
  type ProviderQuotaFetch,
  type ProviderQuotaProbeProfile,
  type SubscriptionQuotaProbeKind,
  type SubscriptionQuotaRuntime
} from './provider-subscription-quota.js'
import { isSubscriptionQuotaProbe, mapWithConcurrency, proxyAwareFetch, runProbe } from './provider-quota-service-probe.js'
import { exactHostname, quotaErrorMessage } from './provider-quota-service-metrics.js'

export const QUOTA_TIMEOUT_MS = 12_000

export const MAX_RESPONSE_BYTES = 256 * 1024

export const QUOTA_CONCURRENCY = 4

/** Per-provider cache retention; the route refresh and the GUI share it. */
export const QUOTA_CACHE_TTL_MS = 5 * 60_000

export type ProviderQuotaListOptions = {
  /** Restrict probing to these provider ids (matched case-insensitively). */
  providerIds?: readonly string[]
  /** Aggregate local cost summaries; pass false for routing refreshes. */
  includeLocalCosts?: boolean
  /** Bypass the per-provider cache (manual refresh). */
  forceRefresh?: boolean
}

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
  | 'siliconflow-cn'
  | 'siliconflow-global'
  | 'stepfun-cn'
  | 'stepfun-global'
  | 'aihubmix'
  | 'new-api'
  | SubscriptionQuotaProbeKind

export type ProviderQuotaProbe = {
  kind: ProviderQuotaProbeKind
  source: string
  dashboardUrl: string
}

export type ProviderQuotaSourceSnapshot = {
  profiles: ProviderQuotaProbeProfile[]
  /** Retained for legacy callers only; Provider profiles never inherit it. */
  proxyUrl?: string
}

export type ProviderLocalCostLoader = (
  profiles: readonly ProviderQuotaProbeProfile[]
) => Promise<Readonly<Record<string, ProviderLocalCostSummary | undefined>>>

export type ProbeContext = {
  fetcher: ProviderQuotaFetch
  proxyUrl: string
  apiKey: string
}

export type JsonRecord = Record<string, unknown>

export class ProviderQuotaRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ProviderQuotaRequestError'
  }
}

export class ProviderQuotaService {
  private readonly fetcher: ProviderQuotaFetch
  private readonly nowIso: () => string
  private readonly now: () => number
  private readonly subscriptionRuntime: Partial<SubscriptionQuotaRuntime>
  private readonly cache = new Map<string, { entry: ProviderQuotaEntry; fetchedAt: number }>()
  private readonly inflight = new Map<string, Promise<ProviderQuotaEntry>>()

  constructor(private readonly options: {
    loadSource: () => Promise<ProviderQuotaSourceSnapshot>
    fetcher?: ProviderQuotaFetch
    nowIso?: () => string
    now?: () => number
    subscriptionRuntime?: Partial<SubscriptionQuotaRuntime>
    loadLocalCosts?: ProviderLocalCostLoader
  }) {
    this.fetcher = options.fetcher ?? proxyAwareFetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.now = options.now ?? Date.now
    this.subscriptionRuntime = options.subscriptionRuntime ?? {}
  }

  async list(listOptions: ProviderQuotaListOptions = {}): Promise<ProviderQuotaListResponse> {
    const refreshedAt = this.nowIso()
    const source = await this.options.loadSource()
    const wanted = listOptions.providerIds
      ? new Set(listOptions.providerIds.map((id) => id.trim().toLowerCase()))
      : undefined
    const profiles = wanted
      ? source.profiles.filter((profile) => wanted.has(profile.id.trim().toLowerCase()))
      : source.profiles
    const localCostsPromise: Promise<Readonly<Record<
      string,
      ProviderLocalCostSummary | undefined
    >>> = listOptions.includeLocalCosts !== false && this.options.loadLocalCosts
      ? this.options.loadLocalCosts(profiles).catch(() => ({}))
      : Promise.resolve({})
    const [probedEntries, localCosts] = await Promise.all([
      mapWithConcurrency(
        profiles,
        QUOTA_CONCURRENCY,
        async (profile) => this.cachedRefreshProfile(profile, listOptions.forceRefresh === true)
      ),
      localCostsPromise
    ])
    const entries = probedEntries.map((entry) => {
      const localCost = Object.hasOwn(localCosts, entry.providerId)
        ? localCosts[entry.providerId]
        : undefined
      return localCost ? { ...entry, localCost } : entry
    })
    return ProviderQuotaListResponseSchema.parse({ entries, refreshedAt })
  }

  /**
   * Probes a profile through the shared TTL cache. Concurrent callers share
   * one in-flight request; a failed refresh keeps the previous snapshot so
   * routing never stalls on a transient probe error.
   */
  private cachedRefreshProfile(
    profile: ProviderQuotaProbeProfile,
    forceRefresh: boolean
  ): Promise<ProviderQuotaEntry> {
    const prefix = `${profile.id.trim().toLowerCase()}:`
    const key = `${prefix}${providerQuotaIdentity(profile)}`
    for (const previous of this.cache.keys()) if (previous.startsWith(prefix) && previous !== key) this.cache.delete(previous)
    while (this.cache.size > 1_024) this.cache.delete(this.cache.keys().next().value!)
    const cached = this.cache.get(key)
    if (!forceRefresh && cached && this.now() - cached.fetchedAt < QUOTA_CACHE_TTL_MS) {
      return Promise.resolve(cached.entry)
    }
    const pending = this.inflight.get(key)
    if (pending) return pending
    const request = this.refreshProfile(profile, profile.proxyUrl ?? '')
      .then((entry) => {
        const previous = this.cache.get(key)
        const stored = entry.status === 'error' && previous ? previous.entry : entry
        this.cache.set(key, { entry: stored, fetchedAt: this.now() })
        return stored
      })
      .finally(() => {
        this.inflight.delete(key)
      })
    this.inflight.set(key, request)
    return request
  }

  private async refreshProfile(
    provider: ProviderQuotaProbeProfile,
    proxyUrl: string
  ): Promise<ProviderQuotaEntry> {
    const baseEntry = {
      providerId: provider.id,
      providerName: provider.name,
      ...(provider.presetId ? { presetId: provider.presetId } : {})
    }
    if (provider.configured === false) return { ...baseEntry, status: 'missing_credentials', metrics: [],
      message: 'The provider connection has no usable protected credential.' }
    const probe = classifyProviderQuotaProbe(provider)
    if (!probe) {
      return {
        ...baseEntry,
        status: 'unsupported',
        metrics: [],
        message: 'This provider does not expose a supported quota API in this version.'
      }
    }
    if (provider.authProfile && !provider.authProfile.scope.purposes.includes('quota')) return {
      ...baseEntry, status: 'unsupported', metrics: [], message: 'This connection does not authorize quota requests.'
    }
    const apiKey = provider.apiKey.trim()
    if (!isSubscriptionQuotaProbe(probe.kind) && !apiKey) {
      return {
        ...baseEntry,
        status: 'missing_credentials',
        source: probe.source,
        dashboardUrl: probe.dashboardUrl,
        metrics: [],
        message: 'Connect a provider credential before refreshing quota.'
      }
    }
    try {
      const result = await runProbe(
        probe.kind,
        provider,
        { fetcher: scopedQuotaFetch(this.fetcher, provider, probe.kind), proxyUrl, apiKey },
        this.subscriptionRuntime
      )
      return {
        ...baseEntry,
        status: 'available',
        source: result.source ?? probe.source,
        dashboardUrl: probe.dashboardUrl,
        metrics: result.metrics,
        ...(result.summary ? { summary: result.summary } : {}),
        updatedAt: this.nowIso()
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
        updatedAt: this.nowIso()
      }
    }
  }
}

export function classifyProviderQuotaProbe(
  provider: ProviderQuotaProbeProfile
): ProviderQuotaProbe | null {
  const stableId = provider.presetId || provider.id
  const hostname = exactHostname(provider.baseUrl)
  if (stableId === 'claude-subscription' && provider.kind === 'agent-sdk') {
    return {
      kind: 'claude-subscription',
      source: 'Claude OAuth usage API',
      dashboardUrl: 'https://claude.ai/settings/usage'
    }
  }
  if (stableId === 'codex' && provider.kind === 'http' && hostname === 'chatgpt.com') {
    return {
      kind: 'codex-subscription',
      source: 'ChatGPT Codex usage API',
      dashboardUrl: 'https://chatgpt.com/codex/settings/usage'
    }
  }
  if (stableId === 'grok-subscription' && provider.kind === 'http' && hostname === 'cli-chat-proxy.grok.com') {
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
  if (
    stableId === 'opencode-go' &&
    provider.kind === 'http' &&
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
    provider.kind === 'http' &&
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
  if (hostname === 'api.moonshot.cn' || hostname === 'api.moonshot.ai') {
    return {
      kind: hostname === 'api.moonshot.ai' ? 'moonshot-global' : 'moonshot-cn',
      source: 'Moonshot balance API',
      dashboardUrl: hostname === 'api.moonshot.ai'
        ? 'https://platform.moonshot.ai/'
        : 'https://platform.moonshot.cn/'
    }
  }
  if (hostname === 'api.z.ai' || hostname === 'open.bigmodel.cn') {
    return {
      kind: hostname === 'open.bigmodel.cn' ? 'bigmodel' : 'zai',
      source: 'Z.ai Coding Plan quota API',
      dashboardUrl: hostname === 'open.bigmodel.cn'
        ? 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys'
        : 'https://z.ai/manage-apikey/apikey-list'
    }
  }
  if (hostname === 'api.minimax.io' || hostname === 'api.minimaxi.com') {
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
  if (hostname === 'api.siliconflow.cn' || hostname === 'api.siliconflow.com') {
    return {
      kind: hostname === 'api.siliconflow.cn' ? 'siliconflow-cn' : 'siliconflow-global',
      source: 'SiliconFlow account API',
      dashboardUrl: hostname === 'api.siliconflow.cn' ? 'https://cloud.siliconflow.cn/expensebill' : 'https://cloud.siliconflow.com/expensebill'
    }
  }
  if (hostname === 'api.stepfun.com' || hostname === 'api.stepfun.ai') {
    return {
      kind: hostname === 'api.stepfun.com' ? 'stepfun-cn' : 'stepfun-global',
      source: 'StepFun account API',
      dashboardUrl: hostname === 'api.stepfun.com' ? 'https://platform.stepfun.com/account-overview' : 'https://platform.stepfun.ai/account-overview'
    }
  }
  if (hostname === 'aihubmix.com') {
    return { kind: 'aihubmix', source: 'AiHubMix key balance API', dashboardUrl: 'https://console.aihubmix.com/token' }
  }
  // new-api relays answer a key's own balance at /api/usage/token on their own host.
  if (stableId === 'cherryin' && hostname === 'open.cherryin.ai') {
    return { kind: 'new-api', source: 'Relay key usage API', dashboardUrl: 'https://open.cherryin.ai/console/token' }
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
