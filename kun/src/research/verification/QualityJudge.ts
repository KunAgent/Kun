/**
 * [INPUT]: 依赖 model-client、core/types 和 evidence/types 中的报告、预算、证据与引用数据
 * [OUTPUT]: 对外提供 QualityJudge、ModelQualityJudge、HeuristicQualityJudge 和 verdict 合并函数
 * [POS]: research/verification 的 LLM-as-judge 节点，负责最终报告的需求匹配和证据质量评分
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { researchReasoningForStage } from '../core/presets.js'
import type {
  QualityJudgeVerdict,
  QualityVerdict,
  ResearchBrief,
  ResearchBudget,
  ResearchFrame,
  ResearchPlan,
  ResearchScopeAssessment
} from '../core/types.js'
import type { AtomicClaim, CitationBinding, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'

export type QualityJudgeInput = {
  scope: ResearchScopeAssessment
  brief: ResearchBrief
  frame: ResearchFrame
  plan: ResearchPlan
  budget: ResearchBudget
  reportMarkdown: string
  sources: SourceRecord[]
  notes: ResearchNote[]
  claims: AtomicClaim[]
  evidenceSpans: EvidenceSpan[]
  citations: CitationBinding[]
  deterministicVerdict: QualityVerdict
  nowIso: string
}

export interface QualityJudge {
  judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict>
}

export const MODEL_QUALITY_JUDGE_TIMEOUT_MS = 90_000

export const MODEL_QUALITY_JUDGE_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的 LLM Judge。',
  '你的任务是按已确认需求、ResearchBrief、ResearchFrame、证据与引用，对最终报告做严格评分。',
  '不要评价模型是否努力，也不要泛泛说“不错”；必须指出报告是否真正回应了用户确认的需求和核心研究主线。',
  '重点评估：需求匹配、是否回答核心问题、是否遵循 ResearchFrame、报告完整度、证据使用、引用忠实度、不确定性校准、写作质量。',
  '报告的“摘要”和“调研范围与方法”由 Runtime 后置生成，应该很短；不要因为它们短而扣分，也不要要求单独的证据来源列表。',
  '如果报告忽略核心研究主线、没有回答核心问题、引用支撑不足，必须降低分数。',
  '第一版可能只有“模型生成资料卡 / 需要外部来源复核”的结构化资料卡；不要仅因为没有真实网页检索就一票否决，但必须在证据使用、来源质量和 warnings 中体现。',
  '如果来源摘要显示 sourceType=web 且 sourcePolicyTags 包含 web_fetch、不包含 model_generated，则应视为 runtime 抓取的网页来源，不要误判为模型生成资料卡。',
  '如果报告把待复核资料伪装成真实外部检索结果，或者完全不披露来源限制，应降低不确定性校准并可判为不通过。',
  '所有评分为 0 到 1 的数字。只返回 JSON，不要 Markdown。'
].join('\n')

export class HeuristicQualityJudge implements QualityJudge {
  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    return heuristicJudge(input, input.nowIso, 'heuristic_fallback')
  }
}

export class ModelQualityJudge implements QualityJudge {
  private readonly fallback: QualityJudge

  constructor(
    private readonly options: {
      modelClient: ModelClient
      model: string
      timeoutMs?: number
      fallback?: QualityJudge
    }
  ) {
    this.fallback = options.fallback ?? new HeuristicQualityJudge()
  }

  async judge(input: QualityJudgeInput): Promise<QualityJudgeVerdict> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.options.timeoutMs ?? MODEL_QUALITY_JUDGE_TIMEOUT_MS)
    )

    try {
      const turnId = `research_judge_${hashJudgeInput(input)}`
      const request: ModelRequest = {
        threadId: 'research_quality_judge',
        turnId,
        model: this.options.model,
        systemPrompt: MODEL_QUALITY_JUDGE_SYSTEM_PROMPT,
        prefix: [],
        history: [
          makeUserItem({
            id: `item_${turnId}_user`,
            threadId: 'research_quality_judge',
            turnId,
            text: buildQualityJudgePrompt(input)
          })
        ],
        tools: [],
        stream: false,
        maxTokens: 1_600,
        temperature: 0,
        responseFormat: 'json_object',
        reasoningEffort: researchReasoningForStage(input.budget.reasoningEffort, 'judge'),
        abortSignal: controller.signal
      }
      const raw = await collectJudgeText(this.options.modelClient.stream(request), controller.signal)
      return parseQualityJudgeVerdict(raw, {
        source: 'llm_judge',
        model: this.options.model,
        judgedAt: input.nowIso
      })
    } catch {
      const fallback = await this.fallback.judge(input)
      if (input.budget.preset === 'deep') {
        return {
          ...fallback,
          source: 'heuristic_fallback',
          pass: false,
          scores: {
            ...fallback.scores,
            overall: Math.min(fallback.scores.overall, 0.4)
          },
          blockingIssues: [
            ...fallback.blockingIssues,
            'LLM Judge 未返回可用结果；deep preset 不接受启发式评分直接通过。'
          ],
          warnings: [
            ...fallback.warnings,
            'LLM Judge 未返回可用结果，启发式评分仅用于诊断，不用于 deep 模式放行。'
          ],
          recommendedFixes: [
            ...fallback.recommendedFixes,
            '重新运行 LLM Judge，或降低报告输入长度后再次校验。'
          ]
        }
      }
      return {
        ...fallback,
        source: 'heuristic_fallback',
        warnings: [
          ...fallback.warnings,
          'LLM Judge 未返回可用结果，已使用启发式评分兜底。'
        ]
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function mergeQualityVerdictWithJudge(
  verdict: QualityVerdict,
  judge: QualityJudgeVerdict
): QualityVerdict {
  const judgeBlockingIssues = judge.pass ? [] : judge.blockingIssues
  const judgeIssues = judgeBlockingIssues.map((message, index) => ({
    code: `llm_judge_blocking_${index + 1}`,
    message,
    severity: 'blocking' as const
  }))
  const blockingIssues = [...verdict.blockingIssues, ...judgeBlockingIssues]
  return {
    ...verdict,
    pass: verdict.pass && judge.pass,
    scores: {
      ...verdict.scores,
      requirementsAlignment: judge.scores.requirementsAlignment,
      answersCoreQuestions: Math.min(verdict.scores.answersCoreQuestions, judge.scores.answersConfirmedScope),
      followsCoreResearchThread: Math.min(verdict.scores.followsCoreResearchThread, judge.scores.followsResearchFrame),
      reportCompleteness: judge.scores.reportCompleteness,
      citationAccuracy: Math.min(verdict.scores.citationAccuracy, judge.scores.citationFaithfulness),
      evidenceCoverage: Math.min(verdict.scores.evidenceCoverage, judge.scores.evidenceUse),
      uncertaintyCalibration: Math.min(verdict.scores.uncertaintyCalibration, judge.scores.uncertaintyCalibration),
      writingQuality: judge.scores.writingQuality,
      llmJudgeOverall: judge.scores.overall
    },
    llmJudge: judge,
    blockingIssues,
    warnings: [...verdict.warnings, ...judge.warnings],
    recommendedFixes: [...verdict.recommendedFixes, ...judge.recommendedFixes],
    issues: [...verdict.issues, ...judgeIssues]
  }
}

export function buildQualityJudgePrompt(input: QualityJudgeInput): string {
  return [
    '请评估这份 DeepResearch 最终报告是否满足已确认需求。',
    '',
    '已确认 Scope：',
    JSON.stringify({
      summary: input.scope.summary,
      mainContradiction: input.scope.mainContradiction,
      confirmationChecklist: input.scope.confirmationChecklist,
      clarifications: input.scope.readyForBrief ? [] : input.scope.clarificationQuestions
    }, null, 2),
    '',
    'ResearchBrief：',
    JSON.stringify({
      topic: input.brief.topic,
      userIntent: input.brief.userIntent,
      userClarifications: input.brief.userClarifications ?? [],
      outputFormat: input.brief.outputFormat,
      successCriteria: input.brief.successCriteria,
      constraints: input.brief.constraints
    }, null, 2),
    '',
    'ResearchBudget：',
    JSON.stringify({
      preset: input.budget.preset,
      reasoningEffort: input.budget.reasoningEffort,
      minSources: input.budget.minSources,
      targetSources: input.budget.targetSources,
      maxSources: input.budget.maxSources,
      maxResearchRounds: input.budget.maxResearchRounds
    }, null, 2),
    '',
    'ResearchFrame：',
    JSON.stringify({
      coreResearchThread: input.frame.coreResearchThread,
      centralQuestion: input.frame.centralQuestion,
      coreQuestions: input.frame.coreQuestions,
      evidenceNeeded: input.frame.evidenceNeeded,
      disconfirmingEvidenceNeeded: input.frame.disconfirmingEvidenceNeeded,
      nonGoals: input.frame.nonGoals
    }, null, 2),
    '',
    '确定性校验：',
    JSON.stringify({
      pass: input.deterministicVerdict.pass,
      scores: input.deterministicVerdict.scores,
      blockingIssues: input.deterministicVerdict.blockingIssues,
      warnings: input.deterministicVerdict.warnings
    }, null, 2),
    '',
    '证据摘要：',
    JSON.stringify(buildJudgeEvidenceSummary(input), null, 2),
    '',
    '最终报告 Markdown（已压缩 HTML 引用属性，保留正文结构和 citation id）：',
    compactReportForJudge(input),
    '',
    '返回 JSON schema：',
    '{',
    '  "pass": boolean,',
    '  "scores": {',
    '    "requirementsAlignment": number,',
    '    "answersConfirmedScope": number,',
    '    "followsResearchFrame": number,',
    '    "reportCompleteness": number,',
    '    "evidenceUse": number,',
    '    "citationFaithfulness": number,',
    '    "uncertaintyCalibration": number,',
    '    "writingQuality": number,',
    '    "overall": number',
    '  },',
    '  "rationale": "一句话说明主要判断",',
    '  "blockingIssues": ["阻塞性问题"],',
    '  "warnings": ["非阻塞问题"],',
    '  "recommendedFixes": ["建议修复"]',
    '}'
  ].join('\n')
}

export function parseQualityJudgeVerdict(
  raw: string,
  meta: {
    source: QualityJudgeVerdict['source']
    model?: string
    judgedAt: string
  }
): QualityJudgeVerdict {
  const json = extractFirstJsonObject(raw)
  if (!json) throw new Error('Quality judge response did not contain JSON')
  const value = JSON.parse(json) as Record<string, unknown>
  const scores = isRecord(value.scores) ? value.scores : {}
  const normalizedScores = {
    requirementsAlignment: numberScore(scores.requirementsAlignment),
    answersConfirmedScope: numberScore(scores.answersConfirmedScope),
    followsResearchFrame: numberScore(scores.followsResearchFrame),
    reportCompleteness: numberScore(scores.reportCompleteness),
    evidenceUse: numberScore(scores.evidenceUse),
    citationFaithfulness: numberScore(scores.citationFaithfulness),
    uncertaintyCalibration: numberScore(scores.uncertaintyCalibration),
    writingQuality: numberScore(scores.writingQuality),
    overall: numberScore(scores.overall)
  }
  const pass = booleanValue(value.pass) ?? normalizedScores.overall >= 0.75
  return {
    source: meta.source,
    ...(meta.model ? { model: meta.model } : {}),
    pass,
    scores: normalizedScores,
    rationale: stringValue(value.rationale) || 'LLM Judge 已完成评分。',
    blockingIssues: normalizeStringArray(value.blockingIssues, 8),
    warnings: normalizeStringArray(value.warnings, 8),
    recommendedFixes: normalizeStringArray(value.recommendedFixes, 8),
    judgedAt: meta.judgedAt
  }
}

function heuristicJudge(
  input: QualityJudgeInput,
  judgedAt: string,
  source: QualityJudgeVerdict['source']
): QualityJudgeVerdict {
  const report = input.reportMarkdown
  const includesCoreThread = report.includes(input.frame.coreResearchThread)
  const answeredQuestions = input.frame.coreQuestions.filter((question) => report.includes(question.text)).length
  const questionRatio = input.frame.coreQuestions.length === 0 ? 1 : answeredQuestions / input.frame.coreQuestions.length
  const citationRatio = input.citations.length > 0 ? 1 : 0
  const completeness = ['## 摘要', '## 调研范围与方法', '## 主要发现', '## 结论', '## 局限与不确定性']
    .filter((section) => report.includes(section)).length / 5
  const requirementsAlignment = includesCoreThread ? 0.8 : 0.45
  const overall = average([
    requirementsAlignment,
    questionRatio,
    includesCoreThread ? 0.85 : 0.45,
    completeness,
    citationRatio,
    citationRatio,
    report.includes('局限') ? 0.85 : 0.5,
    report.trim().length > 400 ? 0.75 : 0.45
  ])
  const blockingIssues = overall >= 0.65 ? [] : ['启发式评分认为报告未充分满足已确认需求。']
  return {
    source,
    pass: blockingIssues.length === 0,
    scores: {
      requirementsAlignment,
      answersConfirmedScope: questionRatio,
      followsResearchFrame: includesCoreThread ? 0.85 : 0.45,
      reportCompleteness: completeness,
      evidenceUse: citationRatio,
      citationFaithfulness: citationRatio,
      uncertaintyCalibration: report.includes('局限') ? 0.85 : 0.5,
      writingQuality: report.trim().length > 400 ? 0.75 : 0.45,
      overall
    },
    rationale: '启发式评分基于报告结构、核心主线、核心问题覆盖和引用存在性计算。',
    blockingIssues,
    warnings: ['当前评分未使用 LLM Judge，仅作为兜底。'],
    recommendedFixes: blockingIssues.length > 0 ? ['补齐核心问题、证据引用和完整报告结构后重新生成。'] : [],
    judgedAt
  }
}

async function collectJudgeText(
  stream: AsyncIterable<ModelStreamChunk>,
  signal: AbortSignal
): Promise<string> {
  let text = ''
  let reasoning = ''
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('quality judge timed out')
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'assistant_reasoning_delta') reasoning += chunk.text
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  const output = text.trim() || reasoning.trim()
  if (!output) throw new Error('quality judge returned empty text')
  return output
}

function fitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n[TRUNCATED ${value.length - maxChars} chars]`
}

function buildJudgeEvidenceSummary(input: QualityJudgeInput): Record<string, unknown> {
  const citedSpanIds = new Set(input.citations.flatMap((citation) => citation.evidenceSpanIds))
  const citedClaimIds = new Set(input.citations.map((citation) => citation.claimId).filter((id): id is string => Boolean(id)))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const citedSpans = [...citedSpanIds]
    .map((spanId) => spanById.get(spanId))
    .filter((span): span is EvidenceSpan => Boolean(span))
    .slice(0, 24)
  const citedSourceIds = new Set(citedSpans.map((span) => span.sourceId))
  const citedSources = [...citedSourceIds]
    .map((sourceId) => sourceById.get(sourceId))
    .filter((source): source is SourceRecord => Boolean(source))
    .slice(0, 16)
  const citedClaims = [...citedClaimIds]
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is AtomicClaim => Boolean(claim))
    .slice(0, 24)
  const citedNotes = input.notes
    .filter((note) => note.claimIds.some((claimId) => citedClaimIds.has(claimId)))
    .slice(0, 12)
  return {
    counts: {
      sourceCount: input.sources.length,
      noteCount: input.notes.length,
      claimCount: input.claims.length,
      evidenceSpanCount: input.evidenceSpans.length,
      citationCount: input.citations.length,
      citedSourceCount: citedSources.length,
      citedClaimCount: citedClaims.length,
      citedEvidenceSpanCount: citedSpans.length
    },
    sourceQuality: {
      byReliability: countBy(input.sources.map((source) => source.reliability)),
      byType: countBy(input.sources.map((source) => source.sourceType)),
      lowOrUnknownSourceIds: input.sources
        .filter((source) => source.reliability === 'low' || source.reliability === 'unknown')
        .map((source) => source.id)
        .slice(0, 12)
    },
    citations: input.citations.slice(0, 32).map((citation) => ({
      id: citation.id,
      status: citation.status,
      claimId: citation.claimId,
      evidenceSpanIds: citation.evidenceSpanIds.slice(0, 4),
      reportClaimText: fitText(cleanJudgeText(citation.reportClaimText), 180)
    })),
    citedSources: citedSources.map((source) => ({
      id: source.id,
      sourceType: source.sourceType,
      title: fitText(cleanJudgeText(source.title), 160),
      publisher: source.publisher,
      url: source.canonicalUrl ?? source.originalUrl,
      reliability: source.reliability,
      sourcePolicyTags: source.sourcePolicyTags.slice(0, 8)
    })),
    citedClaims: citedClaims.map((claim) => ({
      id: claim.id,
      text: fitText(cleanJudgeText(claim.text), 220),
      confidence: claim.confidence,
      critical: claim.critical,
      supportSpanIds: claim.supportSpanIds.slice(0, 4)
    })),
    citedEvidenceSpans: citedSpans.map((span) => ({
      id: span.id,
      sourceId: span.sourceId,
      text: fitText(cleanJudgeText(span.text), 240)
    })),
    citedNotes: citedNotes.map((note) => ({
      questionIds: note.questionIds,
      claimIds: note.claimIds.filter((claimId) => citedClaimIds.has(claimId)).slice(0, 4),
      summary: fitText(cleanJudgeText(note.summary), 180),
      implicationForBrief: fitText(cleanJudgeText(note.implicationForBrief), 220),
      limitations: note.limitations.map(cleanJudgeText).filter(Boolean).slice(0, 4)
    }))
  }
}

function compactReportForJudge(input: QualityJudgeInput): string {
  const normalized = normalizeReportMarkdownForJudge(input.reportMarkdown)
  const limit = reportJudgeCharLimit(input.budget)
  if (normalized.length <= limit) return normalized
  const title = normalized.match(/^#\s+.+$/m)?.[0] ?? ''
  const sections = [
    title,
    compactSection(normalized, '摘要', 700),
    compactSection(normalized, '调研范围与方法', 500),
    compactSection(normalized, '主要发现', Math.floor(limit * 0.55)),
    compactSection(normalized, '结论与建议', Math.floor(limit * 0.22)),
    compactSection(normalized, '局限与不确定性', Math.floor(limit * 0.16)),
    compactSection(normalized, '后续研究建议', Math.floor(limit * 0.07))
  ].filter(Boolean)
  const compacted = sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  return compacted.length <= limit ? compacted : fitText(compacted, limit)
}

function normalizeReportMarkdownForJudge(markdown: string): string {
  return markdown
    .replace(/<sup\s+data-citation-id="([^"]+)"[^>]*>\s*<a[^>]*>\[[^\]]+\]<\/a>\s*<\/sup>/g, '[$1]')
    .replace(/<sup\s+data-citation-id="([^"]+)"[^>]*>\[[^\]]+\]<\/sup>/g, '[$1]')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function compactSection(markdown: string, title: string, maxChars: number): string {
  const body = sectionBody(markdown, title)
  if (!body) return ''
  return `## ${title}\n\n${fitText(body, maxChars)}`
}

function sectionBody(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const collected: string[] = []
  let collecting = false
  for (const line of lines) {
    const heading = line.trim().match(/^##\s+(.+?)\s*$/)?.[1]?.trim()
    if (heading && (heading === title || heading.startsWith(`${title}：`) || heading.startsWith(`${title}:`))) {
      collecting = true
      continue
    }
    if (collecting && /^##\s+/.test(line.trim())) break
    if (collecting) collected.push(line)
  }
  return collected.join('\n').trim()
}

function reportJudgeCharLimit(budget: ResearchBudget): number {
  if (budget.preset === 'deep') return 12_000
  if (budget.preset === 'standard') return 9_000
  return 6_000
}

function cleanJudgeText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-->+/g, ' ')
    .replace(/(?:Skip to main content|Toggle navigation|Main navigation)\s*/gi, ' ')
    .replace(/(?:浏览器不被支持|下载APP|下载客户端|登录|注册|媒体矩阵|爆料专线)\s*/g, ' ')
    .trim()
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end >= start ? raw.slice(start, end + 1) : null
}

function normalizeStringArray(value: unknown, limit: number): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\n|；|;/) : []
  return values
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, limit)
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

function numberScore(value: unknown): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(1, numeric))
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hashJudgeInput(input: QualityJudgeInput): string {
  const text = `${input.brief.topic}\n${input.frame.coreResearchThread}\n${input.reportMarkdown}`
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}
