/**
 * [INPUT]: 依赖 ModelClient、运行级模型选择、含问题契约/证据角色和 direct/conditional_application/evidence_gap 模式的 SectionEvidenceMap、claims 和 ResearchFrame 的已确认研究边界
 * [OUTPUT]: 对外提供 quick-only BasicReportArchitect、用无思考 JSON 模式返回最小 claim 归属并按错误反馈持续修复、把问题契约和证据角色随蓝图持久化、把投影到用户对比对象的 claim 与精简来源身份一并交给模型、优先原始强来源主事实且为每个已覆盖硬范围保留代表 claim、按新增分面和同等相关的独立来源选择最小充分证据集、为高相关关键解释/反方视角保留跨来源名额、以 canonical 来源和文本重合去除重复材料的 ModelReportArchitect、ReportArchitectFailed 与 buildReportArchitectPrompt
 * [POS]: research/agents 的主编节点，位于研究完成与正文写作之间；模型只决定报告类型和主 claim 归属，确定性后处理保证硬范围交付、最小充分事实主干、来源多样性和必要反证不被单一强来源淹没，不再固定凑四条材料；结论由已准入且限定到用户对象的 claim 生成，跨章前提及场景证据模式由 WritableGate 固定
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest } from '../../ports/model-client.js'
import { linkResearchAbortSignal, throwIfResearchAborted } from '../core/abort.js'
import { evaluateCoverageRequirementEvidence, selectCoverageRepresentativeClaimIds } from '../core/coverage.js'
import { comparisonTargetMatchesText, projectComparisonEvidenceText } from '../core/comparison.js'
import { resolveResearchReportTitle } from '../core/report-title.js'
import { estimateResearchRequestTokens } from '../core/token-estimate.js'
import type {
  ResearchModelUsageRecord,
  ResearchReportBlueprint,
  ResearchReportBlueprintSection,
  ResearchReportType,
  SectionEvidenceMapEntry
} from '../core/types.js'
import {
  canCiteEvidenceSpan,
  coversResearchDimensionFocusGroups,
  isEligibleStrongWebEvidence,
  researchSignalTerms,
  researchDimensionFocusGroups
} from '../evidence/EvidenceEligibility.js'
import type { ReportArchitect, ReportArchitectInput } from './types.js'
import { collectWriterText, isInternalResearchProcessLimitation } from './SynthesisWriterSupport.js'

const REPORT_ARCHITECT_TIMEOUT_MS = 90_000

export const MODEL_REPORT_ARCHITECT_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的研究主编，只设计报告论证蓝图，不写报告正文。',
  '你只能使用输入中的章节、claim id 和明确限制，不能发明事实。',
  '每个主 claim 只能归属一个正文章节；contextClaimIds 只作为场景综合前提。conditional_application 章节允许用它们陈述机制前提，但必须把场景结论写成条件判断。',
  'evidence_gap 章节必须保留且 claimIds 为空，局部结论只能说明现有证据无法支持判断，不能拿其他章节背景代替。',
  '风险、限制或反证 claim 可以保留在相关章节，但除非章节本身研究该风险或限制，否则不能把它选作该章主结论。',
  '每个章节必须产生不同的局部结论，并说明该结论如何推进最终回答。',
  '输出严格 JSON，不要 Markdown，不要解释工作过程。'
].join('\n')

type ArchitectPayload = {
  reportType?: unknown
  directAnswer?: unknown
  thesis?: unknown
  sections?: unknown
}

type ArchitectSectionPayload = {
  id?: unknown
  title?: unknown
  purpose?: unknown
  conclusion?: unknown
  claimIds?: unknown
  inference?: unknown
  conditions?: unknown
  counterClaimIds?: unknown
}

export class BasicReportArchitect implements ReportArchitect {
  async createBlueprint(input: ReportArchitectInput): Promise<ResearchReportBlueprint> {
    return buildDeterministicReportBlueprint(input)
  }
}

export class ReportArchitectFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportArchitectFailed'
  }
}

export class ModelReportArchitect implements ReportArchitect {
  private readonly fallback: ReportArchitect

  constructor(
    private readonly options: {
      modelClient: ModelClient
      model: string
      timeoutMs?: number
      fallback?: ReportArchitect
    }
  ) {
    this.fallback = options.fallback ?? new BasicReportArchitect()
  }

  async createBlueprint(input: ReportArchitectInput): Promise<ResearchReportBlueprint> {
    if (input.budget.preset === 'quick') return this.fallback.createBlueprint(input)
    let attempt = 1
    let retryFeedback: string | undefined
    let previousFailureSignature: string | undefined
    while (true) {
      try {
        return await this.createModelBlueprint(input, attempt, retryFeedback)
      } catch (error) {
        throwIfResearchAborted(input.execution?.signal)
        const message = architectErrorMessage(error)
        const failureSignature = message.normalize('NFKC').replace(/\s+/gu, ' ').trim()
        if (failureSignature === previousFailureSignature) {
          throw new ReportArchitectFailed(`Report architect entered a repeated repair dead loop: ${message}`)
        }
        previousFailureSignature = failureSignature
        retryFeedback = message
        attempt += 1
      }
    }
  }

  private async createModelBlueprint(
    input: ReportArchitectInput,
    attempt: number,
    retryFeedback?: string
  ): Promise<ResearchReportBlueprint> {
    const model = input.execution?.model?.trim() || this.options.model
    const providerId = input.execution?.providerId?.trim()
    throwIfResearchAborted(input.execution?.signal)
    const controller = new AbortController()
    const unlinkAbort = linkResearchAbortSignal(input.execution?.signal, controller)
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.options.timeoutMs ?? REPORT_ARCHITECT_TIMEOUT_MS)
    )
    const prompt = [
      buildReportArchitectPrompt(input),
      ...(retryFeedback ? [
        '',
        '上一轮蓝图校验失败：',
        retryFeedback,
        '请只修复这个结构或证据归属问题，仍然只输出完整 JSON。'
      ] : [])
    ].join('\n')
    const turnId = `research_architect_${hashArchitectInput(input)}_${attempt}`
    const maxTokens = 2_500
    const reservation = input.execution?.reserveModelCall(
      'architect',
      estimateResearchRequestTokens(`${MODEL_REPORT_ARCHITECT_SYSTEM_PROMPT}\n${prompt}`, maxTokens)
    )
    const observedUsage: ResearchModelUsageRecord['usage'][] = []
    let usageRecorded = false
    try {
      const request: ModelRequest = {
        threadId: 'research_report_architect',
        turnId,
        model,
        ...(providerId ? { providerId } : {}),
        systemPrompt: MODEL_REPORT_ARCHITECT_SYSTEM_PROMPT,
        prefix: [],
        history: [makeUserItem({
          id: `item_${turnId}_user`,
          threadId: 'research_report_architect',
          turnId,
          text: prompt
        })],
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
      const blueprint = parseReportBlueprint(collected.text, input)
      const usageRecords = collected.usage.slice(-1).map((usage) => ({
        stage: 'architect' as const,
        model,
        turnId,
        usage
      }))
      if (input.execution && reservation && usageRecords[0]) {
        await input.execution.recordModelUsage(usageRecords[0], reservation)
        usageRecorded = true
      }
      return {
        ...blueprint,
        ...(!input.execution && usageRecords.length > 0 ? { modelUsage: usageRecords } : {})
      }
    } finally {
      clearTimeout(timeout)
      unlinkAbort()
      if (input.execution && reservation) {
        const lastUsage = observedUsage.at(-1)
        if (!usageRecorded && lastUsage) {
          await input.execution.recordModelUsage({
            stage: 'architect',
            model,
            turnId,
            usage: lastUsage
          }, reservation)
          usageRecorded = true
        }
        await input.execution.finishModelCall(reservation, { chargeEstimateOnMissing: !usageRecorded })
      }
    }
  }
}

export function buildReportArchitectPrompt(input: ReportArchitectInput): string {
  const sectionClaimIds = new Set((input.sectionEvidenceMap ?? []).flatMap((section) => [
    ...section.claimIds,
    ...(section.contextClaimIds ?? [])
  ]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const claims = input.claims
    .filter((claim) => sectionClaimIds.has(claim.id))
    .map((claim) => ({
      id: claim.id,
      text: reportClaimText(claim, input),
      claimType: claim.claimType,
      polarity: claim.polarity,
      confidence: claim.confidence,
      critical: claim.critical === true,
      sources: [...new Set(claim.supportSpanIds
        .map((spanId) => spanById.get(spanId)?.sourceId)
        .filter((sourceId): sourceId is string => Boolean(sourceId)))]
        .map((sourceId) => sourceById.get(sourceId))
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
        .map((source) => ({
          id: source.id,
          title: source.title,
          publisher: source.publisher,
          reliability: source.reliability,
          kind: source.kind
        }))
    }))
  return [
    '根据下面的已确认问题和证据分配，设计报告蓝图。',
    '',
    '只输出下面这个最小 JSON 结构。程序会从已准入 claims 确定性生成结论，不要输出正文、结论、推理或说明：',
    JSON.stringify({
      reportType: 'explanatory|comparison|decision|market|investigation',
      sections: [{
        id: '必须来自 SectionEvidenceMap.sectionId',
        claimIds: ['只能使用该章节分配的 claim id'],
        counterClaimIds: ['该章节内构成反证的 claim id']
      }]
    }, null, 2),
    '',
    '编辑规则：',
    '- 每个主 claim id 最多归属一个 section。SectionEvidenceMap.contextClaimIds 不参与重新分配，只能作为该场景章节的跨章前提。',
    '- 必须返回 SectionEvidenceMap 中的每个 section id，即使该章只有一条 claim。',
    '- 先用高可靠事实建立主干；同章有高相关且 critical 的 opinion/inference 来自不同材料、并会限制或改变结论时，至少保留一条并放入 counterClaimIds。不要用多条同一发布方的自述挤掉独立视角。',
    '- 来源多样性按实际文档判断；同一文档被重复抓取、同一类型的周期性文档或同一发布方的重复表述，不能冒充独立验证。',
    '- 不要写研究过程、资料数量、搜索建议或任何 JSON 之外的文字。',
    '- comparison 按统一维度比较；decision 先给建议及适用条件；explanatory 先给机制；market 先给结构与驱动；investigation 先给事实链与冲突。',
    '',
    '已确认写作边界：',
    JSON.stringify({
      topic: input.brief.topic,
      userIntent: input.brief.userIntent,
      targetAudience: input.brief.targetAudience,
      outputFormat: input.brief.outputFormat,
      centralQuestion: input.frame.centralQuestion,
      coreResearchThread: input.frame.coreResearchThread,
      alternativesToCompare: input.frame.alternativesToCompare ?? [],
      decisionToSupport: input.frame.decisionToSupport
    }, null, 2),
    '',
    'SectionEvidenceMap：',
    JSON.stringify(input.sectionEvidenceMap ?? [], null, 2),
    '',
    '可用 Claims：',
    JSON.stringify(claims, null, 2)
  ].join('\n')
}

export function buildDeterministicReportBlueprint(input: ReportArchitectInput): ResearchReportBlueprint {
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const ownedClaimIds = new Set<string>()
  const sections = (input.sectionEvidenceMap ?? []).map((section) => {
    const publishableLimitations = section.limitations.filter((value) => !isInternalResearchProcessLimitation(value))
    const claims = section.claimIds
      .filter((claimId) => !ownedClaimIds.has(claimId))
      .map((claimId) => claimById.get(claimId))
      .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
    claims.forEach((claim) => ownedClaimIds.add(claim.id))
    const conclusion = sectionConclusionFromClaims(section, claims, input)
    return {
      id: section.sectionId,
      title: section.title,
      purpose: sectionPurpose(section, input),
      questionIds: section.questionIds,
      claimIds: claims.map((claim) => claim.id),
      coverageClaimIds: coverageRepresentativeClaimIds(section, claims.map((claim) => claim.id), input),
      ...(section.contextClaimIds?.length ? {
        contextClaimIds: section.contextClaimIds.filter((claimId) => claimById.has(claimId) && !claims.some((claim) => claim.id === claimId))
      } : {}),
      evidenceMode: section.evidenceMode ?? 'direct',
      sourceIds: section.sourceIds,
      argument: {
        conclusion: conclusion ?? publishableLimitations[0] ?? '该章节证据不足，不能形成高置信结论。',
        claimIds: claims.map((claim) => claim.id),
        inference: section.evidenceMode === 'evidence_gap'
          ? '正文只说明无法形成可靠结论的证据边界，不得补写事实、引用、趋势或建议。'
          : section.evidenceMode === 'conditional_application'
          ? '正文只能先陈述已引用机制前提，再以“如果/若…则…”将它们应用到本章场景，不能声称已有场景实测或直接指南。'
          : claims.length > 1
          ? '这些证据共同限定了本章结论，正文需要解释它们之间的一致性、差异和适用边界。'
          : '该证据直接支撑本章的局部结论，正文不得扩展到证据未覆盖的机制。',
        conditions: publishableLimitations,
        counterClaimIds: claims.filter((claim) => claim.polarity === 'negative').map((claim) => claim.id)
      },
      limitations: publishableLimitations,
      questionContracts: section.questionContracts,
      evidenceAssignments: section.evidenceAssignments?.filter((assignment) =>
        claims.some((claim) => claim.id === assignment.claimId)
          || section.contextClaimIds?.includes(assignment.claimId)
      ),
      evidenceFingerprint: section.evidenceFingerprint
    }
  })
  const leadConclusion = sections[0]?.argument.conclusion
    ?? input.claims.find((claim) => claim.critical)?.text
    ?? '当前证据不足以形成确定结论。'
  return {
    reportType: inferReportType(input),
    title: resolveResearchReportTitle(input.brief.topic),
    directAnswer: aggregateSectionConclusions(sections) || leadConclusion,
    thesis: aggregateSectionConclusions(sections) || leadConclusion,
    sections,
    createdAt: input.nowIso
  }
}

function parseReportBlueprint(raw: string, input: ReportArchitectInput): ResearchReportBlueprint {
  const json = extractFirstJsonObject(raw)
  if (!json) throw new Error('report architect returned no JSON object')
  const payload = JSON.parse(json) as ArchitectPayload
  const rawSections = Array.isArray(payload.sections) ? payload.sections as ArchitectSectionPayload[] : []
  if (rawSections.length === 0) throw new Error('report architect returned no section payloads')
  const payloadSections = new Map(rawSections.flatMap((section) => {
    const id = stringValue(section.id)
    return id ? [[id, section] as const] : []
  }))
  const missingSectionIds = (input.sectionEvidenceMap ?? [])
    .map((section) => section.sectionId)
    .filter((sectionId) => !payloadSections.has(sectionId))
  if (missingSectionIds.length > 0) {
    throw new Error(`report architect omitted required sections: ${missingSectionIds.join(', ')}`)
  }
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const ownedClaimIds = new Set<string>()
  const sections: ResearchReportBlueprintSection[] = (input.sectionEvidenceMap ?? []).map((section) => {
    const modelSection = payloadSections.get(section.sectionId)
    const allowedClaimIds = new Set(section.claimIds)
    const requestedClaimIds = stringArray(modelSection?.claimIds)
      .filter((claimId) => allowedClaimIds.has(claimId) && !ownedClaimIds.has(claimId))
    const requestedCounterClaimIds = stringArray(modelSection?.counterClaimIds)
      .filter((claimId) => (
        allowedClaimIds.has(claimId) &&
        !ownedClaimIds.has(claimId) &&
        isArchitectCounterClaim(claimById.get(claimId))
      ))
    const selection = selectArchitectClaimIds(
      section,
      section.claimIds.filter((claimId) => !ownedClaimIds.has(claimId)),
      requestedClaimIds,
      requestedCounterClaimIds,
      input
    )
    const claimIds = selection.claimIds
    claimIds.forEach((claimId) => ownedClaimIds.add(claimId))
    if (section.status !== 'missing' && claimIds.length === 0 && section.evidenceMode !== 'conditional_application' && section.evidenceMode !== 'evidence_gap') {
      throw new Error(`report architect left section ${section.sectionId} without an owned claim`)
    }
    const sectionClaims = claimIds
      .map((claimId) => claimById.get(claimId))
      .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
    // 蓝图只决定结构和证据归属。关键词重合不足以证明模型结论忠实，
    // 因此后续 Writer 只能从已经准入的 claim 接收事实输入。
    const conclusion = sectionConclusionFromClaims(section, sectionClaims, input)
      || section.limitations[0]
      || '该章节证据不足。'
    return {
      id: section.sectionId,
      title: section.title,
      // Writer 会把 purpose 当作写作指令，因此不能保留模型自造的“最佳策略”
      // 或“适用性”目标；这里只下发已确认章节和证据边界。
      purpose: sectionPurpose(section, input),
      questionIds: section.questionIds,
      claimIds,
      ...(selection.coverageClaimIds.length > 0 ? { coverageClaimIds: selection.coverageClaimIds } : {}),
      ...(section.contextClaimIds?.length ? {
        contextClaimIds: section.contextClaimIds.filter((claimId) => claimById.has(claimId) && !claimIds.includes(claimId))
      } : {}),
      evidenceMode: section.evidenceMode ?? 'direct',
      sourceIds: section.sourceIds,
      argument: {
        conclusion,
        claimIds,
        inference: section.evidenceMode === 'evidence_gap'
          ? '正文只说明无法形成可靠结论的证据边界，不得补写事实、引用、趋势或建议。'
          : section.evidenceMode === 'conditional_application'
          ? '正文只能先陈述已引用机制前提，再以“如果/若…则…”将它们应用到本章场景，不能声称已有场景实测或直接指南。'
          : sectionClaims.length > 1
          ? '正文需要解释这些证据之间的一致性、差异和共同边界，不得引入 claims 未陈述的新事实。'
          : '正文需要解释该证据如何支持局部结论，并明确它没有覆盖的机制或场景。',
        conditions: section.limitations.filter((value) => !isInternalResearchProcessLimitation(value)).slice(0, 6),
        counterClaimIds: [...new Set([
          ...requestedCounterClaimIds,
          ...selection.perspectiveClaimIds,
          ...sectionClaims.filter((claim) => claim.polarity === 'negative').map((claim) => claim.id)
        ])].filter((claimId) => claimIds.includes(claimId))
      },
      limitations: section.limitations.filter((value) => !isInternalResearchProcessLimitation(value)),
      questionContracts: section.questionContracts,
      evidenceAssignments: section.evidenceAssignments?.filter((assignment) =>
        claimIds.includes(assignment.claimId)
          || section.contextClaimIds?.includes(assignment.claimId)
      ),
      evidenceFingerprint: section.evidenceFingerprint
    }
  })
  if (sections.length === 0) throw new Error('report architect produced no sections')
  const directAnswer = aggregateSectionConclusions(sections) || sections[0]?.argument.conclusion
  const thesis = directAnswer
  if (!directAnswer || !thesis) throw new Error('report architect omitted direct answer or thesis')
  return {
    reportType: reportTypeValue(payload.reportType) ?? inferReportType(input),
    title: resolveResearchReportTitle(input.brief.topic),
    directAnswer,
    thesis,
    sections,
    createdAt: input.nowIso
  }
}

function selectArchitectClaimIds(
  section: SectionEvidenceMapEntry,
  availableClaimIds: string[],
  requestedClaimIds: string[],
  requestedCounterClaimIds: string[],
  input: ReportArchitectInput
): { claimIds: string[]; perspectiveClaimIds: string[]; coverageClaimIds: string[] } {
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const candidates = [...new Set(availableClaimIds)]
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
  const requested = new Set(requestedClaimIds)
  const requestedCounter = new Set(requestedCounterClaimIds)
  const focusGroups = researchDimensionFocusGroups(section.title, reportFocusContext(input))
  const mainlineSignals = sectionDiscriminatingSignals(section, input)
  const rankedCandidates = [...candidates].sort((left, right) =>
    architectClaimSelectionScore(right, focusGroups, mainlineSignals, input)
      - architectClaimSelectionScore(left, focusGroups, mainlineSignals, input)
  ).filter((claim, index, ranked) => !ranked.slice(0, index).some((preferred) =>
    substantiallyOverlappingArchitectClaims(preferred.text, claim.text)
  ))
  const selected: typeof candidates = []
  const selectedIds = new Set<string>()
  const selectedSourceKeys = new Set<string>()
  const coveredFocusIndexes = new Set<number>()
  const claimSourceKeys = (claim: ReportArchitectInput['claims'][number]) => [...new Set(claim.supportSpanIds
    .map((spanId) => spanById.get(spanId)?.sourceId)
    .filter((sourceId): sourceId is string => Boolean(sourceId))
    .map((sourceId) => sourceDiversityKey(sourceById.get(sourceId), sourceId)))]

  const addSelected = (claim: ReportArchitectInput['claims'][number]) => {
    if (selectedIds.has(claim.id)) return
    selected.push(claim)
    selectedIds.add(claim.id)
    claimSourceKeys(claim).forEach((sourceKey) => selectedSourceKeys.add(sourceKey))
    const claimText = `${claim.text}\n${claim.entities.join(' ')}`
    focusGroups.forEach((group, index) => {
      if (coversResearchDimensionFocusGroups([group], claimText)) coveredFocusIndexes.add(index)
    })
  }
  const forcedCoverageClaimIds = coverageRepresentativeClaimIds(
    section,
    rankedCandidates.map((claim) => claim.id),
    input
  )
  for (const claimId of forcedCoverageClaimIds) {
    const claim = rankedCandidates.find((candidate) => candidate.id === claimId)
    if (claim) addSelected(claim)
  }

  const minimumFactCount = Math.min(2, rankedCandidates.length)
  const selectionScore = (claim: ReportArchitectInput['claims'][number]) => {
    const claimText = `${claim.text}\n${claim.entities.join(' ')}`
    const newFocusCount = focusGroups.filter((group, index) =>
      !coveredFocusIndexes.has(index) && coversResearchDimensionFocusGroups([group], claimText)
    ).length
    const newSourceCount = claimSourceKeys(claim).filter((sourceKey) => !selectedSourceKeys.has(sourceKey)).length
    return architectClaimSelectionScore(claim, focusGroups, mainlineSignals, input)
      + (newFocusCount * 800)
      + (newSourceCount * 500)
      + (requested.has(claim.id) ? 80 : 0)
      + (requestedCounter.has(claim.id) ? 1_200 : 0)
  }
  const remainingRanked = () => rankedCandidates
    .filter((claim) => !selectedIds.has(claim.id))
    .sort((left, right) => selectionScore(right) - selectionScore(left))

  for (const claim of remainingRanked().filter((candidate) => requested.has(candidate.id))) {
    const claimText = `${claim.text}\n${claim.entities.join(' ')}`
    const addsFocus = focusGroups.some((group, index) =>
      !coveredFocusIndexes.has(index) && coversResearchDimensionFocusGroups([group], claimText)
    )
    if (selected.length < minimumFactCount || addsFocus) addSelected(claim)
  }
  while (selected.length < minimumFactCount) {
    const next = remainingRanked()[0]
    if (!next) break
    addSelected(next)
  }
  for (const [index, group] of focusGroups.entries()) {
    if (coveredFocusIndexes.has(index)) continue
    const next = remainingRanked().find((claim) =>
      coversResearchDimensionFocusGroups([group], `${claim.text}\n${claim.entities.join(' ')}`)
    )
    if (next) addSelected(next)
  }
  if (selectedSourceKeys.size < 2) {
    const strongestSelectedTargetCoverage = Math.max(0, ...selected.map((claim) => comparisonTargetMatchCount(claim, input)))
    const independent = remainingRanked().find((claim) => {
      const addsSource = claimSourceKeys(claim).some((sourceKey) => !selectedSourceKeys.has(sourceKey))
      if (!addsSource) return false
      const targetCoverage = comparisonTargetMatchCount(claim, input)
      return strongestSelectedTargetCoverage === 0 || targetCoverage >= strongestSelectedTargetCoverage
    })
    if (independent) addSelected(independent)
  }
  const forcedPerspective = selectIndependentPerspectiveClaim({
    rankedCandidates,
    selected,
    focusGroups,
    mainlineSignals,
    requestedCounter,
    claimSourceKeys
  })
  if (forcedPerspective && !selectedIds.has(forcedPerspective.id)) {
    const replaceIndex = selected
      .map((claim, index) => ({ claim, index }))
      .filter(({ claim }) => !forcedCoverageClaimIds.includes(claim.id) && !requestedCounter.has(claim.id) && claim.polarity !== 'negative')
      .sort((left, right) => {
        const score = (claim: ReportArchitectInput['claims'][number]) =>
          sectionClaimScore(claim, focusGroups, mainlineSignals, claimSourceAuthorityScore(claim, input))
            + (claim.critical ? 240 : 0)
        return score(left.claim) - score(right.claim)
      })[0]?.index
    if (replaceIndex !== undefined) selected[replaceIndex] = forcedPerspective
  }
  const selectedClaimIds = selected.map((claim) => claim.id)
  return {
    claimIds: selectedClaimIds,
    coverageClaimIds: forcedCoverageClaimIds.filter((claimId) => selectedClaimIds.includes(claimId)),
    perspectiveClaimIds: selected
      .filter((claim) => claim.id === forcedPerspective?.id || requestedCounter.has(claim.id) || claim.polarity === 'negative')
      .map((claim) => claim.id)
  }
}

function architectClaimSelectionScore(
  claim: ReportArchitectInput['claims'][number],
  focusGroups: string[][],
  mainlineSignals: string[],
  input: ReportArchitectInput
): number {
  return sectionClaimScore(claim, focusGroups, mainlineSignals, claimSourceAuthorityScore(claim, input))
    + comparisonTargetMatchCount(claim, input) * 1_200
}

function comparisonTargetMatchCount(
  claim: ReportArchitectInput['claims'][number],
  input: Pick<ReportArchitectInput, 'frame'>
): number {
  const targets = input.frame.alternativesToCompare ?? []
  if (targets.length < 2) return 0
  const text = `${claim.text}\n${claim.entities.join(' ')}`
  return targets.filter((target) => comparisonTargetMatchesText(target, text)).length
}

function coverageRepresentativeClaimIds(
  section: SectionEvidenceMapEntry,
  candidateClaimIds: string[],
  input: ReportArchitectInput
): string[] {
  if (!input.coverageContract || candidateClaimIds.length === 0) return []
  const candidateSet = new Set(candidateClaimIds)
  if (section.coverageClaimIds) {
    return section.coverageClaimIds.filter((claimId) => candidateSet.has(claimId))
  }
  const coverage = evaluateCoverageRequirementEvidence({
    contract: input.coverageContract,
    claims: input.claims,
    evidenceSpans: input.evidenceSpans,
    sources: input.sources,
    notes: input.notes
  })
  return selectCoverageRepresentativeClaimIds({
    contract: input.coverageContract,
    coverage,
    sectionId: section.sectionId,
    candidateClaimIds
  })
}

function selectIndependentPerspectiveClaim(input: {
  rankedCandidates: ReportArchitectInput['claims']
  selected: ReportArchitectInput['claims']
  focusGroups: string[][]
  mainlineSignals: string[]
  requestedCounter: ReadonlySet<string>
  claimSourceKeys: (claim: ReportArchitectInput['claims'][number]) => string[]
}): ReportArchitectInput['claims'][number] | undefined {
  const selectedSourceKeys = new Set(input.selected.flatMap(input.claimSourceKeys))
  const alreadySelected = input.selected.some((claim) =>
    (claim.claimType === 'opinion' || claim.claimType === 'inference') &&
    claim.critical === true &&
    (input.requestedCounter.has(claim.id) || claim.polarity === 'negative')
  )
  if (alreadySelected) return undefined
  return input.rankedCandidates
    .filter((claim) => !input.selected.some((selected) => selected.id === claim.id))
    .filter((claim) => claim.critical === true && (claim.claimType === 'opinion' || claim.claimType === 'inference'))
    .filter((claim) => claim.confidence !== 'low')
    .filter((claim) => !/\b(?:and|or|but|because|if|when|while|with|without|using|including|as|to|from|of|for|the|a|an|receive|return|be|been|is|are|was|were)\s*$/iu.test(claim.text.trim()))
    .filter((claim) => sectionClaimScore(claim, input.focusGroups, input.mainlineSignals, 0) > 0)
    .filter((claim) => input.claimSourceKeys(claim).some((sourceKey) => !selectedSourceKeys.has(sourceKey)))
    .sort((left, right) => {
      const score = (claim: ReportArchitectInput['claims'][number]) =>
        sectionClaimScore(claim, input.focusGroups, input.mainlineSignals, 0)
          + (input.requestedCounter.has(claim.id) ? 2_000 : 0)
          + (claim.polarity === 'negative' ? 800 : 0)
          + (claim.confidence === 'high' ? 200 : 0)
      return score(right) - score(left)
    })[0]
}

function sourceDiversityKey(
  source: ReportArchitectInput['sources'][number] | undefined,
  fallbackId: string
): string {
  if (!source) return `id:${fallbackId}`
  const canonical = source.canonicalUrl?.trim() || source.originalUrl?.trim()
  if (canonical) {
    try {
      const url = new URL(canonical)
      url.hash = ''
      for (const key of [...url.searchParams.keys()]) {
        if (/^(?:utm_|ref$|source$|spm$)/iu.test(key)) url.searchParams.delete(key)
      }
      return `url:${url.toString().replace(/\/$/u, '').toLowerCase()}`
    } catch {
      return `url:${canonical.replace(/\/$/u, '').toLowerCase()}`
    }
  }
  if (source.documentId) return `document:${source.documentId}`
  if (source.path) return `path:${source.path}`
  if (source.fingerprint) return `fingerprint:${source.fingerprint}`
  return `id:${source.id || fallbackId}`
}

function aggregateSectionConclusions(sections: ResearchReportBlueprintSection[]): string {
  return [...new Set(sections
    .map((section) => section.argument.conclusion.replace(/[。；;]+$/u, '').trim())
    .filter(Boolean))]
    .slice(0, 6)
    .join('；')
    .slice(0, 1_200)
}

function selectSectionLeadClaim(
  section: SectionEvidenceMapEntry,
  claims: ReportArchitectInput['claims'],
  input: ReportArchitectInput
): ReportArchitectInput['claims'][number] | undefined {
  if (claims.length === 0) return undefined
  const context = reportFocusContext(input)
  const focusGroups = researchDimensionFocusGroups(section.title, context)
  const mainlineSignals = sectionDiscriminatingSignals(section, input)
  return [...claims].sort((left, right) =>
    sectionClaimScore(right, focusGroups, mainlineSignals, claimSourceAuthorityScore(right, input))
      - sectionClaimScore(left, focusGroups, mainlineSignals, claimSourceAuthorityScore(left, input))
  )[0]
}

function sectionConclusionFromClaims(
  section: SectionEvidenceMapEntry,
  claims: ReportArchitectInput['claims'],
  input: ReportArchitectInput
): string | undefined {
  if (claims.length === 0) return undefined
  const focusGroups = researchDimensionFocusGroups(section.title, reportFocusContext(input))
  const mainlineSignals = sectionDiscriminatingSignals(section, input)
  if (focusGroups.length < 2) {
    const lead = selectSectionLeadClaim(section, claims, input)
    return lead ? reportClaimText(lead, input) : undefined
  }
  const selected: ReportArchitectInput['claims'] = []
  const selectedIds = new Set<string>()
  for (const group of focusGroups) {
    const candidate = [...claims]
      .filter((claim) => !selectedIds.has(claim.id))
      .filter((claim) => coversResearchDimensionFocusGroups([group], `${claim.text}\n${claim.entities.join(' ')}`))
      .filter((claim) => {
        const claimText = `${claim.text}\n${claim.entities.join(' ')}`
        return focusGroups.filter((candidateGroup) =>
          coversResearchDimensionFocusGroups([candidateGroup], claimText)
        ).length === 1
      })
      .sort((left, right) => {
        const score = (claim: ReportArchitectInput['claims'][number]) => {
          const claimText = `${claim.text}\n${claim.entities.join(' ')}`
          const coveredFacetCount = focusGroups.filter((candidateGroup) =>
            coversResearchDimensionFocusGroups([candidateGroup], claimText)
          ).length
          return sectionClaimScore(
            claim,
            focusGroups,
            mainlineSignals,
            claimSourceAuthorityScore(claim, input)
          ) - (Math.max(0, coveredFacetCount - 1) * 240)
        }
        return score(right) - score(left)
      })[0]
    if (!candidate) {
      const lead = selectSectionLeadClaim(section, claims, input)
      return lead ? reportClaimText(lead, input) : undefined
    }
    selected.push(candidate)
    selectedIds.add(candidate.id)
  }
  if (selected.length < 2) {
    const lead = selectSectionLeadClaim(section, claims, input)
    return lead ? reportClaimText(lead, input) : undefined
  }
  return selected
    .map((claim) => reportClaimText(claim, input).replace(/[。；;]+$/u, '').trim())
    .filter(Boolean)
    .join('；')
    .slice(0, 1_000)
}

function reportClaimText(
  claim: ReportArchitectInput['claims'][number],
  input: Pick<ReportArchitectInput, 'frame'>
): string {
  return projectComparisonEvidenceText(claim.text, input.frame.alternativesToCompare ?? [])
}

function reportFocusContext(input: ReportArchitectInput): string {
  return [
    input.brief.topic,
    input.frame.coreResearchThread,
    input.frame.centralQuestion,
    ...input.frame.coreQuestions.map((question) => question.text)
  ].join('\n')
}

function sectionDiscriminatingSignals(
  section: Pick<SectionEvidenceMapEntry, 'title' | 'questionIds'>,
  input: Pick<ReportArchitectInput, 'frame'>
): string[] {
  const titleSignals = researchSignalTerms(section.title)
  const ownedQuestions = input.frame.coreQuestions
    .filter((question) => section.questionIds.includes(question.id))
    .map((question) => question.text)
  const siblingQuestions = input.frame.coreQuestions
    .filter((question) => !section.questionIds.includes(question.id))
    .map((question) => question.text.normalize('NFKC').toLowerCase())
  const questionSignals = researchSignalTerms(ownedQuestions.join('\n'))
    .filter((signal) => !siblingQuestions.some((question) =>
      question.includes(signal.normalize('NFKC').toLowerCase())
    ))
  return [...new Set([...titleSignals, ...questionSignals])]
}

function sectionPurpose(
  section: Pick<SectionEvidenceMapEntry, 'title' | 'questionIds'>,
  input: Pick<ReportArchitectInput, 'frame'>
): string {
  const questions = section.questionIds
    .map((questionId) => input.frame.coreQuestions.find((question) => question.id === questionId)?.text.trim())
    .filter((question): question is string => Boolean(question))
  const distinctQuestions = [...new Set(questions)]
  if (distinctQuestions.length === 0) {
    return `回答「${section.title}」，说明现有 claims 能支持的局部判断及尚未覆盖的部分。`
  }
  const questionSummary = distinctQuestions
    .map((question) => question.replace(/[？?。.!！]+$/u, '').trim())
    .join('；')
  return `回答以下已确认问题：${questionSummary}。说明现有 claims 能支持的局部判断及尚未覆盖的部分，并避免与其他章节重复。`
}

function sectionClaimScore(
  claim: ReportArchitectInput['claims'][number],
  focusGroups: string[][],
  mainlineSignals: string[] = [],
  sourceAuthorityScore = 0
): number {
  const claimText = `${claim.text}\n${claim.entities.join(' ')}`
  const normalizedClaimText = claimText.normalize('NFKC').toLowerCase()
  const coveredFacets = focusGroups.filter((group) =>
    coversResearchDimensionFocusGroups([group], claimText)
  ).length
  const mainlineSignalCount = new Set(mainlineSignals
    .map((signal) => signal.normalize('NFKC').toLowerCase())
    .filter((signal) => signal.length >= 3 && normalizedClaimText.includes(signal))).size
  const completeText = !/\b(?:and|or|but|because|if|when|while|with|without|using|including|as|to|from|of|for|the|a|an|receive|return|be|been|is|are|was|were)\s*$/iu.test(claim.text.trim())
  const lengthScore = claim.text.length >= 48 && claim.text.length <= 420
    ? 100
    : claim.text.length >= 28 ? 20 : -160
  const typeScore = claim.claimType === 'fact' || claim.claimType === 'metric' || claim.claimType === 'date'
    ? 80
    : claim.claimType === 'quote'
      ? 20
      : coveredFacets > 0 ? 0 : -180
  const sentenceCount = claim.text.split(/[。！？!?]|\.(?=\s|$)/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length
  const interpretiveLengthPenalty = (
    claim.claimType === 'quote' ||
    claim.claimType === 'opinion' ||
    claim.claimType === 'inference' ||
    claim.claimType === 'recommendation'
  )
    ? (claim.text.length > 260 ? 420 : 0) + (sentenceCount > 1 ? Math.min(520, (sentenceCount - 1) * 180) : 0)
    : 0
  const syntaxOnly = /^[\p{L}\p{N}_.-]+\s*:\s*[\p{L}\p{N}_.-]+(?:\s*,\s*[\p{L}\p{N}_.-]+)*\s*$/u.test(claim.text.trim())
  const proseScore = syntaxOnly
    ? -700
    : claim.entities.length > 0 ? 120 : 0
  return (coveredFacets * 1_000)
    + (mainlineSignalCount * 120)
    + (claim.critical ? 120 : 0)
    + (claim.confidence === 'high' ? 40 : claim.confidence === 'medium' ? 20 : 0)
    + lengthScore
    + typeScore
    + proseScore
    + sourceAuthorityScore
    + (completeText ? 0 : -500)
    - interpretiveLengthPenalty
}

function isArchitectCounterClaim(
  claim: ReportArchitectInput['claims'][number] | undefined
): boolean {
  if (!claim) return false
  if (claim.polarity === 'negative') return true
  return claim.critical === true && (claim.claimType === 'opinion' || claim.claimType === 'inference')
}

function claimSourceAuthorityScore(
  claim: ReportArchitectInput['claims'][number],
  input: Pick<ReportArchitectInput, 'sources' | 'evidenceSpans'>
): number {
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  let score = 0
  for (const spanId of claim.supportSpanIds) {
    const span = spanById.get(spanId)
    const source = span ? sourceById.get(span.sourceId) : undefined
    if (!span || !source || !canCiteEvidenceSpan(span, source)) continue
    if (isEligibleStrongWebEvidence(source, span)) score = Math.max(score, 1_500)
    else if (source.sourceType !== 'web' && source.reliability === 'high') score = Math.max(score, 900)
    else if (source.reliability === 'high') score = Math.max(score, 500)
  }
  return score
}

export function substantiallyOverlappingArchitectClaims(left: string, right: string): boolean {
  const compact = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const compactLeft = compact(left)
  const compactRight = compact(right)
  const shorter = compactLeft.length <= compactRight.length ? compactLeft : compactRight
  const longer = compactLeft.length <= compactRight.length ? compactRight : compactLeft
  if (shorter.length >= 36 && longer.includes(shorter)) return true

  const tokens = (value: string) => new Set(value.normalize('NFKC').toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3))
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  const smaller = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens
  const larger = leftTokens.size <= rightTokens.size ? rightTokens : leftTokens
  if (smaller.size >= 6) {
    const shared = [...smaller].filter((token) => larger.has(token)).length
    if (shared / smaller.size >= 0.8) return true
  }

  const characterShingles = (value: string) => {
    const characters = [...value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')]
    return new Set(characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`))
  }
  const leftShingles = characterShingles(left)
  const rightShingles = characterShingles(right)
  const smallerShingles = leftShingles.size <= rightShingles.size ? leftShingles : rightShingles
  const largerShingles = leftShingles.size <= rightShingles.size ? rightShingles : leftShingles
  if (smallerShingles.size < 24) return false
  const sharedShingles = [...smallerShingles].filter((shingle) => largerShingles.has(shingle)).length
  const shingleContainment = sharedShingles / smallerShingles.size
  if (shingleContainment >= 0.68) return true

  const numericValues = (value: string) => new Set(value.match(/\d+(?:[.,]\d+)*/gu)?.map((item) => item.replace(/,/gu, '')) ?? [])
  const leftNumbers = numericValues(left)
  const rightNumbers = numericValues(right)
  const sharedNumbers = [...leftNumbers].filter((number) => rightNumbers.has(number)).length
  return sharedNumbers >= 2 && shingleContainment >= 0.5
}

function inferReportType(input: ReportArchitectInput): ResearchReportType {
  const text = `${input.brief.topic}\n${input.frame.centralQuestion}\n${input.frame.coreResearchThread}`
  if ((input.frame.alternativesToCompare?.length ?? 0) >= 2 || /对比|比较|差异|versus|\bvs\b/iu.test(text)) return 'comparison'
  if (input.frame.decisionToSupport || /如何选择|怎么选|是否应该|决策|建议/iu.test(text)) return 'decision'
  if (/调查|事件|时间线|争议|真相|冲突/iu.test(text)) return 'investigation'
  return 'explanatory'
}

function reportTypeValue(value: unknown): ResearchReportType | undefined {
  return value === 'explanatory' || value === 'comparison' || value === 'decision' || value === 'market' || value === 'investigation'
    ? value
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
    : []
}

function hashArchitectInput(input: ReportArchitectInput): string {
  const text = `${input.runId}\n${input.brief.topic}\n${input.sectionEvidenceMap?.map((section) => `${section.sectionId}:${section.claimIds.join(',')}:${(section.contextClaimIds ?? []).join(',')}`).join('|') ?? ''}`
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
  return Math.abs(hash).toString(36)
}

function architectErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'unknown error')
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return raw.slice(start, index + 1)
    }
  }
  return null
}
