/**
 * [INPUT]: 依赖 research core/evidence 类型，接收最终 Markdown、ResearchNote 章节归属、sources、claims、evidence spans 与 citations
 * [OUTPUT]: 对外提供 QualityVerifier，用按 note 归属的显式范围覆盖、由必答章节综合而不重复要求独立笔记的中央问题、引用与数字硬校验（含成品跨语言同币种金额数学等价）、正文裸 URL、跨核心章节近义证据句、残句、抽取乱码和 deep 章节深度的确定性发布安全门；standard 深度由模型 Writer 硬验并在最终门复核提醒
 * [POS]: research/verification 的本地质量门，以证据和结构判断可发布性，但不强迫每章书写模板化边界句
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  ResearchBrief,
  ResearchBudget,
  ResearchCoverageContract,
  ResearchFrame,
  ResearchGapVerdict,
  ResearchPlan,
  ResearchReportBlueprint,
  ResearchReportContract,
  QualityVerdict,
  VerificationIssue
} from '../core/types.js'
import {
  coverageTextMatches,
  evaluateCoverageRequirementEvidence,
  isCoverageRequirementExhausted
} from '../core/coverage.js'
import { reportConclusionDepthIssue, reportLimitationsDepthIssue } from '../core/report-closing.js'
import {
  minimumReportArgumentChars,
  reportArgumentMeetsDepth,
  reportArgumentSignals,
  requiredConditionalContextClaimCount
} from '../core/report-argument.js'
import type { AtomicClaim, CitationBinding, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'
import { canCiteEvidenceSpan, coversResearchDimensionFocusGroups, isEligibleStrongWebEvidence, isResearchTextRelevant, researchDimensionFocusGroups, uniqueEvidenceSources } from '../evidence/EvidenceEligibility.js'
import { isUserScopeNumericBoundary, unsupportedTranslatedNumericTokens } from '../evidence/ClaimSupport.js'
import { centralResearchQuestionId } from '../runtime/ResearchPreflightGate.js'
import {
  containsExtractionBoilerplate,
  hasExplicitEvidenceGapBoundary,
  reportBodyUrlIssue,
  uncitedReportSentences
} from '../evidence/CitationProximity.js'
import { reportPublicationSafetyIssues } from './ReportPublicationSafety.js'

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
  reportContract?: ResearchReportContract
  reportBlueprint?: ResearchReportBlueprint
  coverageContract?: ResearchCoverageContract
  gapVerdicts?: ResearchGapVerdict[]
  unresolvedCitationIds: string[]
  nowIso: string
}

export type ReportArgumentEvidenceContext = {
  claims: AtomicClaim[]
  citations: CitationBinding[]
  evidenceGapSectionIds?: string[]
}

export class QualityVerifier {
  verify(input: QualityVerifierInput): QualityVerdict {
    const issues: VerificationIssue[] = []
    const spansById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
    const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]))
    const sourcesById = new Map((input.sources ?? []).map((source) => [source.id, source]))
    const spanIds = new Set(spansById.keys())
    const bindingIds = new Set(input.citations.flatMap((binding) => [
      binding.id,
      ...(binding.displayIds ?? (binding.displayId ? [binding.displayId] : []))
    ]))
    const citedClaimIds = new Set(input.citations.flatMap((binding) =>
      binding.claimIds ?? (binding.claimId ? [binding.claimId] : [])
    ))
    const latestGap = latestGapVerdict(input.gapVerdicts)
    const exhaustedCoverageQuestionIds = exhaustedQuestionIdsFromGapVerdicts(input.gapVerdicts)

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
        const span = spansById.get(spanId)
        const source = sourcesById.get(span?.sourceId ?? '')
        if (!canCiteEvidenceSpan(span, source)) {
          issues.push(blocking('model_fallback_citation', `引用 ${binding.id} 指向模型生成资料卡、兜底抽取片段或其他不可用证据，不能作为 DeepResearch 引用证据`))
        }
      }
    }

    for (const group of citationGroupsByReportText(input.citations)) {
      const supportTexts = group.flatMap((binding) =>
        binding.evidenceSpanIds.map((spanId) => spansById.get(spanId)?.text ?? '')
      ).filter(Boolean)
      const reportClaimText = group[0]?.reportClaimText ?? ''
      const unsupportedNumbers = unsupportedTranslatedNumericTokens(reportClaimText, supportTexts)
        .filter((token) => !isUserScopeNumericBoundary(reportClaimText, token, userScopeTexts(input)))
      if (unsupportedNumbers.length > 0) {
        issues.push(blocking(
          'unsupported_citation_number',
          `报告引用句包含证据链未支持的数字：${unsupportedNumbers.join('、')}。请删除该数字、改为定性判断，或补充直接证据。`
        ))
      }
    }

    const explicitCoverage = input.coverageContract
      ? evaluateCoverageRequirementEvidence({
          contract: input.coverageContract,
          claims: input.claims,
          evidenceSpans: input.evidenceSpans,
          sources: input.sources ?? [],
          notes: input.notes
        })
      : []
    for (const coverage of explicitCoverage) {
      const requirement = input.coverageContract?.requirements.find((candidate) => candidate.id === coverage.requirementId)
      if (!requirement) continue
      if (requirement.kind === 'dimension') continue
      if (requirement.kind === 'time_window' || requirement.kind === 'forecast_horizon') {
        if (!coverageTextMatches(requirement, input.reportMarkdown)) {
          issues.push(requirement.onMissing === 'allow_limitation'
            ? warning('report_scope_obligation_missing', `报告没有显式回应用户范围要求「${requirement.label}」。`)
            : blocking('report_scope_obligation_missing', `报告没有显式回应用户范围要求「${requirement.label}」。`))
        }
        continue
      }
      if (!coverage.covered) {
        if (isCoverageRequirementExhausted(requirement, exhaustedCoverageQuestionIds)) {
          if (reportAcknowledgesCoverageEvidenceGap(input.reportMarkdown, requirement)) {
            issues.push(warning(
              'required_coverage_evidence_exhausted',
              `用户硬性范围项「${coverage.label}」${coverageRequirementLocation(requirement, input.reportBlueprint)}补研已穷尽，报告已明确保留结论。`
            ))
          } else {
            issues.push(blocking(
              'required_coverage_limitation_missing',
              `用户硬性范围项「${coverage.label}」${coverageRequirementLocation(requirement, input.reportBlueprint)}补研已穷尽，但报告没有明确说明无法形成可靠结论且其他材料不能替代。`
            ))
          }
          continue
        }
        if (coverage.onMissing !== 'allow_limitation') {
          issues.push(blocking('required_coverage_evidence_missing', `用户硬性范围项「${coverage.label}」没有合格证据。`))
        }
        continue
      }
      const reportCovered = coverage.claimIds.some((claimId) => citedClaimIds.has(claimId)) ||
        (input.budget.preset === 'quick' && requirement.kind === 'comparison_target' && coverageTextMatches(requirement, input.reportMarkdown))
      if (!reportCovered && coverage.onMissing !== 'allow_limitation') {
        issues.push(blocking(
          'required_coverage_not_delivered',
          `证据库已覆盖「${coverage.label}」${coverageRequirementLocation(requirement, input.reportBlueprint)}，但最终报告没有使用其对应 claim 和引用。`
        ))
      }
    }

    if (input.budget.preset !== 'quick' && input.brief.sourcePolicy.requireCitations !== false) {
      for (const sentence of uncitedReportSentences(input.reportMarkdown).slice(0, 8)) {
        issues.push(blocking(
          'uncited_factual_sentence',
          `主要发现或结论包含没有就近引用的事实句：${sentence}`
        ))
      }
    }

    const enforceQuestionCoverage = input.budget.preset !== 'quick'
    const requiredEvidenceQuestions = requiredQuestionsForEvidenceCoverage(input)
    if (enforceQuestionCoverage) {
      for (const question of requiredEvidenceQuestions) {
        const covered = questionCoveredByResearch(question.id, input.notes, latestGap)
          || directEvidenceCoversQuestion(
            question.id,
            input.reportMarkdown,
            input.reportBlueprint,
            input.citations
          )
          || conditionalApplicationCoversQuestion(
            question.id,
            input.reportMarkdown,
            input.reportBlueprint,
            input.citations
          )
          || evidenceGapCoversQuestion(
            question.id,
            input.reportMarkdown,
            input.reportBlueprint
          )
        if (!covered) {
          issues.push(blocking('required_question_uncovered', `必要问题没有被调研笔记覆盖：${question.text}`))
        }
      }
    }

    for (const claim of input.claims) {
      const missingSupport = claim.supportSpanIds.length === 0 ||
        !claim.supportSpanIds.some((spanId) => canUseSpanAsEvidence(spanId, spansById, sourcesById))
      if (claim.critical && citedClaimIds.has(claim.id) && missingSupport) {
        issues.push(blocking('critical_unsupported_claim', `关键论断缺少支持证据：${claim.text}`))
      }
    }

    if (!hasAnySection(input.reportMarkdown, ['摘要', 'Executive Summary'])) {
      issues.push(blocking('missing_executive_summary', '报告缺少“## 摘要”部分'))
    }
    const reportTitle = input.reportMarkdown.match(/^#\s+(.+)$/mu)?.[1]?.trim()
    if (!reportTitle || /(?:\.\.\.|…)\s*$/u.test(reportTitle)) {
      issues.push(blocking('truncated_report_title', '报告标题为空或以截断省略号结尾，不能把展示层裁剪文本作为最终语义标题。'))
    }
    if (!hasAnySection(input.reportMarkdown, ['调研范围与方法', 'Scope and Method'])) {
      issues.push(blocking('missing_scope_method', '报告缺少“## 调研范围与方法”部分'))
    }
    if (!hasAnySection(input.reportMarkdown, ['主要发现', 'Findings'])) {
      issues.push(blocking('missing_findings', '报告缺少“## 主要发现”部分'))
    }
    const conclusionIssue = finalConclusionIssue(input, bindingIds)
    if (conclusionIssue) {
      issues.push(blocking('weak_final_conclusion', conclusionIssue))
    }
    if (hasAnySection(input.reportMarkdown, ['核心问题与回答', '证据链'])) {
      issues.push(blocking('hidden_section_visible', '报告包含不应展示给用户的内部章节'))
    }
    const boilerplateIssue = reportBoilerplateIssue(input.reportMarkdown)
    if (boilerplateIssue) {
      issues.push(blocking('report_contains_extraction_boilerplate', boilerplateIssue))
    }
    const bodyUrl = reportBodyUrlIssue(input.reportMarkdown)
    if (bodyUrl) {
      issues.push(blocking('report_contains_bare_url', `报告正文包含裸 URL 或模型自建链接：${bodyUrl}`))
    }
    for (const publicationIssue of reportPublicationSafetyIssues(input.reportMarkdown, input.citations)) {
      issues.push(blocking('report_publication_safety', publicationIssue))
    }
    const proseQualityIssues = reportProseQualityIssues(input.reportMarkdown)
    const argumentQualityIssues = input.budget.preset === 'quick'
      ? []
      : reportArgumentQualityIssues(input.reportMarkdown, input.reportContract, [
          input.brief.topic,
          input.frame.coreResearchThread,
          input.frame.centralQuestion,
          ...input.frame.coreQuestions.map((question) => question.text)
        ].join('\n'), {
          claims: input.claims,
          citations: input.citations,
          evidenceGapSectionIds: input.reportBlueprint?.sections
            .filter((section) => section.evidenceMode === 'evidence_gap')
            .map((section) => section.id)
        })
    for (const proseIssue of proseQualityIssues) {
      issues.push(blocking('report_prose_structure', proseIssue))
    }
    for (const argumentIssue of argumentQualityIssues) {
      issues.push(input.budget.preset === 'deep'
        ? blocking('report_argument_depth', argumentIssue)
        : warning('report_argument_depth_advisory', argumentIssue))
    }
    const limitationsBody = sectionBodyByTitles(input.reportMarkdown, ['局限与不确定性', 'Caveats', 'Limitations'])
    const limitationsIssue = reportLimitationsDepthIssue(input.reportMarkdown, input.budget.preset)
    if (limitationsIssue) issues.push(blocking('empty_limitations', limitationsIssue))
    for (const section of input.reportContract?.requiredSections ?? []) {
      if (section.required && !input.reportMarkdown.includes(section.title)) {
        issues.push(blocking('report_contract_section_missing', `报告缺少必填结构：${section.title}`))
      }
    }
    for (const section of input.reportBlueprint?.sections ?? []) {
      if ((section.contextClaimIds?.length ?? 0) === 0) continue
      const body = thirdLevelSectionBody(input.reportMarkdown, section.title)
      const bodyClaimIds = citedClaimIdsForMarkdown(body, input.citations)
      const hasPrimary = section.claimIds.some((claimId) => bodyClaimIds.has(claimId))
      const hasContext = section.contextClaimIds!.some((claimId) => bodyClaimIds.has(claimId))
      if (section.evidenceMode === 'conditional_application') {
        const usedContextCount = section.contextClaimIds!.filter((claimId) => bodyClaimIds.has(claimId)).length
        const requiredContextCount = requiredConditionalContextClaimCount(section)
        if (usedContextCount < requiredContextCount) {
          issues.push(blocking(
            'conditional_application_context_missing',
            `必填章节「${section.title}」只使用了 ${usedContextCount} 条机制前提，至少需要 ${requiredContextCount} 条。`
          ))
        }
        if (section.claimIds.length > 0 && !hasPrimary) {
          issues.push(blocking(
            'conditional_application_primary_missing',
            `必填章节「${section.title}」已有场景直证，但正文没有使用该主证据。`
          ))
        }
        continue
      }
      if (hasContext && !hasPrimary) {
        issues.push(blocking(
          'contextual_section_primary_missing',
          `必填章节「${section.title}」单独使用了跨章前提，却没有使用本章主证据。跨章前提不能替代本章证据覆盖。`
        ))
      }
    }
    if (input.plan.tasks
      .filter((task) => task.status !== 'done')
      .reduce((sum, task) => sum + task.maxSources, 0) > input.budget.maxSources) {
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
    if (latestGap?.status === 'budget_exhausted' && shouldBlockBudgetExhausted(input, latestGap)) {
      issues.push(blocking(
        'research_budget_exhausted',
        `证据收集未达到 ${input.budget.preset} preset 的最低完成标准：${latestGap.stopReason}`
      ))
    }
    const blockingIssues = issues.filter((issue) => issue.severity === 'blocking').map((issue) => issue.message)
    const warnings = issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message)
    const coveredRequired = requiredEvidenceQuestions
      .filter((question) => questionCoveredByResearch(question.id, input.notes, latestGap)
        || directEvidenceCoversQuestion(question.id, input.reportMarkdown, input.reportBlueprint, input.citations)
        || evidenceGapCoversQuestion(question.id, input.reportMarkdown, input.reportBlueprint)).length
    const requiredCount = requiredEvidenceQuestions.length
    const citationAccuracy = input.citations.length === 0
      ? 0
      : validCitationBindings.length / input.citations.length
    const reportCompleteness = scoreReportCompleteness(input.reportMarkdown)
    const citedSpanIds = new Set(validCitationBindings.flatMap((binding) => binding.evidenceSpanIds))
    const sourceQuality = input.sources ? sourceQualityScore(input.sources, input.evidenceSpans, citedSpanIds) : 0.7
    const supportedCitedClaimCount = [...citedClaimIds].filter((claimId) => claimsById.get(claimId)?.supportSpanIds
      .some((spanId) => canUseSpanAsEvidence(spanId, spansById, sourcesById))).length
    const followsCoreResearchThread = isResearchTextRelevant(input.frame.coreResearchThread, input.reportMarkdown) ? 1 : 0.5

    return {
      pass: blockingIssues.length === 0,
      scores: {
        requirementsAlignment: followsCoreResearchThread,
        answersCoreQuestions: !enforceQuestionCoverage || requiredCount === 0 ? 1 : coveredRequired / requiredCount,
        followsCoreResearchThread,
        reportCompleteness,
        citationAccuracy,
        evidenceCoverage: citedClaimIds.size === 0
          ? 0
          : supportedCitedClaimCount / citedClaimIds.size,
        sourceQuality,
        conflictHandling: 0.7,
        uncertaintyCalibration: countMeaningfulChars(limitationsBody) >= 12 ? 1 : 0.5,
        writingQuality: input.reportMarkdown.trim().length > 0
          ? Math.max(0.2, 1 - proseQualityIssues.length * 0.2 - argumentQualityIssues.length * 0.15)
          : 0,
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

function exhaustedQuestionIdsFromGapVerdicts(verdicts: ResearchGapVerdict[] | undefined): Set<string> {
  const questionIds = new Set((verdicts ?? []).flatMap((verdict) => verdict.exhaustedQuestionIds ?? []))
  const latest = verdicts?.at(-1)
  if (latest?.status === 'unanswerable') {
    for (const coverage of latest.coverageByQuestion) {
      if ((coverage.required || coverage.priority === 'high') && !coverage.covered) questionIds.add(coverage.questionId)
    }
  }
  return questionIds
}

function reportAcknowledgesCoverageEvidenceGap(
  markdown: string,
  requirement: ResearchCoverageContract['requirements'][number]
): boolean {
  return markdown.split(/\n{2,}/u).some((block) =>
    coverageTextMatches(requirement, block) && hasExplicitEvidenceGapBoundary(block)
  )
}

function coverageRequirementLocation(
  requirement: ResearchCoverageContract['requirements'][number],
  blueprint: ResearchReportBlueprint | undefined
): string {
  const sectionTitles = requirement.sectionIds
    .map((sectionId) => blueprint?.sections.find((section) => section.id === sectionId)?.title)
    .filter((title): title is string => Boolean(title))
  return sectionTitles.length > 0
    ? `（章节「${[...new Set(sectionTitles)].join('、')}」，要求 ${requirement.id}）`
    : `（要求 ${requirement.id}）`
}

function userScopeTexts(input: QualityVerifierInput): string[] {
  return [
    input.brief.topic,
    input.brief.userIntent,
    input.frame.centralQuestion,
    input.frame.coreResearchThread,
    ...input.frame.coreQuestions.map((question) => question.text),
    ...(input.brief.userClarifications ?? []),
    ...(input.coverageContract?.requirements.map((requirement) => requirement.label) ?? [])
  ]
}

function isStrongWebSource(source: SourceRecord, spansBySource: Map<string, EvidenceSpan[]>): boolean {
  return (spansBySource.get(source.id) ?? []).some((span) => isEligibleStrongWebEvidence(source, span))
}

function canUseSpanAsEvidence(
  spanId: string,
  spansById: Map<string, EvidenceSpan>,
  sourcesById: Map<string, SourceRecord>
): boolean {
  const span = spansById.get(spanId)
  if (!span) return false
  const source = sourcesById.get(span.sourceId)
  return canCiteEvidenceSpan(span, source)
}

function warning(code: string, message: string): VerificationIssue {
  return { code, message, severity: 'warning' }
}

function sourceQualityScore(sources: SourceRecord[], spans: EvidenceSpan[], citedSpanIds: Set<string>): number {
  const citedSourceIds = new Set(spans.filter((span) => citedSpanIds.has(span.id)).map((span) => span.sourceId))
  const uniqueSources = uniqueEvidenceSources(sources.filter((source) => citedSourceIds.has(source.id)))
  if (uniqueSources.length === 0) return 0
  const spansBySource = spansBySourceId(spans)
  const strongWebCount = uniqueSources.filter((source) => isStrongWebSource(source, spansBySource)).length
  const reliableCount = uniqueSources.filter((source) => source.reliability === 'high' || source.sourcePolicyTags.includes('official')).length
  const strongWebScore = strongWebCount / uniqueSources.length
  const reliabilityScore = reliableCount / uniqueSources.length
  return Math.max(0.2, Math.min(1, strongWebScore * 0.7 + reliabilityScore * 0.3))
}

function spansBySourceId(spans: EvidenceSpan[]): Map<string, EvidenceSpan[]> {
  const bySource = new Map<string, EvidenceSpan[]>()
  for (const span of spans) {
    const bucket = bySource.get(span.sourceId) ?? []
    bucket.push(span)
    bySource.set(span.sourceId, bucket)
  }
  return bySource
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
  return sectionScore
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
  const markdownReferenceRe = /\[(\d+)\](?!:)/g
  for (let match = markdownReferenceRe.exec(markdown); match; match = markdownReferenceRe.exec(markdown)) {
    refs.add(`cit_${match[1] ?? ''}`)
  }
  refs.delete('')
  return [...refs]
}

export function citedClaimIdsForMarkdown(markdown: string, citations: CitationBinding[]): Set<string> {
  const citationIds = new Set(extractCitationRefs(markdown))
  const normalizedBody = normalizeCitationClaimMatchText(markdown)
  return new Set(citations
    .filter((binding) => [
      binding.id,
      ...(binding.displayIds ?? (binding.displayId ? [binding.displayId] : []))
    ].some((id) => citationIds.has(id)))
    .filter((binding) => {
      const claimText = normalizeCitationClaimMatchText(binding.reportClaimText)
      return claimText.length >= 8 && normalizedBody.includes(claimText)
    })
    .flatMap((binding) => binding.claimIds ?? (binding.claimId ? [binding.claimId] : [])))
}

export function conditionalApplicationCoversQuestion(
  questionId: string,
  markdown: string,
  blueprint: ResearchReportBlueprint | undefined,
  citations: CitationBinding[]
): boolean {
  if (!blueprint) return false
  return blueprint.sections
    .filter((section) => section.evidenceMode === 'conditional_application' && section.questionIds.includes(questionId))
    .some((section) => {
      const body = thirdLevelSectionBody(markdown, section.title)
      if (!body) return false
      const usedClaimIds = citedClaimIdsForMarkdown(body, citations)
      const requiredContextCount = requiredConditionalContextClaimCount(section)
      if (requiredContextCount === 0) return false
      const usedContextCount = (section.contextClaimIds ?? [])
        .filter((claimId) => usedClaimIds.has(claimId)).length
      if (usedContextCount < requiredContextCount) return false
      if (section.claimIds.length > 0 && !section.claimIds.some((claimId) => usedClaimIds.has(claimId))) return false
      return /(?:如果|若|当)[^。；;]{2,180}(?:则|就|可以|可|不能|只能)/u.test(body)
        && reportArgumentSignals(body).hasSynthesis
    })
}

export function directEvidenceCoversQuestion(
  questionId: string,
  markdown: string,
  blueprint: ResearchReportBlueprint | undefined,
  citations: CitationBinding[]
): boolean {
  if (!blueprint) return false
  return blueprint.sections
    .filter((section) => section.evidenceMode === 'direct' && section.questionIds.includes(questionId))
    .some((section) => {
      const body = thirdLevelSectionBody(markdown, section.title)
      if (!body) return false
      const usedClaimIds = citedClaimIdsForMarkdown(body, citations)
      return section.claimIds.some((claimId) => usedClaimIds.has(claimId))
    })
}

function normalizeCitationClaimMatchText(value: string): string {
  return value
    .replace(/\[(?:structured-claim|claim|evidence):[^\]]+\]/gu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .replace(/\s+([。，；：！？,.!?:;])/gu, '$1')
    .replace(/([。，；：！？,.!?:;])\s+/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
}

function reportBoilerplateIssue(markdown: string): string | undefined {
  const normalized = markdown.replace(/\s+/g, ' ')
  const reportBodyLines = markdown.split('\n')
    .filter((line) => (
      !/^\s*(?:#{1,6}\s+|\[\d+\]:\s)/u.test(line) &&
      !/^来源(?:仅限|限于).+；研究问题：.+正文逐条绑定依据。?$/u.test(line.trim())
    ))
  const containsLineLevelExtractionNoise = reportBodyLines.some((line) => containsExtractionBoilerplate(line))
  const patterns = [
    /网页来源已抓取，但模型未能抽取结构化证据/u,
    /This operation was aborted/i,
    /Skip to main content/i,
    /Toggle navigation/i,
    /Main navigation/i,
    /--[a-z0-9-]+:\s*[^;]+;/i,
    /<\s*\[CDATA\[/i,
    /浏览器不被支持|下载APP|下载客户端/u
  ]
  return containsLineLevelExtractionNoise || patterns.some((pattern) => pattern.test(normalized))
    ? '报告正文包含网页抽取失败、导航/CSS/CDATA 或客户端噪声，不能作为用户可见 DeepResearch 报告。'
    : undefined
}

export function reportProseQualityIssues(markdown: string): string[] {
  const issues: string[] = []
  const incompleteSynthesis = markdown.split('\n')
    .map((line) => stripReportMarkup(line).trim())
    .find((line) => /^(?:关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看))[，,]/u.test(line)
      && !/[。！？!?；;]$/u.test(line))
  if (incompleteSynthesis) {
    issues.push('报告正文包含以综合连接词开头但没有完成谓语或句末边界的悬空句。')
  }
  const repeatedParagraph = repeatedParagraphWithinThirdLevelSection(markdown)
  if (repeatedParagraph) {
    issues.push(`报告同一核心章节内重复发布了相同段落：${repeatedParagraph.slice(0, 120)}`)
  }
  const conclusion = sectionBodyByTitles(markdown, ['结论与建议', '结论', 'Conclusion', 'Recommendations'])
  const conclusionText = stripReportMarkup(conclusion).trim()
  if (/(?:综合来看|总体而言|总体来看)[，,]\s*(?:而|但是|但)/u.test(conclusionText)) {
    issues.push('报告结论使用了没有前置对照关系的转折连接，形成残缺或拼接式结论。')
  }
  if (conclusionText && /[，,；;：:、]$/u.test(conclusionText)) {
    issues.push('报告结论以逗号、分号或冒号悬空结束，存在未完成句子。')
  }
  if (conclusion.split('\n').some((line) =>
    (line.match(/[；;]/gu)?.length ?? 0) >= 2 && stripReportMarkup(line).length >= 160
  )) {
    issues.push('报告结论在同一段中连续使用多个分号连接独立判断，应拆成完整句子以提高可读性。')
  }
  const limitations = sectionBodyByTitles(markdown, ['局限与不确定性', 'Caveats', 'Limitations'])
  if (/这并不影响核心结论|该边界不影响本报告|不影响本报告关于/u.test(limitations)) {
    issues.push('局限章节包含“这不影响结论”式空泛占位语，没有说明具体缺口和影响。')
  }
  const uncitedRecommendation = limitations
    .split('\n')
    .find((line) => /建议|应当|应该|推荐|优先参考/u.test(line)
      && !/(?:未|没有|并未|缺少|不包含|未覆盖).{0,30}(?:建议|推荐)/u.test(line)
      && !/data-citation-id=|\[\^[^\]]+\]|\[\d+\](?!:)/u.test(line))
  if (uncitedRecommendation) {
    issues.push('局限章节包含没有引用依据的外部建议，必须删除或绑定允许来源。')
  }
  return issues
}

function repeatedParagraphWithinThirdLevelSection(markdown: string): string | undefined {
  const seenBySection = new Map<string, Set<string>>()
  let currentSection = ''
  let paragraph: string[] = []
  const flush = (): string | undefined => {
    const block = paragraph.join('\n').trim()
    paragraph = []
    if (!currentSection || !block || /^\[\d+\]:\s/u.test(block)) return undefined
    const normalized = block
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
      .replace(/\[(?:claim|evidence):[^\]]+\]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
    if (normalized.length < 16) return undefined
    const seen = seenBySection.get(currentSection) ?? new Set<string>()
    if (seen.has(normalized)) return stripReportMarkup(block).trim()
    seen.add(normalized)
    seenBySection.set(currentSection, seen)
    return undefined
  }
  for (const line of markdown.split('\n')) {
    const thirdLevelTitle = line.trim().match(/^###\s+(.+?)\s*$/u)?.[1]?.trim()
    const secondLevelTitle = line.trim().match(/^##\s+(.+?)\s*$/u)?.[1]?.trim()
    if (thirdLevelTitle || secondLevelTitle || !line.trim()) {
      const repeated = flush()
      if (repeated) return repeated
      if (thirdLevelTitle) currentSection = thirdLevelTitle
      else if (secondLevelTitle) currentSection = ''
      continue
    }
    paragraph.push(line)
  }
  return flush()
}

export function reportArgumentQualityIssues(
  markdown: string,
  contract: ResearchReportContract | undefined,
  contextText = '',
  evidenceContext?: ReportArgumentEvidenceContext
): string[] {
  const requiredSections = contract?.requiredSections.filter((section) => section.required) ?? []
  const issues: string[] = []
  for (const section of requiredSections) {
    const body = thirdLevelSectionBody(markdown, section.title)
    if (evidenceContext?.evidenceGapSectionIds?.includes(section.id)) {
      if (countMeaningfulChars(body) < 60 || !hasExplicitEvidenceGapBoundary(body)) {
        issues.push(`必填章节「${section.title}」属于证据缺口交付，但没有明确说明无法形成可靠结论的原因和外推边界。`)
      }
      continue
    }
    const signals = reportArgumentSignals(body)
    const citationOccurrences = [...body.matchAll(/\[(\d+)\](?!:)/gu)]
    const uniqueCitationDisplays = new Set(citationOccurrences.map((match) => match[1]))
    const minimumChars = minimumReportArgumentChars(uniqueCitationDisplays.size)
    const focusGroups = researchDimensionFocusGroups(section.title, contextText)
    const missingFocusGroup = focusGroups.length > 1
      && !coversResearchDimensionFocusGroups(focusGroups, body)
      && !sectionCitationsCoverFocusGroups(focusGroups, body, evidenceContext)
    const genericSparseScaffold = /(?:上述事实只能支持已经明确描述的局部判断|这一判断只限于本章已经引用的对象和条件|其他实现和场景是否相同仍无法由现有材料回答)/u.test(body)
    if (!reportArgumentMeetsDepth({
      markdown: body,
      minimumChars,
      evidenceCount: citationOccurrences.length,
      allowDirectComparison: focusGroups.length > 1,
      allowTerseArgument: false
    })) {
      issues.push(`必填章节「${section.title}」仍是事实摘要，没有形成足够完整的结论、证据、推理与边界论证。`)
    }
    if (citationOccurrences.length === 0) issues.push(`必填章节「${section.title}」没有使用任何已解析引用。`)
    if (!signals.hasSynthesis) issues.push(`必填章节「${section.title}」没有解释证据如何推出局部结论。`)
    if (!signals.hasEvidenceBoundary && signals.sentences < 5) {
      issues.push(`必填章节「${section.title}」篇幅较短且没有说明与本章对象直接相关的证据边界。`)
    }
    if (missingFocusGroup) issues.push(`必填章节「${section.title}」没有实质覆盖标题中的全部概念分面。`)
    if (genericSparseScaffold) issues.push(`必填章节「${section.title}」使用了空泛证据边界，没有说明 claim 的具体前提和未覆盖情形。`)
  }
  return issues
}

function evidenceGapCoversQuestion(
  questionId: string,
  reportMarkdown: string,
  blueprint: ResearchReportBlueprint | undefined
): boolean {
  const section = blueprint?.sections.find((candidate) =>
    candidate.evidenceMode === 'evidence_gap' && candidate.questionIds.includes(questionId)
  )
  if (!section) return false
  const body = thirdLevelSectionBody(reportMarkdown, section.title)
  return countMeaningfulChars(body) >= 60
    && /(?:现有|当前|本次).{0,24}(?:证据|材料).{0,40}(?:不足|没有|未能)|无法.{0,24}(?:形成|得出|判断)|不能.{0,24}(?:结论|外推|回答)/u.test(body)
}

function sectionCitationsCoverFocusGroups(
  focusGroups: string[][],
  body: string,
  evidenceContext: ReportArgumentEvidenceContext | undefined
): boolean {
  if (!evidenceContext || evidenceContext.citations.length === 0) return false
  const citationIds = new Set(extractCitationRefs(body))
  const normalizedBody = normalizeReportProse(body)
  const claimIds = new Set(evidenceContext.citations
    .filter((citation) => citation.status === 'verified')
    .filter((citation) => [citation.id, citation.displayId, ...(citation.displayIds ?? [])]
      .some((id) => Boolean(id) && citationIds.has(id!)))
    .filter((citation) => {
      const reportClaimText = normalizeReportProse(citation.reportClaimText)
      return reportClaimText.length >= 8 && normalizedBody.includes(reportClaimText)
    })
    .flatMap((citation) => citation.claimIds ?? (citation.claimId ? [citation.claimId] : [])))
  if (claimIds.size === 0) return false
  const citedClaimText = evidenceContext.claims
    .filter((claim) => claimIds.has(claim.id))
    .flatMap((claim) => [claim.text, ...claim.entities])
    .join('\n')
  return coversResearchDimensionFocusGroups(focusGroups, citedClaimText)
}

function normalizeReportProse(value: string): string {
  return stripReportMarkup(value).replace(/\s+/gu, '').trim()
}

function thirdLevelSectionBody(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.trim() === `### ${title}`)
  if (start < 0) return ''
  const next = lines.slice(start + 1).findIndex((line) => /^#{2,3}\s+/u.test(line.trim()))
  return lines.slice(start + 1, next < 0 ? lines.length : start + 1 + next).join('\n').trim()
}

function stripReportMarkup(value: string): string {
  return value
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
    .replace(/\[\^[^\]]+\]/gu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .replace(/^[\s\d.*+-]+/gmu, '')
    .replace(/[`*_>#]/gu, '')
    .replace(/\s+/gu, ' ')
}

function finalConclusionIssue(input: QualityVerifierInput, bindingIds: Set<string>): string | undefined {
  const body = sectionBodyByTitles(input.reportMarkdown, ['结论与建议', '结论', 'Conclusion', 'Recommendations'])
  if (!body) return '报告缺少“## 结论与建议”或“## 结论”部分'
  if (countMeaningfulChars(body) === 0) return '报告结论为空，必须给出直接判断和适用边界。'
  if (input.brief.sourcePolicy.requireCitations !== false && input.citations.length > 0) {
    const conclusionCitationIds = extractCitationRefs(body)
    if (!conclusionCitationIds.some((citationId) => bindingIds.has(citationId))) {
      return '报告结论与建议没有引用任何已解析证据，不能只凭总结性语言收束 DeepResearch。'
    }
  }
  const depthIssue = reportConclusionDepthIssue(input.reportMarkdown, input.budget.preset)
  if (depthIssue) return depthIssue
  const coverageIssue = conclusionSectionCoverageIssue(input)
  if (coverageIssue) return coverageIssue
  return undefined
}

export function conclusionSectionCoverageIssue(input: Pick<
  QualityVerifierInput,
  'budget' | 'reportMarkdown' | 'reportBlueprint' | 'citations'
>): string | undefined {
  if (input.budget.preset === 'quick') return undefined
  const evidenceSections = (input.reportBlueprint?.sections ?? []).filter((section) =>
    section.evidenceMode !== 'evidence_gap' && section.claimIds.length > 0
  )
  if (evidenceSections.length < 3) return undefined
  const conclusion = sectionBodyByTitles(input.reportMarkdown, ['结论与建议', '结论', 'Conclusion', 'Recommendations'])
  const normalizedConclusion = normalizeReportProse(conclusion)
  const conclusionClaimIds = new Set(input.citations
    .filter((citation) => {
      const reportClaimText = normalizeReportProse(citation.reportClaimText)
      return reportClaimText.length >= 8 && normalizedConclusion.includes(reportClaimText)
    })
    .flatMap((citation) => citation.claimIds ?? (citation.claimId ? [citation.claimId] : [])))
  const coveredSectionCount = evidenceSections.filter((section) =>
    section.claimIds.some((claimId) => conclusionClaimIds.has(claimId))
  ).length
  const requiredSectionCount = Math.min(3, evidenceSections.length)
  return coveredSectionCount >= requiredSectionCount
    ? undefined
    : `报告结论只综合了 ${coveredSectionCount} 个有证据章节，至少需要综合 ${requiredSectionCount} 个核心章节后再回答整体问题。`
}

function sectionBodyByTitles(markdown: string, titles: string[]): string {
  const lines = markdown.split('\n')
  const collected: string[] = []
  let collecting = false
  for (const line of lines) {
    const title = secondLevelHeadingTitle(line)
    if (title && titles.some((candidate) => title === candidate || title.startsWith(`${candidate}：`) || title.startsWith(`${candidate}:`))) {
      collecting = true
      continue
    }
    if (collecting && secondLevelHeadingTitle(line)) break
    if (collecting && /^\s*\[\d+\]:\s/u.test(line)) break
    if (collecting) collected.push(line)
  }
  return collected.join('\n').trim()
}

function blocking(code: string, message: string): VerificationIssue {
  return { code, message, severity: 'blocking' }
}

function citationGroupsByReportText(citations: CitationBinding[]): CitationBinding[][] {
  const groups = new Map<string, CitationBinding[]>()
  for (const citation of citations) {
    const key = citation.reportClaimText.replace(/\s+/g, ' ').trim()
    const bucket = groups.get(key) ?? []
    bucket.push(citation)
    groups.set(key, bucket)
  }
  return [...groups.values()]
}

function latestGapVerdict(gapVerdicts: ResearchGapVerdict[] | undefined): ResearchGapVerdict | undefined {
  return gapVerdicts?.[gapVerdicts.length - 1]
}

function requiredQuestionsForEvidenceCoverage(input: QualityVerifierInput): ResearchFrame['coreQuestions'] {
  const required = input.frame.coreQuestions.filter((question) => question.required || question.priority === 'high')
  const centralQuestionId = centralResearchQuestionId(input.frame)
  const requiredSections = input.reportContract?.requiredSections.filter((section) => section.required) ?? []
  const centralHasOwnSection = requiredSections.some((section) => section.questionIds.includes(centralQuestionId ?? ''))
  if (!centralQuestionId || centralHasOwnSection || requiredSections.length === 0) return required
  return required.filter((question) => question.id !== centralQuestionId)
}

function questionCoveredByResearch(
  questionId: string,
  notes: ResearchNote[],
  latestGap: ResearchGapVerdict | undefined
): boolean {
  const gapCoverage = latestGap?.coverageByQuestion.find((coverage) => coverage.questionId === questionId)
  if (gapCoverage) {
    return gapCoverage.covered || (
      latestGap?.status === 'ready_with_limitations' &&
      gapCoverage.noteCount > 0 &&
      gapCoverage.claimCount >= gapCoverage.requiredClaimCount &&
      gapCoverage.sourceCount >= 1
    )
  }
  return notes.some((note) => note.questionIds.includes(questionId))
}

function shouldBlockBudgetExhausted(input: QualityVerifierInput, latestGap: ResearchGapVerdict): boolean {
  if (input.budget.preset === 'quick') return false
  const uncoveredRequired = latestGap.coverageByQuestion.filter((coverage) =>
    (coverage.required || coverage.priority === 'high') && !coverage.covered
  )
  return latestGap.missingEvidence.length > 0 ||
    uncoveredRequired.length > 0
}

function countMeaningfulChars(markdown: string): number {
  return markdown
    .replace(/<[^>]+>/g, '')
    .replace(/\[claim:[^\]]+\]/g, '')
    .replace(/[`*_#[\](){}|>~\-\s:：，。、；;,.!?！？]/g, '')
    .length
}

function secondLevelHeadingTitle(line: string): string | undefined {
  const match = line.trim().match(/^##\s+(.+?)\s*$/)
  return match?.[1]?.replace(/[*`#]/g, '').trim()
}
