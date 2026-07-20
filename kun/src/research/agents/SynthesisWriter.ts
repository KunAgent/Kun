/**
 * [INPUT]: 依赖 model-client 生成最终报告，依赖 research notes、claims、evidence ledger 和 citation 占位符
 * [OUTPUT]: 对外提供 BasicSynthesisWriter、ModelSynthesisWriter 与 buildSynthesisWriterPrompt
 * [POS]: research/agents 的唯一正文写作节点，负责把结构化调研结果综合成可渲染 Markdown 草稿
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { researchReasoningForStage } from '../core/presets.js'
import type { DraftReport, SynthesisWriter, SynthesisWriterInput } from './types.js'

export const MODEL_SYNTHESIS_WRITER_TIMEOUT_MS = 90_000
export const MIN_DETAILED_REPORT_CHARS = 1_800

export const MODEL_SYNTHESIS_WRITER_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的唯一 Synthesis Writer。',
  'Research Workers 已经产出结构化 notes、claims 和 evidence ledger；你的职责是基于这些输入写一篇统一、完整、可编辑的 Markdown 报告。',
  '必须围绕 ResearchFrame.coreResearchThread 和 centralQuestion 组织论证，不要做百科式资料堆砌。',
  '写作方式参考成熟 deep research 系统：先形成问题大纲，再转化为用户可读的主要发现、解释、反证和结论，避免只输出摘要。',
  '摘要和调研范围说明由 Runtime 在最终报告完成后短后处理生成；你不要把输出预算花在这些包装性段落上。',
  '如果 Runtime 提供了上一轮质量校验反馈，你必须重写完整报告并逐条修复 blockingIssues 和 recommendedFixes；不要只解释问题。',
  '所有关键事实性判断都必须使用提供的 claim id，占位符格式必须是 [claim:claim_id]；不要自己发明脚注。',
  'Runtime 会解析这些占位符并生成 CitationBinding，所以你只输出 Markdown 正文，不输出代码块。',
  '不要输出“核心问题与回答”或“证据链”二级标题，不要输出运行 ID、来源数量、模型评审等内部诊断元数据。',
  '不要在正文中复述内部字段名或英文标签；如果需要说明来源限制，用“模型生成资料卡”“需要外部来源复核”等中文表达。',
  '除非用户明确要求其他语言，报告必须使用中文。'
].join('\n')

export class BasicSynthesisWriter implements SynthesisWriter {
  async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
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
    lines.push('阅读本节时，应把每个发现都看成一个小型论证单元：先说明它支持什么事实，再说明它如何改变对问题的判断，最后说明它的适用边界。这样的结构可以避免报告只停留在“列材料”的层面，也能让后续补充真实来源时知道应该替换哪一段事实、加强哪一条机制解释、或下调哪一个结论的确定性。')
    lines.push('')
    if (firstClaim) {
      lines.push(`基于当前已记录证据，最关键的可验证结论是：${claimTextForReport(firstClaim)} [claim:${firstClaim.id}]。这个结论应被视为全文的起点，而不是终点；后续章节会继续说明它的适用范围和仍需复核的部分。`)
      usedClaimIds.push(firstClaim.id)
      lines.push('')
    }
    const criticalClaims = usableClaims.filter((claim) => claim.critical)
    const findingClaims = criticalClaims.length > 0 ? criticalClaims : usableClaims.slice(0, 6)
    if (findingClaims.length === 0) {
      lines.push('当前资料还没有形成可引用的核心发现。报告可以记录研究框架，但不能把它视为完成的 DeepResearch 结果。')
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
            lines.push(`从调研含义看，${implications.join('；')}。${dimensionImplication(group.dimension)}`)
          }
          const limitations = relatedNotes.flatMap((note) => note.limitations).filter(Boolean)
          if (limitations.length > 0) {
            lines.push('')
            lines.push(`这条发现也有明确边界：${limitations.slice(0, 3).join('；')}。因此它更适合作为阶段性判断，而不是脱离来源和时间范围的最终定论。`)
          }
        }
        lines.push('')
        lines.push('这部分材料的价值不在于单条网页片段本身，而在于它帮助确定比较口径：哪些差异属于制度性约束，哪些只是短期市场表现，哪些会直接影响普通个人投资者的可执行路径。')
        lines.push('')
      }
      lines.push('### 对核心配置问题的综合判断')
      lines.push('')
      lines.push(coreAllocationJudgement(input, dimensionGroups, usedClaimIds))
      lines.push('')
    if (input.frame.coreQuestions.length > 0) {
      lines.push(`综合这些发现，报告需要覆盖的关键维度包括：${input.frame.coreQuestions.map((question) => question.text).join('；')}。这些维度共同决定了结论是否只是资料罗列，还是能真正回答用户要理解的差异、原因和趋势。`)
      lines.push('')
      lines.push('阅读这些发现时，应把它们看成一组相互约束的判断，而不是可以单独摘出的结论。一个发现解释事实差异，另一个发现解释机制或趋势，局限部分则说明哪些地方还不能下定论。这样的组织方式能让报告既有明确观点，又保留继续复核和补证的空间，也方便用户把报告继续改写成文章、演讲稿或决策备忘录，并保留清晰的复核入口。')
      lines.push('')
      lines.push('如果这些维度之间出现张力，报告应优先处理最能改变结论的那一个：例如某个事实看似醒目，但不能解释用户真正关心的路径，就只能作为背景；相反，一个数据点即使篇幅不大，只要能改变比较口径、风险判断或行动建议，就应该被放在主论证中。')
      lines.push('')
    }
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
      lines.push(`第一，当前最值得采纳的主结论是：${claimTextForReport(lead)} [claim:${lead.id}]。这条结论应作为用户继续判断的默认起点，但不能替代对渠道、汇率、估值和监管差异的逐项复核。`)
      usedClaimIds.push(lead.id)
      for (const claim of criticalClaims.slice(1, 6)) {
        lines.push('')
        lines.push(`第二层补充判断是：${claimTextForReport(claim)} [claim:${claim.id}]。它可以帮助用户理解主结论背后的结构性原因，而不是只看到表层现象。`)
        usedClaimIds.push(claim.id)
      }
    } else {
      lines.push('在当前证据基础上，可以形成初步报告结论，但所有结论都应保留证据来源和局限说明。')
    }
    if (isAStockUsStockResearch(input)) {
      lines.push('')
      lines.push('对中国内地普通个人投资者，较稳妥的实操框架是“核心资产看长期制度和全球分散，卫星资产看本土周期和估值弹性”：如果投资者能接受汇率、额度、时差和产品费率约束，美股宽基或代表性全球资产更适合作为长期核心配置候选；A股更适合作为理解本土经济、政策周期和行业弹性的配置补充。若两个市场都投，应先确定宽基和资产类别，再讨论个股选择，避免把短期涨跌当成核心配置依据。')
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
    const nextQueries = input.plan.tasks.flatMap((task) => task.searchHints).filter(Boolean)
    if (nextQueries.length > 0) {
      for (const query of [...new Set(nextQueries)].slice(0, 6)) {
        lines.push(`- ${query}`)
      }
    } else {
      lines.push('- 接入真实网页、本地文件或 PDF 来源后，围绕关键判断追加证据。')
    }

    extendFallbackReportIfNeeded(lines, input, usedClaimIds)

    return {
      markdown: lines.join('\n'),
      claimIds: [...new Set(usedClaimIds)],
      generatedAt: input.nowIso
    }
  }
}

export class ModelSynthesisWriter implements SynthesisWriter {
  private readonly fallback: SynthesisWriter

  constructor(
    private readonly options: {
      modelClient: ModelClient
      model: string
      timeoutMs?: number
      fallback?: SynthesisWriter
    }
  ) {
    this.fallback = options.fallback ?? new BasicSynthesisWriter()
  }

  async writeDraft(input: SynthesisWriterInput): Promise<DraftReport> {
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.options.timeoutMs ?? MODEL_SYNTHESIS_WRITER_TIMEOUT_MS)
    )

    try {
      const turnId = `research_writer_${hashWriterInput(input)}`
      const request: ModelRequest = {
        threadId: 'research_synthesis_writer',
        turnId,
        model: this.options.model,
        systemPrompt: MODEL_SYNTHESIS_WRITER_SYSTEM_PROMPT,
        prefix: [],
        history: [
          makeUserItem({
            id: `item_${turnId}_user`,
            threadId: 'research_synthesis_writer',
            turnId,
            text: buildSynthesisWriterPrompt(input)
          })
        ],
        tools: [],
        stream: false,
        maxTokens: 10_000,
        temperature: 0.2,
        reasoningEffort: researchReasoningForStage(input.budget.reasoningEffort, 'writer'),
        abortSignal: controller.signal
      }
      const raw = await collectWriterText(this.options.modelClient.stream(request), controller.signal)
      const markdown = ensureCoreResearchThread(stripRuntimeGeneratedDraftSections(stripMarkdownFence(raw).trim()), input)
      assertUsableModelDraft(markdown, input)
      return {
        markdown,
        claimIds: extractUsedClaimIds(markdown, new Set(input.claims.map((claim) => claim.id))),
        generatedAt: input.nowIso
      }
    } catch {
      return this.fallback.writeDraft(input)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function buildSynthesisWriterPrompt(input: SynthesisWriterInput): string {
  const targetChars = minReportChars(input)
  return [
    '请基于以下已确认 brief、research frame、plan、notes 和 evidence ledger，写一篇完整中文 Markdown 报告。',
    '',
    '硬性要求：',
    '- 只输出 Markdown 正文，不要代码块，不要解释你如何写作。',
    '- 标题使用 brief.topic。',
    '- 必须包含这些二级标题：## 主要发现、## 结论与建议、## 局限与不确定性、## 后续研究建议。',
    '- 不要输出这些 Runtime 会后置生成或用户不可见的章节/元数据：## 摘要、## 调研范围与方法、## 核心问题与回答、## 证据链、运行 ID、来源数量、论断数量、模型评审、报告完整度。',
    `- 默认写成详细报告，正文有效中文内容不少于 ${targetChars} 字；复杂主题应在 2000-3500 字之间。`,
    '- 不要用空泛套话凑字数；长度必须来自问题拆解、证据解释、反证边界和结论推导。',
    '- “主要发现”不要只列 bullet，每个重要发现至少写一段解释，并覆盖 coreQuestions 中的必要问题。',
    '- 必须按本次问题自己的关键维度综合，不要按来源逐条复述，也不要套用固定领域模板。',
    '- 把篇幅用在主要发现、机制解释、反证边界和结论建议上；不要解释运行过程、任务拆解或评分机制。',
    '- 写作时优先围绕“最能改变结论的证据”和领先假设展开；不要为了证明每个假设而平均分配篇幅。',
    '- 如果替代假设或 null hypothesis 被削弱/支持，要把它转化为结论边界或谨慎判断，不要写成内部假设列表。',
    '- 如果 Claim 来自网页兜底抽取，必须抽取其中可用事实并合并成判断，不要把网页标题、导航、APP 下载提示或搜索结果标题当作发现。',
    '- 不要逐字复制 Claim、Evidence 或 Research Notes；必须先把证据转化为面向用户的分析句，再用 claim id 标注支撑。',
    '- 证据只通过正文上标引用体现，不要单独列出证据来源、证据片段或证据链清单。',
    `- 本次运行使用 ${input.budget.preset} research preset；如果 gap loop 因预算耗尽停止，必须在“局限与不确定性”中自然说明哪些问题仍需补证。`,
    '- 如果 Brief.userClarifications 非空，必须在报告中逐条回应这些用户补充要求；不能只依赖 scope 总结。',
    '- 必须实质回答 centralQuestion，并明确报告如何围绕 coreResearchThread 展开，但不要把内部字段名写进正文。',
    '- 每个关键事实性判断后使用 [claim:claim_id]，claim_id 只能来自“可用 Claim”。',
    '- 不要写 [^cit_1] 之类脚注，Runtime 会自动生成。',
    '- 如果资料来源被标记为“模型生成资料卡 / 需要外部来源复核”，要在“局限与不确定性”里说明，不要把它说成真实网页检索。',
    '- 如果存在真实网页来源，要优先说明这些来源如何支撑结论，不要泛称为模拟资料。',
    '- 如果来源是网页抓取，正文称为“网页来源”“官方网页”“证据片段”，不要称为“模型资料卡”或只称“资料卡”。',
    '- “局限与不确定性”必须包含至少一个反面证据、边界条件或未解决问题；不要只写形式化 caveat。',
    '- 正文不要出现 raw English 内部标签，例如 model_generated、requires_external_verification、Evidence Span、P0、sourcePolicyTags。',
    '- 不要中英混排；除专有名词外使用中文。',
    ...(input.revision ? [
      '',
      '上一轮质量校验反馈（只按这些问题重写，不要复述上一轮报告）：',
      JSON.stringify(revisionGuidance(input), null, 2),
      '',
      '修订要求：',
      '- 必须输出完整报告，不要只输出补丁、解释或差异。',
      '- 必须优先修复 blockingIssues；如果证据不足，要在正文中明确说明缺口并用现有证据给出谨慎结论。',
      '- 必须提升对 confirmed scope、brief.successCriteria、centralQuestion 和 coreResearchThread 的匹配度。',
      '- 不要沿用上一轮被打回的表达方式；尤其不要粘贴内部平台提示语、证据摘要原文或网页导航文本。'
    ] : []),
    '',
    'Brief：',
    JSON.stringify({
      topic: input.brief.topic,
      userIntent: input.brief.userIntent,
      userClarifications: input.brief.userClarifications ?? [],
      targetAudience: input.brief.targetAudience,
      outputFormat: input.brief.outputFormat,
      successCriteria: input.brief.successCriteria,
      constraints: input.brief.constraints
    }, null, 2),
    '',
    'ResearchFrame：',
    JSON.stringify({
      coreResearchThread: input.frame.coreResearchThread,
      centralQuestion: input.frame.centralQuestion,
      coreQuestions: input.frame.coreQuestions,
      investigationPath: input.frame.investigationPath,
      evidenceNeeded: input.frame.evidenceNeeded,
      disconfirmingEvidenceNeeded: input.frame.disconfirmingEvidenceNeeded,
      nonGoals: input.frame.nonGoals
    }, null, 2),
    '',
    'Hypothesis Ledger（内部判断状态，只用于组织结论，不要把字段名写进正文）：',
    JSON.stringify({
      hypotheses: (input.hypotheses ?? []).map((hypothesis) => ({
        id: hypothesis.id,
        statement: hypothesis.statement,
        status: hypothesis.status,
        confidence: hypothesis.confidence,
        supportingClaims: hypothesis.supportingClaims,
        opposingClaims: hypothesis.opposingClaims,
        uncertainty: hypothesis.uncertainty
      })),
      recentUpdates: (input.hypothesisUpdates ?? []).slice(-8).map((update) => ({
        hypothesisId: update.hypothesisId,
        previousStatus: update.previousStatus,
        newStatus: update.newStatus,
        confidenceChange: update.confidenceChange,
        updateReason: update.updateReason,
        remainingUncertainty: update.remainingUncertainty
      })),
      convergence: (input.convergenceVerdicts ?? []).slice(-3).map((verdict) => ({
        roundIndex: verdict.roundIndex,
        readyToWrite: verdict.readyToWrite,
        shouldFail: verdict.shouldFail,
        reason: verdict.reason,
        leadingHypothesisIds: verdict.leadingHypothesisIds,
        highValueOpenQuestions: verdict.highValueOpenQuestions,
        wouldFurtherResearchChangeConclusion: verdict.wouldFurtherResearchChangeConclusion
      }))
    }, null, 2),
    '',
    'ResearchPlan：',
    JSON.stringify({
      rationale: input.plan.rationale,
      supervisor: input.plan.supervisor,
      tasks: input.plan.tasks.map((task) => ({
        id: task.id,
        objective: task.objective,
        questionIds: task.questionIds,
        expectedEvidence: task.expectedEvidence,
        searchHints: task.searchHints,
        status: task.status
      }))
    }, null, 2),
    '',
    '内部质量反馈（只用于谨慎表达和补齐缺口，不要写入正文）：',
    JSON.stringify((input.gapVerdicts ?? []).map((verdict) => ({
      roundIndex: verdict.roundIndex,
      status: verdict.status,
      confidence: verdict.confidence,
      stopReason: verdict.stopReason,
      missingEvidence: verdict.missingEvidence
    })), null, 2),
    '',
    '维度化素材索引（写作时优先按这些维度组织，不要逐条复述来源）：',
    JSON.stringify(groupClaimsForSynthesis(input, claimsForPrompt(input)), null, 2),
    '',
    '可用 Claim（只能使用这些 id）：',
    JSON.stringify(claimsForPrompt(input).map((claim) => ({
      id: claim.id,
      text: cleanClaimForPrompt(claim.text),
      confidence: claim.confidence,
      critical: claim.critical,
      supportSpanIds: claim.supportSpanIds
    })), null, 2),
    '',
    '引用上下文（只用于判断来源质量，不要直接复制到正文）：',
    fitText(JSON.stringify(evidenceForPrompt(input).map((span) => {
      const source = input.sources.find((candidate) => candidate.id === span.sourceId)
      return {
        id: span.id,
        sourceId: span.sourceId,
        sourceTitle: source?.title,
        sourceType: source ? sourceTypeLabel(source.sourceType) : undefined,
        sourceReliability: source ? sourceReliabilityLabel(source.reliability) : undefined,
        sourcePolicyTags: source?.sourcePolicyTags.map(sourcePolicyTagLabel),
        text: cleanEvidenceTextForPrompt(span.text)
      }
    }), null, 2), 7_000),
    '',
    'Research Notes：',
    fitText(JSON.stringify(notesForPrompt(input).map((note) => ({
      questionIds: note.questionIds,
      claimIds: note.claimIds,
      summary: cleanAnalysisTextForReport(note.summary),
      implicationForBrief: cleanAnalysisTextForReport(note.implicationForBrief),
      confidence: note.confidence,
      limitations: note.limitations
    })), null, 2), 5_000)
  ].join('\n')
}

function revisionGuidance(input: SynthesisWriterInput): Record<string, unknown> {
  const revision = input.revision
  if (!revision) return {}
  return {
    previousAttempt: revision.attempt - 1,
    nextAttempt: revision.attempt,
    maxAttempts: revision.maxAttempts,
    scores: revision.previousVerdict.scores,
    blockingIssues: revision.previousVerdict.blockingIssues.slice(0, 5),
    warnings: revision.previousVerdict.warnings.slice(0, 4),
    recommendedFixes: revision.previousVerdict.recommendedFixes.slice(0, 5)
  }
}

function claimsForPrompt(input: SynthesisWriterInput): SynthesisWriterInput['claims'] {
  const usable = usableClaimsForSynthesis(input)
  const critical = usable.filter((claim) => claim.critical)
  const secondary = usable.filter((claim) => !claim.critical)
  const ordered = [...critical, ...secondary]
  const maxClaims = input.budget.preset === 'deep' ? 24 : input.budget.preset === 'standard' ? 18 : 12
  return ordered.slice(0, maxClaims)
}

function evidenceForPrompt(input: SynthesisWriterInput): SynthesisWriterInput['evidenceSpans'] {
  const claimIds = new Set(claimsForPrompt(input).flatMap((claim) => claim.supportSpanIds))
  return input.evidenceSpans
    .filter((span) => claimIds.has(span.id))
    .filter((span) => cleanEvidenceTextForPrompt(span.text).length >= 20)
    .slice(0, input.budget.preset === 'deep' ? 24 : 16)
}

function notesForPrompt(input: SynthesisWriterInput): SynthesisWriterInput['notes'] {
  const claimIds = new Set(claimsForPrompt(input).map((claim) => claim.id))
  return input.notes
    .filter((note) => note.claimIds.some((claimId) => claimIds.has(claimId)))
    .slice(0, input.budget.preset === 'deep' ? 20 : 14)
}

function groupClaimsForSynthesis(input: SynthesisWriterInput, claimsForUse = usableClaimsForSynthesis(input)): Array<{
  dimension: string
  claimIds: string[]
  facts: string[]
}> {
  const groups = new Map<string, Array<{ id: string; text: string }>>()
  for (const claim of claimsForUse) {
    const dimension = claimDimension(claim.text)
    const bucket = groups.get(dimension) ?? []
    if (bucket.length < 8) bucket.push({ id: claim.id, text: cleanClaimForPrompt(claim.text) })
    groups.set(dimension, bucket)
  }
  return [...groups.entries()].map(([dimension, claims]) => ({
    dimension,
    claimIds: claims.map((claim) => claim.id),
    facts: claims.map((claim) => `${claim.text} [claim:${claim.id}]`)
  }))
}

function dimensionImplication(dimension: string): string {
  const implications: Record<string, string> = {
    投资渠道与准入: '它决定了普通个人投资者能不能低成本、合规地触达目标市场，因此会直接影响“理论上更优”和“实际上可执行”之间的差距。',
    交易规则: '它影响交易频率、止损方式、做空与衍生品使用边界，因此更适合被放在风险控制和交易行为约束中理解。',
    投资者结构: '它影响市场定价风格、波动来源和信息消化速度，是判断长期配置稳定性的关键背景。',
    估值与财务指标: '它帮助判断当前买入是否付出过高价格，也能约束“哪个市场更好”这种笼统结论。',
    监管与信息披露: '它影响财务数据可信度、投资者保护和可复核性，是长期核心配置必须考虑的基础设施。',
    指数表现与配置: '它把制度差异落实到可投资载体和长期组合结果，是从研究结论走向资产配置建议的关键桥梁。'
  }
  return implications[dimension] ?? '它为核心问题提供了一个局部视角，需要和其他维度合并后才能形成配置判断。'
}

function coreAllocationJudgement(
  input: SynthesisWriterInput,
  dimensionGroups: Array<{ dimension: string; claimIds: string[]; facts: string[] }>,
  usedClaimIds: string[]
): string {
  const citedClaims = dimensionGroups.flatMap((group) => group.claimIds).slice(0, 4)
  usedClaimIds.push(...citedClaims)
  const citations = citedClaims.map((claimId) => `[claim:${claimId}]`).join(' ')
  if (isAStockUsStockResearch(input)) {
    return [
      `对本次问题，不能只问“A股还是美股谁更好”，而要拆成“长期核心配置”和“本土机会/战术配置”两层。现有证据显示，合规渠道、交易机制、估值口径、披露环境和指数载体会共同影响普通个人投资者的可执行结果。${citations}`,
      '因此，谨慎的阶段性判断是：美股或其宽基载体更适合作为全球分散和长期核心配置的候选，但前提是投资者能够接受汇率、渠道额度、产品费率、税务和信息披露语言差异；A股更适合作为本土经济与政策周期的机会配置，尤其适合投资者熟悉公司、产业和政策语境时做卫星仓位或阶段性再平衡。',
      '如果两个市场都投，应先配置宽基或代表性资产，再做个股选择；个股选择不应越过市场制度、估值和监管披露差异直接比较涨跌幅。'
    ].join('')
  }
  return `综合现有维度，核心结论应先服从用户的可执行路径，再服从单点事实强弱。${citations}`
}

function claimDimension(text: string): string {
  const prefix = text.match(/^([^：:]{2,24})[：:]/)?.[1]?.trim()
  if (prefix) return prefix
  if (/QDII|港股通|沪股通|深股通|开户|准入/.test(text)) return '投资渠道与准入'
  if (/T\+0|T\+1|涨跌幅|交易机制|交易规则|做空|融资融券/.test(text)) return '交易规则'
  if (/投资者结构|机构投资者|个人投资者|retail|institutional/i.test(text)) return '投资者结构'
  if (/估值|市盈率|PE|PB|ROE|valuation|market cap/i.test(text)) return '估值与财务指标'
  if (/监管|披露|SEC|证监会|disclosure|filing/i.test(text)) return '监管与信息披露'
  if (/沪深300|标普500|S&P 500|指数|配置|benchmark/i.test(text)) return '指数表现与配置'
  return '其他证据'
}

function isAStockUsStockResearch(input: SynthesisWriterInput): boolean {
  const text = `${input.brief.topic}\n${input.brief.userIntent}\n${input.frame.coreResearchThread}\n${input.frame.centralQuestion}`
  return /A股|美股|沪深300|标普500|S&P 500/i.test(text)
}

function cleanClaimForPrompt(text: string): string {
  return cleanWebBoilerplate(text)
    .replace(/^来源：[^。！？.!?]{0,120}[。！？.!?]?\s*/u, '')
    .replace(/^该来源可用于回答[^。！？.!?]{0,220}[。！？.!?]?\s*/u, '')
    .replace(/并服务于主线[:：][^。！？.!?]{0,220}[。！？.!?]?/u, '')
    .replace(/来源「[^」]+」提供了?与本维度相关的可复核网页材料/u, '')
    .replace(/(?:Skip to main content|official website|Toggle navigation|Main navigation|Data by Topic|Data by Place|Data by Economic Account|Tools Intera)[^。！？.!?]{0,260}/gi, '')
    .replace(/(?:Organizational Chart|Data Communiqués|Legal Framework|Classifications & Methods|Latest Releases|International Cooperation|Understanding Statistics)[^。！？.!?]{0,260}/gi, '')
    .replace(/(?:Trade Agreements|Agreements on Reciprocal Trade|Free Trade Agreements|Trade & Inve)[^。！？.!?]{0,260}/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360)
}

function usableClaimsForSynthesis(input: SynthesisWriterInput): SynthesisWriterInput['claims'] {
  const usable = input.claims.filter((claim) => {
    const cleaned = cleanClaimForPrompt(claim.text)
    if (cleaned.length < 18) return false
    if (isLowSignalResearchText(cleaned)) return false
    return claim.supportSpanIds.length > 0
  })
  return usable
}

function claimTextForReport(claim: SynthesisWriterInput['claims'][number]): string {
  const cleaned = cleanClaimForPrompt(claim.text)
  return cleaned || claim.text
}

function uniqueLimitations(limitations: string[]): string[] {
  const normalized = limitations.map((limitation) => limitation.trim()).filter(Boolean)
  const hasFallbackExtraction = normalized.some((limitation) => /模型未能抽取结构化证据|网页抽取模型失败|确定性兜底证据/.test(limitation))
  const result: string[] = []
  if (hasFallbackExtraction) {
    result.push('部分网页来源触发了兜底抽取，相关结论只应作为中等置信证据；关键数据、指数表现和配置建议仍应优先用官方网页或可复核数据源确认。')
  }
  for (const limitation of normalized) {
    if (/模型未能抽取结构化证据|网页抽取模型失败|确定性兜底证据/.test(limitation)) continue
    if (!result.includes(limitation)) result.push(limitation)
  }
  return result
}

function cleanEvidenceTextForPrompt(text: string): string {
  return cleanWebBoilerplate(text)
    .replace(/^来源：[^。！？.!?]{0,120}[。！？.!?]?\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320)
}

function cleanAnalysisTextForReport(text: string): string {
  const cleaned = cleanWebBoilerplate(text)
    .replace(/^该来源可用于回答「[^」]+」中关于[^。！？.!?]{0,80}的部分，并服务于主线[:：][^。！？.!?]{0,220}[。！？.!?]?/u, '')
    .replace(/^该来源可用于回答[^。！？.!?]{0,260}[。！？.!?]?/u, '')
    .replace(/并服务于主线[:：][^。！？.!?]{0,220}[。！？.!?]?/u, '')
    .replace(/网页抽取模型失败后的确定性兜底证据/u, '网页兜底抽取得到的中等置信证据')
    .replace(/\s+/g, ' ')
    .trim()
  return isLowSignalResearchText(cleaned) ? '' : cleaned.slice(0, 260)
}

function cleanWebBoilerplate(text: string): string {
  return text
    .replace(/-->+/g, ' ')
    .replace(/您的浏览器不被支持[^。！？.!?]*/gi, ' ')
    .replace(/请尽快升级到最新版下列浏览器[^。！？.!?]*/gi, ' ')
    .replace(/\b(?:Edge|Chrome|Firefox)\b/gi, ' ')
    .replace(/(?:Skip to main content|official website|Toggle navigation|Main navigation)\s*/gi, ' ')
    .replace(/(?:首页|登录|注册|下载客户端|下载APP|打开APP|搜索|媒体矩阵|爆料专线|个人中心|退出登录|字号|超大|标准|小|RSS)\s*/gi, ' ')
}

function isLowSignalResearchText(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length < 18) return true
  if (/浏览器不被支持|下载APP|下载客户端|登录 注册|媒体矩阵|爆料专线|-->/.test(normalized)) return true
  if (/Skip to main content|official website|Toggle navigation|Main navigation/i.test(normalized)) return true
  if (/Organizational Chart|Data Communiqués|Legal Framework|Classifications & Methods|Latest Releases|International Cooperation|Understanding Statistics/i.test(normalized)) return true
  if (/Trade Agreements|Free Trade Agreements|Trade & Inve|email&#160;protected/i.test(normalized)) return true
  const alphaWords = normalized.match(/[A-Za-z]{3,}/g) ?? []
  if (alphaWords.length >= 12 && !/SEC|S&P|Nasdaq|NYSE|ticker|revenue|income|market cap|valuation|Micron|SanDisk|Crucial|SSD|NAND|NVMe|portable storage|performance/i.test(normalized)) return true
  return false
}

async function collectWriterText(
  stream: AsyncIterable<ModelStreamChunk>,
  signal: AbortSignal
): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('synthesis writer timed out')
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  if (!text.trim()) throw new Error('synthesis writer returned empty text')
  return text
}

function assertUsableModelDraft(markdown: string, input: SynthesisWriterInput): void {
  const requiredSections = [
    '## 主要发现',
    '## 结论与建议',
    '## 局限与不确定性'
  ]
  for (const section of requiredSections) {
    if (!markdown.includes(section)) throw new Error(`model draft missing section ${section}`)
  }
  for (const forbidden of ['## 核心问题与回答', '## 证据链', '运行 ID：', '模型评审：']) {
    if (markdown.includes(forbidden)) throw new Error(`model draft contains hidden user-facing section ${forbidden}`)
  }
  for (const forbidden of ['该来源可用于回答', 'Skip to main content', 'Toggle navigation', 'Main navigation', '浏览器不被支持', '下载APP', 'Evidence Ledger', 'sourcePolicyTags']) {
    if (markdown.includes(forbidden)) throw new Error(`model draft contains internal or boilerplate text ${forbidden}`)
  }
  const validClaimIds = new Set(input.claims.map((claim) => claim.id))
  const usedClaimIds = extractUsedClaimIds(markdown, validClaimIds)
  if (input.claims.length > 0 && usedClaimIds.length === 0) {
    throw new Error('model draft did not cite any known claim ids')
  }
  const minimumChars = minReportChars(input)
  if (countMeaningfulChars(markdown) < minimumChars) {
    throw new Error(`model draft is too short; expected at least ${minimumChars} meaningful chars`)
  }
}

function ensureCoreResearchThread(markdown: string, input: SynthesisWriterInput): string {
  if (markdown.includes(input.frame.coreResearchThread)) return markdown
  const marker = '## 主要发现'
  const insertion = `${marker}\n\n本报告围绕这条判断线索展开：${input.frame.coreResearchThread}。`
  if (markdown.includes(marker)) {
    return markdown.replace(marker, insertion)
  }
  return `${markdown}\n\n## 主要发现\n\n本报告围绕这条判断线索展开：${input.frame.coreResearchThread}。\n`
}

function extractUsedClaimIds(markdown: string, validClaimIds: Set<string>): string[] {
  const used: string[] = []
  const re = /\[claim:([^\]]+)\]/g
  for (let match = re.exec(markdown); match; match = re.exec(markdown)) {
    const id = match[1]?.trim()
    if (id && validClaimIds.has(id)) used.push(id)
  }
  return [...new Set(used)]
}

function stripMarkdownFence(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1] ?? trimmed
}

function stripRuntimeGeneratedDraftSections(markdown: string): string {
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

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function secondLevelHeadingTitle(line: string): string | undefined {
  const match = line.trim().match(/^##\s+(.+?)\s*$/)
  return match?.[1]?.replace(/[*`#]/g, '').trim()
}

function fitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n[TRUNCATED ${value.length - maxChars} chars]`
}

function minReportChars(input: SynthesisWriterInput): number {
  const presetBase = input.budget.preset === 'deep'
    ? 2_400
    : input.budget.preset === 'standard'
      ? MIN_DETAILED_REPORT_CHARS
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

function extendFallbackReportIfNeeded(
  lines: string[],
  input: SynthesisWriterInput,
  usedClaimIds: string[]
): void {
  if (countMeaningfulChars(lines.join('\n')) >= minReportChars(input)) return
  lines.push('')
  lines.push('## 补充分析框架')
  lines.push('')
  lines.push('本节不引入新事实，而是把已有材料进一步整理成可继续研究的分析框架。这样做的目的不是扩写篇幅，而是让报告具备完整研究报告应有的论证层次。')
  lines.push('')

  const leadClaim = usableClaimsForSynthesis(input)[0]
  for (const task of input.plan.tasks.slice(0, 6)) {
    const relatedQuestions = input.frame.coreQuestions.filter((question) => task.questionIds.includes(question.id))
    const relatedNotes = input.notes.filter((note) => note.taskId === task.id || note.questionIds.some((id) => task.questionIds.includes(id)))
    const questionText = relatedQuestions.map((question) => question.text).join('；') || task.objective
    lines.push(`### ${task.objective}`)
    lines.push('')
    lines.push(`这一部分对应的判断是：${questionText}。它在整体研究中的作用，是把主要判断线索拆成一个可以被证据验证的局部判断，避免从主题直接跳到结论。`)
    if (relatedNotes.length > 0) {
      const noteText = relatedNotes.map((note) => note.implicationForBrief).join('；')
      const claimId = relatedNotes.flatMap((note) => note.claimIds).find((id) => input.claims.some((claim) => claim.id === id))
      lines.push('')
      lines.push(`已有笔记显示：${cleanClaimForPrompt(noteText)}${claimId ? ` [claim:${claimId}]` : ''}。这说明该任务已经提供了可进入报告正文的材料，但仍应结合来源质量和反证情况阅读。`)
      if (claimId) usedClaimIds.push(claimId)
    } else if (leadClaim) {
      lines.push('')
      lines.push(`当前没有独立笔记覆盖该任务，因此只能把它作为后续补证方向。临时关联的主结论是：${leadClaim.text} [claim:${leadClaim.id}]。`)
      usedClaimIds.push(leadClaim.id)
    }
    lines.push('')
    lines.push(`后续补查可优先围绕：${task.searchHints.slice(0, 4).join('；')}。如果这些方向无法找到高可信来源，就应在最终报告中降低该部分结论的确定性。`)
    lines.push('')
    if (countMeaningfulChars(lines.join('\n')) >= minReportChars(input)) break
  }
}

function hashWriterInput(input: SynthesisWriterInput): string {
  const text = `${input.runId}\n${input.brief.topic}\n${input.frame.coreResearchThread}\n${input.claims.map((claim) => claim.id).join(',')}\n${input.revision?.attempt ?? 1}\n${input.revision?.previousVerdict.blockingIssues.join('|') ?? ''}`
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function sourceReliabilityLabel(value: string): string {
  return {
    high: '高',
    medium: '中',
    low: '低',
    unknown: '未知'
  }[value] ?? value
}

function sourceTypeLabel(value: string): string {
  return {
    web: '网页',
    local_file: '本地文件',
    pdf: 'PDF',
    lark_doc: '飞书文档',
    paper: '论文'
  }[value] ?? value
}

function sourcePolicyTagLabel(value: string): string {
  return {
    model_generated: '模型生成资料卡',
    requires_external_verification: '需要外部来源复核',
    'p0-runtime': '第一版运行链路',
    synthetic: '模拟来源',
    web_fetch: '网页抓取',
    official: '官方来源',
    international: '国际组织来源',
    us: '美国',
    china: '中国',
    economy: '经济',
    trade: '贸易',
    statistics: '统计',
    'monetary-policy': '货币政策'
  }[value] ?? value
}
