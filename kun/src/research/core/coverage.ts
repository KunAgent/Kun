/**
 * [INPUT]: 依赖 ResearchBrief、ResearchFrame、ReportContract、ResearchNote 章节归属和可引用 evidence ledger
 * [OUTPUT]: 对外提供用户显式范围提取、按必答章节乘积化对比对象要求的 CoverageContract、严格按章节 answering assignment 与对比对象归属及可引用 evidence/report 覆盖匹配、跨书写体系的模型已验证对象映射、每章硬范围代表 claim 选择、以及补研穷尽后逐要求降级交付的纯函数
 * [POS]: research/core 的交付覆盖合同中心，把命名范围项、逐章对比对象、时间窗口与报告章节结构分离；存在 evidence assignment 时拒绝 context claim 充当覆盖，同书写体系复核正文、跨书写体系使用模型已验证的对象归属说明；仅当来源标题在本章全部对比对象中唯一命中一个对象时才可补足缺失的 note 对象元数据
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  ResearchBrief,
  ResearchCoverageContract,
  ResearchCoverageRequirement,
  ResearchFrame,
  ResearchReportContract
} from './types.js'
import type { AtomicClaim, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'
import { comparisonTargetAliases } from './comparison.js'
import { canCiteEvidenceSpan, coversResearchDimensionFocusGroups, isEligibleStrongWebEvidence, isResearchEvidenceFocused, researchDimensionFocusGroups, sourceIdentityKey } from '../evidence/EvidenceEligibility.js'

export type CoverageRequirementEvidence = {
  requirementId: string
  label: string
  kind: ResearchCoverageRequirement['kind']
  claimIds: string[]
  sourceIds: string[]
  strongSourceIds: string[]
  covered: boolean
  onMissing: ResearchCoverageRequirement['onMissing']
}

export function buildCoverageContract(input: {
  brief: ResearchBrief
  frame: ResearchFrame
  reportContract: ResearchReportContract
  nowIso: string
}): ResearchCoverageContract {
  const requirements: ResearchCoverageRequirement[] = []
  const sectionForFacts = preferredSection(input.reportContract, /(?:成果|结果|事实|数据|指标|表现)/u)

  for (const label of extractExplicitNamedCoverageItems([
    input.brief.topic,
    ...(input.brief.userClarifications ?? [])
  ].join('\n'))) {
    requirements.push(requirement({
      kind: 'named_item',
      label,
      aliases: namedCoverageAliases(label),
      questionIds: sectionForFacts?.questionIds ?? [],
      sectionIds: sectionForFacts ? [sectionForFacts.id] : [],
      minClaims: 1,
      minIndependentSources: 1,
      minStrongSources: 1,
      onMissing: 'block'
    }, requirements.length + 1))
  }

  const requiredSections = input.reportContract.requiredSections.filter((section) => section.required)
  for (const section of requiredSections) {
    for (const target of input.frame.alternativesToCompare ?? []) {
      requirements.push(requirement({
        kind: 'comparison_target',
        label: target,
        aliases: comparisonTargetAliases(target),
        questionIds: section.questionIds,
        sectionIds: [section.id],
        minClaims: 1,
        minIndependentSources: 1,
        minStrongSources: 0,
        onMissing: 'block'
      }, requirements.length + 1))
    }
  }

  for (const section of input.reportContract.requiredSections.filter((candidate) => candidate.required)) {
    const explicitDimension = section.questionIds.some((questionId) => {
      const question = input.frame.coreQuestions.find((candidate) => candidate.id === questionId)
      return Boolean(question && /^在「[^」]+」维度/u.test(question.text))
    })
    requirements.push(requirement({
      kind: explicitDimension ? 'dimension' : 'section',
      label: section.title,
      aliases: [section.title],
      questionIds: section.questionIds,
      sectionIds: [section.id],
      minClaims: 1,
      minIndependentSources: 1,
      minStrongSources: 0,
      onMissing: 'block'
    }, requirements.length + 1))
  }

  const scopeText = [input.brief.topic, ...(input.brief.userClarifications ?? [])].join('\n')
  const timeWindow = extractTimeWindow(scopeText)
  if (timeWindow) {
    requirements.push(requirement({
      kind: 'time_window',
      label: timeWindow,
      aliases: [timeWindow],
      questionIds: [],
      sectionIds: [],
      minClaims: 0,
      minIndependentSources: 0,
      minStrongSources: 0,
      onMissing: 'allow_limitation'
    }, requirements.length + 1))
  }
  const forecastHorizon = extractForecastHorizon(scopeText)
  if (forecastHorizon) {
    requirements.push(requirement({
      kind: 'forecast_horizon',
      label: forecastHorizon,
      aliases: [forecastHorizon, '未来走势', '走势'],
      questionIds: [],
      sectionIds: [],
      minClaims: 0,
      minIndependentSources: 0,
      minStrongSources: 0,
      onMissing: 'allow_limitation'
    }, requirements.length + 1))
  }

  const deduped = dedupeRequirements(requirements)
  const groups = (['named_item', 'comparison_target', 'section', 'dimension'] as const).flatMap((kind) => {
    const requirementIds = deduped.filter((item) => item.kind === kind && item.required).map((item) => item.id)
    return requirementIds.length > 0 ? [{ id: `coverage_group_${kind}`, relation: 'all_of' as const, requirementIds }] : []
  })
  return { requirements: deduped, groups, createdAt: input.nowIso }
}

export function evaluateCoverageRequirementEvidence(input: {
  contract: ResearchCoverageContract
  claims: AtomicClaim[]
  evidenceSpans: EvidenceSpan[]
  sources: SourceRecord[]
  notes?: ResearchNote[]
}): CoverageRequirementEvidence[] {
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  return input.contract.requirements.map((requirement) => {
    if (requirement.kind === 'time_window' || requirement.kind === 'forecast_horizon') {
      return {
        requirementId: requirement.id,
        label: requirement.label,
        kind: requirement.kind,
        claimIds: [],
        sourceIds: [],
        strongSourceIds: [],
        covered: true,
        onMissing: requirement.onMissing
      }
    }
    const claimIds = new Set<string>()
    const sourceIds = new Set<string>()
    const strongSourceIds = new Set<string>()
    const scopedClaimIds = answeringClaimIdsForRequirement(requirement, input.notes)
    const comparisonTargetClaimIds = comparisonTargetClaimIdsForRequirement(requirement, input.notes)
    const focusGroups = requirement.kind === 'dimension' ? researchDimensionFocusGroups(requirement.label) : []
    const requiresFacetMatching = focusGroups.length > 1
    for (const claim of input.claims) {
      if (scopedClaimIds && !scopedClaimIds.has(claim.id)) continue
      for (const spanId of claim.supportSpanIds) {
        const span = spanById.get(spanId)
        const source = sourceById.get(span?.sourceId ?? '')
        if (!span || !source || !canCiteEvidenceSpan(span, source)) continue
        const evidenceText = `${claim.text}\n${claim.entities.join(' ')}\n${span.text}`
        const dimensionQuestion = `在「${requirement.label}」维度上，关键事实与作用机制是什么？`
        const sourceTitleOwnsComparisonTarget = requirement.kind === 'comparison_target' &&
          scopedClaimIds?.has(claim.id) === true &&
          uniquelyMatchedComparisonRequirement(input.contract, requirement, source.title)?.id === requirement.id
        const evidenceMatches = requirement.kind === 'dimension'
          ? scopedClaimIds !== undefined || !requiresFacetMatching || isResearchEvidenceFocused(dimensionQuestion, evidenceText, requirement.label)
          : requirement.kind === 'section' || coverageTextMatches(requirement, evidenceText) || comparisonTargetClaimIds?.has(claim.id) === true || sourceTitleOwnsComparisonTarget
        if (!evidenceMatches) continue
        claimIds.add(claim.id)
        const identity = sourceIdentityKey(source)
        sourceIds.add(identity)
        if (isEligibleStrongWebEvidence(source, span)) strongSourceIds.add(identity)
      }
    }
    const supportedText = input.claims
      .filter((claim) => claimIds.has(claim.id))
      .flatMap((claim) => [claim.text, ...claim.supportSpanIds.map((spanId) => spanById.get(spanId)?.text ?? '')])
      .join('\n').toLowerCase()
    const coversFacets = !requiresFacetMatching ||
      !sharesPrimaryWritingSystem(requirement.label, supportedText) ||
      coversResearchDimensionFocusGroups(focusGroups, supportedText)
    return {
      requirementId: requirement.id,
      label: requirement.label,
      kind: requirement.kind,
      claimIds: [...claimIds],
      sourceIds: [...sourceIds],
      strongSourceIds: [...strongSourceIds],
      covered: coversFacets && claimIds.size >= requirement.minClaims &&
        sourceIds.size >= requirement.minIndependentSources &&
        strongSourceIds.size >= requirement.minStrongSources,
      onMissing: requirement.onMissing
    }
  })
}

export function selectCoverageRepresentativeClaimIds(input: {
  contract: ResearchCoverageContract
  coverage: CoverageRequirementEvidence[]
  sectionId: string
  candidateClaimIds: string[]
}): string[] {
  const requirementById = new Map(input.contract.requirements.map((requirement) => [requirement.id, requirement]))
  const candidateSet = new Set(input.candidateClaimIds)
  const representatives: string[] = []
  for (const coverage of input.coverage) {
    const requirement = requirementById.get(coverage.requirementId)
    if (!coverage.covered || !requirement?.required || requirement.onMissing === 'allow_limitation') continue
    if (!requirement.sectionIds.includes(input.sectionId)) continue
    if (requirement.kind === 'dimension' || requirement.kind === 'time_window' || requirement.kind === 'forecast_horizon') continue
    const representative = input.candidateClaimIds.find((claimId) =>
      candidateSet.has(claimId) && coverage.claimIds.includes(claimId)
    )
    if (representative && !representatives.includes(representative)) representatives.push(representative)
  }
  return representatives
}

function uniquelyMatchedComparisonRequirement(
  contract: ResearchCoverageContract,
  requirement: ResearchCoverageRequirement,
  text: string
): ResearchCoverageRequirement | undefined {
  const sectionIds = new Set(requirement.sectionIds)
  const matches = contract.requirements.filter((candidate) =>
    candidate.kind === 'comparison_target' &&
    candidate.sectionIds.some((sectionId) => sectionIds.has(sectionId)) &&
    coverageTextMatches(candidate, text)
  )
  return matches.length === 1 ? matches[0] : undefined
}

function comparisonTargetClaimIdsForRequirement(
  requirement: ResearchCoverageRequirement,
  notes: ResearchNote[] | undefined
): Set<string> | undefined {
  if (requirement.kind !== 'comparison_target' || !notes) return undefined
  const questionIds = new Set(requirement.questionIds)
  const normalizedTarget = normalizeCoverageText(requirement.label)
  return new Set(notes
    .filter((note) => requirement.questionIds.length === 0 || note.questionIds.some((questionId) => questionIds.has(questionId)))
    .flatMap((note) => note.claimIds.filter((claimId) => {
      if (!noteClaimAnswersRequirement(note, claimId, questionIds)) return false
      const explicitTarget = note.comparisonTargets?.some((target) => normalizeCoverageText(target) === normalizedTarget)
      if (explicitTarget) return true
      return note.evidenceAssignments?.some((assignment) =>
        assignment.claimId === claimId &&
        questionIds.has(assignment.questionId) &&
        assignment.role !== 'context' &&
        assignment.source === 'model_validated' &&
        coverageTextMatches(requirement, assignment.explanation)
      ) === true
    })))
}

function sharesPrimaryWritingSystem(left: string, right: string): boolean {
  const leftHasHan = /\p{Script=Han}/u.test(left)
  const rightHasHan = /\p{Script=Han}/u.test(right)
  const leftHasLatin = /[a-z]/iu.test(left)
  const rightHasLatin = /[a-z]/iu.test(right)
  return (leftHasHan && rightHasHan) || (leftHasLatin && rightHasLatin)
}

function answeringClaimIdsForRequirement(
  requirement: ResearchCoverageRequirement,
  notes: ResearchNote[] | undefined
): Set<string> | undefined {
  if (!notes || requirement.questionIds.length === 0) return undefined
  const questionIds = new Set(requirement.questionIds)
  return new Set(notes
    .filter((note) => note.questionIds.some((questionId) => questionIds.has(questionId)))
    .flatMap((note) => note.claimIds.filter((claimId) => noteClaimAnswersRequirement(note, claimId, questionIds))))
}

function noteClaimAnswersRequirement(
  note: ResearchNote,
  claimId: string,
  questionIds: ReadonlySet<string>
): boolean {
  const assignments = note.evidenceAssignments?.filter((assignment) =>
    assignment.claimId === claimId && questionIds.has(assignment.questionId)
  )
  // Older persisted notes have no role metadata. Preserve their previous text-based
  // behavior, but once a role exists it becomes the source of truth.
  if (!assignments || assignments.length === 0) return true
  return assignments.some((assignment) => assignment.role === 'supports' || assignment.role === 'contradicts')
}

export function coverageTextMatches(requirement: ResearchCoverageRequirement, text: string): boolean {
  const normalized = normalizeCoverageText(text)
  return requirement.aliases.some((alias) => {
    const normalizedAlias = normalizeCoverageText(alias)
    return normalizedAlias.length >= 2 && normalized.includes(normalizedAlias)
  })
}

export function isCoverageRequirementExhausted(
  requirement: ResearchCoverageRequirement,
  exhaustedQuestionIds: ReadonlySet<string> | undefined
): boolean {
  return Boolean(exhaustedQuestionIds) &&
    requirement.questionIds.length > 0 &&
    requirement.questionIds.every((questionId) => exhaustedQuestionIds!.has(questionId))
}

export function coverageRequirementEvidenceGapLimitation(requirement: ResearchCoverageRequirement): string {
  return `关于「${requirement.label}」，本次补研获得的可引用证据仍不足以形成可靠结论；其他对象或章节的材料不能替代，也不能据此外推。`
}

export function extractExplicitNamedCoverageItems(text: string): string[] {
  const candidates: string[] = []
  for (const match of text.matchAll(/以([^\n。；;]{2,180}?)为范围/gu)) candidates.push(match[1] ?? '')
  for (const match of text.matchAll(/(?:研究对象|覆盖对象|命名项|对象|主体)范围\s*[:：]\s*([^\n。；;]{2,180})/gu)) candidates.push(match[1] ?? '')
  const items = candidates.flatMap((candidate) => candidate
    .replace(/^(?:自|从|近)?\s*\d{4}年?(?:至今|以来|[-–—至到]\d{4}年?)?的?/u, '')
    .split(/[、,，;；/]|\s*(?:以及|并且|和|及)\s*/u)
    .map(cleanCoverageItem)
    .filter(Boolean))
  return [...new Set(items)]
    .filter((item) => item.length >= 2 && item.length <= 32)
    .filter((item) => !/^(?:全部|不限|无|所有|其他|相关|以上|以下)$/u.test(item))
}

function requirement(
  input: Omit<ResearchCoverageRequirement, 'id' | 'required'>,
  ordinal: number
): ResearchCoverageRequirement {
  return { id: `coverage_${ordinal}`, required: true, ...input }
}

function preferredSection(contract: ResearchReportContract, pattern: RegExp) {
  return contract.requiredSections.find((section) => pattern.test(section.title))
    ?? contract.requiredSections.find((section) => section.required)
}

function namedCoverageAliases(label: string): string[] {
  return [label]
}

function extractTimeWindow(text: string): string | undefined {
  return text.match(/\d{4}年?(?:至今|以来|[-–—至到]\d{4}年?)/u)?.[0]
}

function extractForecastHorizon(text: string): string | undefined {
  return text.match(/未来\s*[零〇一二两三四五六七八九十百\d]+\s*年(?:走势|趋势|展望|预测)?/u)?.[0]
}

function cleanCoverageItem(value: string): string {
  return value
    .replace(/^(?:自|从|近)?\s*\d{4}年?(?:至今|以来|[-–—至到]\d{4}年?)?的?/u, '')
    .replace(/^(?:覆盖|包括|包含|重点看)一下?/u, '')
    .replace(/[\s。；;:：，,]+$/u, '')
    .trim()
}

function dedupeRequirements(requirements: ResearchCoverageRequirement[]): ResearchCoverageRequirement[] {
  const seen = new Set<string>()
  return requirements.filter((item) => {
    const sectionScope = item.kind === 'comparison_target' ? item.sectionIds.join(',') : ''
    const key = `${item.kind}:${normalizeCoverageText(item.label)}:${sectionScope}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map((item, index) => ({ ...item, id: `coverage_${index + 1}` }))
}

function normalizeCoverageText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}
