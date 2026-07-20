/**
 * [INPUT]: 依赖 model-client、web-provider、ResearchTaskWorker 输入和 evidence 类型，接收 Runtime 分配的网页研究任务
 * [OUTPUT]: 对外提供 SeededWebResearchTaskWorker、网页抽取 prompt 和真实网页证据 worker
 * [POS]: research/runtime 的联网证据采集节点，先搜索/抓取网页，再抽取结构化 evidence；抽取失败时生成有信息量的确定性兜底资料卡
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { WebProvider, WebSearchResult } from '../../ports/web-provider.js'
import { researchReasoningForStage } from '../core/presets.js'
import type { ResearchConfidence } from '../core/types.js'
import { hashText } from '../core/hash.js'
import type { AtomicClaim, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'
import type { ConflictCandidate, ResearchTaskWorker, ResearchTaskWorkerInput, WorkerResult } from '../agents/types.js'
import { ModelResearchTaskWorker } from './ModelResearchTaskWorker.js'

const WEB_RESEARCH_TIMEOUT_MS = 18_000
const WEB_RESEARCH_MAX_BYTES = 160_000
const WEB_RESEARCH_TEXT_CHARS = 16_000
const WEB_RESEARCH_SOURCE_LIMIT = 12
const WEB_EXTRACTION_TIMEOUT_MS = 60_000
const WEB_SEARCH_TIMEOUT_MS = 18_000
const WEB_SEARCH_QUERY_LIMIT = 6
const WEB_SEARCH_RESULTS_PER_QUERY = 6

type SeededWebResearchTaskWorkerOptions = {
  modelClient: ModelClient
  model: string
  webProvider?: WebProvider
  fetchImpl?: typeof fetch
  nowIso?: () => string
  timeoutMs?: number
  fallback?: ResearchTaskWorker
}

type SeedSource = {
  url: string
  title: string
  publisher: string
  reliabilityReason: string
  tags: string[]
}

type FetchedSeedSource = SeedSource & {
  finalUrl: string
  title: string
  text: string
  contentType?: string
  byteCount: number
  fetchedAt: string
}

type WebExtractionCard = {
  sourceIndex?: unknown
  evidenceText?: unknown
  claimText?: unknown
  claimType?: unknown
  confidence?: unknown
  critical?: unknown
  entities?: unknown
  noteSummary?: unknown
  implicationForBrief?: unknown
  limitations?: unknown
}

type WebExtractionPayload = {
  evidenceCards?: unknown
  unresolvedQuestions?: unknown
  conflicts?: unknown
  suggestedNextQueries?: unknown
}

export const SEEDED_WEB_RESEARCH_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的网页证据抽取节点。',
  'Runtime 已经抓取了真实网页来源，你只能基于这些来源文本抽取结构化 evidence cards、claims、notes 和局限。',
  '不要写报告章节，不要编造来源，不要使用来源文本中不存在的具体数字。',
  '如果来源不足以支撑某个结论，应把它写入 unresolvedQuestions 或 limitations。',
  '至少保留一个反面证据、边界条件或不确定性，避免报告只呈现单边论证。',
  '输出必须是 JSON。'
].join('\n')

export class SeededWebResearchTaskWorker implements ResearchTaskWorker {
  private readonly fetchImpl: typeof fetch
  private readonly nowIso: () => string
  private readonly fallback: ResearchTaskWorker

  constructor(private readonly options: SeededWebResearchTaskWorkerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.fallback = options.fallback ?? new ModelResearchTaskWorker({
      modelClient: options.modelClient,
      model: options.model
    })
  }

  hasSearchCapability(): boolean {
    return Boolean(this.options.webProvider?.search)
  }

  async runTask(input: ResearchTaskWorkerInput): Promise<WorkerResult> {
    if (!input.brief.sourcePolicy.allowedSourceTypes.includes('web') || !input.task.sourceTypes.includes('web')) {
      return this.runFallback(input, 'Brief 或 task 未允许 web 来源，已退回非网页研究 worker。')
    }

    const searchedSeeds = await searchSeedSources(input, {
      provider: this.options.webProvider,
      nowIso: this.nowIso,
      timeoutMs: WEB_SEARCH_TIMEOUT_MS
    })
    const seeds = selectSeedMix({
      curatedSeeds: selectSeedSources(input),
      searchedSeeds,
      maxSources: Math.min(input.task.maxSources, WEB_RESEARCH_SOURCE_LIMIT)
    })
    if (seeds.length === 0) {
      return this.runFallback(input, '没有可用网页种子源或联网搜索结果，已退回非网页研究 worker。')
    }

    const fetched = await fetchSeedSources(seeds, {
      fetchImpl: this.fetchImpl,
      nowIso: this.nowIso,
      timeoutMs: WEB_RESEARCH_TIMEOUT_MS,
      maxBytes: WEB_RESEARCH_MAX_BYTES
    })
    if (fetched.length < 2) {
      if (fetched.length > 0) {
        return buildFetchedFallbackResult(input, fetched, this.nowIso(), `网页来源抓取不足：候选 ${seeds.length} 个，成功 ${fetched.length} 个。`)
      }
      return this.runFallback(input, `网页来源抓取不足：候选 ${seeds.length} 个，成功 ${fetched.length} 个，已退回非网页研究 worker。`)
    }

    try {
      return await this.extractFromFetchedSources(input, fetched)
    } catch (error) {
      return buildFetchedFallbackResult(input, fetched, this.nowIso(), `网页来源已抓取，但模型未能抽取结构化证据：${errorMessage(error)}。`)
    }
  }

  private async runFallback(input: ResearchTaskWorkerInput, reason: string): Promise<WorkerResult> {
    const fallback = await this.fallback.runTask(input)
    return {
      ...fallback,
      unresolvedQuestions: [
        ...fallback.unresolvedQuestions,
        reason
      ]
    }
  }

  private async extractFromFetchedSources(
    input: ResearchTaskWorkerInput,
    fetched: FetchedSeedSource[]
  ): Promise<WorkerResult> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.options.timeoutMs ?? WEB_EXTRACTION_TIMEOUT_MS)
    )
    try {
      const turnId = `research_web_extract_${hashText(`${input.runId}:${input.task.id}:${input.brief.topic}`).slice(0, 12)}`
      const request: ModelRequest = {
        threadId: 'research_web_extractor',
        turnId,
        model: this.options.model,
        systemPrompt: SEEDED_WEB_RESEARCH_SYSTEM_PROMPT,
        prefix: [],
        history: [
          makeUserItem({
            id: `item_${turnId}_user`,
            threadId: 'research_web_extractor',
            turnId,
            text: buildWebExtractionPrompt(input, fetched)
          })
        ],
        tools: [],
        stream: false,
        maxTokens: 4_500,
        temperature: 0.15,
        responseFormat: 'json_object',
        reasoningEffort: researchReasoningForStage(input.budget.reasoningEffort, 'worker'),
        abortSignal: controller.signal
      }
      const raw = await collectModelText(this.options.modelClient.stream(request), controller.signal)
      return parseWebExtractionResult(raw, input, fetched, this.nowIso())
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function buildWebExtractionPrompt(input: ResearchTaskWorkerInput, sources: FetchedSeedSource[]): string {
  return [
    '请只基于下面 Runtime 抓取到的网页来源，抽取结构化研究资料。',
    '',
    '已确认 Brief：',
    JSON.stringify({
      topic: input.brief.topic,
      userIntent: input.brief.userIntent,
      userClarifications: input.brief.userClarifications ?? [],
      outputFormat: input.brief.outputFormat,
      successCriteria: input.brief.successCriteria
    }, null, 2),
    '',
    'ResearchFrame：',
    JSON.stringify({
      coreResearchThread: input.frame.coreResearchThread,
      centralQuestion: input.frame.centralQuestion,
      coreQuestions: input.frame.coreQuestions,
      evidenceNeeded: input.frame.evidenceNeeded,
      disconfirmingEvidenceNeeded: input.frame.disconfirmingEvidenceNeeded
    }, null, 2),
    '',
    '当前 Task：',
    JSON.stringify({
      id: input.task.id,
      objective: input.task.objective,
      questionIds: input.task.questionIds,
      expectedEvidence: input.task.expectedEvidence,
      searchHints: input.task.searchHints,
      maxSources: input.task.maxSources
    }, null, 2),
    '',
    '网页来源：',
    JSON.stringify(sourcesForExtractionPrompt(sources), null, 2),
    '',
    '要求：',
    '- 只返回 JSON，不要 Markdown。',
    '- 生成 4 到 8 条 evidenceCards。',
    '- 每条 evidenceCard 必须指定 sourceIndex，且 evidenceText 必须来自对应来源文本的事实或近似摘录。',
    '- 如果 Brief.userClarifications 非空，必须优先抽取能回应这些用户补充要求的证据。',
    '- 如果 SEC company facts 来源中存在收入、净利润、资产、负债、股本、公众持股量或流通股数等指标，必须优先抽取至少一条量化证据。',
    '- 关键 claim 必须服务于核心研究主线和当前 task。',
    '- 至少一条 card 或 limitation 要体现反面证据、边界条件或不确定性。',
    '- 如果来源不足，不要强行下结论；写入 unresolvedQuestions。',
    '',
    '返回 JSON schema：',
    '{',
    '  "evidenceCards": [',
    '    {',
    '      "sourceIndex": 1,',
    '      "evidenceText": "来源中的可引用事实或摘录",',
    '      "claimText": "该证据支持的原子论断",',
    '      "claimType": "fact|metric|date|quote|opinion|inference|recommendation",',
    '      "confidence": "high|medium|low",',
    '      "critical": true,',
    '      "entities": ["实体"],',
    '      "noteSummary": "结构化笔记摘要",',
    '      "implicationForBrief": "对核心问题/主线的意义",',
    '      "limitations": ["局限或待验证点"]',
    '    }',
    '  ],',
    '  "unresolvedQuestions": ["仍未解决的问题"],',
    '  "conflicts": [{"description": "潜在冲突", "claimIndexes": [0, 1]}],',
    '  "suggestedNextQueries": ["下一步检索 query"]',
    '}'
  ].join('\n')
}

function sourcesForExtractionPrompt(sources: FetchedSeedSource[]): Array<{
  sourceIndex: number
  title: string
  publisher: string
  url: string
  reliabilityReason: string
  text: string
}> {
  const perSourceTextChars = Math.max(3_000, Math.floor(36_000 / Math.max(1, sources.length)))
  return sources.map((source, index) => ({
    sourceIndex: index + 1,
    title: source.title,
    publisher: source.publisher,
    url: source.finalUrl,
    reliabilityReason: source.reliabilityReason,
    text: fitText(source.text, perSourceTextChars)
  }))
}

export function parseWebExtractionResult(
  raw: string,
  input: ResearchTaskWorkerInput,
  fetched: FetchedSeedSource[],
  nowIso: string
): WorkerResult {
  const json = extractFirstJsonObject(raw)
  if (!json) throw new Error('web extraction response did not contain JSON')
  const payload = JSON.parse(json) as WebExtractionPayload
  const cards = normalizeCards(payload.evidenceCards).slice(0, Math.max(1, input.task.maxSources))
  if (cards.length === 0) throw new Error('web extraction response did not contain evidenceCards')

  const selectedSourceIndexes = new Set(
    cards
      .map((card) => sourceIndexValue(card.sourceIndex, fetched.length))
      .filter((index): index is number => typeof index === 'number')
  )
  if (selectedSourceIndexes.size === 0) selectedSourceIndexes.add(1)

  const sources = [...selectedSourceIndexes].map((sourceIndex) => sourceRecordForFetched(input, fetched[sourceIndex - 1], sourceIndex, nowIso))
  const sourceByIndex = new Map(sources.map((source, index) => [Number(source.id.match(/web_source_(\d+)$/)?.[1] ?? index + 1), source]))
  const evidenceSpans: EvidenceSpan[] = []
  const claims: AtomicClaim[] = []
  const notes: ResearchNote[] = []

  cards.forEach((card, index) => {
    const cardIndex = index + 1
    const sourceIndex = sourceIndexValue(card.sourceIndex, fetched.length) ?? 1
    const fetchedSource = fetched[sourceIndex - 1]
    const source = sourceByIndex.get(sourceIndex) ?? sourceRecordForFetched(input, fetchedSource, sourceIndex, nowIso)
    if (!sourceByIndex.has(sourceIndex)) {
      sources.push(source)
      sourceByIndex.set(sourceIndex, source)
    }
    const spanId = `${input.task.id}_web_span_${cardIndex}`
    const claimId = `${input.task.id}_web_claim_${cardIndex}`
    const noteId = `${input.task.id}_web_note_${cardIndex}`
    const evidenceText = cleanExtractedWebText(stringValue(card.evidenceText) || excerptForSource(fetchedSource.text))
    const dimension = fallbackEvidenceDimension(fetchedSource, input, evidenceText)
    const rawClaimText = cleanExtractedWebText(stringValue(card.claimText))
    const claimText = isUsefulWebClaim(rawClaimText, evidenceText, input)
      ? rawClaimText
      : fallbackClaimText(fetchedSource, dimension, evidenceText, input)
    if (!isUsefulWebEvidence(evidenceText, input) || !isUsefulWebClaim(claimText, evidenceText, input)) return
    const limitations = normalizeStringArray(card.limitations, 5)
      .map(cleanExtractedWebText)
      .filter((limitation) => limitation.length > 0)

    evidenceSpans.push({
      id: spanId,
      sourceId: source.id,
      text: evidenceText,
      textHash: hashText(`${source.id}:${evidenceText}`),
      location: {
        url: fetchedSource.finalUrl,
        headingPath: [fetchedSource.title],
        paragraphIndex: 1
      },
      extractedAt: nowIso,
      extractorRunId: input.runId
    })
    claims.push({
      id: claimId,
      text: claimText,
      entities: normalizeStringArray(card.entities, 8),
      claimType: claimTypeValue(card.claimType),
      supportSpanIds: [spanId],
      confidence: confidenceValue(card.confidence),
      critical: booleanValue(card.critical) ?? cardIndex <= 4
    })
    notes.push({
      id: noteId,
      taskId: input.task.id,
      questionIds: input.task.questionIds,
      claimIds: [claimId],
      summary: cleanExtractedWebText(stringValue(card.noteSummary)) || claimText,
      implicationForBrief: cleanExtractedWebText(stringValue(card.implicationForBrief)) || claimText,
      confidence: confidenceValue(card.confidence),
      limitations: limitations.length > 0 ? limitations : ['该结论来自网页文本抽取，仍需在最终报告中保留来源语境。']
    })
  })

  if (notes.length === 0) {
    throw new Error('web extraction only produced low-signal boilerplate cards')
  }

  return {
    taskId: input.task.id,
    questionIds: input.task.questionIds,
    sources,
    evidenceSpans,
    claims,
    notes,
    unresolvedQuestions: normalizeStringArray(payload.unresolvedQuestions, 8),
    conflicts: normalizeConflicts(payload.conflicts, claims),
    suggestedNextQueries: normalizeStringArray(payload.suggestedNextQueries, 10)
  }
}

function buildFetchedFallbackResult(
  input: ResearchTaskWorkerInput,
  fetched: FetchedSeedSource[],
  now: string,
  reason: string
): WorkerResult {
  const readableFetched = fetched.filter((source) => isReadableFallbackSource(source.text))
  const selectedPool = readableFetched.length > 0 ? readableFetched : fetched
  const selected = selectedPool.slice(0, Math.max(1, Math.min(input.task.maxSources, WEB_RESEARCH_SOURCE_LIMIT)))
  const sources: SourceRecord[] = []
  const evidenceSpans: EvidenceSpan[] = []
  const claims: AtomicClaim[] = []
  const notes: ResearchNote[] = []

  selected.forEach((source, index) => {
    const sourceIndex = index + 1
    const sourceId = `${input.task.id}_web_source_${sourceIndex}`
    const spanId = `${input.task.id}_web_span_${sourceIndex}`
    const claimId = `${input.task.id}_web_claim_${sourceIndex}`
    const noteId = `${input.task.id}_web_note_${sourceIndex}`
    const evidenceText = fallbackEvidenceText(source, input)
    const dimension = fallbackEvidenceDimension(source, input, evidenceText)
    const claimText = fallbackClaimText(source, dimension, evidenceText, input)
    const reliability = source.tags.includes('official') || source.tags.includes('international') ? 'high' : 'medium'
    if (!isUsefulWebEvidence(evidenceText, input) || !isUsefulWebClaim(claimText, evidenceText, input)) return

    sources.push({
      id: sourceId,
      sourceType: 'web',
      title: source.title,
      canonicalUrl: source.finalUrl,
      originalUrl: source.url,
      path: source.finalUrl,
      publisher: source.publisher,
      accessedAt: source.fetchedAt,
      importedAt: now,
      reliability,
      reliabilityReason: source.reliabilityReason,
      sourcePolicyTags: [...new Set(['web_fetch', 'strong_web_evidence', 'fallback_extracted', 'fallback_structured', ...source.tags])],
      fingerprint: hashText(`${input.runId}:${input.task.id}:${source.finalUrl}:${source.byteCount}`),
      status: 'fetched',
      kind: reliability === 'high' || source.tags.includes('official') ? 'web_strong' : 'web_weak'
    })
    evidenceSpans.push({
      id: spanId,
      sourceId,
      text: evidenceText,
      textHash: hashText(evidenceText),
      location: {
        url: source.finalUrl,
        headingPath: ['网页抓取兜底证据', input.task.id, source.title],
        paragraphIndex: 1,
        charStart: 0,
        charEnd: evidenceText.length
      },
      extractedAt: now,
      extractorRunId: input.runId
    })
    claims.push({
      id: claimId,
      text: claimText,
      entities: [...new Set([source.publisher, input.brief.topic, dimension])],
      claimType: 'fact',
      supportSpanIds: [spanId],
      confidence: 'medium',
      critical: index < 3
    })
    notes.push({
      id: noteId,
      taskId: input.task.id,
      questionIds: input.task.questionIds,
      claimIds: [claimId],
      summary: `${dimension}：${claimText}`,
      implicationForBrief: `这条证据关联当前任务的${dimension}维度，可用于支撑主线：${input.frame.coreResearchThread}`,
      confidence: 'medium',
      limitations: [
        reason,
        '这是网页抽取模型失败后的确定性兜底证据，最终报告应避免从该片段过度推断。'
      ]
    })
  })

  if (notes.length === 0) {
    return unresolvedWebWorkerResult(input, reason, [
      reason,
      '抓取到的网页正文主要是导航、站点框架或不可用于报告的低信号文本，已拒绝生成可引用论断。'
    ])
  }

  return {
    taskId: input.task.id,
    questionIds: input.task.questionIds,
    sources,
    evidenceSpans,
    claims,
    notes,
    unresolvedQuestions: [reason],
    conflicts: [],
    suggestedNextQueries: input.task.searchHints
  }
}

function fallbackEvidenceText(source: FetchedSeedSource, input: ResearchTaskWorkerInput): string {
  const excerpt = selectRelevantFallbackExcerpt(source, input)
  return [
    `来源：${source.title}（${source.publisher}）。`,
    excerpt
  ].join(' ')
}

function fallbackClaimText(
  source: FetchedSeedSource,
  dimension: string,
  evidenceText: string,
  input?: ResearchTaskWorkerInput
): string {
  const sentence = firstMeaningfulSentence(evidenceText, input)
  return `${dimension}：${sentence || `来源「${source.title}」提供了与本维度相关的可复核网页材料`}`
}

function unresolvedWebWorkerResult(
  input: ResearchTaskWorkerInput,
  reason: string,
  unresolvedQuestions: string[]
): WorkerResult {
  return {
    taskId: input.task.id,
    questionIds: input.task.questionIds,
    sources: [],
    evidenceSpans: [],
    claims: [],
    notes: [{
      id: `${input.task.id}_web_unresolved_note`,
      taskId: input.task.id,
      questionIds: input.task.questionIds,
      claimIds: [],
      summary: '本轮网页抓取没有得到可用于报告正文的干净事实。',
      implicationForBrief: '需要继续检索更具体的官方数据页、交易规则页、指数表现页或研究报告，不能把网页导航文本当作证据。',
      confidence: 'low',
      limitations: [reason]
    }],
    unresolvedQuestions,
    conflicts: [],
    suggestedNextQueries: input.task.searchHints
  }
}

function fallbackEvidenceDimension(
  source: FetchedSeedSource,
  input: ResearchTaskWorkerInput,
  evidenceText: string
): string {
  const text = `${source.title}\n${source.publisher}\n${evidenceText}`.toLowerCase()
  const dimensions: Array<{ label: string; patterns: RegExp[] }> = [
    { label: '投资渠道与准入', patterns: [/qdii/i, /港股通/, /沪股通/, /深股通/, /开户/, /准入/, /投资者门槛/] },
    { label: '交易规则', patterns: [/t\+0/i, /t\+1/i, /涨跌幅/, /交易机制/, /交易规则/, /做空/, /融资融券/, /衍生品/] },
    { label: '投资者结构', patterns: [/投资者结构/, /机构投资者/, /个人投资者/, /retail/i, /institutional/i] },
    { label: '估值与财务指标', patterns: [/估值/, /市盈率/, /pe\\b/i, /pb\\b/i, /roe\\b/i, /valuation/i, /market cap/i] },
    { label: '监管与信息披露', patterns: [/监管/, /披露/, /sec\\b/i, /证监会/, /交易所规则/, /disclosure/i, /filing/i] },
    { label: '指数表现与配置', patterns: [/沪深300/, /csi\\s*300/i, /s&p\\s*500/i, /标普500/, /配置/, /长期/, /benchmark/i] }
  ]
  return dimensions.find((dimension) => dimension.patterns.some((pattern) => pattern.test(text)))?.label ?? '可比口径'
}

function selectRelevantFallbackExcerpt(source: FetchedSeedSource, input: ResearchTaskWorkerInput): string {
  const text = cleanFallbackSourceText(source.text)
  const sentences = splitFallbackSentences(text, input)
  const keywords = fallbackKeywords(source, input)
  const ranked = sentences
    .map((sentence, index) => ({ sentence: cleanFallbackSentence(sentence), index, score: scoreFallbackSentence(sentence, keywords) }))
    .filter((item) => item.sentence.length >= 20 && item.score > 0 && isInformativeFallbackSentence(item.sentence, input))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence)
  const fallbackSentences = sentences
    .map(cleanFallbackSentence)
    .filter((sentence) => sentence.length >= 20 && !isFallbackBoilerplateSentence(sentence))
    .slice(0, 3)
  const excerpt = ranked.length > 0 ? ranked.join(' ') : fallbackSentences.join(' ') || source.title
  return excerpt.slice(0, 1_200)
}

function fallbackKeywords(source: FetchedSeedSource, input: ResearchTaskWorkerInput): string[] {
  return [
    ...taskSignalKeywords(input),
    source.title,
    source.publisher,
    ...source.tags,
    input.brief.topic,
    input.frame.coreResearchThread,
    input.task.objective,
    ...input.task.searchHints,
    'A股',
    '美股',
    '交易规则',
    'T+0',
    'T+1',
    '投资者结构',
    '估值',
    '监管',
    '披露',
    '沪深300',
    '标普500',
    'S&P 500',
    'QDII',
    '港股通',
    '配置',
    '选股',
    'evidence',
    'evaluation',
    'benchmark',
    'report',
    'research'
  ]
    .join(' ')
    .split(/[^\p{L}\p{N}+#&]+/u)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword.length >= 2)
}

function scoreFallbackSentence(sentence: string, keywords: string[]): number {
  if (isFallbackBoilerplateSentence(sentence)) return -100
  const lower = sentence.toLowerCase()
  let score = 0
  for (const keyword of keywords) {
    if (lower.includes(keyword)) score += keyword.length > 4 ? 2 : 1
  }
  if (/[0-9]/.test(sentence)) score += 1
  if (/A股|美股|沪深300|标普500|S&P 500|T\+0|T\+1|QDII|港股通/i.test(sentence)) score += 3
  return score
}

function splitFallbackSentences(text: string, input?: ResearchTaskWorkerInput): string[] {
  const normalized = normalizeWhitespace(text)
  const matches = normalized.match(/[^。！？.!?]{12,320}[。！？.!?]?/g) ?? []
  return matches
    .flatMap((sentence) => expandFallbackSentenceWindows(sentence, input))
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function firstMeaningfulSentence(text: string, input?: ResearchTaskWorkerInput): string {
  const withoutPrefix = text.replace(/^来源：[^。]+。/u, '').trim()
  const sentences = splitFallbackSentences(withoutPrefix, input).map(cleanFallbackSentence).filter(Boolean)
  const candidate = sentences.find((sentence) => isInformativeFallbackSentence(sentence, input))
    ?? sentences.find((sentence) => !isFallbackBoilerplateSentence(sentence))
    ?? withoutPrefix.slice(0, 180)
  return cleanFallbackSentence(candidate)
}

function cleanExtractedWebText(text: string): string {
  return cleanFallbackSourceText(text)
    .replace(/^来源：[^。！？.!?]{0,140}[。！？.!?]?\s*/u, '')
    .replace(/^该来源可用于回答[^。！？.!?]{0,260}[。！？.!?]?\s*/u, '')
    .replace(/并服务于主线[:：][^。！？.!?]{0,260}[。！？.!?]?/u, '')
    .replace(/(?:Skip to main content|official website|Toggle navigation|Main navigation|Data by Topic|Data by Place|Data by Economic Account|Tools Intera)[^。！？.!?]{0,300}/gi, ' ')
    .replace(/(?:Organizational Chart|Data Communiqués|Legal Framework|Classifications & Methods|Latest Releases|International Cooperation|Understanding Statistics)[^。！？.!?]{0,300}/gi, ' ')
    .replace(/(?:Trade Agreements|Agreements on Reciprocal Trade|Free Trade Agreements|Trade & Inve)[^。！？.!?]{0,300}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500)
}

function isUsefulWebEvidence(text: string, input?: ResearchTaskWorkerInput): boolean {
  const cleaned = cleanExtractedWebText(text)
  if (cleaned.length < 24) return false
  if (isLowSignalWebText(cleaned)) return false
  return hasResearchSignal(cleaned, input)
}

function isUsefulWebClaim(claimText: string, evidenceText: string, input?: ResearchTaskWorkerInput): boolean {
  const cleaned = cleanExtractedWebText(claimText)
  if (cleaned.length < 18) return false
  if (isLowSignalWebText(cleaned)) return false
  if (/来源「[^」]+」提供了?与本维度相关的可复核网页材料/.test(cleaned)) return false
  const combined = `${cleaned}\n${evidenceText}`
  return hasResearchSignal(combined, input)
}

function hasResearchSignal(text: string, input?: ResearchTaskWorkerInput): boolean {
  if (input) {
    const keywordScore = scoreFallbackSentence(text, taskSignalKeywords(input))
    if (keywordScore > 0) return true
    if (hasGenericEvidenceSignal(text)) return true
  }
  return /A股|美股|QDII|港股通|沪股通|深股通|T\+0|T\+1|涨跌幅|投资者|估值|市盈率|监管|披露|沪深300|CSI\s*300|标普500|S&P\s*500|配置|基金|SEC|Nasdaq|NYSE|收入|利润|市值|market cap|valuation|ticker|中美|中国|美国|经济|贸易|官方统计|GDP|Crucial|Micron|SanDisk|SSD|NAND|读写|性能|产品规格|portable storage/i.test(text)
}

function hasGenericEvidenceSignal(text: string): boolean {
  const normalized = normalizeWhitespace(text)
  if (/[0-9]{2,}/.test(normalized)) return true
  if (/[A-Z][A-Za-z0-9+#.-]{2,}/.test(normalized)) return true
  if (/报告|研究|证据|引用|来源|评估|质量|覆盖|机制|流程|标准|指标|风险|限制|局限|对比|趋势|原因|路径|用户|产品|架构|系统|模型|搜索|检索|网页|数据|官方|文档|论文|案例|benchmark|metric|evaluation|judge|loop|agent|supervisor|citation|source|evidence|retrieval/i.test(normalized)) return true
  return false
}

function isLowSignalWebText(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (/浏览器不被支持|下载APP|下载客户端|登录 注册|媒体矩阵|爆料专线|-->/.test(normalized)) return true
  if (/Skip to main content|official website|Toggle navigation|Main navigation/i.test(normalized)) return true
  if (/Organizational Chart|Data Communiqués|Legal Framework|Classifications & Methods|Latest Releases|International Cooperation|Understanding Statistics/i.test(normalized)) return true
  if (/Trade Agreements|Free Trade Agreements|Trade & Inve|email&#160;protected/i.test(normalized)) return true
  const alphaWords = normalized.match(/[A-Za-z]{3,}/g) ?? []
  if (alphaWords.length >= 14 && !/SEC|S&P|Nasdaq|NYSE|ticker|revenue|income|market cap|valuation|CSI|Micron|SanDisk|Crucial|SSD|NAND|NVMe|portable storage|performance|DeepResearch|gap|loop|judge|agent|supervisor|citation|source|evidence|retrieval|benchmark|evaluation|Dota|Counter-Strike|CS2|CSGO|esports|tournament|viewership|prize pool|Major|International|HLTV/i.test(normalized)) return true
  return false
}

function isReadableFallbackSource(text: string): boolean {
  const normalized = normalizeWhitespace(text)
  if (normalized.length < 120) return false
  const readableChars = [...normalized].filter((char) => /[\p{L}\p{N}\u4e00-\u9fff，。；：、,.!?！？+\-/%()（）]/u.test(char)).length
  return readableChars / normalized.length >= 0.55
}

function isInformativeFallbackSentence(sentence: string, input?: ResearchTaskWorkerInput): boolean {
  if (isFallbackBoilerplateSentence(sentence)) return false
  return hasResearchSignal(sentence, input)
}

function cleanFallbackSentence(sentence: string): string {
  let cleaned = normalizeWhitespace(sentence)
    .replace(/-->+/g, ' ')
    .replace(/您的浏览器不被支持[^。！？.!?]*/gi, ' ')
    .replace(/请尽快升级到最新版下列浏览器[^。！？.!?]*/gi, ' ')
    .replace(/\b(?:Edge|Chrome|Firefox)\b/gi, ' ')
    .replace(/(?:首页|登录|注册|下载客户端|下载APP|打开APP|搜索|媒体矩阵|爆料专线|个人中心|退出登录|字号|超大|标准|小|RSS)[^。！？.!?]{0,80}/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (isFallbackBoilerplateSentence(cleaned)) {
    const useful = lastUsefulWindow(cleaned)
    if (useful) cleaned = useful
  }
  return cleaned.replace(/[。！？.!?]+$/u, '').trim().slice(0, 260)
}

function cleanFallbackSourceText(text: string): string {
  return normalizeWhitespace(text)
    .replace(/您的浏览器不被支持[^。！？.!?]*/gi, ' ')
    .replace(/请尽快升级到最新版下列浏览器[^。！？.!?]*/gi, ' ')
    .replace(/\b(?:Edge|Chrome|Firefox)\b/gi, ' ')
    .replace(/(?:首页|登录|注册|下载客户端|下载APP|打开APP|媒体矩阵|爆料专线|个人中心|退出登录|字号|超大|标准|小|RSS)\s*/gi, ' ')
}

function isFallbackBoilerplateSentence(sentence: string): boolean {
  return /浏览器不被支持|Edge Chrome Firefox|打开APP|下载APP|下载客户端|首页|登录|注册|媒体矩阵|爆料专线|个人中心|退出登录|字号|RSS|快讯|视频|直播|专题|-->/.test(sentence)
}

function expandFallbackSentenceWindows(sentence: string, input?: ResearchTaskWorkerInput): string[] {
  const cleaned = normalizeWhitespace(sentence)
  if (cleaned.length <= 220) return [cleaned]
  const windows = relevantTermWindows(cleaned, input)
  return windows.length > 0 ? windows : [cleaned.slice(0, 220)]
}

function relevantTermWindows(text: string, input?: ResearchTaskWorkerInput): string[] {
  const dynamicKeywords = input ? taskSignalKeywords(input).filter((keyword) => keyword.length >= 3).slice(0, 16) : []
  const dynamicIndexes = dynamicKeywords
    .flatMap((keyword) => keywordIndexes(text, keyword))
    .slice(0, 8)
  const pattern = /A股|美股|沪深300|标普500|S&P\s*500|QDII|港股通|沪股通|深股通|T\+0|T\+1|涨跌幅|证监会|SEC|机构投资者|个人投资者|市盈率|估值|监管|披露|配置|基金/giu
  const windows: string[] = []
  for (const index of dynamicIndexes) {
    const start = Math.max(0, index - 50)
    const end = Math.min(text.length, index + 190)
    windows.push(text.slice(start, end))
  }
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    const start = Math.max(0, index - 50)
    const end = Math.min(text.length, index + 190)
    windows.push(text.slice(start, end))
  }
  return [...new Set(windows)].slice(0, 4)
}

function lastUsefulWindow(text: string): string {
  const windows = relevantTermWindows(text).map((window) => window.trim()).filter(Boolean)
  return windows.at(-1) ?? ''
}

function taskSignalKeywords(input: ResearchTaskWorkerInput): string[] {
  return [
    input.brief.topic,
    input.brief.userIntent,
    ...(input.brief.userClarifications ?? []),
    input.frame.coreResearchThread,
    input.frame.centralQuestion,
    ...input.frame.coreQuestions.filter((question) => input.task.questionIds.includes(question.id)).map((question) => question.text),
    input.task.objective,
    ...input.task.expectedEvidence,
    ...input.task.searchHints
  ]
    .join(' ')
    .split(/[^\p{L}\p{N}+#&.+-]+/u)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword.length >= 2)
    .filter((keyword, index, all) => all.indexOf(keyword) === index)
    .slice(0, 80)
}

function keywordIndexes(text: string, keyword: string): number[] {
  const lower = text.toLowerCase()
  const indexes: number[] = []
  let cursor = 0
  while (indexes.length < 3) {
    const index = lower.indexOf(keyword.toLowerCase(), cursor)
    if (index < 0) break
    indexes.push(index)
    cursor = index + keyword.length
  }
  return indexes
}

function selectSeedMix(input: {
  curatedSeeds: SeedSource[]
  searchedSeeds: SeedSource[]
  maxSources: number
}): SeedSource[] {
  const maxSources = Math.max(1, input.maxSources)
  const selected: SeedSource[] = []
  const pushUnique = (seed: SeedSource | undefined) => {
    if (!seed) return
    if (selected.some((candidate) => candidate.url === seed.url)) return
    selected.push(seed)
  }
  const curatedQuota = input.curatedSeeds.length > 0
    ? Math.min(input.curatedSeeds.length, Math.max(1, Math.ceil(maxSources / 2)))
    : 0
  for (const seed of input.curatedSeeds.slice(0, curatedQuota)) pushUnique(seed)
  for (const seed of input.searchedSeeds) {
    if (selected.length >= maxSources) break
    pushUnique(seed)
  }
  for (const seed of input.curatedSeeds.slice(curatedQuota)) {
    if (selected.length >= maxSources) break
    pushUnique(seed)
  }
  return selected.slice(0, maxSources)
}

function selectSeedSources(input: ResearchTaskWorkerInput): SeedSource[] {
  const text = [
    input.brief.topic,
    input.brief.userIntent,
    ...(input.brief.userClarifications ?? []),
    input.frame.coreResearchThread,
    input.frame.centralQuestion,
    input.task.objective,
    ...input.task.searchHints
  ].join('\n').toLowerCase()

  const seeds: SeedSource[] = []
  if (/(中美|中国|美国|china|u\.s\.|usa|united states|贸易|经济|产业链|供应链|gdp|出口|进口)/i.test(text)) {
    seeds.push(...CHINA_US_ECONOMY_TRADE_SEEDS)
  }
  if (/(美光|micron|\bmu\b|闪迪|sandisk|\bsndk\b|西部数据|western digital|\bwdc\b|希捷|seagate|\bstx\b|netapp|\bntap\b|pure storage|\bpstg\b|存储|storage|硬盘|闪存|ssd|hdd|云存储|企业存储)/i.test(text)
    && /(股票|美股|市值|估值|财务|营收|收入|利润|毛利|净利|研发|股价|价格表现|股价表现|标普|sp500|s&p|stock|market cap|valuation|financial|revenue|margin|benchmark)/i.test(text)) {
    seeds.push(...STORAGE_STOCK_FINANCIAL_SEEDS)
  }
  if (/(美光|micron|\bmu\b|闪迪|sandisk|\bsndk\b|西部数据|western digital|\bwdc\b|nand|dram|ssd|存储|半导体)/i.test(text)
    && /(ssd|crucial|p3|p5|extreme|portable|产品|规格|性能|选型|读写|nand|层数|颗粒)/i.test(text)) {
    seeds.push(...SEMICONDUCTOR_STORAGE_PRODUCT_SEEDS)
  }
  if (/(美光|micron|\bmu\b|闪迪|sandisk|\bsndk\b|西部数据|western digital|\bwdc\b|nand|dram|ssd|存储|半导体)/i.test(text)) {
    seeds.push(...SEMICONDUCTOR_STORAGE_COMPANY_SEEDS)
  }
  if (/(a股|a 股|美股|股票|证券|交易规则|t\+0|t\+1|涨跌停|做空|融资融券|退市|信息披露|nasdaq|nyse|sec|finra|上交所|深交所|证监会|纳斯达克|纽交所|创业板|投资者结构|估值|pe|roe|分红)/i.test(text)) {
    seeds.push(...SECURITIES_MARKET_STRUCTURE_SEEDS)
  }
  if (isDotaCounterStrikeResearchText(text)) {
    seeds.push(...DOTA_COUNTERSTRIKE_ESPORTS_SEEDS)
  }
  return dedupeSeedSources(seeds)
}

async function searchSeedSources(
  input: ResearchTaskWorkerInput,
  options: {
    provider?: WebProvider
    nowIso: () => string
    timeoutMs: number
  }
): Promise<SeedSource[]> {
  const provider = options.provider
  if (!provider?.search) return []
  const timeRange = defaultSearchTimeRange(input, options.nowIso())
  const queries = buildSearchQueries(input, timeRange).slice(0, WEB_SEARCH_QUERY_LIMIT)
  if (queries.length === 0) return []
  const groups = await Promise.all(
    queries.map((query) => searchOneQuery(query, {
      provider,
      nowIso: options.nowIso,
      timeRange,
      timeoutMs: options.timeoutMs
    }).catch(() => []))
  )
  const results = groups.flat()
  return dedupeSeedSources(results
    .filter((result) => isRelevantSearchResult(input, result))
    .map((result) => ({
      url: result.url,
      title: result.title || result.url,
      publisher: result.provider,
      reliabilityReason: `由 ${result.provider} 针对 DeepResearch task 联网搜索得到，最终报告仍以抓取页面文本为准。${result.snippet ? ` 摘要：${result.snippet}` : ''}`,
      tags: ['web_search', result.provider, `rank_${result.rank}`]
    })))
}

async function searchOneQuery(
  query: string,
  options: {
    provider: WebProvider
    nowIso: () => string
    timeRange?: SearchTimeRange
    timeoutMs: number
  }
): Promise<WebSearchResult[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    return await options.provider.search?.({
      query,
      limit: WEB_SEARCH_RESULTS_PER_QUERY,
      timeoutMs: options.timeoutMs,
      ...(options.timeRange ? { timeRange: options.timeRange } : {}),
      signal: controller.signal
    }) ?? []
  } finally {
    clearTimeout(timeout)
  }
}

type SearchTimeRange = {
  startDate: string
  endDate: string
  defaulted: boolean
}

function buildSearchQueries(input: ResearchTaskWorkerInput, timeRange?: SearchTimeRange): string[] {
  const coreQuestionTexts = input.frame.coreQuestions
    .filter((question) => input.task.questionIds.includes(question.id))
    .map((question) => question.text)
  const candidates = [
    ...specializedSearchQueries(input),
    ...input.task.searchHints,
    input.task.objective,
    ...coreQuestionTexts,
    `${input.brief.topic} ${input.task.expectedEvidence.join(' ')}`,
    `${input.brief.topic} 官方 数据 报告`
  ]
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

function normalizeSearchQuery(value: string): string {
  return value
    .replace(/^调研[:：]\s*/, '')
    .replace(/\bdota2\b/gi, 'Dota 2')
    .replace(/\bdota\s+2\b/gi, 'Dota 2')
    .replace(/\bcs\s*电竞\b/gi, 'Counter-Strike esports')
    .replace(/\bcs\s*赛事\b/gi, 'Counter-Strike tournaments')
    .replace(/\bcs2\b/gi, 'CS2 Counter-Strike 2')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function defaultSearchTimeRange(input: ResearchTaskWorkerInput, nowIso: string): SearchTimeRange | undefined {
  if (hasExplicitSearchTimeScope(researchInputText(input))) return undefined
  const end = isoDate(nowIso)
  const startDate = new Date(`${end}T00:00:00.000Z`)
  if (Number.isNaN(startDate.getTime())) return undefined
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1)
  return {
    startDate: isoDate(startDate.toISOString()),
    endDate: end,
    defaulted: true
  }
}

function applySearchTimeRange(query: string, timeRange: SearchTimeRange | undefined): string {
  if (!query || !timeRange) return query
  const suffix = `最近一年 after:${timeRange.startDate} before:${timeRange.endDate}`
  if (query.includes('after:') || query.includes('before:')) return query
  return `${query} ${suffix}`.slice(0, 220)
}

function hasExplicitSearchTimeScope(text: string): boolean {
  return /(?:19|20)\d{2}|after:|before:|\bsince\b|\bfrom\b|\bto\b|最近|近\s*\d+|近[一二三四五六七八九十]+|过去|今年|去年|本年|当前|最新|历史演变|未来趋势|以来|至今|时间范围|不限时间|特定历史时期|current|latest|past\s+\d+|last\s+\d+|year|month|quarter|date/i.test(text)
}

function isoDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  return date.toISOString().slice(0, 10)
}

function specializedSearchQueries(input: ResearchTaskWorkerInput): string[] {
  const text = researchInputText(input)
  if (isDotaCounterStrikeResearchText(text)) {
    return [
      'Dota 2 Counter-Strike esports tournaments comparison prize pool viewership',
      'Dota 2 The International Counter-Strike Major prize pool viewership Esports Charts',
      'Dota 2 vs Counter-Strike esports ecosystem tournament format Major TI',
      'Dota 2 CS2 esports viewership prize money tournament ecosystem'
    ]
  }
  return []
}

function isRelevantSearchResult(input: ResearchTaskWorkerInput, result: WebSearchResult): boolean {
  const researchText = researchInputText(input)
  if (!isDotaCounterStrikeResearchText(researchText)) return true
  const text = `${result.title}\n${result.snippet}\n${result.url}`.toLowerCase()
  const title = (result.title || '').toLowerCase()
  const clearlyOtherEsport = /kpl|lpl|王者荣耀|英雄联盟|league of legends|free fire|决胜巅峰|mobile legends|apex英雄|apex legends|cod现代战争|call of duty/.test(text)
  const titleHasTargetGame = /dota\s*2|dota2|counter[-\s]?strike|\bcs2\b|\bcsgo\b|\bcs:go\b/.test(title)
  if (clearlyOtherEsport && !titleHasTargetGame) return false
  const hasDota = /dota\s*2|dota2|the international|\bti\d*\b/.test(text)
  const hasCounterStrike = /counter[-\s]?strike|\bcs2\b|\bcsgo\b|\bcs:go\b|\bcs\b|hltv|iem|blast|pgl major|esl pro league/.test(text)
  const trustedEsports = /escharts|esportscharts|liquipedia|hltv|counter-strike\.net|dota2\.com|valvesoftware|esl|blast|pgl/.test(text)
  if ((hasDota && hasCounterStrike) || (trustedEsports && (hasDota || hasCounterStrike))) return true
  return false
}

function researchInputText(input: ResearchTaskWorkerInput): string {
  return [
    input.brief.topic,
    input.brief.userIntent,
    ...(input.brief.userClarifications ?? []),
    input.frame.coreResearchThread,
    input.frame.centralQuestion,
    input.task.objective,
    ...input.task.searchHints
  ].join('\n').toLowerCase()
}

function isDotaCounterStrikeResearchText(text: string): boolean {
  return /(dota\s*2|dota2)/i.test(text) && /(counter[-\s]?strike|\bcs2\b|\bcsgo\b|\bcs:go\b|\bcs\b|反恐精英)/i.test(text)
}

function dedupeSeedSources(seeds: SeedSource[]): SeedSource[] {
  const seen = new Set<string>()
  return seeds.filter((seed) => {
    if (seen.has(seed.url)) return false
    seen.add(seed.url)
    return true
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const DOTA_COUNTERSTRIKE_ESPORTS_SEEDS: SeedSource[] = [
  {
    url: 'https://escharts.com/games/dota2',
    title: 'Esports Charts: Dota 2 tournaments and viewership',
    publisher: 'Esports Charts',
    reliabilityReason: 'Esports Charts game page for Dota 2, useful for tournament viewership and event-level comparison.',
    tags: ['esports', 'dota2', 'viewership', 'tournaments']
  },
  {
    url: 'https://escharts.com/games/csgo',
    title: 'Esports Charts: Counter-Strike tournaments and viewership',
    publisher: 'Esports Charts',
    reliabilityReason: 'Esports Charts game page for Counter-Strike, useful for tournament viewership and event-level comparison.',
    tags: ['esports', 'counter-strike', 'cs2', 'viewership', 'tournaments']
  },
  {
    url: 'https://liquipedia.net/dota2/The_International',
    title: 'Liquipedia: The International',
    publisher: 'Liquipedia',
    reliabilityReason: 'Community-maintained esports encyclopedia page for Dota 2 The International history, format and prize-pool context.',
    tags: ['esports', 'dota2', 'the-international', 'tournament-format']
  },
  {
    url: 'https://liquipedia.net/counterstrike/Majors',
    title: 'Liquipedia: Counter-Strike Majors',
    publisher: 'Liquipedia',
    reliabilityReason: 'Community-maintained esports encyclopedia page for Counter-Strike Major history, format and ecosystem context.',
    tags: ['esports', 'counter-strike', 'majors', 'tournament-format']
  },
  {
    url: 'https://www.hltv.org/events',
    title: 'HLTV Counter-Strike events',
    publisher: 'HLTV',
    reliabilityReason: 'Specialized Counter-Strike event database useful for current CS tournament ecosystem context.',
    tags: ['esports', 'counter-strike', 'events', 'tournaments']
  }
]

const CHINA_US_ECONOMY_TRADE_SEEDS: SeedSource[] = [
  {
    url: 'https://www.bea.gov/news/glance',
    title: '美国经济分析局：经济指标概览',
    publisher: 'U.S. Bureau of Economic Analysis',
    reliabilityReason: '美国官方经济统计机构页面，用于核对美国宏观经济指标。',
    tags: ['official', 'us', 'economy']
  },
  {
    url: 'https://www.stats.gov.cn/english/',
    title: '中国国家统计局英文站',
    publisher: 'National Bureau of Statistics of China',
    reliabilityReason: '中国官方统计机构英文站，用于核对中国宏观经济和统计发布入口。',
    tags: ['official', 'china', 'economy']
  },
  {
    url: 'https://ustr.gov/countries-regions/china-mongolia-taiwan/peoples-republic-china',
    title: '美国贸易代表办公室：中国页面',
    publisher: 'Office of the United States Trade Representative',
    reliabilityReason: '美国官方贸易政策机构页面，用于理解美国对华贸易政策口径。',
    tags: ['official', 'us', 'trade', 'china']
  },
  {
    url: 'https://www.wto.org/english/res_e/statis_e/statis_e.htm',
    title: '世界贸易组织：贸易统计入口',
    publisher: 'World Trade Organization',
    reliabilityReason: '多边贸易组织统计入口，用于提供全球贸易数据的中性参照。',
    tags: ['international', 'trade', 'statistics']
  },
  {
    url: 'https://www.federalreserve.gov/monetarypolicy.htm',
    title: '美联储：货币政策',
    publisher: 'Board of Governors of the Federal Reserve System',
    reliabilityReason: '美国央行官方货币政策页面，用于理解美国利率和政策背景。',
    tags: ['official', 'us', 'monetary-policy']
  }
]

const SECURITIES_MARKET_STRUCTURE_SEEDS: SeedSource[] = [
  {
    url: 'https://www.csindex.com.cn/en/indices/index-detail/000300',
    title: 'CSI 300 index details',
    publisher: 'China Securities Index Co.',
    reliabilityReason: '中证指数公司沪深300指数详情页，用于核对沪深300指数口径和成分结构。',
    tags: ['official', 'china', 'index', 'csi300', 'benchmark']
  },
  {
    url: 'https://www.spglobal.com/spdji/en/indices/equity/sp-500/',
    title: 'S&P 500 index factsheet and overview',
    publisher: 'S&P Dow Jones Indices',
    reliabilityReason: '标普道琼斯指数官方 S&P 500 页面，用于核对标普500指数口径、事实表和长期表现入口。',
    tags: ['official', 'us', 'index', 'sp500', 'benchmark']
  },
  {
    url: 'https://english.sse.com.cn/markets/equities/overview/',
    title: 'Shanghai Stock Exchange equities overview',
    publisher: 'Shanghai Stock Exchange',
    reliabilityReason: '上交所英文官网页面，用于核对 A 股股票市场结构和交易所口径。',
    tags: ['official', 'china', 'a-share', 'exchange']
  },
  {
    url: 'https://english.sse.com.cn/start/trading/schedule/',
    title: 'Shanghai Stock Exchange trading schedule',
    publisher: 'Shanghai Stock Exchange',
    reliabilityReason: '上交所官方交易日历页面，用于核对 A 股交易时间和市场制度背景。',
    tags: ['official', 'china', 'a-share', 'trading-rules']
  },
  {
    url: 'https://www.szse.cn/English/about/overview/index.html',
    title: 'Shenzhen Stock Exchange overview',
    publisher: 'Shenzhen Stock Exchange',
    reliabilityReason: '深交所英文官网页面，用于理解深市、创业板等 A 股市场结构。',
    tags: ['official', 'china', 'a-share', 'chinext']
  },
  {
    url: 'https://www.csrc.gov.cn/csrc_en/index.shtml',
    title: 'China Securities Regulatory Commission English site',
    publisher: 'China Securities Regulatory Commission',
    reliabilityReason: '中国证监会英文官网入口，用于核对监管和信息披露制度口径。',
    tags: ['official', 'china', 'regulation', 'disclosure']
  },
  {
    url: 'https://www.nyse.com/markets/hours-calendars',
    title: 'NYSE trading hours and market holidays',
    publisher: 'New York Stock Exchange',
    reliabilityReason: '纽交所官方交易时间页面，用于核对美股交易时间和市场日历。',
    tags: ['official', 'us', 'stock-market', 'trading-rules']
  },
  {
    url: 'https://listingcenter.nasdaq.com/rulebook/nasdaq/rules',
    title: 'Nasdaq rulebook',
    publisher: 'Nasdaq',
    reliabilityReason: '纳斯达克规则入口，用于核对上市、交易和市场规则的官方口径。',
    tags: ['official', 'us', 'nasdaq', 'market-rules']
  },
  {
    url: 'https://www.sec.gov/about',
    title: 'U.S. Securities and Exchange Commission overview',
    publisher: 'U.S. Securities and Exchange Commission',
    reliabilityReason: '美国 SEC 官方介绍页面，用于理解美股证券监管机构职责。',
    tags: ['official', 'us', 'regulation', 'disclosure']
  },
  {
    url: 'https://www.investor.gov/introduction-investing/investing-basics/how-stock-markets-work',
    title: 'How stock markets work',
    publisher: 'Investor.gov',
    reliabilityReason: 'SEC 投资者教育页面，用于解释美股市场运行机制和投资者保护语境。',
    tags: ['official', 'us', 'investor-education', 'market-structure']
  },
  {
    url: 'https://www.finra.org/investors/investing/investment-products/stocks',
    title: 'Stocks explained for investors',
    publisher: 'FINRA',
    reliabilityReason: 'FINRA 投资者教育页面，用于补充美股股票交易、风险和投资者保护视角。',
    tags: ['official', 'us', 'investor-education', 'stock']
  },
  {
    url: 'https://www.sifma.org/resources/research/fact-book/',
    title: 'SIFMA Capital Markets Fact Book',
    publisher: 'SIFMA',
    reliabilityReason: 'SIFMA 市场事实手册入口，用于补充美国资本市场结构和规模数据。',
    tags: ['industry', 'us', 'capital-markets', 'statistics']
  }
]

const SEMICONDUCTOR_STORAGE_PRODUCT_SEEDS: SeedSource[] = [
  {
    url: 'https://investors.micron.com/news-releases/news-release-details/micron-ships-crucial-p3-plus-pcie-40-and-crucial-p3-pcie-30-ssds',
    title: 'Micron ships Crucial P3 Plus PCIe 4.0 and Crucial P3 PCIe 3.0 SSDs',
    publisher: 'Micron Technology',
    reliabilityReason: 'Micron official release with Crucial P3/P3 Plus positioning and performance specifications.',
    tags: ['company', 'official', 'micron', 'crucial', 'ssd', 'product-spec']
  },
  {
    url: 'https://www.sandisk.com/products/ssd/external-ssd/portable-ssd-sandisk-extreme-usb-3-2',
    title: 'SanDisk Extreme Portable SSD product page',
    publisher: 'SanDisk',
    reliabilityReason: 'SanDisk official product page for Extreme Portable SSD headline read/write performance and interface details.',
    tags: ['company', 'official', 'sandisk', 'ssd', 'product-spec']
  },
  {
    url: 'https://investors.micron.com/news-releases/news-release-details/microns-new-crucial-p5-plus-pcie-ssds-unleash-gen4-speed',
    title: 'Micron new Crucial P5 Plus PCIe SSDs unleash Gen4 speed',
    publisher: 'Micron Technology',
    reliabilityReason: 'Micron official release for Crucial P5 Plus PCIe 4.0 SSD technical positioning and headline performance.',
    tags: ['company', 'official', 'micron', 'crucial', 'ssd', 'product-spec']
  },
  {
    url: 'https://www.storagereview.com/review/sandisk-extreme-portable-ssd-v2-review',
    title: 'SanDisk Extreme Portable SSD V2 Review',
    publisher: 'StorageReview',
    reliabilityReason: 'Independent storage review site with product-specific performance context for SanDisk Extreme Portable SSD.',
    tags: ['review', 'sandisk', 'ssd', 'benchmark', 'product-spec']
  },
  {
    url: 'https://www.tomshardware.com/reviews/crucial-p3-ssd-review/2',
    title: 'Crucial P3 SSD Review: Solid Secondary SSD',
    publisher: "Tom's Hardware",
    reliabilityReason: 'Independent SSD review with Crucial P3 NAND/cache behavior and benchmark context.',
    tags: ['review', 'micron', 'crucial', 'ssd', 'benchmark', 'product-spec']
  },
  {
    url: 'https://www.kitguru.net/components/ssd-drives/simon-crisp/crucial-p5-plus-1tb-ssd-review/',
    title: 'Crucial P5 Plus 1TB SSD Review',
    publisher: 'KitGuru',
    reliabilityReason: 'Independent SSD review with Crucial P5 Plus NAND components and random/sequential performance figures.',
    tags: ['review', 'micron', 'crucial', 'ssd', 'benchmark', 'product-spec']
  }
]

const STORAGE_STOCK_FINANCIAL_SEEDS: SeedSource[] = [
  {
    url: 'https://stockanalysis.com/stocks/mu/',
    title: 'Micron Technology stock profile and financial snapshot',
    publisher: 'Stock Analysis',
    reliabilityReason: 'Public stock profile page with market cap, valuation, performance and financial summary for Micron.',
    tags: ['stock', 'financial-data', 'micron', 'market-cap', 'valuation']
  },
  {
    url: 'https://stockanalysis.com/stocks/wdc/',
    title: 'Western Digital stock profile and financial snapshot',
    publisher: 'Stock Analysis',
    reliabilityReason: 'Public stock profile page with market cap, valuation, performance and financial summary for Western Digital.',
    tags: ['stock', 'financial-data', 'western-digital', 'market-cap', 'valuation']
  },
  {
    url: 'https://stockanalysis.com/stocks/stx/',
    title: 'Seagate Technology stock profile and financial snapshot',
    publisher: 'Stock Analysis',
    reliabilityReason: 'Public stock profile page with market cap, valuation, performance and financial summary for Seagate.',
    tags: ['stock', 'financial-data', 'seagate', 'market-cap', 'valuation']
  },
  {
    url: 'https://stockanalysis.com/stocks/ntap/',
    title: 'NetApp stock profile and financial snapshot',
    publisher: 'Stock Analysis',
    reliabilityReason: 'Public stock profile page with market cap, valuation, performance and financial summary for NetApp.',
    tags: ['stock', 'financial-data', 'netapp', 'market-cap', 'valuation']
  },
  {
    url: 'https://stockanalysis.com/stocks/pstg/',
    title: 'Pure Storage stock profile and financial snapshot',
    publisher: 'Stock Analysis',
    reliabilityReason: 'Public stock profile page with market cap, valuation, performance and financial summary for Pure Storage.',
    tags: ['stock', 'financial-data', 'pure-storage', 'market-cap', 'valuation']
  },
  {
    url: 'https://stockanalysis.com/etf/spy/',
    title: 'SPDR S&P 500 ETF Trust benchmark profile',
    publisher: 'Stock Analysis',
    reliabilityReason: 'Public SPY ETF profile useful as an S&P 500 investable benchmark when a user asks for S&P 500 comparison.',
    tags: ['stock', 'benchmark', 'sp500', 'spy', 'performance']
  },
  {
    url: 'https://stockanalysis.com/list/sp-500-stocks/',
    title: 'S&P 500 stocks list',
    publisher: 'Stock Analysis',
    reliabilityReason: 'Public S&P 500 constituents list useful for checking benchmark context and sector comparison.',
    tags: ['stock', 'benchmark', 'sp500', 'constituents']
  }
]

const SEMICONDUCTOR_STORAGE_COMPANY_SEEDS: SeedSource[] = [
  {
    url: 'https://data.sec.gov/submissions/CIK0000723125.json',
    title: 'SEC submissions: Micron Technology Inc.',
    publisher: 'U.S. Securities and Exchange Commission',
    reliabilityReason: 'SEC official company submissions metadata for Micron, including ticker, exchange and recent filing references.',
    tags: ['official', 'sec', 'micron', 'financial-filings']
  },
  {
    url: 'https://data.sec.gov/submissions/CIK0002023554.json',
    title: 'SEC submissions: Sandisk Corp.',
    publisher: 'U.S. Securities and Exchange Commission',
    reliabilityReason: 'SEC official company submissions metadata for Sandisk, including current ticker and exchange.',
    tags: ['official', 'sec', 'sandisk', 'financial-filings']
  },
  {
    url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000723125.json',
    title: 'SEC company facts: Micron Technology Inc.',
    publisher: 'U.S. Securities and Exchange Commission',
    reliabilityReason: 'SEC official XBRL company facts endpoint for Micron financial metrics.',
    tags: ['official', 'sec', 'micron', 'financial-data']
  },
  {
    url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0002023554.json',
    title: 'SEC company facts: Sandisk Corp.',
    publisher: 'U.S. Securities and Exchange Commission',
    reliabilityReason: 'SEC official XBRL company facts endpoint for Sandisk financial metrics.',
    tags: ['official', 'sec', 'sandisk', 'financial-data']
  },
  {
    url: 'https://data.sec.gov/submissions/CIK0000106040.json',
    title: 'SEC submissions: Western Digital Corp.',
    publisher: 'U.S. Securities and Exchange Commission',
    reliabilityReason: 'SEC official company submissions metadata for Western Digital, useful when a query still treats SanDisk as part of Western Digital.',
    tags: ['official', 'sec', 'western-digital', 'financial-filings']
  },
  {
    url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000106040.json',
    title: 'SEC company facts: Western Digital Corp.',
    publisher: 'U.S. Securities and Exchange Commission',
    reliabilityReason: 'SEC official XBRL company facts endpoint for Western Digital financial metrics.',
    tags: ['official', 'sec', 'western-digital', 'financial-data']
  },
  {
    url: 'https://www.micron.com/about',
    title: 'Micron company profile',
    publisher: 'Micron Technology',
    reliabilityReason: 'Micron official company profile, useful for business scope and product positioning.',
    tags: ['company', 'official', 'micron']
  },
  {
    url: 'https://www.sandisk.com/company/about-us',
    title: 'Sandisk company profile',
    publisher: 'Sandisk',
    reliabilityReason: 'Sandisk official company profile, useful for current company identity and product positioning.',
    tags: ['company', 'official', 'sandisk']
  },
  {
    url: 'https://www.westerndigital.com/company',
    title: 'Western Digital company profile',
    publisher: 'Western Digital',
    reliabilityReason: 'Western Digital official company profile, useful for questions that compare against Western Digital or legacy SanDisk ownership.',
    tags: ['company', 'official', 'western-digital']
  }
]

async function fetchSeedSources(
  seeds: SeedSource[],
  options: {
    fetchImpl: typeof fetch
    nowIso: () => string
    timeoutMs: number
    maxBytes: number
  }
): Promise<FetchedSeedSource[]> {
  const results = await Promise.all(seeds.map((seed) => fetchSeedSource(seed, options).catch(() => null)))
  return results.filter((result): result is FetchedSeedSource => Boolean(result))
}

async function fetchSeedSource(
  seed: SeedSource,
  options: {
    fetchImpl: typeof fetch
    nowIso: () => string
    timeoutMs: number
    maxBytes: number
  }
): Promise<FetchedSeedSource> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await options.fetchImpl(seed.url, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') ?? undefined
    const raw = await readResponsePrefix(response, options.maxBytes)
    const extracted = extractReadableText(raw, contentType)
    const text = extracted.text.slice(0, WEB_RESEARCH_TEXT_CHARS)
    if (text.trim().length < 300) throw new Error('fetched source text is too short')
    return {
      ...seed,
      title: extracted.title || seed.title,
      finalUrl: response.url || seed.url,
      contentType,
      text,
      byteCount: Buffer.byteLength(raw, 'utf8'),
      fetchedAt: options.nowIso()
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function readResponsePrefix(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return (await response.text()).slice(0, maxBytes)
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    const remaining = maxBytes - total
    if (value.length > remaining) {
      chunks.push(value.subarray(0, remaining))
      await reader.cancel()
      break
    }
    chunks.push(value)
    total += value.length
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sourceRecordForFetched(
  input: ResearchTaskWorkerInput,
  source: FetchedSeedSource,
  sourceIndex: number,
  nowIso: string
): SourceRecord {
  const isOfficial = source.tags.includes('official') || source.tags.includes('international')
  return {
    id: `${input.task.id}_web_source_${sourceIndex}`,
    sourceType: 'web',
    title: source.title,
    canonicalUrl: source.finalUrl,
    originalUrl: source.url,
    publisher: source.publisher,
    accessedAt: source.fetchedAt,
    importedAt: nowIso,
    language: 'en',
    reliability: isOfficial ? 'high' : 'medium',
    reliabilityReason: source.reliabilityReason,
    sourcePolicyTags: [...new Set(['web_fetch', 'strong_web_evidence', ...source.tags])],
    fingerprint: hashText(`${source.finalUrl}:${source.title}`),
    status: 'fetched',
    kind: isOfficial ? 'web_strong' : 'web_weak'
  }
}

async function collectModelText(
  stream: AsyncIterable<ModelStreamChunk>,
  signal: AbortSignal
): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('web extraction timed out')
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  if (!text.trim()) throw new Error('web extraction returned empty text')
  return text
}

function normalizeCards(value: unknown): WebExtractionCard[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord) as WebExtractionCard[]
}

function normalizeConflicts(value: unknown, claims: AtomicClaim[]): ConflictCandidate[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((item, index) => {
      const claimIndexes = Array.isArray(item.claimIndexes) ? item.claimIndexes : []
      const claimIds = claimIndexes
        .map((candidate) => typeof candidate === 'number' ? candidate : Number(candidate))
        .filter((candidate) => Number.isInteger(candidate) && candidate >= 0 && candidate < claims.length)
        .map((candidate) => claims[candidate]?.id)
        .filter((candidate): candidate is string => Boolean(candidate))
      return {
        id: `conflict_${index + 1}`,
        claimIds,
        description: stringValue(item.description)
      }
    })
    .filter((item) => item.description)
    .slice(0, 6)
}

function sourceIndexValue(value: unknown, sourceCount: number): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= sourceCount ? numeric : undefined
}

function confidenceValue(value: unknown): ResearchConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function claimTypeValue(value: unknown): AtomicClaim['claimType'] {
  return value === 'fact'
    || value === 'metric'
    || value === 'date'
    || value === 'quote'
    || value === 'opinion'
    || value === 'inference'
    || value === 'recommendation'
    ? value
    : 'inference'
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\n|；|;/) : []
  return values.map((item) => String(item).trim()).filter(Boolean).slice(0, limit)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['true', 'yes', '1', '是'].includes(normalized)) return true
  if (['false', 'no', '0', '否'].includes(normalized)) return false
  return undefined
}

function excerptForSource(text: string): string {
  return normalizeWhitespace(text).slice(0, 500)
}

function fitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n[TRUNCATED ${value.length - maxChars} chars]`
}

function extractReadableText(raw: string, contentType: string | undefined): { title?: string; text: string } {
  if (contentType?.toLowerCase().includes('json')) {
    const summarized = summarizeJsonSource(raw)
    if (summarized) return summarized
  }
  if (!contentType?.toLowerCase().includes('html')) {
    return { text: normalizeWhitespace(raw) }
  }
  const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return {
    ...(title ? { title: decodeHtmlTextEntities(normalizeWhitespace(title)) } : {}),
    text: decodeHtmlTextEntities(normalizeWhitespace(text))
  }
}

function summarizeJsonSource(raw: string): { title?: string; text: string } | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null
    const factsSummary = summarizeSecCompanyFacts(parsed)
    if (factsSummary) return factsSummary
    const submissionsSummary = summarizeSecSubmissions(parsed)
    if (submissionsSummary) return submissionsSummary
    return null
  } catch {
    return null
  }
}

function summarizeSecSubmissions(record: Record<string, unknown>): { title?: string; text: string } | null {
  const name = stringValue(record.name)
  const cik = stringValue(record.cik)
  const tickers = normalizeStringArray(record.tickers, 8).join(', ')
  const exchanges = normalizeStringArray(record.exchanges, 8).join(', ')
  if (!name && !cik && !tickers) return null
  const recent = isRecord(record.filings) && isRecord(record.filings.recent) ? record.filings.recent : undefined
  const forms = Array.isArray(recent?.form) ? recent.form.map(String) : []
  const filingDates = Array.isArray(recent?.filingDate) ? recent.filingDate.map(String) : []
  const accessionNumbers = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber.map(String) : []
  const recentFilings = forms.slice(0, 10).map((form, index) => {
    const filed = filingDates[index] ? ` filed ${filingDates[index]}` : ''
    const accession = accessionNumbers[index] ? ` accession ${accessionNumbers[index]}` : ''
    return `${form}${filed}${accession}`
  })
  const lines = [
    `SEC submissions entity: ${name || 'unknown'}`,
    `CIK: ${cik || 'unknown'}`,
    `Tickers: ${tickers || 'unknown'}`,
    `Exchanges: ${exchanges || 'unknown'}`,
    `SIC: ${stringValue(record.sic) || 'unknown'} ${stringValue(record.sicDescription) || ''}`.trim(),
    `Filer category: ${stringValue(record.category) || 'unknown'}`,
    `Fiscal year end: ${stringValue(record.fiscalYearEnd) || 'unknown'}`,
    `State of incorporation: ${stringValue(record.stateOfIncorporation) || 'unknown'}`,
    `Recent filings: ${recentFilings.length > 0 ? recentFilings.join('; ') : 'none in fetched metadata'}`
  ]
  return {
    title: name ? `SEC submissions: ${name}` : undefined,
    text: lines.join('\n')
  }
}

function summarizeSecCompanyFacts(record: Record<string, unknown>): { title?: string; text: string } | null {
  if (!isRecord(record.facts)) return null
  const entityName = stringValue(record.entityName)
  const cik = typeof record.cik === 'number' ? String(record.cik) : stringValue(record.cik)
  const metricGroups: Array<{ label: string; tags: string[] }> = [
    { label: 'Revenue', tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'] },
    { label: 'Net income/loss', tags: ['NetIncomeLoss', 'ProfitLoss'] },
    { label: 'Operating income/loss', tags: ['OperatingIncomeLoss'] },
    { label: 'Assets', tags: ['Assets'] },
    { label: 'Liabilities', tags: ['Liabilities'] },
    { label: 'Stockholders equity', tags: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
    { label: 'Cash and equivalents', tags: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'] },
    { label: 'Common shares outstanding', tags: ['EntityCommonStockSharesOutstanding', 'CommonStocksIncludingAdditionalPaidInCapital'] },
    { label: 'Public float', tags: ['EntityPublicFloat'] }
  ]
  const lines = [
    `SEC company facts entity: ${entityName || 'unknown'}`,
    `CIK: ${cik || 'unknown'}`
  ]
  for (const group of metricGroups) {
    const fact = findLatestCompanyFact(record.facts, group.tags)
    if (!fact) continue
    lines.push(`${group.label}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ''}${fact.end ? ` as of ${fact.end}` : ''}${fact.filed ? ` filed ${fact.filed}` : ''}${fact.form ? ` form ${fact.form}` : ''}`)
  }
  if (lines.length <= 2) return null
  return {
    title: entityName ? `SEC company facts: ${entityName}` : undefined,
    text: lines.join('\n')
  }
}

function findLatestCompanyFact(
  facts: Record<string, unknown>,
  tags: string[]
): { value: string; unit?: string; end?: string; filed?: string; form?: string } | null {
  const namespaces = ['us-gaap', 'dei']
  const candidates: Array<{ value: string; unit?: string; end?: string; filed?: string; form?: string }> = []
  for (const namespace of namespaces) {
    const namespaceFacts = isRecord(facts[namespace]) ? facts[namespace] : undefined
    if (!namespaceFacts) continue
    for (const tag of tags) {
      const fact = isRecord(namespaceFacts[tag]) ? namespaceFacts[tag] : undefined
      const units = isRecord(fact?.units) ? fact.units : undefined
      if (!units) continue
      for (const [unit, values] of Object.entries(units)) {
        if (!Array.isArray(values)) continue
        for (const value of values) {
          if (!isRecord(value)) continue
          const rawValue = value.val
          if (rawValue === null || typeof rawValue === 'undefined') continue
          candidates.push({
            value: String(rawValue),
            unit,
            end: stringValue(value.end),
            filed: stringValue(value.filed),
            form: stringValue(value.form)
          })
        }
      }
    }
  }
  candidates.sort((left, right) => {
    const leftDate = left.filed || left.end || ''
    const rightDate = right.filed || right.end || ''
    return rightDate.localeCompare(leftDate)
  })
  return candidates[0] ?? null
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function decodeHtmlTextEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end >= start ? raw.slice(start, end + 1) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
