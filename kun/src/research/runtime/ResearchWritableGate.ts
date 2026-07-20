/**
 * [INPUT]: 依赖 ResearchRun、Report/CoverageContract、ResearchNote 章节归属、问题答案类型/证据角色契约、evidence ledger、EvidenceEligibility、来源标题与证据主句主体复核和显式问题分面
 * [OUTPUT]: 对外提供 evaluateWritableGate/buildSectionEvidenceMap，把 required sections 映射到真正 supports/contradicts 当前问题且来源标题与证据主句不冲突、同来源高重合事实已折叠、局限说明已去重的主证据，并显式携带每个已覆盖硬范围的代表 claim；已有显式问题分配时禁止未分配到当前问题的 claim 再靠关键词混入，背景 context 不能满足必答章节，deep 的 direct 章节至少需要两条独立可回答 claim，standard 单证据或复合章节部分分面证据只能弱交付但不得清空已有事实；章节分面缺口由 SectionEvidenceMap 自身处理，补研已证明无新增回答证据时可把章内对象范围显式降为受限交付；跨语言场景与抽取层共用“完整对象加主线锚点”判定；真正缺直证时才进入 conditional_application
 * [POS]: research/runtime 的写作前闸门，位于 gap loop 与主编节点之间，阻止缺章节证据、note 误标、无界跨章节复用、场景错配或 synthetic 证据进入报告合成
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  QualityVerdict,
  ResearchCoverageContract,
  ResearchReportContract,
  ResearchRun,
  SectionEvidenceMapEntry,
  VerificationIssue
} from '../core/types.js'
import type { ResearchTaskWorkerInput } from '../agents/types.js'
import {
  coverageRequirementEvidenceGapLimitation,
  evaluateCoverageRequirementEvidence,
  isCoverageRequirementExhausted,
  selectCoverageRepresentativeClaimIds
} from '../core/coverage.js'
import {
  buildResearchQuestionContract,
  classifyResearchEvidenceAssignment,
  researchEvidenceAssignmentFingerprint
} from '../core/question-contract.js'
import type { ResearchEvidenceAssignment } from '../core/types.js'
import type { AtomicClaim, EvidenceSpan, ResearchNote, SourceRecord } from '../evidence/types.js'
import { canCiteEvidenceSpan, coversResearchDimensionFocusGroups, isEligibleStrongWebEvidence, isResearchEvidenceFocused, isUsableEvidenceText, researchDimensionFocusGroups, researchSignalTerms } from '../evidence/EvidenceEligibility.js'
import { centralResearchQuestionId, frameSanityCheck } from './ResearchPreflightGate.js'
import { isContextualReportSection } from '../core/report-argument.js'
import { isDirectAnalyticalApplicationEvidence } from './ResearchWebEvidenceText.js'
import { hasSourceEvidenceSubjectConflict } from './ResearchWebQueryText.js'

export type WritableGateInput = {
  run: ResearchRun
  reportContract?: ResearchReportContract
  coverageContract?: ResearchCoverageContract
  sources: SourceRecord[]
  evidenceSpans: EvidenceSpan[]
  claims: AtomicClaim[]
  notes: ResearchNote[]
  nowIso: string
  allowEvidenceGapQuestionIds?: ReadonlySet<string>
}

export type WritableGateResult = {
  ok: boolean
  status: 'ready' | 'ready_with_limitations' | 'needs_research_repair'
  sectionEvidenceMap: SectionEvidenceMapEntry[]
  verdict?: QualityVerdict
}

export function evaluateWritableGate(input: WritableGateInput): WritableGateResult {
  let sectionEvidenceMap = buildSectionEvidenceMap(input)
  const issues: VerificationIssue[] = []
  const warnings: string[] = []
  const frameCheck = frameSanityCheck(input.run.frame)
  if (!frameCheck.ok) {
    issues.push(blocking('scope_frame_mapping_error', `ResearchFrame 仍含污染问题，不能进入写作：${frameCheck.reason}`))
  }

  const centralQuestionId = centralResearchQuestionId(input.run.frame)
  const centralSection = centralQuestionId
    ? sectionEvidenceMap.find((section) => section.questionIds.includes(centralQuestionId))
    : undefined
  if (centralSection?.status === 'missing') {
    issues.push(blocking('central_question_evidence_missing', `核心问题「${centralSection.title}」缺少可引用证据，不能进入报告合成。`))
  }

  for (const section of sectionEvidenceMap) {
    if (!section.required) continue
    if (section.status === 'missing') {
      issues.push(blocking('required_section_evidence_missing', `必填章节「${section.title}」缺少可引用证据。`))
    } else if (section.status === 'weak') {
      warnings.push(section.evidenceMode === 'evidence_gap'
        ? `章节「${section.title}」补研后仍没有直接回答证据，最终报告必须明确不下结论。`
        : `章节「${section.title}」只有弱证据，最终报告必须降置信说明。`)
    }
  }

  const explicitCoverage = input.coverageContract
    ? evaluateCoverageRequirementEvidence({
        contract: input.coverageContract,
        claims: input.claims,
        evidenceSpans: input.evidenceSpans,
        sources: input.sources,
        notes: input.notes
      })
    : []
  for (const requirement of explicitCoverage) {
    if (requirement.covered || requirement.onMissing === 'allow_limitation') continue
    const contractRequirement = input.coverageContract?.requirements.find((candidate) => candidate.id === requirement.requirementId)
    // Required sections already evaluate their own focus groups below. Reapplying
    // a title-shaped dimension requirement here can turn a partially supported
    // section into the contradictory pair "supported conclusion" + "no reliable
    // conclusion" merely because the literal section title is absent from a claim.
    if (contractRequirement?.kind === 'dimension') continue
    if (contractRequirement && isCoverageRequirementExhausted(contractRequirement, input.allowEvidenceGapQuestionIds)) {
      const limitation = coverageRequirementEvidenceGapLimitation(contractRequirement)
      sectionEvidenceMap = sectionEvidenceMap.map((section) => (
        contractRequirement.sectionIds.includes(section.sectionId)
          ? {
              ...section,
              status: 'weak',
              limitations: [...new Set([limitation, ...section.limitations])].slice(0, 6)
            }
          : section
      ))
      warnings.push(`用户范围项「${requirement.label}」补研已穷尽，报告必须明确该项无法形成可靠结论且其他材料不能替代。`)
      continue
    }
    const conditionalSectionIds = contractRequirement?.sectionIds ?? []
    const conditionalApplicationCoverage = conditionalSectionIds.length > 0
      && conditionalSectionIds.every((sectionId) => sectionEvidenceMap.some((section) =>
        section.sectionId === sectionId && section.evidenceMode === 'conditional_application' && section.status === 'weak'
      ))
    const evidenceGapCoverage = conditionalSectionIds.length > 0
      && conditionalSectionIds.every((sectionId) => sectionEvidenceMap.some((section) =>
        section.sectionId === sectionId && section.evidenceMode === 'evidence_gap'
      ))
    if (conditionalApplicationCoverage || evidenceGapCoverage) {
      warnings.push(evidenceGapCoverage
        ? `用户范围项「${requirement.label}」补研后仍缺少直接证据，报告将明确保留结论。`
        : `用户范围项「${requirement.label}」缺少直接证据，将仅按已引用机制作条件分析。`)
      continue
    }
    issues.push(blocking(
      'required_coverage_evidence_missing',
      `用户硬性范围项「${requirement.label}」没有直接可引用证据，不能进入报告合成。`
    ))
  }

  const syntheticSourceIds = input.sources
    .filter((source) => source.path?.startsWith('synthetic://') || source.sourcePolicyTags.includes('synthetic') || source.sourcePolicyTags.includes('p0-runtime'))
    .map((source) => source.id)
  const citedSyntheticIds = sectionEvidenceMap
    .flatMap((section) => section.sourceIds)
    .filter((sourceId) => syntheticSourceIds.includes(sourceId))
  if (citedSyntheticIds.length > 0) {
    issues.push(blocking('synthetic_evidence_not_citable', `synthetic/p0-runtime 来源不能进入可引用证据：${[...new Set(citedSyntheticIds)].join(', ')}`))
  }

  if (issues.length > 0) {
    return {
      ok: false,
      status: 'needs_research_repair',
      sectionEvidenceMap,
      verdict: writableGateVerdict(input, issues, warnings)
    }
  }

  return {
    ok: true,
    status: warnings.length > 0 ? 'ready_with_limitations' : 'ready',
    sectionEvidenceMap
  }
}

export function buildSectionEvidenceMap(input: WritableGateInput): SectionEvidenceMapEntry[] {
  const sections = input.reportContract?.requiredSections ?? []
  const fallbackSections = sections.length > 0
    ? sections
    : input.run.frame.coreQuestions
      .filter((question) => question.required || question.priority === 'high')
      .map((question) => ({
        id: question.id,
        title: question.text,
        required: true,
        questionIds: [question.id],
        limitationFallback: '该问题缺少足够证据。'
      }))
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const assignedQuestionIdsByClaim = new Map<string, Set<string>>()
  for (const note of input.notes) {
    for (const claimId of note.claimIds) {
      const assigned = assignedQuestionIdsByClaim.get(claimId) ?? new Set<string>()
      note.questionIds.forEach((questionId) => assigned.add(questionId))
      assignedQuestionIdsByClaim.set(claimId, assigned)
    }
  }
  const coverageEvidence = input.coverageContract
    ? evaluateCoverageRequirementEvidence({
        contract: input.coverageContract,
        claims: input.claims,
        evidenceSpans: input.evidenceSpans,
        sources: input.sources,
        notes: input.notes
      })
    : []
  const contextText = [input.run.brief.topic, input.run.frame.coreResearchThread, input.run.frame.centralQuestion].join('\n')
  const isCitableClaim = (claim: AtomicClaim) => isUsableEvidenceText(claim.text, 18) && claim.supportSpanIds.some((spanId) => {
    const span = spanById.get(spanId)
    const source = sourceById.get(span?.sourceId ?? '')
    return canCiteEvidenceSpan(span, source)
      && !hasSourceEvidenceSubjectConflict(source?.title ?? '', `${claim.text}\n${span?.text ?? ''}`)
  })
  const evidenceTextForClaim = (claim: AtomicClaim) => [
    claim.text,
    ...claim.supportSpanIds.flatMap((spanId) => {
      const span = spanById.get(spanId)
      return [sourceById.get(span?.sourceId ?? '')?.title ?? '', span?.text ?? '']
    })
  ].join('\n')
  const candidates = fallbackSections.map((section) => {
    const questionIds = section.questionIds
    const questionSet = new Set(questionIds)
    const notes = input.notes.filter((note) => note.questionIds.some((questionId) => questionSet.has(questionId)))
    const questionContracts = questionIds.flatMap((questionId) => {
      const question = input.run.frame.coreQuestions.find((candidate) => candidate.id === questionId)
      return question ? [buildResearchQuestionContract(question, section.title, input.nowIso)] : []
    })
    const noteAssignments = new Map(notes.flatMap((note) => note.evidenceAssignments ?? [])
      .map((assignment) => [`${assignment.questionId}:${assignment.claimId}`, assignment] as const))
    const explicitlyAssignedClaimIds = new Set(notes.flatMap((note) => note.evidenceAssignments ?? [])
      .map((assignment) => assignment.claimId))
    const assignmentsByClaimId = new Map<string, ResearchEvidenceAssignment[]>()
    const assignmentsForClaim = (claim: AtomicClaim): ResearchEvidenceAssignment[] => {
      const existing = assignmentsByClaimId.get(claim.id)
      if (existing) return existing
      const evidenceText = evidenceTextForClaim(claim)
      const assignments = questionContracts.map((contract) => {
        const suggested = noteAssignments.get(`${contract.questionId}:${claim.id}`)
        if (!suggested && explicitlyAssignedClaimIds.has(claim.id)) {
          return {
            questionId: contract.questionId,
            claimId: claim.id,
            role: 'context' as const,
            relevance: 0.25,
            explanation: '该 claim 已有显式问题归属，但未分配给当前问题，不能靠关键词重映射为主证据。',
            source: 'deterministic' as const
          }
        }
        return classifyResearchEvidenceAssignment({
          contract,
          claimId: claim.id,
          evidenceText,
          suggestedRole: suggested?.role,
          suggestedExplanation: suggested?.explanation
        })
      })
      assignmentsByClaimId.set(claim.id, assignments)
      return assignments
    }
    const contextualSection = isContextualReportSection(section.title)
    const sectionGroups = researchDimensionFocusGroups(section.title, contextText)
    const hasStableTechnicalFacet = /[A-Za-z0-9][A-Za-z0-9+.#/-]{1,}/u.test(section.title)
    const scopedClaims = notes
      .flatMap((note) => note.claimIds)
      .map((claimId) => claimById.get(claimId))
      .filter((claim): claim is AtomicClaim => Boolean(claim))
      .filter(isCitableClaim)
      .filter((claim) => {
        const evidenceText = evidenceTextForClaim(claim)
        if (!contextualSection) {
          return sectionGroups.length < 2 || !hasStableTechnicalFacet
            || sectionGroups.some((group) => coversResearchDimensionFocusGroups([group], evidenceText))
        }
        const questionText = questionIds
          .map((questionId) => input.run.frame.coreQuestions.find((question) => question.id === questionId)?.text)
          .find(Boolean) ?? section.title
        return isDirectAnalyticalApplicationEvidence(workerInputForGate(input, questionIds), questionText, evidenceText)
          && (!hasDanglingContextualReference(evidenceText) || isSelfContainedContextualEvidence(evidenceText))
      })
      .filter((claim) => assignmentsForClaim(claim).some((assignment) => assignment.role !== 'context'))
    const focusQuestion = questionIds
      .map((questionId) => input.run.frame.coreQuestions.find((question) => question.id === questionId))
      .find((question) => question && /^在「[^」]+」维度/u.test(question.text))
    const focusGroups = sectionFocusGroups(input, section.id, section.title, questionIds)
    const directlyMatchingClaims = scopedClaims.length === 0 && focusQuestion && focusGroups.length > 1
      ? input.claims
          .filter(isCitableClaim)
          .filter((claim) => {
            const assignedQuestionIds = assignedQuestionIdsByClaim.get(claim.id)
            return !assignedQuestionIds || [...assignedQuestionIds].some((questionId) => questionSet.has(questionId))
          })
          .filter((claim) => isResearchEvidenceFocused(focusQuestion.text, evidenceTextForClaim(claim), contextText))
          .filter((claim) => assignmentsForClaim(claim).some((assignment) => assignment.role !== 'context'))
      : []
    const supplementaryClaims = directlyMatchingClaims.filter((claim) => !scopedClaims.some((scoped) => scoped.id === claim.id))
    const claims = uniqueById([...scopedClaims, ...supplementaryClaims])
    return { section, questionIds, notes, questionContracts, assignmentsByClaimId, scopedClaims, supplementaryClaims, claims }
  })
  const allocatedClaimIds = new Map<string, string[]>()
  const ownedClaimIds = new Set<string>()
  for (const candidate of [...candidates].sort((left, right) => left.scopedClaims.length - right.scopedClaims.length)) {
    const firstAvailable = [...candidate.scopedClaims, ...candidate.supplementaryClaims]
      .find((claim) => !ownedClaimIds.has(claim.id))
    const allocated = firstAvailable ? [firstAvailable.id] : []
    allocatedClaimIds.set(candidate.section.id, allocated)
    if (firstAvailable) ownedClaimIds.add(firstAvailable.id)
  }
  const focusContextClaimIdsBySection = new Map<string, string[]>()
  const focusContextClaimIds = new Set<string>()
  for (const candidate of candidates) {
    const allocated = allocatedClaimIds.get(candidate.section.id) ?? []
    for (const claim of candidate.scopedClaims) {
      if (ownedClaimIds.has(claim.id)) continue
      allocated.push(claim.id)
      ownedClaimIds.add(claim.id)
    }
    allocatedClaimIds.set(candidate.section.id, allocated)
  }
  for (const candidate of candidates) {
    const allocated = allocatedClaimIds.get(candidate.section.id) ?? []
    for (const claim of candidate.supplementaryClaims) {
      if (ownedClaimIds.has(claim.id)) continue
      allocated.push(claim.id)
      ownedClaimIds.add(claim.id)
    }
    allocatedClaimIds.set(candidate.section.id, allocated)
  }
  const centralQuestionId = centralResearchQuestionId(input.run.frame)
  for (const candidate of candidates) {
    const umbrellaSection = candidate.section.id === 'overall'
      || candidate.section.title === '综合判断'
      || Boolean(centralQuestionId && candidate.questionIds.includes(centralQuestionId))
    if (!umbrellaSection) continue
    const focusGroups = sectionFocusGroups(input, candidate.section.id, candidate.section.title, candidate.questionIds)
    allocatedClaimIds.set(
      candidate.section.id,
      representativeUmbrellaClaims(candidate.claims, focusGroups, spanById).map((claim) => claim.id)
    )
  }
  for (const candidate of candidates) {
    if (isContextualReportSection(candidate.section.title)) continue
    const focusGroups = sectionFocusGroups(input, candidate.section.id, candidate.section.title, candidate.questionIds)
    if (focusGroups.length <= 1) continue
    const allocated = allocatedClaimIds.get(candidate.section.id) ?? []
    for (const group of focusGroups) {
      const allocatedText = allocated
        .map((claimId) => claimById.get(claimId))
        .filter((claim): claim is AtomicClaim => Boolean(claim))
        .map(evidenceTextForClaim)
        .join('\n')
      if (coversResearchDimensionFocusGroups([group], allocatedText)) continue
      const supplement = candidate.claims.find((claim) =>
        !allocated.includes(claim.id) &&
        !ownedClaimIds.has(claim.id) &&
        coversResearchDimensionFocusGroups([group], evidenceTextForClaim(claim))
      )
      if (supplement) {
        allocated.push(supplement.id)
        ownedClaimIds.add(supplement.id)
        continue
      }
      const sharedPremise = candidate.claims.find((claim) =>
        !allocated.includes(claim.id) &&
        ownedClaimIds.has(claim.id) &&
        !focusContextClaimIds.has(claim.id) &&
        coversResearchDimensionFocusGroups([group], evidenceTextForClaim(claim))
      )
      if (sharedPremise) {
        const current = focusContextClaimIdsBySection.get(candidate.section.id) ?? []
        if (!current.includes(sharedPremise.id)) current.push(sharedPremise.id)
        focusContextClaimIdsBySection.set(candidate.section.id, current)
        focusContextClaimIds.add(sharedPremise.id)
      }
    }
    allocatedClaimIds.set(candidate.section.id, allocated)
  }
  for (const candidate of candidates) {
    const allocated = (allocatedClaimIds.get(candidate.section.id) ?? [])
      .map((claimId) => claimById.get(claimId))
      .filter((claim): claim is AtomicClaim => Boolean(claim))
    allocatedClaimIds.set(
      candidate.section.id,
      dedupeOverlappingSectionClaims(allocated, spanById).map((claim) => claim.id)
    )
  }

  const contextClaimIdsBySection = buildContextClaimAssignments(
    candidates,
    allocatedClaimIds,
    claimById,
    spanById,
    focusContextClaimIdsBySection
  )

  return candidates.map(({ section, questionIds, notes, questionContracts, assignmentsByClaimId, claims: candidateClaims }) => {
    const primaryClaims = (allocatedClaimIds.get(section.id) ?? [])
      .map((claimId) => claimById.get(claimId))
      .filter((claim): claim is AtomicClaim => Boolean(claim))
    const contextClaims = (contextClaimIdsBySection.get(section.id) ?? [])
      .map((claimId) => claimById.get(claimId))
      .filter((claim): claim is AtomicClaim => Boolean(claim))
    const contextualSection = isContextualReportSection(section.title)
    const directContextualEvidenceReady = contextualSection && primaryClaims.some((claim) =>
      isSelfContainedContextualEvidence(evidenceTextForClaim(claim))
    )
    const effectiveContextClaims = directContextualEvidenceReady ? [] : contextClaims
    const sectionClaims = uniqueById([...primaryClaims, ...effectiveContextClaims])
    const primaryAssignments = primaryClaims.flatMap((claim) => assignmentsByClaimId.get(claim.id) ?? [])
    const contextAssignments: ResearchEvidenceAssignment[] = effectiveContextClaims.flatMap((claim) =>
      questionContracts.map((contract) => ({
        questionId: contract.questionId,
        claimId: claim.id,
        role: 'context' as const,
        relevance: 0.25,
        explanation: '该 claim 只作为跨章节推理前提，不能单独满足当前问题。',
        source: 'deterministic' as const
      })))
    const evidenceAssignments = [...primaryAssignments, ...contextAssignments]
    const hasSupportingPrimaryEvidence = primaryAssignments.some((assignment) => assignment.role === 'supports')
    const citableSourceIds = new Set<string>()
    let hasStrongOrReliableEvidence = false
    let strongOrReliableClaimCount = 0
    for (const claim of sectionClaims) {
      let claimHasStrongOrReliableEvidence = false
      for (const spanId of claim.supportSpanIds) {
        const span = spanById.get(spanId)
        const source = span ? sourceById.get(span.sourceId) : undefined
        if (!span || !source || !canCiteEvidenceSpan(span, source)) continue
        citableSourceIds.add(source.id)
        if (isEligibleStrongWebEvidence(source, span) || (source.sourceType !== 'web' && source.reliability !== 'low' && source.reliability !== 'unknown')) {
          hasStrongOrReliableEvidence = true
          claimHasStrongOrReliableEvidence = true
        }
      }
      if (claimHasStrongOrReliableEvidence) strongOrReliableClaimCount += 1
    }
    const minimumDepth = input.run.budget.preset === 'quick' ? 1 : 2
    const minimumPrimaryDepth = input.run.budget.preset === 'deep'
      ? 2
      : contextualSection && !directContextualEvidenceReady ? 2 : 1
    const focusGroups = sectionFocusGroups(input, section.id, section.title, questionIds)
    const supportedText = primaryClaims.flatMap((claim) => [
      claim.text,
      ...claim.supportSpanIds.map((spanId) => spanById.get(spanId)?.text ?? '')
    ]).join('\n').toLowerCase()
    const coversEveryFocusGroup = coversResearchDimensionFocusGroups(focusGroups, supportedText)
    const uncoveredFocusGroups = focusGroups.filter((group) =>
      !coversResearchDimensionFocusGroups([group], supportedText)
    )
    const lacksContextualSourceDepth = input.run.budget.preset !== 'quick'
      && contextualSection
      && !directContextualEvidenceReady
      && citableSourceIds.size < 2
    const conditionalApplicationReady = contextualSection
      && !directContextualEvidenceReady
      && primaryClaims.length < minimumPrimaryDepth
      && primaryClaims.length + effectiveContextClaims.length >= 2
      && effectiveContextClaims.length >= 1
      && citableSourceIds.size >= 2
      && strongOrReliableClaimCount >= 2
    const lacksAnsweringEvidence = primaryClaims.length > 0 && !hasSupportingPrimaryEvidence
    const status = conditionalApplicationReady
      ? 'weak'
      : primaryClaims.length < minimumPrimaryDepth || lacksAnsweringEvidence || citableSourceIds.size === 0 || lacksContextualSourceDepth
        ? 'missing'
        : !coversEveryFocusGroup
          ? 'weak'
          : hasStrongOrReliableEvidence && primaryClaims.length >= minimumDepth && citableSourceIds.size >= minimumDepth
            ? 'covered'
            : 'weak'
    const limitations = [...new Set(notes.flatMap((note) => note.limitations).filter(Boolean))].slice(0, 6)
    if (primaryClaims.length > 0 && uncoveredFocusGroups.length > 0) {
      limitations.unshift('本节现有直接证据尚未独立覆盖全部分面；未覆盖部分仍缺少可引用证据，不能用已覆盖分面替代。')
    }
    if (conditionalApplicationReady) {
      limitations.unshift(`本节缺少直接点名“${section.title}”的来源，只能把已引用机制作为前提作条件分析，不能写成该场景的实测结论。`)
    }
    if (lacksAnsweringEvidence) {
      limitations.unshift(`本节现有材料只有反证或限制信息，没有直接回答“${section.title}”的证据。`)
    }
    const candidateAssignments = candidateClaims.flatMap((claim) => assignmentsByClaimId.get(claim.id) ?? [])
      .filter((assignment) => assignment.role !== 'context')
    const evidenceGapAllowed = status === 'missing' && questionIds.some((questionId) =>
      input.allowEvidenceGapQuestionIds?.has(questionId)
    )
    const evidenceGapLimitation = evidenceGapAllowed
      ? `本次补研没有形成能直接回答“${section.title}”的新增证据；本节必须明确说明无法形成可靠结论，不能用背景材料、单一案例或错位时间范围替代。`
      : undefined
    const coverageClaimIds = !evidenceGapAllowed && input.coverageContract
      ? selectCoverageRepresentativeClaimIds({
          contract: input.coverageContract,
          coverage: coverageEvidence,
          sectionId: section.id,
          candidateClaimIds: primaryClaims.map((claim) => claim.id)
        })
      : []
    return {
      sectionId: section.id,
      title: section.title,
      required: section.required,
      questionIds,
      claimIds: evidenceGapAllowed ? [] : primaryClaims.map((claim) => claim.id),
      ...(coverageClaimIds.length > 0 ? { coverageClaimIds } : {}),
      ...(!evidenceGapAllowed && effectiveContextClaims.length > 0 ? { contextClaimIds: effectiveContextClaims.map((claim) => claim.id) } : {}),
      evidenceMode: evidenceGapAllowed
        ? 'evidence_gap'
        : conditionalApplicationReady ? 'conditional_application' : 'direct',
      sourceIds: evidenceGapAllowed ? [] : [...citableSourceIds],
      status: evidenceGapAllowed ? 'weak' : status,
      limitations: [...new Set([...(evidenceGapLimitation ? [evidenceGapLimitation] : []), ...limitations])].slice(0, 6),
      questionContracts,
      evidenceAssignments: evidenceGapAllowed ? [] : evidenceAssignments,
      evidenceFingerprint: researchEvidenceAssignmentFingerprint(candidateAssignments)
    }
  })
}

export function isSelfContainedContextualEvidence(text: string): boolean {
  const normalized = text.normalize('NFKC')
  const concreteCondition = /\b(?:because|provided|unless|only\s+when|when|whenever|if|once|never)\b|由于|因为|除非|只有.{0,20}才|当|若|如果|一旦|从不|从未|永不/iu.test(normalized)
  const relationBoundary = /\b(?:but|however|although|even\s+when|whereas|while|therefore|because)\b|但|不过|即使|虽然|而|因此|由于|因为/iu.test(normalized)
  const explainsAnaphoricReference = /\b(?:because|since|therefore|as\s+a\s+result|due\s+to)\b|因为|由于|因此|原因|理由/iu.test(normalized)
  const substantiveClauses = normalized
    .split(/[.,，。;；!?！？]|\b(?:but|however|although|whereas|while|therefore|because)\b/iu)
    .map((clause) => clause.trim())
    .filter((clause) => clause.replace(/[^\p{L}\p{N}]/gu, '').length >= 12)
  return normalized.length >= 70
    && concreteCondition
    && relationBoundary
    && (!hasDanglingContextualReference(normalized) || explainsAnaphoricReference)
    && substantiveClauses.length >= 2
}

function hasDanglingContextualReference(text: string): boolean {
  return /\bthose\s+(?:kinds?|types?)\b|这些(?:种|类)|那些(?:种|类)/iu.test(text)
}

function workerInputForGate(input: WritableGateInput, questionIds: string[]): ResearchTaskWorkerInput {
  return {
    runId: input.run.id,
    brief: input.run.brief,
    frame: input.run.frame,
    budget: input.run.budget,
    task: {
      id: `writable_gate_${questionIds.join('_')}`,
      questionIds,
      reportSectionIds: questionIds,
      objective: questionIds
        .map((questionId) => input.run.frame.coreQuestions.find((question) => question.id === questionId)?.text ?? '')
        .filter(Boolean)
        .join('；'),
      expectedEvidence: [],
      sourceTypes: ['web'],
      searchHints: [],
      maxSources: input.run.budget.maxSources,
      priority: 'high' as const,
      status: 'pending' as const
    }
  }
}

function buildContextClaimAssignments(
  candidates: Array<{
    section: { id: string; title: string }
    claims: AtomicClaim[]
  }>,
  allocatedClaimIds: ReadonlyMap<string, string[]>,
  claimById: ReadonlyMap<string, AtomicClaim>,
  spanById: ReadonlyMap<string, EvidenceSpan>,
  initialAssignments: ReadonlyMap<string, string[]>
): Map<string, string[]> {
  const assignments = new Map([...initialAssignments].map(([sectionId, claimIds]) => [sectionId, [...claimIds]]))
  const foundationSections = candidates.filter((candidate) => !isContextualReportSection(candidate.section.title))
  const contextualSections = candidates.filter((candidate) => isContextualReportSection(candidate.section.title))

  for (const target of contextualSections) {
    const primaryIds = new Set(allocatedClaimIds.get(target.section.id) ?? [])
    const primaryText = [...primaryIds]
      .map((claimId) => claimById.get(claimId)?.text ?? '')
      .join('\n')
    const targetContext = `${target.section.title}\n${primaryText}`
    const selected = assignments.get(target.section.id) ?? []
    const selectedIds = new Set(selected)
    const selectedSourceIds = new Set(selected.flatMap((claimId) =>
      claimById.get(claimId)?.supportSpanIds
        .map((spanId) => spanById.get(spanId)?.sourceId)
        .filter((sourceId): sourceId is string => Boolean(sourceId)) ?? []
    ))
    const selectedConceptKeys = new Set(selected.flatMap((claimId) => {
      const claim = claimById.get(claimId)
      return claim ? contextClaimConceptKeys(claim) : []
    }))
    const selectedPrimaryKeys = new Set(selected.flatMap((claimId) => {
      const claim = claimById.get(claimId)
      const key = claim ? contextClaimPrimaryKey(claim) : undefined
      return key ? [key] : []
    }))
    const rankedFoundationClaims = foundationSections.flatMap((foundation) => {
      if ((initialAssignments.get(foundation.section.id) ?? []).some((claimId) => primaryIds.has(claimId))) return []
      return (allocatedClaimIds.get(foundation.section.id) ?? [])
        .filter((candidateId) => !primaryIds.has(candidateId) && !selectedIds.has(candidateId))
        .map((candidateId) => claimById.get(candidateId))
        .filter((candidate): candidate is AtomicClaim => Boolean(candidate))
        .sort((left, right) =>
          contextClaimScore(right, targetContext) -
          contextClaimScore(left, targetContext)
        )
        .slice(0, 3)
    }).sort((left, right) =>
      contextClaimScore(right, targetContext) -
      contextClaimScore(left, targetContext)
    )
    const remaining = [...rankedFoundationClaims]
    while (remaining.length > 0 && selected.length < 2) {
      const sourceIdsFor = (claim: AtomicClaim) => claim.supportSpanIds
        .map((spanId) => spanById.get(spanId)?.sourceId)
        .filter((sourceId): sourceId is string => Boolean(sourceId))
      const addsSource = (claim: AtomicClaim) => selectedSourceIds.size === 0
        || sourceIdsFor(claim).some((sourceId) => !selectedSourceIds.has(sourceId))
      const addsConcept = (claim: AtomicClaim) => selectedConceptKeys.size === 0
        || contextClaimConceptKeys(claim).some((key) => !selectedConceptKeys.has(key))
      const addsPrimaryConcept = (claim: AtomicClaim) => {
        const key = contextClaimPrimaryKey(claim)
        return selectedPrimaryKeys.size === 0 || Boolean(key && !selectedPrimaryKeys.has(key))
      }
      const preferredIndex = Math.max(0, [
        (claim: AtomicClaim) => addsSource(claim) && addsPrimaryConcept(claim),
        (claim: AtomicClaim) => addsPrimaryConcept(claim),
        (claim: AtomicClaim) => addsSource(claim) && addsConcept(claim),
        (claim: AtomicClaim) => addsSource(claim),
        (claim: AtomicClaim) => addsConcept(claim)
      ].map((predicate) => remaining.findIndex(predicate)).find((index) => index >= 0) ?? 0)
      const [claim] = remaining.splice(preferredIndex >= 0 ? preferredIndex : 0, 1)
      if (!claim) break
      selected.push(claim.id)
      selectedIds.add(claim.id)
      sourceIdsFor(claim).forEach((sourceId) => selectedSourceIds.add(sourceId))
      contextClaimConceptKeys(claim).forEach((key) => selectedConceptKeys.add(key))
      const primaryKey = contextClaimPrimaryKey(claim)
      if (primaryKey) selectedPrimaryKeys.add(primaryKey)
    }
    if (selected.length > 0) assignments.set(target.section.id, selected)
  }
  return assignments
}

function contextClaimScore(claim: AtomicClaim, targetContext: string): number {
  const text = claim.text.trim()
  const syntaxOnly = /^[\p{L}\p{N}_.-]+\s*:\s*[\p{L}\p{N}_.-]+(?:\s*,\s*[\p{L}\p{N}_.-]+)*\s*$/u.test(text)
  const lengthScore = text.length >= 48 && text.length <= 420
    ? 180
    : text.length >= 28 ? 40 : -240
  const proseScore = syntaxOnly ? -800 : claim.entities.length > 0 ? 160 : 0
  const confidenceScore = claim.confidence === 'high' ? 80 : claim.confidence === 'medium' ? 30 : 0
  const sharedSignalScore = sharedContextSignalCount(targetContext, `${claim.text}\n${claim.entities.join(' ')}`) * 700
  return sharedSignalScore
    + (claim.critical ? 100 : 0)
    + lengthScore
    + proseScore
    + confidenceScore
}

function contextClaimConceptKeys(claim: AtomicClaim): string[] {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().trim()
  const generic = new Set(['source', 'sources', 'evidence', 'claim', 'claims', 'fact', 'facts', 'data'])
  return [...new Set([
    ...claim.entities,
    ...(claim.text.match(/\b[A-Za-z]+(?:-[A-Za-z0-9]+)+\b/gu) ?? []),
    ...researchSignalTerms(claim.text)
  ].map(normalize).filter((value) => value.length >= 3 && !generic.has(value)))]
}

function dedupeOverlappingSectionClaims(
  claims: AtomicClaim[],
  spanById: ReadonlyMap<string, EvidenceSpan>
): AtomicClaim[] {
  const selected: AtomicClaim[] = []
  for (const claim of claims) {
    const duplicateIndex = selected.findIndex((candidate) =>
      claimsShareSource(claim, candidate, spanById) && claimTokenContainment(claim.text, candidate.text) >= 0.72
    )
    if (duplicateIndex < 0) {
      selected.push(claim)
      continue
    }
    if (sectionClaimRichness(claim) > sectionClaimRichness(selected[duplicateIndex]!)) {
      selected[duplicateIndex] = claim
    }
  }
  return selected
}

function claimsShareSource(
  left: AtomicClaim,
  right: AtomicClaim,
  spanById: ReadonlyMap<string, EvidenceSpan>
): boolean {
  const leftSources = new Set(left.supportSpanIds
    .map((spanId) => spanById.get(spanId)?.sourceId)
    .filter((sourceId): sourceId is string => Boolean(sourceId)))
  return right.supportSpanIds.some((spanId) => {
    const sourceId = spanById.get(spanId)?.sourceId
    return Boolean(sourceId && leftSources.has(sourceId))
  })
}

function claimTokenContainment(left: string, right: string): number {
  const tokens = (value: string) => new Set([
    ...(value.normalize('NFKC').toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/gu) ?? [])
      .filter((token) => token.length >= 3),
    ...hanCharacterPairs(value)
  ])
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  const minimum = Math.min(leftTokens.size, rightTokens.size)
  if (minimum === 0) return 0
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length
  return overlap / minimum
}

function hanCharacterPairs(value: string): string[] {
  return (value.match(/[\u3400-\u9fff]{2,}/gu) ?? []).flatMap((run) => {
    const pairs: string[] = []
    for (let index = 0; index < run.length - 1; index += 1) pairs.push(run.slice(index, index + 2))
    return pairs
  })
}

function sectionClaimRichness(claim: AtomicClaim): number {
  const selfContainedContext = isSelfContainedContextualEvidence(claim.text)
  const danglingContextReference = /\bthose\s+(?:kinds?|types?)\b|这些(?:种|类)|那些(?:种|类)/iu.test(claim.text)
  return Math.min(claim.text.length, 360)
    + claim.entities.length * 20
    + (claim.confidence === 'high' ? 30 : claim.confidence === 'medium' ? 15 : 0)
    + (claim.critical ? 20 : 0)
    + (selfContainedContext ? 500 : 0)
    - (!selfContainedContext && danglingContextReference ? 300 : 0)
}

function contextClaimPrimaryKey(claim: AtomicClaim): string | undefined {
  return contextClaimConceptKeys(claim)
    .sort((left, right) => right.length - left.length)[0]
}

function sharedContextSignalCount(left: string, right: string): number {
  const leftSignals = new Set(contextSignalKeys(left))
  return [...new Set(contextSignalKeys(right))].filter((signal) => leftSignals.has(signal)).length
}

function contextSignalKeys(value: string): string[] {
  return researchSignalTerms(value).flatMap((term) => {
    const normalized = term.normalize('NFKC').toLowerCase()
    const candidates = [normalized, ...normalized.split(/[-_/]/u)]
    return candidates.map((candidate) => {
      if (/^[a-z]{7,}ations$/u.test(candidate)) return candidate.slice(0, -5)
      if (/^[a-z]{7,}ation$/u.test(candidate)) return candidate.slice(0, -4)
      if (/^[a-z]{7,}ness$/u.test(candidate)) return candidate.slice(0, -4)
      if (/^[a-z]{7,}ities$/u.test(candidate)) return `${candidate.slice(0, -5)}y`
      if (/^[a-z]{7,}ity$/u.test(candidate)) return candidate.slice(0, -3)
      if (/^[a-z]{5,}ies$/u.test(candidate)) return `${candidate.slice(0, -3)}y`
      if (/^[a-z]{5,}s$/u.test(candidate)) return candidate.slice(0, -1)
      return candidate
    }).filter((candidate) => candidate.length >= 3 || /[\u4e00-\u9fff]{2,}/u.test(candidate))
  })
}

function sectionFocusGroups(input: WritableGateInput, sectionId: string, title: string, questionIds: string[]): string[][] {
  const centralQuestionId = centralResearchQuestionId(input.run.frame)
  const umbrellaSection = sectionId === 'overall'
    || title === '综合判断'
    || Boolean(centralQuestionId && questionIds.includes(centralQuestionId))
  const focusedQuestionIds = umbrellaSection && centralQuestionId
    ? questionIds.filter((questionId) => questionId !== centralQuestionId)
    : questionIds
  if (umbrellaSection && focusedQuestionIds.length === 0) return []
  const groups = focusedQuestionIds
    .map((questionId) => input.run.frame.coreQuestions.find((question) => question.id === questionId)?.text ?? '')
    .flatMap(researchDimensionFocusGroups)
  const distinctGroups = [...new Map(groups.map((group) => [group[0]?.normalize('NFKC').toLowerCase() ?? '', group])).values()]
    .filter((group) => group.length > 0)
  return distinctGroups.length > 1 ? distinctGroups : []
}

function representativeUmbrellaClaims(
  claims: AtomicClaim[],
  focusGroups: string[][],
  spanById: ReadonlyMap<string, EvidenceSpan>
): AtomicClaim[] {
  const selected: AtomicClaim[] = []
  const selectedIds = new Set<string>()
  const selectedSourceIds = new Set<string>()
  const sourceIds = (claim: AtomicClaim) => [...new Set(claim.supportSpanIds
    .map((spanId) => spanById.get(spanId)?.sourceId)
    .filter((sourceId): sourceId is string => Boolean(sourceId)))]
  const score = (claim: AtomicClaim) => {
    const coveredFacets = focusGroups.filter((group) =>
      coversResearchDimensionFocusGroups([group], claim.text)
    ).length
    const newSources = sourceIds(claim).filter((sourceId) => !selectedSourceIds.has(sourceId)).length
    return (coveredFacets * 1_000)
      + (newSources * 300)
      + (claim.critical ? 100 : 0)
      + (claim.confidence === 'high' ? 30 : claim.confidence === 'medium' ? 15 : 0)
      + Math.max(0, 240 - claim.text.length)
  }
  const add = (claim: AtomicClaim | undefined) => {
    if (!claim || selectedIds.has(claim.id)) return
    selected.push(claim)
    selectedIds.add(claim.id)
    sourceIds(claim).forEach((sourceId) => selectedSourceIds.add(sourceId))
  }

  for (const group of focusGroups) {
    add([...claims]
      .filter((claim) => !selectedIds.has(claim.id))
      .filter((claim) => coversResearchDimensionFocusGroups([group], claim.text))
      .sort((left, right) => score(right) - score(left))[0])
  }
  for (const claim of [...claims].sort((left, right) => score(right) - score(left))) {
    add(claim)
    if (selected.length >= 8) break
  }
  return selected
}

function writableGateVerdict(
  input: WritableGateInput,
  issues: VerificationIssue[],
  warnings: string[]
): QualityVerdict {
  return {
    pass: false,
    scores: {
      requirementsAlignment: 0,
      answersCoreQuestions: 0,
      followsCoreResearchThread: 0,
      reportCompleteness: 0,
      citationAccuracy: 0,
      evidenceCoverage: 0,
      sourceQuality: 0,
      conflictHandling: 0,
      uncertaintyCalibration: warnings.length > 0 ? 0.4 : 0,
      writingQuality: 0,
      llmJudgeOverall: 0
    },
    blockingIssues: issues.map((issue) => issue.message),
    warnings: [
      ...warnings,
      'WritableGate 已在写作前拦截，未调用 Synthesis Writer 或 LLM Judge。'
    ],
    recommendedFixes: [
      '按缺失章节补充可引用证据后再进入报告合成。',
      '确保每个必填章节至少有对应 claim、citable source 和 evidence span。'
    ],
    issues,
    verifiedAt: input.nowIso
  }
}

function blocking(code: string, message: string): VerificationIssue {
  return { code, message, severity: 'blocking' }
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    result.push(item)
  }
  return result
}
