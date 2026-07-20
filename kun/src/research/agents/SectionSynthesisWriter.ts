/**
 * [INPUT]: 依赖 ModelClient、运行级模型/Provider、core/comparison 的用户对比对象证据投影、含 direct/conditional_application/evidence_gap 证据模式与主证据/跨章前提的 ReportBlueprint、SectionEvidenceMap 和通过准入的 claims/evidence
 * [OUTPUT]: 对外提供支持任意正数章节和当前模型选择的 writeSectionedSynthesisDraft、在写作超时内持续恢复 429/502/503/504、瞬时网络错误及结构真正改善的截断 JSON 响应、保留已验证结构化 facts 并只定向补译缺失 claim，外文缺项的严格 facts JSON 补译无进展时切换为纯文本单句翻译、由程序包装后继续执行数字/币种/主体/时间守恒校验、强制每个硬范围代表 claim 在所属章节以独立事实句交付并把清洗后缺失错误路由回对应章节重写、收尾安全返工遇到复制正文或结构不合格时按语义死循环持续定向重写并可在最终数字与引用清洗后从最多三个不同章节的蓝图 claim 确定性恢复跨章综合、把逐范围缺证边界稳定写回所属章节、单目标补译兼容 facts 数组或 fact/sentence 单字段后统一归一、结构化 sentence 先剥离模型误写的 claim 协议标记再由程序重绑、跨语言事实译写沿用单事实的完整句、数字守恒、同币种金额数学等价与 times/倍等价校验而同语言改写保持严格忠实校验、单事实补丁仅在漏写 claimId 时绑定唯一目标并拒绝显式错绑，中文报告补译不忠实时禁止把非中文原始 claim 回填正文、把累计事实集合纳入语义死循环指纹、可回归验证且在重建收尾后再次执行句级数字清理的 prepareSectionedDraft 安全链、仅对逐句忠实且相关的段尾共享 claim 向前补齐引用、强制保留原始数字且按语义死循环持续恢复的单证据事实翻译、单证据确定性草稿显式绑定原始 claim、按实际 claim/span/来源身份与发布者分组生成 evidenceTopologyLimitations、清洗后多事实直证章节与跨章节事实收尾综合的确定性重建、结论与结论建议标题统一寻址、结论事实的无依据定性评价替换、结论综合避开已使用 fact 并压缩长引用、按来源可信度排序并优先保留蓝图标记的反证/校准视角、对收尾中已引用事实保留但无依据因果尾句做句内裁剪、所有多证据事实摘要失败直接转结构化重写而非继续追加正文、移除内部分类标签、条件场景在局部深度校验前的确定性论证补齐、无依据高风险综合句及否定性抑制关系清理、把“驱动因素”栏目名词与因果动词分开验收并归一“现有证据覆盖了”边界句、识别“无法确定是否存在因果、关联或叠加”等安全证据边界、逐 fact 只对其绑定 claim 做忠实度校验并用完整中文 claim 修复跨 claim 数字串用、悬空连接残句或模型漏项的动态 facts[] 结构化修复、对 relation/answer/boundary 三个分析字段一起定向返工、把“无直接因果”降级为“现有材料不能证明因果”并把 facts 或裸“已覆盖”边界改写为读者语言、从安全 relation 重建答案时只发布一次、把带“限制”等名词的研究对象与无依据动作扩写分开验收、模型关系连续不安全但全部 facts 已验证时按动态对比对象和章节标题生成保守读者结论、Judge 点名的直证章节在安全清理后丢失综合时也只基于仍可见的两条独立事实恢复同类结论，且缺失风险/趋势答案时交回定向重写而不自动注入用户可见模板结论
 * [QUALITY]: 常规章节有三条以上独立可引事实时，首稿和定向返工至少保留三条再作真实综合与具体边界；最终安全清理只复核事实、引用、数字与结构，不重复运行章节深度门；结构化事实已逐条验证时，低风险关系表达按相关性验收，“强/弱”等正式分类名不冒充优劣判断，facts“已说明/未涉及”边界转换为读者语言，且清洗不得破坏小数或来源标题中的括号主体限定符
 * [POS]: research/agents 的分章写作节点，被 ModelSynthesisWriter 首稿与质量修订调用；直接证据稀疏时只允许条件化应用，补研无语义进展时用 evidence_gap 章节诚实保留结论且不调用模型补事实，机制前提可作为事实陈述，但场景判断必须受全部已筛选前提共同约束且不得伪装成实测结论，未加条件的 relation 不进入场景正文
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest } from '../../ports/model-client.js'
import { linkResearchAbortSignal, throwIfResearchAborted } from '../core/abort.js'
import { normalizeResearchChineseScript } from '../core/chinese-script.js'
import { projectComparisonEvidenceText } from '../core/comparison.js'
import { hashText } from '../core/hash.js'
import { researchReasoningForStage } from '../core/presets.js'
import { resolveResearchReportTitle } from '../core/report-title.js'
import {
  isContextualReportSection,
  minimumReportArgumentChars,
  reportArgumentMeetsDepth,
  reportArgumentSignals,
  requiredConditionalContextClaimCount
} from '../core/report-argument.js'
import {
  repairDanglingConclusionConnectors,
  reportClosingDepthIssue,
  reportLimitationsDepthIssue
} from '../core/report-closing.js'
import { estimateResearchRequestTokens } from '../core/token-estimate.js'
import type { ResearchModelCallReservation, ResearchModelUsageRecord, ResearchReportBlueprintSection } from '../core/types.js'
import {
  canCiteEvidenceSpan,
  coversResearchDimensionFocusGroups,
  isEligibleStrongWebEvidence,
  isExtractionCorruptionText,
  isUsableEvidenceText,
  isResearchTextRelevant,
  researchDimensionFocusGroups
} from '../evidence/EvidenceEligibility.js'
import {
  hasExplicitEvidenceGapBoundary,
  hasExternallyCheckableMechanism,
  hasUnsupportedEvidenceBoundaryExpansion,
  sanitizeUncitedDraftSentences,
  splitCitationSentences
} from '../evidence/CitationProximity.js'
import {
  assessClaimFaithfulness,
  equivalentCrossLanguageMonetaryTokens,
  numericTokens,
  unsupportedTranslatedNumericTokens
} from '../evidence/ClaimSupport.js'
import { assertDraftFollowsBlueprint, repairDraftClaimPlacement } from './ResearchEditor.js'
import { assertSupportedDraftNumbers, sanitizeUnsupportedDraftNumbers } from './SynthesisDraftNumberSafety.js'
import {
  assertSupportedDraftRecommendations,
  assertSupportedDraftTechnicalTerms,
  assertUsableModelDraft,
  cleanClaimForPrompt,
  cleanEvidenceTextForPrompt,
  collectWriterText,
  ensureReportContractSections,
  errorMessage,
  evidenceTopologyLimitations,
  extractUsedClaimIds,
  isInternalResearchProcessLimitation,
  longForeignProseExcerpt,
  normalizeDanglingProseEndings,
  normalizeDraftCitationPlaceholders,
  normalizeModelDraftSections,
  sanitizeUnrequestedDraftRecommendations,
  sanitizeUnsupportedDraftTechnicalTerms,
  synthesisConclusionTitle,
  stripMarkdownFence,
  stripRuntimeGeneratedDraftSections,
  uniqueLimitations,
  usableClaimsForSynthesis
} from './SynthesisWriterSupport.js'
import type { DraftReport, SynthesisWriterInput } from './types.js'

const SECTION_WRITER_TIMEOUT_MS = 120_000
const SECTION_MAX_TOKENS = 3_200
const CLOSING_MAX_TOKENS = 2_800
const RAW_INTERNAL_RESEARCH_ID = /\b(?:task|gap)_\w+_(?:claim|span|source|note)_\w+\b/giu
const STRUCTURED_CLAIM_RE = /\[structured-claim:([^\]]+)\]/gu

const SECTION_WRITER_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的章节作者，只负责一个章节。',
  '必须把本章写成完整论证，而不是资料摘要：先给局部结论，再解释证据，再说明证据如何推出结论。',
  '只有证据缺口、反例或适用条件会实质改变本章结论时，才在本章说明边界；不得机械添加“适用边界是”之类模板句。',
  '只能使用输入给出的 claim id 和证据，不得增加事实、数字或引用。',
  '比较报告只讨论用户明确列出的对比对象；若来源同时列出第三对象，只能使用用户对象对应的事实段，不能把第三对象当作等价替身写进正文。',
  '只输出章节正文，不输出标题、代码块、摘要、结论或写作说明。'
].join('\n')

const SECTION_EXTENSION_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的章节补写编辑，只补充上一稿缺少的分析段，不重写已有正文。',
  '新增内容只能补充输入中尚未使用的已验证 claim、解释证据如何推出局部结论，并指出一个具体证据边界；不得重复事实或增加输入之外的事实、数字、建议和引用。',
  '只输出需要追加的中文段落，不输出标题、JSON、代码块或修改说明。'
].join('\n')

const SPARSE_SECTION_RETRY_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的单证据章节修订作者。',
  '本章只有一条可引用 claim；不得制造第二条事实或引入 claim 未出现的技术名词。',
  '只输出 JSON，唯一字段是 fact；fact 只翻译原始 claim，不写推理、边界、写作说明或 claim id。',
  '原始 claim 中的数字必须全部保留原值，禁止换算单位、四舍五入、重新计算或新增数字。'
].join('\n')

const MULTI_CLAIM_SECTION_RETRY_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的多证据章节修订作者。',
  '只输出 JSON，字段必须是 facts、relation、answer、boundary。',
  'facts 必须逐项覆盖每个指定 claim，每项只含 claimId 和 sentence；relation 只说明这些事实之间的关系；answer 单独说明这种关系对本章问题的含义；boundary 只写证据未覆盖项。',
  '只有 claim 原文明确支持时才能写因果、替代、补偿、协同或效果；否则 relation 必须把事实作为不同层面的并列约束，answer 只能给出受证据限制的非因果判断。',
  '不得增加 claim 未出现的技术机制、策略分类、适用性、性能效果或行动建议。'
].join('\n')

const MISSING_STRUCTURED_FACT_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的缺失事实补译器。',
  '只输出 JSON，唯一字段是 facts；facts 必须恰好包含输入指定的一个 claimId 和 sentence。',
  'sentence 只把该 claim 准确翻译成一个完整中文事实句，不写关系、分析、边界、建议或其他 claim。',
  '必须保留原始主体、数字、币种、时间、实现状态和不确定性，不得换算、四舍五入或增加事实。'
].join('\n')

const SINGLE_FACT_TRANSLATION_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的单句事实翻译器。',
  '只输出原始 claim 的一个完整中文事实句，不要 JSON、Markdown、标题、claim id、分析、边界或解释。',
  '必须保留原始主体、数字、币种、时间、实现状态和不确定性，不得换算、四舍五入、增加或删除事实。'
].join('\n')

const STRUCTURED_SYNTHESIS_REPAIR_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的证据关系修订器。',
  '输入 facts 已全部通过忠实校验，禁止重写、删除或补充 facts。',
  '只输出 JSON，字段只能是 relation、answer 和 boundary；三个字段都必须是完整中文句子。',
  'relation 不复述数字和完整事实，只说明各事实在本章论证中的实质关系，例如结果与条件、当前与计划、发布方自述与独立观察的区别；没有直接因果时就明确不能证明因果。',
  'answer 必须直接回答输入给出的本章问题，写成面向读者的局部结论；禁止写“可确认的是”“本章描述了”“这些事实表明”等证据管理话术。',
  'boundary 必须点名 facts 已出现的具体对象或时间范围，并说明相邻的未覆盖判断；禁止写“本章有几条证据”“已引用对象与条件”等证据管理模板。',
  '不得解释 facts 为什么发生，不得评价好坏，不得增加输入未出现的对象、环境、机制或建议；不得输出 facts 字段。'
].join('\n')

const CLOSING_WRITER_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的总编，只负责报告开头、全文结论和局限。',
  '章节正文已经写好；你不能重写章节、增加事实或发明引用。',
  '只能使用输入中的 claim id，输出严格 JSON。'
].join('\n')

function comparisonClaimTextForPrompt(text: string, input: SynthesisWriterInput): string {
  return cleanClaimForPrompt(projectComparisonEvidenceText(
    text,
    input.frame.alternativesToCompare ?? []
  ))
}

export async function writeSectionedSynthesisDraft(
  input: SynthesisWriterInput,
  options: { modelClient: ModelClient; model: string; providerId?: string; timeoutMs?: number }
): Promise<DraftReport> {
  const synthesisInput = inputWithUsableBlueprint(input)
  const blueprint = synthesisInput.reportBlueprint
  if (!blueprint || blueprint.sections.length < 1) {
    throw new Error('sectioned synthesis requires at least one blueprint section')
  }
  throwIfResearchAborted(synthesisInput.execution?.signal)
  const waveController = new AbortController()
  const unlinkWave = linkResearchAbortSignal(synthesisInput.execution?.signal, waveController)
  const waveInput: SynthesisWriterInput = synthesisInput.execution
    ? { ...synthesisInput, execution: { ...synthesisInput.execution, signal: waveController.signal } }
    : synthesisInput
  const revisionPlan = sectionRevisionPlan(waveInput, blueprint.sections)
  const evidenceGapSections = blueprint.sections.filter((section) =>
    revisionPlan.sectionIds.has(section.id) && section.evidenceMode === 'evidence_gap'
  )
  const sectionRequests = blueprint.sections
    .filter((section) => revisionPlan.sectionIds.has(section.id) && section.evidenceMode !== 'evidence_gap')
    .map((section, index) => {
    const structuredRevision = Boolean(waveInput.revision?.previousDraftMarkdown)
      && shouldUseStructuredMultiClaimRetry(section, waveInput, 'quality revision')
    const revisionIssue = waveInput.revision ? [
      ...waveInput.revision.previousVerdict.blockingIssues,
      ...waveInput.revision.previousVerdict.warnings,
      ...waveInput.revision.previousVerdict.recommendedFixes
    ].filter((item) => feedbackTargetsSection(item, section.title)).join('\n') : ''
    const previousBody = previousSectionBody(waveInput.revision?.previousDraftMarkdown ?? '', section.title)
    return {
      section,
      structuredRevision,
      systemPrompt: structuredRevision ? MULTI_CLAIM_SECTION_RETRY_SYSTEM_PROMPT : SECTION_WRITER_SYSTEM_PROMPT,
      prompt: structuredRevision
        ? buildMultiClaimSectionRetryPrompt(waveInput, section, previousBody, revisionIssue || '按双分面发布合同重写本章。')
        : buildSectionPrompt(waveInput, section),
      turnId: `research_section_writer_${index + 1}_${hashText(`${waveInput.runId}:${section.id}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`,
      maxTokens: SECTION_MAX_TOKENS,
      ...(structuredRevision ? { responseFormat: 'json_object' as const } : {})
    }
  })
  const estimates = [
    ...sectionRequests.map((request) => estimateResearchRequestTokens(`${request.systemPrompt}\n${request.prompt}`, request.maxTokens)),
    ...(revisionPlan.rewriteClosing
      ? [estimateResearchRequestTokens(`${CLOSING_WRITER_SYSTEM_PROMPT}\n${buildClosingPrompt(waveInput, '')}`, CLOSING_MAX_TOKENS)]
      : [])
  ]
  const reservations = await reserveWriterWave(waveInput, estimates)
  try {
    const generatedSections = new Map<string, string>(evidenceGapSections.map((section) => [
      section.id,
      renderEvidenceGapSection(section)
    ]))
    const sectionResults = await mapWithConcurrency(
      sectionRequests,
      Math.max(1, Math.min(waveInput.budget.maxWorkers, sectionRequests.length)),
      async (request, index) => ({
        section: request.section,
        structuredRevision: request.structuredRevision,
        result: await requestWriterText({
          input: waveInput,
          options,
          systemPrompt: request.systemPrompt,
          prompt: request.prompt,
          turnId: request.turnId,
          maxTokens: request.maxTokens,
          ...(request.responseFormat ? { responseFormat: request.responseFormat } : {}),
          reservation: reservations[index]
        })
      }),
      (error) => waveController.abort(error)
    )
    const targetedRetryUsage: ResearchModelUsageRecord[] = []
    for (const { section, result, structuredRevision } of sectionResults) {
      let normalizedBody: string
      if (structuredRevision) {
        const request = sectionRequests.find((candidate) => candidate.section.id === section.id)!
        const normalized = await normalizeStructuredSectionWithRecovery({
          initialResult: result,
          section,
          input: waveInput,
          options,
          basePrompt: request.prompt,
          turnIdPrefix: `research_section_writer_initial_parse_${hashText(`${waveInput.runId}:${section.id}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`
        })
        normalizedBody = normalized.body
        targetedRetryUsage.push(...normalized.modelUsage)
      } else {
        normalizedBody = normalizeSectionArgumentBody(result.text, section)
      }
      generatedSections.set(section.id, completeConditionalSectionArgument(normalizedBody, section, waveInput))
    }
    for (const section of sectionRequests.map((request) => request.section)) {
      let retryIndex = 0
      const seenDepthFailures = new Set<string>()
      const seenRetryRequests = new Set<string>()
      while (true) {
        const body = generatedSections.get(section.id) ?? ''
        const issue = sectionBodyDepthIssue(body, section, minimumSectionChars(section), waveInput)
        if (!issue) break
        const failureSignature = writerRepairSignature(issue, body)
        if (seenDepthFailures.has(failureSignature)) {
          throw new Error(`section writer entered a repeated depth-repair dead loop: ${issue}`)
        }
        seenDepthFailures.add(failureSignature)
        retryIndex += 1
        const multiClaimRetry = sectionRetryClaims(section, waveInput).length >= 2
        const structuredMultiRetry = shouldUseStructuredMultiClaimRetry(section, waveInput, issue)
        const rewriteSection = structuredMultiRetry || shouldRewriteSectionFromScratch(body)
        const sparseRetry = !multiClaimRetry
        const retryMode = sparseRetry
          ? 'sparse'
          : structuredMultiRetry ? 'structured-multi'
            : rewriteSection ? 'rewrite' : 'extend'
        const requestSignature = writerRetryRequestSignature(section.id, issue, body, retryMode)
        if (seenRetryRequests.has(requestSignature)) {
          throw new Error(`section writer entered an equivalent request dead loop: ${issue}`)
        }
        seenRetryRequests.add(requestSignature)
        const retryInput = {
          ...waveInput,
          retryFeedback: [
            issue,
            rewriteSection
              ? '上一稿在安全清洗后已经不足以作为章节骨架。请重新使用本章全部 claims 写完整章节，不要继承被删除的句子：'
              : '上一稿正文如下；保留其中正确的事实和引用，在此基础上补足机制解释与段落，不要从头压缩重写：',
            body.slice(0, 2_400)
          ].join('\n')
        }
        const retryResult = await requestWriterText({
          input: retryInput,
          options,
          systemPrompt: sparseRetry
            ? SPARSE_SECTION_RETRY_SYSTEM_PROMPT
            : structuredMultiRetry ? MULTI_CLAIM_SECTION_RETRY_SYSTEM_PROMPT
              : rewriteSection ? SECTION_WRITER_SYSTEM_PROMPT : SECTION_EXTENSION_SYSTEM_PROMPT,
          prompt: sparseRetry
            ? buildSparseSectionRetryPrompt(retryInput, section, body, issue)
            : structuredMultiRetry
              ? buildMultiClaimSectionRetryPrompt(retryInput, section, body, issue)
              : rewriteSection
              ? buildSectionPrompt(retryInput, section)
            : buildSectionExtensionPrompt(retryInput, section, body, issue),
          turnId: `research_section_writer_retry_${retryIndex}_${hashText(`${waveInput.runId}:${section.id}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`,
          maxTokens: SECTION_MAX_TOKENS,
          ...(sparseRetry || structuredMultiRetry ? { responseFormat: 'json_object' as const } : {})
        })
        let repairedBody: string
        if (sparseRetry) {
          const normalized = await normalizeSparseSectionWithRecovery({
            initialResult: retryResult,
            section,
            input: retryInput,
            options,
            basePrompt: buildSparseSectionRetryPrompt(retryInput, section, body, issue),
            turnIdPrefix: `research_section_writer_depth_sparse_parse_${hashText(`${waveInput.runId}:${section.id}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`
          })
          repairedBody = normalized.body
          targetedRetryUsage.push(...normalized.modelUsage)
        } else if (structuredMultiRetry) {
          const normalized = await normalizeStructuredSectionWithRecovery({
            initialResult: retryResult,
            section,
            input: retryInput,
            options,
            basePrompt: buildMultiClaimSectionRetryPrompt(retryInput, section, body, issue),
            turnIdPrefix: `research_section_writer_depth_parse_${hashText(`${waveInput.runId}:${section.id}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`
          })
          repairedBody = normalized.body
          targetedRetryUsage.push(...normalized.modelUsage)
        } else {
          repairedBody = normalizeSectionArgumentBody(retryResult.text, section)
        }
        const mergedBody = rewriteSection
          ? repairedBody
          : [body, sanitizeSectionExtensionClaimUsage(repairedBody, section, body)].filter(Boolean).join('\n\n')
        generatedSections.set(
          section.id,
          completeConditionalSectionArgument(mergedBody, section, retryInput)
        )
        targetedRetryUsage.push(...retryResult.modelUsage)
      }
    }
    const previousMarkdown = waveInput.revision?.previousDraftMarkdown ?? ''
    let sectionMarkdown = renderSectionMarkdown(blueprint.sections, generatedSections, previousMarkdown)

    let closingResult = revisionPlan.rewriteClosing
      ? await requestWriterText({
          input: waveInput,
          options,
          systemPrompt: CLOSING_WRITER_SYSTEM_PROMPT,
          prompt: buildClosingPrompt(waveInput, sectionMarkdown),
          turnId: `research_closing_writer_${hashText(`${waveInput.runId}:${blueprint.createdAt}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`,
          maxTokens: CLOSING_MAX_TOKENS,
          responseFormat: 'json_object',
          reservation: reservations.at(-1)
        })
      : undefined
    let closing: { lead: string; conclusion: string; limitations: string }
    let closingParseIssue: string | undefined
    if (closingResult) {
      try {
        closing = parseClosingResult(closingResult.text, waveInput, { sectionMarkdown })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/closing writer conclusionSynthesis/u.test(message)) {
          try {
            closing = parseClosingResult(closingResult.text, waveInput, {
              fallbackTechnicalSynthesis: true,
              sectionMarkdown
            })
          } catch (fallbackError) {
            closingParseIssue = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            closing = { lead: '', conclusion: '', limitations: '' }
          }
        } else {
          closingParseIssue = message
          closing = { lead: '', conclusion: '', limitations: '' }
        }
      }
    } else {
      closing = previousClosing(previousMarkdown, waveInput)
    }
    closing = ensurePublishableClosingDepth(
      ensureConcreteClosingLimitations(ensureClosingScopeCoverage(closing, waveInput), sectionMarkdown, blueprint.sections),
      sectionMarkdown,
      waveInput
    )
    const closingRetryUsage: ResearchModelUsageRecord[] = []
    let closingIssue = closingQualityIssue(closing)
    if (!closingIssue) closingParseIssue = undefined
    closingIssue ??= closingParseIssue
    let closingRetryIndex = 0
    const seenClosingFailures = new Set<string>()
    while (closingResult && closingIssue) {
      const failureSignature = closingRepairSignature(closingIssue, closing)
      if (seenClosingFailures.has(failureSignature)) {
        throw new Error(`closing writer entered a repeated repair dead loop: ${closingIssue}`)
      }
      seenClosingFailures.add(failureSignature)
      closingRetryIndex += 1
      const retryResult = await requestWriterText({
        input: waveInput,
        options,
        systemPrompt: CLOSING_WRITER_SYSTEM_PROMPT,
        prompt: buildClosingPrompt(waveInput, sectionMarkdown, closingIssue),
        turnId: `research_closing_writer_retry_${closingRetryIndex}_${hashText(`${waveInput.runId}:${blueprint.createdAt}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`,
        maxTokens: CLOSING_MAX_TOKENS,
        responseFormat: 'json_object'
      })
      closingRetryUsage.push(...retryResult.modelUsage)
      try {
        closing = ensurePublishableClosingDepth(
          ensureConcreteClosingLimitations(
            ensureClosingScopeCoverage(parseClosingResult(retryResult.text, waveInput, { sectionMarkdown }), waveInput),
            sectionMarkdown,
            blueprint.sections
          ),
          sectionMarkdown,
          waveInput
        )
        closingIssue = closingQualityIssue(closing)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/closing writer conclusionSynthesis/u.test(message)) {
          closing = ensurePublishableClosingDepth(
            ensureConcreteClosingLimitations(
              ensureClosingScopeCoverage(
                parseClosingResult(retryResult.text, waveInput, {
                  fallbackTechnicalSynthesis: true,
                  sectionMarkdown
                }),
                waveInput
              ),
              sectionMarkdown,
              blueprint.sections
            ),
            sectionMarkdown,
            waveInput
          )
          closingIssue = closingQualityIssue(closing)
        } else {
          closingIssue = message
        }
      }
    }
    if (closingIssue) throw new Error(closingIssue)
    const reportTitle = resolveResearchReportTitle(waveInput.brief.topic, blueprint.title)
    let markdown: string | undefined
    let finalizationError: unknown
    const sectionSafetyRetries = new Map<string, number>()
    let closingSafetyRetries = 0
    const seenFinalizationFailures = new Set<string>()
    const seenClosingSafetyFailures = new Set<string>()
    while (true) {
      try {
        markdown = finalizeSectionedDraft(
          assembleRawSectionedDraft(reportTitle, closing, sectionMarkdown, waveInput),
          waveInput,
          false,
          new Set(blueprint.sections
            .filter((section) => section.evidenceMode === 'evidence_gap')
            .map((section) => section.title))
        )
        const postCleanupClosingIssue = reportClosingDepthIssue(markdown, waveInput.budget.preset)
        if (postCleanupClosingIssue) {
          throw new Error(`report closing failed after safety cleanup: ${postCleanupClosingIssue}`)
        }
        finalizationError = undefined
        break
      } catch (error) {
        finalizationError = error
        const errorText = error instanceof Error ? error.message : String(error)
        const closingFailure = failureTargetsClosing(error, closing)
        const failureSignature = closingFailure
          ? closingRepairSignature(errorText, closingStateAfterSafetyCleanup(
              reportTitle,
              closing,
              sectionMarkdown,
              waveInput
            ))
          : writerRepairSignature(errorText, `${sectionMarkdown}\n${JSON.stringify(closing)}`)
        if (seenFinalizationFailures.has(failureSignature)) {
          throw new Error(`sectioned synthesis entered a repeated safety-repair dead loop: ${errorMessage(error)}`)
        }
        seenFinalizationFailures.add(failureSignature)
        const depthSectionTitle = depthFailureSectionTitle(error)
        const ownershipSectionTitle = ownershipFailureSectionTitle(error)
        const sectionTitle = depthSectionTitle ?? ownershipSectionTitle
        const languageSection = blueprint.sections.find((candidate) => Boolean(longForeignProseExcerpt(
          generatedSections.get(candidate.id) ?? previousSectionBody(previousMarkdown, candidate.title)
        )))
        const section = blueprint.sections.find((candidate) => candidate.title === sectionTitle) ?? languageSection
        const sectionRetryCount = section ? (sectionSafetyRetries.get(section.id) ?? 0) : 0
        if (section) {
          const nextSectionRetryCount = sectionRetryCount + 1
          sectionSafetyRetries.set(section.id, nextSectionRetryCount)
          const cleanedDraft = prepareSectionedDraft(
            assembleRawSectionedDraft(reportTitle, closing, sectionMarkdown, waveInput),
            waveInput
          )
          const previousBody = previousSectionBody(previousMarkdown, section.title)
          const preservedBody = ownershipSectionTitle
            ? previousBody
            : previousSectionBody(cleanedDraft, section.title)
              || generatedSections.get(section.id)
              || previousBody
          const body = languageSection?.id === section.id
            ? removeLongForeignProseLines(preservedBody)
            : preservedBody
          const repairSection = languageSection?.id === section.id
            ? sectionWithoutLongForeignClaims(section, waveInput)
            : section
          const requiredClaimCount = requiredSectionClaimCount(repairSection)
          const structuredMultiRetry = shouldUseStructuredMultiClaimRetry(
            repairSection,
            waveInput,
            error instanceof Error ? error.message : String(error)
          )
          const rewriteSection = structuredMultiRetry
            || (!ownershipSectionTitle && languageSection?.id !== section.id && shouldRewriteSectionFromScratch(body))
          const retryInput = {
            ...waveInput,
            retryFeedback: [
              error instanceof Error ? error.message : String(error),
              languageSection?.id === section.id
                ? '上一稿包含未翻译的长英文证据句。该句已删除；必须用对应 claim 准确中文转述，再补足机制推理和证据边界：'
                : rewriteSection
                  ? '上一稿在安全清洗后已经不足以作为章节骨架。请重新使用本章全部 claims 写完整章节，不要继承被删除的句子：'
                  : '上一稿在引用、数字和无证据事实安全清洗后论证不足。保留可验证事实，在不新增事实的前提下补足机制推理、比较关系和适用边界：',
              body.slice(0, 2_400)
            ].join('\n')
          }
          const sparseRetry = requiredClaimCount === 1
          const retryResult = await requestWriterText({
            input: retryInput,
            options,
            systemPrompt: sparseRetry
              ? SPARSE_SECTION_RETRY_SYSTEM_PROMPT
              : structuredMultiRetry ? MULTI_CLAIM_SECTION_RETRY_SYSTEM_PROMPT
                : rewriteSection ? SECTION_WRITER_SYSTEM_PROMPT : SECTION_EXTENSION_SYSTEM_PROMPT,
            prompt: sparseRetry
              ? buildSparseSectionRetryPrompt(retryInput, repairSection, body, error instanceof Error ? error.message : String(error))
              : structuredMultiRetry
                ? buildMultiClaimSectionRetryPrompt(retryInput, repairSection, body, error instanceof Error ? error.message : String(error))
              : rewriteSection
                ? buildSectionPrompt(retryInput, repairSection)
              : buildSectionExtensionPrompt(
                  retryInput,
                  repairSection,
                  body,
                  error instanceof Error ? error.message : String(error)
            ),
            turnId: `research_section_writer_safety_retry_${nextSectionRetryCount}_${hashText(`${waveInput.runId}:${section.id}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`,
            maxTokens: SECTION_MAX_TOKENS,
            ...(sparseRetry || structuredMultiRetry ? { responseFormat: 'json_object' as const } : {})
          })
          let repairedBody: string
          if (sparseRetry) {
            const normalized = await normalizeSparseSectionWithRecovery({
              initialResult: retryResult,
              section: repairSection,
              input: retryInput,
              options,
              basePrompt: buildSparseSectionRetryPrompt(
                retryInput,
                repairSection,
                body,
                error instanceof Error ? error.message : String(error)
              ),
              turnIdPrefix: `research_section_writer_safety_sparse_parse_${hashText(`${waveInput.runId}:${section.id}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`
            })
            repairedBody = normalized.body
            targetedRetryUsage.push(...normalized.modelUsage)
          } else if (structuredMultiRetry) {
            const normalized = await normalizeStructuredSectionWithRecovery({
              initialResult: retryResult,
              section: repairSection,
              input: retryInput,
              options,
              basePrompt: buildMultiClaimSectionRetryPrompt(
                retryInput,
                repairSection,
                body,
                error instanceof Error ? error.message : String(error)
              ),
              turnIdPrefix: `research_section_writer_safety_parse_${hashText(`${waveInput.runId}:${section.id}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`
            })
            repairedBody = normalized.body
            targetedRetryUsage.push(...normalized.modelUsage)
          } else {
            repairedBody = normalizeSectionArgumentBody(retryResult.text, repairSection)
          }
          generatedSections.set(section.id, rewriteSection
            ? repairedBody
            : [body, sanitizeSectionExtensionClaimUsage(repairedBody, repairSection, body)].filter(Boolean).join('\n\n'))
          targetedRetryUsage.push(...retryResult.modelUsage)
          sectionMarkdown = renderSectionMarkdown(blueprint.sections, generatedSections, previousMarkdown)
          continue
        }
        if (languageSection) {
          generatedSections.set(
            languageSection.id,
            removeLongForeignProseLines(
              generatedSections.get(languageSection.id) ?? previousSectionBody(previousMarkdown, languageSection.title)
            )
          )
          sectionMarkdown = renderSectionMarkdown(blueprint.sections, generatedSections, previousMarkdown)
          continue
        }
        if (closingFailure) {
          const cleanedDraft = prepareSectionedDraft(
            assembleRawSectionedDraft(reportTitle, closing, sectionMarkdown, waveInput),
            waveInput
          )
          const cleanedClosing = {
            lead: previousMainLead(cleanedDraft),
            conclusion: previousConclusionBody(cleanedDraft),
            limitations: previousSecondLevelBody(cleanedDraft, '局限与不确定性')
          }
          let repairIssue = error instanceof Error ? error.message : String(error)
          while (true) {
            closingSafetyRetries += 1
            const retryResult = await requestWriterText({
              input: waveInput,
              options,
              systemPrompt: CLOSING_WRITER_SYSTEM_PROMPT,
              prompt: buildClosingPrompt(waveInput, sectionMarkdown, [
                repairIssue,
                '上一稿经过引用与事实安全清洗后实际保留下来的收尾如下。只补足缺失的综合与具体证据边界，不要恢复已被删除的无证据事实：',
                JSON.stringify(cleanedClosing)
              ].join('\n')),
              turnId: `research_closing_writer_safety_retry_${closingSafetyRetries}_${hashText(`${waveInput.runId}:${blueprint.createdAt}:${waveInput.revision?.attempt ?? 1}`).slice(0, 10)}`,
              maxTokens: CLOSING_MAX_TOKENS,
              responseFormat: 'json_object'
            })
            closingRetryUsage.push(...retryResult.modelUsage)
            try {
              closing = ensurePublishableClosingDepth(
                ensureConcreteClosingLimitations(
                  ensureClosingScopeCoverage(parseClosingResult(retryResult.text, waveInput, { sectionMarkdown }), waveInput),
                  sectionMarkdown,
                  blueprint.sections
                ),
                sectionMarkdown,
                waveInput
              )
              const retryQualityIssue = closingQualityIssue(closing)
              if (retryQualityIssue) throw new Error(retryQualityIssue)
              break
            } catch (retryError) {
              repairIssue = retryError instanceof Error ? retryError.message : String(retryError)
              const repairSignature = writerRepairSignature(repairIssue, retryResult.text)
              if (seenClosingSafetyFailures.has(repairSignature)) {
                throw new Error(`closing writer entered a repeated safety-repair dead loop: ${repairIssue}`)
              }
              seenClosingSafetyFailures.add(repairSignature)
            }
          }
          continue
        }
        if (failureTargetsClosing(error, closing) && /untranslated evidence excerpt/iu.test(error instanceof Error ? error.message : String(error))) {
          closing = {
            lead: removeLongForeignProseLines(closing.lead),
            conclusion: removeLongForeignProseLines(closing.conclusion),
            limitations: removeLongForeignProseLines(closing.limitations)
          }
          continue
        }
        throw error
      }
    }
    if (!markdown) throw finalizationError ?? new Error('sectioned synthesis finalization failed')
    const usableClaimIds = new Set(usableClaimsForSynthesis(waveInput).map((claim) => claim.id))
    const modelUsage = [
      ...sectionResults.flatMap(({ result }) => result.modelUsage),
      ...targetedRetryUsage,
      ...(closingResult?.modelUsage ?? []),
      ...closingRetryUsage
    ]
    return {
      markdown,
      claimIds: extractUsedClaimIds(markdown, usableClaimIds),
      generatedAt: waveInput.nowIso,
      sectioned: true,
      ...(!waveInput.execution && modelUsage.length > 0 ? { modelUsage } : {})
    }
  } finally {
    waveController.abort(new Error('research writer wave finished'))
    unlinkWave()
    await Promise.all(reservations.map((reservation) =>
      waveInput.execution?.releaseModelCall?.(reservation)
    ))
  }
}

function renderSectionMarkdown(
  sections: ResearchReportBlueprintSection[],
  generatedSections: Map<string, string>,
  previousMarkdown: string
): string {
  return sections.map((section) => [
    `### ${section.title}`,
    '',
    generatedSections.get(section.id) ?? previousSectionBody(previousMarkdown, section.title)
  ].join('\n')).join('\n\n')
}

function assembleRawSectionedDraft(
  reportTitle: string,
  closing: { lead: string; conclusion: string; limitations: string },
  sectionMarkdown: string,
  input: SynthesisWriterInput
): string {
  return [
    `# ${reportTitle}`,
    '',
    '## 主要发现',
    '',
    closing.lead,
    '',
    sectionMarkdown,
    '',
    `## ${synthesisConclusionTitle(input)}`,
    '',
    closing.conclusion,
    '',
    '## 局限与不确定性',
    '',
    closing.limitations
  ].join('\n')
}

export function depthFailureSectionTitle(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error)
  return message.match(
    /model draft section (.+?) (?:is a fact summary|used only|visibly delivered only|omitted required coverage claims|exposed internal synthesis scaffolding|does not cover|uses supporting claims|did not use any assigned context claim|used a context claim|did not connect an assigned context claim)/u
  )?.[1]?.trim()
}

function ownershipFailureSectionTitle(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error)
  return message.match(/blueprint section (.+?) does not use its assigned claims/u)?.[1]?.trim()
}

function failureTargetsClosing(
  error: unknown,
  closing: { lead: string; conclusion: string; limitations: string }
): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (/conclusion|closing|结论|局限|摘要/u.test(message)) return true
  const closingText = `${closing.lead}\n${closing.conclusion}\n${closing.limitations}`
  if (/untranslated evidence excerpt/iu.test(message) && longForeignProseExcerpt(closingText)) return true
  const excerpt = message.match(/excerpt:\s*(.+)$/iu)?.[1]?.trim()
  if (!excerpt) return false
  return closingText.includes(excerpt.slice(0, Math.min(32, excerpt.length)))
}

function closingStateAfterSafetyCleanup(
  reportTitle: string,
  closing: { lead: string; conclusion: string; limitations: string },
  sectionMarkdown: string,
  input: SynthesisWriterInput
): { lead: string; conclusion: string; limitations: string } {
  try {
    const cleaned = prepareSectionedDraft(
      assembleRawSectionedDraft(reportTitle, closing, sectionMarkdown, input),
      input
    )
    return {
      lead: previousMainLead(cleaned),
      conclusion: previousConclusionBody(cleaned),
      limitations: previousSecondLevelBody(cleaned, '局限与不确定性')
    }
  } catch {
    return closing
  }
}

function removeLongForeignProseLines(markdown: string): string {
  return markdown.split('\n')
    .map((line) => splitCitationSentences(line)
      .filter((sentence) => !longForeignProseExcerpt(sentence))
      .join('')
      .trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function sectionWithoutLongForeignClaims(
  section: ResearchReportBlueprintSection,
  input: SynthesisWriterInput
): ResearchReportBlueprintSection {
  const claimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  const filteredClaimIds = section.claimIds.filter((claimId) => {
    const claim = claimById.get(claimId)
    return claim && !longForeignProseExcerpt(claim.text)
  })
  const filteredContextClaimIds = (section.contextClaimIds ?? []).filter((claimId) => {
    const claim = claimById.get(claimId)
    return claim && !longForeignProseExcerpt(claim.text)
  })
  const requiredPrimaryCount = requiredSectionClaimCount(section)
  const safeClaimIds = filteredClaimIds.length >= requiredPrimaryCount
    ? filteredClaimIds
    : section.claimIds
  const safeContextClaimIds = (section.contextClaimIds?.length ?? 0) > 0 && filteredContextClaimIds.length === 0
    ? section.contextClaimIds ?? []
    : filteredContextClaimIds
  if (
    (safeClaimIds.length === 0 || safeClaimIds.length === section.claimIds.length) &&
    safeContextClaimIds.length === (section.contextClaimIds?.length ?? 0)
  ) return section
  const safe = new Set(safeClaimIds)
  return {
    ...section,
    claimIds: safeClaimIds,
    ...(section.contextClaimIds?.length ? { contextClaimIds: safeContextClaimIds } : {}),
    argument: {
      ...section.argument,
      claimIds: section.argument.claimIds.filter((claimId) => safe.has(claimId)),
      counterClaimIds: section.argument.counterClaimIds.filter((claimId) => safe.has(claimId))
    }
  }
}

function closingQualityIssue(closing: { lead: string; conclusion: string; limitations: string }): string | undefined {
  const publishableClosing = sanitizeUncitedDraftSentences([
    '## 结论',
    closing.conclusion,
    '',
    '## 局限与不确定性',
    closing.limitations
  ].join('\n'))
  const publishableConclusion = previousSecondLevelBody(publishableClosing, '结论')
  const conclusionSentences = splitCitationSentences(publishableConclusion)
    .filter((sentence) => sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim().length >= 12)
  const conclusionChars = publishableConclusion.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').replace(/\s+/gu, '').length
  const conclusionClaimIds = conclusionSentences.map((sentence) => sentenceClaimIds(sentence))
  const hasCitedFact = conclusionClaimIds.some((claimIds) => claimIds.length === 1)
  const hasCitedSynthesis = conclusionSentences.some((sentence, index) => {
    const prose = sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim()
    return (conclusionClaimIds[index]?.length ?? 0) >= 2
      && /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))/u.test(prose)
  })
  const hasEvidenceBoundary = conclusionSentences.some((sentence) => isSpecificEvidenceBoundarySentence(sentence))
  const limitationSentences = splitCitationSentences(closing.limitations)
    .filter((sentence) => sentence.trim().length >= 12)
  const malformedSentence = conclusionSentences.find(hasMalformedSynthesisGrammar)
  if (malformedSentence) {
    return `report closing contains malformed synthesis grammar: ${malformedSentence.slice(0, 180)}`
  }
  if (
    conclusionSentences.length >= 3 && conclusionChars >= 80 && limitationSentences.length >= 2 &&
    hasCitedFact && hasCitedSynthesis && hasEvidenceBoundary
  ) return undefined
  return `report closing is incomplete after citation safety cleanup (conclusionChars=${conclusionChars}, conclusionSentences=${conclusionSentences.length}, limitationSentences=${limitationSentences.length}, citedFact=${hasCitedFact}, citedSynthesis=${hasCitedSynthesis}, evidenceBoundary=${hasEvidenceBoundary}); conclusionFact and every conclusionSynthesis sentence must cite allowed claims, while conclusionBoundary must state the evidence boundary without adding technical facts`
}

function closingLeadQualityIssue(
  lead: string,
  input: SynthesisWriterInput,
  allowedClaimIds: ReadonlySet<string>,
  sectionMarkdown: string
): string | undefined {
  const leadSentences = splitCitationSentences(lead)
    .filter((sentence) => sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '').trim().length >= 12)
  if (leadSentences.length < 1 || leadSentences.length > 3) {
    return `closing writer lead must contain one to three substantive sentences, received ${leadSentences.length}`
  }
  const context = [
    input.brief.topic,
    input.frame.coreResearchThread,
    input.frame.centralQuestion,
    ...input.frame.coreQuestions.map((question) => question.text)
  ].join('\n')
  const needsMultiFacetLead = (input.reportBlueprint?.sections ?? []).some((section) =>
    researchDimensionFocusGroups(section.title, context).length > 1
  )
  if (needsMultiFacetLead) {
    const leadClaimIds = new Set(leadSentences.flatMap((sentence) =>
      [...sentence.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
        .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
        .filter((claimId) => allowedClaimIds.has(claimId))
    ))
    if (leadClaimIds.size < 2) {
      return 'closing writer lead for a multi-facet question must use at least two allowed claim ids across the direct answer'
    }
  }
  const sectionSentences = new Set(splitCitationSentences(sectionMarkdown).map(normalizeLeadSentence).filter(Boolean))
  const repeatedSentence = leadSentences.find((sentence) => {
    const normalized = normalizeLeadSentence(sentence)
    return normalized.length >= 20 && sectionSentences.has(normalized)
  })
  if (repeatedSentence) {
    return 'closing writer lead copied a section fact instead of synthesizing the direct answer'
  }
  return undefined
}

export function trimClosingLead(lead: string): string {
  const substantiveSentences = splitCitationSentences(lead)
    .filter((sentence) => sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '').trim().length >= 12)
  return substantiveSentences.length > 3
    ? substantiveSentences.slice(0, 3).join('')
    : lead
}

function normalizeLeadSentence(value: string): string {
  return value
    .replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
    .replace(/[，。；：、,.!！?？`*_#>\s]/gu, '')
    .trim()
}

function ensureConcreteClosingLimitations(
  closing: { lead: string; conclusion: string; limitations: string },
  sectionMarkdown: string,
  sections: ResearchReportBlueprintSection[]
): { lead: string; conclusion: string; limitations: string } {
  const limitationSentences = splitCitationSentences(closing.limitations.replace(/\n+/gu, ''))
    .filter((sentence) => sentence.trim().length >= 12)
  const specificCount = limitationSentences.filter((sentence) => !isGenericClosingLimitation(sentence)).length
  if (specificCount >= 2) return closing
  const candidates = sections.flatMap((section) => splitCitationSentences(
    previousSectionBody(sectionMarkdown, section.title).replace(/\n+/gu, '')
  ))
    .filter((sentence) => /(?:现有证据|当前证据|现有材料|仅(?:支持|覆盖|限于)|未(?:覆盖|说明|验证|讨论)|不足以|无法判断|不能(?:据此)?外推)/u.test(sentence))
    .filter((sentence) => !isGenericClosingLimitation(sentence))
  const additions: string[] = []
  const normalizedExisting = new Set(limitationSentences.map(normalizeLimitationSentence))
  for (const candidate of candidates) {
    const normalized = normalizeLimitationSentence(candidate)
    if (!normalized || normalizedExisting.has(normalized)) continue
    normalizedExisting.add(normalized)
    additions.push(ensureSentenceEnding(candidate))
    if (specificCount + additions.length >= 2) break
  }
  return additions.length > 0
    ? { ...closing, limitations: `${closing.limitations}${additions.join('')}` }
    : closing
}

export function ensurePublishableClosingDepth(
  closing: { lead: string; conclusion: string; limitations: string },
  sectionMarkdown: string,
  input: SynthesisWriterInput
): { lead: string; conclusion: string; limitations: string } {
  const publishable = sanitizeUncitedDraftSentences(`## 结论\n\n${closing.conclusion}`)
  const body = previousSecondLevelBody(publishable, '结论')
  const sentences = splitCitationSentences(body.replace(/\n+/gu, ''))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim().length >= 12)
  const claimIds = (sentence: string) => [...new Set([...sentence.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
    .map((claimId) => claimId.trim())
    .filter(Boolean))]
  const isSynthesis = (sentence: string) => claimIds(sentence).length >= 2
    && /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))/u.test(
      sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '').trim()
    )
  const sectionOwnersByClaimId = new Map<string, Set<string>>()
  for (const section of input.reportBlueprint?.sections ?? []) {
    for (const claimId of section.claimIds) {
      const owners = sectionOwnersByClaimId.get(claimId) ?? new Set<string>()
      owners.add(section.id)
      sectionOwnersByClaimId.set(claimId, owners)
    }
  }
  const evidenceSectionCount = (input.reportBlueprint?.sections ?? []).filter((section) => (
    section.evidenceMode !== 'evidence_gap' && section.claimIds.length > 0
  )).length
  const needsCrossSectionSynthesis = evidenceSectionCount >= 2
  const isCrossSectionSynthesis = (sentence: string) => {
    if (!isSynthesis(sentence)) return false
    if (!needsCrossSectionSynthesis) return true
    const owners = new Set(claimIds(sentence).flatMap((claimId) => [...(sectionOwnersByClaimId.get(claimId) ?? [])]))
    return owners.size >= 2
  }
  const allowedClaimIds = new Set(usableClaimsForSynthesis(input).map((claim) => claim.id))
  const crossSectionSynthesisCandidates = sentences.filter(isCrossSectionSynthesis)
  let fact = sentences.find((sentence) => claimIds(sentence).length >= 1 && !isSynthesis(sentence))
    ?? closingFactFromSections(sectionMarkdown, [...allowedClaimIds])
  let preservedSynthesis: string | undefined
  for (const candidate of crossSectionSynthesisCandidates) {
    const candidateClaimIds = new Set(claimIds(candidate))
    const disjointFact = sentences.find((sentence) => {
      const ids = claimIds(sentence)
      return ids.length >= 1 && !isSynthesis(sentence) && ids.every((claimId) => !candidateClaimIds.has(claimId))
    }) ?? closingFactFromSections(sectionMarkdown, [...allowedClaimIds], [...candidateClaimIds])
    if (!disjointFact) continue
    fact = disjointFact
    preservedSynthesis = candidate
    break
  }
  const factClaimIds = new Set(claimIds(fact ?? ''))
  const isNovelCrossSectionSynthesis = (sentence: string) => isCrossSectionSynthesis(sentence)
    && claimIds(sentence).every((claimId) => !factClaimIds.has(claimId))
  const crossSectionSynthesis = closingSynthesisFromSectionFacts(
    sectionMarkdown,
    input.reportBlueprint?.sections ?? [],
    allowedClaimIds,
    claimIds(fact ?? '')
  ) ?? closingSynthesisFromBlueprintClaims(
    input.reportBlueprint?.sections ?? [],
    allowedClaimIds,
    claimIds(fact ?? '')
  )
  const sectionSynthesis = closingSynthesisFromSections(sectionMarkdown, allowedClaimIds, claimIds(fact ?? ''))
  const synthesis = preservedSynthesis
    ?? sentences.find(isNovelCrossSectionSynthesis)
    ?? crossSectionSynthesis?.sentence
    ?? sentences.find(isCrossSectionSynthesis)
    ?? (!needsCrossSectionSynthesis || (sectionSynthesis?.claimIds ?? []).some((claimId, _index, ids) =>
      ids.some((otherId) => otherId !== claimId && [...(sectionOwnersByClaimId.get(otherId) ?? [])]
        .some((owner) => !(sectionOwnersByClaimId.get(claimId) ?? new Set()).has(owner)))
    ) ? sectionSynthesis?.sentence : undefined)
  const boundary = sentences.find((sentence) => (
    sentence !== fact && sentence !== synthesis && isSpecificEvidenceBoundarySentence(sentence)
  )) ?? ensureSentenceEnding(safeClosingBoundary('', closing.limitations, sectionMarkdown, input))
  if (!fact || !synthesis || !boundary) return { ...closing, conclusion: body || closing.conclusion }

  const selected = new Set([fact, synthesis, boundary])
  const synthesisClaimIds = new Set(claimIds(synthesis))
  const remaining = sentences.filter((sentence) => (
    !selected.has(sentence)
    && (!isSynthesis(sentence) || isNovelCrossSectionSynthesis(sentence))
    && !(
      !isSynthesis(sentence)
      && claimIds(sentence).length >= 1
      && claimIds(sentence).every((claimId) => synthesisClaimIds.has(claimId))
    )
  ))
  const rebuilt = [fact, synthesis, boundary, ...remaining].map(ensureSentenceEnding).join('')
  const cleanedRebuilt = previousSecondLevelBody(
    sanitizeUncitedDraftSentences(`## 结论\n\n${rebuilt}`),
    '结论'
  )
  const cleanedSentences = splitCitationSentences(cleanedRebuilt)
    .filter((sentence) => sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim().length >= 12)
  const cleanedHasBoundary = cleanedSentences.some(isSpecificEvidenceBoundarySentence)
  if (cleanedSentences.length < 3 || !cleanedHasBoundary) {
    const safeRemaining = remaining.filter((sentence) => !isSpecificEvidenceBoundarySentence(sentence))
    return {
      ...closing,
      conclusion: [fact, synthesis, substantiveFallbackClosingBoundary(), ...safeRemaining]
        .map(ensureSentenceEnding)
        .join('')
    }
  }
  return {
    ...closing,
    conclusion: rebuilt
  }
}

function isGenericClosingLimitation(sentence: string): boolean {
  return /^(?:本报告仅覆盖本次收集|不同来源的定义、统计口径和更新时间可能不一致|现有证据不足以覆盖所有相关对象、场景和反例)/u.test(
    sentence.replace(/\[(?:claim|evidence):[^\]]+\]/gu, '').trim()
  )
}

function normalizeLimitationSentence(sentence: string): string {
  return sentence
    .replace(/\[(?:claim|evidence):[^\]]+\]/gu, '')
    .replace(/[，。；：、,.!！?？`*_#>\s]/gu, '')
    .trim()
}

function sectionBodyDepthIssue(
  body: string,
  section: ResearchReportBlueprintSection,
  minimumChars: number,
  input: SynthesisWriterInput
): string | undefined {
  const malformedSynthesis = splitCitationSentences(body.replace(/\n+/gu, ''))
    .find(hasMalformedSynthesisGrammar)
  if (malformedSynthesis) {
    return `model draft section ${section.title} contains malformed synthesis grammar: ${malformedSynthesis.slice(0, 180)}`
  }
  const overlongSynthesis = splitCitationSentences(body.replace(/\n+/gu, ''))
    .find((sentence) => {
      const prose = sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim()
      return prose.length > 240 && /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))/u.test(prose)
    })
  if (overlongSynthesis) {
    return `model draft section ${section.title} contains an overlong synthesis sentence (${overlongSynthesis.length} chars); split the evidence facts from a concise local conclusion`
  }
  const signals = reportArgumentSignals(body)
  const allUsedClaimIds = new Set([...body.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter((claimId): claimId is string => Boolean(claimId)))
  const usedClaimIds = new Set([...allUsedClaimIds].filter((claimId) => section.claimIds.includes(claimId)))
  const usedContextClaimIds = new Set([...allUsedClaimIds].filter((claimId) => section.contextClaimIds?.includes(claimId)))
  const evidenceCount = usedClaimIds.size + usedContextClaimIds.size
  const requiredClaimCount = requiredSectionClaimCount(section)
  const usedEvidenceClaimIds = isConditionalApplicationSection(section) ? usedContextClaimIds : usedClaimIds
  const assignedEvidenceClaimIds = sectionEvidenceClaimIds(section)
  const unsafeStructuredSynthesis = splitCitationSentences(body.replace(/\n+/gu, ''))
    .find((sentence) => {
      const structuredClaimIds = [...sentence.matchAll(/\[structured-claim:([^\]]+)\]/gu)]
        .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
        .filter(Boolean)
      return new Set(structuredClaimIds).size >= 2
        && hasUnsafeStructuredSynthesis(sentence)
        && !structuredSynthesisRiskSupported(sentence, input)
    })
  const synthesisScaffold = splitCitationSentences(body.replace(/\n+/gu, ''))
    .find(hasInternalSynthesisScaffold)
  if (synthesisScaffold) {
    return `model draft section ${section.title} exposed internal synthesis scaffolding instead of substantive analysis: ${synthesisScaffold}`
  }
  if (unsafeStructuredSynthesis) {
    return `model draft section ${section.title} introduced unsupported synthesis after structured claim binding: ${unsafeStructuredSynthesis}`
  }
  if (usedEvidenceClaimIds.size < requiredClaimCount) {
    return `model draft section ${section.title} used only ${usedEvidenceClaimIds.size} of ${assignedEvidenceClaimIds.length} assigned claims; it must use at least ${requiredClaimCount} distinct assigned claims so one fact cannot stand in for the whole section`
  }
  const requiredVisibleFactCount = minimumVisibleFactCount(section)
  const visibleFactClaimIds = sectionVisibleFactClaimIds(body, section, input)
  const missingCoverageClaimIds = (section.coverageClaimIds ?? [])
    .filter((claimId) => !visibleFactClaimIds.has(claimId))
  if (missingCoverageClaimIds.length > 0) {
    return `model draft section ${section.title} omitted required coverage claims ${missingCoverageClaimIds.join(', ')}; each hard-scope representative must appear as its own cited fact sentence`
  }
  if (visibleFactClaimIds.size < requiredVisibleFactCount) {
    return `model draft section ${section.title} visibly delivered only ${visibleFactClaimIds.size} independent cited facts; it must state at least ${requiredVisibleFactCount} assigned claims in separate fact sentences before synthesizing them`
  }
  const contextIssue = sectionContextClaimUsageIssue(body, section, input)
  if (contextIssue) return contextIssue
  const focusIssue = sectionClaimFocusIssue(
    section,
    new Set([...usedClaimIds, ...usedContextClaimIds]),
    input,
    body
  )
  if (focusIssue) return focusIssue
  if (reportArgumentMeetsDepth({
    markdown: body,
    minimumChars,
    evidenceCount,
    allowDirectComparison: sectionAllowsDirectComparison(section, input),
    allowTerseArgument: false
  })) {
    return undefined
  }
  return `model draft section ${section.title} is a fact summary, not a complete argument (chars=${signals.chars}, requiredChars=${minimumChars}, sentences=${signals.sentences}, paragraphs=${signals.paragraphs}, synthesis=${signals.hasSynthesis}, evidenceBoundary=${signals.hasEvidenceBoundary})`
}

function minimumSectionChars(section: ResearchReportBlueprintSection): number {
  const requiredEvidenceCount = isConditionalApplicationSection(section)
    ? requiredConditionalContextClaimCount(section)
    : requiredSectionClaimCount(section)
  return minimumReportArgumentChars(requiredEvidenceCount, section.evidenceMode)
}

function minimumVisibleFactCount(section: ResearchReportBlueprintSection): number {
  if (isConditionalApplicationSection(section)) return requiredConditionalContextClaimCount(section)
  return requiredSectionClaimCount(section)
}

export function shouldUseStructuredMultiClaimRetry(
  section: ResearchReportBlueprintSection,
  input: SynthesisWriterInput,
  issue: string
): boolean {
  if (sectionRetryClaims(section, input).length < 2) return false
  return requiredSectionClaimCount(section) >= 2
    || minimumVisibleFactCount(section) >= 3
    || isContextualReportSection(section.title)
    || /used only|fact summary|complete argument|visibly delivered|independent cited facts|explicit title facet|mapped claim sentences/iu.test(issue)
}

export function sectionVisibleFactClaimIds(
  body: string,
  section: ResearchReportBlueprintSection,
  input?: SynthesisWriterInput
): Set<string> {
  const assigned = new Set(sectionEvidenceClaimIds(section))
  const claimById = new Map((input ? usableClaimsForSynthesis(input) : []).map((claim) => [claim.id, claim]))
  const visible = new Set<string>()
  for (const sentence of splitCitationSentences(body.replace(/\n+/gu, ''))) {
    const prose = sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '').trim()
    const allClaimIds = [...new Set(sentenceClaimIds(sentence))]
    if (allClaimIds.length !== 1) continue
    const claimIds = allClaimIds.filter((claimId) => assigned.has(claimId))
    if (claimIds.length !== 1) continue
    if (/^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))/u.test(prose)) {
      const claim = claimById.get(claimIds[0]!)
      if (!claim || !assessClaimFaithfulness(prose, [claim.text]).faithful) continue
    }
    visible.add(claimIds[0]!)
  }
  return visible
}

export function shouldRewriteSectionFromScratch(body: string): boolean {
  const signals = reportArgumentSignals(body)
  return signals.chars < 120 || signals.sentences < 3
    || splitCitationSentences(body.replace(/\n+/gu, '')).some(hasInternalSynthesisScaffold)
}

function sectionRevisionPlan(
  input: SynthesisWriterInput,
  sections: ResearchReportBlueprintSection[]
): { sectionIds: Set<string>; rewriteClosing: boolean } {
  if (!input.revision?.previousDraftMarkdown) {
    return { sectionIds: new Set(sections.map((section) => section.id)), rewriteClosing: true }
  }
  if (input.revision.targets) {
    const allowedSectionIds = new Set(sections.map((section) => section.id))
    return {
      sectionIds: new Set(input.revision.targets.sectionIds.filter((sectionId) => allowedSectionIds.has(sectionId))),
      rewriteClosing: input.revision.targets.rewriteClosing
    }
  }
  const feedback = [
    ...input.revision.previousVerdict.blockingIssues,
    ...input.revision.previousVerdict.warnings,
    ...input.revision.previousVerdict.recommendedFixes
  ].filter((item) => !/(?:LLM Judge )?(?:总分|写作与结论质量评分).{0,24}(?:低于|阈值|通过线)/iu.test(item))
  const normalizedFeedback = normalizeRevisionFeedback(feedback.join('\n'))
  const rewriteEverySection = /(?:所有|全部|各个?|每个).{0,8}(?:核心)?章节/u.test(normalizedFeedback)
    || /核心章节.{0,24}(?:缺少|缺乏|不足|浅|简略|摘要)/u.test(normalizedFeedback)
  const explicitlyTargetedSections = sections.filter((section) =>
    feedback.some((item) => feedbackTargetsSection(item, section.title))
  )
  const sectionIds = new Set((explicitlyTargetedSections.length > 0 && !rewriteEverySection
    ? explicitlyTargetedSections
    : sections.filter((section) => !previousSectionBody(input.revision!.previousDraftMarkdown ?? '', section.title)
      || rewriteEverySection
      || (/场景分析.{0,24}(?:浅|简略|不足|缺少|缺乏)/u.test(normalizedFeedback) && /场景/u.test(section.title))))
    .map((section) => section.id))
  const rewriteClosing = feedback.some((item) => feedbackTargetsClosing(item, input.revision!.previousDraftMarkdown ?? ''))
  if (sectionIds.size === 0 && !rewriteClosing) {
    return { sectionIds: new Set(sections.map((section) => section.id)), rewriteClosing: true }
  }
  return { sectionIds, rewriteClosing }
}

function feedbackTargetsSection(feedback: string, title: string): boolean {
  const normalizedFeedback = normalizeRevisionFeedback(feedback)
  const normalizedTitle = normalizeRevisionFeedback(title)
  return normalizedFeedback.includes(`「${normalizedTitle}」`)
    || normalizedFeedback.includes(`'${normalizedTitle}'`)
    || normalizedFeedback.includes(`"${normalizedTitle}"`)
    || normalizedFeedback.includes(`\`${normalizedTitle}\``)
    || normalizedFeedback.includes(`${normalizedTitle}章节`)
    || normalizedFeedback.includes(`章节${normalizedTitle}`)
    || normalizedFeedback.includes(`${normalizedTitle}中`)
    || normalizedFeedback.startsWith(`${normalizedTitle}：`)
}

function normalizeRevisionFeedback(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').trim()
}

function feedbackTargetsClosing(feedback: string, previousMarkdown: string): boolean {
  const normalizedFeedback = normalizeRevisionFeedback(feedback)
  if (/(?:摘要|全文主线|全文结论|最终结论|报告结论|结论章节|结论部分|结论中|结论未|结论只|结论直接|收尾|局限与不确定性|局限章节|核心问题回答)/u.test(normalizedFeedback)) {
    return true
  }
  const previousConclusion = normalizeRevisionFeedback(previousConclusionBody(previousMarkdown))
  if (!previousConclusion) return false
  return previousConclusion
    .split(/[。！？!?；;]/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12)
    .some((sentence) => normalizedFeedback.includes(sentence.slice(0, Math.min(24, sentence.length))))
}

function previousClosing(markdown: string, input: SynthesisWriterInput): { lead: string; conclusion: string; limitations: string } {
  const closing = {
    lead: previousMainLead(markdown),
    conclusion: previousConclusionBody(markdown),
    limitations: previousSecondLevelBody(markdown, '局限与不确定性')
  }
  if (!closing.conclusion || !closing.limitations) {
    throw new Error('section revision cannot reuse missing report closing sections')
  }
  return ensureClosingScopeCoverage(closing, input)
}

function previousMainLead(markdown: string): string {
  const body = previousSecondLevelBody(markdown, '主要发现')
  const firstSubsection = body.search(/^###\s+/mu)
  return (firstSubsection < 0 ? body : body.slice(0, firstSubsection)).trim()
}

function previousSecondLevelBody(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${title}`)
  if (start < 0) return ''
  const next = lines.slice(start + 1).findIndex((line) => /^##\s+/u.test(line.trim()))
  return lines.slice(start + 1, next < 0 ? lines.length : start + 1 + next).join('\n').trim()
}

function conclusionSectionTitle(markdown: string): '结论' | '结论与建议' {
  return markdown.split('\n').some((line) => line.trim() === '## 结论与建议')
    ? '结论与建议'
    : '结论'
}

function previousConclusionBody(markdown: string): string {
  return previousSecondLevelBody(markdown, conclusionSectionTitle(markdown))
}

async function reserveWriterWave(
  input: SynthesisWriterInput,
  estimates: number[]
): Promise<ResearchModelCallReservation[]> {
  const execution = input.execution
  if (!execution) return []
  const totalEstimate = estimates.reduce((sum, estimate) => sum + estimate, 0)
  if (execution.remainingModelCalls('writer') < estimates.length) {
    throw new Error(`research_model_call_budget_exhausted: 完整写作波次需要 ${estimates.length} 次调用，但只剩 ${execution.remainingModelCalls('writer')} 次。`)
  }
  if (execution.remainingTokenBudget('writer') < totalEstimate) {
    throw new Error(`research_token_budget_exhausted: 完整写作波次预计需要 ${totalEstimate} tokens，但只剩 ${execution.remainingTokenBudget('writer')} tokens。`)
  }
  const reservations: ResearchModelCallReservation[] = []
  try {
    for (const estimate of estimates) reservations.push(execution.reserveModelCall('writer', estimate))
    return reservations
  } catch (error) {
    await Promise.all(reservations.map((reservation) => execution.releaseModelCall?.(reservation)))
    throw error
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onError: (error: unknown) => void
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  let firstError: unknown
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (firstError === undefined) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      try {
        results[index] = await worker(items[index]!, index)
      } catch (error) {
        if (firstError === undefined) {
          firstError = error
          onError(error)
        }
      }
    }
  })
  await Promise.allSettled(runners)
  if (firstError !== undefined) throw firstError
  return results
}

export function renderEvidenceGapSection(section: ResearchReportBlueprintSection): string {
  const firstParagraph = `现有可引用材料不足以直接回答“${section.title}”，因此无法形成可靠结论。`
  const secondParagraph = `现有材料没有覆盖回答“${section.title}”所需的直接事实与适用范围，不能用相关背景、单一案例或时间范围不匹配的数据替代，也不能据此外推该章所属对象的总体方向。`
  return `${firstParagraph}\n\n${secondParagraph}`
}

function inputWithUsableBlueprint(input: SynthesisWriterInput): SynthesisWriterInput {
  const blueprint = input.reportBlueprint
  if (!blueprint) return input
  const usableClaimIds = new Set(usableClaimsForSynthesis(input).map((claim) => claim.id))
  return {
    ...input,
    reportBlueprint: {
      ...blueprint,
      directAnswer: sanitizeBlueprintProse(blueprint.directAnswer),
      thesis: sanitizeBlueprintProse(blueprint.thesis),
      sections: blueprint.sections.map((section) => ({
        ...section,
        purpose: sanitizeBlueprintProse(section.purpose),
        claimIds: section.claimIds.filter((claimId) => usableClaimIds.has(claimId)),
        ...(section.coverageClaimIds?.length ? {
          coverageClaimIds: section.coverageClaimIds.filter((claimId) => usableClaimIds.has(claimId))
        } : {}),
        ...(section.contextClaimIds?.length ? {
          contextClaimIds: section.contextClaimIds.filter((claimId) => usableClaimIds.has(claimId))
        } : {}),
        argument: {
          ...section.argument,
          conclusion: sanitizeBlueprintProse(section.argument.conclusion),
          inference: sanitizeBlueprintProse(section.argument.inference),
          conditions: section.argument.conditions.map(sanitizeBlueprintProse),
          claimIds: section.argument.claimIds.filter((claimId) => usableClaimIds.has(claimId)),
          counterClaimIds: section.argument.counterClaimIds.filter((claimId) => usableClaimIds.has(claimId))
        },
        limitations: section.limitations.map(sanitizeBlueprintProse)
      }))
    }
  }
}

function sanitizeBlueprintProse(value: string): string {
  return value
    .replace(RAW_INTERNAL_RESEARCH_ID, '相关证据')
    .replace(/相关证据(?:和|、)相关证据/gu, '相关证据')
    .replace(/\s+/gu, ' ')
    .trim()
}

function buildSectionPrompt(input: SynthesisWriterInput, section: ResearchReportBlueprintSection): string {
  const usableById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  const availablePrimaryClaims = section.claimIds
    .map((claimId) => usableById.get(claimId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
  const primaryClaims = selectSectionPromptClaims(section, availablePrimaryClaims, input)
  const conditionalApplication = isConditionalApplicationSection(section)
  const requiredPrimaryClaimCount = requiredSectionClaimCount(section)
  const contextClaims = selectSceneContextClaims(section, input)
  const requiresContextSynthesis = sceneRequiresConcreteContextSynthesis(section, input)
    && contextClaims.length > 0
  const claims = uniqueClaims([...primaryClaims, ...contextClaims])
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const evidence = claims.flatMap((claim) => claim.supportSpanIds.map((spanId) => spanById.get(spanId)))
    .filter((span): span is NonNullable<typeof span> => Boolean(span))
    .filter((span) => canCiteEvidenceSpan(span, sourceById.get(span.sourceId)))
    .slice(0, 10)
    .map((span) => ({
      id: span.id,
      sourceTitle: sourceById.get(span.sourceId)?.title,
      sourceReliability: sourceById.get(span.sourceId)?.reliability,
      text: cleanEvidenceTextForPrompt(projectComparisonEvidenceText(
        span.text,
        input.frame.alternativesToCompare ?? []
      ))
    }))
  const facetClaimMap = sectionFacetClaimMap(section, claims, input)
  const revisionContext = sectionRevisionContext(input, section)
  const localRetryFeedback = input.retryFeedback?.trim()
  const sparseEvidenceSection = !conditionalApplication && primaryClaims.length === 1
  return [
    `报告主题：${input.brief.topic}`,
    `核心问题：${input.frame.centralQuestion}`,
    `全文主线：${input.frame.coreResearchThread}`,
    '',
    '本章蓝图：',
    JSON.stringify({
      title: section.title,
      purpose: section.purpose,
      argument: section.argument,
      limitations: section.limitations
    }, null, 2),
    '',
    '本章主 Claim：',
    JSON.stringify(primaryClaims.map((claim) => ({
      id: claim.id,
      text: comparisonClaimTextForPrompt(claim.text, input),
      sourceIdentityQualifiers: sourceIdentityQualifiersForClaim(claim, input),
      claimType: claim.claimType,
      confidence: claim.confidence
    })), null, 2),
    ...(contextClaims.length > 0 ? [
      '',
      conditionalApplication
        ? '条件化应用的机制前提 Claim（本章没有足够场景直证；先准确陈述前提，再作条件判断）：'
        : '必要主线前提 Claim（最多三条；只用于把本章场景事实连接到中央问题，不能重复展开其原章节）：',
      JSON.stringify(contextClaims.map((claim) => ({
        id: claim.id,
        text: comparisonClaimTextForPrompt(claim.text, input),
        sourceIdentityQualifiers: sourceIdentityQualifiersForClaim(claim, input),
        claimType: claim.claimType,
        confidence: claim.confidence
      })), null, 2)
    ] : []),
    ...(facetClaimMap.length > 1 ? [
      '',
      '标题分面证据映射：',
      JSON.stringify(facetClaimMap, null, 2)
    ] : []),
    '',
    '本章证据：',
    JSON.stringify(evidence, null, 2),
    ...(revisionContext ? [
      '',
      '上一轮本章正文与质量反馈：',
      JSON.stringify(revisionContext, null, 2)
    ] : []),
    ...(localRetryFeedback ? [
      '',
      '本地质量校验反馈：',
      localRetryFeedback
    ] : []),
    '',
    '写作规则：',
    conditionalApplication
      ? '- 只输出本章正文；standard/deep 写 280-650 个中文字符、至少两段和四个完整句子：先准确陈述至少两条机制前提，再把它们写成回答本章场景的条件判断，最后明确没有场景直证的边界。'
      : sparseEvidenceSection
      ? '- 只输出本章正文；本章只有一条合格 claim，写 180-350 个中文字符、至少两段和三个完整句子：一条引用事实，以及一个紧扣该事实前提的受限推理和具体证据边界。不得为凑长度制造第二条事实。'
      : primaryClaims.length >= 4
        ? '- 只输出本章正文；standard/deep 写 450-800 个中文字符、至少三段和五个完整句子：先给局部结论与事实，再解释证据关系，最后写综合判断和具体边界；每段必须增加新信息或新推理。'
        : primaryClaims.length === 3
          ? '- 只输出本章正文；standard/deep 写 380-700 个中文字符、至少三段和五个完整句子：先给局部结论与三条独立事实，再解释证据关系、综合判断和具体边界；每段必须增加新信息或新推理。'
          : '- 只输出本章正文；standard/deep 写 320-650 个中文字符、至少两段和四个完整句子：先给局部结论与事实，再解释证据关系、综合判断和具体边界；每段必须增加新信息或新推理。',
    '- 报告要求中文时，必须把英文证据准确转述为中文；只保留输入证据中确有必要的技术标识，禁止整句复制英文原文。',
    conditionalApplication
      ? `- 第一段至少使用 ${requiredPrimaryClaimCount} 条不同的机制前提 Claim；每条事实独立成句并在句末放 [claim:claim_id]，不得把它们表述成该场景已经实测的结果。`
      : sparseEvidenceSection
      ? '- 第一段先给谨慎的局部结论并使用唯一 claim；事实句末放 [claim:claim_id]，后续推理不得新增技术事实。'
      : `- 第一段先给明确局部结论，再用至少 ${requiredPrimaryClaimCount} 条不同的本章主 Claim 展开；每个事实句在句末放 [claim:claim_id]。`,
    '- 第二段解释证据到结论的机制、差异或权衡，不得增加新事实；使用自然过渡，禁止反复套用“基于上述证据”“上述证据共同表明”。',
    ...(claims.length >= 2
      ? ['- 本章至少写一个以“因此”“区别在于”“关键在于”或“由此判断”开头的独立综合句，并在句末同时绑定至少两个本章 claim id；综合句只概括这些 claims 共同支持或仍不能支持的判断，不得用分号把未单独引用的事实分句拼在前面。']
      : []),
    ...(contextClaims.length > 0
      ? [conditionalApplication
          ? '- 本章属于条件化应用：必须另写一个以“因此”“由此判断”或“关键在于”开头的综合句，同时绑定至少两条机制前提 claim，并写成“如果/若…则…”；必须点名本章场景，但不能声称来源直接研究了该场景，不能增加性能收益、实践建议或实现细节。'
          : requiresContextSynthesis
          ? '- 本章直接场景证据较少，必须至少选择一条跨章前提，并与本章主 Claim 在同一个综合句中写成“如果/若…则…”的条件判断；必须明确点名该前提中的独特概念，只能组合 claims 已经陈述的条件与结果，禁止增加数字、例子、性能收益、最佳实践或绝对保证。'
          : '- 跨章前提是可选参考，不参与本章主证据覆盖判定；使用时必须与本章主 Claim 同句，写成“如果/若…则…”的条件判断或明确的共同边界，只能组合 claims 已经陈述的条件与结果，禁止增加数字、例子、性能收益、最佳实践或绝对保证。']
      : []),
    ...(facetClaimMap.length > 1
      ? ['- 标题包含多个明确分面；每个“标题分面证据映射”项目都必须在用户可见正文中明确出现，并至少使用该项目列出的一个 claim id，不能只写其中一侧。']
      : []),
    '- 第二段必须明确写出本章 claims 实际覆盖的对象和条件，以及这如何限制本章结论；只有输入 claims 或 limitations 明确写出某个未覆盖项时才能点名它，不得自行补一份技术检查清单。禁止写“上述事实只能支持局部判断”“本章已经引用的对象和条件”“其他实现和场景是否相同”这类空泛模板。',
    '- 推理句要用“因此”“这意味着”“关键在于”“区别在于”等自然因果或比较连接词明确标识，不要把推论伪装成新的事实句。',
    '- 只有蓝图确有反面证据、局部挑战或会改变结论的限制时才说明其影响；普通来源声明统一留给全文局限，不要每章重复。',
    '- 带 claim 的句子只陈述该 claim 明确支持的事实；影响、原因和推论必须另起一句，不能把新推论塞进同一个引用句。',
    '- 任何包含协议名、配置项、英文技术 token、客户端/服务器动作或具体例子的句子都属于事实句，必须绑定直接支持它的 claim；无引用推理句只能解释已引用证据之间的逻辑关系、取舍和证据边界。',
    '- 如果本章证据只能支持谨慎结论，要直接承认证据缺口，不能用常识补齐。',
    '- 如果证据不能解释用户要求的原因或根源，必须明确写“现有证据不足以解释该根源”，不能跳过这个问题。',
    '- 证据边界只能命名本章标题和本章主 Claim 中已经出现的对象或概念；不得把其他章节的概念作为本章未覆盖清单再次展开。',
    '- 不要重复全文结论，不要写内部字段名、来源清单或模型资料卡免责声明。',
    ...(revisionContext ? ['- 这是质量修订：保留上一稿已正确的证据和边界，只扩展反馈指出的推理、比较或覆盖缺口，不得把本章压缩得更短。'] : []),
    ...(localRetryFeedback ? ['- 上一稿被本地校验拒绝；必须针对反馈补足段落和论证，不得改成整篇摘要。'] : [])
  ].join('\n')
}

function buildSparseSectionRetryPrompt(
  input: SynthesisWriterInput,
  section: ResearchReportBlueprintSection,
  survivingBody: string,
  issue: string
): string {
  const claim = sparseSectionClaim(section, input)
  const requiredNumbers = claim ? numericTokens(claim.text) : []
  return [
    buildSectionPrompt({ ...input, retryFeedback: undefined }, section),
    '',
    '本次是单证据章节的结构化事实翻译。只返回以下 JSON，不要 Markdown 标题或代码块：',
    '{"fact":"只准确转述唯一 claim 已明确陈述的事实"}',
    `本地质量校验反馈：${issue}`,
    ...(survivingBody ? ['上一稿仅供核对事实翻译，不得复制其中的推理或边界：', survivingBody.slice(0, 1_600)] : []),
    ...(requiredNumbers.length > 0 ? [
      `原始 claim 必须逐项保留的数字 token：${JSON.stringify(requiredNumbers)}`,
      '这些数字必须以原值出现在 fact 中；不得换算金额单位、四舍五入、缩写、合计、推导或新增数字。'
    ] : []),
    'fact 必须是一个完整中文事实句，不得使用句号或分号拆成多个句子。不得解释 claim 之外的原因，不得添加原始证据中没有出现的配置项、机制、效果、例子或建议；局部推理和证据边界将由程序生成。'
  ].join('\n')
}

export function normalizeSparseSectionRetry(
  text: string,
  section: ResearchReportBlueprintSection,
  input: SynthesisWriterInput
): string {
  const objectText = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let value: Record<string, unknown>
  try {
    value = JSON.parse(objectText) as Record<string, unknown>
  } catch (error) {
    const fallback = normalizeSectionArgumentBody(text, section)
    if (boundClaimIds(fallback).some((claimId) => section.claimIds.includes(claimId))) return fallback
    throw new Error(`sparse section structured retry returned malformed JSON without its assigned claim: ${errorMessage(error)}; response=${diagnosticModelText(text)}`)
  }
  const fact = normalizeSparseTranslatedFact(stringValue(value.fact))
  const claim = sparseSectionClaim(section, input)
  if (!fact || !claim) {
    throw new Error(`sparse section structured retry omitted its translated fact; response=${diagnosticModelText(text)}`)
  }
  const factIssue = sparseTranslatedFactIssue(fact, claim, input)
  if (factIssue) {
    throw new Error(`sparse section translated fact failed publication validation: ${factIssue}; response=${diagnosticModelText(text)}`)
  }
  const citedFact = `${fact.replace(/[。！？.!?；;]+$/u, '').trim()} [structured-claim:${claim.id}]`
  return normalizeSectionArgumentBody([
    ensureSentenceEnding(citedFact),
    '',
    deterministicSparseSectionConclusion(section, claim.id)
  ].join('\n'), section)
}

function sparseSectionClaim(
  section: ResearchReportBlueprintSection,
  input: SynthesisWriterInput
): ReturnType<typeof usableClaimsForSynthesis>[number] | undefined {
  const claimId = sectionEvidenceClaimIds(section)[0] ?? section.claimIds[0]
  if (!claimId) return undefined
  return usableClaimsForSynthesis(input).find((claim) => claim.id === claimId)
    ?? input.claims.find((claim) => claim.id === claimId)
}

function normalizeSparseTranslatedFact(value: string): string {
  return value
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .replace(/^(?:(?:现有|当前|本章)(?:证据|材料)|证据)(?:清楚)?(?:表明|说明|显示|指出|支持)?[：:,，]?\s*/u, '')
    .replace(/[。！？；;]+/gu, '，')
    .replace(/[，,]\s*[，,]+/gu, '，')
    .replace(/[，,]\s*$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

function sparseTranslatedFactIssue(
  fact: string,
  claim: ReturnType<typeof usableClaimsForSynthesis>[number],
  input: SynthesisWriterInput
): string | undefined {
  const chineseReport = /中文|Chinese/iu.test(`${input.brief.outputFormat}\n${input.brief.userIntent}`)
  if (chineseReport && !/[\u4e00-\u9fff]/u.test(fact)) {
    return 'fact is not a Chinese translation'
  }
  if (longForeignProseExcerpt(fact)) {
    return 'fact still contains an untranslated or truncated foreign-language fragment'
  }
  if (isExtractionCorruptionText(fact)) {
    return 'fact is not a complete publishable sentence'
  }
  if (fact.replace(/\s+/gu, '').length < 12) {
    return 'fact is too short to preserve the assigned claim'
  }
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const cleanedClaimText = cleanClaimForPrompt(claim.text)
  const supportTexts = [
    cleanedClaimText,
    ...claim.supportSpanIds.map((spanId) => spanById.get(spanId)?.text ?? '').filter(Boolean)
  ]
  const equivalentAmounts = equivalentCrossLanguageMonetaryTokens(cleanedClaimText, fact)
  const unsupportedNumbers = unsupportedTranslatedNumericTokens(fact, supportTexts)
  if (unsupportedNumbers.length > 0) {
    return `fact introduced or converted numeric tokens ${unsupportedNumbers.join(', ')}`
  }
  const requiredNumbers = new Set(numericTokens(cleanedClaimText))
  const actualNumbers = new Set(numericTokens(fact))
  const missingNumbers = [...requiredNumbers].filter((token) => (
    !actualNumbers.has(token) && !equivalentAmounts.sourceTokens.has(token)
  ))
  if (missingNumbers.length > 0) {
    return `fact omitted or changed required numeric tokens ${missingNumbers.join(', ')}`
  }
  const missingIdentityQualifiers = sourceIdentityQualifiersForClaim(claim, input)
    .filter((qualifier) => !fact.toLowerCase().includes(qualifier.toLowerCase()))
  if (missingIdentityQualifiers.length > 0) {
    return `fact omitted source identity qualifiers ${missingIdentityQualifiers.join(', ')}`
  }
  if (hasInternalSynthesisScaffold(fact)) {
    return 'fact exposed internal synthesis scaffolding'
  }
  return undefined
}

export function sourceIdentityQualifiersForClaim(
  claim: ReturnType<typeof usableClaimsForSynthesis>[number],
  input: SynthesisWriterInput
): string[] {
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const nonIdentityLabels = new Set(['PDF', 'HTML', 'XML', 'DOC', 'DOCX', 'XLS', 'XLSX', 'CSV'])
  return [...new Set(claim.supportSpanIds.flatMap((spanId) => {
    const sourceTitle = sourceById.get(spanById.get(spanId)?.sourceId ?? '')?.title ?? ''
    return [...sourceTitle.matchAll(/[（(]([A-Z][A-Z0-9.-]{1,9})[)）]/gu)]
      .map((match) => match[1] ?? '')
      .filter((qualifier) => qualifier && !nonIdentityLabels.has(qualifier))
  }))]
}

function deterministicSparseSectionConclusion(section: ResearchReportBlueprintSection, claimId: string): string {
  const title = sanitizeBlueprintProse(section.title)
  return `由此判断，“${title}”当前能够确认的是上述事实及其明确限定的对象、时间与条件，不能把这一局部结果解释为材料之外的普遍规律 [structured-claim:${claimId}]。现有材料没有验证同一范围之外的对象、时期或情形，也不能支持额外的因果机制与效果，因此相关结论不能据此外推。`
}

function buildMultiClaimSectionRetryPrompt(
  input: SynthesisWriterInput,
  section: ResearchReportBlueprintSection,
  survivingBody: string,
  issue: string
): string {
  const selectedClaims = sectionRetryClaims(section, input)
  const contextClaims = sectionRetryContextClaims(section, input)
  const selectedFacetMap = sectionFacetClaimMap(section, selectedClaims, input)
  const requiredFactCount = selectedClaims.length
  return [
    buildSectionPrompt({ ...input, retryFeedback: undefined }, section),
    '',
    '本次是多证据章节的结构化重写。只返回以下 JSON，不要 Markdown 标题或代码块：',
    '{"facts":[{"claimId":"指定 claim id","sentence":"仅准确转述该 claim 的一个完整中文事实句"}],"relation":"一个完整句子，只说明这些事实的关系，不得写证据管理或写作过程","answer":"另一个完整句子，回答这种关系对本章问题意味着什么","boundary":"以‘现有证据仅覆盖’开头，只指出相邻未覆盖情形"}',
    `指定 claims：${JSON.stringify(selectedClaims.map((claim) => ({
      id: claim.id,
      text: comparisonClaimTextForPrompt(claim.text, input),
      ...(isConditionalApplicationSection(section) ? {
        role: section.claimIds.includes(claim.id) ? 'scene_direct' : 'mechanism_premise'
      } : {}),
      visibleFacets: selectedFacetMap.filter((item) => item.claimIds.includes(claim.id)).map((item) => item.facet),
      sourceIdentityQualifiers: sourceIdentityQualifiersForClaim(claim, input)
    })))}`,
    ...(contextClaims.length > 0 ? [
      `指定跨章前提 claims：${JSON.stringify(contextClaims.map((claim) => ({ id: claim.id, text: comparisonClaimTextForPrompt(claim.text, input), entities: claim.entities, sourceIdentityQualifiers: sourceIdentityQualifiersForClaim(claim, input) })))}`,
      '跨章前提不得写入 factA/factB；answer 必须是一个完整句子，用“如果/若…则…”明确点名至少一个跨章前提中的独特概念，并只组合 claims 已经陈述的条件与结果；禁止数字、例子、性能收益、最佳实践、行动建议和绝对保证。'
    ] : []),
    ...(isConditionalApplicationSection(section) ? [
      section.claimIds.length > 0
        ? '本章只有一条稀疏场景直证。facts 必须分别陈述 scene_direct 与 mechanism_premise；answer 必须以“如果/若…则…”连接这条场景直证和至少一条机制前提，并明确这不是场景实测结论。'
        : '本章没有场景直证，“指定 claims”全部是机制前提。facts 只陈述机制原义；answer 必须以“如果/若…则…”把至少两条机制前提条件化应用到本章标题中的场景，并明确这不是场景实测结论。'
    ] : []),
    `本地质量校验反馈：${issue}`,
    ...(survivingBody ? ['上一稿仅供识别被清洗的问题，不得复制无依据句：', survivingBody.slice(0, 1_600)] : []),
    `facts 必须恰好输出 ${requiredFactCount} 项，按“指定 claims”的顺序逐项使用全部 claim id；每项只能转述一个 claim，不得合并或遗漏。`,
    '翻译 fact 时可以在保持币种不变的前提下做数学等价的金额单位换算，例如 16.27 billion yuan 与 162.7 亿元等价；不得改变数值、币种、时间、主体、归因和事件顺序。',
    '每个 fact 必须在正文中明确写出其 visibleFacets，不能只在 boundary 提到；relation 与 answer 各写一个有实质内容的完整中文句子，不能合并为一个字段；relation 不得重复 facts 中的完整句子或数字，只说明它们在本章中的结果、条件、时间或来源角色差异；answer 必须直接回答本章 purpose，不得复述任一 fact；禁止使用“这些事实、第一条证据、第二条证据、前一条事实、后一条事实、本章 facts、本章描述了、分别涉及、已述条件、当前结论限于、证据表明”这类写作过程或证据管理话术；如果 claims 没有直接陈述相互关系，就只比较各概念已经明确陈述的条件，不得猜测因果、互补、取舍或额外效果；boundary 必须点名 facts 中已经出现的具体对象或时间，再说明相邻判断为何不能推出，禁止写证据数量和“已引用对象与条件”；合计至少 240 个中文字符，relation、answer 和 boundary 各自都必须提供新的信息或推理。'
  ].join('\n')
}

export function normalizeMultiClaimSectionRetry(
  text: string,
  section: ResearchReportBlueprintSection,
  input: SynthesisWriterInput
): string {
  const selectedClaims = sectionRetryClaims(section, input)
  const selectedClaimIds = selectedClaims.map((claim) => claim.id)
  const conditionalApplication = isConditionalApplicationSection(section)
  const contextClaims = conditionalApplication
    ? selectedClaims.filter((claim) => section.contextClaimIds?.includes(claim.id))
    : sectionRetryContextClaims(section, input)
  const selectedFacetMap = sectionFacetClaimMap(section, selectedClaims, input)
  try {
    const value = parseStructuredRetryPayload(text)
    const structuredFacts = structuredRetryFacts(value, selectedClaims, input)
    const structuredFactSupport = structuredFacts.map((fact) => fact.sentence)
    const rawRelation = sanitizeEpistemicRelation(stringValue(value.relation))
    const rawAnswer = stringValue(value.answer)
    const unsafeRawRelation = (hasUnsafeStructuredSynthesis(rawRelation)
      && !structuredSynthesisRiskSupportedByText(rawRelation, structuredFactSupport.join('\n')))
      || (hasUnsupportedCrossLanguageExpansion(rawRelation)
        && !isPublishableDirectSynthesis(rawRelation, structuredFactSupport))
    const unsafeRawAnswer = (hasUnsafeStructuredSynthesis(rawAnswer)
      && !structuredSynthesisRiskSupportedByText(rawAnswer, structuredFactSupport.join('\n')))
      || hasUnsupportedCrossLanguageExpansion(rawAnswer)
    let relation = sanitizeStructuredSynthesisProse(rawRelation, structuredFactSupport)
    let answer = sanitizeStructuredSynthesisProse(rawAnswer, structuredFactSupport)
    let boundary = sanitizeStructuredBoundaryProse(stringValue(value.boundary))
    const relationRestatesFact = structuredFacts.length > 0
      && isStructuredFactRestatement(relation, structuredFacts)
    const answerRestatesFact = structuredFacts.length > 0
      && isStructuredFactRestatement(answer, structuredFacts)
    if (structuredFacts.length === selectedClaimIds.length && !relation && input.budget.preset === 'quick') {
      relation = groundedDirectSynthesisFromFacts(section.title, structuredFacts).relation
    }
    if (structuredFacts.length === selectedClaimIds.length && !boundary && input.budget.preset === 'quick') {
      boundary = conditionalApplication
        ? `现有证据仅覆盖用于分析“${section.title}”的${selectedClaimIds.length}条机制前提，未提供该场景的直接实测结论，因此不能把条件判断写成已观察事实`
        : `现有证据仅覆盖“${section.title}”中${selectedClaimIds.length}条直接证据明确陈述的条件，未验证这些条件之外的对象与场景，因此不能据此外推`
    }
    const asConditionalAnswer = (candidate: string) => /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))/u.test(candidate.trim())
      ? candidate
      : `由此判断，${candidate}`
    if (conditionalApplication && !isSafeContextSynthesis(asConditionalAnswer(answer))) {
      answer = sanitizeConditionalApplicationAnswer(answer)
    }
    if (conditionalApplication && !isSafeContextSynthesis(asConditionalAnswer(answer))) {
      answer = groundedConditionalApplicationProse(
        section,
        contextClaims,
        selectedClaimIds.find((claimId) => section.claimIds.includes(claimId))
      )
    }
    const structuredFactByClaimId = new Map(structuredFacts.map((fact) => [fact.claimId, fact.sentence]))
    const answerMentionsContextClaim = (claim: ReturnType<typeof usableClaimsForSynthesis>[number]) => (
      contextClaimMentioned(answer, claim)
      || structuredFactSynthesisMentioned(answer, structuredFactByClaimId.get(claim.id) ?? '')
    )
    const safeModelConditionalAnswer = conditionalApplication
      && isSafeContextSynthesis(asConditionalAnswer(answer))
      && !hasUnsafeStructuredSynthesis(answer)
      && contextClaims.every(answerMentionsContextClaim)
    if (conditionalApplication && structuredFacts.length === selectedClaimIds.length && !safeModelConditionalAnswer) {
      answer = groundedConditionalApplicationProse(
        section,
        contextClaims,
        selectedClaimIds.find((claimId) => section.claimIds.includes(claimId))
      )
    }
    if (!conditionalApplication && structuredFacts.length === selectedClaimIds.length) {
      const grounded = groundedDirectSynthesisFromFacts(section.title, structuredFacts)
      if (relationRestatesFact || unsafeRawRelation) {
        relation = ''
      } else if (!isPublishableDirectSynthesis(relation, structuredFactSupport)) {
        relation = input.budget.preset === 'quick' ? grounded.relation : ''
      }
      const answerSurvivesUnsafeRelation = !unsafeRawRelation || isEvidenceBoundedDirectAnswer(answer)
      if (answerRestatesFact || unsafeRawAnswer || !answerSurvivesUnsafeRelation || !isPublishableDirectSynthesis(answer, structuredFactSupport)) {
        const safeRelation = relation
        answer = safeRelation
          ? groundedDirectAnswerFromRelation(section.title, safeRelation)
          : input.budget.preset === 'quick'
            ? grounded.answer
            : ''
        if (safeRelation && answer) relation = ''
      }
    }
    const candidateConditionalAnswer = asConditionalAnswer(answer)
    const directGroundedFallback = input.budget.preset === 'quick'
      && !conditionalApplication && (!relation || !answer)
    if (directGroundedFallback && !answer) {
      answer = groundedStructuredAnswer(section.title, structuredFacts)
    }
      if (structuredFacts.length === selectedClaimIds.length && answer && boundary && selectedClaimIds.length >= 2
        && (conditionalApplication ? Boolean(relation) : Boolean(relation) || isPublishableDirectSynthesis(answer, structuredFactSupport) || directGroundedFallback)
        && (!conditionalApplication || isSafeContextSynthesis(candidateConditionalAnswer))) {
      const bindFact = (fact: string, claimId: string) => {
        const cleanFact = fact
          .replace(/\[claim:[^\]]+\]/gu, '')
          .replace(/[。！？.!?；;]+$/u, '')
          .trim()
        const missingFacets = selectedFacetMap
          .filter((item) => item.claimIds.includes(claimId))
          .map((item) => item.facet)
          .filter((facet) => !cleanFact.toLowerCase().includes(facet.toLowerCase()))
        const visibleFact = missingFacets.length > 0
          ? `关于${missingFacets.map((facet) => `“${facet}”`).join('与')}，${cleanFact}`
          : cleanFact
        return `${visibleFact} [structured-claim:${claimId}]`
      }
      const mentionedContextClaims = contextClaims
        .filter(answerMentionsContextClaim)
      const candidateContextAnswer = /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))/u.test(answer.trim())
        ? answer
        : `由此判断，${answer}`
      const requiresConservativeContextFallback = contextClaims.length > 0 && (
        mentionedContextClaims.length < requiredConditionalContextClaimCount(section)
        || !isSafeContextSynthesis(candidateContextAnswer)
      )
      const safeAnswer = requiresConservativeContextFallback
        ? conditionalApplication
          ? groundedConditionalApplicationProse(
              section,
              contextClaims,
              selectedClaimIds.find((claimId) => section.claimIds.includes(claimId))
            )
          : conservativeContextAnswer(section.title, contextClaims)
        : answer
      const boundContextClaimIds = (requiresConservativeContextFallback ? contextClaims : mentionedContextClaims)
        .map((claim) => claim.id)
      const answerClaimIds = [...new Set([...selectedClaimIds, ...boundContextClaimIds])]
      const [boundRelation, boundAnswer] = bindStructuredSynthesisSentences(
        relation || answer,
        safeAnswer,
        selectedClaimIds,
        answerClaimIds,
        structuredFactSupport
      )
      const boundaryProse = sanitizeSpeculativeBoundaryTails(boundary)
        .replace(/\[claim:[^\]]+\]/gu, '')
        .replace(/[。！？.!?；;]+$/u, '')
        .trim()
      const boundaryIsPublishable = isSpecificEvidenceBoundarySentence(boundaryProse)
        && !hasInternalSynthesisScaffold(boundaryProse)
        && !hasUnsupportedEvidenceBoundaryExpansion(boundaryProse)
        && !hasUnsupportedCrossLanguageExpansion(boundaryProse)
      if (!boundaryIsPublishable && input.budget.preset !== 'quick') {
        throw new Error('multi-claim structured retry boundary must name a concrete covered object or condition without evidence-management scaffolding')
      }
      const safeBoundary = boundaryIsPublishable
        ? boundaryProse
        : conditionalApplication
          ? `现有证据仅覆盖用于分析“${section.title}”的${selectedClaimIds.length}条机制前提，未提供该场景的直接实测结论，因此不能把条件判断写成已观察事实`
          : `现有证据仅覆盖“${section.title}”中${selectedClaimIds.length}条直接证据明确陈述的条件，未验证这些条件之外的对象与场景，因此不能据此外推`
      return normalizeSectionArgumentBody([
        ...structuredFacts.map((fact) => ensureSentenceEnding(bindFact(fact.sentence, fact.claimId))),
        '',
        ...(conditionalApplication || !relation ? [] : [boundRelation]),
        boundAnswer,
        ensureSentenceEnding(safeBoundary)
      ].join('\n'), section)
    }
    const fieldIssues = [
      ...(structuredFacts.length !== selectedClaimIds.length
        ? [`facts ${structuredFacts.length}/${selectedClaimIds.length}`]
        : []),
      ...(!relation
        ? [`relation rejected${relationRestatesFact ? ' as fact restatement' : unsafeRawRelation ? ' as unsafe expansion' : ''}`]
        : []),
      ...(!answer
        ? [`answer rejected${answerRestatesFact ? ' as fact restatement' : unsafeRawAnswer ? ' as unsafe expansion' : ''}`]
        : []),
      ...(!boundary
        ? ['boundary missing']
        : hasInternalSynthesisScaffold(boundary)
          ? ['boundary exposed evidence-management scaffolding']
          : !isSpecificEvidenceBoundarySentence(boundary)
            ? ['boundary did not state a concrete coverage limit']
            : [])
    ]
    throw new Error(`structured analysis fields failed publication validation: ${fieldIssues.join(', ') || 'unknown field combination'}`)
  } catch (error) {
    const fallback = normalizeSectionArgumentBody(text, section)
    const fallbackClaimIds = new Set(boundClaimIds(fallback))
    if (selectedClaimIds.every((claimId) => fallbackClaimIds.has(claimId))) return fallback
    throw new Error(`multi-claim structured retry returned malformed JSON without every assigned claim: ${errorMessage(error)}; response=${diagnosticModelText(text)}`)
  }
  throw new Error(`multi-claim structured retry omitted facts/relation/answer/boundary or did not cover every assigned claim exactly once; response=${diagnosticModelText(text)}`)
}

function parseStructuredRetryPayload(text: string): Record<string, unknown> {
  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(text.slice(objectStart, objectEnd + 1)) as Record<string, unknown>
    } catch {
      // A provider may return a complete facts array before truncating a later field.
    }
  }
  const factsText = completeJsonArrayField(text, 'facts')
  if (!factsText) throw new Error('structured retry did not contain a complete facts array')
  const facts = JSON.parse(factsText) as unknown
  if (!Array.isArray(facts)) throw new Error('structured retry facts field was not an array')
  return {
    facts,
    relation: completeJsonStringField(text, 'relation'),
    answer: completeJsonStringField(text, 'answer'),
    boundary: completeJsonStringField(text, 'boundary')
  }
}

function parseStructuredSynthesisPayload(text: string): Record<string, unknown> {
  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(text.slice(objectStart, objectEnd + 1)) as Record<string, unknown>
    } catch {
      // Fall through to recover individually completed JSON string fields.
    }
  }
  const relation = completeJsonStringField(text, 'relation')
  const answer = completeJsonStringField(text, 'answer')
  const boundary = completeJsonStringField(text, 'boundary')
  if (!relation && !answer && !boundary) throw new Error('structured synthesis repair did not contain relation, answer, or boundary')
  return { relation, answer, boundary }
}

function completeJsonArrayField(text: string, field: string): string | undefined {
  const fieldMatch = new RegExp(`["']${field}["']\\s*:`, 'iu').exec(text)
  if (!fieldMatch) return undefined
  const start = text.indexOf('[', (fieldMatch.index ?? 0) + fieldMatch[0].length)
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index] ?? ''
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '[') depth += 1
    if (character === ']') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return undefined
}

function completeJsonStringField(text: string, field: string): string {
  const fieldMatch = new RegExp(`["']${field}["']\\s*:`, 'iu').exec(text)
  if (!fieldMatch) return ''
  const start = text.indexOf('"', (fieldMatch.index ?? 0) + fieldMatch[0].length)
  if (start < 0) return ''
  let escaped = false
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index] ?? ''
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character !== '"') continue
    try {
      return JSON.parse(text.slice(start, index + 1)) as string
    } catch {
      return ''
    }
  }
  return ''
}

export function sanitizeStructuredSynthesisProse(value: string, supportTexts: string[] = []): string {
  let prose = value
    .replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
    .replace(RAW_INTERNAL_RESEARCH_ID, ' ')
    .replace(/[（(]\s*claim\s*\d+\s*[)）]/giu, '')
    .replace(/\bclaim\s*\d+\b/giu, '')
    .replace(/\s+/gu, ' ')
    .trim()

  prose = prose
    .replace(
      /其中一条(?:事实)?(?:列举|呈现|说明|描述|提供)(?:了)?([^，。；;]{2,160})，另一条(?:事实)?(?:则)?(?:列举|呈现|说明|描述|提供)(?:了)?([^，。；;]{2,160})/u,
      '已披露内容包括$1和$2'
    )
    .replace(/作为支撑/gu, '')
    .replace(/^(?:两|多|各)条事实(?:共同)?(?:说明|表明|显示|指出)[，,]?\s*/u, '')
    .replace(/(?:[，,；;]\s*)?两者(?:相互|彼此)?(?:支撑|支持)[，,]?\s*(?:但|而)?\s*/u, '，')
    .replace(/(?:彼此|相互)印证/gu, '属于不同层面的披露')
    .replace(/^在([^，,。]{2,30}?)(?:维度|方面)?上[，,]\s*(?:但|但是|然而|不过)[，,]?\s*/u, '就$1而言，')
    .replace(/现有事实/gu, '现有材料')
    .replace(
      /^(因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))[，,]\s*(?:而|但|但是|然而|不过|则)[，,]?\s*/u,
      '$1，'
    )
    .replace(/^(这(?:表明|说明|意味着|反映|显示))在[^，。；;]{1,40}[，,]\s*(?:但|但是|而)\s*(?:会)?/u, '$1，')
    .replace(/会(限制|允许|阻止|要求|导致|影响)了/gu, '会$1')
    .replace(
      /^(因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))[，,]\s*(?:(?:和|与|及|、)\s*)*(?:共同)?(?:说明|指出|表明|显示)\s*/u,
      '$1，'
    )
    .replace(
      /([，,；;]\s*(?:但|而|同时|另外))[，,]?\s*(?:(?:和|与|及|、)\s*)*(?:共同)?(?:说明|指出|表明|显示)\s*/gu,
      '$1'
    )
    .replace(/^(?:(?:和|与|及|、)\s*)*(?:共同)?(?:说明|指出|表明|显示)\s*/u, '')
    .replace(/因[^，,；;。]{1,36}而(?=(?:牺牲|限制|失去|阻止))/gu, '')
    .replace(/牺牲(?:了)?/gu, '限制了')
    .replace(/(?:[，,；;]\s*)?(?:但|而)?(?:共同)?构成(?:了)?[^，,；;。]{0,12}全景/gu, '，分别限定本章判断')

  const hasUnsupportedRisk = (candidate: string) => hasUnsafeStructuredSynthesis(candidate)
    && !structuredSynthesisRiskSupportedByText(candidate, supportTexts.join('\n'))

  if (hasUnsupportedRisk(prose)) {
    prose = prose.replace(
      /[，,；;]\s*(?:从而|进而|导致|造成|使得|意味着|因此会|所以会)[^。！？!?；;]*$/u,
      ''
    )
  }

  if (hasUnsupportedRisk(prose)) {
    prose = prose
      .split(/(?<=[，,；;])/u)
      .filter((clause) => !hasUnsupportedRisk(clause))
      .join('')
  }

  return prose
    .replace(/[（(]\s*[)）]/gu, '')
    .replace(/([，,；;])\s*(?:和|与|及|、)\s*(?=[，,；;])/gu, '$1')
    .replace(/([，,；;])\s*([，,；;])/gu, '$1')
    .replace(/因果关系关联/gu, '因果关联')
    .replace(/[，,；;\s]+$/u, '')
    .trim()
}

function sanitizeEpistemicRelation(value: string): string {
  return value.replace(
    /(?:两者|二者|它们|其间)?无(?:直接)?因果(?:关系)?/gu,
    '现有材料不能证明两者存在直接因果关系'
  )
}

function sanitizeStructuredBoundaryProse(value: string): string {
  return value
    .replace(/^现有证据\s*(?:仅)?\s*覆盖(?:了)?\s*/u, '现有证据仅覆盖')
    .replace(
      /^(?:(?:本章\s*)?facts?|(?:本章\s*)?事实)\s*(?:已)?(?:仅)?(?:涉及|覆盖|包括|涵盖|说明)[：:]?\s*/iu,
      '现有证据仅覆盖'
    )
    .replace(
      /^(?:本章\s*)?(?:已|仅)?(?:涉及|覆盖|包括|涵盖)[：:]?\s*/u,
      '现有证据仅覆盖'
    )
}

export function hasMalformedSynthesisGrammar(sentence: string): boolean {
  const prose = sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim()
  return /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))[，,]\s*(?:而|但|但是|然而|不过|则)/u.test(prose)
    || /^这(?:表明|说明|意味着|反映|显示)在[^，。；;]{1,40}[，,]\s*(?:但|但是|而)/u.test(prose)
    || /会(?:限制|允许|阻止|要求|导致|影响)了/u.test(prose)
    || /因果关系关联/u.test(prose)
    || /(?:是|为)[^。！？!?；;]{2,80}的[，,]\s*(?:以及|并且|和|与)(?:对象|主体)?(?:能否|是否|如何)/u.test(prose)
}

function hasInternalSynthesisScaffold(sentence: string): boolean {
  const prose = normalizeResearchChineseScript(sentence
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .trim())
  return /(?:这些事实|这条证据|前一条(?:事实|证据)|后一条(?:事实|证据)|第[一二两三四五六七八九十]+条(?:事实|证据)|本章\s*(?:facts?|事实涉及|描述了)|\d+条(?:直接)?证据|已述条件|当前结论限于|已引用(?:的)?对象与条件|证据表明|\bclaim\b|“”)/iu.test(prose)
}

function groundedDirectSynthesisFromFacts(
  sectionTitle: string,
  facts: Array<{ claimId: string; sentence: string }>
): { relation: string; answer: string } {
  const clauses = facts.map((fact) => conciseStructuredFactForSynthesis(fact.sentence)).filter(Boolean)
  const relation = clauses.length >= 2
    ? `区别在于，${clauses.slice(0, 2).map((clause, index) => index === 0 ? clause : `而${clause}`).join('，')}`
    : `区别在于，“${sectionTitle}”中的各项事实分别限定不同对象或条件，不能互相替代`
  return {
    relation,
    answer: groundedDirectAnswerFromRelation(sectionTitle, relation)
  }
}

function isPublishableDirectSynthesis(value: string, supportTexts: string[] = []): boolean {
  const prose = value.trim()
  const riskSupported = supportTexts.length > 0
    && structuredSynthesisRiskSupportedByText(prose, supportTexts.join('\n'))
  const boundedCrossLanguageInterpretation = supportTexts.length > 0
    && assessClaimFaithfulness(prose, supportTexts).faithful
    && isResearchTextRelevant(prose, supportTexts.join('\n'))
  return prose.length >= 12
    && prose.length <= 200
    && !hasInternalSynthesisScaffold(prose)
    && (!hasUnsafeStructuredSynthesis(prose) || riskSupported)
    && (!hasUnsupportedCrossLanguageExpansion(prose) || boundedCrossLanguageInterpretation)
    && !hasMalformedSynthesisGrammar(prose)
}

function isStructuredFactRestatement(
  value: string,
  facts: Array<{ sentence: string }>
): boolean {
  const prose = value
    .replace(/^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))[，,]?\s*/u, '')
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .trim()
  if (prose.length < 12) return false
  const compact = (candidate: string) => normalizeResearchChineseScript(candidate)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
  const compactProse = compact(prose)
  return facts.some((fact) => {
    const compactFact = compact(fact.sentence)
    return (compactFact.length >= 10 && compactProse.includes(compactFact))
      || substantiallyOverlappingClaimText(prose, fact.sentence)
  })
}

function isEvidenceBoundedDirectAnswer(value: string): boolean {
  const prose = value
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .trim()
  return /(?:只能|仅能|只(?:能)?).{0,72}(?:陈述|呈现|确认|比较|区分|判断)|(?:无法|不能|不足以).{0,72}(?:判断|确认|推出|比较|确定)|(?:已观察|已记录|已披露).{0,72}(?:尚待|未来|计划|条件)/u.test(prose)
}

function groundedDirectAnswerFromRelation(sectionTitle: string, relation: string): string {
  const relationCore = relation
    .replace(/^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))[，,]?\s*/u, '')
    .replace(/[。！？.!?；;]+$/u, '')
    .trim()
  return relationCore
    ? `由此判断，就“${sectionTitle}”而言，${relationCore}`
    : `由此判断，“${sectionTitle}”中的各项事实分别受其明确条件限制，不能互相替代`
}

function conciseStructuredFactForSynthesis(value: string): string {
  const prose = cleanStructuredFactForSynthesis(value)
  if (prose.length <= 48) return prose
  const clauses = prose.split(/[，,；;]/u).map((clause) => clause.trim()).filter(Boolean)
  let concise = ''
  for (const clause of clauses) {
    const candidate = concise ? `${concise}，${clause}` : clause
    if (candidate.length > 48) break
    concise = candidate
  }
  return concise.length >= 16 ? concise : ''
}

function cleanStructuredFactForSynthesis(value: string): string {
  return value
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .replace(/^(?:但|但是|然而|不过|而|则)[，,]?\s*/u, '')
    .replace(/(?:更)?适合(?:用于)?比较/gu, '的比较价值较高')
    .replace(/[。！？.!?；;]+$/u, '')
    .trim()
}

export function sanitizeConditionalApplicationAnswer(value: string): string {
  return value
    .split(/(?<=[，,；;])/u)
    .filter((clause) => !/(?:核心目标|性能|效率|成本|开销|带宽|延迟|收益|优化|最佳|建议|应该|应当|推荐|节省|减少.{0,12}网络|可能(?:导致|降低|提高)|(?:动作|机制|策略)(?:失效|无效))/u.test(clause))
    .join('')
    .replace(/每次(?:使用|复用)前/gu, '复用前')
    .replace(/完全(?=禁止|阻止|不允许|不能)/gu, '')
    .replace(/(^|[，,])\s*反之[，,]\s*/gu, '$1')
    .replace(/[；;]+/gu, '，')
    .replace(/([，,])\s*([，,])/gu, '$1')
    .replace(/[，,；;\s]+$/u, '')
    .trim()
}

function structuredRetryFacts(
  value: Record<string, unknown>,
  selectedClaims: ReturnType<typeof usableClaimsForSynthesis>,
  input: SynthesisWriterInput,
  allowPartial = false
): Array<{ claimId: string; sentence: string }> {
  const selectedClaimIds = selectedClaims.map((claim) => claim.id)
  const selectedClaimById = new Map(selectedClaims.map((claim) => [claim.id, claim]))
  const rawFacts = Array.isArray(value.facts) ? value.facts : []
  const byClaimId = new Map<string, { claimId: string; sentence: string }>()
  for (const item of rawFacts) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const claimId = stringValue(record.claimId)
    const sentence = stringValue(record.sentence) || stringValue(record.text)
    const selectedClaim = selectedClaimById.get(claimId)
    if (!selectedClaim || !sentence || byClaimId.has(claimId)) continue
    const cleanedSentence = cleanClaimForPrompt(sentence)
      .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
      .trim()
    const claimText = cleanClaimForPrompt(selectedClaim.text)
    const sameLanguageFaithful = assessClaimFaithfulness(cleanedSentence, [claimText]).faithful
    const missingIdentityQualifier = sourceIdentityQualifiersForClaim(selectedClaim, input)
      .some((qualifier) => !cleanedSentence.toLowerCase().includes(qualifier.toLowerCase()))
    const safeChineseTranslation = !/[\u3400-\u9fff]/u.test(claimText)
      && /[\u3400-\u9fff]/u.test(cleanedSentence)
      && !sparseTranslatedFactIssue(cleanedSentence, selectedClaim, input)
    if (isUsableEvidenceText(cleanedSentence, 12) && !missingIdentityQualifier && (sameLanguageFaithful || safeChineseTranslation)) {
      byClaimId.set(claimId, { claimId, sentence: cleanedSentence })
    } else if (/[\u3400-\u9fff]/u.test(claimText) && isUsableEvidenceText(claimText, 12)) {
      byClaimId.set(claimId, { claimId, sentence: claimText })
    }
  }

  // 模型偶尔会返回完整 relation/answer/boundary，却漏掉 facts 数组中的部分项。
  // 这里只恢复账本已有的完整中文事实；不翻译、不总结，也不替模型生成综合判断。
  for (const claim of selectedClaims) {
    if (byClaimId.has(claim.id)) continue
    const claimText = cleanClaimForPrompt(claim.text)
    if (/[\u3400-\u9fff]/u.test(claimText) && isUsableEvidenceText(claimText, 12)) {
      byClaimId.set(claim.id, { claimId: claim.id, sentence: claimText })
    }
  }

  if (selectedClaimIds.every((claimId) => byClaimId.has(claimId))) {
    return selectedClaimIds.map((claimId) => byClaimId.get(claimId)!)
  }
  if (allowPartial) {
    return selectedClaimIds.flatMap((claimId) => {
      const fact = byClaimId.get(claimId)
      return fact ? [fact] : []
    })
  }

  // 兼容旧的双 claim JSON；三条及以上的发布合同绝不降级为两条事实。
  if (selectedClaimIds.length === 2) {
    const factA = stringValue(value.factA)
    const factB = stringValue(value.factB)
    if (factA && factB && isUsableEvidenceText(factA, 12) && isUsableEvidenceText(factB, 12)) {
      return [
        { claimId: selectedClaimIds[0]!, sentence: factA },
        { claimId: selectedClaimIds[1]!, sentence: factB }
      ]
    }
  }
  return []
}

export function evidenceBoundedStructuredSynthesis(
  sectionTitle: string,
  claims: ReturnType<typeof usableClaimsForSynthesis>,
  contextClaims: ReturnType<typeof usableClaimsForSynthesis> = []
): [string, string] {
  const labels = claims.map((claim, index) => synthesisClaimLabel(claim, `第${index + 1}条事实`))
  const firstLabel = labels[0] ?? '前一条事实'
  const secondLabel = labels[1] ?? '后一条事实'
  const relation = labels.length > 2
    ? `区别在于，这些事实分别直接涉及${labels.map((label) => `“${label}”`).join('、')}，现有证据仅分别说明这些已述条件`
    : `区别在于，前一条事实直接涉及“${firstLabel}”，后一条事实直接涉及“${secondLabel}”，现有证据仅分别说明这两组已述条件`
  const contextLabel = synthesisClaimLabel(contextClaims[0], '')
  const primaryScope = labels.map((label) => `“${label}”`).join('与')
  const answer = contextLabel
    ? `由此判断，若“${contextLabel}”这一前提成立，则“${sectionTitle}”的可确认范围仍由“${firstLabel}”与“${contextLabel}”各自明示的条件限定`
    : `由此判断，对于“${sectionTitle}”，当前结论限于${primaryScope}各自已经陈述的行为，不能继续推导未被证据陈述的额外效果`
  return [relation, answer]
}

function synthesisClaimLabel(
  claim: ReturnType<typeof usableClaimsForSynthesis>[number] | undefined,
  fallback: string
): string {
  if (!claim) return fallback
  return claim.entities
    .map((entity) => entity.trim())
    .find((entity) => entity.length >= 2 && !/^(?:source|evidence|fact|claim)$/iu.test(entity))
    ?? contextClaimLabel(claim)
    ?? fallback
}

export function bindStructuredSynthesisSentences(
  relation: string,
  answer: string,
  claimIds: string[],
  answerClaimIds: string[] = claimIds,
  supportTexts: string[] = []
): [string, string] {
  const bind = (sentence: string, connector: '因此' | '由此判断', boundClaimIds: string[]) => {
      const prose = sentence
        .replace(/\[claim:[^\]]+\]/gu, '')
        .replace(/\bfact\s*a\b/giu, '前一条事实')
        .replace(/\bfact\s*b\b/giu, '后一条事实')
        .replace(/事实\s*A/giu, '前一条事实')
        .replace(/事实\s*B/giu, '后一条事实')
        .replace(/\s*(前一条事实|后一条事实)\s*/gu, '$1')
        .replace(/(?:[。！？!?；;]|(?<!\d)\.(?!\d))+/gu, '，')
      .replace(/[，,]+$/u, '')
      .trim()
    const connectiveSafeProse = prose
      .replace(/^(?:但|但是|然而|不过|而|则)[，,]?\s*/u, '')
      .replace(/^(?:前一条|后一条)(?:事实|证据)?(?:补充|说明|指出|表明)(?:了)?[：:]?\s*/u, '')
    const connected = /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))[，,]?/u.test(connectiveSafeProse)
      ? connectiveSafeProse
      : `${connector}，${connectiveSafeProse}`
    const sanitizedConnected = sanitizeStructuredSynthesisProse(connected, supportTexts)
    return ensureSentenceEnding(`${sanitizedConnected} [structured-claim:${boundClaimIds.join(',')}]`)
  }
  return [bind(relation, '因此', claimIds), bind(answer, '由此判断', answerClaimIds)]
}

function contextClaimMentioned(answer: string, claim: ReturnType<typeof usableClaimsForSynthesis>[number]): boolean {
  const normalizedAnswer = answer.normalize('NFKC').toLowerCase()
  const aliases = [...claim.entities, ...(claim.text.match(/\b(?:[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*|[A-Za-z]+-[A-Za-z0-9-]+)\b/gu) ?? [])]
    .map((alias) => alias.normalize('NFKC').toLowerCase().trim())
    .flatMap((alias) => alias.endsWith('s') && alias.length > 4 ? [alias, alias.slice(0, -1)] : [alias])
    .filter((alias) => alias.length >= 3)
    .filter((alias) => !/^(?:this|that|when|source|evidence|fact|claim)$/u.test(alias))
  return [...new Set(aliases)].some((alias) => normalizedAnswer.includes(alias))
}

function structuredFactSynthesisMentioned(answer: string, fact: string): boolean {
  if (!answer || !fact) return false
  const normalizedAnswer = answer.normalize('NFKC').toLowerCase()
  const technicalTerms = fact.normalize('NFKC').toLowerCase()
    .match(/\b[a-z][a-z0-9]*(?:[-/][a-z0-9]+)+\b|\b[A-Z][A-Za-z0-9]+\b/giu) ?? []
  if (technicalTerms.some((term) => term.length >= 3 && normalizedAnswer.includes(term))) return true
  const genericHan = new Set(['这些机制', '上述事实', '当前条件', '机制前提'])
  const hanGrams = (fact.match(/[\u4e00-\u9fff]{3,}/gu) ?? []).flatMap((run) => {
    const grams: string[] = []
    for (let index = 0; index <= run.length - 4; index += 1) grams.push(run.slice(index, index + 4))
    return grams
  })
  return hanGrams.some((gram) => !genericHan.has(gram) && normalizedAnswer.includes(gram))
}

function conservativeContextAnswer(
  sectionTitle: string,
  claims: ReturnType<typeof usableClaimsForSynthesis>
): string {
  const labels = claims
    .map(contextClaimLabel)
    .filter(Boolean)
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 3)
  const labelText = labels.length > 0 ? labels.map((label) => `“${label}”`).join('、') : '这些跨章前提'
  return `现有证据未直接陈述${labelText}与“${sectionTitle}”场景事实组合后的额外结果，因此不能据此推出统一策略`
}

function contextClaimLabel(claim: ReturnType<typeof usableClaimsForSynthesis>[number]): string {
  const entity = claim.entities.find((candidate) => candidate.trim().length >= 3)
  if (entity) return entity.trim()
  const technical = claim.text.match(/\b(?:[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*|[A-Za-z]+-[A-Za-z0-9-]+)\b/gu)
    ?.find((candidate) => !/^(?:This|That|When|Source|Evidence|Fact|Claim)$/u.test(candidate))
  return technical && technical.length > 4 && /s$/u.test(technical) ? technical.slice(0, -1) : technical ?? ''
}

export function reorderStructuredFacts(
  factA: string,
  factB: string,
  claimIds: string[],
  facetMap: Array<{ facet: string; claimIds: string[] }>,
  input: SynthesisWriterInput
): [string, string] {
  if (claimIds.length < 2 || facetMap.length < 2) return [factA, factB]
  const context = [
    input.brief.topic,
    input.frame.coreResearchThread,
    input.frame.centralQuestion,
    ...input.frame.coreQuestions.map((question) => question.text)
  ].join('\n')
  const facetsForClaim = (claimId: string) => facetMap
    .filter((item) => item.claimIds.includes(claimId))
    .map((item) => item.facet)
  const firstFacets = facetsForClaim(claimIds[0]!)
  const secondFacets = facetsForClaim(claimIds[1]!)
  if (firstFacets.length === 0 || secondFacets.length === 0) return [factA, factB]
  const coversAnyFacet = (fact: string, facets: string[]) => facets.some((facet) =>
    coversResearchDimensionFocusGroups(researchDimensionFocusGroups(facet, context), fact)
  )
  const firstLooksSwapped = !coversAnyFacet(factA, firstFacets) && coversAnyFacet(factA, secondFacets)
  const secondLooksSwapped = !coversAnyFacet(factB, secondFacets) && coversAnyFacet(factB, firstFacets)
  return firstLooksSwapped && secondLooksSwapped ? [factB, factA] : [factA, factB]
}

function diagnosticModelText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 600)
}

function boundClaimIds(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/\[claim:([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter(Boolean))]
}

function buildSectionExtensionPrompt(
  input: SynthesisWriterInput,
  section: ResearchReportBlueprintSection,
  survivingBody: string,
  issue: string
): string {
  const assignedClaimIds = new Set(section.claimIds)
  const issueClaimIds = new Set(section.claimIds.filter((claimId) => issue.includes(claimId)))
  const usedClaimIds = new Set([...survivingBody.matchAll(/\[claim:([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter((claimId): claimId is string => Boolean(claimId)))
  const unusedClaims = usableClaimsForSynthesis(input)
    .filter((claim) => assignedClaimIds.has(claim.id) && !usedClaimIds.has(claim.id))
    .sort((left, right) => Number(issueClaimIds.has(right.id)) - Number(issueClaimIds.has(left.id)))
    .slice(0, 3)
    .map((claim) => ({ id: claim.id, text: comparisonClaimTextForPrompt(claim.text, input) }))
  return [
    buildSectionPrompt({ ...input, retryFeedback: undefined }, section),
    '',
    '本次不是整章重写，只生成追加段落：',
    `本地质量校验反馈（安全清洗后论证不足或缺口）：${issue}`,
    '必须原样保留、不要复述的已有正文：',
    survivingBody.slice(0, 2_800),
    '',
    '追加段落要求：',
    '- 输出 3-5 个完整中文句子、至少 140 个中文字符。',
    `- 尚未在存活正文中使用的本章 claim：${JSON.stringify(unusedClaims)}。`,
    '- 如上面存在未使用 claim，可先补充至多一个新的事实句，并在句末原样绑定对应 [claim:claim_id]；不得用已使用 claim 重复已有事实。',
    '- 其余句子只解释已有证据为何支持本章局部结论，使用自然因果或比较连接。',
    '- 如果已有正文已经包含至少两条事实，必须补一个以“因此”“区别在于”“关键在于”或“由此判断”开头的综合句，并在同一句末绑定这两条事实对应的 [claim:claim_id]；这是综合引用，不算重复事实。',
    '- 其余无引用句禁止出现协议名、配置项、英文技术 token、客户端/服务器动作和具体例子；只写已引用证据之间的逻辑关系、取舍或未覆盖边界，确保安全清洗后仍保留至少三个完整句子。',
    '- 后半段明确指出当前证据没有覆盖的机制、实现、对象或场景，以及这如何限制结论外推。',
    '- 除上述至多一个未使用 claim 事实句外，不输出其他 claim 占位符，不新增技术事实、数字、实体、配置或行动建议。'
  ].join('\n')
}

function sanitizeSectionExtensionClaimUsage(
  extension: string,
  section: ResearchReportBlueprintSection,
  survivingBody: string
): string {
  const assignedClaimIds = new Set(section.claimIds)
  const usedClaimIds = new Set([...survivingBody.matchAll(/\[claim:([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter((claimId): claimId is string => Boolean(claimId)))
  let addedClaimSentence = false
  let addedSynthesisSentence = false
  return extension.split('\n').map((line) => splitCitationSentences(line).filter((sentence) => {
    const claimIds = [...sentence.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
      .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
      .filter((claimId): claimId is string => Boolean(claimId))
    if (claimIds.length === 0) return true
    const uniqueClaimIds = [...new Set(claimIds)]
    const isCitedSynthesis = uniqueClaimIds.length >= 2
      && uniqueClaimIds.every((claimId) => assignedClaimIds.has(claimId))
      && /^(?:\s*(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)))/u.test(
        sentence.replace(/\[claim:[^\]]+\]/gu, '')
      )
    if (isCitedSynthesis) {
      if (addedSynthesisSentence) return false
      addedSynthesisSentence = true
      return true
    }
    if (addedClaimSentence) return false
    if (claimIds.some((claimId) => !assignedClaimIds.has(claimId) || usedClaimIds.has(claimId))) return false
    addedClaimSentence = true
    return true
  }).join('')).join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function buildClosingPrompt(input: SynthesisWriterInput, sectionMarkdown: string, retryFeedback?: string): string {
  const blueprint = input.reportBlueprint!
  const allowedClaimIds = [...new Set(blueprint.sections.flatMap((section) => section.claimIds))]
  const contextualSections = closingContextualSectionMappings(blueprint.sections)
  const recommendationClaimIds = input.claims
    .filter((claim) => claim.claimType === 'recommendation' && allowedClaimIds.includes(claim.id))
    .map((claim) => claim.id)
  const wantsRecommendations = /建议|行动方案|实施方案|怎么做|如何配置|决策建议|recommend/iu.test(`${input.brief.topic}\n${input.brief.userIntent}`)
  const revisionFeedback = input.revision ? [
    ...input.revision.previousVerdict.blockingIssues,
    ...input.revision.previousVerdict.warnings,
    ...input.revision.previousVerdict.recommendedFixes
  ].filter((item) => feedbackTargetsClosing(item, input.revision?.previousDraftMarkdown ?? '')) : []
  const previousConclusion = input.revision?.previousDraftMarkdown
    ? previousConclusionBody(input.revision.previousDraftMarkdown)
    : ''
  return [
    `报告主题：${input.brief.topic}`,
    `报告输出格式：${input.brief.outputFormat}`,
    `核心问题：${input.frame.centralQuestion}`,
    `主线：${input.frame.coreResearchThread}`,
    `必须回答的交付项：${centralAnswerObligations(input).join('、') || input.frame.centralQuestion}`,
    `允许使用的 claim id：${allowedClaimIds.join('、')}`,
    ...(contextualSections.length >= 2
      ? [`场景章节 claim 映射：${JSON.stringify(contextualSections)}`]
      : []),
    '',
    '已完成章节：',
    sectionMarkdown,
    ...(previousConclusion || revisionFeedback.length > 0 ? [
      '',
      '上一轮结论与质量反馈：',
      JSON.stringify({ previousConclusion, feedback: revisionFeedback }, null, 2)
    ] : []),
    ...(retryFeedback ? ['', '上一稿收尾校验失败：', retryFeedback] : []),
    '',
    '只返回以下 JSON：',
    '{"lead":"主要发现开头的直接答案，2-3句","conclusionFact":"一条关键核心事实，1句","conclusionFactClaimId":"支持 conclusionFact 的一个 claim id","conclusionSynthesis":"只连接已引用事实、不新增外部事实或技术动作的综合判断，严格1句","conclusionSynthesisClaimIds":["支持综合判断的 claim id 1","claim id 2"],"conclusionBoundary":"结论成立范围和未覆盖边界，1句","limitations":"实质局限，3-5句"}',
    '',
    '规则：',
    '- lead 必须直接回答核心问题，并用至多两条最关键 claim 支撑；显式对比或多分面问题必须在完整 lead 中使用至少两条分别覆盖不同分面的 claim，可以分成两个清晰事实句后再给关系判断，不能复制某一条章节事实充当总回答。',
    '- conclusionFact、conclusionSynthesis、conclusionBoundary 合并后必须形成 3-5 个完整句子；standard/deep 不接受旧的 conclusion 单字段，三个字段缺一不可且职责不可混写。',
    '- conclusionFactClaimId 必须是上面允许使用的一个 claim id；conclusionFact 只写该 claim 支持的一条关键事实，并在句末绑定同一个 [claim:claim_id]。',
    '- conclusionSynthesisClaimIds 必须包含上面允许使用的至少两个 claim id；conclusionSynthesis 直接回答主矛盾或概念关系，并在句末绑定对应 [claim:claim_id]，不得逐章复述或复制 conclusionFact。该字段严格只写一个句子，禁止协议名、配置项、请求/响应动作、客户端/服务器动作、实现原因、例子或性能效果。',
    '- conclusionSynthesis 必须说清至少两条事实之间的具体区别、依赖或约束关系；禁止用“共同决定/影响某种程度、水平、表现、效果”代替实际关系。',
    '- conclusionBoundary 先写结论实际成立的对象和条件；只有输入明确给出未覆盖项时才能点名，不能自行扩写技术细节、建议或场景。',
    '- 允许分析已引用事实之间的关系，这类综合不需要原文逐字出现；但不得增加输入中没有的实体、数字、例子、实现机制、适用对象或因果结果。',
    '- 至少一条结论句必须直接回答核心问题中的主要关系或权衡，不能只复制章节事实，也不能写“综合各章”“已经验证的差异”之类编辑过程话术。',
    '- conclusion 必须保证在删除所有无引用外部事实后仍剩至少 3 个完整句子和 80 个中文字符：事实句就近绑定 claim，纯综合句分别以“因此”“关键在于”“区别在于”“由此判断”等连接词开头。',
    '- 禁止“综合来看，但是”“总体而言，而”等没有前置对照关系的拼接式转折。',
    '- limitations 只写输入中真实存在的来源范围和证据边界；不要为了凑字段虚构时间窗口、统计口径、可比性或技术缺口。',
    '- limitations 至少写 2 个具体、彼此不同的完整句子；每句明确指出“哪些来源/对象/场景未覆盖”及其对结论外推的限制，不能只写“资料有限”。',
    '- 核心问题明确要求的优势、风险、未来走势和命名对手必须在 lead 或 conclusion 中逐项回答；没有足够证据时写条件性判断或明确无法可靠预测，不能直接省略。',
    '- lead 和 conclusion 中的外部可核验事实句必须带 [claim:claim_id]；结论综合句也必须引用其连接的 claims，不能因为使用“因此/关键在于”等连接词就省略引用。',
    '- 报告要求中文时，所有解释和转述必须使用中文；只保留输入证据中确有必要的技术标识，禁止复制完整英文证据句。',
    ...(contextualSections.length >= 2
      ? ['- 核心问题要求比较多个场景：conclusionSynthesisClaimIds 必须从每个“场景章节 claim 映射”中至少选择一个 claim，并在一个句子中直接说明这些场景的条件差异；证据没有支持统一优劣时不得强行排序。']
      : []),
    ...(!wantsRecommendations
      ? ['- 用户没有要求行动方案；conclusion 只写判断、机制、取舍与边界，禁止使用“建议、应该、应当、推荐、优先使用”等行动措辞。']
      : recommendationClaimIds.length > 0
        ? [`- 具体行动建议只能使用 recommendation claim：${recommendationClaimIds.join('、')}，并在同句引用。`]
        : ['- 当前没有 recommendation claim；只能写判断和证据边界，不得给出具体行动建议。']),
    '- 不得写输入之外的事实、数字、实体、专有名词或因果关系。'
  ].join('\n')
}

function parseClosingResult(
  text: string,
  input: SynthesisWriterInput,
  options: { fallbackTechnicalSynthesis?: boolean; sectionMarkdown?: string } = {}
): { lead: string; conclusion: string; limitations: string } {
  const objectText = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  if (!objectText.startsWith('{') || !objectText.endsWith('}')) {
    throw new Error('closing writer did not return a JSON object')
  }
  let value: Record<string, unknown>
  try {
    value = JSON.parse(objectText) as Record<string, unknown>
  } catch {
    throw new Error('closing writer returned malformed JSON')
  }
  const lead = trimClosingLead(stringValue(value.lead))
  let conclusionFact = stringValue(value.conclusionFact)
  let conclusionSynthesis = stringValue(value.conclusionSynthesis)
  let conclusionBoundary = stringValue(value.conclusionBoundary)
  let parsedLimitations = sanitizeClosingLimitations(stringValue(value.limitations), input)
  if (!parsedLimitations && input.budget.preset !== 'quick') {
    parsedLimitations = uniqueLimitations([
      ...(input.sectionEvidenceMap ?? []).flatMap((section) => section.limitations),
      ...input.notes.flatMap((note) => note.limitations),
      ...defaultClosingLimitations(input)
    ]).slice(0, 3).map(ensureSentenceEnding).join('')
  }
  const missingFields = [
    !lead ? 'lead' : '',
    !conclusionFact ? 'conclusionFact' : '',
    !conclusionSynthesis ? 'conclusionSynthesis' : '',
    !conclusionBoundary ? 'conclusionBoundary' : '',
    !parsedLimitations ? 'limitations' : ''
  ].filter(Boolean)
  if (input.budget.preset !== 'quick' && missingFields.length > 0) {
    throw new Error(`closing writer omitted required fields: ${missingFields.join(', ')}`)
  }
  if (input.budget.preset !== 'quick') {
    conclusionBoundary = safeClosingBoundary(
      conclusionBoundary,
      parsedLimitations,
      options.sectionMarkdown ?? '',
      input
    )
  }
  const allowedClaimIds = new Set(usableClaimsForSynthesis(input).map((claim) => claim.id))
  const leadIssue = closingLeadQualityIssue(lead, input, allowedClaimIds, options.sectionMarkdown ?? '')
  if (input.budget.preset !== 'quick' && leadIssue) throw new Error(leadIssue)
  const explicitFactClaimId = stringValue(value.conclusionFactClaimId).trim()
  if (!/\[claim:[^\]]+\]/u.test(conclusionFact) && allowedClaimIds.has(explicitFactClaimId)) {
    conclusionFact = `${conclusionFact.replace(/[。！？.!?；;]+$/u, '').trim()} [structured-claim:${explicitFactClaimId}]`
  } else {
    const inlineFactClaimIds = [...conclusionFact.matchAll(/\[claim:([^\]]+)\]/gu)]
      .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
      .map((claimId) => claimId.trim())
      .filter((claimId) => allowedClaimIds.has(claimId))
    if (new Set(inlineFactClaimIds).size === 1) {
      conclusionFact = conclusionFact.replace(/\[claim:[^\]]+\]/gu, `[structured-claim:${inlineFactClaimIds[0]}]`)
    }
  }
  let conclusionFactClaimIds = [...conclusionFact.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
    .map((claimId) => claimId.trim())
    .filter((claimId) => allowedClaimIds.has(claimId))
  if (input.budget.preset !== 'quick' && conclusionFactClaimIds.length !== 1) {
    const existingFact = closingFactFromSections(
      options.sectionMarkdown ?? '',
      conclusionFactClaimIds.length > 0 ? conclusionFactClaimIds : [...allowedClaimIds]
    )
    if (existingFact) {
      conclusionFact = existingFact
      conclusionFactClaimIds = sentenceClaimIds(existingFact).filter((claimId) => allowedClaimIds.has(claimId))
    }
  }
  const conclusionFactProse = conclusionFact
    .replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
    .trim()
  const conclusionFactClaim = conclusionFactClaimIds.length === 1
    ? usableClaimsForSynthesis(input).find((claim) => claim.id === conclusionFactClaimIds[0])
    : undefined
  const unsupportedClosingAssessment = /(?:仍|依然|整体|相对|处于).{0,6}(?:较低|较高|低位|高位|稳健|健康|强劲|领先|良好|优秀)/u.test(conclusionFactProse)
    && !/(?:仍|依然|整体|相对|处于).{0,6}(?:较低|较高|低位|高位|稳健|健康|强劲|领先|良好|优秀)/u.test(conclusionFactClaim?.text ?? '')
  if (input.budget.preset !== 'quick' && (hasExternallyCheckableMechanism(conclusionFactProse) || unsupportedClosingAssessment)) {
    const existingFact = closingFactFromSections(options.sectionMarkdown ?? '', conclusionFactClaimIds)
    if (existingFact) conclusionFact = existingFact
  }
  const explicitSynthesisClaimIds = (Array.isArray(value.conclusionSynthesisClaimIds)
    ? value.conclusionSynthesisClaimIds
    : stringValue(value.conclusionSynthesisClaimIds).split(/[,，;；]/u))
    .map((claimId) => stringValue(claimId).trim())
    .filter((claimId) => allowedClaimIds.has(claimId))
  const declaredSynthesisClaimIds = [...new Set(explicitSynthesisClaimIds)]
  const inlineSynthesisClaimIds = [...conclusionSynthesis.matchAll(/\[claim:([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
    .map((claimId) => claimId.trim())
    .filter((claimId) => allowedClaimIds.has(claimId))
  const boundSynthesisClaimIds = declaredSynthesisClaimIds.length >= 2
    ? declaredSynthesisClaimIds
    : [...new Set(inlineSynthesisClaimIds)]
  if (boundSynthesisClaimIds.length >= 2) {
    conclusionSynthesis = `${conclusionSynthesis
      .replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
      .replace(/[。！？.!?；;]+$/u, '')
      .trim()} [structured-claim:${boundSynthesisClaimIds.join(',')}]`
  }
  let synthesisClaimIds = new Set([...conclusionSynthesis.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
    .map((claimId) => claimId.trim())
    .filter((claimId) => allowedClaimIds.has(claimId)))
  const conclusionSynthesisProse = conclusionSynthesis
    .replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
    .trim()
  const conclusionSynthesisSentences = splitCitationSentences(ensureSentenceEnding(conclusionSynthesisProse))
    .filter((sentence) => sentence.trim().length >= 8)
  const invalidSynthesisSentenceCount = conclusionSynthesisSentences.length !== 1
  const synthesisClaimText = [...synthesisClaimIds]
    .map((claimId) => usableClaimsForSynthesis(input).find((claim) => claim.id === claimId)?.text ?? '')
    .join('\n')
  const unsupportedSynthesis = (
    hasUnsafeStructuredSynthesis(conclusionSynthesisProse)
      && !structuredSynthesisRiskSupported(conclusionSynthesis, input)
  ) || (
    hasExternallyCheckableMechanism(conclusionSynthesisProse) &&
    !isResearchTextRelevant(conclusionSynthesisProse, synthesisClaimText)
  )
  const vagueSynthesis = isVagueConclusionSynthesis(conclusionSynthesisProse)
  const insufficientSynthesisClaims = synthesisClaimIds.size < 2
  const contextualSections = closingContextualSectionMappings(input.reportBlueprint?.sections ?? [])
  const missingContextualSections = contextualSections.filter((section) =>
    !section.claimIds.some((claimId) => synthesisClaimIds.has(claimId))
  )
  const incompleteContextualSynthesis = contextualSections.length >= 2 && missingContextualSections.length > 0
  if (input.budget.preset !== 'quick' && (invalidSynthesisSentenceCount || unsupportedSynthesis || vagueSynthesis || insufficientSynthesisClaims || incompleteContextualSynthesis)) {
    if (!options.fallbackTechnicalSynthesis) {
      if (invalidSynthesisSentenceCount) {
        throw new Error('closing writer conclusionSynthesis must be exactly one substantive sentence')
      }
      if (insufficientSynthesisClaims) {
        throw new Error('closing writer conclusionSynthesis must connect and cite at least two allowed claim ids')
      }
      if (incompleteContextualSynthesis) {
        throw new Error(`closing writer conclusionSynthesis did not compare every required scenario section: ${missingContextualSections.map((section) => section.title).join(', ')}`)
      }
      if (vagueSynthesis) {
        throw new Error('closing writer conclusionSynthesis used a vague aggregate effect; state the concrete difference, dependency or constraint between the cited facts')
      }
      throw new Error('closing writer conclusionSynthesis introduced a mechanism not grounded in its cited claims; restate only the relationship supported by those facts')
    }
    const closingClaimIds = [...new Set([
      ...synthesisClaimIds,
      ...conclusionFactClaimIds,
      ...[...lead.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
        .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
        .map((claimId) => claimId.trim())
        .filter((claimId) => allowedClaimIds.has(claimId))
    ])]
    const sanitizedModelSynthesis = sanitizeStructuredSynthesisProse(conclusionSynthesisProse)
    const safeSanitizedModelSynthesis = synthesisClaimIds.size >= 2
      && isPublishableDirectSynthesis(sanitizedModelSynthesis)
      && isResearchTextRelevant(sanitizedModelSynthesis, synthesisClaimText)
      ? {
          sentence: `${sanitizedModelSynthesis.replace(/[。！？.!?；;]+$/u, '').trim()} [structured-claim:${[...synthesisClaimIds].join(',')}]。`,
          claimIds: [...synthesisClaimIds]
        }
      : undefined
    const safeSectionSynthesis = safeSanitizedModelSynthesis ?? (contextualSections.length >= 2
      ? closingScenarioSynthesisFromSections(
          options.sectionMarkdown ?? '',
          contextualSections,
          allowedClaimIds
        )
      : closingSynthesisFromSections(
          options.sectionMarkdown ?? '',
          allowedClaimIds,
          closingClaimIds
        )) ?? closingSynthesisFromSectionFacts(
          options.sectionMarkdown ?? '',
          input.reportBlueprint?.sections ?? [],
          allowedClaimIds,
          closingClaimIds
        ) ?? closingSynthesisFromBlueprintClaims(
          input.reportBlueprint?.sections ?? [],
          allowedClaimIds,
          closingClaimIds
        )
    if (!safeSectionSynthesis) {
      throw new Error('closing writer conclusionSynthesis cannot be repaired without inventing a generic conclusion')
    }
    synthesisClaimIds = new Set(safeSectionSynthesis.claimIds)
    conclusionSynthesis = safeSectionSynthesis.sentence
    const stillMissingContextualSections = contextualSections.filter((section) =>
      !section.claimIds.some((claimId) => synthesisClaimIds.has(claimId))
    )
    if (contextualSections.length >= 2 && stillMissingContextualSections.length > 0) {
      throw new Error(`closing writer conclusionSynthesis cannot be repaired into a complete scenario comparison: ${stillMissingContextualSections.map((section) => section.title).join(', ')}`)
    }
  }
  const structuredConclusion = [conclusionFact, conclusionSynthesis, conclusionBoundary].filter(Boolean)
  const legacyConclusion = stringValue(value.conclusion)
  const conclusion = structuredConclusion.length === 3
    ? structuredConclusion.map(ensureSentenceEnding).join('')
    : legacyConclusion
  if (input.budget.preset !== 'quick' && conclusionFactClaimIds.length !== 1) {
    throw new Error('closing writer conclusionFact must cite exactly one allowed claim id')
  }
  if (input.budget.preset !== 'quick') {
    if (synthesisClaimIds.size < 2) {
      throw new Error('closing writer conclusionSynthesis must connect and cite at least two allowed claim ids')
    }
    if (!/(?:现有证据|当前证据|现有材料|仅(?:支持|覆盖|限于)|未(?:覆盖|说明|验证|讨论)|不足以|不能(?:据此)?外推)/u.test(conclusionBoundary)) {
      throw new Error('closing writer conclusionBoundary must state a concrete evidence boundary')
    }
  }
  if (lead && conclusion && parsedLimitations) {
    return ensureClosingScopeCoverage({ lead, conclusion, limitations: parsedLimitations }, input)
  }
  if (input.budget.preset !== 'quick') {
    throw new Error('closing writer returned empty required closing content')
  }
  const claims = usableClaimsForSynthesis(input)
    .filter((claim) => input.reportBlueprint?.sections.some((section) => section.claimIds.includes(claim.id)))
    .slice(0, 2)
  const cited = claims.map((claim) => `${comparisonClaimTextForPrompt(claim.text, input)} [claim:${claim.id}]`)
  const limitations = uniqueLimitations([
    ...(input.sectionEvidenceMap ?? []).flatMap((section) => section.limitations),
    ...input.notes.flatMap((note) => note.limitations)
  ]).slice(0, 6)
  return ensureClosingScopeCoverage({
    lead: `${cited.join('；')}。上述证据共同表明，最终判断必须同时看主要发现、局部挑战和适用边界。`,
    conclusion: `${cited.join('；')}。上述证据共同表明，结论不能从单一来源或单一案例外推到全部对象与场景。`,
    limitations: limitations.length > 0
      ? limitations.join('；')
      : defaultClosingLimitations(input)[0]!
  }, input)
}

export function isVagueConclusionSynthesis(sentence: string): boolean {
  const prose = sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '').trim()
  return /激进程度|事实\s*[AB].{0,80}事实\s*[AB]|(?:两者|二者|这两个|这些|上述).{0,24}(?:作用机制|触发条件|风险点).{0,16}(?:完全不同|各不相同|存在差异)|(?:共同)?(?:构成|揭示).{0,36}(?:风险点|行为差异|不同影响)|共同.{0,12}(?:决定|影响|塑造|左右).{0,28}(?:程度|水平|表现|效果|结果|走向|态势)/u.test(prose)
}

function safeClosingBoundary(
  modelBoundary: string,
  parsedLimitations: string,
  sectionMarkdown: string,
  input: SynthesisWriterInput
): string {
  const existingSectionBoundaries = new Set(splitCitationSentences(sectionMarkdown.replace(/\n+/gu, ''))
    .filter(isSpecificEvidenceBoundarySentence)
    .map(normalizeLimitationSentence)
    .filter(Boolean))
  const candidates = [
    modelBoundary,
    ...splitCitationSentences(parsedLimitations.replace(/\n+/gu, '')),
    ...splitCitationSentences(sectionMarkdown.replace(/\n+/gu, '')),
    ...(input.sectionEvidenceMap ?? []).flatMap((section) => section.limitations),
    ...input.notes.flatMap((note) => note.limitations)
  ]
  for (const candidate of candidates) {
    const prose = sanitizeSpeculativeBoundaryTails(candidate)
      .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
      .replace(/^[-*\d.\s]+/u, '')
      .replace(/[。！？.!?；;]+$/u, '')
      .trim()
    if (prose.replace(/\s+/gu, '').length < 12) continue
    if (!isSpecificEvidenceBoundarySentence(prose)) continue
    if (hasUnsupportedEvidenceBoundaryExpansion(prose) || hasUnsupportedCrossLanguageExpansion(prose)) continue
    if (input.revision && existingSectionBoundaries.has(normalizeLimitationSentence(prose))) continue
    return prose
  }
  return substantiveFallbackClosingBoundary()
}

function substantiveFallbackClosingBoundary(): string {
  return '现有证据仅覆盖本报告各章引用来源明确说明的对象、条件和时间，未覆盖的对象、场景和时期不能据此外推'
}

function closingSynthesisFromSections(
  sectionMarkdown: string,
  allowedClaimIds: ReadonlySet<string>,
  preferredClaimIds: string[]
): { sentence: string; claimIds: string[] } | undefined {
  const preferred = new Set(preferredClaimIds)
  const candidates: Array<{ sentence: string; claimIds: string[]; preferredCount: number }> = []
  for (const line of sectionMarkdown.split('\n')) {
    if (!line.trim() || /^#{1,6}\s/u.test(line.trim())) continue
    for (const sentence of splitCitationSentences(line)) {
      const claimIds = [...new Set([...sentence.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
        .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
        .map((claimId) => claimId.trim())
        .filter((claimId) => allowedClaimIds.has(claimId)))]
      const prose = sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '').trim()
      if (claimIds.length < 2 || prose.length < 20) continue
      if (!/^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着))/u.test(prose)) continue
      if (hasUnsafeStructuredSynthesis(prose) || isVagueConclusionSynthesis(prose)) continue
      candidates.push({
        sentence: `${prose.replace(/[。！？.!?；;]+$/u, '').trim()} [structured-claim:${claimIds.join(',')}]。`,
        claimIds,
        preferredCount: claimIds.filter((claimId) => preferred.has(claimId)).length
      })
    }
  }
  return candidates.sort((left, right) => right.preferredCount - left.preferredCount)[0]
}

export function closingSynthesisFromSectionFacts(
  sectionMarkdown: string,
  sections: ResearchReportBlueprintSection[],
  allowedClaimIds: ReadonlySet<string>,
  preferredClaimIds: string[] = []
): { sentence: string; claimIds: string[] } | undefined {
  const preferred = new Set(preferredClaimIds)
  const facts = sections.flatMap((section, sectionIndex) => {
    const body = previousSectionBody(sectionMarkdown, section.title)
    const seenClaimIds = new Set<string>()
    const sectionFacts: Array<{
      sectionIndex: number
      sectionTitle: string
      prose: string
      claimIds: string[]
    }> = []
    for (const sentence of splitCitationSentences(body.replace(/\n+/gu, ' '))) {
      const claimIds = [...new Set(sentenceClaimIds(sentence)
        .filter((claimId) => allowedClaimIds.has(claimId) && section.claimIds.includes(claimId)))]
      if (claimIds.length === 0 || claimIds.every((claimId) => seenClaimIds.has(claimId))) continue
      const prose = conciseStructuredFactForSynthesis(sentence)
      if (prose.length < 12 || isSpecificEvidenceBoundarySentence(prose)) continue
      if (/^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))/u.test(prose)) continue
      claimIds.forEach((claimId) => seenClaimIds.add(claimId))
      sectionFacts.push({
        sectionIndex,
        sectionTitle: section.title,
        prose,
        claimIds
      })
    }
    return sectionFacts
  }).sort((left, right) => left.sectionIndex - right.sectionIndex)
  const novelFacts = facts.filter((fact) => fact.claimIds.every((claimId) => !preferred.has(claimId)))
  const candidateFacts = new Set(novelFacts.map((fact) => fact.sectionTitle)).size >= 2 ? novelFacts : facts
  const requiredSectionCount = Math.min(3, new Set(candidateFacts.map((fact) => fact.sectionTitle)).size)
  const counterClaimIds = new Set(sections.flatMap((section) => section.argument.counterClaimIds))
  const isCounterFact = (fact: typeof candidateFacts[number]) => fact.claimIds.some((claimId) => counterClaimIds.has(claimId))
  const counter = candidateFacts.find(isCounterFact)
  const supporting = (counter && candidateFacts.find((fact) => (
    fact.claimIds.some((claimId) => !counter.claimIds.includes(claimId))
    && !isCounterFact(fact)
    && fact.sectionTitle === counter.sectionTitle
  ))) ?? (counter && candidateFacts.find((fact) => (
    fact.claimIds.some((claimId) => !counter.claimIds.includes(claimId)) && !isCounterFact(fact)
  )))
  if (supporting && counter && requiredSectionCount <= 2) {
    const claimIds = [...new Set([...supporting.claimIds, ...counter.claimIds])]
    return {
      sentence: ensureSentenceEnding(
        `综合来看，${supporting.prose}；但${counter.prose}，因此当前表现不能直接外推为未来趋势 [structured-claim:${claimIds.join(',')}]`
      ),
      claimIds
    }
  }
  const selectedFacts: typeof candidateFacts = []
  for (const candidate of candidateFacts) {
    if (selectedFacts.some((selected) => selected.sectionTitle === candidate.sectionTitle)) continue
    selectedFacts.push(candidate)
    if (selectedFacts.length >= requiredSectionCount) break
  }
  if (selectedFacts.length < 2) return undefined
  const claimIds = [...new Set(selectedFacts.flatMap((fact) => fact.claimIds))]
  const factClauses = selectedFacts.map((fact, index) => {
    const prefix = index === selectedFacts.length - 1 && index > 0 ? '而' : ''
    return `${prefix}“${sanitizeBlueprintProse(fact.sectionTitle)}”中${fact.prose}`
  })
  return {
    sentence: ensureSentenceEnding(
      `综合来看，${factClauses.join('，')}，这些结果回答的是不同维度，现有材料不能证明它们之间存在直接因果关系 [structured-claim:${claimIds.join(',')}]`
    ),
    claimIds
  }
}

export function closingSynthesisFromBlueprintClaims(
  sections: ResearchReportBlueprintSection[],
  allowedClaimIds: ReadonlySet<string>,
  preferredClaimIds: string[] = []
): { sentence: string; claimIds: string[] } | undefined {
  const preferred = new Set(preferredClaimIds)
  const candidates = sections.flatMap((section, sectionIndex) => {
    if (section.evidenceMode === 'evidence_gap') return []
    const claimIds = section.claimIds.filter((claimId) => allowedClaimIds.has(claimId))
    return claimIds.length > 0 ? [{ section, sectionIndex, claimIds }] : []
  })
  const novel = candidates.filter((candidate) => candidate.claimIds.some((claimId) => !preferred.has(claimId)))
  const requiredSectionCount = Math.min(3, candidates.length)
  const pool = novel.length >= requiredSectionCount ? novel : candidates
  const selected = pool.slice(0, requiredSectionCount)
  if (selected.length < 2) return undefined
  const claimIds = selected.map((candidate) => (
    candidate.claimIds.find((claimId) => !preferred.has(claimId)) ?? candidate.claimIds[0]
  )).filter((claimId): claimId is string => Boolean(claimId))
  if (claimIds.length !== selected.length) return undefined
  const sectionLabels = selected.map((candidate) => `“${sanitizeBlueprintProse(candidate.section.title)}”`)
  const sectionList = sectionLabels.length === 2
    ? sectionLabels.join('与')
    : `${sectionLabels.slice(0, -1).join('、')}与${sectionLabels.at(-1)}`
  return {
    sentence: ensureSentenceEnding(
      selected.length === 2
        ? `综合来看，${sectionList}需要分别判断，现有材料不能证明两个维度之间存在直接因果关系 [structured-claim:${claimIds.join(',')}]`
        : `综合来看，${sectionList}需要按各自明确的对象、条件和时间分别判断，现有材料不能证明这些维度之间存在直接因果关系 [structured-claim:${claimIds.join(',')}]`
    ),
    claimIds
  }
}

export function closingScenarioSynthesisFromSections(
  sectionMarkdown: string,
  contextualSections: Array<{ title: string; claimIds: string[] }>,
  allowedClaimIds: ReadonlySet<string>
): { sentence: string; claimIds: string[] } | undefined {
  if (!sectionMarkdown || contextualSections.length < 2) return undefined
  const facts = contextualSections.flatMap((section) => {
    const sectionBody = previousSectionBody(sectionMarkdown, section.title)
    for (const line of sectionBody.split('\n')) {
      for (const sentence of splitCitationSentences(line)) {
        const claimIds = [...new Set([...sentence.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
          .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
          .map((claimId) => claimId.trim())
          .filter((claimId) => allowedClaimIds.has(claimId) && section.claimIds.includes(claimId)))]
        if (claimIds.length !== 1) continue
        const prose = removeRepeatedScenarioLead(sentence
          .replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
          .replace(/[。！？.!?；;]+$/u, '')
          .trim(), section.title)
        if (prose.length < 12) continue
        if (/^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|现有证据|当前证据|现有材料)/u.test(prose)) continue
        return [{ title: section.title, prose, claimId: claimIds[0]! }]
      }
    }
    return []
  })
  if (facts.length !== contextualSections.length) return undefined
  const [first, ...remaining] = facts
  if (!first) return undefined
  const clauses = [
    `在“${first.title}”中，${first.prose}`,
    ...remaining.map((fact) => `而在“${fact.title}”中，${fact.prose}`)
  ]
  const claimIds = facts.map((fact) => fact.claimId)
  return {
    sentence: `区别在于，${clauses.join('，')} [structured-claim:${claimIds.join(',')}]。`,
    claimIds
  }
}

export function closingContextualSectionMappings(
  sections: ResearchReportBlueprintSection[]
): Array<{ title: string; claimIds: string[] }> {
  return sections.flatMap((section) => {
    if (!isContextualReportSection(section.title)) return []
    const claimIds = section.claimIds.length > 0
      ? section.claimIds
      : section.evidenceMode === 'conditional_application'
        ? section.contextClaimIds ?? []
        : []
    return claimIds.length > 0 ? [{ title: section.title, claimIds }] : []
  })
}

function closingFactFromSections(
  sectionMarkdown: string,
  preferredClaimIds: string[],
  excludedClaimIds: string[] = []
): string | undefined {
  const preferred = new Set(preferredClaimIds)
  const excluded = new Set(excludedClaimIds)
  if (!sectionMarkdown || preferred.size === 0) return undefined
  for (const line of sectionMarkdown.split('\n')) {
    if (!line.trim() || /^#{1,6}\s/u.test(line.trim())) continue
    for (const sentence of splitCitationSentences(line)) {
      const claimIds = [...sentence.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
        .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
        .map((claimId) => claimId.trim())
        .filter(Boolean)
      if (
        claimIds.length !== 1
        || !claimIds.some((claimId) => preferred.has(claimId))
        || claimIds.some((claimId) => excluded.has(claimId))
      ) continue
      const prose = sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '').trim()
      if (prose.length < 12 || /^(?:而|但是|但|相反|反而|然而|不过|因此|因而|所以|关键在于|区别在于|由此判断|综合判断)/u.test(prose)) continue
      return `${prose.replace(/[。！？.!?；;]+$/u, '').trim()} [structured-claim:${claimIds[0]}]。`
    }
  }
  return undefined
}

function ensureSentenceEnding(value: string): string {
  const trimmed = value.trim()
  return /[。！？.!?；;]$/u.test(trimmed) ? trimmed : `${trimmed}。`
}

function ensureClosingScopeCoverage(
  closing: { lead: string; conclusion: string; limitations: string },
  input: SynthesisWriterInput
): { lead: string; conclusion: string; limitations: string } {
  const conclusion = closing.conclusion
  const normalizedConclusion = normalizedClosingScopeText(conclusion)
  const missingTargets = (input.frame.alternativesToCompare ?? [])
    .filter((target) => !normalizedConclusion.includes(normalizedClosingScopeText(target)))
  const targetLimitation = missingTargets.length > 0
    ? `当前证据未充分覆盖${(input.frame.alternativesToCompare ?? []).join('、')}，不能生成这些对象之间的确定比较结论。`
    : ''
  const scopedLimitations = targetLimitation && !closing.limitations.includes(targetLimitation)
    ? `${closing.limitations}${targetLimitation}`
    : closing.limitations
  const limitationSentences = splitCitationSentences(scopedLimitations).filter((sentence) => sentence.trim().length >= 12)
  const limitationAdditions = defaultClosingLimitations(input)
    .filter((candidate) => !scopedLimitations.includes(candidate))
    .slice(0, Math.max(0, 3 - limitationSentences.length))
  return {
    ...closing,
    conclusion: closing.conclusion,
    limitations: `${scopedLimitations}${limitationAdditions.join('')}`
  }
}

function normalizedClosingScopeText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function defaultClosingLimitations(input: SynthesisWriterInput): string[] {
  const allowedDomains = input.brief.sourcePolicy.allowedDomains ?? []
  return uniqueLimitations([
    ...(allowedDomains.length > 0
      ? [`本报告按用户要求仅使用 ${allowedDomains.join('、')}，未使用其他来源交叉验证。`]
      : []),
    ...evidenceTopologyLimitations(input)
  ]).slice(0, 4)
}

function sanitizeClosingLimitations(value: string, input: SynthesisWriterInput): string {
  const modelLimitations = splitCitationSentences(value.replace(/\n+/gu, ''))
    .map((sentence) => sanitizeSpeculativeBoundaryTails(sentence))
    .map((sentence) => sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim())
    .filter((sentence) => sentence.length >= 12)
    .filter((sentence) => !isInternalResearchProcessLimitation(sentence))
    .filter((sentence) => /(?:仅使用|仅基于|来源|现有证据|当前证据|现有材料|仅(?:支持|覆盖|限于)|未(?:覆盖|说明|验证|讨论)|不能(?:据此)?外推)/u.test(sentence))
    .filter((sentence) => !hasUnsupportedEvidenceBoundaryExpansion(sentence))
  return uniqueLimitations([
    ...modelLimitations,
    ...defaultClosingLimitations(input)
  ]).slice(0, 4).map(ensureSentenceEnding).join('')
}

function centralAnswerObligations(input: SynthesisWriterInput): string[] {
  const text = `${input.brief.topic}\n${input.frame.centralQuestion}`
  const obligations: string[] = []
  if (/优势/u.test(text)) obligations.push('优势')
  if (/风险/u.test(text)) obligations.push('风险')
  const future = text.match(/未来[^，。；;\n]{0,12}?(?:走势|趋势|展望|预测)/u)?.[0]
  if (future) obligations.push(future)
  obligations.push(...(input.frame.alternativesToCompare ?? []))
  return [...new Set(obligations)]
}

function sectionRevisionContext(
  input: SynthesisWriterInput,
  section: ResearchReportBlueprintSection
): { previousBody: string; feedback: string[] } | undefined {
  if (!input.revision) return undefined
  const feedback = [
    ...input.revision.previousVerdict.blockingIssues,
    ...input.revision.previousVerdict.warnings,
    ...input.revision.previousVerdict.recommendedFixes
  ].filter((item) => feedbackTargetsSection(item, section.title) || /核心问题|推理|写作|过短|完整度|未来|走势|比较/u.test(item)).slice(0, 8)
  return {
    previousBody: previousSectionBody(input.revision.previousDraftMarkdown ?? '', section.title),
    feedback
  }
}

function previousSectionBody(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.trim() === `### ${title}`)
  if (start < 0) return ''
  const next = lines.slice(start + 1).findIndex((line) => /^#{2,3}\s+/u.test(line.trim()))
  return lines.slice(start + 1, next < 0 ? lines.length : start + 1 + next).join('\n').trim()
}

function finalizeSectionedDraft(
  markdown: string,
  input: SynthesisWriterInput,
  enforceSectionDepth = true,
  skippedDepthSections: ReadonlySet<string> = new Set()
): string {
  const safetyPrepared = prepareSectionedDraft(markdown, input)
  const closingRebuilt = rebuildClosingAfterSafetyCleanup(safetyPrepared, input)
  const numberSafe = sanitizeUnsupportedDraftNumbers(
    ensureFinalClosingLimitations(closingRebuilt, input),
    input
  )
  const finalNumberSafe = sanitizeUnsupportedDraftNumbers(
    rebuildClosingAfterSafetyCleanup(numberSafe, input),
    input
  )
  const finalMarkdown = restoreClosingSynthesisAfterSafetyCleanup(
    ensureFinalClosingBoundaryAfterSafety(finalNumberSafe),
    input
  )
  const finalClosingIssue = closingQualityIssue({
    lead: previousMainLead(finalMarkdown),
    conclusion: previousConclusionBody(finalMarkdown),
    limitations: previousSecondLevelBody(finalMarkdown, '局限与不确定性')
  })
  if (finalClosingIssue) throw new Error(finalClosingIssue)
  assertMinimumSectionClaimCoverage(finalMarkdown, input, skippedDepthSections)
  const depthInput = skippedDepthSections.size > 0 && input.reportContract
    ? {
        ...input,
        reportContract: {
          ...input.reportContract,
          requiredSections: input.reportContract.requiredSections
            .filter((section) => !skippedDepthSections.has(section.title))
        }
      }
    : input
  assertUsableModelDraft(finalMarkdown, depthInput, { enforceChineseProse: true, enforceSectionDepth })
  assertDraftFollowsBlueprint(finalMarkdown, input)
  assertSupportedDraftNumbers(finalMarkdown, input)
  assertSupportedDraftTechnicalTerms(finalMarkdown, input)
  assertSupportedDraftRecommendations(finalMarkdown, input)
  return finalMarkdown
}

export function restoreClosingSynthesisAfterSafetyCleanup(
  markdown: string,
  input: SynthesisWriterInput
): string {
  const title = conclusionSectionTitle(markdown)
  const conclusion = previousSecondLevelBody(markdown, title)
  const sentences = splitCitationSentences(conclusion.replace(/\n+/gu, ''))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim().length >= 12)
  const isCitedSynthesis = (sentence: string) => {
    const prose = sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim()
    return new Set(sentenceClaimIds(sentence)).size >= 2
      && /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))/u.test(prose)
  }
  if (sentences.some(isCitedSynthesis)) return markdown

  const fact = sentences.find((sentence) => new Set(sentenceClaimIds(sentence)).size === 1)
  const boundary = sentences.find(isSpecificEvidenceBoundarySentence)
  const blueprintSections = input.reportBlueprint?.sections ?? []
  const allowedClaimIds = new Set(usableClaimsForSynthesis(input).map((claim) => claim.id))
  if (!fact || !boundary || blueprintSections.length < 2 || allowedClaimIds.size < 2) return markdown

  const synthesis = closingSynthesisFromBlueprintClaims(
    blueprintSections,
    allowedClaimIds,
    sentenceClaimIds(fact)
  )?.sentence
  if (!synthesis || !isCitedSynthesis(synthesis)) return markdown

  const selected = new Set([fact, boundary])
  const remaining = sentences.filter((sentence) => !selected.has(sentence) && !isCitedSynthesis(sentence))
  return replaceSecondLevelBody(
    markdown,
    title,
    [fact, synthesis, boundary, ...remaining].map(ensureSentenceEnding).join('')
  )
}

function ensureFinalClosingBoundaryAfterSafety(markdown: string): string {
  const conclusion = previousConclusionBody(markdown)
  const hasBoundary = splitCitationSentences(conclusion.replace(/\n+/gu, ''))
    .some(isSpecificEvidenceBoundarySentence)
  return hasBoundary
    ? markdown
    : appendSectionSentences(markdown, conclusionSectionTitle(markdown), [ensureSentenceEnding(substantiveFallbackClosingBoundary())])
}

function rebuildClosingAfterSafetyCleanup(markdown: string, input: SynthesisWriterInput): string {
  const sectionMarkdown = previousSecondLevelBody(markdown, '主要发现')
  const closing = {
    lead: previousMainLead(markdown),
    conclusion: previousConclusionBody(markdown),
    limitations: previousSecondLevelBody(markdown, '局限与不确定性')
  }
  const rebuilt = ensurePublishableClosingDepth(
    ensureConcreteClosingLimitations(ensureClosingScopeCoverage(closing, input), sectionMarkdown, input.reportBlueprint?.sections ?? []),
    sectionMarkdown,
    input
  )
  return replaceSecondLevelBody(
    replaceSecondLevelBody(markdown, conclusionSectionTitle(markdown), rebuilt.conclusion),
    '局限与不确定性',
    rebuilt.limitations
  )
}

function replaceSecondLevelBody(markdown: string, title: string, body: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${title}`)
  if (start < 0) return markdown
  const next = lines.slice(start + 1).findIndex((line) => /^##\s+/u.test(line.trim()))
  const end = next < 0 ? lines.length : start + 1 + next
  lines.splice(start + 1, end - start - 1, '', body.trim(), '')
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function ensureFinalClosingLimitations(markdown: string, input: SynthesisWriterInput): string {
  if (!reportLimitationsDepthIssue(markdown, input.budget.preset)) return markdown
  const current = previousSecondLevelBody(markdown, '局限与不确定性')
  const existing = splitCitationSentences(current.replace(/\n+/gu, ''))
    .filter((sentence) => sentence.replace(/\[(?:claim|evidence):[^\]]+\]/gu, '').trim().length >= 12)
  const specificExistingCount = existing.filter((sentence) => !isGenericClosingLimitation(sentence)).length
  const normalizedExisting = new Set(existing.map(normalizeLimitationSentence))
  const candidates = (input.reportBlueprint?.sections ?? []).flatMap((section) => splitCitationSentences(
    previousSectionBody(markdown, section.title).replace(/\n+/gu, '')
  ))
    .filter(isSpecificEvidenceBoundarySentence)
    .map((sentence) => sentence.replace(/\[(?:claim|evidence):[^\]]+\]/gu, '').trim())
  const generated = (input.reportBlueprint?.sections ?? []).map((section) =>
    `现有证据仅覆盖“${section.title}”章节已经引用的对象与条件，未覆盖条件之外的实现、场景和时间范围，不能据此外推。`
  )
  const additions: string[] = []
  for (const candidate of [...candidates, ...generated]) {
    const normalized = normalizeLimitationSentence(candidate)
    if (!normalized || normalizedExisting.has(normalized)) continue
    normalizedExisting.add(normalized)
    additions.push(ensureSentenceEnding(candidate))
    if (specificExistingCount + additions.length >= 2) break
  }
  return appendSectionSentences(markdown, '局限与不确定性', additions)
}

function assertMinimumSectionClaimCoverage(
  markdown: string,
  input: SynthesisWriterInput,
  skippedSections: ReadonlySet<string>
): void {
  for (const section of input.reportBlueprint?.sections ?? []) {
    if (skippedSections.has(section.title)) continue
    const requiredClaimCount = requiredSectionClaimCount(section)
    if (requiredClaimCount === 0) continue
    const body = previousSectionBody(markdown, section.title)
    const allUsedClaimIds = new Set([...body.matchAll(/\[claim:([^\]]+)\]/gu)]
      .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
      .filter((claimId): claimId is string => Boolean(claimId)))
    const usedClaimIds = new Set([...allUsedClaimIds].filter((claimId) => section.claimIds.includes(claimId)))
    const usedContextClaimIds = new Set([...allUsedClaimIds].filter((claimId) => section.contextClaimIds?.includes(claimId)))
    const usedEvidenceClaimIds = isConditionalApplicationSection(section) ? usedContextClaimIds : usedClaimIds
    const assignedEvidenceClaimIds = sectionEvidenceClaimIds(section)
    if (usedEvidenceClaimIds.size < requiredClaimCount) {
      const cleanedExcerpt = body.replace(/\s+/gu, ' ').trim().slice(0, 600)
      throw new Error(`model draft section ${section.title} used only ${usedEvidenceClaimIds.size} of ${assignedEvidenceClaimIds.length} assigned claims after safety cleanup; at least ${requiredClaimCount} distinct assigned claims are required; cleanedExcerpt=${JSON.stringify(cleanedExcerpt)}`)
    }
    const visibleFactClaimIds = sectionVisibleFactClaimIds(body, section, input)
    const missingCoverageClaimIds = (section.coverageClaimIds ?? [])
      .filter((claimId) => !visibleFactClaimIds.has(claimId))
    if (missingCoverageClaimIds.length > 0) {
      const cleanedExcerpt = body.replace(/\s+/gu, ' ').trim().slice(0, 800)
      throw new Error(`model draft section ${section.title} omitted required coverage claims ${missingCoverageClaimIds.join(', ')} after safety cleanup; each hard-scope representative must appear as its own cited fact sentence; cleanedExcerpt=${JSON.stringify(cleanedExcerpt)}`)
    }
    const requiredVisibleFactCount = minimumVisibleFactCount(section)
    if (visibleFactClaimIds.size < requiredVisibleFactCount) {
      const cleanedExcerpt = body.replace(/\s+/gu, ' ').trim().slice(0, 800)
      throw new Error(`model draft section ${section.title} visibly delivered only ${visibleFactClaimIds.size} independent cited facts after safety cleanup; at least ${requiredVisibleFactCount} are required; cleanedExcerpt=${JSON.stringify(cleanedExcerpt)}`)
    }
    const contextIssue = sectionContextClaimUsageIssue(body, section, input)
    if (contextIssue) throw new Error(`${contextIssue} after safety cleanup`)
    const usedContextClaimIdsForFocus = [...allUsedClaimIds].filter((claimId) => section.contextClaimIds?.includes(claimId))
    const focusIssue = sectionClaimFocusIssue(
      section,
      new Set([...usedClaimIds, ...usedContextClaimIdsForFocus]),
      input,
      body
    )
    if (focusIssue) throw new Error(`${focusIssue} after safety cleanup`)
  }
}

export function sectionContextClaimUsageIssue(
  body: string,
  section: ResearchReportBlueprintSection,
  input?: SynthesisWriterInput
): string | undefined {
  const contextClaimIds = new Set(section.contextClaimIds ?? [])
  if (contextClaimIds.size === 0) return undefined
  const primaryClaimIds = new Set(section.claimIds)
  const conditionalApplication = isConditionalApplicationSection(section)
  const usedContextIds = new Set<string>()
  let usedContextClaim = false
  let usedConcreteContextSynthesis = false
  for (const sentence of splitCitationSentences(body.replace(/\n+/gu, ''))) {
    const claimIds = [...sentence.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
      .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
      .map((claimId) => claimId.trim())
      .filter(Boolean)
    const hasContext = claimIds.some((claimId) => contextClaimIds.has(claimId))
    if (!hasContext) continue
    claimIds.filter((claimId) => contextClaimIds.has(claimId)).forEach((claimId) => usedContextIds.add(claimId))
    usedContextClaim = true
    if (conditionalApplication) {
      const contextIdsInSentence = claimIds.filter((claimId) => contextClaimIds.has(claimId))
      const requiredContextCount = requiredConditionalContextClaimCount(section)
      const hasPrimary = claimIds.some((claimId) => primaryClaimIds.has(claimId))
      const isBoundSynthesis = new Set(contextIdsInSentence).size >= requiredContextCount
        && new Set(claimIds).size >= 2
        && (requiredContextCount >= 2 || hasPrimary)
      if (isBoundSynthesis) {
        if (!isSafeContextSynthesis(sentence)) {
          return `model draft section ${section.title} used mechanism premises to add an unsupported scene effect, applicability or strategy`
        }
        if (!isConservativeContextSynthesis(sentence)) usedConcreteContextSynthesis = true
      }
      continue
    }
    const hasPrimary = claimIds.some((claimId) => primaryClaimIds.has(claimId))
    if (!hasPrimary) {
      return `model draft section ${section.title} used a context claim as a standalone fact; context claims must appear only in a synthesis sentence that also cites this section's own claim`
    }
    if (!isSafeContextSynthesis(sentence)) {
      return `model draft section ${section.title} used a context claim to add an unsupported mechanism, effect, applicability or strategy`
    }
    if (!isConservativeContextSynthesis(sentence)) usedConcreteContextSynthesis = true
  }
  const requiresConcreteContext = sceneRequiresConcreteContextSynthesis(section, input)
  if (conditionalApplication && usedContextIds.size < requiredConditionalContextClaimCount(section)) {
    return `model draft section ${section.title} did not state enough assigned mechanism premises for a conditional scene analysis`
  }
  if (requiresConcreteContext && !usedContextClaim) {
    return `model draft section ${section.title} did not use any assigned context claim with its sparse direct scene evidence`
  }
  if (requiresConcreteContext && !usedConcreteContextSynthesis) {
    return `model draft section ${section.title} did not use any assigned context claim in a concrete conditional synthesis; a conservative evidence boundary alone does not answer the scene question`
  }
  return undefined
}

function sceneRequiresConcreteContextSynthesis(
  section: ResearchReportBlueprintSection,
  input?: SynthesisWriterInput
): boolean {
  if (!isContextualReportSection(section.title)) return false
  if (isConditionalApplicationSection(section)) {
    return input
      ? selectSceneContextClaims(section, input).length >= requiredConditionalContextClaimCount(section)
      : (section.contextClaimIds?.length ?? 0) >= requiredConditionalContextClaimCount(section)
  }
  if (!input) return section.claimIds.length < 2 && (section.contextClaimIds?.length ?? 0) > 0
  const claimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  const availablePrimaryClaims = section.claimIds
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
  const primaryClaims = selectSectionPromptClaims(section, availablePrimaryClaims, input)
    .slice(0, requiredSectionClaimCount(section))
  const primaryClaimsOverlap = primaryClaims.some((left, leftIndex) => primaryClaims.some((right, rightIndex) =>
    leftIndex < rightIndex && substantiallyOverlappingClaimText(left.text, right.text)
  ))
  const directEvidenceNeedsRepair = primaryClaims.length < 2 || primaryClaimsOverlap
  return directEvidenceNeedsRepair && selectSceneContextClaims(section, input).length > 0
}

function selectSceneContextClaims(
  section: ResearchReportBlueprintSection,
  input: SynthesisWriterInput
): ReturnType<typeof usableClaimsForSynthesis> {
  if (!isContextualReportSection(section.title) || !section.contextClaimIds?.length) return []
  const claimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  if (isConditionalApplicationSection(section)) {
    return section.contextClaimIds
      .map((claimId) => claimById.get(claimId))
      .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
      .filter(hasCompleteSynthesisClaimText)
      .sort((left, right) => sectionPromptClaimScore(right, input) - sectionPromptClaimScore(left, input))
  }
  const availablePrimaryClaims = section.claimIds
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
  const primaryClaims = selectSectionPromptClaims(section, availablePrimaryClaims, input)
    .slice(0, requiredSectionClaimCount(section))
  const primaryText = primaryClaims.map((claim) => `${claim.text}\n${claim.entities.join(' ')}`).join('\n')
  const focusContext = sectionFocusContext(input)
  const centralFocusGroups = [...new Map([
    input.brief.topic,
    input.frame.coreResearchThread,
    input.frame.centralQuestion
  ].flatMap((researchText) => researchDimensionFocusGroups(researchText, focusContext))
    .map((group) => [group.map((alias) => alias.normalize('NFKC').toLowerCase()).sort().join('|'), group] as const)).values()]
  const missingCentralFocusGroups = centralFocusGroups.filter((group) =>
    !coversResearchDimensionFocusGroups([group], primaryText)
  )
  const candidates = section.contextClaimIds
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
    .filter(hasCompleteSynthesisClaimText)
    .filter((claim) => primaryClaims.some((primaryClaim) => claimsShareSynthesisAnchor(primaryClaim, claim)))
    .map((claim) => ({
      claim,
      addedFocusCount: missingCentralFocusGroups.filter((group) =>
        coversResearchDimensionFocusGroups([group], `${claim.text}\n${claim.entities.join(' ')}`)
      ).length
    }))
    .sort((left, right) =>
      right.addedFocusCount - left.addedFocusCount ||
      sectionPromptClaimScore(right.claim, input) - sectionPromptClaimScore(left.claim, input)
    )
  const addsMissingCentralFocus = candidates.find((candidate) => candidate.addedFocusCount > 0)
  if (addsMissingCentralFocus) return [addsMissingCentralFocus.claim]
  const primaryClaimsOverlap = primaryClaims.some((left, leftIndex) => primaryClaims.some((right, rightIndex) =>
    leftIndex < rightIndex && substantiallyOverlappingClaimText(left.text, right.text)
  ))
  return primaryClaimsOverlap || primaryClaims.length < 2
    ? candidates.slice(0, 1).map((candidate) => candidate.claim)
    : []
}

function hasCompleteSynthesisClaimText(
  claim: ReturnType<typeof usableClaimsForSynthesis>[number]
): boolean {
  const text = claim.text.trim()
  const minimumLength = /[\u4e00-\u9fff]/u.test(text) ? 16 : 32
  if (text.length < minimumLength) return false
  if (/\b(?:and|or|but|because|if|when|while|with|without|using|including|as|to|from|of|for|the|a|an|receive|return|be|been|is|are|was|were)\s*$/iu.test(text)) return false
  const pairs: Array<[string, string]> = [['(', ')'], ['[', ']'], ['{', '}'], ['“', '”']]
  return pairs.every(([open, close]) => (text.split(open).length - 1) === (text.split(close).length - 1))
}

function claimsShareSynthesisAnchor(
  left: ReturnType<typeof usableClaimsForSynthesis>[number],
  right: ReturnType<typeof usableClaimsForSynthesis>[number]
): boolean {
  const leftAnchors = synthesisClaimAnchors(left)
  const rightAnchors = synthesisClaimAnchors(right)
  return leftAnchors.some((leftAnchor) => rightAnchors.some((rightAnchor) =>
    leftAnchor === rightAnchor || (
      Math.min(leftAnchor.length, rightAnchor.length) >= 4 &&
      (leftAnchor.includes(rightAnchor) || rightAnchor.includes(leftAnchor))
    )
  ))
}

function synthesisClaimAnchors(
  claim: ReturnType<typeof usableClaimsForSynthesis>[number]
): string[] {
  const generic = new Set([
    'this', 'that', 'these', 'those', 'when', 'where', 'which', 'response', 'responses',
    'source', 'sources', 'strong', 'weak', 'using', 'used', 'before', 'after', 'while', 'with', 'from'
  ])
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '')
  const entityAnchors = claim.entities.flatMap((entity) => [
    normalize(entity),
    ...(entity.match(/[A-Za-z][A-Za-z0-9-]{2,}/gu) ?? []).map(normalize)
  ])
  const technicalAnchors = (claim.text.match(/[A-Za-z][A-Za-z0-9-]{2,}/gu) ?? []).map(normalize)
  return [...new Set([...entityAnchors, ...technicalAnchors]
    .filter((anchor) => (/[^\x00-\x7F]/u.test(anchor) ? anchor.length >= 2 : anchor.length >= 3) && !generic.has(anchor)))]
}

function substantiallyOverlappingClaimText(left: string, right: string): boolean {
  const compact = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const compactLeft = compact(left)
  const compactRight = compact(right)
  const shorter = compactLeft.length <= compactRight.length ? compactLeft : compactRight
  const longer = compactLeft.length <= compactRight.length ? compactRight : compactLeft
  if (shorter.length >= 32 && longer.includes(shorter)) return true
  const tokens = (value: string) => new Set(value.normalize('NFKC').toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3))
  const leftTokens = tokens(left)
  const rightTokens = tokens(right)
  const smaller = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens
  const larger = leftTokens.size <= rightTokens.size ? rightTokens : leftTokens
  if (smaller.size >= 5) {
    const shared = [...smaller].filter((token) => larger.has(token)).length
    if (shared / smaller.size >= 0.8) return true
  }
  const shingles = (value: string) => {
    const characters = [...compact(value)]
    return new Set(characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`))
  }
  const leftShingles = shingles(left)
  const rightShingles = shingles(right)
  const smallerShingles = leftShingles.size <= rightShingles.size ? leftShingles : rightShingles
  const largerShingles = leftShingles.size <= rightShingles.size ? rightShingles : leftShingles
  if (smallerShingles.size < 28) return false
  const sharedShingles = [...smallerShingles].filter((shingle) => largerShingles.has(shingle)).length
  return sharedShingles / smallerShingles.size >= 0.64
}

function isConservativeContextSynthesis(sentence: string): boolean {
  const prose = sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
  return /(?:现有证据|当前证据|现有材料).{0,36}(?:没有直接陈述|未直接陈述|不能支持|不足以|不能据此)|不能据此(?:扩展|推出|推导|增加)/u.test(prose)
}

export function isSafeContextSynthesis(sentence: string): boolean {
  const prose = sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '').trim()
  if (isConservativeContextSynthesis(sentence)) return true
  const conditionalRelation = /(?:如果|若|当|在[^，。；;]{1,32}(?:条件|前提|场景)下)[^。；;]{4,180}(?:则|就|可以|可|不能|只能)/u.test(prose)
  const unsafeExpansion = /\d|例如|比如|譬如|最佳|建议|应该|应当|推荐|性能|效率|成本|开销|带宽|延迟|收益|哈希|版本化|优化|保证|确保|必然|所有场景|全部实现|完全(?:抑制|阻止|失效)|优先(?:生效|执行|采用)|由[^，。；;]{0,24}主导|无法(?:被)?触发|不再生效/u.test(prose)
  return /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))/u.test(prose)
    && conditionalRelation
    && !unsafeExpansion
    && !hasUnsupportedEvidenceBoundaryExpansion(prose)
}

function isSpecificEvidenceBoundarySentence(sentence: string): boolean {
  return /(?:现有证据|当前证据|现有材料|仅(?:支持|覆盖|限于)|(?:未|没有)(?:涉及|覆盖|说明|验证|讨论)|不足以|无法判断|不能(?:据此)?(?:扩展|推出|推导|增加|外推))/u.test(
    sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
  )
}

function usesContextClaimPairForSection(
  sectionTitle: string,
  claimIds: readonly string[],
  input: SynthesisWriterInput
): boolean {
  const used = new Set(claimIds)
  return (input.reportBlueprint?.sections ?? []).some((section) => {
    if (section.title !== sectionTitle) return false
    const usedContextCount = (section.contextClaimIds ?? []).filter((claimId) => used.has(claimId)).length
    if (isConditionalApplicationSection(section)) return usedContextCount >= 2
    return section.claimIds.some((claimId) => used.has(claimId)) && usedContextCount >= 1
  })
}

export function sectionClaimFocusIssue(
  section: ResearchReportBlueprintSection,
  usedClaimIds: ReadonlySet<string>,
  input: SynthesisWriterInput,
  body: string
): string | undefined {
  const focusGroups = researchDimensionFocusGroups(
    section.title,
    [
      input.brief.topic,
      input.frame.coreResearchThread,
      input.frame.centralQuestion,
      ...input.frame.coreQuestions.map((question) => question.text)
    ].join('\n')
  )
  if (focusGroups.length < 2) return undefined
  const claimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  const availableClaims = [...section.claimIds, ...(section.contextClaimIds ?? [])]
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
  const availableFacetMap = sectionFacetClaimMap(section, availableClaims, input)
  const enforceableFacets = new Set(availableFacetMap.map((item) => item.facet))
  const enforceableFocusGroups = focusGroups.filter((group) => {
    const facet = group[0]
    return Boolean(facet && enforceableFacets.has(facet))
  })
  if (enforceableFocusGroups.length < 2) return undefined
  const usedClaimText = [...usedClaimIds]
    .map((claimId) => claimById.get(claimId)?.text ?? '')
    .filter(Boolean)
    .join('\n')
  const missingClaimFacets = enforceableFocusGroups
    .filter((group) => !coversResearchDimensionFocusGroups([group], usedClaimText))
    .map((group) => group[0])
    .filter(Boolean)
  if (missingClaimFacets.length > 0) {
    const facetClaimHints = availableFacetMap
      .filter((item) => missingClaimFacets.includes(item.facet))
    return `model draft section ${section.title} does not cover every explicit title facet with its used claims; missing facets: ${missingClaimFacets.join(', ')}; use mapped claims: ${JSON.stringify(facetClaimHints)}`
  }
  const usedClaims = [...usedClaimIds]
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
  const facetClaimMap = sectionFacetClaimMap(section, usedClaims, input)
  const bodySentences = splitCitationSentences(body.replace(/\n+/gu, ''))
  const missingBodyFacets = enforceableFocusGroups.flatMap((group) => {
    const facet = group[0]
    const mappedClaimIds = new Set(facetClaimMap.find((item) => item.facet === facet)?.claimIds ?? [])
    const delivered = bodySentences.some((sentence) => {
      const sentenceClaimIds = [...sentence.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
        .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
        .filter(Boolean)
      const visibleProse = sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '').trim()
      return visibleProse.length >= 12 && sentenceClaimIds.some((claimId) => mappedClaimIds.has(claimId))
    })
    return delivered || !facet ? [] : [facet]
  })
  if (missingBodyFacets.length > 0) {
    const facetClaimHints = facetClaimMap.filter((item) => missingBodyFacets.includes(item.facet))
    return `model draft section ${section.title} uses supporting claims for every title facet but does not visibly deliver their mapped claim sentences; missing facets: ${missingBodyFacets.join(', ')}; use mapped claims: ${JSON.stringify(facetClaimHints)}`
  }
  return undefined
}

function sectionFacetClaimMap(
  section: ResearchReportBlueprintSection,
  claims: ReturnType<typeof usableClaimsForSynthesis>,
  input: SynthesisWriterInput
): Array<{ facet: string; claimIds: string[] }> {
  const groups = researchDimensionFocusGroups(
    section.title,
    [
      input.brief.topic,
      input.frame.coreResearchThread,
      input.frame.centralQuestion,
      ...input.frame.coreQuestions.map((question) => question.text)
    ].join('\n')
  )
  if (groups.length < 2) return []
  const allowedClaimIds = new Set([...section.claimIds, ...(section.contextClaimIds ?? [])])
  return groups.map((group) => ({
    facet: group[0] ?? '',
    claimIds: claims
      .filter((claim) => allowedClaimIds.has(claim.id))
      .filter((claim) => coversResearchDimensionFocusGroups([group], `${claim.text}\n${claim.entities.join(' ')}`))
      .map((claim) => claim.id)
  })).filter((item) => item.facet && item.claimIds.length > 0)
}

function sectionAllowsDirectComparison(
  section: ResearchReportBlueprintSection,
  input: SynthesisWriterInput
): boolean {
  return researchDimensionFocusGroups(
    section.title,
    sectionFocusContext(input)
  ).length > 1
}

function sectionFocusContext(input: SynthesisWriterInput): string {
  return [
    input.brief.topic,
    input.frame.coreResearchThread,
    input.frame.centralQuestion,
    ...input.frame.coreQuestions.map((question) => question.text)
  ].join('\n')
}

function selectSectionPromptClaims(
  section: ResearchReportBlueprintSection,
  claims: ReturnType<typeof usableClaimsForSynthesis>,
  input: SynthesisWriterInput
): ReturnType<typeof usableClaimsForSynthesis> {
  const counterClaimIds = new Set(section.argument.counterClaimIds)
  const coverageClaimIds = new Set(section.coverageClaimIds ?? [])
  const selectionScore = (claim: ReturnType<typeof usableClaimsForSynthesis>[number]) =>
    sectionPromptClaimScore(claim, input)
      + (counterClaimIds.has(claim.id) ? 900 : 0)
      + (coverageClaimIds.has(claim.id) ? 1_800 : 0)
  const forcedClaims = claims.filter((claim) => coverageClaimIds.has(claim.id))
  const facetMap = sectionFacetClaimMap(section, claims, input)
  if (facetMap.length < 2) {
    const ordered = [...claims].sort((left, right) => selectionScore(right) - selectionScore(left))
    const distinct = ordered.filter((claim, index, ranked) => !ranked.slice(0, index).some((preferred) =>
      substantiallyOverlappingClaimText(preferred.text, claim.text)
    ))
    const targetClaimCount = Math.min(
      Math.max(requiredSectionClaimCount(section), forcedClaims.length),
      ordered.length
    )
    const ranked = distinct.length >= targetClaimCount
      ? distinct
      : [...distinct, ...ordered.filter((claim) => !distinct.some((candidate) => candidate.id === claim.id))]
    const selected = uniqueClaims([
      ...forcedClaims,
      ...ranked.filter((claim) => !coverageClaimIds.has(claim.id))
    ])
    return isContextualReportSection(section.title)
      ? selected.slice(0, Math.max(targetClaimCount, minimumVisibleFactCount(section)))
      : selected.slice(0, 6)
  }
  const claimById = new Map(claims.map((claim) => [claim.id, claim]))
  const selected: ReturnType<typeof usableClaimsForSynthesis> = [...forcedClaims]
  const selectedIds = new Set(forcedClaims.map((claim) => claim.id))
  // 先处理候选最少的分面，避免宽泛 claim 抢走多个分面的唯一完整证据。
  const orderedFacets = [...facetMap].sort((left, right) =>
    left.claimIds.length - right.claimIds.length
  )
  for (const facet of orderedFacets) {
    const candidates = facet.claimIds
      .map((claimId) => claimById.get(claimId))
      .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
      .sort((left, right) => selectionScore(right) - selectionScore(left))
    const claim = candidates.find((candidate) => !selectedIds.has(candidate.id)) ?? candidates[0]
    if (!claim || selectedIds.has(claim.id)) continue
    selected.push(claim)
    selectedIds.add(claim.id)
  }
  const targetClaimCount = Math.max(
    requiredSectionClaimCount(section),
    minimumVisibleFactCount(section),
    forcedClaims.length
  )
  if (selected.length < targetClaimCount) {
    const supplements = [...claims]
      .sort((left, right) => selectionScore(right) - selectionScore(left))
      .filter((claim) => !selectedIds.has(claim.id))
    for (const claim of supplements) {
      selected.push(claim)
      selectedIds.add(claim.id)
      if (selected.length >= targetClaimCount) break
    }
  }
  return selected.length >= targetClaimCount ? selected : claims.slice(0, 6)
}

function requiredSectionClaimCount(section: ResearchReportBlueprintSection): number {
  if (isConditionalApplicationSection(section)) return requiredConditionalContextClaimCount(section)
  return Math.min(3, section.claimIds.length)
}

function isConditionalApplicationSection(section: ResearchReportBlueprintSection): boolean {
  return section.evidenceMode === 'conditional_application'
}

function sectionEvidenceClaimIds(section: ResearchReportBlueprintSection): string[] {
  return isConditionalApplicationSection(section)
    ? section.contextClaimIds ?? []
    : section.claimIds
}

export function sectionRetryClaims(
  section: ResearchReportBlueprintSection,
  input: SynthesisWriterInput
): ReturnType<typeof usableClaimsForSynthesis> {
  const usableById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  if (isConditionalApplicationSection(section)) {
    const primaryClaims = section.claimIds
      .map((claimId) => usableById.get(claimId))
      .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
      .slice(0, 1)
    const contextClaims = selectSceneContextClaims(section, input)
      .slice(0, requiredConditionalContextClaimCount(section))
    return uniqueClaims([...primaryClaims, ...contextClaims])
  }
  return selectSectionPromptClaims(
    section,
    sectionEvidenceClaimIds(section)
      .map((claimId) => usableById.get(claimId))
      .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim)),
    input
  ).slice(0, Math.max(2, requiredSectionClaimCount(section), minimumVisibleFactCount(section)))
}

function sectionRetryContextClaims(
  section: ResearchReportBlueprintSection,
  input: SynthesisWriterInput
): ReturnType<typeof usableClaimsForSynthesis> {
  if (isConditionalApplicationSection(section)) return []
  if (!sceneRequiresConcreteContextSynthesis(section, input)) return []
  return selectSceneContextClaims(section, input)
}

function uniqueClaims<T extends { id: string }>(claims: T[]): T[] {
  const seen = new Set<string>()
  return claims.filter((claim) => {
    if (seen.has(claim.id)) return false
    seen.add(claim.id)
    return true
  })
}

function sectionPromptClaimScore(
  claim: ReturnType<typeof usableClaimsForSynthesis>[number],
  input: SynthesisWriterInput
): number {
  const text = claim.text
  let score = text.length >= 70 && text.length <= 320 ? 100 : text.length >= 40 ? 40 : -80
  if (claim.entities.length > 0) score += 80
  if (claim.critical) score += 40
  if ((claim.claimType === 'metric' || claim.claimType === 'date') && /\d/u.test(text)) score += 60
  if (claim.claimType === 'fact' && claim.entities.length === 0 && text.length < 100 && /\d/u.test(text)) score -= 220
  if (claim.claimType === 'quote' || claim.claimType === 'opinion' || claim.claimType === 'inference') {
    const sentenceCount = text.split(/[。！？!?]|\.(?=\s|$)/u).map((sentence) => sentence.trim()).filter(Boolean).length
    if (text.length > 260) score -= 360
    if (sentenceCount > 1) score -= Math.min(480, (sentenceCount - 1) * 160)
  }
  return score + sectionPromptClaimSourceScore(claim, input)
}

function sectionPromptClaimSourceScore(
  claim: ReturnType<typeof usableClaimsForSynthesis>[number],
  input: Pick<SynthesisWriterInput, 'sources' | 'evidenceSpans'>
): number {
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  let score = -120
  for (const spanId of claim.supportSpanIds) {
    const span = spanById.get(spanId)
    const source = span ? sourceById.get(span.sourceId) : undefined
    if (!span || !source || !canCiteEvidenceSpan(span, source)) continue
    if (isEligibleStrongWebEvidence(source, span)) score = Math.max(score, 360)
    else if (source.reliability === 'high') score = Math.max(score, 220)
    else if (source.reliability === 'medium') score = Math.max(score, 40)
    else score = Math.max(score, -80)
  }
  if ((claim.claimType === 'inference' || claim.claimType === 'opinion') && score < 220) score -= 120
  return score
}

export function prepareSectionedDraft(markdown: string, input: SynthesisWriterInput): string {
  const normalized = normalizeDanglingProseEndings(normalizeDraftCitationPlaceholders(normalizeModelDraftSections(
    stripRuntimeGeneratedDraftSections(stripMarkdownFence(markdown).trim()),
    input
  ), input))
  const claimBound = normalizeSectionEvidencePlaceholdersToClaims(normalized, input)
  const usableClaims = usableClaimsForSynthesis(input)
  const validClaimIds = new Set(usableClaims.map((claim) => claim.id))
  const knownClaimSafe = removeUnknownClaimSentences(claimBound, validClaimIds)
  const canonicalFactSafe = canonicalizeCitedFacts(knownClaimSafe, input)
  const internalStateSafe = removeRawInternalStateSentences(canonicalFactSafe)
  const proseSafe = removeDanglingAndScaffoldSentences(internalStateSafe)
  const contractComplete = ensureReportContractSections(proseSafe, input, usableClaims)
  const numberSafe = sanitizeUnsupportedDraftNumbers(contractComplete, input)
  const technicalSafe = sanitizeUnsupportedDraftTechnicalTerms(numberSafe, input)
  const paragraphCitationSafe = propagateSupportedParagraphClaimCitations(technicalSafe, input)
  const citationSafe = sanitizeUncitedDraftSentences(paragraphCitationSafe)
  const placementSafe = repairDraftClaimPlacement(citationSafe, input)
  const finalCitationSafe = sanitizeUncitedDraftSentences(placementSafe)
  const synthesisRiskSafe = sanitizeUnsupportedHighRiskSynthesis(finalCitationSafe, input)
  const contextComplete = ensureRequiredContextClaimSynthesis(synthesisRiskSafe, input)
  const contextConcise = removeRedundantConservativeContextSynthesis(contextComplete, input)
  const synthesisComplete = ensureGroundedDirectSectionSynthesis(contextConcise, input)
  const ownershipSafe = ensureBlueprintClaimAnchors(synthesisComplete, input)
  const coverageBoundarySafe = ensureBlueprintCoverageBoundaries(ownershipSafe, input)
  const finalMarkdown = sanitizeUnrequestedDraftRecommendations(repairDanglingConclusionConnectors(
    ensureFinalScopeCoverage(repairDraftClaimPlacement(coverageBoundarySafe, input), input)
  ), input).replace(/[（(]\s*[)）]/gu, '')
  return finalMarkdown
}

export function propagateSupportedParagraphClaimCitations(
  markdown: string,
  input: SynthesisWriterInput
): string {
  const claimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  return markdown.split('\n').map((line) => {
    if (!line.trim() || /^\s*#{1,6}\s/u.test(line)) return line
    const sentences = splitCitationSentences(line)
    if (sentences.length < 2) return line
    const repaired = [...sentences]
    for (let citedIndex = 0; citedIndex < repaired.length; citedIndex += 1) {
      const citedSentence = repaired[citedIndex] ?? ''
      const claimIds = claimIdsFromDraftSentence(citedSentence)
      if (claimIds.length === 0) continue
      for (let candidateIndex = citedIndex - 1; candidateIndex >= 0; candidateIndex -= 1) {
        const candidate = repaired[candidateIndex] ?? ''
        if (claimIdsFromDraftSentence(candidate).length > 0) break
        if (/^\s*(?:因此|因而|所以|由此|关键在于|区别在于|综合|总体)/u.test(candidate)) break
        const supportedClaimIds = claimIds.filter((claimId) => {
          const claim = claimById.get(claimId)
          if (!claim) return false
          const supportTexts = [
            claim.text,
            ...claim.supportSpanIds.map((spanId) => spanById.get(spanId)?.text ?? '').filter(Boolean)
          ]
          const prose = candidate.replace(/\[(?:structured-claim|claim|evidence):[^\]]+\]/gu, '').trim()
          return prose.length >= 8 &&
            isResearchTextRelevant(claim.text, prose) &&
            assessClaimFaithfulness(prose, supportTexts).faithful
        })
        if (supportedClaimIds.length === 0) break
        repaired[candidateIndex] = `${candidate.trimEnd()} ${supportedClaimIds
          .map((claimId) => `[claim:${claimId}]`)
          .join('')}`
      }
    }
    return repaired.join('').trim()
  }).join('\n')
}

function claimIdsFromDraftSentence(sentence: string): string[] {
  return [...new Set([...sentence.matchAll(/\[(?:structured-claim|claim|evidence):([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter(Boolean))]
}

export function removeDanglingAndScaffoldSentences(markdown: string): string {
  return markdown.split('\n').map((line) => {
    if (/^\s*#{1,6}\s/u.test(line) || !line.trim()) return line
    return splitCitationSentences(line)
      .filter((sentence) => {
        const prose = sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim()
        return !/^(?:否则|反之)[，,]/u.test(prose) && !hasInternalSynthesisScaffold(sentence)
      })
      .join('')
      .trim()
  }).join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

export function sanitizeUnsupportedHighRiskSynthesis(markdown: string, input: SynthesisWriterInput): string {
  const claimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const highRiskRelations: Array<{ prose: RegExp; support: RegExp }> = [
    {
      prose: /必须.{0,20}(?:使用|采用|选择|配置|设置|部署|启用|禁用)/u,
      support: /(?:必须.{0,20}(?:使用|采用|选择|配置|设置|部署|启用|禁用)|\bmust\b.{0,40}\b(?:use|choose|configure|deploy|enable|disable)\b|\brequired\b.{0,30}\b(?:use|using|configure|deploy))/iu
    },
    { prose: /互斥/u, support: /互斥|mutually\s+exclusive/iu },
    { prose: /互补/u, support: /互补|complement(?:ary)?/iu },
    { prose: /(?:彼此|相互)?独立(?:于)?/u, support: /(?:彼此|相互)?独立(?:于)?|independent(?:ly)?(?:\s+of)?/iu },
    { prose: /无(?:直接)?因果/u, support: /无(?:直接)?因果|no\s+direct\s+causal|not\s+causally\s+related/iu },
    { prose: /(?:未|没有|不曾).{0,16}(?:抑制|阻碍|阻止)/u, support: /(?:未|没有|不曾).{0,16}(?:抑制|阻碍|阻止)|(?:did|does|do|has|have|had)\s+not.{0,24}(?:suppress|inhibit|prevent|impede)/iu },
    { prose: /权衡/u, support: /权衡|trade[ -]?off/iu },
    { prose: /影响/u, support: /影响|affect|impact/iu },
    { prose: /(?:驱动|促成|促进|归因|指向)/u, support: /驱动|促成|促进|归因|指向|\bdrive|drives|driven|promot|contribut|attribute/iu },
    { prose: /(?:结构性|直接|显著)?关联/u, support: /(?:结构性|直接|显著)?关联|association|relationship|related/iu },
    {
      prose: /(?:通常|往往|一般).{0,40}(?:需要|导致|推高|推低|意味着|表明|反映|说明)|(?:从而|进而)?(?:推高|推低)/u,
      support: /(?:通常|往往|一般).{0,40}(?:需要|导致|推高|推低|意味着|表明|反映|说明)|(?:从而|进而)?(?:推高|推低)|(?:typically|usually|generally).{0,40}(?:require|lead|raise|lower|mean|indicat|reflect|suggest)/iu
    },
    {
      prose: /(?:表明|说明|反映|意味着|由此判断)[^。！？!?；;]{0,64}(?:较低|较高|稳健|健康|安全|强劲|脆弱|良好|不佳|领先|落后)/u,
      support: /(?:表明|说明|反映|意味着|由此判断)[^。！？!?；;]{0,64}(?:较低|较高|稳健|健康|安全|强劲|脆弱|良好|不佳|领先|落后)|(?:indicat|suggest|reflect|mean)[^.!?;]{0,64}(?:low|high|stable|healthy|safe|strong|fragile|good|poor|leading|lagging)/iu
    },
    {
      prose: /(?:未|没有|并未)(?:因[^。！？!?；;]{1,40}而)?[^。！？!?；;]{0,32}(?:显著)?(?:增加|加剧|降低|改善|削弱|提升|改变)/u,
      support: /(?:未|没有|并未)(?:因[^。！？!?；;]{1,40}而)?[^。！？!?；;]{0,32}(?:显著)?(?:增加|加剧|降低|改善|削弱|提升|改变)|(?:did|does|do|has|have|had)\s+not[^.!?;]{0,64}(?:increase|worsen|reduce|improve|weaken|raise|change)/iu
    },
    {
      prose: /[^。！？!?；;]{2,48}(?:之间)?存在(?:张力|矛盾)/u,
      support: /[^。！？!?；;]{2,48}(?:之间)?存在(?:张力|矛盾)|(?:tension|conflict)\s+between/iu
    },
    {
      prose: /(?:一旦|若|如果).{0,80}(?:可能|会).{0,40}(?:转向|下降|减弱|增加|恶化)/u,
      support: /(?:一旦|若|如果).{0,80}(?:可能|会).{0,40}(?:转向|下降|减弱|增加|恶化)|(?:if|once).{0,80}(?:may|might|will|would|could).{0,40}(?:shift|turn|decline|weaken|increase|worsen)/iu
    }
  ]
  return markdown.split('\n').map((line) => {
    if (/^\s*#{1,6}\s/u.test(line) || !line.trim()) return line
    return splitCitationSentences(line).filter((sentence) => {
      const prose = sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim()
      if (isSpecificEvidenceBoundarySentence(sentence)) return true
      if (isEpistemicallyBoundedRelation(prose)) return true
      const triggeredRelations = highRiskRelations.filter((relation) => relation.prose.test(prose))
      if (triggeredRelations.length === 0) return true
      const claimIds = sentenceClaimIds(sentence)
      if (claimIds.length === 0) return false
      const claims = claimIds
        .map((claimId) => claimById.get(claimId))
        .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
      const support = [
        ...claims.map((claim) => claim.text),
        ...claims.flatMap((claim) => claim.supportSpanIds.map((spanId) => spanById.get(spanId)?.text ?? ''))
      ].join('\n')
      return triggeredRelations.every((relation) => relation.support.test(support))
    }).join('').trim()
  }).join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

export function ensureGroundedDirectSectionSynthesis(markdown: string, input: SynthesisWriterInput): string {
  const quickDiagnostic = input.budget.preset === 'quick'
  const reviewedSectionIds = new Set(input.revision?.targets?.sectionIds ?? [])
  if (!quickDiagnostic && reviewedSectionIds.size === 0) return markdown
  const usableClaimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  let result = markdown
  for (const section of input.reportBlueprint?.sections ?? []) {
    if (section.evidenceMode && section.evidenceMode !== 'direct') continue
    if (!quickDiagnostic && !reviewedSectionIds.has(section.id)) continue
    const body = previousSectionBody(result, section.title)
    const signals = reportArgumentSignals(body)
    if (signals.hasSynthesis || signals.hasDirectComparison) continue
    const assignedClaimIds = new Set(section.claimIds)
    const seenClaimIds = new Set<string>()
    const facts = splitCitationSentences(body.replace(/\n+/gu, ' ')).flatMap((sentence) => {
      if (isSpecificEvidenceBoundarySentence(sentence)) return []
      const ids = sentenceClaimIds(sentence).filter((claimId) => assignedClaimIds.has(claimId))
      if (new Set(ids).size !== 1 || seenClaimIds.has(ids[0]!)) return []
      const prose = removeRepeatedScenarioLead(
        sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim(),
        section.title
      ).replace(/[。！？.!?；;]+/gu, '，').replace(/[，,\s]+$/u, '').trim()
      if (prose.length < 12) return []
      seenClaimIds.add(ids[0]!)
      return [{ claimId: ids[0]!, prose }]
    }).slice(0, 2)
    if (facts.length < 2) continue
    const factClaimIds = facts.map((fact) => fact.claimId)
    const synthesis = quickDiagnostic
      ? ensureSentenceEnding(
          `由此判断，在“${section.title}”中，${facts[0]!.prose}，同时，${facts[1]!.prose} [claim:${factClaimIds.join(',')}]`
        )
      : (() => {
          const factClaims = factClaimIds.flatMap((claimId) => {
            const claim = usableClaimById.get(claimId)
            return claim ? [claim] : []
          })
          if (factClaims.length < 2) return ''
          const bounded = boundedDirectRecoverySynthesis(section, factClaims, input)
          return ensureSentenceEnding(`${bounded.answer} [claim:${factClaimIds.join(',')}]`)
        })()
    if (!synthesis) continue
    result = quickDiagnostic
      ? appendThirdLevelSectionParagraph(result, section.title, synthesis)
      : prependSectionParagraph(result, section.title, synthesis)
  }
  return result
}

export function normalizeSectionEvidencePlaceholdersToClaims(
  markdown: string,
  input: SynthesisWriterInput
): string {
  const allowedClaimIds = new Set(input.reportBlueprint?.sections.flatMap((section) => [
    ...section.claimIds,
    ...(section.contextClaimIds ?? [])
  ]) ?? [])
  const claimIdsBySpan = new Map<string, string[]>()
  for (const claim of usableClaimsForSynthesis(input)) {
    if (allowedClaimIds.size > 0 && !allowedClaimIds.has(claim.id)) continue
    for (const spanId of claim.supportSpanIds) {
      const claimIds = claimIdsBySpan.get(spanId) ?? []
      claimIds.push(claim.id)
      claimIdsBySpan.set(spanId, claimIds)
    }
  }
  return markdown.replace(/\[evidence:([^\]]+)\]/gu, (_placeholder, rawSpanId: string) => {
    const spanId = rawSpanId.trim()
    const claimId = claimIdsBySpan.get(spanId)?.[0]
    return claimId ? `[claim:${claimId}]` : ''
  })
}

export function ensureSparseSectionEvidenceBoundaries(markdown: string, input: SynthesisWriterInput): string {
  let result = markdown
  for (const section of input.reportBlueprint?.sections ?? []) {
    if (section.claimIds.length !== 1) continue
    const body = previousSectionBody(result, section.title)
    const signals = reportArgumentSignals(body)
    const evidenceCount = [...body.matchAll(/\[claim:[^\]]+\]/gu)].length
    const minimumChars = minimumSectionChars(section)
    if (evidenceCount === 0 || signals.sentences < 1 || signals.sentences >= 5) continue
    if (reportArgumentMeetsDepth({ markdown: body, minimumChars, evidenceCount, allowTerseArgument: false })) continue
    const additions: string[] = []
    if (!signals.hasSynthesis) {
      additions.push('因此，上述事实只能支持已经明确描述的局部判断。')
    }
    if (!signals.hasEvidenceBoundary) {
      additions.push('这一判断只限于本章已经引用的对象和条件，其他实现和场景是否相同仍无法由现有材料回答。')
    }
    const projected = reportArgumentSignals([body, ...additions].join('\n\n'))
    if (projected.sentences < 3 || projected.chars < 140) {
      additions.push('现有材料不足以据此推导完整流程或普遍策略。')
    }
    const novelAdditions = additions.filter((paragraph) => !body.includes(paragraph))
    if (novelAdditions.length === 0) continue
    result = appendThirdLevelSectionParagraph(
      result,
      section.title,
      novelAdditions.join('\n\n')
    )
  }
  return result
}

export function ensureBlueprintClaimAnchors(markdown: string, input: SynthesisWriterInput): string {
  const blueprint = input.reportBlueprint
  if (!blueprint) return markdown
  const claimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  const chineseReport = /中文|Chinese/iu.test(`${input.brief.outputFormat}\n${input.brief.userIntent}`)
  let result = markdown
  for (const section of blueprint.sections) {
    let body = previousSectionBody(result, section.title)
    const coverageClaimIds = section.coverageClaimIds ?? []
    for (const claimId of coverageClaimIds) {
      if (body.includes(`[claim:${claimId}]`)) continue
      const claim = claimById.get(claimId)
      if (!claim || (chineseReport && !/[\u4e00-\u9fff]/u.test(claim.text))) continue
      const claimText = comparisonClaimTextForPrompt(claim.text, input).replace(/[。！？.!?；;]+$/u, '').trim()
      if (!claimText) continue
      result = prependSectionParagraph(result, section.title, `${claimText} [claim:${claim.id}]。`)
      body = previousSectionBody(result, section.title)
    }
    const usesAssignedClaim = section.claimIds.some((claimId) => body.includes(`[claim:${claimId}]`))
    if (usesAssignedClaim) continue
    const anchorClaim = section.claimIds
      .map((claimId) => claimById.get(claimId))
      .find((claim) => claim && (!chineseReport || /[\u4e00-\u9fff]/u.test(claim.text)))
    if (!anchorClaim) continue
    const claimText = comparisonClaimTextForPrompt(anchorClaim.text, input).replace(/[。！？.!?；;]+$/u, '').trim()
    if (!claimText) continue
    result = prependSectionParagraph(
      result,
      section.title,
      `${claimText} [claim:${anchorClaim.id}]。`
    )
  }
  return result
}

export function ensureBlueprintCoverageBoundaries(markdown: string, input: SynthesisWriterInput): string {
  let result = markdown
  for (const section of input.reportBlueprint?.sections ?? []) {
    const boundaries = section.limitations
      .filter((limitation) => !isInternalResearchProcessLimitation(limitation))
      .filter(hasExplicitEvidenceGapBoundary)
    for (const boundary of boundaries) {
      const body = previousSectionBody(result, section.title)
      if (body.includes(boundary)) continue
      result = appendThirdLevelSectionParagraph(result, section.title, ensureSentenceEnding(boundary))
    }
  }
  return result
}

export function ensureRequiredContextClaimSynthesis(markdown: string, input: SynthesisWriterInput): string {
  let result = markdown
  const claimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  for (const section of input.reportBlueprint?.sections ?? []) {
    if (!sceneRequiresConcreteContextSynthesis(section, input) || !section.contextClaimIds?.length) continue
    let body = previousSectionBody(result, section.title)
    if (isConditionalApplicationSection(section)) {
      const requiredContextCount = requiredConditionalContextClaimCount(section)
      const contextClaims = selectSceneContextClaims(section, input).slice(0, requiredContextCount)
      if (contextClaims.length < requiredContextCount) continue
      const visibleContextClaimIds = sectionVisibleFactClaimIds(body, section, input)
      for (const claim of contextClaims) {
        if (visibleContextClaimIds.has(claim.id)) continue
        const fact = citedClaimFactProse(result, claim.id, comparisonClaimTextForPrompt(claim.text, input))
        if (!fact) continue
        result = appendThirdLevelSectionParagraph(
          result,
          section.title,
          ensureSentenceEnding(`${fact} [claim:${claim.id}]`)
        )
        visibleContextClaimIds.add(claim.id)
      }
      body = previousSectionBody(result, section.title)
      const primaryClaimId = section.claimIds.find((claimId) => sentenceClaimIds(body).includes(claimId))
        ?? section.claimIds[0]
      const requiredClaimIds = [
        ...(primaryClaimId ? [primaryClaimId] : []),
        ...contextClaims.map((claim) => claim.id)
      ]
      const hasConcreteConditionalSynthesis = splitCitationSentences(body.replace(/\n+/gu, ''))
        .some((sentence) => {
          const usedClaimIds = new Set(sentenceClaimIds(sentence))
          return requiredClaimIds.every((claimId) => usedClaimIds.has(claimId))
            && isSafeContextSynthesis(sentence)
            && !isConservativeContextSynthesis(sentence)
        })
      if (!hasConcreteConditionalSynthesis) {
        result = appendThirdLevelSectionParagraph(
          result,
          section.title,
          groundedConditionalApplicationAnswer(section, contextClaims, primaryClaimId)
        )
      }
      continue
    }
    const usedClaimIds = new Set(sentenceClaimIds(body))
    const alreadyUsesContext = section.contextClaimIds.some((claimId) => usedClaimIds.has(claimId))
    if (alreadyUsesContext) continue
    const primaryClaimId = section.claimIds.find((claimId) => usedClaimIds.has(claimId)) ?? section.claimIds[0]
    if (!primaryClaimId) continue
    const selectedContextClaimIds = new Set(selectSceneContextClaims(section, input).map((claim) => claim.id))
    const contextClaims = section.contextClaimIds
      .map((claimId) => claimById.get(claimId))
      .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
      .filter((claim) => selectedContextClaimIds.has(claim.id))
    if (contextClaims.length === 0) continue
    const contextClaimIds = contextClaims.map((claim) => claim.id)
    const sentence = `${conservativeContextAnswer(section.title, contextClaims)} [claim:${[primaryClaimId, ...contextClaimIds].join(',')}]。`
    result = appendThirdLevelSectionParagraph(result, section.title, sentence)
  }
  return result
}

function completeConditionalSectionArgument(
  body: string,
  section: ResearchReportBlueprintSection,
  input: SynthesisWriterInput
): string {
  if (!isConditionalApplicationSection(section)) return body
  if (!input.reportBlueprint) return body
  const requiredContextCount = requiredConditionalContextClaimCount(section)
  if (requiredContextCount === 0 || sectionVisibleFactClaimIds(body, section).size < requiredContextCount) return body
  const scopedInput: SynthesisWriterInput = {
    ...input,
    reportBlueprint: { ...input.reportBlueprint, sections: [section] }
  }
  const completed = ensureRequiredContextClaimSynthesis(`### ${section.title}\n\n${body}`, scopedInput)
  return previousSectionBody(completed, section.title) || body
}

function citedClaimFactProse(markdown: string, claimId: string, fallback: string): string {
  const candidates = markdown.split('\n')
    .filter((line) => !/^\s*#{1,6}\s/u.test(line))
    .flatMap((line) => splitCitationSentences(line))
    .filter((sentence) => {
      const claimIds = sentenceClaimIds(sentence)
      return claimIds.length === 1 && claimIds[0] === claimId
        && !isSpecificEvidenceBoundarySentence(sentence)
        && !/^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看))/u.test(
          sentence.replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '').trim()
        )
    })
    .map((sentence) => sentence
      .replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
      .replace(/[\u3002！？.!?；;]+$/u, '')
      .trim())
    .filter((sentence) => sentence.length >= 12)
    .sort((left, right) => {
      const chineseDifference = Number(/[\u4e00-\u9fff]/u.test(right)) - Number(/[\u4e00-\u9fff]/u.test(left))
      return chineseDifference || left.length - right.length
    })
  return (candidates[0] ?? fallback)
    .replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
    .replace(/[\u3002！？.!?；;]+$/u, '')
    .trim()
}

function groundedConditionalApplicationAnswer(
  section: ResearchReportBlueprintSection,
  contextClaims: ReturnType<typeof usableClaimsForSynthesis>,
  primaryClaimId?: string
): string {
  const prose = groundedConditionalApplicationProse(section, contextClaims, primaryClaimId)
  const claimIds = [...(primaryClaimId ? [primaryClaimId] : []), ...contextClaims.map((claim) => claim.id)]
  return ensureSentenceEnding(`${prose} [claim:${claimIds.join(',')}]`)
}

function groundedConditionalApplicationProse(
  section: ResearchReportBlueprintSection,
  contextClaims: ReturnType<typeof usableClaimsForSynthesis>,
  primaryClaimId?: string
): string {
  const labels = contextClaims
    .map(contextClaimLabel)
    .filter(Boolean)
    .filter((label, index, all) => all.indexOf(label) === index)
  const namedPremises = labels.map((label) => `“${label}”`).join('与')
  const singlePremise = namedPremises
    ? `${namedPremises}${labels.length === 1 ? '这项' : '这些'}机制前提`
    : '上述机制前提'
  const multiplePremises = namedPremises
    ? `${namedPremises}${labels.length === 1 ? '这一机制前提' : '这些机制前提'}`
    : '上述机制前提'
  return primaryClaimId
    ? `由此判断，若${singlePremise}在“${section.title}”中成立，则本节已引用的场景事实只能在该前提明确限定的条件下解释`
    : labels.length === 1
      ? `由此判断，若${multiplePremises}在“${section.title}”中成立，则该场景只能按这一前提明确限定的条件解释`
      : `由此判断，若${multiplePremises}在“${section.title}”中同时成立，则该场景只能分别按这些前提已明确限定的条件解释`
}

export function removeRedundantConservativeContextSynthesis(
  markdown: string,
  input: SynthesisWriterInput
): string {
  let result = markdown
  for (const section of input.reportBlueprint?.sections ?? []) {
    const contextClaimIds = new Set(section.contextClaimIds ?? [])
    if (contextClaimIds.size === 0) continue
    const primaryClaimIds = new Set(section.claimIds)
    const body = previousSectionBody(result, section.title)
    const bodySentences = splitCitationSentences(body.replace(/\n+/gu, ''))
    const contextSynthesisSentences = bodySentences.filter((sentence) => {
      const claimIds = sentenceClaimIds(sentence)
      return claimIds.some((claimId) => contextClaimIds.has(claimId))
        && claimIds.some((claimId) => primaryClaimIds.has(claimId))
        && isSafeContextSynthesis(sentence)
    })
    const hasConcreteContextSynthesis = contextSynthesisSentences.some((sentence) => !isConservativeContextSynthesis(sentence))
    const conservativeCount = contextSynthesisSentences.filter(isConservativeContextSynthesis).length
    if (!hasConcreteContextSynthesis && conservativeCount <= 1) continue
    let keptConservative = false
    result = filterThirdLevelSectionSentences(result, section.title, (sentence) => {
      if (!isConservativeContextSynthesis(sentence)) return true
      const claimIds = sentenceClaimIds(sentence)
      const usesContext = claimIds.some((claimId) => contextClaimIds.has(claimId))
      const usesPrimary = claimIds.some((claimId) => primaryClaimIds.has(claimId))
      if (!usesContext || !usesPrimary) return true
      if (hasConcreteContextSynthesis) return false
      if (keptConservative) return false
      keptConservative = true
      return true
    })
  }
  return result
}

function sentenceClaimIds(sentence: string): string[] {
  return [...sentence.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
    .map((claimId) => claimId.trim())
    .filter(Boolean)
}

function filterThirdLevelSectionSentences(
  markdown: string,
  title: string,
  keep: (sentence: string) => boolean
): string {
  const lines = markdown.split('\n')
  const headingIndex = lines.findIndex((line) => line.trim() === `### ${title}`)
  if (headingIndex < 0) return markdown
  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex((line) => /^#{2,3}\s+/u.test(line.trim()))
  const endIndex = nextHeadingOffset < 0 ? lines.length : headingIndex + 1 + nextHeadingOffset
  for (let index = headingIndex + 1; index < endIndex; index += 1) {
    lines[index] = splitCitationSentences(lines[index] ?? '').filter(keep).join('').trim()
  }
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function prependSectionParagraph(markdown: string, title: string, paragraph: string): string {
  const lines = markdown.split('\n')
  const headingIndex = lines.findIndex((line) => line.trim() === `### ${title}`)
  if (headingIndex < 0) return markdown
  lines.splice(headingIndex + 1, 0, '', paragraph)
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function appendThirdLevelSectionParagraph(markdown: string, title: string, paragraph: string): string {
  const lines = markdown.split('\n')
  const headingIndex = lines.findIndex((line) => line.trim() === `### ${title}`)
  if (headingIndex < 0) return markdown
  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex((line) => /^#{2,3}\s+/u.test(line.trim()))
  const endIndex = nextHeadingOffset < 0 ? lines.length : headingIndex + 1 + nextHeadingOffset
  lines.splice(endIndex, 0, '', paragraph)
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

export async function normalizeStructuredSectionWithRecovery(input: {
  initialResult: { text: string; modelUsage: ResearchModelUsageRecord[] }
  section: ResearchReportBlueprintSection
  input: SynthesisWriterInput
  options: { modelClient: ModelClient; model: string; providerId?: string; timeoutMs?: number }
  basePrompt: string
  turnIdPrefix: string
}): Promise<{ body: string; modelUsage: ResearchModelUsageRecord[] }> {
  let result = input.initialResult
  let parseAttempt = 0
  const modelUsage: ResearchModelUsageRecord[] = []
  const seenFailures = new Set<string>()
  const selectedClaims = sectionRetryClaims(input.section, input.input)
  const accumulatedFacts = new Map<string, { claimId: string; sentence: string }>()
  let retainedRelation = ''
  let retainedAnswer = ''
  let retainedBoundary = ''
  let synthesisOnlyResult = false
  let expectedMissingClaimId: string | undefined
  const alternateFactRepairClaimIds = new Set<string>()
  let alternateFactDiagnostic = ''
  while (true) {
    const expectedClaimIdForResult = expectedMissingClaimId
    try {
      let payload = synthesisOnlyResult
        ? parseStructuredSynthesisPayload(result.text)
        : parseStructuredRetryPayload(result.text)
      if (synthesisOnlyResult) {
        retainedRelation = stringValue(payload.relation)
        retainedAnswer = stringValue(payload.answer)
        retainedBoundary = stringValue(payload.boundary)
      } else {
        if (expectedClaimIdForResult) {
          payload = alignSingleMissingFactPayload(payload, expectedClaimIdForResult)
        }
        for (const fact of structuredRetryFacts(payload, selectedClaims, input.input, true)) {
          accumulatedFacts.set(fact.claimId, fact)
        }
        retainedRelation = stringValue(payload.relation) || retainedRelation
        retainedAnswer = stringValue(payload.answer) || retainedAnswer
        retainedBoundary = stringValue(payload.boundary) || retainedBoundary
      }
    } catch {
      // The normal full-response recovery below handles payloads with no complete facts array.
    }
    if (expectedClaimIdForResult && !accumulatedFacts.has(expectedClaimIdForResult)) {
      const missingClaim = selectedClaims.find((claim) => claim.id === expectedClaimIdForResult)
      const originalFact = comparisonClaimTextForPrompt(missingClaim?.text ?? '', input.input)
      const chineseReport = /中文|Chinese/iu.test(`${input.input.brief.outputFormat}\n${input.input.brief.userIntent}`)
      const canPublishOriginalFact = !chineseReport || /[\u4e00-\u9fff]/u.test(originalFact)
      if (missingClaim && canPublishOriginalFact && isUsableEvidenceText(originalFact, 12)) {
        accumulatedFacts.set(missingClaim.id, { claimId: missingClaim.id, sentence: originalFact })
      }
      if (missingClaim && !accumulatedFacts.has(expectedClaimIdForResult)
        && !alternateFactRepairClaimIds.has(expectedClaimIdForResult)) {
        alternateFactRepairClaimIds.add(expectedClaimIdForResult)
        expectedMissingClaimId = expectedClaimIdForResult
        const promptClaim = comparisonClaimTextForPrompt(missingClaim.text, input.input)
        const requiredNumbers = numericTokens(promptClaim)
        const alternateResult = await requestWriterText({
          input: input.input,
          options: input.options,
          systemPrompt: SINGLE_FACT_TRANSLATION_SYSTEM_PROMPT,
          prompt: [
            `章节：${input.section.title}`,
            `唯一原始 claim：${JSON.stringify(promptClaim)}`,
            ...(requiredNumbers.length > 0
              ? [`必须原值保留的数字 token：${JSON.stringify(requiredNumbers)}`]
              : []),
            '上一种 facts 数组补译没有返回指定 claim。本次只翻译这一条，只输出一个完整中文事实句。'
          ].join('\n'),
          turnId: `${input.turnIdPrefix}_single_fact_${parseAttempt + 1}`,
          maxTokens: 900
        })
        const alternateFact = singleFactTranslationText(alternateResult.text, expectedClaimIdForResult)
        const alternateIssue = alternateFact
          ? sparseTranslatedFactIssue(alternateFact, missingClaim, input.input)
          : 'single-fact translator did not return one parseable sentence'
        alternateFactDiagnostic = `${alternateIssue ?? 'accepted'}; response=${diagnosticModelText(alternateResult.text)}`
        result = {
          ...alternateResult,
          text: alternateFact ? JSON.stringify({ fact: alternateFact }) : alternateResult.text
        }
        modelUsage.push(...alternateResult.modelUsage)
        continue
      }
    }
    expectedMissingClaimId = undefined
    synthesisOnlyResult = false
    const mergedResponse = JSON.stringify({
      facts: selectedClaims.flatMap((claim) => {
        const fact = accumulatedFacts.get(claim.id)
        return fact ? [fact] : []
      }),
      relation: retainedRelation,
      answer: retainedAnswer,
      boundary: retainedBoundary
    })
    const candidateResponse = accumulatedFacts.size > 0 || retainedRelation || retainedAnswer || retainedBoundary
      ? mergedResponse
      : result.text
    try {
      return {
        body: normalizeMultiClaimSectionRetry(candidateResponse, input.section, input.input),
        modelUsage
      }
    } catch (error) {
      const message = errorMessage(error)
      const signature = JSON.stringify({
        responseShape: structuredRecoveryFailureSignature(message, result.text),
        accumulatedClaimIds: [...accumulatedFacts.keys()].sort(),
        expectedClaimIdForResult: expectedClaimIdForResult ?? null
      })
      if (seenFailures.has(signature)) {
        if (accumulatedFacts.size === selectedClaims.length) {
          const bounded = boundedDirectRecoverySynthesis(input.section, selectedClaims, input.input)
          const fallbackResponse = JSON.stringify({
            facts: selectedClaims.map((claim) => accumulatedFacts.get(claim.id)),
            relation: bounded.relation,
            answer: bounded.answer,
            boundary: bounded.boundary
          })
          try {
            return {
              body: normalizeMultiClaimSectionRetry(fallbackResponse, input.section, input.input),
              modelUsage
            }
          } catch {
            // The repeated-response error below remains the fail-closed boundary
            // when even the bounded relationship cannot satisfy publication rules.
          }
        }
        throw new Error(`structured section repair entered a repeated malformed-response dead loop: ${message}${alternateFactDiagnostic ? `; alternateFact=${alternateFactDiagnostic}` : ''}`)
      }
      seenFailures.add(signature)
      parseAttempt += 1
      const missingClaim = accumulatedFacts.size > 0
        ? selectedClaims.find((claim) => !accumulatedFacts.has(claim.id))
        : undefined
      if (missingClaim) {
        expectedMissingClaimId = missingClaim.id
        result = await requestWriterText({
          input: input.input,
          options: input.options,
          systemPrompt: MISSING_STRUCTURED_FACT_SYSTEM_PROMPT,
          prompt: [
            `章节：${input.section.title}`,
            `指定 claim：${JSON.stringify({ id: missingClaim.id, text: comparisonClaimTextForPrompt(missingClaim.text, input.input) })}`,
            '只补齐这一个缺失事实。返回 {"facts":[{"claimId":"原 claim id","sentence":"完整中文事实句"}]}。'
          ].join('\n'),
          turnId: `${input.turnIdPrefix}_missing_fact_${parseAttempt}`,
          maxTokens: 900,
          responseFormat: 'json_object'
        })
        modelUsage.push(...result.modelUsage)
        continue
      }
      if (accumulatedFacts.size === selectedClaims.length) {
        const synthesisIssue = message
          .replace(/;\s*response=[\s\S]*/iu, '')
          .replace(/\s+/gu, ' ')
          .trim()
        result = await requestWriterText({
          input: input.input,
          options: input.options,
          systemPrompt: STRUCTURED_SYNTHESIS_REPAIR_SYSTEM_PROMPT,
          prompt: [
            `章节：${input.section.title}`,
            `本章要回答：${sanitizeBlueprintProse(input.section.purpose)}`,
            `蓝图允许的局部结论：${sanitizeBlueprintProse(input.section.argument.conclusion)}`,
            `蓝图允许的推理方向：${sanitizeBlueprintProse(input.section.argument.inference)}`,
            ...(input.section.limitations.length > 0
              ? [`已知边界：${JSON.stringify(input.section.limitations.map(sanitizeBlueprintProse))}`]
              : []),
            `已验证 facts：${JSON.stringify(selectedClaims.map((claim) => accumulatedFacts.get(claim.id)))}`,
            `校验类别：${synthesisIssue.slice(0, 240)}`,
            '只重写 relation、answer 和 boundary。relation 不得复述数字或完整事实；answer 必须直接回答“本章要回答”；boundary 必须点名 facts 已出现的具体对象或时间，并说明不能推出的相邻判断；不得输出 facts、Markdown 或解释。'
          ].join('\n'),
          turnId: `${input.turnIdPrefix}_synthesis_only_${parseAttempt}`,
          maxTokens: 1_200,
          responseFormat: 'json_object'
        })
        synthesisOnlyResult = true
        modelUsage.push(...result.modelUsage)
        continue
      }
      result = await requestWriterText({
        input: input.input,
        options: input.options,
        systemPrompt: MULTI_CLAIM_SECTION_RETRY_SYSTEM_PROMPT,
        prompt: [
          input.basePrompt,
          '',
          `上一次 JSON 被截断或未通过结构校验：${message}`,
          '重新从左花括号开始完整输出整个 JSON 对象，不要续写半截内容；必须闭合所有字符串、数组和右花括号。'
        ].join('\n'),
        turnId: `${input.turnIdPrefix}_${parseAttempt}`,
        maxTokens: SECTION_MAX_TOKENS,
        responseFormat: 'json_object'
      })
      modelUsage.push(...result.modelUsage)
    }
  }
}

function singleFactTranslationText(text: string, expectedClaimId: string): string {
  const normalized = text
    .replace(/^```(?:json|markdown|md)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim()
  if (!normalized) return ''
  if (normalized.startsWith('{')) {
    try {
      const value = JSON.parse(normalized) as Record<string, unknown>
      const direct = stringValue(value.fact) || stringValue(value.sentence) || stringValue(value.text)
      if (direct) return direct
      if (Array.isArray(value.facts) && value.facts.length === 1) {
        const item = value.facts[0]
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const record = item as Record<string, unknown>
          const claimId = stringValue(record.claimId)
          if (!claimId || claimId === expectedClaimId) {
            return stringValue(record.sentence) || stringValue(record.text)
          }
        }
      }
      return ''
    } catch {
      return ''
    }
  }
  return normalized.replace(/^(?:翻译|译文|事实句)[:：]\s*/u, '').trim()
}

function boundedDirectRecoverySynthesis(
  section: ResearchReportBlueprintSection,
  claims: ReturnType<typeof usableClaimsForSynthesis>,
  input: SynthesisWriterInput
): { relation: string; answer: string; boundary: string } {
  const comparisonTargets = [...new Set((input.frame.alternativesToCompare ?? [])
    .map((target) => sanitizeBlueprintProse(target))
    .filter((target) => target.length >= 2))]
    .slice(0, 3)
  const entityLabels = [...new Set(claims
    .flatMap((claim) => claim.entities)
    .map((entity) => entity.trim())
    .filter((entity) => entity.length >= 2))]
    .slice(0, 3)
  const labels = comparisonTargets.length >= 2 ? comparisonTargets : entityLabels
  const quotedLabels = labels.map((label) => `“${label}”`)
  const coveredObjects = labels.length > 0
    ? quotedLabels.length === 1
      ? quotedLabels[0]!
      : `${quotedLabels.slice(0, -1).join('、')}与${quotedLabels.at(-1)}`
    : `“${sanitizeBlueprintProse(section.title)}”中各项材料明示的对象`
  const subject = labels.length >= 2
    ? coveredObjects
    : `“${sanitizeBlueprintProse(section.title)}”涉及的对象`
  return {
    relation: `区别在于，${subject}在“${sanitizeBlueprintProse(section.title)}”上的陈述具有各自的对象、条件和时间，不能把一方结论直接套用于另一方`,
    answer: `由此判断，${subject}在“${sanitizeBlueprintProse(section.title)}”上应按各自明确的范围分别判断，不能用一方结论替代另一方`,
    boundary: `现有证据仅覆盖${coveredObjects}已经明确陈述的对象、条件和时间，未提供统一口径下的量化比较，因此不能进一步排序`
  }
}

function alignSingleMissingFactPayload(
  payload: Record<string, unknown>,
  expectedClaimId: string
): Record<string, unknown> {
  if (!Array.isArray(payload.facts)) {
    const sentence = stringValue(payload.fact) || stringValue(payload.sentence) || stringValue(payload.text)
    return sentence
      ? { ...payload, facts: [{ claimId: expectedClaimId, sentence }] }
      : payload
  }
  if (payload.facts.length !== 1) return payload
  const item = payload.facts[0]
  if (!item || typeof item !== 'object' || Array.isArray(item)) return payload
  const record = item as Record<string, unknown>
  const returnedClaimId = stringValue(record.claimId)
  if (returnedClaimId === expectedClaimId) return payload
  if (returnedClaimId) return payload
  const sentence = stringValue(record.sentence) || stringValue(record.text)
  if (!sentence) return payload
  return {
    ...payload,
    facts: [{ ...record, claimId: expectedClaimId }]
  }
}

export async function normalizeSparseSectionWithRecovery(input: {
  initialResult: { text: string; modelUsage: ResearchModelUsageRecord[] }
  section: ResearchReportBlueprintSection
  input: SynthesisWriterInput
  options: { modelClient: ModelClient; model: string; providerId?: string; timeoutMs?: number }
  basePrompt: string
  turnIdPrefix: string
}): Promise<{ body: string; modelUsage: ResearchModelUsageRecord[] }> {
  let result = input.initialResult
  let repairAttempt = 0
  const modelUsage: ResearchModelUsageRecord[] = []
  const seenFailures = new Set<string>()
  while (true) {
    try {
      return {
        body: normalizeSparseSectionRetry(result.text, input.section, input.input),
        modelUsage
      }
    } catch (error) {
      const message = errorMessage(error)
      const signature = structuredRecoveryFailureSignature(message, result.text)
      if (seenFailures.has(signature)) {
        throw new Error(`sparse section translation entered a repeated invalid-response dead loop: ${message}`)
      }
      seenFailures.add(signature)
      repairAttempt += 1
      const claim = sparseSectionClaim(input.section, input.input)
      result = await requestWriterText({
        input: input.input,
        options: input.options,
        systemPrompt: SPARSE_SECTION_RETRY_SYSTEM_PROMPT,
        prompt: [
          input.basePrompt,
          '',
          `上一次 fact 未通过发布校验：${message}`,
          `上一次无效响应：${diagnosticModelText(result.text)}`,
          ...(claim ? [
            `必须忠实翻译的原始 claim：${comparisonClaimTextForPrompt(claim.text, input.input)}`,
            `必须逐项原值保留的数字 token：${JSON.stringify(numericTokens(claim.text))}`
          ] : []),
          '重新完整翻译原始 claim。只输出一个闭合 JSON 对象；fact 必须是一个中文句子，并逐项保留提示列出的全部原始数字 token。'
        ].join('\n'),
        turnId: `${input.turnIdPrefix}_${repairAttempt}`,
        maxTokens: SECTION_MAX_TOKENS,
        responseFormat: 'json_object'
      })
      modelUsage.push(...result.modelUsage)
    }
  }
}

async function requestWriterText(input: {
  input: SynthesisWriterInput
  options: { modelClient: ModelClient; model: string; providerId?: string; timeoutMs?: number }
  systemPrompt: string
  prompt: string
  turnId: string
  maxTokens: number
  responseFormat?: 'json_object'
  reservation?: ResearchModelCallReservation
}): Promise<{ text: string; modelUsage: ResearchModelUsageRecord[] }> {
  throwIfResearchAborted(input.input.execution?.signal)
  const controller = new AbortController()
  const unlinkAbort = linkResearchAbortSignal(input.input.execution?.signal, controller)
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, input.options.timeoutMs ?? SECTION_WRITER_TIMEOUT_MS)
  )
  const reservation = input.reservation ?? input.input.execution?.reserveModelCall(
    'writer',
    estimateResearchRequestTokens(`${input.systemPrompt}\n${input.prompt}`, input.maxTokens)
  )
  const observedUsage: ResearchModelUsageRecord['usage'][] = []
  let usageRecorded = false
  try {
    const request: ModelRequest = {
      threadId: 'research_section_synthesis',
      turnId: input.turnId,
      model: input.options.model,
      ...(input.options.providerId ? { providerId: input.options.providerId } : {}),
      systemPrompt: input.systemPrompt,
      prefix: [],
      history: [makeUserItem({
        id: `item_${input.turnId}_user`,
        threadId: 'research_section_synthesis',
        turnId: input.turnId,
        text: input.prompt
      })],
      tools: [],
      stream: false,
      maxTokens: input.maxTokens,
      temperature: 0.15,
      ...(input.responseFormat ? { responseFormat: input.responseFormat } : {}),
      reasoningEffort: researchReasoningForStage(input.input.budget.reasoningEffort, 'writer'),
      abortSignal: controller.signal
    }
    const collected = await collectSectionWriterTextWithTransientRecovery({
      modelClient: input.options.modelClient,
      request,
      signal: controller.signal,
      onUsage: (usage) => observedUsage.push(usage)
    })
    const modelUsage = collected.usage.slice(-1).map((usage) => ({
      stage: 'writer' as const,
      model: input.options.model,
      turnId: input.turnId,
      attempt: 1,
      usage
    }))
    if (input.input.execution && reservation && modelUsage[0]) {
      await input.input.execution.recordModelUsage(modelUsage[0], reservation)
      usageRecorded = true
    }
    return { text: collected.text, modelUsage: input.input.execution ? [] : modelUsage }
  } finally {
    clearTimeout(timeout)
    unlinkAbort()
    if (input.input.execution && reservation) {
      const lastUsage = observedUsage.at(-1)
      if (!usageRecorded && lastUsage) {
        await input.input.execution.recordModelUsage({
          stage: 'writer',
          model: input.options.model,
          turnId: input.turnId,
          attempt: 1,
          usage: lastUsage
        }, reservation)
        usageRecorded = true
      }
      await input.input.execution.finishModelCall(reservation, { chargeEstimateOnMissing: !usageRecorded })
    }
  }
}

export async function collectSectionWriterTextWithTransientRecovery(input: {
  modelClient: ModelClient
  request: ModelRequest
  signal: AbortSignal
  onUsage?: (usage: ResearchModelUsageRecord['usage']) => void
  retryBaseMs?: number
}): ReturnType<typeof collectWriterText> {
  let transientAttempt = 0
  while (true) {
    throwIfResearchAborted(input.signal)
    try {
      return await collectWriterText(
        input.modelClient.stream(input.request),
        input.signal,
        input.onUsage
      )
    } catch (error) {
      if (!isTransientResearchModelFailure(error)) throw error
      const baseMs = Math.max(1, input.retryBaseMs ?? 500)
      const delayMs = Math.min(8_000, baseMs * 2 ** Math.min(transientAttempt, 6))
      transientAttempt += 1
      await waitForResearchModelRetry(delayMs, input.signal)
    }
  }
}

export function isTransientResearchModelFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /(?:HTTP\s*(?:429|502|503|504)\b|rate\s*limit|server\s*overloaded|service_unavailable|temporarily\s*unavailable|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch\s*failed|network\s*error|socket\s*hang\s*up)/iu.test(message)
}

function waitForResearchModelRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('research model retry aborted'))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason ?? new Error('research model retry aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function normalizeSectionArgumentBody(value: string, _section: ResearchReportBlueprintSection): string {
  return sanitizeSpeculativeBoundaryTails(stripMarkdownFence(value))
    .replace(/^#{1,6}\s+.*$/gmu, '')
    .replace(/^(?:在|关于)\s*[^，。！？!?]{1,80}?分面(?:下|中)?[，,]\s*/gmu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function writerRepairSignature(issue: string, currentText: string): string {
  const signals = reportArgumentSignals(currentText)
  const claimIds = [...new Set([...currentText.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter(Boolean))].sort()
  const issueFamily = writerIssueFamily(issue)
  const visibleBodyHash = hashText(currentText.slice(0, 12_000))
  if (/used only|assigned context claim|context claim as a standalone|explicit title facet|mapped claim sentences|missing facets/iu.test(issue)) {
    return JSON.stringify({
      issueFamily,
      visibleBodyHash,
      claimIds,
      synthesis: signals.hasSynthesis,
      boundary: signals.hasEvidenceBoundary
    })
  }
  return JSON.stringify({
    issueFamily,
    visibleBodyHash,
    claimIds,
    charBand: Math.floor(signals.chars / 50),
    sentences: signals.sentences,
    paragraphs: signals.paragraphs,
    synthesis: signals.hasSynthesis,
    boundary: signals.hasEvidenceBoundary,
    foreign: Boolean(longForeignProseExcerpt(currentText))
  })
}

export function structuredRecoveryFailureSignature(issue: string, currentText: string): string {
  const objectStart = currentText.indexOf('{')
  const objectEnd = currentText.lastIndexOf('}')
  const objectText = objectStart >= 0 && objectEnd >= objectStart
    ? currentText.slice(objectStart, objectEnd + 1)
    : currentText
  let parseable = false
  try {
    JSON.parse(objectText)
    parseable = true
  } catch {
    parseable = false
  }
  const fields = ['facts', 'fact', 'relation', 'answer', 'boundary']
    .filter((field) => new RegExp(`["']${field}["']\\s*:`, 'iu').test(currentText))
  const claimIds = [...new Set([...currentText.matchAll(/["']claimId["']\s*:\s*["']([^"']+)["']/giu)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean))]
    .sort()
  const openingBraces = (currentText.match(/[\[{]/gu) ?? []).length
  const closingBraces = (currentText.match(/[\]}]/gu) ?? []).length
  return JSON.stringify({
    issueFamily: writerIssueFamily(issue.replace(/;\s*response=[\s\S]*/iu, '')),
    parseable,
    fields,
    claimIds,
    factCount: (currentText.match(/["']claimId["']\s*:/giu) ?? []).length,
    closedObject: objectStart >= 0 && objectEnd > objectStart,
    balance: Math.max(-3, Math.min(3, openingBraces - closingBraces))
  })
}

export function closingRepairSignature(
  issue: string,
  closing: { lead: string; conclusion: string; limitations: string }
): string {
  const conclusionSentences = splitCitationSentences(closing.conclusion.replace(/\n+/gu, ''))
    .filter((sentence) => sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim().length >= 12)
  const claimIds = [...new Set(conclusionSentences.flatMap((sentence) => sentenceClaimIds(sentence)))].sort()
  const synthesis = conclusionSentences.some((sentence) => {
    const prose = sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim()
    return sentenceClaimIds(sentence).length >= 2
      && /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示))/u.test(prose)
  })
  const limitationCount = splitCitationSentences(closing.limitations.replace(/\n+/gu, ''))
    .filter((sentence) => sentence.trim().length >= 12)
    .length
  return JSON.stringify({
    issueFamily: writerIssueFamily(issue),
    claimIds,
    conclusionSentenceBand: Math.min(3, conclusionSentences.length),
    synthesis,
    boundary: conclusionSentences.some(isSpecificEvidenceBoundarySentence),
    limitationBand: Math.min(2, limitationCount),
    foreign: Boolean(longForeignProseExcerpt(`${closing.lead}\n${closing.conclusion}\n${closing.limitations}`))
  })
}

export function writerRetryRequestSignature(
  sectionId: string,
  issue: string,
  currentText: string,
  retryMode: string
): string {
  const visibleBody = currentText.slice(0, 2_400)
  const signals = reportArgumentSignals(currentText)
  const claimIds = [...new Set([...currentText.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter(Boolean))].sort()
  return hashText(JSON.stringify({
    sectionId,
    issueFamily: writerIssueFamily(issue),
    retryMode,
    visibleBodyHash: hashText(visibleBody),
    claimIds,
    synthesis: signals.hasSynthesis,
    boundary: signals.hasEvidenceBoundary,
    foreign: Boolean(longForeignProseExcerpt(currentText))
  }))
}

function writerIssueFamily(issue: string): string {
  return issue
    .normalize('NFKC')
    .toLowerCase()
    .replace(/cleanedExcerpt=[\s\S]*/u, '')
    .replace(/\d+/gu, '#')
    .replace(/\s+/gu, ' ')
    .trim()
}

function ensureFinalScopeCoverage(markdown: string, input: SynthesisWriterInput): string {
  const conclusionBody = markdownSectionBody(markdown, '结论')
  const targets = input.frame.alternativesToCompare ?? []
  let completed = markdown

  const missingTargets = targets.filter((target) => !conclusionBody.includes(target))
  if (missingTargets.length > 0) {
    completed = appendSectionSentences(completed, '局限与不确定性', [
      `当前证据未充分覆盖${targets.join('、')}，不能生成这些对象之间的确定比较结论。`
    ])
  }
  const limitationsBody = markdownSectionBody(completed, '局限与不确定性')
  const limitationCount = splitCitationSentences(limitationsBody.replace(/\n+/gu, '')).filter((sentence) => sentence.trim().length >= 12).length
  const limitationAdditions = defaultClosingLimitations(input)
    .filter((candidate) => !limitationsBody.includes(candidate))
    .slice(0, Math.max(0, 3 - limitationCount))
  completed = appendSectionSentences(completed, '局限与不确定性', limitationAdditions)
  return completed
}

function canonicalizeCitedFacts(markdown: string, input: SynthesisWriterInput): string {
  const claimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  const seenBySection = new Map<string, Set<string>>()
  const synthesisSeenBySection = new Map<string, Set<string>>()
  const chineseReport = /中文|Chinese/iu.test(`${input.brief.outputFormat}\n${input.brief.userIntent}`)
  let sectionKey = 'preamble'
  return markdown.split('\n').map((line) => {
    const heading = line.trim().match(/^#{1,3}\s+(.+?)\s*$/u)?.[1]
    if (heading) {
      sectionKey = heading
      return line
    }
    const seen = seenBySection.get(sectionKey) ?? new Set<string>()
    const canonical = splitCitationSentences(line).flatMap((sentence) => {
      STRUCTURED_CLAIM_RE.lastIndex = 0
      const structuredBound = STRUCTURED_CLAIM_RE.test(sentence)
      const normalizedSentence = sentence.replace(STRUCTURED_CLAIM_RE, (_placeholder, claimIds: string) => `[claim:${claimIds}]`)
      const claimIds = [...normalizedSentence.matchAll(/\[claim:([^\]]+)\]/gu)]
        .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
        .filter((claimId): claimId is string => Boolean(claimId) && claimById.has(claimId))
      if (claimIds.length === 0) return [normalizedSentence]
      const uniqueClaimIds = [...new Set(claimIds)]
      if (usesContextClaimPairForSection(sectionKey, uniqueClaimIds, input) && !isSafeContextSynthesis(normalizedSentence)) {
        return []
      }
      const unseenClaimIds = uniqueClaimIds.filter((claimId) => !seen.has(claimId))
      if (isSpecificEvidenceBoundarySentence(normalizedSentence)) {
        for (const claimId of unseenClaimIds) seen.add(claimId)
        return [normalizedSentence]
      }
      const structuredSynthesis = structuredBound && uniqueClaimIds.length >= 2 && /^(?:\s*(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|这(?:表明|说明|意味着|反映|显示)))/u.test(
        normalizedSentence.replace(/\[claim:[^\]]+\]/gu, '')
      )
      if (structuredSynthesis && chineseReport
        && hasUnsafeStructuredSynthesis(normalizedSentence)
        && !structuredSynthesisRiskSupported(normalizedSentence, input)) return []
      if (structuredBound) {
        for (const claimId of unseenClaimIds) seen.add(claimId)
        return [normalizedSentence]
      }
      const citedSynthesis = uniqueClaimIds.length >= 2 && /^(?:\s*(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)))/u.test(
        normalizedSentence.replace(/\[claim:[^\]]+\]/gu, '')
      )
      if (citedSynthesis) {
        if (chineseReport && hasUnsupportedCrossLanguageExpansion(normalizedSentence) && !structuredBound) return []
        const signature = normalizedSentence
          .replace(/\[claim:[^\]]+\]/gu, '')
          .replace(/[，。；：、,.!！?？`*_\s]/gu, '')
          .trim()
        const seenSynthesis = synthesisSeenBySection.get(sectionKey) ?? new Set<string>()
        if (signature && seenSynthesis.has(signature)) return []
        if (signature) seenSynthesis.add(signature)
        synthesisSeenBySection.set(sectionKey, seenSynthesis)
        for (const claimId of unseenClaimIds) seen.add(claimId)
        return [normalizedSentence]
      }
      const crossLanguageTranslation = chineseReport
        && /[\u4e00-\u9fff]/u.test(normalizedSentence.replace(/\[claim:[^\]]+\]/gu, ''))
        && unseenClaimIds.every((claimId) => !/[\u4e00-\u9fff]/u.test(claimById.get(claimId)!.text))
      if (crossLanguageTranslation) {
        if (hasUnsupportedCrossLanguageExpansion(normalizedSentence) && !structuredBound) return []
        for (const claimId of unseenClaimIds) seen.add(claimId)
        return unseenClaimIds.length > 0 ? [normalizedSentence] : []
      }
      return uniqueClaimIds.flatMap((claimId) => {
        if (seen.has(claimId)) return []
        seen.add(claimId)
        const claimText = comparisonClaimTextForPrompt(claimById.get(claimId)!.text, input).replace(/[。！？.!?；;]+$/u, '').trim()
        if (chineseReport && longForeignProseExcerpt(claimText)) return []
        return claimText ? [`${claimText} [claim:${claimId}]。`] : []
      })
    }).join('')
    seenBySection.set(sectionKey, seen)
    return canonical.trim()
  }).join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

export function hasUnsupportedCrossLanguageExpansion(sentence: string): boolean {
  const prose = sentence.replace(/\[claim:[^\]]+\]/gu, '')
  return /(?:例如|比如|譬如|诸如|设计初衷|更好的做法|风险点|核心权衡|高效|安全性|实时性|及时|最佳|适用于|更适合|更依赖|更灵活|应当|应该|建议|推荐|优先考虑|优先|后备|互补|互斥|牺牲|确信|必须[^。！？!?；;]{0,30}才能|直接决定|(?:直接|显著)?(?:限制|阻碍|削弱)(?![”"’'』」》】\s、，,。；;：:])[^。！？!?；;]{2,48}|共同支持[^。！？!?；;]{0,48}实践|(?:不同|各自)[^。！？!?；;]{0,16}适用性|(?:结合|配合|协同|叠加)[^。！？!?；;]{0,48}(?:导致|造成|使得|会|可能|从而)|(?:弥补|抵消)[^。！？!?；;]{0,24}(?:缺陷|不足|局限)|(?:需要|需)[^。！？!?；;]{0,24}(?:选择|权衡)|(?:显著|明显)[^。！？!?；;]{0,16}(?:提升|降低|改善)|(?:减少|避免)[^。！？!?；;]{0,48}|(?:保证|确保)[^。！？!?；;]{0,32}(?:可靠|一致|有效|正确|安全|最新)|(?:主要|专门|优先)[^。！？!?；;]{0,16}(?:服务于|面向|用于)[^。！？!?；;]{0,24}(?:需求|场景|用途)|而非[^。！？!?；;]{0,20}(?:需求|场景|策略|用途)|消除[^。！？!?；;]{0,20}(?:障碍|限制|问题)|完全[^。！？!?；;]{0,16}(?:绕过|消除|避免|取代)|(?:本质上|实际上|等同于|可视为)[^。！？!?；;]{0,24}(?:策略|机制|模式|保证)|(?:因为|从而|因此|使得|意味着)[^。！？!?；;]{0,36}(?:确保|保证|导致|推动|提升|降低)|(?:并非|不是)[^。！？!?；;]{0,12}(?:唯一|绝对最优)|(?:唯一|绝对最优)[^。！？!?；;]{0,16}(?:方案|选择|策略)|(?:满足|解决)[^。！？!?；;]{0,32}(?:需求|问题))/u.test(prose)
}

export function hasUnsafeStructuredSynthesis(sentence: string): boolean {
  const prose = sentence
    .replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
    .replace(/驱动因素/gu, '影响因素')
  const riskProse = stripEpistemicallyBoundedRelations(prose)
  const unsupportedClassification = /(?:以[^。！？!?；;]{1,28}为主|更(?:强调|侧重|依赖)|(?:仅|只)(?:涉及|覆盖|提供)|(?:事前|事后)[^。！？!?；;]{0,28}(?:公开|处理|审查|执行|监管|处罚))/u.test(riskProse)
  return unsupportedClassification || /(?:弥补|互补|抵消|确保|保证|导致|使得|协同|叠加|牺牲|驱动|促成|促进|归因|指向|取决于|决定于|(?:高度|主要|过度)?依赖|强绑定|绑定于|(?:结构性|直接|显著)?关联|(?:通常|往往|一般).{0,40}(?:需要|导致|推高|推低|意味着|表明|反映|说明)|(?:从而|进而)?(?:推高|推低)|(?:彼此|相互)?独立|无(?:直接)?因果|(?:未|没有|不曾).{0,16}(?:抑制|阻碍|阻止)|(?:未|没有|并未)(?:因[^。！？!?；;]{1,40}而)?[^。！？!?；;]{0,32}(?:显著)?(?:增加|加剧|降低|改善|削弱|提升|改变)|(?:表明|说明|反映|意味着|由此判断)[^。！？!?；;]{0,64}(?:较低|较高|稳健|健康|安全|强劲|脆弱|良好|不佳|领先|落后)|[^。！？!?；;]{2,48}(?:之间)?存在(?:张力|矛盾)|(?:一旦|若|如果).{0,80}(?:可能|会).{0,40}(?:转向|下降|减弱|增加|恶化)|(?:优势|劣势|更强|更弱)|(?:高度|明显|显著)?集中|适合|适用于|更适合|建议|应该|应当|推荐|最佳实践|完全.{0,12}(?:绕过|避免|消除|取代)|无需.{0,16}(?:依赖|验证)|是通过.{0,24}实现|必须.{0,30}才能|共同支持.{0,48}实践|(?:结合|配合).{0,40}(?:导致|造成|使得|会|可能|从而)|(?:减少|避免).{0,24}(?:成本|开销|损失|风险|延迟|消耗|浪费)|(?:显著|明显).{0,16}(?:提升|降低|改善))/u.test(riskProse)
}

function isEpistemicallyBoundedRelation(prose: string): boolean {
  return stripEpistemicallyBoundedRelations(prose) !== prose
}

function stripEpistemicallyBoundedRelations(prose: string): string {
  return prose
    .replace(
      /(?:现有材料|现有证据|当前材料|当前证据)[^。！？!?；;]{0,80}(?:不能|不足以|无法)(?:证明|确定|判断)?[^。！？!?；;]{0,80}(?:是否存在)?(?:关联|因果|叠加|协同)(?:关系)?/gu,
      ''
    )
    .replace(
      /(?:不能|不足以|无法)(?:证明|确定|判断)[^。！？!?；;]{0,80}(?:是否存在)?(?:关联|因果|叠加|协同)(?:关系)?/gu,
      ''
    )
}

const STRUCTURED_SYNTHESIS_RISK_RULES: Array<{ prose: RegExp; support: RegExp }> = [
  { prose: /(?:弥补|互补|抵消)/u, support: /弥补|互补|抵消|complement|offset|compensat/iu },
  { prose: /(?:确保|保证)/u, support: /确保|保证|ensure|guarantee/iu },
  { prose: /(?:导致|使得)/u, support: /导致|使得|cause|lead(?:s|ing)?\s+to|result(?:s|ing)?\s+in/iu },
  { prose: /(?:驱动|促成|促进|归因|指向)/u, support: /驱动|促成|促进|归因|指向|\bdrive|drives|driven|promot|contribut|attribute/iu },
  { prose: /(?:结构性|直接|显著)?关联/u, support: /(?:结构性|直接|显著)?关联|association|relationship|related/iu },
  {
    prose: /(?:通常|往往|一般).{0,40}(?:需要|导致|推高|推低|意味着|表明|反映|说明)|(?:从而|进而)?(?:推高|推低)/u,
    support: /(?:通常|往往|一般).{0,40}(?:需要|导致|推高|推低|意味着|表明|反映|说明)|(?:从而|进而)?(?:推高|推低)|(?:typically|usually|generally).{0,40}(?:require|lead|raise|lower|mean|indicat|reflect|suggest)/iu
  },
  { prose: /(?:表明|说明|反映|意味着|由此判断)[^。！？!?；;]{0,64}(?:较低|较高|稳健|健康|安全|强劲|脆弱|良好|不佳|领先|落后)/u, support: /(?:表明|说明|反映|意味着|由此判断)[^。！？!?；;]{0,64}(?:较低|较高|稳健|健康|安全|强劲|脆弱|良好|不佳|领先|落后)|(?:indicat|suggest|reflect|mean)[^.!?;]{0,64}(?:low|high|stable|healthy|safe|strong|fragile|good|poor|leading|lagging)/iu },
  { prose: /(?:未|没有|并未)(?:因[^。！？!?；;]{1,40}而)?[^。！？!?；;]{0,32}(?:显著)?(?:增加|加剧|降低|改善|削弱|提升|改变)/u, support: /(?:未|没有|并未)(?:因[^。！？!?；;]{1,40}而)?[^。！？!?；;]{0,32}(?:显著)?(?:增加|加剧|降低|改善|削弱|提升|改变)|(?:did|does|do|has|have|had)\s+not[^.!?;]{0,64}(?:increase|worsen|reduce|improve|weaken|raise|change)/iu },
  { prose: /[^。！？!?；;]{2,48}(?:之间)?存在(?:张力|矛盾)/u, support: /[^。！？!?；;]{2,48}(?:之间)?存在(?:张力|矛盾)|(?:tension|conflict)\s+between/iu },
  { prose: /(?:一旦|若|如果).{0,80}(?:可能|会).{0,40}(?:转向|下降|减弱|增加|恶化)/u, support: /(?:一旦|若|如果).{0,80}(?:可能|会).{0,40}(?:转向|下降|减弱|增加|恶化)|(?:if|once).{0,80}(?:may|might|will|would|could).{0,40}(?:shift|turn|decline|weaken|increase|worsen)/iu },
  { prose: /(?:取决于|决定于|依赖于)/u, support: /取决于|决定于|依赖于|depend(?:s|ed|ing)?\s+on|determin(?:e|es|ed|ing)/iu },
  { prose: /(?:彼此|相互)?独立/u, support: /(?:彼此|相互)?独立|independent(?:ly)?(?:\s+of)?/iu },
  { prose: /无(?:直接)?因果/u, support: /无(?:直接)?因果|no\s+direct\s+causal|not\s+causally\s+related/iu },
  { prose: /(?:未|没有|不曾).{0,16}(?:抑制|阻碍|阻止)/u, support: /(?:未|没有|不曾).{0,16}(?:抑制|阻碍|阻止)|(?:did|does|do|has|have|had)\s+not.{0,24}(?:suppress|inhibit|prevent|impede)/iu },
  { prose: /(?:协同|叠加)/u, support: /协同|叠加|synerg|combined|together/iu },
  { prose: /牺牲/u, support: /牺牲|sacrifice|trade[ -]?off/iu },
  { prose: /(?:适合|适用于|更适合)/u, support: /适合|适用于|suitable|ideal|appropriate|intended\s+for/iu },
  { prose: /(?:建议|应该|应当|推荐|最佳实践)/u, support: /建议|应该|应当|推荐|最佳实践|recommend|should|best\s+practice/iu },
  { prose: /完全.{0,12}(?:绕过|避免|消除|取代)/u, support: /完全.{0,12}(?:绕过|避免|消除|取代)|completely.{0,20}(?:bypass|avoid|eliminate|replace)/iu },
  { prose: /(?:无需|不必|不需要).{1,32}/u, support: /无需|不必|不需要|need\s+not|does\s+not\s+need|not\s+necessary\s+to|without/iu },
  { prose: /是通过.{0,24}实现/u, support: /是通过.{0,24}实现|implemented\s+(?:by|through)|achieved\s+(?:by|through)/iu },
  { prose: /必须.{0,30}才能/u, support: /必须.{0,30}才能|must.{0,30}(?:to|before|in\s+order)|required.{0,30}(?:to|before)/iu },
  { prose: /共同支持.{0,48}实践/u, support: /共同支持.{0,48}实践|together.{0,30}support.{0,30}practice/iu },
  { prose: /(?:结合|配合).{0,40}(?:导致|造成|使得|会|可能|从而)/u, support: /结合|配合|combined|together|in\s+combination/iu },
  { prose: /(?:显著|明显).{0,16}(?:提升|降低|改善)/u, support: /显著|明显.{0,16}(?:提升|降低|改善)|significant|substantial/iu },
  { prose: /(?:以[^。！？!?；;]{1,28}为主|更(?:强调|侧重|依赖)|(?:仅|只)(?:涉及|覆盖|提供)|(?:事前|事后)[^。！？!?；;]{0,28}(?:公开|处理|审查|执行|监管|处罚))/u, support: /以[^。！？!?；;]{1,28}为主|更(?:强调|侧重|依赖)|(?:仅|只)(?:涉及|覆盖|提供)|(?:事前|事后)[^。！？!?；;]{0,28}(?:公开|处理|审查|执行|监管|处罚)|primarily|mainly|emphasi[sz]|focus(?:es|ed|ing)?\s+on|only\s+(?:involves?|covers?|provides?)|ex ante|ex post|beforehand|afterward/iu }
]

function structuredSynthesisRiskSupportedByText(sentence: string, support: string): boolean {
  const prose = normalizeResearchChineseScript(sentence
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .replace(/驱动因素/gu, '影响因素'))
  const normalizedSupport = normalizeResearchChineseScript(support)
  const triggered = STRUCTURED_SYNTHESIS_RISK_RULES.filter((rule) => rule.prose.test(prose))
  return triggered.length > 0 && triggered.every((rule) => rule.support.test(normalizedSupport))
}

function structuredSynthesisRiskSupported(sentence: string, input: SynthesisWriterInput): boolean {
  const prose = sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
  const claimById = new Map(usableClaimsForSynthesis(input).map((claim) => [claim.id, claim]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const boundClaims = sentenceClaimIds(sentence)
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
  if (boundClaims.length === 0) return false
  const support = [
    ...boundClaims.map((claim) => claim.text),
    ...boundClaims.flatMap((claim) => claim.supportSpanIds.map((spanId) => spanById.get(spanId)?.text ?? ''))
  ].join('\n')
  return structuredSynthesisRiskSupportedByText(prose, support)
}

function groundedStructuredAnswer(
  sectionTitle: string,
  facts: Array<{ claimId: string; sentence: string }>
): string {
  const clauses = facts.map((fact) => fact.sentence
    .replace(/\[(?:claim|structured-claim):[^\]]+\]/gu, '')
    .replace(/[（(]\s*claim\s*\d+\s*[)）]/giu, '')
    .replace(/^(?:现代)?最佳实践(?:是|为|在于)?\s*/u, '')
    .replace(/无需重新验证/gu, '不必重新验证')
    .replace(/[。！？.!?；;]+$/u, '')
    .trim())
    .filter(Boolean)
  return clauses.length > 0
    ? `由此判断，对“${sectionTitle}”可确认的是：${clauses.join('；同时，')}`
    : ''
}

function removeRepeatedScenarioLead(prose: string, title: string): string {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return prose.replace(
    new RegExp(`^(?:在|对于|就)\\s*[“\"]?${escapedTitle}[”\"]?\\s*(?:中|下|里)?[，,:：]?\\s*`, 'u'),
    ''
  ).trim()
}

export function sanitizeSpeculativeBoundaryTails(value: string): string {
  return value.split('\n').map((line) => splitCitationSentences(line).map((sentence) => {
    const match = sentence.match(/^([\s\S]*?(?:现有证据|当前证据|现有材料)[\s\S]{0,180}?)(?:[，,；;：:]\s*(?:但|而)?\s*(?:(?:未|没有)(?:直接)?(?:覆盖|说明|验证|讨论|涉及|包括|涵盖)|不能(?:据此)?(?:扩展|推出|推导|增加|外推)|无法(?:据此)?(?:扩展|推出|推导|增加|外推))[\s\S]*)$/u)
    if (!match?.[1]) return sentence
    const retained = match[1].replace(/[，,；;：:\s]+$/u, '').trim()
    return retained ? ensureSentenceEnding(retained) : sentence
  }).join('')).join('\n')
}

function removeUnknownClaimSentences(markdown: string, validClaimIds: Set<string>): string {
  return markdown.split('\n').map((line) => splitCitationSentences(line)
    .filter((sentence) => {
      const claimIds = [...sentence.matchAll(/\[claim:([^\]]+)\]/gu)].map((match) => match[1]?.trim()).filter(Boolean)
      const expandedClaimIds = claimIds.flatMap((claimId) => (claimId ?? '').split(/[,，;；]/u).map((id) => id.trim())).filter(Boolean)
      return expandedClaimIds.every((claimId) => validClaimIds.has(claimId!))
    })
    .join('')
    .trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function removeRawInternalStateSentences(markdown: string): string {
  return markdown.split('\n').map((line) => splitCitationSentences(line)
    .filter((sentence) => {
      RAW_INTERNAL_RESEARCH_ID.lastIndex = 0
      return !RAW_INTERNAL_RESEARCH_ID.test(sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, ''))
    })
    .join('')
    .trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function appendSectionSentences(markdown: string, title: string, sentences: string[]): string {
  if (sentences.length === 0) return markdown
  const heading = `## ${title}`
  const start = markdown.indexOf(heading)
  if (start < 0) return markdown
  const bodyStart = start + heading.length
  const nextHeadingOffset = markdown.slice(bodyStart).search(/\n##\s+/u)
  const end = nextHeadingOffset < 0 ? markdown.length : bodyStart + nextHeadingOffset
  return `${markdown.slice(0, end).trimEnd()}\n\n${sentences.join('')}\n${markdown.slice(end).trimStart()}`.trim()
}

function markdownSectionBody(markdown: string, title: string): string {
  const heading = `## ${title}`
  const start = markdown.indexOf(heading)
  if (start < 0) return ''
  const bodyStart = start + heading.length
  const nextHeadingOffset = markdown.slice(bodyStart).search(/\n##\s+/u)
  const end = nextHeadingOffset < 0 ? markdown.length : bodyStart + nextHeadingOffset
  return markdown.slice(bodyStart, end).trim()
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
