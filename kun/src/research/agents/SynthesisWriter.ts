/**
 * [INPUT]: 依赖 model-client、运行级模型选择、ReportBlueprint、sectionEvidenceMap、claims、evidence ledger 和 citation 占位符生成正文
 * [OUTPUT]: 对外提供支持当前模型/Provider 的 quick-only BasicSynthesisWriter、任意正数蓝图章节的 ModelSynthesisWriter、SynthesisWriterFailed 与 buildSynthesisWriterPrompt
 * [POS]: research/agents 的报告作者节点；standard/deep 不论蓝图章节数量都按分章路径写作并执行 claim 归属校验，Basic 只允许 quick diagnostic 草稿
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest } from '../../ports/model-client.js'
import { researchReasoningForStage } from '../core/presets.js'
import { linkResearchAbortSignal, throwIfResearchAborted } from '../core/abort.js'
import { estimateResearchRequestTokens } from '../core/token-estimate.js'
import type { ResearchModelUsageRecord } from '../core/types.js'
import type { DraftReport, SynthesisWriter, SynthesisWriterInput } from './types.js'
import { assertDraftFollowsBlueprint, repairDraftClaimPlacement } from './ResearchEditor.js'
import { extendDiagnosticReportIfNeeded } from './BasicSynthesisSupport.js'
import { assertSupportedDraftNumbers, sanitizeUnsupportedDraftNumbers } from './SynthesisDraftNumberSafety.js'
import { sanitizeUncitedDraftSentences } from '../evidence/CitationProximity.js'
import { writeSectionedSynthesisDraft } from './SectionSynthesisWriter.js'
import {
  appendReportContractSections,
  assertSupportedDraftRecommendations,
  assertSupportedDraftTechnicalTerms,
  assertUsableModelDraft,
  buildSynthesisWriterPrompt,
  claimTextForReport,
  cleanAnalysisTextForReport,
  collectWriterText,
  coreAllocationJudgement,
  errorMessage,
  ensureReportContractSections,
  extractUsedClaimIds,
  groupClaimsForSynthesis,
  hashWriterInput,
  isComparisonResearch,
  normalizeModelDraftSections,
  normalizeDraftCitationPlaceholders,
  normalizeDanglingProseEndings,
  sanitizeUnsupportedDraftTechnicalTerms,
  stripMarkdownFence,
  stripRuntimeGeneratedDraftSections,
  uniqueLimitations,
  usableClaimsForSynthesis
} from './SynthesisWriterSupport.js'

export { buildSynthesisWriterPrompt, MIN_DETAILED_REPORT_CHARS } from './SynthesisWriterSupport.js'

export const MODEL_SYNTHESIS_WRITER_TIMEOUT_MS = 180_000

export class SynthesisWriterFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SynthesisWriterFailed'
  }
}

export const MODEL_SYNTHESIS_WRITER_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的唯一正文作者。',
  '研究主编已经产出 ReportBlueprint，Research Workers 已经产出 claims 和 evidence ledger；你的职责是严格按蓝图写一篇统一、完整、可编辑的 Markdown 报告。',
  '必须先直接回答问题，再按蓝图章节组织论证，不要做百科式资料堆砌。',
  '每个章节只完成一个独特的论证任务，避免同一结论或证据在多个章节重复出现。',
  '摘要和调研范围说明由 Runtime 在最终报告完成后短后处理生成；你不要把输出预算花在这些包装性段落上。',
  '如果 Runtime 提供了上一轮质量校验反馈，你必须重写完整报告并逐条修复 blockingIssues 和 recommendedFixes；不要只解释问题。',
  '所有关键事实性判断都必须使用提供的 claim id，占位符格式必须是 [claim:claim_id]；不要自己发明脚注。',
  '你没有权限使用输入之外的常识补齐技术机制、配置项或建议；证据没写就明确说缺证据。',
  '不要为了达到篇幅要求扩写无证据内容，短而忠实的报告优于完整但失真的报告。',
  'Runtime 会解析这些占位符并生成 CitationBinding，所以你只输出 Markdown 正文，不输出代码块。',
  '不要输出“核心问题与回答”或“证据链”二级标题，不要输出运行 ID、来源数量、模型评审等内部诊断元数据。',
  '不要在正文中复述内部字段名或英文标签，也不要声称可用 Claim 来自“模型生成资料卡”；可用 Claim 已经过证据准入，只能描述输入中实际存在的来源局限。',
  '除非用户明确要求其他语言，报告必须使用中文。'
].join('\n')

export class BasicSynthesisWriter implements SynthesisWriter {
  async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    if (input.budget.preset !== 'quick') {
      throw new SynthesisWriterFailed(`BasicSynthesisWriter is diagnostic-only and cannot produce ${input.budget.preset} DeepResearch reports.`)
    }
    const usedClaimIds: string[] = []
    const usableClaims = usableClaimsForSynthesis(input)
    const firstClaim = usableClaims[0]
    const lines: string[] = [
      `# ${input.brief.topic}`,
      ''
    ]

    lines.push('## 主要发现')
    lines.push('')
    lines.push(`本报告围绕这条判断线索展开：${input.frame.coreResearchThread}。正文优先呈现能改变判断的事实、机制和边界条件，而不是把资料平均铺开。`)
    lines.push('')
    if (firstClaim) {
      lines.push(`基于当前已记录证据，最关键的可验证结论是：${claimTextForReport(firstClaim)} [claim:${firstClaim.id}]。这个结论应被视为全文的起点，而不是终点；后续章节会继续说明它的适用范围和仍需复核的部分。`)
      usedClaimIds.push(firstClaim.id)
      lines.push('')
    }
    appendReportContractSections(lines, input, usedClaimIds, usableClaims)
    const criticalClaims = usableClaims.filter((claim) => claim.critical)
    const findingClaims = criticalClaims.length > 0 ? criticalClaims : usableClaims.slice(0, 6)
    if (findingClaims.length === 0) {
      lines.push('当前资料还没有形成可引用的核心发现。报告可以记录研究框架，但不能把它视为完成的 DeepResearch 结果。')
      lines.push('')
    } else if (isComparisonResearch(input)) {
      const dimensionGroups = groupClaimsForSynthesis(input, usableClaims).filter((group) => group.facts.length > 0)
      for (const group of dimensionGroups.slice(0, 8)) {
        lines.push(`### ${group.dimension}`)
        lines.push('')
        lines.push(`${group.facts.slice(0, 3).join('；')}。`)
        usedClaimIds.push(...group.claimIds.slice(0, 3))
        const relatedNotes = input.notes.filter((note) => note.claimIds.some((claimId) => group.claimIds.includes(claimId)))
        const implications = relatedNotes
          .map((note) => cleanAnalysisTextForReport(note.implicationForBrief))
          .filter(Boolean)
          .slice(0, 3)
        if (implications.length > 0) {
          lines.push('')
          lines.push(`${implications.join('；')}。这一维度需要与其他证据维度合并判断，不能单独决定结论。`)
        }
        const limitations = relatedNotes.flatMap((note) => note.limitations).filter(Boolean)
        if (limitations.length > 0) {
          lines.push('')
          lines.push(`需要注意：${limitations.slice(0, 3).join('；')}。`)
        }
        lines.push('')
      }
      lines.push('### 对核心问题的综合判断')
      lines.push('')
      lines.push(coreAllocationJudgement(input, dimensionGroups, usedClaimIds))
      lines.push('')
    } else {
      const dimensionGroups = groupClaimsForSynthesis(input, usableClaims).filter((group) => group.facts.length > 0)
      for (const group of dimensionGroups.slice(0, 8)) {
        lines.push(`### ${group.dimension}`)
        lines.push('')
        lines.push(`这一维度下的可用证据显示：${group.facts.slice(0, 3).join('；')}。`)
        usedClaimIds.push(...group.claimIds.slice(0, 3))
        const relatedNotes = input.notes.filter((note) => note.claimIds.some((claimId) => group.claimIds.includes(claimId)))
        if (relatedNotes.length > 0) {
          const implications = relatedNotes
            .map((note) => cleanAnalysisTextForReport(note.implicationForBrief))
            .filter(Boolean)
            .slice(0, 3)
          if (implications.length > 0) {
            lines.push('')
            lines.push(`从调研含义看，${implications.join('；')}。这一维度需要与其他证据维度合并判断，不能单独决定结论。`)
          }
          const limitations = relatedNotes.flatMap((note) => note.limitations).filter(Boolean)
          if (limitations.length > 0) {
            lines.push('')
            lines.push(`这条发现也有明确边界：${limitations.slice(0, 3).join('；')}。因此它更适合作为阶段性判断，而不是脱离来源和时间范围的最终定论。`)
          }
        }
        lines.push('')
      }
      lines.push('### 对核心问题的综合判断')
      lines.push('')
      lines.push(coreAllocationJudgement(input, dimensionGroups, usedClaimIds))
      lines.push('')
    }
    if (input.frame.coreQuestions.length > 0) {
      lines.push(`综合这些发现，报告需要覆盖的关键维度包括：${input.frame.coreQuestions.map((question) => question.text).join('；')}。这些维度共同决定了结论是否只是资料罗列，还是能真正回答用户要理解的差异、原因和趋势。`)
      lines.push('')
      lines.push('阅读这些发现时，应把它们看成一组相互约束的判断，而不是可以单独摘出的结论。一个发现解释事实差异，另一个发现解释机制或趋势，局限部分则说明哪些地方还不能下定论。这样的组织方式能让报告既有明确观点，又保留继续复核和补证的空间，也方便用户把报告继续改写成文章、演讲稿或决策备忘录，并保留清晰的复核入口。')
      lines.push('')
      lines.push('如果这些维度之间出现张力，报告应优先处理最能改变结论的那一个：例如某个事实看似醒目，但不能解释用户真正关心的路径，就只能作为背景；相反，一个数据点即使篇幅不大，只要能改变比较口径、风险判断或行动建议，就应该被放在主论证中。')
      lines.push('')
    }
    lines.push('')

    lines.push('## 结论与建议')
    lines.push('')
    lines.push(`结论应服从主要判断线索：${input.frame.coreResearchThread}。因此，本报告不是把所有材料平均展开，而是优先说明哪些因素真正决定结论。`)
    lines.push('')
    lines.push('形成建议时，需要把“事实已经足够支持什么”和“还不能支持什么”分开写。前者进入结论，后者进入局限或后续研究建议；如果两者混在一起，报告就会看似完整，实则无法帮助用户做判断，也无法指导下一轮补证和复核。')
    lines.push('')
    if (criticalClaims.length > 0) {
      const lead = criticalClaims[0]
      const caveatSuffix = isComparisonResearch(input)
          ? '但对比双方在各维度的差异仍需逐项复核，不能以单一结论替代分维度判断。'
          : '但关键假设和来源限制仍需逐项复核。'
      lines.push(`第一，当前最值得采纳的主结论是：${claimTextForReport(lead)} [claim:${lead.id}]。这条结论应作为用户继续判断的默认起点，${caveatSuffix}`)
      usedClaimIds.push(lead.id)
      for (const claim of criticalClaims.slice(1, 6)) {
        lines.push('')
        lines.push(`第二层补充判断是：${claimTextForReport(claim)} [claim:${claim.id}]。它可以帮助用户理解主结论背后的结构性原因，而不是只看到表层现象。`)
        usedClaimIds.push(claim.id)
      }
    } else {
      lines.push('在当前证据基础上，可以形成初步报告结论，但所有结论都应保留证据来源和局限说明。')
    }
    if (isComparisonResearch(input)) {
      lines.push('')
      lines.push(`对于“${input.frame.centralQuestion}”，应按已确认的比较维度分别给出判断，并明确每个判断的适用条件。最终选择取决于用户目标、证据强度和边界条件，而不是单指标排名。`)
    }
    if (input.frame.disconfirmingEvidenceNeeded.length > 0) {
      lines.push('')
      lines.push(`下一步需要优先寻找反证：${input.frame.disconfirmingEvidenceNeeded.join('；')}。如果这些反证成立，报告结论应被降级为阶段性判断。`)
    }
    lines.push('')

    lines.push('## 局限与不确定性')
    lines.push('')
    const limitations = uniqueLimitations(input.notes.flatMap((note) => note.limitations))
    if (limitations.length === 0) {
      lines.push('- 当前材料暂未记录主要局限，但这不意味着没有局限；它只说明现有资料中还缺少足够多的反证或边界条件。')
    } else {
      for (const limitation of limitations.slice(0, 8)) {
        lines.push(`- ${limitation}`)
      }
    }
    if (input.revision) {
      lines.push('- 本报告已根据质量校验结果重新整理，但仍建议复核关键数据口径和引用来源。')
    }

    lines.push('')
    lines.push('## 后续研究建议')
    lines.push('')
    const limitationSections = input.sectionEvidenceMap?.filter((section) => section.status !== 'covered') ?? []
    if (limitationSections.length > 0) {
      for (const section of limitationSections.slice(0, 6)) {
        lines.push(`- 补充「${section.title}」维度的可引用证据，并复核当前低置信判断。`)
      }
    } else {
      lines.push('- 围绕关键判断追加更新来源，重点复核时间范围、口径变化和反面证据。')
    }

    extendDiagnosticReportIfNeeded(lines, input, usedClaimIds)

    return {
      markdown: lines.join('\n'),
      claimIds: [...new Set(usedClaimIds)],
      generatedAt: input.nowIso,
      diagnostic: true
    }
  }
}

export class ModelSynthesisWriter implements SynthesisWriter {
  private readonly fallback?: SynthesisWriter

  constructor(
    private readonly options: {
      modelClient: ModelClient
      model: string
      timeoutMs?: number
      fallback?: SynthesisWriter
    }
  ) {
    this.fallback = options.fallback
  }

  async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    const mode = input.retryFeedback ? 'compact' : 'full'
    const model = input.execution?.model?.trim() || this.options.model
    const providerId = input.execution?.providerId?.trim()
    try {
      if (input.budget.preset !== 'quick' && (input.reportBlueprint?.sections.length ?? 0) >= 1) {
        return await writeSectionedSynthesisDraft(input, {
          modelClient: this.options.modelClient,
          model,
          ...(providerId ? { providerId } : {}),
          timeoutMs: this.options.timeoutMs
        })
      }
      return await this.writeDraftAttempt(input, mode, 1, input.retryFeedback)
    } catch (error) {
      if (this.fallback && input.budget.preset === 'quick') {
        return this.fallback.writeDraft(input)
      }
      throw new SynthesisWriterFailed(`Synthesis writer failed before producing a user-ready report: ${errorMessage(error)}`)
    }
  }

  private async writeDraftAttempt(
    input: SynthesisWriterInput,
    mode: 'full' | 'compact',
    attemptNumber: number,
    retryFeedback?: string
  ): Promise<DraftReport> {
    const model = input.execution?.model?.trim() || this.options.model
    const providerId = input.execution?.providerId?.trim()
    throwIfResearchAborted(input.execution?.signal)
    const controller = new AbortController()
    const unlinkAbort = linkResearchAbortSignal(input.execution?.signal, controller)
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.options.timeoutMs ?? MODEL_SYNTHESIS_WRITER_TIMEOUT_MS)
    )

    const turnId = `research_writer_${hashWriterInput(input)}_${mode}`
    const prompt = buildSynthesisWriterPrompt(input, { compact: mode === 'compact', retryFeedback })
    const maxTokens = mode === 'compact' ? 6_000 : 8_000
    const reservation = input.execution?.reserveModelCall(
      'writer',
      estimateResearchRequestTokens(`${MODEL_SYNTHESIS_WRITER_SYSTEM_PROMPT}\n${prompt}`, maxTokens)
    )
    const observedUsage: ResearchModelUsageRecord['usage'][] = []
    let usageRecorded = false
    try {
      const request: ModelRequest = {
        threadId: 'research_synthesis_writer',
        turnId,
        model,
        ...(providerId ? { providerId } : {}),
        systemPrompt: MODEL_SYNTHESIS_WRITER_SYSTEM_PROMPT,
        prefix: [],
        history: [
          makeUserItem({
            id: `item_${turnId}_user`,
            threadId: 'research_synthesis_writer',
            turnId,
            text: prompt
          })
        ],
        tools: [],
        stream: false,
        maxTokens,
        temperature: 0.2,
        reasoningEffort: researchReasoningForStage(input.budget.reasoningEffort, 'writer'),
        abortSignal: controller.signal
      }
      const collected = await collectWriterText(
        this.options.modelClient.stream(request),
        controller.signal,
        (usage) => observedUsage.push(usage)
      )
      const normalizedMarkdown = normalizeDanglingProseEndings(normalizeDraftCitationPlaceholders(normalizeModelDraftSections(
        stripRuntimeGeneratedDraftSections(stripMarkdownFence(collected.text).trim()),
        input
      ), input))
      const usableClaims = usableClaimsForSynthesis(input)
      const contractCompleteMarkdown = ensureReportContractSections(normalizedMarkdown, input, usableClaims)
      const shouldRepairDraft = Boolean(retryFeedback || input.revision)
      const numberSafeMarkdown = shouldRepairDraft
        ? sanitizeUnsupportedDraftNumbers(contractCompleteMarkdown, input)
        : contractCompleteMarkdown
      const technicalSafeMarkdown = sanitizeUnsupportedDraftTechnicalTerms(numberSafeMarkdown, input)
      const citationSafeMarkdown = shouldRepairDraft
        ? sanitizeUncitedDraftSentences(technicalSafeMarkdown)
        : technicalSafeMarkdown
      const placementSafeMarkdown = shouldRepairDraft
        ? repairDraftClaimPlacement(citationSafeMarkdown, input)
        : technicalSafeMarkdown
      const markdown = shouldRepairDraft
        ? sanitizeUncitedDraftSentences(placementSafeMarkdown)
        : placementSafeMarkdown
      assertUsableModelDraft(markdown, input, { compact: mode === 'compact', edited: shouldRepairDraft })
      assertDraftFollowsBlueprint(markdown, input)
      assertSupportedDraftNumbers(markdown, input)
      assertSupportedDraftTechnicalTerms(markdown, input)
      assertSupportedDraftRecommendations(markdown, input)
      const usageRecords = collected.usage.slice(-1).map((usage) => ({
        stage: 'writer' as const,
        model,
        turnId,
        attempt: input.revision?.attempt ?? attemptNumber,
        usage
      }))
      if (input.execution && reservation && usageRecords[0]) {
        await input.execution.recordModelUsage(usageRecords[0], reservation)
        usageRecorded = true
      }
      return {
        markdown,
        claimIds: extractUsedClaimIds(markdown, new Set(usableClaims.map((claim) => claim.id))),
        generatedAt: input.nowIso,
        ...(!input.execution && usageRecords.length > 0 ? { modelUsage: usageRecords } : {})
      }
    } finally {
      clearTimeout(timeout)
      unlinkAbort()
      if (input.execution && reservation) {
        const lastUsage = observedUsage.at(-1)
        if (!usageRecorded && lastUsage) {
          await input.execution.recordModelUsage({
            stage: 'writer',
            model,
            turnId,
            attempt: input.revision?.attempt ?? attemptNumber,
            usage: lastUsage
          }, reservation)
          usageRecorded = true
        }
        await input.execution.finishModelCall(reservation, { chargeEstimateOnMissing: !usageRecorded })
      }
    }
  }
}
