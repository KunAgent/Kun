/**
 * [INPUT]: 依赖 research core/evidence 类型，接收最终 Markdown、sources、claims、evidence spans 与 citations
 * [OUTPUT]: 对外提供 QualityVerifier，用确定性规则、覆盖矩阵缺口和引用完整性评估报告是否满足 DeepResearch 基线
 * [POS]: research/verification 的本地质量门，位于 SynthesisWriter 与最终产物写入之间
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  ResearchBrief,
  ResearchBudget,
  ResearchFrame,
  ResearchGapVerdict,
  ResearchPlan,
  QualityVerdict,
  VerificationIssue
} from '../core/types.js'
import type { AtomicClaim, CitationBinding, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'

export type QualityVerifierInput = {
  brief: ResearchBrief
  frame: ResearchFrame
  plan: ResearchPlan
  budget: ResearchBudget
  reportMarkdown: string
  notes: ResearchNote[]
  sources?: SourceRecord[]
  claims: AtomicClaim[]
  evidenceSpans: EvidenceSpan[]
  citations: CitationBinding[]
  gapVerdicts?: ResearchGapVerdict[]
  unresolvedCitationIds: string[]
  nowIso: string
}

export class QualityVerifier {
  verify(input: QualityVerifierInput): QualityVerdict {
    const issues: VerificationIssue[] = []
    const spansById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
    const sourcesById = new Map((input.sources ?? []).map((source) => [source.id, source]))
    const spanIds = new Set(spansById.keys())
    const bindingIds = new Set(input.citations.map((binding) => binding.id))

    for (const citationId of extractCitationRefs(input.reportMarkdown)) {
      if (!bindingIds.has(citationId)) {
        issues.push(blocking('broken_citation', `报告引用了不存在的引用绑定 ${citationId}`))
      }
    }

    for (const unresolved of input.unresolvedCitationIds) {
      if (unresolved.startsWith('model_fallback:')) {
        issues.push(blocking('model_fallback_citation', `引用占位符只指向模型生成资料卡，不能作为 DeepResearch 引用证据：${unresolved}`))
      } else {
        issues.push(blocking('unresolved_citation', `引用占位符无法解析：${unresolved}`))
      }
    }

    for (const binding of input.citations) {
      if (binding.evidenceSpanIds.length === 0) {
        issues.push(blocking('empty_citation_span', `引用 ${binding.id} 没有关联任何证据片段`))
      }
      for (const spanId of binding.evidenceSpanIds) {
        if (!spanIds.has(spanId)) {
          issues.push(blocking('missing_evidence_span', `引用 ${binding.id} 指向了缺失的证据片段 ${spanId}`))
          continue
        }
        const source = sourcesById.get(spansById.get(spanId)?.sourceId ?? '')
        if (source && !canCiteSource(source)) {
          issues.push(blocking('model_fallback_citation', `引用 ${binding.id} 指向模型生成资料卡，不能作为 DeepResearch 引用证据`))
        }
      }
    }

    for (const question of input.frame.coreQuestions) {
      if (!(question.required || question.priority === 'high')) continue
      const covered = input.notes.some((note) => note.questionIds.includes(question.id))
      if (!covered) {
        issues.push(blocking('required_question_uncovered', `必要问题没有被调研笔记覆盖：${question.text}`))
      }
    }

    for (const claim of input.claims) {
      const missingSupport = claim.supportSpanIds.length === 0 ||
        !claim.supportSpanIds.some((spanId) => canUseSpanAsEvidence(spanId, spansById, sourcesById))
      if (claim.critical && missingSupport) {
        issues.push(blocking('critical_unsupported_claim', `关键论断缺少支持证据：${claim.text}`))
      }
    }

    if (!hasAnySection(input.reportMarkdown, ['摘要', 'Executive Summary'])) {
      issues.push(blocking('missing_executive_summary', '报告缺少“## 摘要”部分'))
    }
    if (!hasAnySection(input.reportMarkdown, ['调研范围与方法', 'Scope and Method'])) {
      issues.push(blocking('missing_scope_method', '报告缺少“## 调研范围与方法”部分'))
    }
    if (!hasAnySection(input.reportMarkdown, ['主要发现', 'Findings'])) {
      issues.push(blocking('missing_findings', '报告缺少“## 主要发现”部分'))
    }
    if (hasAnySection(input.reportMarkdown, ['核心问题与回答', '证据链'])) {
      issues.push(blocking('hidden_section_visible', '报告包含不应展示给用户的内部章节'))
    }
    for (const clarification of input.brief.userClarifications ?? []) {
      if (!clarificationCovered(input.reportMarkdown, clarification)) {
        issues.push(blocking('user_clarification_uncovered', `报告没有覆盖用户补充要求：${clarification}`))
      }
    }
    const minimumChars = minReportChars(input)
    if (countMeaningfulChars(stripBudgetNeutralSections(input.reportMarkdown)) < minimumChars) {
      issues.push(blocking('report_too_short', `报告内容过短，至少需要约 ${minimumChars} 个有效字符来覆盖已确认的研究问题`))
    }
    if (input.plan.tasks.reduce((sum, task) => sum + task.maxSources, 0) > input.budget.maxSources) {
      issues.push(blocking('source_budget_exceeded', '调研计划超过来源数量预算'))
    }
    const validCitationBindings = input.citations.filter((binding) =>
      binding.status === 'verified' &&
      binding.evidenceSpanIds.length > 0 &&
      binding.evidenceSpanIds.every((spanId) => canUseSpanAsEvidence(spanId, spansById, sourcesById))
    )
    if (input.brief.sourcePolicy.requireCitations !== false && validCitationBindings.length === 0) {
      issues.push(blocking('missing_citations', '报告缺少引用绑定'))
    }
    const latestGap = latestGapVerdict(input.gapVerdicts)
    if (latestGap?.status === 'budget_exhausted' && shouldBlockBudgetExhausted(input, latestGap)) {
      issues.push(blocking(
        'research_budget_exhausted',
        `证据收集未达到 ${input.budget.preset} preset 的最低完成标准：${latestGap.stopReason}`
      ))
    }
    const blockingIssues = issues.filter((issue) => issue.severity === 'blocking').map((issue) => issue.message)
    const warnings = issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message)
    const coveredRequired = input.frame.coreQuestions
      .filter((question) => question.required || question.priority === 'high')
      .filter((question) => input.notes.some((note) => note.questionIds.includes(question.id))).length
    const requiredCount = input.frame.coreQuestions.filter((question) => question.required || question.priority === 'high').length
    const citationAccuracy = input.citations.length === 0
      ? 0
      : validCitationBindings.length / input.citations.length
    const reportCompleteness = scoreReportCompleteness(input.reportMarkdown)
    const sourceQuality = input.sources ? sourceQualityScore(input.sources) : 0.7
    const followsCoreResearchThread = input.reportMarkdown.includes(input.frame.coreResearchThread) ? 1 : 0.5

    return {
      pass: blockingIssues.length === 0,
      scores: {
        requirementsAlignment: followsCoreResearchThread,
        answersCoreQuestions: requiredCount === 0 ? 1 : coveredRequired / requiredCount,
        followsCoreResearchThread,
        reportCompleteness,
        citationAccuracy,
        evidenceCoverage: input.claims.length === 0
          ? 0
          : input.claims.filter((claim) => claim.supportSpanIds.some((spanId) => canUseSpanAsEvidence(spanId, spansById, sourcesById))).length / input.claims.length,
        sourceQuality,
        conflictHandling: 0.7,
        uncertaintyCalibration: hasAnySection(input.reportMarkdown, ['局限与不确定性', 'Caveats']) ? 1 : 0.5,
        writingQuality: input.reportMarkdown.trim().length > 0 ? 0.7 : 0,
        llmJudgeOverall: 0
      },
      blockingIssues,
      warnings,
      recommendedFixes: blockingIssues.length > 0 ? ['先修复阻塞性校验问题，再写入最终报告产物。'] : [],
      issues,
      verifiedAt: input.nowIso
    }
  }
}

function isStrongWebSource(source: SourceRecord): boolean {
  return source.sourceType === 'web' &&
    source.sourcePolicyTags.includes('web_fetch') &&
    source.sourcePolicyTags.includes('strong_web_evidence') &&
    canCiteSource(source)
}

function canUseSpanAsEvidence(
  spanId: string,
  spansById: Map<string, EvidenceSpan>,
  sourcesById: Map<string, SourceRecord>
): boolean {
  const span = spansById.get(spanId)
  if (!span) return false
  const source = sourcesById.get(span.sourceId)
  if (!source) return true
  return canCiteSource(source)
}

function canCiteSource(source: SourceRecord): boolean {
  return source.kind !== 'model_fallback' &&
    !source.sourcePolicyTags.includes('model_generated') &&
    !source.sourcePolicyTags.includes('requires_external_verification')
}

function sourceQualityScore(sources: SourceRecord[]): number {
  if (sources.length === 0) return 0
  const strongWebCount = sources.filter(isStrongWebSource).length
  const reliableCount = sources.filter((source) => source.reliability === 'high' || source.sourcePolicyTags.includes('official')).length
  const strongWebScore = strongWebCount / sources.length
  const reliabilityScore = reliableCount / sources.length
  return Math.max(0.2, Math.min(1, strongWebScore * 0.7 + reliabilityScore * 0.3))
}

function scoreReportCompleteness(markdown: string): number {
  const requiredSections = [
    ['摘要', 'Executive Summary'],
    ['调研范围与方法', 'Scope and Method'],
    ['主要发现', 'Findings'],
    ['结论', 'Conclusion'],
    ['局限与不确定性', 'Caveats']
  ]
  const present = requiredSections.filter((titles) => hasAnySection(markdown, titles)).length
  const sectionScore = present / requiredSections.length
  const lengthScore = Math.min(1, countMeaningfulChars(stripBudgetNeutralSections(markdown)) / 1_800)
  return Math.min(sectionScore, Math.max(0.35, lengthScore))
}

function hasAnySection(markdown: string, titles: string[]): boolean {
  return titles.some((title) => markdown.includes(`## ${title}`))
}

function extractCitationRefs(markdown: string): string[] {
  const refs = new Set<string>()
  const footnoteRe = /\[\^([^\]]+)\](?!:)/g
  for (let match = footnoteRe.exec(markdown); match; match = footnoteRe.exec(markdown)) {
    refs.add(match[1] ?? '')
  }
  const inlineRe = /data-citation-id=["']([^"']+)["']/g
  for (let match = inlineRe.exec(markdown); match; match = inlineRe.exec(markdown)) {
    refs.add(match[1] ?? '')
  }
  refs.delete('')
  return [...refs]
}

function blocking(code: string, message: string): VerificationIssue {
  return { code, message, severity: 'blocking' }
}

function latestGapVerdict(gapVerdicts: ResearchGapVerdict[] | undefined): ResearchGapVerdict | undefined {
  return gapVerdicts?.[gapVerdicts.length - 1]
}

function shouldBlockBudgetExhausted(input: QualityVerifierInput, latestGap: ResearchGapVerdict): boolean {
  if (input.budget.preset === 'quick') return false
  const uncoveredRequired = latestGap.coverageByQuestion.filter((coverage) =>
    (coverage.required || coverage.priority === 'high') && !coverage.covered
  )
  return latestGap.missingEvidence.length > 0 ||
    uncoveredRequired.length > 0
}

function clarificationCovered(markdown: string, clarification: string): boolean {
  const normalizedMarkdown = markdown.toLowerCase()
  const terms = clarification
    .replace(/^补充说明[:：]/, '')
    .split(/[；;，,。、！（）()\[\]【】\n\r\t\s及和与或的]+/)
    .map((part) => part.replace(/^(回答|问题|选项)[:：]/, '').trim())
    .filter((part) => part.length >= 2 && !/^\d+$/.test(part))
  if (terms.length === 0) return true
  return terms.some((term) => normalizedMarkdown.includes(term.toLowerCase()))
}

function minReportChars(input: QualityVerifierInput): number {
  const presetBase = input.budget.preset === 'deep'
    ? 2_400
    : input.budget.preset === 'standard'
      ? 1_800
      : 900
  const base = input.frame.coreQuestions.length >= 3 ? presetBase : Math.min(presetBase, 1_200)
  const questionWeight = input.frame.coreQuestions.length * 260
  const taskWeight = input.plan.tasks.length * 120
  const evidenceWeight = Math.min(700, input.evidenceSpans.length * 90)
  const ceiling = input.budget.preset === 'deep' ? 3_800 : input.budget.preset === 'standard' ? 2_800 : 1_600
  return Math.min(ceiling, Math.max(base, 650 + questionWeight + taskWeight + evidenceWeight))
}

function countMeaningfulChars(markdown: string): number {
  return markdown
    .replace(/<[^>]+>/g, '')
    .replace(/\[claim:[^\]]+\]/g, '')
    .replace(/[`*_#[\](){}|>~\-\s:：，。、；;,.!?！？]/g, '')
    .length
}

function stripBudgetNeutralSections(markdown: string): string {
  const lines = markdown.split('\n')
  const kept: string[] = []
  let skipping = false

  for (const line of lines) {
    const heading = secondLevelHeadingTitle(line)
    if (heading && ['摘要', 'Executive Summary', '调研范围与方法', 'Scope and Method'].some((title) => heading === title || heading.startsWith(`${title}：`) || heading.startsWith(`${title}:`))) {
      skipping = true
      continue
    }
    if (skipping && secondLevelHeadingTitle(line)) {
      skipping = false
    }
    if (!skipping) kept.push(line)
  }

  return kept.join('\n')
}

function secondLevelHeadingTitle(line: string): string | undefined {
  const match = line.trim().match(/^##\s+(.+?)\s*$/)
  return match?.[1]?.replace(/[*`#]/g, '').trim()
}
