import {
  ProviderQuotaListResponseSchema,
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
import { customBalanceUrl, MAX_RESPONSE_BYTES, type ProbeContext, type ProviderQuotaProbeKind, ProviderQuotaRequestError, QUOTA_TIMEOUT_MS } from './provider-quota-service-core.js'
import { parseAiHubMixBalance, parseCustomBalance, parseNewApiKeyBalance, parseSiliconFlowBalance, parseStepFunBalance } from './provider-quota-balance-parsers.js'
import { parseDeepSeekQuota, parseKimiCodeQuota, parseMiniMaxQuota, parseMoonshotQuota, parseOpenAiQuota, parseOpenRouterQuota, parseZaiQuota } from './provider-quota-service-provider-parsers.js'

export async function runProbe(
  kind: ProviderQuotaProbeKind,
  provider: ProviderQuotaProbeProfile,
  context: ProbeContext,
  subscriptionRuntime: Partial<SubscriptionQuotaRuntime>
): Promise<{ metrics: ProviderQuotaMetric[]; summary?: string; source?: string }> {
  if (isSubscriptionQuotaProbe(kind)) {
    return runSubscriptionQuotaProbe(kind, provider, { fetcher: context.fetcher, proxyUrl: context.proxyUrl }, subscriptionRuntime)
  }
  if (kind === 'deepseek') {
    return { metrics: parseDeepSeekQuota(await requestJson(
      'https://api.deepseek.com/user/balance',
      context
    )) }
  }
  if (kind === 'openrouter') {
    const credits = await requestJson('https://openrouter.ai/api/v1/credits', context)
    let keyPayload: unknown
    try {
      keyPayload = await requestJson('https://openrouter.ai/api/v1/key', context)
    } catch {
      // Credits are useful even when the credential cannot inspect its key budget.
    }
    return { metrics: parseOpenRouterQuota(credits, keyPayload) }
  }
  if (kind === 'moonshot-cn' || kind === 'moonshot-global') {
    return { metrics: parseMoonshotQuota(await requestJson(
      kind === 'moonshot-global'
        ? 'https://api.moonshot.ai/v1/users/me/balance'
        : 'https://api.moonshot.cn/v1/users/me/balance',
      context
    )) }
  }
  if (kind === 'zai' || kind === 'bigmodel') {
    return parseZaiQuota(await requestJson(
      kind === 'bigmodel'
        ? 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'
        : 'https://api.z.ai/api/monitor/usage/quota/limit',
      context
    ))
  }
  if (kind === 'openai') {
    return { metrics: parseOpenAiQuota(await requestJson(
      'https://api.openai.com/v1/dashboard/billing/credit_grants',
      context
    )) }
  }
  if (kind === 'siliconflow-cn' || kind === 'siliconflow-global') {
    return { metrics: parseSiliconFlowBalance(await requestJson(kind === 'siliconflow-cn'
      ? 'https://api.siliconflow.cn/v1/user/info' : 'https://api.siliconflow.com/v1/user/info', context),
    kind === 'siliconflow-cn' ? 'CNY' : 'USD') }
  }
  if (kind === 'stepfun-cn' || kind === 'stepfun-global') {
    return { metrics: parseStepFunBalance(await requestJson(kind === 'stepfun-cn'
      ? 'https://api.stepfun.com/v1/accounts' : 'https://api.stepfun.ai/v1/accounts', context),
    kind === 'stepfun-cn' ? 'CNY' : 'USD') }
  }
  if (kind === 'aihubmix') {
    return { metrics: parseAiHubMixBalance(await requestJson('https://aihubmix.com/dashboard/billing/remain', context)) }
  }
  if (kind === 'new-api') {
    return { metrics: parseNewApiKeyBalance(await requestJson(`${new URL(provider.baseUrl ?? '').origin}/api/usage/token`, context)) }
  }
  if (kind === 'custom-balance') {
    const url = customBalanceUrl(provider)
    if (!url) throw new ProviderQuotaRequestError('The balance URL must be HTTPS on the provider host.')
    const pointer = url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined
    url.hash = ''
    return { metrics: parseCustomBalance(await requestJson(url.toString(), context), pointer) }
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
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${context.apiKey}`
      },
      signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS)
    }, context.proxyUrl)
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || /abort|timeout/iu.test(error.message))) {
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
  const text = await readBoundedResponseText(response)
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderQuotaRequestError('The provider returned malformed quota data.')
  }
}

export async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
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
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new ProviderQuotaRequestError('The provider quota response was too large.')
      }
      output += decoder.decode(value, { stream: true })
    }
    return output + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

export async function proxyAwareFetch(
  input: string | URL,
  init: RequestInit | undefined,
  proxyUrl: string
): Promise<Response> {
  const fetchImpl = createProxyFetch(proxyUrl) ?? fetch
  return fetchImpl(input, init)
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
        results[index] = await mapper(items[index]!)
      }
    }
  )
  await Promise.all(workers)
  return results
}
