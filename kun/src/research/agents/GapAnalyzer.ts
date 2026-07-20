/**
 * [INPUT]: 依赖 CoverageEvaluatorInput 中的 plan、budget、evidence ledger、ResearchFrame 和独立 CoverageContract
 * [OUTPUT]: 对外提供 BasicCoverageEvaluator，按可信 note 的章节与对比对象归属、可引用 claim 和命名范围生成定向 follow-up tasks，并把逐章显式范围项当前/所需的 claim、独立来源与强来源数量写入 CoverageMatrix
 * [POS]: research/agents 的 gap loop 节点，位于 research worker 与 synthesis writer 之间；来源强弱进入置信度与限制说明，不再用 preset 固定来源数量阻止已有直接证据的章节写作
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { CoverageEvaluator, CoverageEvaluatorInput } from './types.js'
import type { ResearchConfidence, ResearchCoverageMatrix, ResearchFrame, ResearchGapStatus, ResearchGapVerdict, ResearchQuestion, ResearchQuestionCoverage, ResearchTask } from '../core/types.js'
import type { AtomicClaim, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'
import { comparisonTargetMatchesText } from '../core/comparison.js'
import { evaluateCoverageRequirementEvidence, type CoverageRequirementEvidence } from '../core/coverage.js'
import {
  canCiteEvidenceSpan,
  isEligibleStrongWebEvidence,
  isResearchEvidenceFocused,
  isResearchTextRelevant,
  isModelFallbackSource,
  researchDimensionFocusGroups,
  sourceIdentityKey,
  uniqueEligibleEvidenceSources
} from '../evidence/EvidenceEligibility.js'

export class BasicCoverageEvaluator implements CoverageEvaluator {
  async evaluate(input: CoverageEvaluatorInput): Promise<ResearchGapVerdict> {
    const coverageByQuestion = buildCoverage(input)
    const requiredGaps = coverageByQuestion.filter((coverage) =>
      (coverage.required || coverage.priority === 'high') && !coverage.covered
    )
    const explicitRequirements = input.coverageContract
      ? evaluateCoverageRequirementEvidence({
          contract: input.coverageContract,
          claims: input.claims,
          evidenceSpans: input.evidenceSpans,
          sources: input.sources,
          notes: input.notes
        })
      : []
    const coverageMatrix = buildCoverageMatrix(input, coverageByQuestion, explicitRequirements)
    const missingEvidence = [
      ...requiredGaps.flatMap((coverage) => coverage.missingEvidence),
      ...coverageMatrix.comparisonTargets
        .filter((target) => !target.covered)
        .map((target) => `对比对象「${target.target}」缺少独立来源覆盖。`),
      ...explicitRequirements
        .filter((requirement) => !requirement.covered && requirement.onMissing !== 'allow_limitation')
        .map((requirement) => missingExplicitRequirementMessage(input, requirement)),
      ...(!coverageMatrix.disconfirmingEvidenceCovered && requiresDisconfirmingEvidence(input)
        ? ['缺少反证、争议、限制条件或边界证据。']
        : [])
    ]
    const eligibleSourceCount = uniqueEligibleEvidenceSources(input.sources, input.evidenceSpans).length
    const remainingSourceBudget = Math.max(0, input.budget.maxSources - eligibleSourceCount)
    const canContinue = remainingSourceBudget > 0
    const followUpTasks = canContinue
      ? buildFollowUpTasks(input, coverageByQuestion, explicitRequirements, missingEvidence, remainingSourceBudget)
      : []
    const status = decideStatus({
      missingEvidence,
      followUpTasks,
      canContinue,
      readyWithSectionLimitations: canProceedWithCoveredSectionLimitations({
        requiredGaps,
        coverageMatrix,
        centralQuestion: input.frame.centralQuestion
      })
    })

    return {
      id: `gap_${input.runId}_${input.roundIndex}`,
      roundIndex: input.roundIndex,
      status,
      confidence: confidenceForStatus(status, missingEvidence.length),
      stopReason: stopReasonForStatus(status, input, missingEvidence, remainingSourceBudget),
      coverageByQuestion,
      coverageMatrix,
      missingEvidence,
      followUpTasks,
      createdAt: input.nowIso
    }
  }
}

function requiredStrongWebSourceCount(input: CoverageEvaluatorInput): number {
  if (!input.brief.sourcePolicy.allowedSourceTypes.includes('web')) return 0
  if (input.budget.preset === 'quick' && !isComparisonTopic(input.brief.topic, input.frame)) return 0
  return 1
}

function isModelFallback(source: SourceRecord): boolean {
  return isModelFallbackSource(source)
}

function buildCoverage(input: CoverageEvaluatorInput): ResearchQuestionCoverage[] {
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const notesByQuestion = new Map<string, typeof input.notes>()
  const explicitlyMappedClaimIds = new Set(input.notes.flatMap((note) => note.claimIds))
  for (const note of input.notes) {
    for (const questionId of note.questionIds) {
      const bucket = notesByQuestion.get(questionId) ?? []
      bucket.push(note)
      notesByQuestion.set(questionId, bucket)
    }
  }

  return input.frame.coreQuestions.map((question) => {
    const coverageQuestionIds = questionIdsForCoverage(input.frame, question)
    const coverageQuestionIdSet = new Set(coverageQuestionIds)
    const notes = uniqueById(coverageQuestionIds.flatMap((questionId) => notesByQuestion.get(questionId) ?? []))
    const explicitClaimIds = new Set(notes.flatMap((note) => note.claimIds))
    const trustedClaimIds = new Set(notes
      .filter((note) => noteHasTrustedQuestionAssignment(input, note, coverageQuestionIdSet))
      .flatMap((note) => note.claimIds))
    const relevanceBasis = [
      input.brief.topic,
      input.brief.userIntent,
      input.frame.centralQuestion,
      input.frame.coreResearchThread,
      question.text
    ].filter(Boolean).join('\n')
    const claims = input.claims.filter((claim) =>
      explicitClaimIds.has(claim.id) ||
      (!explicitlyMappedClaimIds.has(claim.id) && claimHasRelevantCitableEvidence(claim, relevanceBasis, spanById, sourceById))
    )
    const sourceIds = new Set<string>()
    const strongWebSourceIds = new Set<string>()
    for (const claim of claims) {
      if (!claim) continue
      for (const spanId of claim?.supportSpanIds ?? []) {
        const span = spanById.get(spanId)
        const sourceId = span?.sourceId
        if (!span || !sourceId) continue
        const source = sourceById.get(sourceId)
        if (!source || isModelFallback(source)) continue
        const evidenceCorpus = `${claim.text}\n${claim.entities.join(' ')}\n${span.text}\n${source.title}\n${source.publisher ?? ''}\n${source.canonicalUrl ?? source.originalUrl ?? ''}`
        const claimCorpus = `${claim.text}\n${claim.entities.join(' ')}`
        const explicitlyAssigned = trustedClaimIds.has(claim.id) || (explicitClaimIds.has(claim.id) && (
          isResearchEvidenceFocused(
            question.text,
            claimCorpus,
            `${input.brief.topic}\n${input.frame.coreResearchThread}\n${input.frame.centralQuestion}`
          ) || isResearchTextRelevant(relevanceBasis, claimCorpus) || claimEntitiesAnchorResearch(claim, relevanceBasis)
        ))
        if (source.sourceType === 'web' && !explicitlyAssigned && !isResearchTextRelevant(relevanceBasis, evidenceCorpus)) {
          continue
        }
        if (!canCiteEvidenceSpan(span, source)) continue
        const sourceIdentity = sourceIdentityKey(source)
        sourceIds.add(sourceIdentity)
        if (isEligibleStrongWebEvidence(source, span)) strongWebSourceIds.add(sourceIdentity)
      }
    }
    const requiredSourceCount = requiredSourcesForQuestion(input, question)
    const requiredStrongWebSources = question.required || question.priority === 'high'
      ? Math.min(requiredSourceCount, requiredStrongWebSourceCount(input))
      : 0
    const requiredClaimCount = requiredClaimsForQuestion(input, question)
    const missingEvidence = missingEvidenceForQuestion(question, {
      noteCount: notes.length,
      claimCount: claims.length,
      criticalClaimCount: claims.filter((claim) => claim?.critical).length,
      sourceCount: sourceIds.size,
      strongWebSourceCount: strongWebSourceIds.size,
      requiredSourceCount,
      requiredStrongWebSourceCount: requiredStrongWebSources,
      requiredClaimCount
    })
    return {
      questionId: question.id,
      question: question.text,
      required: question.required,
      priority: question.priority,
      covered: missingEvidence.length === 0,
      requiredSourceCount,
      requiredStrongWebSourceCount: requiredStrongWebSources,
      sourceCount: sourceIds.size,
      strongWebSourceCount: strongWebSourceIds.size,
      requiredClaimCount,
      claimCount: claims.length,
      criticalClaimCount: claims.filter((claim) => claim?.critical).length,
      noteCount: notes.length,
      missingEvidence
    }
  })
}

function claimEntitiesAnchorResearch(claim: AtomicClaim, researchText: string): boolean {
  const normalizedResearch = researchText.normalize('NFKC').toLowerCase()
  return claim.entities.some((entity) => {
    const normalizedEntity = entity.normalize('NFKC').toLowerCase().trim()
    return normalizedEntity.length >= 2 && normalizedResearch.includes(normalizedEntity)
  })
}

function noteHasTrustedQuestionAssignment(
  input: CoverageEvaluatorInput,
  note: ResearchNote,
  coverageQuestionIds: Set<string>
): boolean {
  const task = input.plan.tasks.find((candidate) => candidate.id === note.taskId)
  if (!task) return false
  const taskQuestionIds = new Set(task.questionIds)
  const explicitReportQuestionIds = (task.reportQuestionIds ?? [])
    .filter((questionId) => taskQuestionIds.has(questionId))
  const legacyReportQuestionIds = explicitReportQuestionIds.length === 0
    ? (task.reportSectionIds ?? []).filter((questionId) => taskQuestionIds.has(questionId))
    : []
  const ownedQuestionIds = new Set(explicitReportQuestionIds.length > 0
    ? explicitReportQuestionIds
    : legacyReportQuestionIds.length > 0 ? legacyReportQuestionIds : task.questionIds)
  return note.questionIds.some((questionId) =>
    coverageQuestionIds.has(questionId) && ownedQuestionIds.has(questionId)
  )
}

function questionIdsForCoverage(frame: ResearchFrame, question: ResearchQuestion): string[] {
  const normalizedCentral = normalizeQuestionText(frame.centralQuestion)
  if (normalizeQuestionText(question.text) !== normalizedCentral) return [question.id]
  const dimensionQuestionIds = frame.coreQuestions
    .filter((candidate) => candidate.id !== question.id)
    .filter((candidate) => candidate.required || candidate.priority === 'high')
    .filter((candidate) => /^在「[^」]+」维度/u.test(candidate.text))
    .map((candidate) => candidate.id)
  if (dimensionQuestionIds.length >= 2) return [question.id, ...dimensionQuestionIds]
  const requiredDetailQuestions = frame.coreQuestions
    .filter((candidate) => candidate.id !== question.id)
    .filter((candidate) => candidate.required || candidate.priority === 'high')
  return requiredDetailQuestions.length === 0
    ? frame.coreQuestions.map((candidate) => candidate.id)
    : [question.id]
}

function normalizeQuestionText(value: string): string {
  return value.replace(/[\s？?。.!！]+/gu, '').toLowerCase()
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function requiredClaimsForQuestion(input: CoverageEvaluatorInput, question: ResearchQuestion): number {
  if (input.budget.preset === 'quick') return 1
  if (!question.required && question.priority !== 'high') return 1
  if (/在「[^」]+场景」维度/u.test(question.text)) return 1
  if (/^在「[^」]+」维度/u.test(question.text)) {
    const focusGroups = researchDimensionFocusGroups(
      question.text,
      `${input.brief.topic}\n${input.frame.coreResearchThread}\n${input.frame.centralQuestion}`
    )
    return focusGroups.length > 1 ? 2 : 1
  }
  const requestedFacets = [
    /关键事实/u,
    /作用机制|原因|驱动|路径/u,
    /风险|反例|争议/u,
    /适用边界|边界条件|限制/u,
    /相互关系|协同|权衡|差异/u
  ].filter((pattern) => pattern.test(question.text)).length
  return requestedFacets >= 2 ? 2 : 1
}

function claimHasRelevantCitableEvidence(
  claim: AtomicClaim,
  relevanceBasis: string,
  spanById: Map<string, EvidenceSpan>,
  sourceById: Map<string, SourceRecord>
): boolean {
  return claim.supportSpanIds.some((spanId) => {
    const span = spanById.get(spanId)
    const source = sourceById.get(span?.sourceId ?? '')
    if (!span || !source || !canCiteEvidenceSpan(span, source)) return false
    if (source.sourceType !== 'web') return false
    return isResearchTextRelevant(
      relevanceBasis,
      `${claim.text}\n${claim.entities.join(' ')}\n${span.text}\n${source.title}\n${source.publisher ?? ''}\n${source.canonicalUrl ?? source.originalUrl ?? ''}\n${source.sourcePolicyTags.join(' ')}`
    )
  })
}

function requiredSourcesForQuestion(input: CoverageEvaluatorInput, question: ResearchQuestion): number {
  const perQuestionBudget = Math.max(1, Math.floor(input.budget.maxSources / Math.max(1, input.frame.coreQuestions.length)))
  return Math.max(1, Math.min(perQuestionBudget, 1))
}

function missingEvidenceForQuestion(
  question: ResearchQuestion,
  stats: {
    noteCount: number
    claimCount: number
    criticalClaimCount: number
    sourceCount: number
    strongWebSourceCount: number
    requiredSourceCount: number
    requiredStrongWebSourceCount: number
    requiredClaimCount: number
  }
): string[] {
  const missing: string[] = []
  if (stats.noteCount === 0) missing.push(`问题「${question.text}」还没有结构化研究笔记。`)
  if (stats.claimCount === 0) missing.push(`问题「${question.text}」还没有可引用论断。`)
  if (stats.claimCount < stats.requiredClaimCount) {
    missing.push(`问题「${question.text}」只有 ${stats.claimCount} 条可引用论断，无法覆盖问题要求的多个方面；至少需要 ${stats.requiredClaimCount} 条不同论断。`)
  }
  if (stats.sourceCount < stats.requiredSourceCount) {
    missing.push(`问题「${question.text}」来源数 ${stats.sourceCount} 低于要求 ${stats.requiredSourceCount}。`)
  }
  if (stats.requiredStrongWebSourceCount > 0 && stats.strongWebSourceCount < stats.requiredStrongWebSourceCount) {
    missing.push(`问题「${question.text}」真实网页来源数 ${stats.strongWebSourceCount} 低于要求 ${stats.requiredStrongWebSourceCount}。`)
  }
  return missing
}

function buildCoverageMatrix(
  input: CoverageEvaluatorInput,
  coverageByQuestion: ResearchQuestionCoverage[],
  explicitRequirements: ReturnType<typeof evaluateCoverageRequirementEvidence>
): ResearchCoverageMatrix {
  const required = coverageByQuestion.filter((coverage) => coverage.required || coverage.priority === 'high')
  const spansBySource = spansBySourceId(input.evidenceSpans)
  const eligibleStrongWebSourceIds = new Set<string>()
  for (const source of input.sources) {
    for (const span of spansBySource.get(source.id) ?? []) {
      if (isEligibleStrongWebEvidence(source, span)) eligibleStrongWebSourceIds.add(sourceIdentityKey(source))
    }
  }
  const comparisonTargets = comparisonTargetsForInput(input)
    .map((target) => {
      const sourceCount = sourceCountForTarget(input, target)
      return {
        target,
        sourceCount,
        covered: sourceCount > 0
      }
    })
  const requirementById = new Map((input.coverageContract?.requirements ?? [])
    .map((requirement) => [requirement.id, requirement]))
  return {
    totalSourceCount: uniqueEligibleEvidenceSources(input.sources, input.evidenceSpans).length,
    strongWebSourceCount: eligibleStrongWebSourceIds.size,
    requiredQuestionCount: required.length,
    coveredRequiredQuestionCount: required.filter((coverage) => coverage.covered).length,
    disconfirmingEvidenceCovered: hasDisconfirmingEvidence(input),
    comparisonTargets,
    explicitRequirements: explicitRequirements.map((requirement) => {
      const contract = requirementById.get(requirement.requirementId)
      return {
        requirementId: requirement.requirementId,
        label: requirement.label,
        kind: requirement.kind,
        questionIds: contract?.questionIds ?? [],
        sourceCount: requirement.sourceIds.length,
        claimCount: requirement.claimIds.length,
        strongSourceCount: requirement.strongSourceIds.length,
        requiredSourceCount: contract?.minIndependentSources ?? 0,
        requiredClaimCount: contract?.minClaims ?? 0,
        requiredStrongSourceCount: contract?.minStrongSources ?? 0,
        covered: requirement.covered,
        onMissing: requirement.onMissing
      }
    })
  }
}

function comparisonTargetsForInput(input: CoverageEvaluatorInput): string[] {
  return input.frame.alternativesToCompare ?? []
}

function isComparisonTopic(_topic: string, frame: ResearchFrame): boolean {
  return (frame.alternativesToCompare?.length ?? 0) >= 2
}

function sourceCountForTarget(input: CoverageEvaluatorInput, target: string): number {
  const comparisonQuestionIds = new Set(input.frame.coreQuestions
    .filter((question) => /国际竞争格局|主要对手|对比|比较/u.test(question.text) || normalizeQuestionText(question.text) === normalizeQuestionText(input.frame.centralQuestion))
    .map((question) => question.id))
  const requiresDirectComparisonMapping = input.frame.coreQuestions.some((question) => /国际竞争格局|主要对手/u.test(question.text))
  const comparisonClaimIds = new Set(input.notes
    .filter((note) => note.questionIds.some((questionId) => comparisonQuestionIds.has(questionId)))
    .flatMap((note) => note.claimIds))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const sourceIds = new Set<string>()
  for (const claim of input.claims) {
    if (requiresDirectComparisonMapping && comparisonQuestionIds.size > 0 && !comparisonClaimIds.has(claim.id)) continue
    const claimCorpus = `${claim.text}\n${claim.entities.join(' ')}`
    if (!comparisonTargetMatchesText(target, claimCorpus)) continue
    for (const spanId of claim.supportSpanIds) {
      const span = spanById.get(spanId)
      const source = sourceById.get(span?.sourceId ?? '')
      if (canCiteEvidenceSpan(span, source) && source) sourceIds.add(sourceIdentityKey(source))
    }
  }
  return sourceIds.size
}

function requiresDisconfirmingEvidence(input: CoverageEvaluatorInput): boolean {
  if (input.budget.preset === 'quick' && !isComparisonTopic(input.brief.topic, input.frame)) return false
  return input.frame.disconfirmingEvidenceNeeded.length > 0
}

function hasDisconfirmingEvidence(input: CoverageEvaluatorInput): boolean {
  if (!requiresDisconfirmingEvidence(input)) return true
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  return input.notes.some((note) => {
    const hasValidSource = note.claimIds.some((claimId) => {
      const claim = claimById.get(claimId)
      return claim?.supportSpanIds.some((spanId) => {
        const span = spanById.get(spanId)
        const source = sourceById.get(span?.sourceId ?? '')
        return canCiteEvidenceSpan(span, source)
      })
    })
    if (!hasValidSource) return false
    if (note.claimIds.some((claimId) => claimById.get(claimId)?.polarity === 'negative')) return true
    const disconfirmingText = [
      note.summary,
      note.implicationForBrief,
      ...note.limitations
    ].join('\n')
    return /反例|反证|相反|冲突|争议|替代解释|推翻|不成立|不支持|例外|挑战|险胜|胶着|动摇|波动|失利|爆冷|不能保证|可能(?:忽略|绕过|失效)/u.test(disconfirmingText)
  })
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

function buildFollowUpTasks(
  input: CoverageEvaluatorInput,
  coverageByQuestion: ResearchQuestionCoverage[],
  explicitRequirements: CoverageRequirementEvidence[],
  missingEvidence: string[],
  remainingSourceBudget: number
): ResearchTask[] {
  if (missingEvidence.length === 0) return []
  const explicitCoverageTasks = buildMissingExplicitCoverageTasks(input, explicitRequirements)
  const comparisonTasks = buildMissingComparisonTasks(input, missingEvidence)
  const explicitlyRepairedQuestionIds = new Set(explicitCoverageTasks.flatMap((task) => task.questionIds))
  const uncovered = coverageByQuestion.filter((coverage) =>
    (coverage.required || coverage.priority === 'high') && needsDirectEvidenceRepair(coverage)
  ).sort((left, right) =>
    left.sourceCount - right.sourceCount ||
    left.claimCount - right.claimCount ||
    priorityRank(right) - priorityRank(left)
  )
  const sourceDeficit = Math.max(0, input.budget.targetSources - uniqueEligibleEvidenceSources(input.sources, input.evidenceSpans).length)
  const deficitTarget = uncovered.length > 0
    ? uncovered
    : sourceDeficitTargets(coverageByQuestion, sourceDeficit)
  const sourceFloor = followUpTaskSourceFloor(input, remainingSourceBudget)
  const taskCapacity = Math.max(1, Math.floor(remainingSourceBudget / sourceFloor))
  const taskCount = uncovered.length > 0
    ? Math.max(1, Math.min(deficitTarget.length, input.budget.maxSubagents, taskCapacity))
    : Math.max(1, Math.min(
      deficitTarget.length || 1,
      input.budget.maxSubagents,
      taskCapacity,
      Math.max(1, Math.ceil(sourceDeficit / 4))
    ))
  const sourcesPerTask = distributeRemainingSources(remainingSourceBudget, taskCount)
  const coverageTasks: ResearchTask[] = deficitTarget.slice(0, taskCount).map((coverage, index) => ({
    id: `gap_${input.roundIndex + 1}_task_${index + 1}`,
    questionIds: [coverage.questionId],
    objective: `补足缺口：${coverage.question}`,
    expectedEvidence: [
      ...(coverage.missingEvidence.length > 0
        ? coverage.missingEvidence
        : [`为问题「${coverage.question}」补充更多独立来源，达到 ${input.budget.preset} preset 的最低来源覆盖。`]),
      ...input.frame.evidenceNeeded,
      ...(input.frame.disconfirmingEvidenceNeeded.length > 0 ? input.frame.disconfirmingEvidenceNeeded : ['反证、争议和边界条件。'])
    ].filter(Boolean),
    sourceTypes: input.brief.sourcePolicy.allowedSourceTypes,
    searchHints: [
      input.brief.topic,
      input.frame.coreResearchThread,
      coverage.question,
      ...coverage.missingEvidence,
      ...(input.brief.userClarifications ?? [])
    ].map((hint) => hint.trim()).filter(Boolean),
    maxSources: sourcesPerTask[index] ?? 1,
    priority: coverage.priority,
    status: 'pending' as const
  })).filter((task) => !task.questionIds.some((questionId) => explicitlyRepairedQuestionIds.has(questionId)))
  const sourceCountByQuestion = new Map(coverageByQuestion.map((coverage) => [coverage.questionId, coverage.sourceCount]))
  const urgentCoverageTasks = coverageTasks.filter((task) => (sourceCountByQuestion.get(task.questionIds[0] ?? '') ?? 0) === 0)
  const remainingCoverageTasks = coverageTasks.filter((task) => !urgentCoverageTasks.includes(task))
  return capFollowUpTaskSources(
    [...explicitCoverageTasks, ...urgentCoverageTasks, ...comparisonTasks, ...remainingCoverageTasks]
      .slice(0, input.budget.maxSubagents),
    remainingSourceBudget
  )
}

function needsDirectEvidenceRepair(coverage: ResearchQuestionCoverage): boolean {
  return coverage.noteCount === 0 ||
    coverage.claimCount < coverage.requiredClaimCount ||
    coverage.sourceCount < coverage.requiredSourceCount
}

function buildMissingExplicitCoverageTasks(
  input: CoverageEvaluatorInput,
  explicitRequirements: CoverageRequirementEvidence[]
): ResearchTask[] {
  const requirements = input.coverageContract?.requirements ?? []
  const missing = explicitRequirements.filter((requirement) =>
    !requirement.covered && requirement.onMissing !== 'allow_limitation'
  )
  const comparisonRepairQuestionIds = new Set(missing
    .filter((coverage) => requirements.find((candidate) => candidate.id === coverage.requirementId)?.kind === 'comparison_target')
    .flatMap((coverage) => requirements.find((candidate) => candidate.id === coverage.requirementId)?.questionIds ?? []))
  return missing.flatMap((coverage, index) => {
    const requirement = requirements.find((candidate) => candidate.id === coverage.requirementId)
    if (!requirement) return []
    if (requirement.kind !== 'comparison_target' && requirement.questionIds.some((questionId) => comparisonRepairQuestionIds.has(questionId))) {
      return []
    }
    const label = requirement.label
    const question = questionForExplicitCoverageRepair(input, requirement)
      ?? input.frame.coreQuestions.find((candidate) => candidate.required || candidate.priority === 'high')
      ?? input.frame.coreQuestions[0]
    if (!question) return []
    const sectionTitle = coverageRequirementSectionLabel(input, requirement) ?? label
    if (requirement.kind === 'comparison_target') {
      return [{
        id: `gap_${input.roundIndex + 1}_section_target_${index + 1}`,
        questionIds: [question.id],
        reportQuestionIds: [question.id],
        reportSectionIds: [...requirement.sectionIds],
        reportSectionTitles: [sectionTitle],
        comparisonTargets: [label],
        objective: `补足报告章节「${sectionTitle}」中对比对象「${label}」的直接证据：${question.text}`,
        expectedEvidence: [
          `至少一条当前章节 claim 必须由独立可引用来源直接覆盖对比对象「${label}」。`,
          `证据必须回答章节「${sectionTitle}」，不能用其他章节中关于「${label}」的材料补位。`,
          '不得用搜索标题、来源 URL、检索 query 或模型常识冒充正文证据。'
        ],
        sourceTypes: input.brief.sourcePolicy.allowedSourceTypes,
        searchHints: [
          `${label} ${sectionTitle} official report data`,
          `${label} ${question.text}`
        ],
        maxSources: 2,
        priority: 'high' as const,
        status: 'pending' as const
      }]
    }
    const focusGroups = requirement.kind === 'dimension' ? researchDimensionFocusGroups(label) : []
    const focusDescription = focusGroups
      .map((group) => group.slice(0, 3).join('/'))
      .join(' + ')
    return [{
      id: `gap_${input.roundIndex + 1}_coverage_${index + 1}`,
      questionIds: [question.id],
      reportQuestionIds: [question.id],
      reportSectionIds: [...requirement.sectionIds],
      reportSectionTitles: [label],
      objective: `补足用户硬性范围项「${label}」的直接证据：${question.text}`,
      expectedEvidence: [
        `至少一条 claim 和其绑定 evidence span 必须直接出现「${label}」或其明确别名。`,
        ...(focusDescription ? [`成对或多面概念必须逐面覆盖，不能只找到其中一侧：${focusDescription}。`] : []),
        '不得用搜索标题、来源 URL 或其他范围项的证据冒充覆盖。'
      ],
      sourceTypes: input.brief.sourcePolicy.allowedSourceTypes,
      searchHints: [
        `${input.brief.topic} ${label} official results data`,
        `${label} ${question.text}`,
        ...(focusGroups.length > 0 ? focusGroups.map((group) => `${group.slice(0, 3).join(' ')} ${label}`) : [])
      ],
      maxSources: 2,
      priority: 'high' as const,
      status: 'pending' as const
    }]
  })
}

function missingExplicitRequirementMessage(
  input: CoverageEvaluatorInput,
  requirement: CoverageRequirementEvidence
): string {
  const contract = input.coverageContract?.requirements.find((candidate) => candidate.id === requirement.requirementId)
  const sectionTitle = contract ? coverageRequirementSectionLabel(input, contract) : undefined
  const label = sectionTitle && sectionTitle !== requirement.label
    ? `${sectionTitle} / ${requirement.label}`
    : requirement.label
  return `必需范围项「${label}」缺少直接可引用证据。`
}

function coverageRequirementSectionLabel(
  input: CoverageEvaluatorInput,
  requirement: NonNullable<CoverageEvaluatorInput['coverageContract']>['requirements'][number]
): string | undefined {
  const sectionIds = new Set(requirement.sectionIds)
  return input.coverageContract?.requirements.find((candidate) =>
    candidate.id !== requirement.id &&
    (candidate.kind === 'section' || candidate.kind === 'dimension') &&
    candidate.sectionIds.some((sectionId) => sectionIds.has(sectionId))
  )?.label
}

function questionForExplicitCoverageRepair(
  input: CoverageEvaluatorInput,
  requirement: NonNullable<CoverageEvaluatorInput['coverageContract']>['requirements'][number]
): ResearchQuestion | undefined {
  const ownedQuestions = requirement.questionIds
    .map((questionId) => input.frame.coreQuestions.find((question) => question.id === questionId))
    .filter((question): question is ResearchQuestion => Boolean(question))
  if (requirement.kind !== 'dimension') return ownedQuestions[0]

  const normalizedLabel = normalizeCoverageQuestionLabel(requirement.label)
  return ownedQuestions.find((question) => {
    const dimension = question.text.match(/^在「([^」]+)」维度/u)?.[1]
    return Boolean(dimension && normalizeCoverageQuestionLabel(dimension) === normalizedLabel)
  }) ?? ownedQuestions.find((question) => /^在「[^」]+」维度/u.test(question.text))
}

function normalizeCoverageQuestionLabel(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function buildMissingComparisonTasks(
  input: CoverageEvaluatorInput,
  missingEvidence: string[]
): ResearchTask[] {
  const targets = [...new Set(missingEvidence.flatMap((message) =>
    [...message.matchAll(/对比对象「([^」]+)」缺少独立来源覆盖/gu)]
      .map((match) => match[1]?.trim())
      .filter((target): target is string => Boolean(target))
  ))]
  if (targets.length === 0) return []
  const question = input.frame.coreQuestions.find((candidate) => /国际竞争格局|主要对手/u.test(candidate.text))
    ?? input.frame.coreQuestions.find((candidate) => /对比|比较/u.test(candidate.text))
    ?? input.frame.coreQuestions.find((candidate) => candidate.required || candidate.priority === 'high')
    ?? input.frame.coreQuestions[0]
  if (!question) return []
  return targets.map((target, index) => ({
    id: `gap_${input.roundIndex + 1}_comparison_${index + 1}`,
    questionIds: [question.id],
    objective: `补足对比对象「${target}」的独立证据覆盖：${question.text}`,
    expectedEvidence: [
      `至少一条独立来源直接涉及对比对象「${target}」及当前研究主题。`,
      `证据必须能够改变或限定对「${target}」的比较判断。`
    ],
    sourceTypes: input.brief.sourcePolicy.allowedSourceTypes,
    searchHints: [
      `${target} ${input.brief.topic} 官方 数据 报告`,
      `${target} ${question.text} official report data`
    ],
    maxSources: 2,
    priority: 'high',
    status: 'pending'
  }))
}

function capFollowUpTaskSources(tasks: ResearchTask[], maxSources: number): ResearchTask[] {
  let remaining = Math.max(0, maxSources)
  const capped: ResearchTask[] = []
  for (const task of tasks) {
    if (remaining <= 0) break
    const taskSources = Math.min(task.maxSources, remaining)
    if (taskSources <= 0) continue
    capped.push({ ...task, maxSources: taskSources })
    remaining -= taskSources
  }
  return capped
}

function followUpTaskSourceFloor(input: CoverageEvaluatorInput, remainingSourceBudget: number): number {
  if (remainingSourceBudget < 2) return 1
  return isComparisonTopic(input.brief.topic, input.frame) ? 2 : 1
}

function sourceDeficitTargets(
  coverageByQuestion: ResearchQuestionCoverage[],
  sourceDeficit: number
): ResearchQuestionCoverage[] {
  const candidates = coverageByQuestion
    .filter((coverage) => coverage.priority !== 'low')
    .sort((left, right) => {
      const priorityDelta = priorityRank(right) - priorityRank(left)
      if (priorityDelta !== 0) return priorityDelta
      return left.sourceCount - right.sourceCount
    })
  const wanted = Math.max(1, Math.ceil(sourceDeficit / 4))
  return candidates.slice(0, wanted)
}

function priorityRank(coverage: ResearchQuestionCoverage): number {
  if (coverage.required || coverage.priority === 'high') return 3
  if (coverage.priority === 'medium') return 2
  return 1
}

function distributeRemainingSources(totalSources: number, taskCount: number): number[] {
  const safeTaskCount = Math.max(1, taskCount)
  const perTask = Math.max(1, Math.floor(totalSources / safeTaskCount))
  const remainder = Math.max(0, totalSources - perTask * safeTaskCount)
  return Array.from({ length: safeTaskCount }, (_, index) => perTask + (index < remainder ? 1 : 0))
}

function decideStatus(input: {
  missingEvidence: string[]
  followUpTasks: ResearchTask[]
  canContinue: boolean
  readyWithSectionLimitations: boolean
}): ResearchGapStatus {
  if (input.missingEvidence.length === 0) return 'sufficient'
  if (input.readyWithSectionLimitations) return 'ready_with_limitations'
  if (input.canContinue && input.followUpTasks.length > 0) return 'need_more'
  if (canProceedWithLimitations(input.missingEvidence)) return 'ready_with_limitations'
  return 'unanswerable'
}

function canProceedWithCoveredSectionLimitations(input: {
  requiredGaps: ResearchQuestionCoverage[]
  coverageMatrix: ResearchCoverageMatrix
  centralQuestion: string
}): boolean {
  if (input.coverageMatrix.totalSourceCount < 1) return false
  if (input.coverageMatrix.comparisonTargets.some((target) => !target.covered)) return false
  if (input.coverageMatrix.explicitRequirements?.some((requirement) =>
    !requirement.covered && requirement.onMissing !== 'allow_limitation'
  )) return false
  return input.requiredGaps.every((coverage) => {
    const hasMinimalStrongEvidence = coverage.sourceCount >= 1 &&
      coverage.strongWebSourceCount >= Math.min(1, coverage.requiredStrongWebSourceCount)
    const hasCitableSectionEvidence = coverage.sourceCount >= 1
    return coverage.noteCount > 0 &&
      coverage.claimCount >= coverage.requiredClaimCount &&
      (hasMinimalStrongEvidence || hasCitableSectionEvidence)
  })
}

function confidenceForStatus(status: ResearchGapStatus, missingCount: number): ResearchConfidence {
  if (status === 'sufficient') return 'high'
  if (status === 'ready_with_limitations') return 'medium'
  if (missingCount <= 2) return 'medium'
  return 'low'
}

function stopReasonForStatus(
  status: ResearchGapStatus,
  input: CoverageEvaluatorInput,
  missingEvidence: string[],
  remainingSourceBudget: number
): string {
  if (status === 'sufficient') {
    return `覆盖矩阵已满足：核心问题、必答章节、对比对象和边界条件均有可引用证据，可以进入报告合成。`
  }
  if (status === 'ready_with_limitations') {
    return `核心问题已可回答，但仍有 ${missingEvidence.length} 个非中心限制条件需要在报告中降置信说明。`
  }
  if (status === 'need_more') {
    return `发现 ${missingEvidence.length} 个证据缺口，仍可继续发现新来源，将进入下一轮补充研究。`
  }
  return `仍有 ${missingEvidence.length} 个证据缺口，且已触发来源总量异常安全上限；无法继续形成可靠报告。`
}

function canProceedWithLimitations(missingEvidence: string[]): boolean {
  if (missingEvidence.length === 0) return false
  if (missingEvidence.length > 2) return false
  const blockingPatterns = [
    /必要问题|核心问题|关键论断|真实网页来源数|来源数|可引用论断|结构化研究笔记/u,
    /对比对象/u,
    /必需范围项/u
  ]
  return missingEvidence.every((item) => !blockingPatterns.some((pattern) => pattern.test(item)))
}
