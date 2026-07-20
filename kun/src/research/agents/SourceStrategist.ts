/**
 * [INPUT]: 依赖 ModelClient、ResearchTaskWorkerInput、运行级模型选择与预算记账
 * [OUTPUT]: 对外提供领域无关且服从当前日期/用户时间范围的 ResearchSourceStrategist、BasicSourceStrategist、ModelSourceStrategist、可声明精确 comparisonTarget 所有权并在模型漏填时按 task 定向对象或 Frame 顺序补齐的查询策略、按发布责任主体寻找一手材料的查询、可用于主材料发现且格式受限的跨语言主体别名、容错解析且可逐项核验的动态分面证据标记组、缺失标记的查询词补全和查询策略 prompt
 * [POS]: research/agents 的来源策略子代理，只读取 task 实际拥有的章节问题与定向补研对象并决定该搜什么、每条比较查询负责哪个用户命名对象、原始材料中哪些可观察短语能直接证明当前分面、如何识别一手材料；对象所有权只能精确复制 Frame，不执行搜索、不判断具体证据内容
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest } from '../../ports/model-client.js'
import { linkResearchAbortSignal, throwIfResearchAborted } from '../core/abort.js'
import { hashText } from '../core/hash.js'
import { estimateResearchRequestTokens } from '../core/token-estimate.js'
import type { ResearchModelUsageRecord } from '../core/types.js'
import { collectWriterText } from './SynthesisWriterSupport.js'
import type { ResearchTaskWorkerInput } from './types.js'

const SOURCE_STRATEGY_TIMEOUT_MS = 60_000

export type ResearchSourceQuery = {
  query: string
  purpose: string
  authorityCriteria: string
  comparisonTarget?: string
}

export type ResearchSourceStrategy = {
  queries: ResearchSourceQuery[]
  rationale: string
  subjectAliases?: string[]
  focusAliasGroups?: string[][]
  modelUsage?: ResearchModelUsageRecord[]
}

export type ResearchSourceStrategist = {
  design(input: ResearchTaskWorkerInput): Promise<ResearchSourceStrategy>
}

export const MODEL_SOURCE_STRATEGIST_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的来源策略子代理。你只设计搜索策略，不回答研究问题。',
  '根据用户题目和当前 task 动态判断最可能改变结论的一手材料、原始数据、反证或对比材料；核心代码没有任何题材词典。',
  '查询必须短、可直接交给普通搜索引擎，并包含研究主体与当前分面。不要把整段问题、内部流程词或写作要求塞进查询。',
  '第一条查询必须寻找一份可能同时覆盖多个当前分面的原始或官方主材料；材料类型由题目动态推断，禁止套用固定行业规则。',
  '第一条查询只能包含研究主体、必要时间、推断出的主材料名称或文件格式，禁止加入任何当前章节分面词；第二、三条才用于补当前分面。',
  '第二、三条不能只在查询末尾追加“官方/official”。应动态识别最可能负责发布当前事实、规则或统计的原始发布主体，并把该主体名称与当前分面写入查询；发布主体由当前题目推断，禁止维护题材或域名词典。',
  '比较多个对象时，queries 前 N 条必须按 alternativesToCompare 的原顺序分别寻找前 N 个对象自己的原始材料，不能只搜索第三方写成的对象对比文章。',
  '上述逐对象查询的 comparisonTarget 是必填字段，必须逐字复制对应 alternativesToCompare 值；跨对象主材料查询才省略该字段。',
  '当前日期会显式提供。查询中的时间必须服从用户时间范围；用户要了解当前状态而未指定历史年份时，不得凭模型记忆选择旧年份，应使用“最新/current/latest”或当前日期下最近的完整周期。',
  '识别研究主体的常用外文名、全称或缩写，写入 subjectAliases。若存在外文名，第一条主材料查询必须使用该外文名，并用同一种语言描述材料类型；无法可靠识别时返回空数组。',
  '把当前问题中的每个并列分面分别写成 focusAliasGroups。它不是同义词表：除分面原词和等价表达外，还要给出原始材料中可能逐字出现、能够直接证明该分面的可观察指标、机制、事件或结果短语。',
  '抽象评价分面不得只复述问题标题；应把它翻译成可从来源正文直接观察的证据标记。每个标记单独命中时都必须足以支持当前分面中的一句事实，不能依赖模型常识补全。',
  '证据标记必须包含必要的状态、变化、关系或结果限定，禁止只写主体名、宽泛对象名、研究动作、原因/结果占位词，也禁止混入另一个章节独有的概念。',
  'focusAliasGroups 仅用于定位和准入候选原文；它不能把相关但不回答当前问题的材料变成证据。禁止加入题材固定词表。',
  'authorityCriteria 描述如何从来源正文确认它是一手或权威材料，不能仅说“看起来官方”。',
  '输出严格 JSON，不要 Markdown。'
].join('\n')

export class BasicSourceStrategist implements ResearchSourceStrategist {
  async design(input: ResearchTaskWorkerInput): Promise<ResearchSourceStrategy> {
    const queries = [input.brief.topic, ...input.task.searchHints, input.task.objective]
      .map((query) => query.replace(/\s+/gu, ' ').trim())
      .filter((query, index, values) => query.length >= 4 && values.indexOf(query) === index)
      .slice(0, 3)
      .map((query) => ({ query, purpose: '覆盖当前研究任务', authorityCriteria: '抓取正文后核对发布者身份和原始事实' }))
    return { queries, rationale: '使用已确认 brief 与 task 的领域无关查询提示。' }
  }
}

export class ModelSourceStrategist implements ResearchSourceStrategist {
  private readonly fallback: ResearchSourceStrategist

  constructor(private readonly options: {
    modelClient: ModelClient
    model: string
    timeoutMs?: number
    fallback?: ResearchSourceStrategist
  }) {
    this.fallback = options.fallback ?? new BasicSourceStrategist()
  }

  async design(input: ResearchTaskWorkerInput): Promise<ResearchSourceStrategy> {
    if (input.budget.preset === 'quick') return this.fallback.design(input)
    try {
      return await this.designWithModel(input)
    } catch (error) {
      throwIfResearchAborted(input.execution?.signal)
      return this.fallback.design(input)
    }
  }

  private async designWithModel(input: ResearchTaskWorkerInput): Promise<ResearchSourceStrategy> {
    throwIfResearchAborted(input.execution?.signal)
    const controller = new AbortController()
    const unlinkAbort = linkResearchAbortSignal(input.execution?.signal, controller)
    const timeout = setTimeout(() => controller.abort(), Math.max(1, this.options.timeoutMs ?? SOURCE_STRATEGY_TIMEOUT_MS))
    const model = input.execution?.model?.trim() || this.options.model
    const providerId = input.execution?.providerId?.trim()
    const prompt = buildSourceStrategyPrompt(input)
    const maxTokens = 1_200
    const turnId = `research_source_strategy_${hashText(`${input.runId}:${input.task.id}:${input.task.objective}`).slice(0, 12)}`
    const reservation = input.execution?.reserveModelCall(
      'source_strategy',
      estimateResearchRequestTokens(`${MODEL_SOURCE_STRATEGIST_SYSTEM_PROMPT}\n${prompt}`, maxTokens)
    )
    const observedUsage: ResearchModelUsageRecord['usage'][] = []
    let usageRecorded = false
    try {
      const request: ModelRequest = {
        threadId: 'research_source_strategist',
        turnId,
        model,
        ...(providerId ? { providerId } : {}),
        systemPrompt: MODEL_SOURCE_STRATEGIST_SYSTEM_PROMPT,
        prefix: [],
        history: [makeUserItem({ id: `item_${turnId}_user`, threadId: 'research_source_strategist', turnId, text: prompt })],
        tools: [],
        stream: false,
        maxTokens,
        temperature: 0.1,
        responseFormat: 'json_object',
        reasoningEffort: 'off',
        abortSignal: controller.signal
      }
      const collected = await collectWriterText(
        this.options.modelClient.stream(request),
        controller.signal,
        (usage) => observedUsage.push(usage)
      )
      const strategy = completeSourceStrategyFocus(input, parseSourceStrategy(collected.text))
      const usageRecord = collected.usage.at(-1)
      if (input.execution && reservation && usageRecord) {
        await input.execution.recordModelUsage({ stage: 'source_strategy', model, turnId, taskId: input.task.id, usage: usageRecord }, reservation)
        usageRecorded = true
      }
      return {
        ...strategy,
        ...(!input.execution && usageRecord ? { modelUsage: [{ stage: 'source_strategy', model, turnId, taskId: input.task.id, usage: usageRecord }] } : {})
      }
    } finally {
      clearTimeout(timeout)
      unlinkAbort()
      if (input.execution && reservation) {
        const lastUsage = observedUsage.at(-1)
        if (!usageRecorded && lastUsage) {
          await input.execution.recordModelUsage({ stage: 'source_strategy', model, turnId, taskId: input.task.id, usage: lastUsage }, reservation)
          usageRecorded = true
        }
        await input.execution.finishModelCall(reservation, { chargeEstimateOnMissing: !usageRecorded })
      }
    }
  }
}

export function buildSourceStrategyPrompt(input: ResearchTaskWorkerInput): string {
  const explicitReportQuestionIds = input.task.reportQuestionIds ?? []
  const legacyReportQuestionIds = explicitReportQuestionIds.length === 0
    ? (input.task.reportSectionIds ?? []).filter((questionId) => input.task.questionIds.includes(questionId))
    : []
  const currentQuestionIds = explicitReportQuestionIds.length > 0
    ? explicitReportQuestionIds
    : legacyReportQuestionIds.length > 0 ? legacyReportQuestionIds : input.task.questionIds
  return [
    '为当前研究 task 设计最多 3 条搜索查询。',
    'queries[0] 是跨章节主材料查询；它必须保持宽口径，并优先使用普通搜索引擎能识别的材料名称或文件格式。',
    JSON.stringify({
      topic: input.brief.topic,
      currentDate: (input.nowIso ?? new Date().toISOString()).slice(0, 10),
      userIntent: input.brief.userIntent,
      userClarifications: input.brief.userClarifications ?? [],
      centralQuestion: input.frame.centralQuestion,
      currentQuestions: input.frame.coreQuestions.filter((question) => currentQuestionIds.includes(question.id)),
      alternativesToCompare: comparisonTargetsForTask(input),
      objective: input.task.objective,
      expectedEvidence: input.task.expectedEvidence,
      existingSources: input.existingSourceUrls ?? []
    }, null, 2),
    '返回：',
    JSON.stringify({
      subjectAliases: ['研究主体的常用外文名、全称或缩写'],
      focusAliasGroups: [['当前分面原词', '来源语言中的等价表达', '能直接证明当前分面的可观察指标、机制、事件或结果短语']],
      queries: [{ query: '短查询', purpose: '它要解决的证据缺口', authorityCriteria: '正文中可核验的来源身份特征', comparisonTarget: '仅在逐对象查询时精确复制 alternativesToCompare 中的值' }],
      rationale: '查询顺序为何能最大化信息增益'
    }, null, 2)
  ].join('\n')
}

export function parseSourceStrategy(raw: string): ResearchSourceStrategy {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('source strategy did not contain JSON')
  const payload = JSON.parse(raw.slice(start, end + 1)) as {
    queries?: unknown
    rationale?: unknown
    subjectAliases?: unknown
    focusAliasGroups?: unknown
    focusAliasesGroups?: unknown
  }
  const queries = Array.isArray(payload.queries) ? payload.queries.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
      const record = item as Record<string, unknown>
    const query = typeof record.query === 'string' ? record.query.replace(/\s+/gu, ' ').trim().slice(0, 160) : ''
    if (query.length < 4) return []
    return [{
      query,
      purpose: typeof record.purpose === 'string' ? record.purpose.trim().slice(0, 240) : '',
      authorityCriteria: typeof record.authorityCriteria === 'string' ? record.authorityCriteria.trim().slice(0, 320) : '',
      ...(typeof record.comparisonTarget === 'string' && record.comparisonTarget.trim()
        ? { comparisonTarget: record.comparisonTarget.trim().slice(0, 80) }
        : {})
    }]
  }) : []
  const unique = queries.filter((item, index, values) => values.findIndex((candidate) => candidate.query.toLowerCase() === item.query.toLowerCase()) === index).slice(0, 3)
  if (unique.length === 0) throw new Error('source strategy did not contain usable queries')
  const queryText = unique.map((item) => item.query.normalize('NFKC').toLowerCase()).join('\n')
  const subjectAliases = Array.isArray(payload.subjectAliases)
    ? [...new Set(payload.subjectAliases
      .filter((alias): alias is string => typeof alias === 'string')
      .map((alias) => alias.replace(/\s+/gu, ' ').trim().slice(0, 80))
      .filter((alias) => alias.length >= 2)
      .filter((alias) => {
        const normalizedAlias = alias.normalize('NFKC').toLowerCase()
        return queryText.includes(normalizedAlias) || isConstrainedExternalSubjectAlias(alias)
      }))]
    : []
  const rawFocusAliasGroups = Array.isArray(payload.focusAliasGroups)
    ? payload.focusAliasGroups
    : Array.isArray(payload.focusAliasesGroups) ? payload.focusAliasesGroups : []
  const focusAliasGroups = rawFocusAliasGroups.length > 0
    ? rawFocusAliasGroups
      .filter(Array.isArray)
      .map((group) => [...new Set(group
        .filter((alias): alias is string => typeof alias === 'string')
        .map((alias) => alias.replace(/\s+/gu, ' ').trim().slice(0, 48))
        .filter((alias) => alias.length >= 2 && !/https?:\/\//iu.test(alias))
        .flatMap(expandMixedScriptFocusAlias))]
        .slice(0, 24))
      .filter((group) => group.length > 0)
      .slice(0, 8)
    : []
  return {
    queries: unique,
    rationale: typeof payload.rationale === 'string' ? payload.rationale.trim().slice(0, 600) : '',
    ...(subjectAliases.length > 0 ? { subjectAliases } : {}),
    ...(focusAliasGroups.length > 0 ? { focusAliasGroups } : {})
  }
}

function isConstrainedExternalSubjectAlias(value: string): boolean {
  if (!/[a-z]/iu.test(value) || /[\p{Script=Han}\r\n<>:/\\]/u.test(value)) return false
  const letters = value.replace(/[^a-z]/giu, '')
  if (letters.length < 2) return false
  return letters === letters.toUpperCase()
    && /^[A-Z0-9][A-Z0-9 .&'()+#-]{1,79}$/u.test(value)
}

function expandMixedScriptFocusAlias(alias: string): string[] {
  if (!/\p{Script=Han}/u.test(alias) || !/[a-z]/iu.test(alias) || !/\s/u.test(alias)) return [alias]
  const parts = alias.match(/[\p{Script=Han}]+|[a-z][a-z0-9+#.&-]*(?:\s+[a-z0-9+#.&-]+)*/giu)
    ?.map((part) => part.replace(/\s+/gu, ' ').trim())
    .filter((part) => part.length >= 2) ?? []
  return [alias, ...parts]
}

const QUERY_FOCUS_STOPWORDS = new Set([
  'official', 'primary', 'source', 'sources', 'data', 'report', 'reports', 'latest', 'current',
  'document', 'documents', 'pdf', 'statistics', 'analysis', 'research', 'overview',
  '官方', '原始', '原始资料', '资料', '数据', '报告', '文档', '最新', '当前',
  '完整', '指标', '统计', '分析', '研究', '概况'
])

export function completeSourceStrategyFocus(
  input: ResearchTaskWorkerInput,
  strategy: ResearchSourceStrategy
): ResearchSourceStrategy {
  const normalizedStrategy = {
    ...strategy,
    queries: assignMissingComparisonTargets(input, strategy.queries.map((query) => {
      const { comparisonTarget: _unverifiedTarget, ...queryWithoutTarget } = query
      const comparisonTarget = comparisonTargetsForTask(input)
        .find((target) => normalizeStrategyTarget(target) === normalizeStrategyTarget(query.comparisonTarget ?? ''))
      return {
        ...queryWithoutTarget,
        ...(comparisonTarget ? { comparisonTarget } : {})
      }
    }))
  }
  if ((normalizedStrategy.focusAliasGroups?.length ?? 0) > 0) return normalizedStrategy
  const questionIds = input.task.reportQuestionIds?.length
    ? input.task.reportQuestionIds
    : input.task.questionIds
  const questions = input.frame.coreQuestions.filter((question) => questionIds.includes(question.id))
  const dimensions = questions
    .map((question) => question.text.match(/在「([^」]+)」维度/u)?.[1]?.trim())
    .filter((dimension): dimension is string => Boolean(dimension))
  if (dimensions.length === 0) return normalizedStrategy

  const subjectTerms = subjectQueryTerms(input, normalizedStrategy.subjectAliases ?? [])
  const focusedQueries = normalizedStrategy.queries.length > 1 ? normalizedStrategy.queries.slice(1) : normalizedStrategy.queries
  const queryTerms = focusedQueries
    .flatMap((item) => focusTermsFromQuery(item.query))
    .filter((term) => !subjectTerms.has(normalizeQueryTerm(term)))
    .filter((term) => !dimensions.some((dimension) => {
      const normalizedDimension = normalizeQueryTerm(dimension)
      const normalizedTerm = normalizeQueryTerm(term)
      return normalizedDimension.includes(normalizedTerm) || normalizedTerm.includes(normalizedDimension)
    }))
  const recovered = [...new Set(queryTerms)].slice(0, 7)
  return {
    ...normalizedStrategy,
    focusAliasGroups: [[...new Set([...dimensions, ...recovered])].slice(0, 8)]
  }
}

function assignMissingComparisonTargets(
  input: ResearchTaskWorkerInput,
  queries: ResearchSourceQuery[]
): ResearchSourceQuery[] {
  const targets = comparisonTargetsForTask(input)
  if (targets.length === 0) return queries
  const assigned = new Set(queries.flatMap((query) => query.comparisonTarget ? [normalizeStrategyTarget(query.comparisonTarget)] : []))
  const result = queries.map((query) => ({ ...query }))
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex]
    if (!target || assigned.has(normalizeStrategyTarget(target))) continue
    const preferredQuery = result[targetIndex]
    const query = preferredQuery && !preferredQuery.comparisonTarget
      ? preferredQuery
      : result.find((candidate) => !candidate.comparisonTarget)
    if (!query) break
    query.comparisonTarget = target
    assigned.add(normalizeStrategyTarget(target))
  }
  return result
}

function normalizeStrategyTarget(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#.&]+/gu, '')
}

function comparisonTargetsForTask(input: ResearchTaskWorkerInput): string[] {
  const frameTargets = input.frame.alternativesToCompare ?? []
  const requested = input.task.comparisonTargets ?? []
  if (requested.length === 0) return frameTargets
  const allowed = new Set(frameTargets.map(normalizeStrategyTarget))
  return requested.filter((target) => allowed.has(normalizeStrategyTarget(target)))
}

function subjectQueryTerms(input: ResearchTaskWorkerInput, aliases: string[]): Set<string> {
  return new Set([input.brief.topic, ...aliases]
    .flatMap((value) => value.split(/[^\p{L}\p{N}+#.&-]+/u))
    .map(normalizeQueryTerm)
    .filter((term) => term.length >= 2))
}

function focusTermsFromQuery(query: string): string[] {
  return query
    .replace(/(?:19|20)\d{2}(?:年)?/gu, ' ')
    .split(/[^\p{L}\p{N}+#.&-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && term.length <= 32)
    .filter((term) => !/^\d+(?:\.\d+)?$/u.test(term))
    .filter((term) => !QUERY_FOCUS_STOPWORDS.has(normalizeQueryTerm(term)))
}

function normalizeQueryTerm(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+#.&-]+/gu, '')
}
