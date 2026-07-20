/**
 * [INPUT]: 依赖 SynthesisWriterInput、证据准入、数字事实、行内技术术语和建议证据支持规则
 * [OUTPUT]: 对外提供蓝图约束和任意数量必填章节论证充分度要求的 Writer prompt、与最终质量门共享且随证据数量增长的章节深度校验、正文裸 URL/模型自建来源定义拒绝、公文编号/页码/条款定位前缀清理、证据裁剪、按实际 claim/span/来源身份与发布者分组生成的 evidenceTopologyLimitations、过期搜索/内部研究及“未覆盖分面”脚手架限制隔离（允许 claim/structured-claim 机器占位符中的内部绑定 id，拒绝正文泄露）、中文异常字间空格与正文归一化、中文正文中的长外文及短残缺混合语言检测、否定建议意图识别、统一结论标题、全报告未请求建议清理与引用/数字/术语/建议校验
 * [POS]: research/agents 的合成写作策略模块，被 SynthesisWriter 调用；技术术语按用户声明与全局合格证据准入，事实仍逐句绑定 claim；standard/deep 缺章直接失败
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ModelStreamChunk } from '../../ports/model-client.js'
import {
  minimumReportArgumentChars,
  reportArgumentMeetsDepth,
  reportArgumentSignals
} from '../core/report-argument.js'
import { resolveResearchReportTitle } from '../core/report-title.js'
import type { ResearchModelUsageRecord } from '../core/types.js'
import {
  canCiteEvidenceSpan,
  isEligibleStrongWebEvidence,
  researchDimensionFocusGroups
} from '../evidence/EvidenceEligibility.js'
import { numericTokens } from '../evidence/ClaimSupport.js'
import { reportBodyUrlIssue, splitCitationSentences } from '../evidence/CitationProximity.js'
import type { SynthesisWriterInput } from './types.js'

export const MIN_DETAILED_REPORT_CHARS = 1_800

export type SynthesisWriterPromptOptions = {
  compact?: boolean
  retryFeedback?: string
  edited?: boolean
  enforceChineseProse?: boolean
  enforceSectionDepth?: boolean
}

export function buildSynthesisWriterPrompt(input: SynthesisWriterInput, options: SynthesisWriterPromptOptions = {}): string {
  const promptClaims = claimsForPrompt(input, options)
  const promptEvidence = evidenceForPrompt(input, options)
  const hasRecommendationEvidence = promptClaims.some((claim) => claim.claimType === 'recommendation')
  const conclusionHeading = `## ${synthesisConclusionTitle(input, hasRecommendationEvidence)}`
  const writesRecommendations = conclusionHeading === '## 结论与建议'
  return [
    '请基于以下已确认写作要求、ReportBlueprint 和章节证据，写一篇完整中文 Markdown 报告。',
    ...(options.compact ? [
      '',
      '这是超时后的压缩重试：输入材料已减少，但输出仍必须是一篇完整报告，不能写摘要、提纲或解释。'
    ] : []),
    '',
    '硬性要求：',
    '- 只输出 Markdown 正文，不要代码块，不要解释你如何写作。',
    '- 标题使用 brief.topic。',
    `- 必须包含这些二级标题：## 主要发现、${conclusionHeading}、## 局限与不确定性。只有确有未解决问题时才输出“## 后续研究建议”。`,
    '- 不要输出这些 Runtime 会后置生成或用户不可见的章节/元数据：## 摘要、## 调研范围与方法、## 核心问题与回答、## 证据链、运行 ID、来源数量、论断数量、模型评审、报告完整度。',
    '- 不追求空泛字数，但 standard/deep 的每个必填章节至少写两段、五个完整句子：局部结论、多条关键证据、机制或权衡推理必须实质出现；每段必须新增信息。',
    '- “简洁”只表示删除重复和空话，不表示删减研究维度或把章节压缩成事实摘要。',
    '- 每个蓝图章节都必须自然完成论证：先给局部结论，再解释关键证据，随后说明证据如何推出结论；只有反证、证据缺口或适用条件会实质改变本章结论时，才在本章说明边界，否则统一放入“局限与不确定性”。不要写模板标签。',
    '- “主要发现”不要只列 bullet，每个重要发现至少写一段解释，并覆盖 coreQuestions 中的必要问题。',
    ...(writesRecommendations
      ? ['- “## 结论与建议”中的每条具体建议必须带至少一个 recommendation 类型的 [claim:claim_id]。']
      : ['- 本次没有 recommendation 类型证据，必须使用“## 结论”标题；该章节只写证据支持的结论和适用边界，不得改回“结论与建议”。']),
    '- 必须在“## 主要发现”开头直接回答问题，再按 ReportBlueprint.sections 顺序输出同名三级标题。',
    '- 每个 claim 必须在蓝图所属章节完成主要解释；只有说明章节关系时才允许在另一个章节交叉引用一次，且不得重复展开同一事实。',
    '- “结论”只综合全文 thesis、最重要的取舍和适用边界，不得逐章复述主要发现；最多使用两条最关键 claim 引用。',
    '- 必须按本次问题自己的关键维度综合，不要按来源逐条复述，也不要套用固定领域模板。',
    '- 把篇幅用在主要发现、机制解释、反证边界和结论建议上；不要解释运行过程、任务拆解或评分机制。',
    '- 写作时优先围绕“最能改变结论的证据”和领先假设展开；不要为了证明每个假设而平均分配篇幅。',
    '- 如果替代假设或 null hypothesis 被削弱/支持，要把它转化为结论边界或谨慎判断，不要写成内部假设列表。',
    '- 如果 Claim 来自网页兜底抽取，必须抽取其中可用事实并合并成判断，不要把网页标题、导航、APP 下载提示或搜索结果标题当作发现。',
    '- 不要逐字复制 Claim、Evidence 或 Research Notes；必须先把证据转化为面向用户的分析句，再用 claim id 标注支撑。',
    '- 证据只通过正文上标引用体现，不要单独列出证据来源、证据片段或证据链清单。',
    `- 本次运行使用 ${input.budget.preset} research preset；证据边界必须在“局限与不确定性”中自然说明。`,
    '- 必须实质回答 ReportBlueprint.directAnswer 和 thesis，但不要把内部字段名写进正文。',
    '- 每个关键事实性判断后使用 [claim:claim_id]，claim_id 只能来自“可用 Claim”。',
    '- “主要发现”和“结论”中的每个可外部核验事实句都必须在本句结束前带 [claim:claim_id]；不得只在整段末尾放一个引用替前面多句背书。',
    '- 只能陈述“可用 Claim”和对应 Evidence 明确支持的事实；模型知道但输入证据没有写出的技术常识、配置项、机制和最佳实践一律不得写入正文。',
    '- 每个包含技术行为、因果关系或配置建议的句子，引用的 Claim/Evidence 必须直接表达该行为、因果或建议；不能用相关但不等价的引用兜底。',
    '- 行内代码里的协议名、参数、指令、配置值和技术术语必须逐字出现在该句引用的 Claim 或 Evidence 中。',
    '- 报告中的价格、比例、日期、数量和倍数必须直接出现在所引用的 Claim 或 Evidence 中；不得自行计算新比例、发明使用阈值或把套餐额度外推成确定成本。',
    '- 含数字的句子必须引用直接包含该数字的 Claim；即使其他 Evidence 出现过同一数字，也不能用不含该数字的 Claim 代替。',
    `- 当前证据允许使用的阿拉伯数字仅有：${supportedNumericTokensForPrompt(input).join('、') || '无'}。列表序号除外，正文不得新增其他日期、金额、时长、次数、比例、版本号或阈值。`,
    ...(hasRecommendationEvidence
      ? ['- 有 recommendation 类型证据时，实操建议可以写清责任人、触发条件、动作、产物和复核方式，但不得超出对应证据。']
      : ['- 当前没有 recommendation 类型证据，不得编造实操建议；“结论”只能给出证据支持的判断、适用边界和下一步需要核验的问题。']),
    '- 证据没有数字时，禁止用虚构预算、工时、周期、调用量或阶段编号制造具体感。',
    '- 建议可以综合多条证据，但必须明确适用条件；没有直接证据时，不得使用“唯一”“一定”“完全没有优势”等绝对化结论。',
    '- 不要写 [^cit_1] 之类脚注，Runtime 会自动生成。',
    '- 可用 Claim 已经过证据准入；不要写“模型生成资料卡”或“需要外部来源复核”等与当前可用证据不符的免责声明，只描述输入中实际存在的来源、样本和时间边界。',
    '- 如果存在真实网页来源，要优先说明这些来源如何支撑结论，不要泛称为模拟资料。',
    '- 如果来源是网页抓取，正文称为“网页来源”“官方网页”“证据片段”，不要称为“模型资料卡”或只称“资料卡”。',
    '- “局限与不确定性”必须包含至少一个反面证据、边界条件或未解决问题；不要只写形式化 caveat。',
    '- 正文不要出现 raw English 内部标签，例如 model_generated、requires_external_verification、Evidence Span、P0、sourcePolicyTags。',
    '- 不要中英混排；除专有名词外使用中文。',
    ...(input.revision ? [
      '',
      '上一轮质量校验反馈（基于上一轮完整报告逐项修复，不要从零另写）：',
      JSON.stringify(revisionGuidance(input), null, 2),
      ...(input.revision.previousDraftMarkdown ? [
        '',
        '上一轮完整报告（必须保留已经合格的章节、引用占位符和论证，只修改反馈指出的问题）：',
        fitText(input.revision.previousDraftMarkdown, 18_000)
      ] : []),
      '',
      '修订要求：',
      '- 必须输出修改后的完整报告，不要只输出补丁、解释或差异；不得把上一轮完整章节压缩成事实摘要。',
      '- 必须优先修复 blockingIssues；如果证据不足，要在正文中明确说明缺口并用现有证据给出谨慎结论。',
      '- 对“引用不忠实、证据不足以支持、过度推断”类反馈，必须删除或降级原结论，不能只在局限章节补一句提醒后继续保留原断言。',
      '- 如果上一轮指出某个对象、选项或维度信息缺失，必须在“主要发现”和“结论与建议”里明确写出缺失边界，并引用相关原始材料或可用 claim 支撑。',
      '- 必须提升对 confirmed scope、brief.successCriteria、centralQuestion 和 coreResearchThread 的匹配度。',
      '- 不要沿用上一轮被打回的表达方式；尤其不要粘贴内部平台提示语、证据摘要原文或网页导航文本。'
    ] : []),
    ...(options.retryFeedback ? [
      '',
      '本次 Writer 上一稿被本地确定性校验拒绝：',
      options.retryFeedback,
      '必须重新生成全文并删除所有未被证据支持的数字、技术术语或具体建议；不要解释校验错误。'
    ] : []),
    '',
    'Brief：',
    JSON.stringify({
      topic: input.brief.topic,
      userIntent: input.brief.userIntent,
      targetAudience: input.brief.targetAudience,
      outputFormat: input.brief.outputFormat,
      successCriteria: input.brief.successCriteria,
      constraints: input.brief.constraints
    }, null, 2),
    '',
    'ReportBlueprint（正文结构和论证边界）：',
    JSON.stringify(input.reportBlueprint ?? {
      directAnswer: input.frame.centralQuestion,
      thesis: input.frame.coreResearchThread,
      sections: input.reportContract?.requiredSections ?? []
    }, null, 2),
    '',
    'SectionEvidenceMap（每个必填章节只能使用这里映射到的 claim/source；weak 章节必须低置信表达）：',
    options.compact
      ? fitText(JSON.stringify(input.sectionEvidenceMap ?? [], null, 2), 4_000)
      : JSON.stringify(input.sectionEvidenceMap ?? [], null, 2),
    '',
    '可用 Claim（只能使用这些 id）：',
    JSON.stringify(promptClaims.map((claim) => ({
      id: claim.id,
      text: cleanClaimForPrompt(claim.text),
      claimType: claim.claimType,
      confidence: claim.confidence,
      critical: claim.critical,
      supportSpanIds: claim.supportSpanIds
    })), null, 2),
    '',
    '引用上下文（只用于判断来源质量，不要直接复制到正文）：',
    fitText(JSON.stringify(promptEvidence.map((span) => {
      const source = input.sources.find((candidate) => candidate.id === span.sourceId)
      return {
        id: span.id,
        sourceId: span.sourceId,
        sourceTitle: source?.title,
        sourceType: source ? sourceTypeLabel(source.sourceType) : undefined,
        sourceReliability: source ? sourceReliabilityLabel(source.reliability) : undefined,
        text: cleanEvidenceTextForPrompt(span.text)
      }
    }), null, 2), options.compact ? 3_500 : 7_000)
  ].join('\n')
}

export function supportedNumericTokensForPrompt(input: SynthesisWriterInput): string[] {
  const claims = claimsForPrompt(input)
  const spanIds = new Set(claims.flatMap((claim) => claim.supportSpanIds))
  return [...new Set([
    ...claims.flatMap((claim) => numericTokens(claim.text)),
    ...input.evidenceSpans.filter((span) => spanIds.has(span.id)).flatMap((span) => numericTokens(span.text))
  ])].slice(0, 60)
}

export function assertSupportedDraftTechnicalTerms(markdown: string, input: SynthesisWriterInput): void {
  const unsupported = unsupportedDraftTechnicalTerms(markdown, input)
  if (unsupported.length > 0) {
    throw new Error(`report contains unsupported inline code tokens: ${unsupported.join(', ')}`)
  }
}

export function sanitizeUnsupportedDraftTechnicalTerms(markdown: string, input: SynthesisWriterInput): string {
  const support = technicalTermSupport(input)
  const lines = markdown.split('\n').map((line) => {
    if (!line.includes('`')) return line
    const listPrefix = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)/u)?.[1]
    const segments = line.match(/[^。！？!?；;]+[。！？!?；;]?/gu) ?? [line]
    const kept = segments.filter((segment) => unsupportedTechnicalTokensForLine(segment, support).length === 0)
    const cleaned = kept.join('').trim()
    if (!cleaned || !listPrefix || /^(?:[-*+]|\d+\.)\s/u.test(cleaned)) return cleaned
    return `${listPrefix}${cleaned}`
  })
  return lines.filter((line, index) => {
    if (line.trim() !== '') return true
    return index === 0 || lines[index - 1]?.trim() !== ''
  }).join('\n').trim()
}

function unsupportedDraftTechnicalTerms(markdown: string, input: SynthesisWriterInput): string[] {
  const support = technicalTermSupport(input)
  return [...new Set(markdown
    .split('\n')
    .filter((line) => line.includes('`'))
    .flatMap((line) => unsupportedTechnicalTokensForLine(line, support)))]
}

function technicalTermSupport(input: SynthesisWriterInput): {
  claimById: Map<string, SynthesisWriterInput['claims'][number]>
  spanById: Map<string, SynthesisWriterInput['evidenceSpans'][number]>
  globalSupportText: string
  declaredResearchText: string
} {
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const globalSupportText = [
    ...input.claims.map((claim) => claim.text),
    ...input.evidenceSpans.map((span) => span.text)
  ].join('\n').normalize('NFKC').toLowerCase()
  const declaredResearchText = [
    input.brief.topic,
    input.brief.userIntent,
    ...(input.brief.userClarifications ?? []),
    input.frame.centralQuestion,
    input.frame.coreResearchThread,
    ...input.frame.coreQuestions.map((question) => question.text),
    ...(input.reportContract?.requiredSections ?? []).map((section) => section.title)
  ].join('\n').normalize('NFKC').toLowerCase()
  return { claimById, spanById, globalSupportText, declaredResearchText }
}

function unsupportedTechnicalTokensForLine(
  line: string,
  support: ReturnType<typeof technicalTermSupport>
): string[] {
  const claimIds = [...line.matchAll(/\[claim:([^\]]+)\]/g)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter((claimId): claimId is string => Boolean(claimId))
  const claims = claimIds
    .map((claimId) => support.claimById.get(claimId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
  const citedSupportText = [
    ...claims.map((claim) => claim.text),
    ...claims.flatMap((claim) => claim.supportSpanIds)
      .map((spanId) => support.spanById.get(spanId)?.text ?? '')
      .filter(Boolean)
  ].join('\n').normalize('NFKC').toLowerCase()
  const supportText = `${support.declaredResearchText}\n${support.globalSupportText}\n${citedSupportText}`
  return inlineTechnicalTokens(line)
    .filter((token) => !supportText.includes(token.normalize('NFKC').toLowerCase()))
}

export function assertSupportedDraftRecommendations(markdown: string, input: SynthesisWriterInput): void {
  if (input.budget.preset === 'quick') return
  const recommendationClaimIds = new Set(input.claims
    .filter((claim) => claim.claimType === 'recommendation')
    .map((claim) => claim.id))
  const unsupported = markdown.split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .filter(isConcreteRecommendationLine)
    .filter((line) => {
      const citedClaimIds = [...line.matchAll(/\[claim:([^\]]+)\]/g)]
        .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
        .filter((claimId): claimId is string => Boolean(claimId))
      return !citedClaimIds.some((claimId) => recommendationClaimIds.has(claimId))
    })
  if (unsupported.length > 0) {
    throw new Error(`report contains recommendations without recommendation evidence: ${unsupported.slice(0, 2).join(' | ').slice(0, 320)}`)
  }
}

export function sanitizeUnrequestedDraftRecommendations(markdown: string, input: SynthesisWriterInput): string {
  if (researchRequestsRecommendations(input)) return markdown
  const recommendationClaimIds = new Set(input.claims
    .filter((claim) => claim.claimType === 'recommendation')
    .map((claim) => claim.id))

  return markdown.split('\n').map((line) => {
    if (/^#{1,6}\s+/u.test(line.trim()) || !line.trim()) return line
    return splitCitationSentences(line)
      .filter((sentence) => !isConcreteRecommendationLine(sentence) &&
        !citedClaimIds(sentence).some((claimId) => recommendationClaimIds.has(claimId)))
      .join('')
      .trim()
  }).join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function citedClaimIds(text: string): string[] {
  return [...text.matchAll(/\[(?:structured-)?claim:([^\]]+)\]/g)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter((claimId): claimId is string => Boolean(claimId))
}

export function researchRequestsRecommendations(input: SynthesisWriterInput): boolean {
  const text = `${input.brief.topic}\n${input.brief.userIntent}`
  for (const match of text.matchAll(/建议|行动方案|实施方案|怎么做|如何配置|决策建议|recommend/giu)) {
    const prefix = text.slice(Math.max(0, match.index - 28), match.index)
    const clausePrefix = prefix.slice(Math.max(
      prefix.lastIndexOf('。'),
      prefix.lastIndexOf('！'),
      prefix.lastIndexOf('？'),
      prefix.lastIndexOf(';'),
      prefix.lastIndexOf('；'),
      prefix.lastIndexOf('\n')
    ) + 1)
    if (/(?:不(?:要|需要|需|提供|给出|包含|涉及|作|做)?|无需|无须|禁止|避免|排除|别)[^。！？!?；;\n]{0,24}$/u.test(clausePrefix)) continue
    return true
  }
  return false
}

export function synthesisConclusionTitle(
  input: SynthesisWriterInput,
  hasRecommendationEvidence = input.claims.some((claim) => claim.claimType === 'recommendation')
): '结论' | '结论与建议' {
  return input.budget.preset === 'quick' || (hasRecommendationEvidence && researchRequestsRecommendations(input))
    ? '结论与建议'
    : '结论'
}

function isConcreteRecommendationLine(line: string): boolean {
  if (/(?:不|不能|无法|无需|无须|未|没有|缺少|不足以).{0,24}(?:建议|推荐|应当|应该|应优先|应确保|优先使用|采用)/u.test(line)) return false
  if (/(?:应当|应该|应)(?:被)?(?:理解|视为|区分|解释|看作|表述|认识)/u.test(line)) return false
  return /建议|推荐|应优先|应确保|优先使用|可以采用|可采用|(?:提示)?需要(?:新的|进一步|持续)?[^。！？!?]{2,48}(?:来|以便|从而)(?:维持|提升|改善|降低|实现)|(?:应当|应该).{0,16}(?:使用|采用|配置|设置|选择|调整|实施|部署|执行|限制|禁用|启用|保存|验证|更新)|(?<![对响适相呼供反])应(?:直接|优先)?(?:使用|采用|配置|设置|选择|调整|实施|部署|执行|限制|禁用|启用|保存|验证|更新)/u.test(line)
}

function inlineTechnicalTokens(line: string): string[] {
  return [...line.matchAll(/`([^`\n]{2,80})`/g)]
    .flatMap((match) => (match[1] ?? '').split(/[\s=:;,/()（）]+/u))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && /[\p{L}]/u.test(token))
}

export function revisionGuidance(input: SynthesisWriterInput): Record<string, unknown> {
  const revision = input.revision
  if (!revision) return {}
  return {
    previousAttempt: revision.attempt - 1,
    nextAttempt: revision.attempt,
    scores: revision.previousVerdict.scores,
    blockingIssues: revision.previousVerdict.blockingIssues.slice(0, 5),
    warnings: revision.previousVerdict.warnings.slice(0, 4),
    recommendedFixes: revision.previousVerdict.recommendedFixes.slice(0, 5)
  }
}

export function claimsForPrompt(input: SynthesisWriterInput, options: SynthesisWriterPromptOptions = {}): SynthesisWriterInput['claims'] {
  const allUsable = usableClaimsForSynthesis(input)
  const allocatedClaimIds = new Set((input.sectionEvidenceMap ?? []).flatMap((section) => section.claimIds))
  const usable = allocatedClaimIds.size > 0
    ? allUsable.filter((claim) => allocatedClaimIds.has(claim.id))
    : allUsable
  const usableById = new Map(usable.map((claim) => [claim.id, claim]))
  const sectionBalanced = (input.sectionEvidenceMap ?? [])
    .flatMap((section) => section.claimIds
      .map((claimId) => usableById.get(claimId))
      .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
      .sort((left, right) => claimSourceQuality(input, right) - claimSourceQuality(input, left))
      .slice(0, 3)
      .map((claim) => claim.id))
    .map((claimId) => usableById.get(claimId))
    .filter((claim): claim is NonNullable<typeof claim> => Boolean(claim))
  const ordered = uniqueClaims([
    ...sectionBalanced,
    ...usable.filter((claim) => claim.critical),
    ...usable.filter((claim) => !claim.critical)
  ])
  const maxClaims = options.compact
    ? input.budget.preset === 'deep' ? 18 : input.budget.preset === 'standard' ? 16 : 8
    : input.budget.preset === 'deep' ? 28 : input.budget.preset === 'standard' ? 24 : 12
  return ordered.slice(0, maxClaims)
}

function claimSourceQuality(input: SynthesisWriterInput, claim: SynthesisWriterInput['claims'][number]): number {
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  return Math.max(0, ...claim.supportSpanIds.map((spanId) => {
    const span = spanById.get(spanId)
    const source = sourceById.get(span?.sourceId ?? '')
    if (source && isEligibleStrongWebEvidence(source, span)) return 4
    if (!source || !canCiteEvidenceSpan(span, source)) return 0
    if (source.reliability === 'high') return 3
    if (source.reliability === 'medium') return 2
    return 1
  }))
}

export function evidenceForPrompt(input: SynthesisWriterInput, options: SynthesisWriterPromptOptions = {}): SynthesisWriterInput['evidenceSpans'] {
  const claimIds = new Set(claimsForPrompt(input, options).flatMap((claim) => claim.supportSpanIds))
  return input.evidenceSpans
    .filter((span) => claimIds.has(span.id))
    .filter((span) => cleanEvidenceTextForPrompt(span.text).length >= 20)
    .slice(0, options.compact ? input.budget.preset === 'deep' ? 16 : 12 : input.budget.preset === 'deep' ? 24 : 16)
}

export function notesForPrompt(input: SynthesisWriterInput, options: SynthesisWriterPromptOptions = {}): SynthesisWriterInput['notes'] {
  const claimIds = new Set(claimsForPrompt(input, options).map((claim) => claim.id))
  return input.notes
    .filter((note) => note.claimIds.some((claimId) => claimIds.has(claimId)))
    .slice(0, options.compact ? input.budget.preset === 'deep' ? 14 : 10 : input.budget.preset === 'deep' ? 20 : 14)
}

export function appendReportContractSections(
  lines: string[],
  input: SynthesisWriterInput,
  usedClaimIds: string[],
  claimsForUse: SynthesisWriterInput['claims']
): void {
  const sections = input.reportContract?.requiredSections ?? []
  if (sections.length === 0) return
  for (const section of sections) {
    lines.push(`### ${section.title}`)
    lines.push('')
    const relevantClaims = claimsForContractSection(input, section.questionIds, section.title, claimsForUse)
    if (relevantClaims.length === 0) {
      lines.push(`${section.limitationFallback} 这不是一个可以被忽略的空白，而是当前结论的置信度边界：如果后续补证得到相反材料，本节判断需要优先调整。`)
    } else {
      const cited = relevantClaims.slice(0, 3)
      usedClaimIds.push(...cited.map((claim) => claim.id))
      lines.push(`${cited.map((claim) => `${claimTextForReport(claim)} [claim:${claim.id}]`).join('；')}。`)
      lines.push('')
      const relatedNotes = input.notes.filter((note) => note.claimIds.some((claimId) => cited.some((c) => c.id === claimId)))
      const implications = relatedNotes.map((note) => cleanAnalysisTextForReport(note.implicationForBrief)).filter(Boolean).slice(0, 2)
      const limitations = relatedNotes.flatMap((note) => note.limitations).filter(Boolean).slice(0, 2)
      if (implications.length > 0) {
        lines.push(`${implications.join('；')}。`)
      }
      if (limitations.length > 0) {
        lines.push(`需要注意：${limitations.join('；')}。`)
      }
    }
    lines.push('')
  }
}

export function claimsForContractSection(
  input: SynthesisWriterInput,
  questionIds: string[],
  title: string,
  claimsForUse: SynthesisWriterInput['claims']
): SynthesisWriterInput['claims'] {
  const claimIdsFromQuestions = new Set(input.notes
    .filter((note) => note.questionIds.some((questionId) => questionIds.includes(questionId)))
    .flatMap((note) => note.claimIds))
  const titleTerms = title
    .split(/[：:/与和、\s]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
  const matchedByQuestionOrTitle = claimsForUse.filter((claim) =>
    claimIdsFromQuestions.has(claim.id) ||
    titleTerms.some((term) => claim.text.includes(term))
  )
  if (matchedByQuestionOrTitle.length > 0 || !isComparisonResearch(input)) {
    return matchedByQuestionOrTitle
  }
  const sectionSourceIds = new Set(
    input.evidenceSpans
      .filter((span) => titleTerms.some((term) => span.text.includes(term) || (input.sources.find((s) => s.id === span.sourceId)?.title ?? '').includes(term)))
      .map((span) => span.sourceId)
  )
  return claimsForUse.filter((claim) =>
    claim.supportSpanIds.some((spanId) => {
      const span = input.evidenceSpans.find((s) => s.id === spanId)
      return span && sectionSourceIds.has(span.sourceId)
    })
  )
}

export function groupClaimsForSynthesis(input: SynthesisWriterInput, claimsForUse = usableClaimsForSynthesis(input)): Array<{
  dimension: string
  claimIds: string[]
  facts: string[]
}> {
  const groups = new Map<string, Array<{ id: string; text: string }>>()
  for (const claim of claimsForUse) {
    const dimension = claimDimension(input, claim)
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

export function coreAllocationJudgement(
  input: SynthesisWriterInput,
  dimensionGroups: Array<{ dimension: string; claimIds: string[]; facts: string[] }>,
  usedClaimIds: string[]
): string {
  const citedClaims = dimensionGroups.flatMap((group) => group.claimIds).slice(0, 4)
  usedClaimIds.push(...citedClaims)
  const citations = citedClaims.map((claimId) => `[claim:${claimId}]`).join(' ')
  const dimensions = dimensionGroups.map((group) => group.dimension).slice(0, 6).join('、')
  if (isComparisonResearch(input)) {
    return `围绕“${input.frame.centralQuestion}”，现有证据覆盖了${dimensions || '多个关键维度'}。核心结论必须逐项说明差异、证据强弱和适用条件，不能笼统宣布某一方在所有场景都更优。${citations}`
  }
  return `围绕“${input.frame.centralQuestion}”，现有证据覆盖了${dimensions || '多个关键维度'}。核心结论应优先服从可验证事实、用户目标和边界条件，不能由单个醒目事实直接外推。${citations}`
}

export function claimDimension(
  input: SynthesisWriterInput,
  claim: SynthesisWriterInput['claims'][number]
): string {
  const mappedSection = input.sectionEvidenceMap?.find((section) => section.claimIds.includes(claim.id))
  if (mappedSection?.title) return mappedSection.title
  const prefix = claim.text.match(/^([^：:]{2,32})[：:]/)?.[1]?.trim()
  if (prefix) return prefix
  return {
    metric: '关键指标',
    date: '时间与变化',
    quote: '来源观点',
    opinion: '观点与分歧',
    inference: '综合推断',
    recommendation: '行动建议',
    fact: '关键事实'
  }[claim.claimType]
}

export function isComparisonResearch(input: SynthesisWriterInput): boolean {
  const text = `${input.brief.topic}\n${input.brief.userIntent}\n${input.frame.coreResearchThread}\n${input.frame.centralQuestion}`
  return /对比|比较|区别|差异|哪个|哪家|\bvs\.?\b|versus/i.test(text)
}

export function cleanClaimForPrompt(text: string): string {
  return cleanWebBoilerplate(text)
    .replace(/^(?:[A-Z]{1,16}(?:-[A-Z0-9]+){1,6})\s+Page\s+\d+\s+of\s+\d+\s+/iu, '')
    .replace(/^\d{3,6}(?:\([A-Za-z0-9]+\)){1,8}\s+(?=(?:to|would|will|shall|must|requires?|provides?|states?|increases?|decreases?)\b)/iu, '')
    .replace(/^来源：[^。！？.!?]{0,120}[。！？.!?]?\s*/u, '')
    .replace(/^该来源可用于回答[^。！？.!?]{0,220}[。！？.!?]?\s*/u, '')
    .replace(/并服务于主线[:：][^。！？.!?]{0,220}[。！？.!?]?/u, '')
    .replace(/来源「[^」]+」提供了?与本维度相关的可复核网页材料/u, '')
    .replace(/(?:Skip to main content|official website|Toggle navigation|Main navigation|Data by Topic|Data by Place|Data by Economic Account|Tools Intera)[^。！？.!?]{0,260}/gi, '')
    .replace(/(?:Organizational Chart|Data Communiqués|Legal Framework|Classifications & Methods|Latest Releases|International Cooperation|Understanding Statistics)[^。！？.!?]{0,260}/gi, '')
    .replace(/(?:Trade Agreements|Agreements on Reciprocal Trade|Free Trade Agreements|Trade & Inve)[^。！？.!?]{0,260}/gi, '')
    .replace(/[，；]\s*(?:这|由此)?(?:表明|显示|说明|证明|意味着|反映)[^。！？.!?]*[。！？.!?]?$/u, '。')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360)
}

export function usableClaimsForSynthesis(input: SynthesisWriterInput): SynthesisWriterInput['claims'] {
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceById = new Map(input.sources.map((source) => [source.id, source]))
  const usable = input.claims.filter((claim) => {
    const cleaned = cleanClaimForPrompt(claim.text)
    if (cleaned.length < 18) return false
    if (isLowSignalResearchText(cleaned)) return false
    return claim.supportSpanIds.some((spanId) => {
      const span = spanById.get(spanId)
      return canCiteEvidenceSpan(span, sourceById.get(span?.sourceId ?? ''))
    })
  })
  return usable
}

export function claimTextForReport(claim: SynthesisWriterInput['claims'][number]): string {
  const cleaned = cleanClaimForPrompt(claim.text)
  return cleaned || claim.text
}

export function uniqueLimitations(limitations: string[]): string[] {
  const normalized = limitations.map((limitation) => limitation.trim()).filter(Boolean)
  const result: string[] = []
  for (const limitation of normalized) {
    if (/模型未能抽取结构化证据|网页抽取模型失败|确定性兜底证据/.test(limitation)) continue
    if (isInternalResearchProcessLimitation(limitation)) continue
    if (!result.includes(limitation)) result.push(limitation)
  }
  return result
}

export function evidenceTopologyLimitations(input: SynthesisWriterInput): string[] {
  const selectedClaimIds = new Set((input.reportBlueprint?.sections ?? []).flatMap((section) => [
    ...section.claimIds,
    ...(section.contextClaimIds ?? [])
  ]))
  const selectedClaims = usableClaimsForSynthesis(input).filter((claim) => (
    selectedClaimIds.size === 0 || selectedClaimIds.has(claim.id)
  ))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const selectedSourceIds = new Set(selectedClaims.flatMap((claim) => claim.supportSpanIds)
    .map((spanId) => spanById.get(spanId)?.sourceId)
    .filter((sourceId): sourceId is string => Boolean(sourceId)))
  const selectedSources = input.sources.filter((source) => selectedSourceIds.has(source.id))
  const webSources = selectedSources.filter((source) => source.sourceType === 'web')
  const verifiedPrimarySources = webSources.filter((source) => source.sourcePolicyTags.some((tag) => (
    tag === 'document_verified_primary_source' || tag === 'model_verified_primary_source'
  )))
  const otherWebSources = webSources.filter((source) => !verifiedPrimarySources.some((candidate) => candidate.id === source.id))
  const publisherCounts = new Map<string, number>()
  for (const source of webSources) {
    const publisher = source.publisher?.normalize('NFKC').toLowerCase().trim()
    if (!publisher) continue
    publisherCounts.set(publisher, (publisherCounts.get(publisher) ?? 0) + 1)
  }
  const limitations: string[] = []
  if (webSources.some((source) => Boolean(source.accessedAt))) {
    limitations.push('现有来源受限于本次访问时可获得的网页版本；访问后的修订、更新和新事件未被当前证据覆盖。')
  }
  if (verifiedPrimarySources.length > 0) {
    limitations.push('现有证据包含已核验身份的原始发布材料，但其覆盖范围限于发布方公开陈述的事实，不能单独完成对评价性判断或因果关系的独立验证。')
  }
  if (otherWebSources.length > 0) {
    limitations.push('现有来源对部分网页的原始发布身份缺少核验；这些引文只用于其直接陈述，不能视为对其他来源的独立确认。')
  }
  if ([...publisherCounts.values()].some((count) => count > 1)) {
    limitations.push('现有来源受限于同一发布者的重复文档；这些文档不能构成彼此独立的交叉验证。')
  }
  if (limitations.length < 2) {
    limitations.push('现有证据只覆盖引文明确陈述的对象与条件；材料未直接说明的关系仍属于未验证推论。')
  }
  return uniqueLimitations(limitations)
}

export function isInternalResearchProcessLimitation(value: string): boolean {
  return /(?:没有可用网页种子源或联网搜索结果.{0,40}(?:退回|回退)|该证据只支持原文明确陈述|确定性补录只保留(?:抓取)?原文|最终报告不得超出原文含义|不支持从标题、导航、研究目的|任何影响判断都必须在写作阶段|模型漏抽内容|最终报告只能引用原文|网页来源已抓取.{0,80}(?:模型未能抽取|未入库|结构化抽取失败)|本节现有直接证据尚未独立覆盖全部分面|未覆盖部分仍缺少可引用证据，不能用已覆盖分面替代|web extraction|Runtime 不再|standard\/deep 模式不再调用)/iu.test(value)
}

export function cleanEvidenceTextForPrompt(text: string): string {
  return cleanWebBoilerplate(text)
    .replace(/^来源：[^。！？.!?]{0,120}[。！？.!?]?\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320)
}

export function cleanAnalysisTextForReport(text: string): string {
  const cleaned = cleanWebBoilerplate(text)
    .replace(/^该来源可用于回答「[^」]+」中关于[^。！？.!?]{0,80}的部分，并服务于主线[:：][^。！？.!?]{0,220}[。！？.!?]?/u, '')
    .replace(/^该来源可用于回答[^。！？.!?]{0,260}[。！？.!?]?/u, '')
    .replace(/并服务于主线[:：][^。！？.!?]{0,220}[。！？.!?]?/u, '')
    .replace(/网页抽取模型失败后的确定性兜底证据/u, '网页兜底抽取得到的中等置信证据')
    .replace(/\s+/g, ' ')
    .trim()
  return isLowSignalResearchText(cleaned) ? '' : cleaned.slice(0, 260)
}

export function cleanWebBoilerplate(text: string): string {
  return text
    .replace(/-->+/g, ' ')
    .replace(/您的浏览器不被支持[^。！？.!?]*/gi, ' ')
    .replace(/请尽快升级到最新版下列浏览器[^。！？.!?]*/gi, ' ')
    .replace(/\b(?:Edge|Chrome|Firefox)\b/gi, ' ')
    .replace(/(?:Skip to main content|official website|Toggle navigation|Main navigation)\s*/gi, ' ')
    .replace(/(?:首页|登录|注册|下载客户端|下载APP|打开APP|搜索|媒体矩阵|爆料专线|个人中心|退出登录|字号|超大|标准|小|RSS)\s*/gi, ' ')
}

export function isLowSignalResearchText(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length < 18) return true
  if (/浏览器不被支持|下载APP|下载客户端|登录 注册|媒体矩阵|爆料专线|-->/.test(normalized)) return true
  if (/Skip to main content|official website|Toggle navigation|Main navigation/i.test(normalized)) return true
  if (/Organizational Chart|Data Communiqués|Legal Framework|Classifications & Methods|Latest Releases|International Cooperation|Understanding Statistics/i.test(normalized)) return true
  if (/Trade Agreements|Free Trade Agreements|Trade & Inve|email&#160;protected/i.test(normalized)) return true
  return false
}

export async function collectWriterText(
  stream: AsyncIterable<ModelStreamChunk>,
  signal: AbortSignal,
  onUsage?: (usage: ResearchModelUsageRecord['usage']) => void
): Promise<{ text: string; usage: ResearchModelUsageRecord['usage'][] }> {
  let text = ''
  const usage: ResearchModelUsageRecord['usage'][] = []
  for await (const chunk of stream) {
    if (signal.aborted) throw new Error('synthesis writer timed out')
    if (chunk.kind === 'assistant_text_delta') text += chunk.text
    if (chunk.kind === 'usage') {
      usage.push(chunk.usage)
      onUsage?.(chunk.usage)
    }
    if (chunk.kind === 'error') throw new Error(chunk.message)
  }
  if (!text.trim()) throw new Error('synthesis writer returned empty text')
  return { text, usage }
}

export function assertUsableModelDraft(
  markdown: string,
  input: SynthesisWriterInput,
  options: SynthesisWriterPromptOptions = {}
): void {
  const conclusionHeading = `## ${synthesisConclusionTitle(input)}`
  const requiredSections = [
    '## 主要发现',
    conclusionHeading,
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
  if (/^\s*\[\d+\]:\s/mu.test(markdown)) {
    throw new Error('model draft contains model-authored reference definitions; citations must be generated from the evidence ledger')
  }
  const bodyUrl = reportBodyUrlIssue(markdown)
  if (bodyUrl) throw new Error(`model draft contains a raw URL or authored link in report prose: ${bodyUrl}`)
  const foreignExcerpt = options.enforceChineseProse && /中文|Chinese/iu.test(`${input.brief.outputFormat}\n${input.brief.userIntent}`)
    ? longForeignProseExcerpt(markdown)
    : undefined
  if (foreignExcerpt) {
    throw new Error(`Chinese report contains a long untranslated evidence excerpt: ${foreignExcerpt}`)
  }
  if (/\b(?:task|gap)_\w+_(?:claim|span|source|note)_\w+\b/iu.test(
    markdown.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
  )) {
    throw new Error('model draft contains raw internal research ids')
  }
  for (const section of input.reportContract?.requiredSections ?? []) {
    if (section.required && !markdown.includes(`### ${section.title}`) && !markdown.includes(section.title)) {
      throw new Error(`model draft missing report contract section ${section.title}`)
    }
  }
  if (input.budget.preset !== 'quick' && options.enforceSectionDepth !== false) {
    for (const section of input.reportContract?.requiredSections.filter((candidate) => candidate.required) ?? []) {
      const blueprintSection = input.reportBlueprint?.sections.find((candidate) => candidate.title === section.title)
      const claimCount = blueprintSection?.claimIds.length
        ?? input.sectionEvidenceMap?.find((candidate) => candidate.title === section.title)?.claimIds.length
        ?? 0
      const minimumSectionChars = minimumReportArgumentChars(
        Math.min(claimCount, 3),
        blueprintSection?.evidenceMode
      )
      const body = reportSubsectionBody(markdown, section.title)
      const evidenceCount = [...body.matchAll(/\[(?:claim|evidence):[^\]]+\]/gu)].length
      const signals = reportArgumentSignals(body)
      const comparisonFacets = researchDimensionFocusGroups(
        section.title,
        [
          input.brief.topic,
          input.frame.coreResearchThread,
          input.frame.centralQuestion,
          ...input.frame.coreQuestions.map((question) => question.text)
        ].join('\n')
      )
      if (!reportArgumentMeetsDepth({
        markdown: body,
        minimumChars: minimumSectionChars,
        evidenceCount,
        allowDirectComparison: comparisonFacets.length > 1,
        allowTerseArgument: false
      })) {
        throw new Error(
          `model draft section ${section.title} is a fact summary, not a complete argument ` +
          `(chars=${signals.chars}, requiredChars=${minimumSectionChars}, sentences=${signals.sentences}, paragraphs=${signals.paragraphs}, ` +
          `synthesis=${signals.hasSynthesis}, evidenceBoundary=${signals.hasEvidenceBoundary}); ` +
          `cleanedExcerpt=${JSON.stringify(body.replace(/\s+/gu, ' ').trim().slice(0, 800))}`
        )
      }
    }
  }
  const validClaimIds = new Set(input.claims.map((claim) => claim.id))
  const usedClaimIds = extractUsedClaimIds(markdown, validClaimIds)
  if (input.claims.length > 0 && usedClaimIds.length === 0) {
    throw new Error('model draft did not cite any known claim ids')
  }
}

export function longForeignProseExcerpt(markdown: string): string | undefined {
  const line = markdown.split('\n').find((candidate) => {
    if (/^\s*```/u.test(candidate)) return false
    const prose = candidate
      .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
      .trim()
    const hasLongForeignSegment = prose.split(/[\u4e00-\u9fff]+/u).some((segment) => {
      const latinWords = segment.match(/\b[A-Za-z][A-Za-z'-]{2,}\b/gu) ?? []
      return latinWords.length >= 14 && latinWords.join(' ').length >= 100
    })
    if (hasLongForeignSegment) return true
    const visibleProse = prose
      .replace(/^[\s>*_`#\[(]+/u, '')
      .trim()
    const hanCharacters = visibleProse.match(/[\u3400-\u9fff]/gu) ?? []
    const latinWords = visibleProse.match(/\b[A-Za-z][A-Za-z'-]{1,}\b/gu) ?? []
    return hanCharacters.length > 0
      && hanCharacters.length <= 12
      && latinWords.length >= 7
      && /^[a-z]/u.test(visibleProse)
  })
  if (!line) return undefined
  return line.replace(/\[claim:[^\]]+\]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 220)
}

function reportSubsectionBody(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const body: string[] = []
  let collecting = false
  for (const line of lines) {
    const heading = line.trim().match(/^(#{1,6})\s+(.+?)\s*$/u)
    if (heading) {
      const depth = heading[1]?.length ?? 0
      const headingTitle = heading[2]?.replace(/[*`#]/g, '').trim() ?? ''
      if (depth === 3 && headingTitle === title) {
        collecting = true
        continue
      }
      if (collecting && depth <= 3) break
    }
    if (collecting) body.push(line)
  }
  return body.join('\n').trim()
}

export function normalizeModelDraftSections(markdown: string, input?: SynthesisWriterInput): string {
  const hasRecommendationEvidence = input?.claims.some((claim) => claim.claimType === 'recommendation') ?? true
  const conclusionHeading = input
    ? `## ${synthesisConclusionTitle(input, hasRecommendationEvidence)}`
    : '## 结论与建议'
  let normalized = markdown
    .replace(/^##\s+(?:核心发现|发现|主要结论|分析与发现|Findings)\s*$/gmu, '## 主要发现')
    .replace(/^##\s+(?:结论|建议|行动建议|结论和建议|结论与建议|Conclusion|Recommendations)\s*$/gmu, conclusionHeading)
    .replace(/^##\s+(?:限制|局限|局限性|不确定性|风险与局限|Limitations)\s*$/gmu, '## 局限与不确定性')
    .replace(/^##\s+(?:下一步|后续补证|后续研究|Further Research)\s*$/gmu, '## 后续研究建议')

  const blueprintTitle = input
    ? resolveResearchReportTitle(input.brief.topic, input.reportBlueprint?.title)
    : undefined
  if (blueprintTitle) {
    normalized = /^#\s+.+$/mu.test(normalized)
      ? normalized.replace(/^#\s+.+$/mu, `# ${blueprintTitle}`)
      : `# ${blueprintTitle}\n\n${normalized}`
  }

  return normalized.replace(/\*\*/gu, '').replace(/\n{3,}/g, '\n\n').trim()
}

export function uniqueClaims(claims: SynthesisWriterInput['claims']): SynthesisWriterInput['claims'] {
  const seen = new Set<string>()
  return claims.filter((claim) => {
    if (seen.has(claim.id)) return false
    seen.add(claim.id)
    return true
  })
}

export function ensureReportContractSections(
  markdown: string,
  input: SynthesisWriterInput,
  claims: SynthesisWriterInput['claims']
): string {
  const missingSections = (input.reportContract?.requiredSections ?? [])
    .filter((section) => section.required)
    .filter((section) => !hasReportContractSection(markdown, section.title))
  if (missingSections.length === 0) return markdown
  if (input.budget.preset !== 'quick') {
    throw new Error(`model draft missing required report sections: ${missingSections.map((section) => section.title).join(', ')}`)
  }

  const lines = markdown.split('\n')
  const mainStart = lines.findIndex((line) => secondLevelHeadingTitle(line) === '主要发现')
  if (mainStart < 0) return markdown
  const nextSectionOffset = lines.slice(mainStart + 1).findIndex((line) => secondLevelHeadingTitle(line) !== undefined)
  const insertAt = nextSectionOffset < 0 ? lines.length : mainStart + 1 + nextSectionOffset
  const inserted = missingSections.flatMap((section) => fallbackReportContractSection(input, section, claims))
  return [
    ...lines.slice(0, insertAt),
    '',
    ...inserted,
    ...lines.slice(insertAt)
  ].join('\n')
}

export function hasReportContractSection(markdown: string, title: string): boolean {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^###\\s+${escaped}\\s*$`, 'mu').test(markdown)
}

export function fallbackReportContractSection(
  input: SynthesisWriterInput,
  section: NonNullable<SynthesisWriterInput['reportContract']>['requiredSections'][number],
  claims: SynthesisWriterInput['claims']
): string[] {
  const lines = [`### ${section.title}`, '']
  const relevantClaims = claimsForContractSection(input, section.questionIds, section.title, claims).slice(0, 3)
  if (relevantClaims.length === 0) {
    lines.push(`${section.limitationFallback} 这意味着本节只能作为低置信边界使用，不能替代后续补证。`)
    lines.push('')
    return lines
  }
  lines.push(`${relevantClaims.map((claim) => `${claimTextForReport(claim)} [claim:${claim.id}]`).join('；')}。`)
  const relatedNotes = input.notes.filter((note) => note.claimIds.some((claimId) => relevantClaims.some((claim) => claim.id === claimId)))
  const limitations = relatedNotes.flatMap((note) => note.limitations).filter(Boolean).slice(0, 2)
  if (limitations.length > 0) {
    lines.push('')
    lines.push(`边界条件是：${limitations.join('；')}。`)
  }
  lines.push('')
  return lines
}

export function extractUsedClaimIds(markdown: string, validClaimIds: Set<string>): string[] {
  const used: string[] = []
  const re = /\[(?:claim|structured-claim):([^\]]+)\]/g
  for (let match = re.exec(markdown); match; match = re.exec(markdown)) {
    for (const id of (match[1] ?? '').split(/[,，;；]/u).map((value) => value.trim()).filter(Boolean)) {
      if (validClaimIds.has(id)) used.push(id)
    }
  }
  return [...new Set(used)]
}

export function normalizeDraftCitationPlaceholders(markdown: string, input: SynthesisWriterInput): string {
  const usableClaims = usableClaimsForSynthesis(input)
  const usableEvidenceSpanIds = new Set(usableClaims.flatMap((claim) => claim.supportSpanIds))
  return markdown
    .replace(/\[claim:([^\]]+)\]/g, (placeholder, rawId: string) => {
      const ids = [...new Set(rawId.split(/[,，;；]/u)
        .map((candidate) => normalizePlaceholderId(candidate, usableClaims.map((claim) => claim.id)))
        .filter((id): id is string => Boolean(id)))]
      return ids.length > 0 ? `[claim:${ids.join(',')}]` : placeholder
    })
    .replace(/\[evidence:([^\]]+)\]/g, (placeholder, rawId: string) => {
      const id = normalizePlaceholderId(rawId, [...usableEvidenceSpanIds])
      return id ? `[evidence:${id}]` : placeholder
    })
}

export function normalizeDanglingProseEndings(markdown: string): string {
  return markdown.split('\n').map((line) => {
    const trimmed = line.trim()
    if (!trimmed || /^#{1,6}\s/u.test(trimmed) || /^```/u.test(trimmed) || trimmed.includes('|')) return line
    const spacingSafe = line.replace(/(?<=[\u3400-\u9fff])[\t ]+(?=[\u3400-\u9fff])/gu, '')
    return spacingSafe.replace(
      /[，,；;：:]\s*((?:(?:\[(?:claim|evidence):[^\]]+\]|<sup\b[\s\S]*?<\/sup>)\s*)*)$/iu,
      '。$1'
    )
  }).join('\n')
}

function normalizePlaceholderId(rawId: string, allowedIds: string[]): string | undefined {
  const normalized = rawId.trim()
  if (allowedIds.includes(normalized)) return normalized
  const candidates = allowedIds
    .filter((id) => normalized.startsWith(id))
    .filter((id) => /^(?:\s|的|之|所|用于|作为|对应|相关|上下文|限制|边界|说明|[，,。；;：:）)])/u.test(normalized.slice(id.length)))
    .sort((left, right) => right.length - left.length)
  return candidates.length === 1 ? candidates[0] : undefined
}

export function stripMarkdownFence(value: string): string {
  const trimmed = value.trim()
  const match = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i)
  return match?.[1] ?? trimmed
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function stripRuntimeGeneratedDraftSections(markdown: string): string {
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

export function secondLevelHeadingTitle(line: string): string | undefined {
  const match = line.trim().match(/^##\s+(.+?)\s*$/)
  return match?.[1]?.replace(/[*`#]/g, '').trim()
}

export function fitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n\n[TRUNCATED ${value.length - maxChars} chars]`
}

export function hashWriterInput(input: SynthesisWriterInput): string {
  const text = `${input.runId}\n${input.brief.topic}\n${input.frame.coreResearchThread}\n${input.claims.map((claim) => claim.id).join(',')}\n${input.revision?.attempt ?? 1}\n${input.revision?.previousVerdict.blockingIssues.join('|') ?? ''}`
  let hash = 0
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

export function sourceReliabilityLabel(value: string): string {
  return {
    high: '高',
    medium: '中',
    low: '低',
    unknown: '未知'
  }[value] ?? value
}

export function sourceTypeLabel(value: string): string {
  return {
    web: '网页',
    local_file: '本地文件',
    pdf: 'PDF',
    lark_doc: '飞书文档',
    paper: '论文'
  }[value] ?? value
}

export function sourcePolicyTagLabel(value: string): string {
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
