/**
 * [INPUT]: 依赖 ReportArchitect、Writer、ResearchEditor、CitationResolver、QualityVerifier/Judge、EvidenceStore 和 Runtime 回调
 * [OUTPUT]: 对外提供 runResearchSynthesisPipeline 与 blueprintMatchesEvidenceMap，执行绑定问题证据角色指纹及硬范围代表 claim 的可复用蓝图、正文、编辑后复用 Writer 事实安全链并在润色破坏结构时保留已验证原稿、结论边界校验、引用清理、引用解析后的成品级断句与章内去重、最终摘要去重、携带上一轮失败项的 Judge、持久排除抽取页眉噪声或 Judge 明确判定为章节无关的 claim、先分类再判死循环的缺证补研、evidence_gap 受限交付和质量结果敏感修订，并把局限性缺口只路由到收尾而不重写全部章节
 * [POS]: research/runtime 的编辑流水线；蓝图要求已选 claim 仍属于当前章节且来源/上下文/问题证据角色未变化，新增直接回答证据会使旧蓝图失效；不按固定尝试次数退出，ModelSynthesisWriter 已执行分章局部修复后仍失败时不再整波重放；同一目标问题与章节证据状态不重复搜索，补研无新增可回答事实时切换受限交付，本地门已通过时只允许覆盖缺证类 Judge 否决，写作、引用和事实扩写仍继续阻塞
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type {
  CitationResolution,
  ReportArchitect,
  ReportArchitectInput,
  ResearchEditor,
  SynthesisWriter,
  SynthesisWriterInput
} from '../agents/types.js'
import { SynthesisWriterFailed } from '../agents/SynthesisWriter.js'
import { prepareSectionedDraft } from '../agents/SectionSynthesisWriter.js'
import { dedupeSummaryBullets, finalizeResolvedReportProse } from '../agents/ResearchEditor.js'
import { extractUsedClaimIds } from '../agents/SynthesisWriterSupport.js'
import type { ResearchEventInput } from '../core/events.js'
import { hashText } from '../core/hash.js'
import { reportClosingDepthIssue } from '../core/report-closing.js'
import type {
  QualityVerdict,
  ResearchExecutionControl,
  ResearchModelUsageRecord,
  ResearchPlan,
  ResearchReportBlueprint,
  ResearchRun,
  SectionEvidenceMapEntry
} from '../core/types.js'
import type { CitationResolver } from '../evidence/CitationResolver.js'
import type { EvidenceStore } from '../evidence/EvidenceStore.js'
import type { CitationBinding } from '../evidence/types.js'
import { containsExtractionBoilerplate, sanitizeUncitedResolvedSentences } from '../evidence/CitationProximity.js'
import { renderFinalReportMarkdown } from '../markdown/ReportRenderer.js'
import type { ResearchRunRepository } from '../storage/ResearchRunRepository.js'
import { HeuristicQualityJudge, mergeQualityVerdictWithJudge, type QualityJudge } from '../verification/QualityJudge.js'
import type { QualityVerifier } from '../verification/QualityVerifier.js'
import { judgeFailureType, verificationRepairTargetQuestions } from './ResearchRuntimePolicy.js'
import { evaluateWritableGate } from './ResearchWritableGate.js'
import type { VerificationEvidenceRepairResult } from './ResearchVerificationRepair.js'

export type ResearchSynthesisPipelineResult = {
  resolvedReport: CitationResolution
  finalReportMarkdown: string
}

export async function runResearchSynthesisPipeline(input: {
  run: ResearchRun
  plan: ResearchPlan
  evidenceStore: EvidenceStore
  sectionEvidenceMap: SectionEvidenceMapEntry[]
  execution: ResearchExecutionControl
  reportArchitect: ReportArchitect
  synthesisWriter: SynthesisWriter
  researchEditor: ResearchEditor
  citationResolver: CitationResolver
  qualityVerifier: QualityVerifier
  qualityJudge: QualityJudge
  repository: ResearchRunRepository
  nowIso: () => string
  record: (event: ResearchEventInput) => Promise<void>
  recordModelUsage: (records?: ResearchModelUsageRecord[]) => Promise<void>
  repairEvidence: (verdict: QualityVerdict, attempt: number) => Promise<VerificationEvidenceRepairResult>
}): Promise<ResearchSynthesisPipelineResult> {
  const {
    run,
    plan,
    evidenceStore,
    sectionEvidenceMap,
    execution,
    reportArchitect,
    synthesisWriter,
    researchEditor,
    citationResolver,
    qualityVerifier,
    qualityJudge,
    repository,
    nowIso,
    record,
    recordModelUsage,
    repairEvidence
  } = input
  let resolvedReport: CitationResolution | undefined
  let finalReportMarkdown = ''
  let previousFailure: {
    verdict: QualityVerdict
    draftMarkdown: string
    targets: { sectionIds: string[]; rewriteClosing: boolean }
  } | undefined
  let writerRetryFeedback: string | undefined
  let previousDraftErrorSignature: string | undefined
  const seenQualityFailureStates = new Set<string>()
  const evidenceRepairAttemptedStates = new Set<string>()
  const limitedDeliveryQuestionIds = new Set(sectionEvidenceMap
    .filter((section) => section.evidenceMode === 'evidence_gap')
    .flatMap((section) => section.questionIds))
  const exhaustedEvidenceQuestionIds = new Set(limitedDeliveryQuestionIds)
  let currentSectionEvidenceMap = sectionEvidenceMap
  const buildArchitectInput = (): ReportArchitectInput => ({
    runId: run.id,
    brief: run.brief,
    frame: run.frame,
    plan,
    budget: run.budget,
    reportContract: run.reportContract,
    coverageContract: run.coverageContract,
    sectionEvidenceMap: currentSectionEvidenceMap,
    sources: evidenceStore.listSources(),
    evidenceSpans: evidenceStore.listEvidenceSpans(),
    claims: evidenceStore.listClaims(),
    notes: evidenceStore.listNotes(),
    execution,
    nowIso: nowIso()
  })
  let architectInput = buildArchitectInput()
  let reportBlueprint: ResearchReportBlueprint
  if (blueprintMatchesEvidenceMap(run.reportBlueprint, currentSectionEvidenceMap)) {
    reportBlueprint = run.reportBlueprint!
  } else {
    const freshBlueprint = await reportArchitect.createBlueprint(architectInput)
    reportBlueprint = applyPersistedBlueprintClaimExclusions(freshBlueprint, run.reportBlueprint)
  }
  reportBlueprint = pruneExtractionNoiseBlueprintClaims(reportBlueprint, evidenceStore.listClaims())
  await recordModelUsage(reportBlueprint.modelUsage)
  run.reportBlueprint = reportBlueprint
  await repository.writeRun(run)

  let attempt = 1
  while (true) {
    let draft
    try {
      architectInput = buildArchitectInput()
      const writerInput: SynthesisWriterInput = {
        ...architectInput,
        reportBlueprint,
        nowIso: nowIso(),
        ...(writerRetryFeedback ? { retryFeedback: writerRetryFeedback } : {}),
        ...(previousFailure ? {
          revision: {
            attempt,
            previousVerdict: previousFailure.verdict,
            previousDraftMarkdown: previousFailure.draftMarkdown,
            targets: previousFailure.targets
          }
        } : {})
      }
      const writerDraft = await synthesisWriter.writeDraft(writerInput)
      const editedDraft = await researchEditor.editDraft({ ...writerInput, draft: writerDraft })
      draft = writerDraft.sectioned
        ? editorSafeSectionedDraft(editedDraft, writerDraft, writerInput)
        : editedDraft
      writerRetryFeedback = undefined
    } catch (error) {
      writerRetryFeedback = error instanceof Error ? error.message : String(error)
      if (error instanceof SynthesisWriterFailed || isTerminalWriterDeadLoop(writerRetryFeedback)) throw error
      const errorSignature = normalizedFailureSignature(writerRetryFeedback)
      if (previousDraftErrorSignature === errorSignature) {
        throw new Error(`Research synthesis entered a repeated writer-error dead loop: ${writerRetryFeedback}`)
      }
      previousDraftErrorSignature = errorSignature
      continue
    }
    previousDraftErrorSignature = undefined
    await recordModelUsage(draft.modelUsage)
    await record({
      type: 'REPORT_DRAFTED',
      draftId: `draft_${run.id}_${attempt}`,
      claimCount: draft.claimIds.length,
      attempt
    })
    if (draft.diagnostic) {
      await repository.writeReportDraft(run.artifacts, draft.markdown)
      run.draftReportAvailable = true
      throw new Error('BasicSynthesisWriter diagnostic draft is not a user-visible DeepResearch report')
    }

    resolvedReport = citationResolver.resolve({
      draft,
      reportPath: run.artifacts.reportPath,
      sources: evidenceStore.listSources(),
      evidenceSpans: evidenceStore.listEvidenceSpans(),
      claims: evidenceStore.listClaims(),
      nowIso: nowIso()
    })
    resolvedReport = {
      ...resolvedReport,
      markdown: finalizeResolvedReportProse(sanitizeUncitedResolvedSentences(resolvedReport.markdown))
    }
    await record({
      type: 'CITATIONS_RESOLVED',
      citationCount: resolvedReport.bindings.length,
      unresolvedCitationIds: resolvedReport.unresolvedCitationIds,
      attempt
    })

    finalReportMarkdown = dedupeSummaryBullets(renderFinalReportMarkdown(run, resolvedReport.markdown, {
      generatedAt: nowIso(),
      sourceCount: evidenceStore.listSources().length,
      claimCount: evidenceStore.listClaims().length
    }))
    await repository.writeReportDraft(run.artifacts, finalReportMarkdown)
    run.draftReportAvailable = true

    const deterministicVerdict = qualityVerifier.verify({
      brief: run.brief,
      frame: run.frame,
      plan,
      budget: run.budget,
      reportMarkdown: finalReportMarkdown,
      notes: evidenceStore.listNotes(),
      sources: evidenceStore.listSources(),
      claims: evidenceStore.listClaims(),
      evidenceSpans: evidenceStore.listEvidenceSpans(),
      citations: resolvedReport.bindings,
      reportContract: run.reportContract,
      reportBlueprint,
      coverageContract: run.coverageContract,
      gapVerdicts: run.gapVerdicts ?? [],
      unresolvedCitationIds: resolvedReport.unresolvedCitationIds,
      nowIso: nowIso()
    })
    const skipDefaultJudgeForQuickDiagnostic = run.budget.preset === 'quick' &&
      run.brief.sourcePolicy.requireCitations === false &&
      qualityJudge instanceof HeuristicQualityJudge
    const judgeVerdict = skipDefaultJudgeForQuickDiagnostic || !deterministicVerdict.pass
      ? undefined
      : await qualityJudge.judge({
        scope: run.scope,
        brief: run.brief,
        frame: run.frame,
        plan,
        budget: run.budget,
        reportMarkdown: finalReportMarkdown,
        sources: evidenceStore.listSources(),
        notes: evidenceStore.listNotes(),
        claims: evidenceStore.listClaims(),
        evidenceSpans: evidenceStore.listEvidenceSpans(),
        citations: resolvedReport.bindings,
        deterministicVerdict,
        reportBlueprint,
        ...(previousFailure ? { previousVerdict: previousFailure.verdict } : {}),
        execution,
        nowIso: nowIso()
      })
    await recordModelUsage(judgeVerdict?.modelUsage)
    let verdict = judgeVerdict
      ? mergeQualityVerdictWithJudge(deterministicVerdict, judgeVerdict)
      : deterministicVerdict
    if (canPublishAfterEvidenceExhaustion(verdict, deterministicVerdict, exhaustedEvidenceQuestionIds)) {
      verdict = publishAfterEvidenceExhaustion(verdict)
    }
    run.verification = verdict
    await record({ type: 'VERIFICATION_COMPLETED', verdict, attempt, finalAttempt: verdict.pass })
    await repository.writeRun(run)
    if (verdict.pass) break
    const prunedBlueprint = pruneJudgeRejectedBlueprintClaims(
      reportBlueprint,
      verdict,
      evidenceStore.listClaims()
    )
    if (prunedBlueprint !== reportBlueprint) {
      reportBlueprint = prunedBlueprint
      run.reportBlueprint = reportBlueprint
      await repository.writeRun(run)
    }
    const revisionTargets = buildSynthesisRevisionTargets({
      verdict,
      blueprint: reportBlueprint,
      citations: resolvedReport.bindings,
      draftMarkdown: draft.markdown
    })
    const qualityState = qualityOutcomeState(verdict, evidenceStore.listClaims())
    const repeatedQualityState = seenQualityFailureStates.has(qualityState)
    seenQualityFailureStates.add(qualityState)

    const failureType = judgeFailureType(verdict)
    if (failureType === 'judge_unavailable') {
      throw new Error(`Research Judge unavailable after repeating the same failed repair state: ${verdict.blockingIssues.join('; ')}`)
    }
    if (failureType === 'scope_frame_mapping_error') {
      throw new Error(`Research frame mapping failed: ${verdict.blockingIssues.join('; ')}`)
    }
    if (failureType === 'evidence_blocking' || failureType === 'missing_required_dimensions') {
      const targetQuestionIds = verificationRepairTargetQuestions(run, verdict).map((question) => question.id)
      const repairState = evidenceRepairState(targetQuestionIds, currentSectionEvidenceMap)
      const mayAttemptEvidenceRepair = targetQuestionIds.some((questionId) => !limitedDeliveryQuestionIds.has(questionId))
        && !evidenceRepairAttemptedStates.has(repairState)
      evidenceRepairAttemptedStates.add(repairState)
      const repair = mayAttemptEvidenceRepair
        ? await repairEvidence(verdict, attempt)
        : { progress: false, exhaustedQuestionIds: targetQuestionIds }
      repair.exhaustedQuestionIds.forEach((questionId) => limitedDeliveryQuestionIds.add(questionId))
      repair.exhaustedQuestionIds.forEach((questionId) => exhaustedEvidenceQuestionIds.add(questionId))
      if (repair.progress || repair.exhaustedQuestionIds.length > 0) {
        const refreshedGate = evaluateWritableGate({
          run,
          reportContract: run.reportContract,
          coverageContract: run.coverageContract,
          sources: evidenceStore.listSources(),
          evidenceSpans: evidenceStore.listEvidenceSpans(),
          claims: evidenceStore.listClaims(),
          notes: evidenceStore.listNotes(),
          nowIso: nowIso(),
          allowEvidenceGapQuestionIds: limitedDeliveryQuestionIds
        })
        if (!refreshedGate.ok && refreshedGate.verdict) {
          run.verification = refreshedGate.verdict
          await repository.writeRun(run)
          throw new Error(`Research writable gate still failed after evidence repair: ${refreshedGate.verdict.blockingIssues.join('; ')}`)
        }
        currentSectionEvidenceMap = refreshedGate.sectionEvidenceMap
        architectInput = buildArchitectInput()
        const freshBlueprint = await reportArchitect.createBlueprint(architectInput)
        reportBlueprint = applyPersistedBlueprintClaimExclusions(freshBlueprint, reportBlueprint)
        reportBlueprint = pruneExtractionNoiseBlueprintClaims(reportBlueprint, evidenceStore.listClaims())
        await recordModelUsage(reportBlueprint.modelUsage)
        run.reportBlueprint = reportBlueprint
        await repository.writeRun(run)
        previousFailure = { verdict, draftMarkdown: draft.markdown, targets: revisionTargets }
        attempt += 1
        continue
      }
      if (repeatedQualityState) {
        throw new Error(`Research synthesis entered a quality dead loop after ${attempt} attempt(s): ${verdict.blockingIssues.join('; ')}`)
      }
      throw new Error(`Research verification failed due to ${failureType}: ${verdict.blockingIssues.join('; ')}`)
    }
    if (repeatedQualityState) {
      throw new Error(`Research synthesis entered a quality dead loop after ${attempt} attempt(s): ${verdict.blockingIssues.join('; ')}`)
    }
    if (failureType === 'citation_fixable') {
      previousFailure = { verdict, draftMarkdown: draft.markdown, targets: revisionTargets }
      attempt += 1
      continue
    }
    previousFailure = { verdict, draftMarkdown: draft.markdown, targets: revisionTargets }
    attempt += 1
  }

  if (!resolvedReport || !finalReportMarkdown || run.verification?.pass !== true) {
    throw new Error('Research verification did not produce a passing report')
  }
  return { resolvedReport, finalReportMarkdown }
}

function editorSafeSectionedDraft(
  editedDraft: Awaited<ReturnType<SynthesisWriter['writeDraft']>>,
  writerDraft: Awaited<ReturnType<SynthesisWriter['writeDraft']>>,
  input: SynthesisWriterInput
): Awaited<ReturnType<SynthesisWriter['writeDraft']>> {
  try {
    const markdown = prepareSectionedDraft(editedDraft.markdown, input)
    if (reportClosingDepthIssue(markdown, input.budget.preset)) return mergeDraftUsage(writerDraft, editedDraft)
    return {
      ...editedDraft,
      markdown,
      claimIds: extractUsedClaimIds(markdown, new Set(writerDraft.claimIds))
    }
  } catch {
    return mergeDraftUsage(writerDraft, editedDraft)
  }
}

function mergeDraftUsage(
  writerDraft: Awaited<ReturnType<SynthesisWriter['writeDraft']>>,
  editedDraft: Awaited<ReturnType<SynthesisWriter['writeDraft']>>
): Awaited<ReturnType<SynthesisWriter['writeDraft']>> {
  const modelUsage = [...(writerDraft.modelUsage ?? []), ...(editedDraft.modelUsage ?? [])]
  return {
    ...writerDraft,
    ...(modelUsage.length > 0 ? { modelUsage } : {})
  }
}

export function canPublishAfterEvidenceExhaustion(
  verdict: QualityVerdict,
  deterministicVerdict: QualityVerdict,
  exhaustedQuestionIds: ReadonlySet<string>
): boolean {
  if (verdict.pass || !deterministicVerdict.pass || exhaustedQuestionIds.size === 0) return false
  const judge = verdict.llmJudge
  if (!judge) return false
  if (
    judge.scores.requirementsAlignment < 0.65 ||
    judge.scores.answersConfirmedScope < 0.65 ||
    judge.scores.followsResearchFrame < 0.65 ||
    judge.scores.citationFaithfulness < 0.75 ||
    judge.scores.writingQuality < 0.6
  ) return false
  const blockingJudgeIssues = (verdict.llmJudge?.issues ?? []).filter((issue) =>
    issue.severity === 'blocking' && !issue.code.endsWith('_score_below_threshold')
  )
  if (blockingJudgeIssues.length === 0) return false
  return blockingJudgeIssues.every((issue) =>
    (issue.category === 'evidence' || issue.category === 'coverage')
    && /(?:missing|lack|insufficient|未提供|未覆盖|缺乏|缺少|不足)/iu.test(issue.code)
  )
}

function publishAfterEvidenceExhaustion(verdict: QualityVerdict): QualityVerdict {
  const warning = '针对同一证据缺口的补研没有新增可回答事实；本地证据、引用和写作校验已通过，报告按明确证据边界受限发布。'
  const llmJudge = verdict.llmJudge
    ? (() => {
        const { failureKind: _failureKind, ...judgeWithoutFailure } = verdict.llmJudge!
        return {
        ...judgeWithoutFailure,
        pass: true,
        rationale: '确定性证据、引用和写作校验已通过；仅剩补研穷尽问题对应的缺证否决，已转为受限发布警告。',
        blockingIssues: [],
        issues: (verdict.llmJudge.issues ?? []).map((issue) =>
          issue.severity === 'blocking' ? { ...issue, severity: 'warning' as const } : issue
        ),
        warnings: [...verdict.llmJudge.warnings, warning]
      }
      })()
    : undefined
  return {
    ...verdict,
    pass: true,
    ...(llmJudge ? { llmJudge } : {}),
    blockingIssues: [],
    issues: verdict.issues.map((issue) =>
      issue.severity === 'blocking' ? { ...issue, severity: 'warning' as const } : issue
    ),
    warnings: [...verdict.warnings, warning]
  }
}

function evidenceRepairState(
  targetQuestionIds: string[],
  sectionEvidenceMap: SectionEvidenceMapEntry[]
): string {
  const targetIds = new Set(targetQuestionIds)
  const sections = sectionEvidenceMap
    .filter((section) => section.questionIds.some((questionId) => targetIds.has(questionId)))
    .map((section) => ({
      sectionId: section.sectionId,
      status: section.status,
      evidenceMode: section.evidenceMode ?? 'direct',
      evidenceFingerprint: section.evidenceFingerprint ?? '',
      claimIds: [...section.claimIds].sort(),
      sourceCount: section.sourceIds.length
    }))
    .sort((left, right) => left.sectionId.localeCompare(right.sectionId))
  return JSON.stringify({ questionIds: [...targetIds].sort(), sections })
}

export function pruneJudgeRejectedBlueprintClaims(
  blueprint: ResearchReportBlueprint,
  verdict: QualityVerdict,
  claims: Array<{ id: string; text: string }>
): ResearchReportBlueprint {
  const rejectedIssues = (verdict.llmJudge?.issues ?? []).filter((issue) =>
    issue.severity === 'blocking' &&
    Boolean(issue.claimId) &&
    /(?:citation_unfaithful|citation_mismatch|evidence_mismatch|irrelevant_evidence)$/iu.test(issue.code) &&
    /(?:无关|不相关|不直接相关|irrelevant|unrelated|not\s+relevant)/iu.test(issue.message)
  )
  if (rejectedIssues.length === 0) return blueprint
  const claimTextById = new Map(claims.map((claim) => [claim.id, claim.text]))
  const rejectedBySectionId = new Map(blueprint.sections.map((section) => [
    section.id,
    new Set(rejectedIssues
      .filter((issue) => section.claimIds.includes(issue.claimId!))
      .filter((issue) => {
        const namedSections = blueprint.sections.filter((candidate) => issue.message.includes(candidate.title))
        return namedSections.length === 0 || namedSections.some((candidate) => candidate.id === section.id)
      })
      .map((issue) => issue.claimId!))
  ] as const))
  return excludeBlueprintClaims(blueprint, rejectedBySectionId, claimTextById)
}

function pruneExtractionNoiseBlueprintClaims(
  blueprint: ResearchReportBlueprint,
  claims: Array<{ id: string; text: string }>
): ResearchReportBlueprint {
  const claimTextById = new Map(claims.map((claim) => [claim.id, claim.text]))
  const rejectedBySectionId = new Map(blueprint.sections.map((section) => [
    section.id,
    new Set(section.claimIds.filter((claimId) => containsExtractionBoilerplate(claimTextById.get(claimId) ?? '')))
  ] as const))
  return excludeBlueprintClaims(blueprint, rejectedBySectionId, claimTextById)
}

function excludeBlueprintClaims(
  blueprint: ResearchReportBlueprint,
  rejectedBySectionId: ReadonlyMap<string, ReadonlySet<string>>,
  claimTextById: ReadonlyMap<string, string>
): ResearchReportBlueprint {
  let changed = false
  const sections = blueprint.sections.map((section) => {
    const rejectedForSection = rejectedBySectionId.get(section.id) ?? new Set<string>()
    if (rejectedForSection.size === 0) return section
    const retainedClaimIds = section.claimIds.filter((claimId) => !rejectedForSection.has(claimId))
    if (retainedClaimIds.length < 2) return section
    changed = true
    const removedTexts = [...rejectedForSection]
      .map((claimId) => claimTextById.get(claimId) ?? '')
      .filter(Boolean)
    const conclusionDependsOnRejectedClaim = removedTexts.some((text) =>
      normalizedBlueprintText(section.argument.conclusion).includes(normalizedBlueprintText(text))
    )
    return {
      ...section,
      claimIds: retainedClaimIds,
      excludedClaimIds: [...new Set([...(section.excludedClaimIds ?? []), ...rejectedForSection])],
      argument: {
        ...section.argument,
        conclusion: conclusionDependsOnRejectedClaim
          ? claimTextById.get(retainedClaimIds[0] ?? '') ?? section.argument.conclusion
          : section.argument.conclusion,
        claimIds: section.argument.claimIds.filter((claimId) => !rejectedForSection.has(claimId)),
        counterClaimIds: section.argument.counterClaimIds.filter((claimId) => !rejectedForSection.has(claimId))
      }
    }
  })
  return changed ? { ...blueprint, sections } : blueprint
}

function applyPersistedBlueprintClaimExclusions(
  blueprint: ResearchReportBlueprint,
  previous: ResearchReportBlueprint | undefined
): ResearchReportBlueprint {
  if (!previous?.sections.some((section) => (section.excludedClaimIds?.length ?? 0) > 0)) return blueprint
  let changed = false
  const exclusionsBySectionId = new Map(previous.sections.map((section) => [
    section.id,
    new Set(section.excludedClaimIds ?? [])
  ] as const))
  const sections = blueprint.sections.map((section) => {
    const excluded = exclusionsBySectionId.get(section.id)
    if (!excluded || excluded.size === 0) return section
    const claimIds = section.claimIds.filter((claimId) => !excluded.has(claimId))
    if (claimIds.length < 2 || claimIds.length === section.claimIds.length) return section
    changed = true
    return {
      ...section,
      claimIds,
      excludedClaimIds: [...excluded],
      argument: {
        ...section.argument,
        claimIds: section.argument.claimIds.filter((claimId) => !excluded.has(claimId)),
        counterClaimIds: section.argument.counterClaimIds.filter((claimId) => !excluded.has(claimId))
      }
    }
  })
  return changed ? { ...blueprint, sections } : blueprint
}

function normalizedBlueprintText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, '')
}

function isTerminalWriterDeadLoop(message: string): boolean {
  return /dead loop|死循环/iu.test(message)
}

function qualityOutcomeState(verdict: QualityVerdict, claims: Array<{ text: string }>): string {
  const scoreState = Object.entries(verdict.scores)
    .map(([name, value]) => [name, Math.round(value * 20) / 20] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  const evidenceState = hashText([...new Set(claims
    .map((claim) => claim.text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}%]+/gu, ' ').trim())
    .filter(Boolean))]
    .sort()
    .join('\n'))
  return JSON.stringify({
    failureKind: verdict.llmJudge?.failureKind ?? 'report_quality',
    scores: scoreState,
    evidenceState
  })
}

function normalizedFailureSignature(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\d+/gu, '#').replace(/\s+/gu, '').trim()
}

export function buildSynthesisRevisionTargets(input: {
  verdict: QualityVerdict
  blueprint: ResearchReportBlueprint
  citations: CitationBinding[]
  draftMarkdown: string
}): { sectionIds: string[]; rewriteClosing: boolean } {
  const sectionIds = new Set<string>()
  let rewriteClosing = false
  const ownerByClaimId = new Map(input.blueprint.sections.flatMap((section) =>
    section.claimIds.map((claimId) => [claimId, section.id] as const)
  ))
  const sectionIdByTitle = new Map(input.blueprint.sections.map((section) => [section.title, section.id]))
  const citationById = new Map(input.citations.map((citation) => [citation.id, citation]))
  const feedback = [
    ...input.verdict.blockingIssues,
    ...input.verdict.warnings,
    ...input.verdict.recommendedFixes
  ]

  const locateText = (text: string): boolean => {
    const location = reportLocationForFragment(input.draftMarkdown, text)
    if (location === 'closing') {
      rewriteClosing = true
      return true
    }
    if (location) {
      const sectionId = sectionIdByTitle.get(location)
      if (!sectionId) return false
      sectionIds.add(sectionId)
      return true
    }
    return false
  }

  for (const issue of input.verdict.llmJudge?.issues ?? []) {
    const explicitlyTargetsClosing = /(?:报告)?结论(?:部分|中|段落)?|closing|局限与不确定性|局限章节|limitations?|caveats?/iu.test(issue.message)
    if (explicitlyTargetsClosing) rewriteClosing = true
    let located = explicitlyTargetsClosing || locateText(issue.unsupportedFragment ?? '')
    const citation = issue.occurrenceId ? citationById.get(issue.occurrenceId) : undefined
    if (!located && citation) located = locateText(citation.reportClaimText)
    if (!located) {
      const claimIds = citation?.claimIds ?? (citation?.claimId ? [citation.claimId] : issue.claimId ? [issue.claimId] : [])
      for (const claimId of claimIds) {
        const owner = ownerByClaimId.get(claimId)
        if (owner) sectionIds.add(owner)
      }
    }
  }

  for (const message of feedback) {
    const explicitlyTargetsClosing = /(?:报告)?结论|closing|weak_final_conclusion|局限与不确定性|局限章节|limitations?|caveats?/iu.test(message)
    if (explicitlyTargetsClosing) rewriteClosing = true
    for (const match of message.matchAll(/[“"']([^”"']{6,120})[”"']/gu)) {
      locateText(match[1] ?? '')
    }
    if (!explicitlyTargetsClosing) {
      for (const section of input.blueprint.sections) {
        if (message.includes(section.title)) sectionIds.add(section.id)
      }
    }
  }

  if (sectionIds.size === 0 && !rewriteClosing) {
    input.blueprint.sections.forEach((section) => sectionIds.add(section.id))
    rewriteClosing = true
  }
  return { sectionIds: [...sectionIds], rewriteClosing }
}

function reportLocationForFragment(markdown: string, fragment: string): string | 'closing' | undefined {
  const needle = normalizeRevisionFragment(fragment)
  if (needle.length < 6) return undefined
  let currentLocation: string | 'closing' | undefined
  for (const line of markdown.split('\n')) {
    const secondLevel = line.trim().match(/^##\s+(.+?)\s*$/u)?.[1]?.replace(/[*`#]/gu, '').trim()
    if (secondLevel) {
      currentLocation = /^(?:结论|结论与建议|Conclusion|Recommendations)$/iu.test(secondLevel) ? 'closing' : undefined
      continue
    }
    const thirdLevel = line.trim().match(/^###\s+(.+?)\s*$/u)?.[1]?.replace(/[*`#]/gu, '').trim()
    if (thirdLevel) {
      currentLocation = thirdLevel
      continue
    }
    if (currentLocation && normalizeRevisionFragment(line).includes(needle)) return currentLocation
  }
  return undefined
}

function normalizeRevisionFragment(value: string): string {
  return value
    .replace(/\[(?:claim|evidence):[^\]]+\]/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/[，。；：、,.!！?？`*_#>\s]/gu, '')
    .trim()
}

export function blueprintMatchesEvidenceMap(
  blueprint: ResearchRun['reportBlueprint'],
  sectionEvidenceMap: SectionEvidenceMapEntry[]
): boolean {
  if (!blueprint) return false
  if (blueprint.sections.length !== sectionEvidenceMap.length) return false
  const evidenceBySectionId = new Map(sectionEvidenceMap.map((section) => [section.sectionId, section]))
  return blueprint.sections.every((section) => {
    const evidence = evidenceBySectionId.get(section.id)
    if (!evidence || section.title !== evidence.title) return false
    const excludedClaimIds = new Set(section.excludedClaimIds ?? [])
    const availableClaimIds = new Set(evidence.claimIds.filter((claimId) => !excludedClaimIds.has(claimId)))
    return (section.evidenceMode === 'evidence_gap' || section.claimIds.length > 0) &&
      section.claimIds.every((claimId) => availableClaimIds.has(claimId)) &&
      sameStringSet(section.coverageClaimIds ?? [], evidence.coverageClaimIds ?? []) &&
      section.evidenceFingerprint === evidence.evidenceFingerprint &&
      sameStringSet(section.contextClaimIds ?? [], evidence.contextClaimIds ?? []) &&
      sameStringSet(section.sourceIds, evidence.sourceIds)
  })
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightValues = new Set(right)
  return left.every((value) => rightValues.has(value))
}
