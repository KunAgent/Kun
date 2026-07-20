/**
 * [INPUT]: 依赖 WebProvider、ResearchTaskWorkerInput、ResearchSourcePolicy、ResearchWebQueryText 和 ResearchWebTypes
 * [OUTPUT]: 对外提供用户显式 URL 直抓种子、严格指定 URL 时的搜索短路、显式发布方白名单候选准入、完整保留三条模型定向策略并补主材料恢复查询和一条简短通用 fallback、把已校验 comparisonTarget 查询所有权带入搜索 seed、让缺边补研只搜索 task 指定对象且跳过宽泛题目/旧 hints、去除全部对比对象重复词的逐对象官方查询、优先跨语言正式主体名的主材料查询、逐条放行模型定向查询的 DeepSeek 搜索、首页降权、原始文档优先、候选源混合与相关性策略
 * [POS]: research/runtime 的领域中立网页搜索执行层，被 SeededWebResearchTaskWorker 调用；用户严格指定具体 URL 时不扩展到同域其他页面，普通候选仍按主题与分面过滤，不维护题目、行业或权威域名词典
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { WebProvider, WebSearchProviderAttempt, WebSearchRequest, WebSearchResult } from '../../ports/web-provider.js'
import { linkResearchAbortSignal, throwIfResearchAborted } from '../core/abort.js'
import type { ResearchTaskWorkerInput } from '../agents/types.js'
import type { ResearchModelCallReservation } from '../core/types.js'
import {
  isResearchSourceUrlAllowed,
  isResearchSourceCandidateAllowed,
  isResearchSourceUrlPreferred,
  sourcePolicySiteQueries,
  strictSourceUrlsMentionedInText
} from './ResearchSourcePolicy.js'
import { isFatalResearchTaskError } from './ResearchRuntimePolicy.js'
import { isResearchTextRelevant, normalizeSourceUrl, researchSignalTerms } from '../evidence/EvidenceEligibility.js'
import { comparisonTargetAliases, extractComparisonTargets } from '../core/comparison.js'
import type { SeedSource } from './ResearchWebTypes.js'
import {
  conciseFocusTerms,
  conciseTopicAnchor,
  focusedSubjectSearchQueries,
  isDirectComparisonResearch,
  localizedOfficialTerm,
  sourceTextMatchesResearchSubject
} from './ResearchWebQueryText.js'

export const WEB_RESEARCH_SOURCE_LIMIT = 12
const WEB_SEARCH_QUERY_LIMIT = 5
const WEB_SEARCH_RESULTS_PER_QUERY = 5

export function seedCandidateLimitForTask(input: ResearchTaskWorkerInput): number {
  const requested = Math.max(1, input.task.maxSources)
  if (input.budget.preset === 'quick') return Math.min(WEB_RESEARCH_SOURCE_LIMIT, requested)
  // Some candidates will fail fetch or be rejected as search-only snippets.
  // The task still returns at most task.maxSources accepted sources.
  return Math.min(WEB_RESEARCH_SOURCE_LIMIT, Math.max(requested + 2, requested * 3))
}

export async function searchSeedSources(
  input: ResearchTaskWorkerInput,
  options: {
    provider?: WebProvider
    nowIso: () => string
    timeoutMs: number
    preferredQueries?: Array<string | { query: string; comparisonTarget?: string }>
    subjectAliases?: string[]
    signal?: AbortSignal
  }
): Promise<SeedSource[]> {
  const provider = options.provider
  const candidateLimit = seedCandidateLimitForTask(input)
  const directSeeds = directDocumentationSeedSources(input).slice(0, candidateLimit)
  const strictUrls = strictSourceUrlsForTask(input)
  if (strictUrls.length > 0) {
    const allowedIdentities = new Set(strictUrls.map(normalizeSourceUrl))
    return directSeeds.filter((seed) => allowedIdentities.has(normalizeSourceUrl(seed.url)))
  }
  if (!provider?.search || directSeeds.length >= candidateLimit) return directSeeds
  const timeRange = defaultSearchTimeRange(input, options.nowIso())
  const preferredQuerySpecs = (options.preferredQueries ?? []).map((item) => (
    typeof item === 'string' ? { query: item } : item
  ))
  const preferredQueries = preferredQuerySpecs.map((item) => item.query)
  const targetedComparisonRepair = (input.task.comparisonTargets?.length ?? 0) > 0
  const queryLimit = preferredQueries.length > 0
    ? Math.min(WEB_SEARCH_QUERY_LIMIT, Math.max(searchQueryLimitForTask(input), preferredQueries.length + (targetedComparisonRepair ? 1 : 2)))
    : searchQueryLimitForTask(input)
  const fallbackQueries = buildSearchQueries(input, timeRange)
  const strategyQueries = preferredQueries.length > 0
    ? [...preferredQueries, ...(targetedComparisonRepair ? [] : [primarySourceDiscoveryQuery(input, options.subjectAliases)])]
    : []
  const queries = mergeStrategyAndFallbackQueries(
    strategyQueries,
    fallbackQueries,
    queryLimit
  )
  if (queries.length === 0) return []
  const groups: WebSearchResult[][] = []
  const preferredQueryKeys = new Set((options.preferredQueries ?? [])
    .map((item) => typeof item === 'string' ? item : item.query)
    .map(normalizeSearchQuery)
    .map((query) => query.toLowerCase()))
  const comparisonTargetByPreferredQuery = new Map(preferredQuerySpecs.flatMap((item) => {
    const target = item.comparisonTarget?.trim()
    return target ? [[normalizeSearchQuery(item.query).toLowerCase(), target] as const] : []
  }))
  const primaryStrategyQueryKey = normalizeSearchQuery(preferredQueries[0] ?? '').toLowerCase()
  const strategyAcceptedUrls = new Set<string>()
  const primaryAcceptedUrls = new Set<string>()
  const comparisonTargetByUrl = new Map<string, string>()
  const primaryQueryKey = normalizeSearchQuery(primarySourceDiscoveryQuery(input, options.subjectAliases)).toLowerCase()
  const primaryMaterialQueryKeys = new Set([primaryQueryKey, primaryStrategyQueryKey].filter(Boolean))
  const acceptedUrls = new Set([
    ...directSeeds.map((seed) => normalizeSourceUrl(seed.url)),
    ...(input.existingSourceUrls ?? []).map(normalizeSourceUrl)
  ])
  const fallbackOnlyQueryKeys = preferredQueryKeys.size > 0
    ? preferredQueryKeys
    : primaryMaterialQueryKeys
  const fallbackOnlyQueryLimit = Math.min(3, Math.max(1, fallbackOnlyQueryKeys.size))
  let fallbackOnlyAttemptCount = 0
  for (const query of queries) {
    throwIfResearchAborted(options.signal)
    const normalizedQueryKey = normalizeSearchQuery(query).toLowerCase()
    const comparisonTarget = comparisonTargetByPreferredQuery.get(normalizedQueryKey)
    const allowFallbackOnly = fallbackOnlyAttemptCount < fallbackOnlyQueryLimit &&
      fallbackOnlyQueryKeys.has(normalizedQueryKey)
    if (allowFallbackOnly) fallbackOnlyAttemptCount += 1
    const results = await searchOneQuery(query, {
      provider,
      nowIso: options.nowIso,
      timeRange,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      execution: input.execution,
      taskId: input.task.id,
      allowFallbackOnly,
      resultLimit: WEB_RESEARCH_SOURCE_LIMIT,
      acceptedResultLimit: Math.min(
        WEB_RESEARCH_SOURCE_LIMIT,
        Math.max(WEB_SEARCH_RESULTS_PER_QUERY, candidateLimit * 3)
      ),
      acceptResult: (result) => {
        if (isLowValueResearchUrl(result.url)) return false
        const candidateText = `${result.title}\n${result.snippet}\n${result.url}`
        const acceptedByStrategy = preferredQueryKeys.has(normalizedQueryKey)
          && result.rank <= 2
          && !isSocialSearchHost(result.url)
          && (sourceTextMatchesResearchSubject(input.brief.topic, candidateText, options.subjectAliases)
            || hasDistinctiveStrategyQueryOverlap(query, candidateText))
        const primaryMaterialQuery = normalizedQueryKey === primaryQueryKey
        const primaryMaterialCandidateQuery = primaryMaterialQueryKeys.has(normalizedQueryKey)
        const acceptedAsPrimaryMaterial = (primaryMaterialCandidateQuery || preferredQueryKeys.has(normalizedQueryKey))
          && isPrimaryMaterialSearchResult(input, result, options.subjectAliases)
        if (primaryMaterialQuery) {
          if (!acceptedAsPrimaryMaterial) return false
        } else if (!isRelevantSearchResult(input, result) && !acceptedByStrategy) {
          return false
        }
        const identity = normalizeSourceUrl(result.url)
        if (acceptedUrls.has(identity)) return false
        if (acceptedByStrategy) strategyAcceptedUrls.add(identity)
        if (acceptedAsPrimaryMaterial) primaryAcceptedUrls.add(identity)
        if (comparisonTarget) comparisonTargetByUrl.set(identity, comparisonTarget)
        acceptedUrls.add(identity)
        return true
      }
    }).catch((error) => {
      throwIfResearchAborted(options.signal)
      if (isFatalResearchTaskError(error)) throw error
      return []
    })
    const ranked = rankSearchResultsForResearch(input, results)
    groups.push(ranked)
    for (const result of ranked) acceptedUrls.add(normalizeSourceUrl(result.url))
  }
  const results = interleaveSearchResults(groups)
  return dedupeSeedSources([...directSeeds, ...results
    .filter((result) => isRelevantSearchResult(input, result)
      || strategyAcceptedUrls.has(normalizeSourceUrl(result.url))
      || primaryAcceptedUrls.has(normalizeSourceUrl(result.url)))
    .map((result) => ({
      url: result.url,
      title: result.title || result.url,
      publisher: result.provider,
      reliabilityReason: `由 ${result.provider} 针对 DeepResearch task 联网搜索得到，最终报告仍以抓取页面文本为准。${result.snippet ? ` 摘要：${result.snippet}` : ''}`,
      tags: [
        'web_search',
        result.provider,
        `rank_${result.rank}`,
        ...(primaryAcceptedUrls.has(normalizeSourceUrl(result.url)) ? ['primary_material_candidate'] : []),
        ...tagsForSearchResult(input, result),
        ...(comparisonTargetByUrl.get(normalizeSourceUrl(result.url))
          ? [`comparison_target:${comparisonTargetByUrl.get(normalizeSourceUrl(result.url))}`]
          : [])
      ],
      searchContent: result.snippet
    }))]).slice(0, candidateLimit)
}

function strictSourceUrlsForTask(input: ResearchTaskWorkerInput): string[] {
  return strictSourceUrlsMentionedInText([
    input.brief.topic,
    ...(input.brief.userClarifications ?? []),
    ...input.brief.constraints
  ].join('\n'))
}

function hasDistinctiveStrategyQueryOverlap(query: string, candidateText: string): boolean {
  const normalizedCandidate = candidateText.normalize('NFKC').toLowerCase()
  const terms = researchSignalTerms(query)
    .filter((term) => isDistinctiveSearchTerm(term))
    .map((term) => term.normalize('NFKC').toLowerCase())
  const hits = [...new Set(terms.filter((term) => normalizedCandidate.includes(term)))]
  if (hits.some((term) => /[0-9+#.&-]/u.test(term))) return true
  return hits.length >= 2
}

export function mergeStrategyAndFallbackQueries(
  strategyQueries: string[],
  fallbackQueries: string[],
  limit: number
): string[] {
  const safeLimit = Math.max(0, Math.floor(limit))
  if (safeLimit === 0) return []
  const normalizedStrategy = dedupeSearchQueries(strategyQueries)
  const normalizedFallback = dedupeSearchQueries(fallbackQueries)
  if (normalizedFallback.length === 0) return normalizedStrategy.slice(0, safeLimit)
  const strategyLimit = Math.max(0, safeLimit - 1)
  return dedupeSearchQueries([
    ...normalizedStrategy.slice(0, strategyLimit),
    ...normalizedFallback
  ]).slice(0, safeLimit)
}

export function directDocumentationSeedSources(input: ResearchTaskWorkerInput): SeedSource[] {
  const sourceText = [
    input.brief.topic,
    input.brief.userIntent,
    ...(input.brief.userClarifications ?? []),
    input.frame.centralQuestion,
    input.frame.coreResearchThread,
    ...input.frame.coreQuestions.filter((question) => input.task.questionIds.includes(question.id)).map((question) => question.text),
    input.task.objective,
    ...input.task.searchHints
  ].join('\n')
  const explicitUrls = [...sourceText.matchAll(/https?:\/\/[^\s<>"'）)\]}]+/giu)]
    .map((match) => match[0]?.replace(/[，。！？?；;、]+$/u, '') ?? '')
    .filter(Boolean)
    .filter((url) => isResearchSourceUrlAllowed(input.brief.sourcePolicy, url))
  return dedupeSeedSources(explicitUrls.map((url) => {
    const parsed = safeUrl(url)
    const preferred = isResearchSourceUrlPreferred(input.brief.sourcePolicy, url)
    const allowed = (input.brief.sourcePolicy.allowedDomains?.length ?? 0) > 0
    return {
      url,
      title: parsed ? `${parsed.hostname}${parsed.pathname}` : url,
      publisher: parsed?.hostname ?? 'user-provided-url',
      reliabilityReason: '由用户在研究题目、上下文或搜索提示中明确提供该 URL；最终报告仍以抓取页面正文为准。',
      tags: [
        'direct_user_url',
        ...(preferred ? ['source_preferred'] : []),
        ...(allowed ? ['source_allowed'] : [])
      ]
    }
  }))
}

export function rankSearchResultsForResearch(
  input: ResearchTaskWorkerInput,
  results: WebSearchResult[]
): WebSearchResult[] {
  return [...results].sort((left, right) => {
    const leftLowValue = isLowValueResearchUrl(left.url) ? 1 : 0
    const rightLowValue = isLowValueResearchUrl(right.url) ? 1 : 0
    const leftOfficial = tagsForSearchResult(input, left).includes('official') ? 1 : 0
    const rightOfficial = tagsForSearchResult(input, right).includes('official') ? 1 : 0
    const leftDocument = isDirectResearchDocument(left.url) ? 1 : 0
    const rightDocument = isDirectResearchDocument(right.url) ? 1 : 0
    const leftSocial = isSocialSearchHost(left.url) ? 1 : 0
    const rightSocial = isSocialSearchHost(right.url) ? 1 : 0
    return leftLowValue - rightLowValue || rightOfficial - leftOfficial || rightDocument - leftDocument || leftSocial - rightSocial || left.rank - right.rank
  })
}

function isDirectResearchDocument(value: string): boolean {
  return /\.pdf(?:$|[?#])/iu.test(value)
}

export function isLowValueResearchUrl(value: string): boolean {
  const url = safeUrl(value)
  if (!url) return true
  const path = url.pathname.replace(/\/+$/u, '') || '/'
  if (path === '/') return true
  const lastSegment = path.split('/').filter(Boolean).at(-1) ?? ''
  return /^(?:default|home|homepage|index)(?:\.[a-z0-9]+)?$/iu.test(lastSegment)
}

export function primarySourceDiscoveryQuery(
  input: ResearchTaskWorkerInput,
  subjectAliases: string[] = []
): string {
  const topic = conciseTopicAnchor(input.brief.topic)
  const externalAlias = subjectAliases.find((alias) =>
    /[a-z]/iu.test(alias) && !topic.normalize('NFKC').toLowerCase().includes(alias.normalize('NFKC').toLowerCase())
  )
  const subject = externalAlias || topic
  return normalizeSearchQuery(/\p{Script=Han}/u.test(subject)
    ? `${subject} 官方 原始资料 PDF 文档`
    : `${subject} latest official primary source PDF document`)
}

export function isPrimaryMaterialSearchResult(
  input: ResearchTaskWorkerInput,
  result: WebSearchResult,
  subjectAliases: string[] = []
): boolean {
  if (!result.url || result.rank > 5 || isLowValueResearchUrl(result.url) || isSocialSearchHost(result.url)) return false
  const candidateText = `${result.title}\n${result.snippet}\n${result.url}`
  if (!sourceTextMatchesResearchSubject(input.brief.topic, candidateText, subjectAliases)) return false
  const tags = tagsForSearchResult(input, result)
  if (tags.some((tag) => ['official', 'source_preferred', 'source_allowed'].includes(tag))) return true
  const path = safeUrl(result.url)?.pathname.toLowerCase() ?? ''
  if (/(?:^|\/)(?:news|article|articles|blog|blogs|press)(?:\/|$)|\/stocks\/news\//iu.test(path)) return false
  const documentPath = /(?:^|\/)(?:docs?|documentation|reference|standards?|specifications?|reports?|publications?|data|datasets?|resources?|archive)(?:\/|[-_.]|$)/iu.test(path)
  const documentLabel = /(?:official|primary|original|reference|formal)[\s_-]+(?:report|source|data|documentation|publication|document)|(?:official[\s_-]+)?(?:documentation|standard|specification|framework|guidance|dataset|rules?|regulations?|filings?|annual[\s_-]+reports?|statistics?)|正式发布|原始资料|官方报告|官方文档|标准|规范|框架|指南|数据集|规则|条例|年度报告|统计资料/iu.test(candidateText)
  return documentLabel && (documentPath || isDirectResearchDocument(result.url))
}

export function searchQueryLimitForTask(input: ResearchTaskWorkerInput): number {
  return Math.min(WEB_SEARCH_QUERY_LIMIT, Math.max(2, input.task.maxSources + 1))
}

export async function searchOneQuery(
  query: string,
  options: {
    provider: WebProvider
    nowIso: () => string
    timeRange?: SearchTimeRange
    timeoutMs: number
    signal?: AbortSignal
    execution?: ResearchTaskWorkerInput['execution']
    taskId?: string
    allowFallbackOnly?: boolean
    resultLimit?: number
    acceptedResultLimit?: number
    acceptResult?: (result: WebSearchResult) => boolean
  }
): Promise<WebSearchResult[]> {
  const controller = new AbortController()
  const unlinkAbort = linkResearchAbortSignal(options.signal, controller)
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  const providerAttempts: WebSearchProviderAttempt[] = []
  try {
    const searchReservations = new Map<string, ResearchModelCallReservation>()
    const request: WebSearchRequest = {
      query,
      limit: options.resultLimit ?? WEB_SEARCH_RESULTS_PER_QUERY,
      ...(options.acceptedResultLimit ? { acceptedLimit: options.acceptedResultLimit } : {}),
      ...(typeof options.allowFallbackOnly === 'boolean' ? { allowFallbackOnly: options.allowFallbackOnly } : {}),
      timeoutMs: options.timeoutMs,
      ...(options.timeRange ? { timeRange: options.timeRange } : {}),
      signal: controller.signal,
      onProviderAttempt: (attempt) => providerAttempts.push(attempt),
      ...(options.execution ? {
        modelExecution: {
          canReserve: (input) => options.execution!.canReserveModelCall('web_search', input.estimatedTokens),
          reserve: (input) => {
            const reservation = options.execution!.reserveModelCall('web_search', input.estimatedTokens)
            searchReservations.set(reservation.id, reservation)
            return { id: reservation.id }
          },
          record: async (input) => {
            const reservation = searchReservations.get(input.reservation.id)
            if (!reservation) return
            await options.execution!.recordModelUsage({
              stage: 'web_search',
              model: input.model,
              turnId: reservation.id,
              ...(options.taskId ? { taskId: options.taskId } : {}),
              usage: input.usage
            }, reservation)
          },
          finish: async (input) => {
            const reservation = searchReservations.get(input.reservation.id)
            if (!reservation) return
            searchReservations.delete(reservation.id)
            await options.execution!.finishModelCall(reservation, {
              chargeEstimateOnMissing: input.chargeEstimateOnMissing
            })
          }
        }
      } : {})
    }
    const filteredProvider = options.provider as WebProvider & {
      searchFiltered?: (request: WebSearchRequest, accept: (result: WebSearchResult) => boolean) => Promise<WebSearchResult[]>
    }
    if (filteredProvider.searchFiltered && options.acceptResult) {
      const results = await filteredProvider.searchFiltered(request, options.acceptResult)
      await recordSearchAttempts(options, query, providerAttempts, results.length)
      return results
    }
    const results = await options.provider.search?.(request) ?? []
    const accepted = options.acceptResult ? results.filter(options.acceptResult) : results
    if (providerAttempts.length === 0) {
      providerAttempts.push({
        providerId: options.provider.id,
        rawResultCount: results.length,
        acceptedResultCount: accepted.length
      })
    }
    await recordSearchAttempts(options, query, providerAttempts, accepted.length)
    return accepted
  } catch (error) {
    if (providerAttempts.length === 0) {
      providerAttempts.push({
        providerId: options.provider.id,
        rawResultCount: 0,
        acceptedResultCount: 0,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    await recordSearchAttempts(options, query, providerAttempts, 0)
    throw error
  } finally {
    clearTimeout(timeout)
    unlinkAbort()
  }
}

async function recordSearchAttempts(
  options: Parameters<typeof searchOneQuery>[1],
  query: string,
  attempts: WebSearchProviderAttempt[],
  acceptedTotal: number
): Promise<void> {
  if (!options.execution || !options.taskId) return
  for (const attempt of attempts) {
    await options.execution.recordWebAudit({
      taskId: options.taskId,
      phase: 'search',
      status: attempt.error
        ? 'failed'
        : attempt.acceptedResultCount > 0
          ? 'success'
          : attempt.rawResultCount > 0
            ? 'filtered'
            : 'empty',
      provider: attempt.providerId,
      query,
      rawResultCount: attempt.rawResultCount,
      acceptedResultCount: attempt.acceptedResultCount,
      ...(attempt.error ? { error: attempt.error } : {})
    })
  }
  if (attempts.length === 0) {
    await options.execution.recordWebAudit({
      taskId: options.taskId,
      phase: 'search',
      status: acceptedTotal > 0 ? 'success' : 'empty',
      provider: options.provider.id,
      query,
      rawResultCount: acceptedTotal,
      acceptedResultCount: acceptedTotal
    })
  }
}

type SearchTimeRange = {
  startDate: string
  endDate: string
  defaulted: boolean
}

export function buildSearchQueries(input: ResearchTaskWorkerInput, timeRange?: SearchTimeRange): string[] {
  const questionById = new Map(input.frame.coreQuestions.map((question) => [question.id, question]))
  const coreQuestionTexts = researchQuestionIdsForTask(input)
    .map((questionId) => questionById.get(questionId)?.text)
    .filter((text): text is string => Boolean(text))
  const focusedQuestion = coreQuestionTexts[0] ?? input.task.objective
  const focusedQuery = focusedQuestion.match(/^在「(.+?)」维度/u)?.[1]?.trim() || focusedQuestion
  const anchoredFocusedQuery = topicAnchoredFocusedQuery(input, focusedQuery)
  const asciiFallbackQuery = asciiTechnicalFallbackQuery(input, focusedQuery)
  const bilingualQuery = bilingualOfficialSearchQuery(input)
  const bilingualSupplemental = bilingualSupplementalSearchQueries(bilingualQuery)
  const comparisonQueries = comparisonTargetOfficialQueries(input)
  const conciseQueries = conciseResearchQueries(input, focusedQuery)
  const focusedSubjectQueries = focusedSubjectSearchQueries(input, focusedQuery)
  const prioritizeConciseQueries = shouldPrioritizeConciseQueries(input, focusedQuestion)
  const directComparison = isDirectComparisonResearch(input)
  const taskComparisonTargets = comparisonTargetsForTask(input)
  const targetedComparisonRepair = (input.task.comparisonTargets?.length ?? 0) > 0
  const benchmarkComparison = taskComparisonTargets.length > 0 && !directComparison
  const hasAllowedDomains = (input.brief.sourcePolicy.allowedDomains?.length ?? 0) > 0
  const regularCandidates = [
    ...highPriorityTaskQueries(input),
    ...(prioritizeConciseQueries ? conciseQueries : []),
    ...(!hasAllowedDomains && benchmarkComparison ? focusedSubjectQueries : []),
    ...sourcePolicySiteQueries(input.brief.sourcePolicy, anchoredFocusedQuery),
    ...sourcePolicySiteQueries(input.brief.sourcePolicy, asciiFallbackQuery),
    ...sourcePolicySiteQueries(input.brief.sourcePolicy, focusedQuery),
    ...sourcePolicySiteQueries(input.brief.sourcePolicy, input.brief.topic),
    ...(directComparison || benchmarkComparison ? comparisonQueries : []),
    bilingualQuery,
    ...bilingualSupplemental,
    ...priorityOfficialSearchQueries(input, anchoredFocusedQuery),
    ...(directComparison ? focusedSubjectQueries : []),
    ...taskComparisonTargets.map((target) => `${target} ${input.task.objective} official source`),
    ...input.task.searchHints,
    input.task.objective,
    ...coreQuestionTexts,
    `${input.brief.topic} ${input.task.expectedEvidence.join(' ')}`,
    `${input.brief.topic} 官方 数据 报告`
  ]
  const targetedRepairFocus = `${taskComparisonTargets.join(' ')} ${focusedQuery}`.trim()
  const candidates = targetedComparisonRepair
    ? [
        ...highPriorityTaskQueries(input),
        ...sourcePolicySiteQueries(input.brief.sourcePolicy, targetedRepairFocus),
        ...comparisonQueries,
        bilingualQuery,
        ...bilingualSupplemental,
        ...priorityOfficialSearchQueries(input, targetedRepairFocus)
      ]
    : regularCandidates
  const seen = new Set<string>()
  return candidates
    .map(normalizeSearchQuery)
    .map((query) => applySearchTimeRange(query, timeRange))
    .filter((query) => {
      if (!query || query.length < 4) return false
      const key = query.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function shouldPrioritizeConciseQueries(input: ResearchTaskWorkerInput, focusedQuestion: string): boolean {
  if ((input.brief.sourcePolicy.allowedDomains?.length ?? 0) > 0) return false
  return focusedQuestion.length > 96 || /核心矛盾在于|如何定义.+(?:形成|得出|判断)|综合.+(?:形成|得出).+判断/u.test(focusedQuestion)
}

function conciseResearchQueries(input: ResearchTaskWorkerInput, focusedQuery: string): string[] {
  const topic = conciseTopicAnchor(input.brief.topic)
  const targets = comparisonTargetsForTask(input)
    .map((target) => target.trim())
    .filter(Boolean)
    .slice(0, 4)
  const focusTerms = researchSignalTerms(focusedQuery)
    .filter((term) => isDistinctiveSearchTerm(term))
    .filter((term) => !topic.toLowerCase().includes(term.toLowerCase()))
    .slice(0, 4)
  return [
    `${topic} 官方 统计`,
    targets.length >= 2
      ? `${targets.join(' ')} ${topic} 官方 数据`
      : `${topic} 权威 数据 报告`,
    `${topic} ${focusTerms.join(' ')} official statistics`
  ].map((query) => query.replace(/\s+/gu, ' ').trim()).filter((query) => query.length >= 4)
}

function highPriorityTaskQueries(input: ResearchTaskWorkerInput): string[] {
  const repairLabel = input.task.objective.match(/硬性范围项「([^」]+)」/u)?.[1]?.trim()
  if (repairLabel) {
    return [
      ...focusedSubjectSearchQueries(input, repairLabel),
      `${input.brief.topic} ${repairLabel} official source data`,
      `${repairLabel} ${primaryQuestionText(input)} official report data`
    ]
  }
  const comparisonRepairTarget = (input.task.comparisonTargets?.length ?? 0) > 0
    ? comparisonTargetsForTask(input)[0]
    : input.task.objective.match(/对比对象「([^」]+)」/u)?.[1]?.trim()
  if (comparisonRepairTarget) {
    const alias = comparisonTargetAliases(comparisonRepairTarget)
      .find((value) => /^[A-Za-z]{2,}(?:\s+[A-Za-z]+)*$/u.test(value)) ?? comparisonRepairTarget
    const focus = primaryQuestionText(input).match(/^在「(.+?)」维度/u)?.[1]?.trim()
      ?? primaryQuestionText(input)
    return [
      `${alias} ${focus} official source data`,
      `${comparisonRepairTarget} ${focus} 官方 数据 报告`
    ]
  }
  const researchQuestionIds = researchQuestionIdsForTask(input)
  if (researchQuestionIds.length <= 1) return []
  const questionById = new Map(input.frame.coreQuestions.map((question) => [question.id, question.text]))
  const questionTexts = researchQuestionIds
    .map((questionId) => questionById.get(questionId))
    .filter((text): text is string => Boolean(text))
    .sort((left, right) => Number(/^在「/u.test(right)) - Number(/^在「/u.test(left)))
  return [...new Set(questionTexts.map((question) => (
    `${input.brief.topic} ${question.match(/^在「(.+?)」维度/u)?.[1]?.trim() || question} official source data`
  )))]
}

function comparisonTargetOfficialQueries(input: ResearchTaskWorkerInput): string[] {
  const primaryQuestion = primaryQuestionText(input)
  const focusedQuery = primaryQuestion.match(/^在「(.+?)」维度/u)?.[1]?.trim() || primaryQuestion
  if (isDirectComparisonResearch(input)) {
    const focusWithoutTargets = stripComparisonTargets(focusedQuery, input.frame.alternativesToCompare ?? [])
    const focusTerms = conciseFocusTerms(focusWithoutTargets).slice(0, 4)
    const conciseFocus = focusTerms.join(' ') || conciseTopicAnchor(focusWithoutTargets)
    return comparisonTargetsForTask(input).map((target) => {
      const alias = comparisonTargetAliases(target).find((value) => /^[A-Za-z]{3,}(?:\s+[A-Za-z]+)*$/u.test(value)) ?? target
      return `${alias} ${conciseFocus} official source data`
    })
  }
  const topic = conciseTopicAnchor(input.brief.topic)
  const focusTerms = conciseFocusTerms(focusedQuery).slice(0, 2)
  return comparisonTargetsForTask(input).map((target) => {
    const alias = comparisonTargetAliases(target).find((value) => /^[A-Za-z]{3,}(?:\s+[A-Za-z]+)*$/u.test(value)) ?? target
    return `${alias} ${topic} ${focusTerms.join(' ')} ${localizedOfficialTerm(`${topic} ${focusedQuery}`)}`
  })
}

function stripComparisonTargets(value: string, targets: string[]): string {
  return targets
    .flatMap(comparisonTargetAliases)
    .sort((left, right) => right.length - left.length)
    .reduce((text, target) => {
      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/gu, '\\s*')
      return text.replace(new RegExp(escaped, 'giu'), ' ')
    }, value)
    .replace(/\s+/gu, ' ')
    .trim()
}

function primaryQuestionText(input: ResearchTaskWorkerInput): string {
  const primaryQuestionId = researchQuestionIdsForTask(input)[0]
  return input.frame.coreQuestions.find((question) => question.id === primaryQuestionId)?.text
    ?? input.task.objective
}

function researchQuestionIdsForTask(input: ResearchTaskWorkerInput): string[] {
  if (input.task.reportQuestionIds?.length) return input.task.reportQuestionIds
  const legacyReportQuestionIds = (input.task.reportSectionIds ?? [])
    .filter((questionId) => input.task.questionIds.includes(questionId))
  return legacyReportQuestionIds.length > 0 ? legacyReportQuestionIds : input.task.questionIds
}

export function bilingualOfficialSearchQuery(input: ResearchTaskWorkerInput): string {
  const sourceText = [
    input.brief.topic,
    input.brief.userIntent,
    ...(input.brief.userClarifications ?? []),
    input.frame.centralQuestion,
    input.frame.coreResearchThread,
    ...input.frame.coreQuestions.filter((question) => input.task.questionIds.includes(question.id)).map((question) => question.text),
    input.task.objective,
    ...comparisonTargetsForTask(input)
  ].join('\n')
  const explicitAliases = extractExplicitBilingualTerms(sourceText)
  if (explicitAliases.length === 0) return ''
  const focusText = primaryQuestionText(input).match(/^在「(.+?)」维度/u)?.[1]?.trim()
    ?? primaryQuestionText(input)
  const focusedTerms = extractExplicitBilingualTerms(`${focusText}\n${input.task.objective}`)
  const anchors = topicTechnicalAnchors(input)
  return `${[...new Set([...explicitAliases, ...focusedTerms, ...anchors])].slice(0, 12).join(' ')} official primary source report data`.trim()
}

function comparisonTargetsForTask(input: ResearchTaskWorkerInput): string[] {
  const frameTargets = input.frame.alternativesToCompare ?? []
  const requested = input.task.comparisonTargets ?? []
  if (requested.length === 0) return frameTargets
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#.&]+/gu, '')
  const allowed = new Set(frameTargets.map(normalize))
  return requested.filter((target) => allowed.has(normalize(target)))
}

function bilingualSupplementalSearchQueries(primaryQuery: string): string[] {
  if (!primaryQuery) return []
  const terms = primaryQuery.replace(/\s+official primary source report data$/iu, '').trim()
  if (!terms) return []
  return [
    `${terms} primary source evidence`,
    `${terms} official statistics methodology`
  ]
}

function extractExplicitBilingualTerms(text: string): string[] {
  const terms: string[] = []
  for (const match of text.normalize('NFKC').matchAll(/([\p{Script=Han}]{2,24})\s*\(([A-Za-z][A-Za-z0-9+#.& -]{1,50})\)/gu)) {
    terms.push(match[2]?.trim() ?? '', nearestChineseTerm(match[1] ?? ''))
  }
  for (const match of text.normalize('NFKC').matchAll(/([A-Za-z][A-Za-z0-9+#.& -]{1,50})\s*\(([\p{Script=Han}]{2,24})\)/gu)) {
    terms.push(match[1]?.trim() ?? '', nearestChineseTerm(match[2] ?? ''))
  }
  return [...new Set(terms.map((term) => term.trim()).filter((term) => term.length >= 2))]
}

function nearestChineseTerm(value: string): string {
  const normalized = value.trim()
  return normalized.length <= 12 ? normalized : normalized.slice(-12)
}

function topicAnchoredFocusedQuery(input: ResearchTaskWorkerInput, focusedQuery: string): string {
  const uniqueAnchors = topicTechnicalAnchors(input)
  if (uniqueAnchors.length > 0) return `${focusedQuery} ${uniqueAnchors.join(' ')}`
  if ((input.brief.sourcePolicy.allowedDomains?.length ?? 0) > 0) return focusedQuery
  const topic = conciseTopicAnchor(input.brief.topic)
  return normalizeSearchQuery(`${topic} ${focusedQuery}`)
}

function asciiTechnicalFallbackQuery(input: ResearchTaskWorkerInput, focusedQuery: string): string {
  const focusedTerms = [...focusedQuery.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\b/g)]
    .map((match) => match[0])
    .filter((token) => token.length >= 3)
  const terms = [...new Set([...focusedTerms, ...topicTechnicalAnchors(input)])].slice(0, 8)
  return terms.join(' ') || focusedQuery
}

function topicTechnicalAnchors(input: ResearchTaskWorkerInput): string[] {
  const genericTokens = new Set(['official', 'source', 'report', 'research', 'latest'])
  const anchors = [...input.brief.topic.matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\b/g)]
    .map((match) => match[0])
    .filter((token) => token.length >= 2 && token.length <= 40)
    .filter((token) => /[A-Z0-9-]/.test(token))
    .filter((token) => !genericTokens.has(token.toLowerCase()))
  return [...new Set(anchors)].slice(0, 5)
}

export function priorityOfficialSearchQueries(input: ResearchTaskWorkerInput, focusedQuery = input.brief.topic): string[] {
  const sourceText = [
    input.brief.topic,
    input.brief.userIntent,
    ...(input.brief.userClarifications ?? []),
    input.frame.coreResearchThread,
    input.frame.centralQuestion,
    input.task.objective
  ].join('\n')
  const namedChineseDocuments = [...sourceText.matchAll(/《([^》]{4,80})》/g)]
    .map((match) => match[1]?.trim())
    .filter((title): title is string => Boolean(title))
    .map((title) => `${title} 官方`)
  return [...new Set([
    `${focusedQuery} 官方`,
    ...(namedChineseDocuments.length > 0 ? [`${input.brief.topic} 官方`] : []),
    ...namedChineseDocuments
  ].map((query) => query.trim()).filter(Boolean))]
}

export function interleaveSearchResults(groups: WebSearchResult[][]): WebSearchResult[] {
  const results: WebSearchResult[] = []
  const maxGroupLength = Math.max(0, ...groups.map((group) => group.length))
  for (let resultIndex = 0; resultIndex < maxGroupLength; resultIndex += 1) {
    for (const group of groups) {
      const result = group[resultIndex]
      if (result) results.push(result)
    }
  }
  return results
}

export function normalizeSearchQuery(value: string): string {
  const normalized = value
    .replace(/^调研[:：]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length <= 160) return normalized
  const siteSuffix = normalized.match(/\s(site:[^\s]+)$/iu)?.[1]
  if (!siteSuffix) return normalized.slice(0, 160).trim()
  const prefixLimit = Math.max(4, 159 - siteSuffix.length)
  return `${normalized.slice(0, prefixLimit).trim()} ${siteSuffix}`
}

function dedupeSearchQueries(values: string[]): string[] {
  const seen = new Set<string>()
  return values
    .map(normalizeSearchQuery)
    .filter((query) => {
      if (query.length < 4) return false
      const key = query.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function defaultSearchTimeRange(input: ResearchTaskWorkerInput, nowIso: string): SearchTimeRange | undefined {
  const text = [input.brief.topic, ...(input.brief.userClarifications ?? [])].join('\n').toLowerCase()
  if (/不限时间|不限制时间|全历史|历史全周期|all\s+time|no\s+time\s+limit/i.test(text)) return undefined
  const explicitYears = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => Number(match[1]))
  if (explicitYears.length > 0) {
    const first = Math.min(...explicitYears)
    const last = Math.max(...explicitYears)
    return { startDate: `${first}-01-01`, endDate: `${last}-12-31`, defaulted: false }
  }
  const relativeYears = relativeYearCount(text)
  if (relativeYears > 0) return rollingYearRange(nowIso, relativeYears, false)
  if (/当前|最新|近期|今年|本年|current|latest|recent|today|news/i.test(text)) {
    return rollingYearRange(nowIso, 1, false)
  }
  return undefined
}

export function applySearchTimeRange(query: string, timeRange: SearchTimeRange | undefined): string {
  void timeRange
  return query
}

export function hasExplicitSearchTimeScope(text: string): boolean {
  return /(?:19|20)\d{2}|after:|before:|\bsince\b|\bfrom\b|\bto\b|最近|近\s*\d+|近[一二三四五六七八九十]+|过去|今年|去年|本年|当前|最新|历史演变|未来趋势|以来|至今|时间范围|不限时间|特定历史时期|current|latest|past\s+\d+|last\s+\d+|year|month|quarter|date/i.test(text)
}

function rollingYearRange(nowIso: string, years: number, defaulted: boolean): SearchTimeRange | undefined {
  const endDate = isoDate(nowIso)
  const start = new Date(`${endDate}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) return undefined
  start.setUTCFullYear(start.getUTCFullYear() - Math.max(1, years))
  return { startDate: isoDate(start.toISOString()), endDate, defaulted }
}

function relativeYearCount(text: string): number {
  const arabic = text.match(/(?:最近|近|过去|past|last)\s*(\d+)\s*(?:年|years?)/i)?.[1]
  if (arabic) return Math.max(1, Math.min(20, Number(arabic)))
  if (/(?:最近|近|过去)\s*(?:一|1)\s*年|past\s+year|last\s+year/i.test(text)) return 1
  if (/(?:最近|近|过去)\s*(?:两|二|2)\s*年/i.test(text)) return 2
  if (/(?:最近|近|过去)\s*(?:三|3)\s*年/i.test(text)) return 3
  return 0
}

export function isoDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  return date.toISOString().slice(0, 10)
}

export function isRelevantSearchResult(input: ResearchTaskWorkerInput, result: WebSearchResult): boolean {
  if (!isResearchSourceCandidateAllowed(input.brief.sourcePolicy, result)) return false
  const candidateUrl = safeUrl(result.url)
  const candidateText = `${result.title}\n${result.snippet}\n${candidateUrl ? `${candidateUrl.hostname}${candidateUrl.pathname}` : result.url}`
  if (!result.url || (!result.title && !result.snippet)) return false
  const coreResearchText = coreResearchRelevanceText(input)
  if (isResearchTextRelevant(coreResearchText, candidateText)
    && isResearchTextRelevant(researchRelevanceText(input), candidateText)
    && hasFocusedSearchOverlap(input, candidateText)) {
    return true
  }
  return isCrossLanguageTopSearchResult(coreResearchText, candidateText, result)
}

function hasFocusedSearchOverlap(input: ResearchTaskWorkerInput, candidateText: string): boolean {
  const focusedText = [
    primaryQuestionText(input),
    input.task.objective,
    ...input.task.expectedEvidence,
    ...input.task.searchHints
  ].join('\n')
  const normalizedCandidate = candidateText.normalize('NFKC').toLowerCase()
  const terms = researchSignalTerms(focusedText).filter((term) => isDistinctiveSearchTerm(term))
  const hits = terms.filter((term) => normalizedCandidate.includes(term.normalize('NFKC').toLowerCase()))
  return hits.length >= 1
}

function isDistinctiveSearchTerm(term: string): boolean {
  const normalized = term.normalize('NFKC').toLowerCase()
  if (GENERIC_SEARCH_CONCEPTS.has(normalized)) return false
  if (/\p{Script=Han}/u.test(term)) return term.length >= 3
  if (/[0-9+#.&-]/u.test(term)) return true
  if (/^[A-Z]{4,}$/u.test(term)) return true
  return /^[A-Za-z]{5,}$/u.test(term)
}

const GENERIC_SEARCH_CONCEPTS = new Set([
  'validation', 'resource', 'resources', 'application', 'applications', 'result', 'results',
  'performance', 'process', 'method', 'strategy', 'system', 'model', 'official', 'documentation'
])

function isCrossLanguageTopSearchResult(researchText: string, candidateText: string, result: WebSearchResult): boolean {
  const researchHasHan = /\p{Script=Han}/u.test(researchText)
  const candidateHasHan = /\p{Script=Han}/u.test(candidateText)
  const researchHasLatin = /[A-Za-z]{3,}/u.test(researchText)
  const candidateHasLatin = /[A-Za-z]{3,}/u.test(candidateText)
  const scriptMismatch = (researchHasHan && candidateHasLatin && !candidateHasHan)
    || (researchHasLatin && candidateHasHan && !researchHasHan)
  if (!scriptMismatch || result.rank > 2) return false
  if (isLowValueResearchUrl(result.url) || isSocialSearchHost(result.url)) return false
  if (`${result.title} ${result.snippet}`.replace(/\s+/g, ' ').trim().length < 24) return false
  const namedLatinAnchors = researchSignalTerms(researchText)
    .filter((term) => /[0-9+#.&-]/u.test(term) || /^[A-Z][A-Za-z]{2,}$/u.test(term) || /^[A-Z0-9]{2,}$/u.test(term))
  if (namedLatinAnchors.length > 0) {
    const normalizedCandidate = candidateText.normalize('NFKC').toLowerCase()
    return namedLatinAnchors.some((anchor) => normalizedCandidate.includes(anchor.normalize('NFKC').toLowerCase()))
  }
  // A rank is not an identity check. Without a shared entity anchor, accepting
  // a foreign-language top result can fetch an entirely different subject.
  return false
}

export function researchRelevanceText(input: ResearchTaskWorkerInput): string {
  return [
    input.brief.topic,
    ...(input.brief.userClarifications ?? []),
    input.frame.centralQuestion,
    ...input.frame.coreQuestions.filter((question) => input.task.questionIds.includes(question.id)).map((question) => question.text),
    input.task.objective,
    ...input.task.expectedEvidence,
    ...input.task.searchHints
  ].join('\n')
}

export function coreResearchRelevanceText(input: ResearchTaskWorkerInput): string {
  const targets = extractComparisonTargets([
    input.brief.topic,
    input.frame.centralQuestion,
    input.frame.coreResearchThread
  ].join('\n'), comparisonTargetsForTask(input))
  return [
    input.frame.centralQuestion,
    input.frame.coreResearchThread,
    input.task.objective,
    ...input.task.expectedEvidence,
    ...input.task.searchHints,
    ...(targets.length >= 2 ? [`比较 ${targets.join(' 与 ')}`] : [])
  ].join('\n')
}

export function tagsForSearchResult(input: ResearchTaskWorkerInput, result: WebSearchResult): string[] {
  const tags: string[] = []
  const url = safeUrl(result.url)
  const host = url?.hostname.replace(/^www\./, '').toLowerCase() ?? ''
  const preferred = isResearchSourceUrlPreferred(input.brief.sourcePolicy, result.url)
  if (preferred) tags.push('source_preferred')
  if ((input.brief.sourcePolicy.allowedDomains?.length ?? 0) > 0 && isResearchSourceUrlAllowed(input.brief.sourcePolicy, result.url)) {
    tags.push('source_allowed')
  }
  if (isAuthoritativeInstitutionHost(host) || preferred) tags.push('official')
  return [...new Set(tags)]
}

export function isAuthoritativeInstitutionHost(host: string): boolean {
  return /(?:^|\.)gov(?:\.[a-z]{2})?$/.test(host)
    || /(?:^|\.)edu(?:\.[a-z]{2})?$/.test(host)
    || /(?:^|\.)ac\.[a-z]{2}$/.test(host)
    || /(?:^|\.)int$/.test(host)
}

function isSocialSearchHost(value: string): boolean {
  const host = safeUrl(value)?.hostname.replace(/^www\./u, '').toLowerCase() ?? ''
  return ['x.com', 'twitter.com', 'reddit.com', 'youtube.com', 'facebook.com', 'instagram.com', 'tiktok.com']
    .some((domain) => host === domain || host.endsWith(`.${domain}`))
}

export function extractionCardLimit(input: ResearchTaskWorkerInput, _fetchedSourceCount: number): number {
  const base = Math.max(1, input.task.maxSources)
  return Math.min(base * 3, WEB_RESEARCH_SOURCE_LIMIT)
}

export function safeUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

export function dedupeSeedSources(seeds: SeedSource[]): SeedSource[] {
  const seen = new Set<string>()
  return seeds.filter((seed) => {
    if (seen.has(seed.url)) return false
    seen.add(seed.url)
    return true
  })
}
