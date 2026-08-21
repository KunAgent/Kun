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

export type ProviderQuotaSourceSnapshot = {
  profiles: ProviderQuotaProbeProfile[]
  proxyUrl: string
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
  private readonly subscriptionRuntime: Partial<SubscriptionQuotaRuntime>

  constructor(private readonly options: {
    loadSource: () => Promise<ProviderQuotaSourceSnapshot>
    fetcher?: ProviderQuotaFetch
    nowIso?: () => string
    subscriptionRuntime?: Partial<SubscriptionQuotaRuntime>
    loadLocalCosts?: ProviderLocalCostLoader
  }) {
    this.fetcher = options.fetcher ?? proxyAwareFetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.subscriptionRuntime = options.subscriptionRuntime ?? {}
  }

  async list(): Promise<ProviderQuotaListResponse> {
    const refreshedAt = this.nowIso()
    const source = await this.options.loadSource()
    const localCostsPromise: Promise<Readonly<Record<
      string,
      ProviderLocalCostSummary | undefined
    >>> = this.options.loadLocalCosts
      ? this.options.loadLocalCosts(source.profiles).catch(() => ({}))
      : Promise.resolve({})
    const [probedEntries, localCosts] = await Promise.all([
      mapWithConcurrency(
        source.profiles,
        QUOTA_CONCURRENCY,
        async (profile) => this.refreshProfile(profile, source.proxyUrl)
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

  private async refreshProfile(
    provider: ProviderQuotaProbeProfile,
    proxyUrl: string
  ): Promise<ProviderQuotaEntry> {
    const baseEntry = {
      providerId: provider.id,
      providerName: provider.name,
      ...(provider.presetId ? { presetId: provider.presetId } : {})
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
        message: 'Connect a provider credential before refreshing quota.'
      }
    }
    try {
      const result = await runProbe(
        probe.kind,
        provider,
        { fetcher: this.fetcher, proxyUrl, apiKey },
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
  if (stableId === 'claude-subscription' && provider.kind === 'agent-sdk') {
    return {
      kind: 'claude-subscription',
      source: 'Claude OAuth usage API',
      dashboardUrl: 'https://claude.ai/settings/usage'
    }
  }
  if (stableId === 'codex' && provider.kind === 'http') {
    return {
      kind: 'codex-subscription',
      source: 'ChatGPT Codex usage API',
      dashboardUrl: 'https://chatgpt.com/codex/settings/usage'
    }
  }
  if (stableId === 'grok-subscription' && provider.kind === 'http') {
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
  if (hostname === 'api.openai.com') {
    return {
      kind: 'openai',
      source: 'OpenAI credit grants API',
      dashboardUrl: 'https://platform.openai.com/settings/organization/billing/overview'
    }
  }
  return null
}
