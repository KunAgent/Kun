/**
 * [INPUT]: 依赖 ModelClient、运行级模型选择、含主 claim/contextClaimIds/evidenceMode 的 ReportBlueprint、已通过 Writer 校验的 DraftReport 和 claim 占位符
 * [OUTPUT]: 对外提供支持当前模型/Provider 的 PassThroughResearchEditor、ModelResearchEditor、章内及主要发现跨章节的近义证据句去重、摘要跨繁简近义事实去重与综合句近义去重、跨段断裂综合句修复、无法补全的悬空综合句删除、引用解析后的成品级裸 URL/抽取污染清理/断句/列表项去重、压缩整稿回声、未完成并列综合句、无依据因果对立和网页元数据清理、章节首句悬空连接修复、结论完整度与最小引用覆盖、编辑清洗后逐章恢复并校验硬范围代表 claim 与穷尽缺证边界、从共享证据拓扑恢复至少两条具体实质局限，以及允许蓝图上下文证据进入摘要/结论但不越权进入其他正文章的句级校验
 * [POS]: research/agents 的责任编辑节点，位于正文作者与 CitationResolver 之间，只改善结构和表达，不增加事实
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { makeUserItem } from '../../domain/item.js'
import type { ModelClient, ModelRequest } from '../../ports/model-client.js'
import { linkResearchAbortSignal, throwIfResearchAborted } from '../core/abort.js'
import { researchReasoningForStage } from '../core/presets.js'
import { requiredConditionalContextClaimCount } from '../core/report-argument.js'
import { repairDanglingConclusionConnectors, reportClosingDepthIssue, reportLimitationsDepthIssue } from '../core/report-closing.js'
import { normalizeResearchChineseScript } from '../core/chinese-script.js'
import { estimateResearchRequestTokens } from '../core/token-estimate.js'
import type { ResearchModelUsageRecord } from '../core/types.js'
import type { DraftReport, ResearchEditor, ResearchEditorInput, SynthesisWriterInput } from './types.js'
import {
  assertSupportedDraftRecommendations,
  assertSupportedDraftTechnicalTerms,
  assertUsableModelDraft,
  collectWriterText,
  evidenceTopologyLimitations,
  extractUsedClaimIds,
  isInternalResearchProcessLimitation,
  normalizeModelDraftSections,
  normalizeDraftCitationPlaceholders,
  normalizeDanglingProseEndings,
  sanitizeUnsupportedDraftTechnicalTerms,
  stripMarkdownFence,
  stripRuntimeGeneratedDraftSections
} from './SynthesisWriterSupport.js'
import { assertSupportedDraftNumbers } from './SynthesisDraftNumberSafety.js'
import { removeCollapsedReportEchoLines, stripFindingsPreambleBeforeMultipleSubsections } from '../markdown/ReportRenderer.js'
import {
  containsExtractionBoilerplate,
  hasExplicitEvidenceGapBoundary,
  pruneUnusedCitationDefinitions,
  reportSentencesAreNearDuplicates,
  sanitizeExtractionBoilerplateSentences,
  splitCitationSentences,
  sanitizeUncitedDraftSentences
} from '../evidence/CitationProximity.js'

const RESEARCH_EDITOR_TIMEOUT_MS = 120_000

const EDITORIAL_SCAFFOLD_PHRASES = [
  '本节当前最关键的证据是',
  '它对最终判断的影响在于',
  '这样的结构可以避免',
  '这一维度需要与其他证据维度合并判断',
  '本报告不是把所有材料平均展开',
  '后续补查可优先围绕',
  '这一部分对应的判断是',
  '可以帮助用户理解主结论背后的结构性原因'
]

export const MODEL_RESEARCH_EDITOR_SYSTEM_PROMPT = [
  '你是 Kun DeepResearch 的责任编辑。作者已经完成带 claim 占位符的报告。',
  '你可以删重复、合并段落、改善顺序和过渡，并用已有引用事实重写证据到局部结论的关系与具体适用边界；不能增加任何新事实、数字、术语、建议或 claim id。',
  '必须保留报告蓝图要求的章节，并让开头先直接回答用户问题。',
  '每个蓝图章节必须保留作者原稿中的局部结论、关键证据、推理和适用边界；不得把完整论证压缩成一条事实摘要。',
  '多分面标题必须在用户可见正文中逐面回答；单证据章节必须保留该 claim 的具体前提和未覆盖情形，禁止使用空泛边界模板。',
  '删除写作脚手架、研究过程说明和同义反复；不要解释你的修改。',
  '只输出完整 Markdown 正文。'
].join('\n')

export class PassThroughResearchEditor implements ResearchEditor {
  async editDraft(input: ResearchEditorInput): Promise<DraftReport> {
    const writerMarkdown = input.draft.markdown
    const originalMarkdown = dedupeRepeatedParagraphs(writerMarkdown)
    const safetyMarkdown = finalizeEditorSafetyMarkdown(originalMarkdown, input)
    const normalizedMarkdown = finalizeEditorMarkdown(originalMarkdown, input)
    let markdown = normalizedMarkdown
    try {
      assertFinalizedEditorDraft(normalizedMarkdown, input, true, false)
    } catch {
      // Writer already passed the same structural and evidence assertions. If
      // citation cleanup removes argument depth, keep the richer draft but never
      // restore extraction noise or a false model-fallback disclosure.
      try {
        assertFinalizedEditorDraft(normalizedMarkdown, input, false, false)
        markdown = normalizedMarkdown
      } catch {
        try {
          assertFinalizedEditorDraft(safetyMarkdown, input, false, false)
          markdown = safetyMarkdown
        } catch {
          assertFinalizedEditorDraft(writerMarkdown, input, false, false)
          markdown = writerMarkdown
        }
      }
    }
    return {
      ...input.draft,
      markdown
    }
  }
}

export class ModelResearchEditor implements ResearchEditor {
  private readonly fallback: ResearchEditor

  constructor(
    private readonly options: {
      modelClient: ModelClient
      model: string
      timeoutMs?: number
      fallback?: ResearchEditor
    }
  ) {
    this.fallback = options.fallback ?? new PassThroughResearchEditor()
  }

  async editDraft(input: ResearchEditorInput): Promise<DraftReport> {
    if (input.budget.preset === 'quick' || !input.reportBlueprint || input.revision) {
      return this.fallback.editDraft(input)
    }
    try {
      return await this.editModelDraft(input)
    } catch {
      return this.fallback.editDraft(input)
    }
  }

  private async editModelDraft(input: ResearchEditorInput): Promise<DraftReport> {
    const model = input.execution?.model?.trim() || this.options.model
    const providerId = input.execution?.providerId?.trim()
    throwIfResearchAborted(input.execution?.signal)
    const controller = new AbortController()
    const unlinkAbort = linkResearchAbortSignal(input.execution?.signal, controller)
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, this.options.timeoutMs ?? RESEARCH_EDITOR_TIMEOUT_MS)
    )
    const prompt = buildResearchEditorPrompt(input)
    const turnId = `research_editor_${hashEditorInput(input)}`
    const maxTokens = 7_000
    const reservation = input.execution?.reserveModelCall(
      'editor',
      estimateResearchRequestTokens(`${MODEL_RESEARCH_EDITOR_SYSTEM_PROMPT}\n${prompt}`, maxTokens)
    )
    const observedUsage: ResearchModelUsageRecord['usage'][] = []
    let usageRecorded = false
    try {
      const request: ModelRequest = {
        threadId: 'research_report_editor',
        turnId,
        model,
        ...(providerId ? { providerId } : {}),
        systemPrompt: MODEL_RESEARCH_EDITOR_SYSTEM_PROMPT,
        prefix: [],
        history: [makeUserItem({
          id: `item_${turnId}_user`,
          threadId: 'research_report_editor',
          turnId,
          text: prompt
        })],
        tools: [],
        stream: false,
        maxTokens,
        temperature: 0.1,
        reasoningEffort: researchReasoningForStage(input.budget.reasoningEffort, 'writer'),
        abortSignal: controller.signal
      }
      const collected = await collectWriterText(
        this.options.modelClient.stream(request),
        controller.signal,
        (usage) => observedUsage.push(usage)
      )
      const normalizedMarkdown = normalizeDraftCitationPlaceholders(normalizeModelDraftSections(
        stripRuntimeGeneratedDraftSections(stripMarkdownFence(collected.text).trim()),
        input
      ), input)
      const proseSafeMarkdown = normalizeDanglingProseEndings(normalizedMarkdown)
      const technicalSafeMarkdown = sanitizeUnsupportedDraftTechnicalTerms(proseSafeMarkdown, input)
      const markdown = finalizeEditorMarkdown(dedupeRepeatedParagraphs(technicalSafeMarkdown), input)
      assertFinalizedEditorDraft(markdown, input, true, true)
      const usageRecords = collected.usage.slice(-1).map((usage) => ({
        stage: 'editor' as const,
        model,
        turnId,
        attempt: input.revision?.attempt,
        usage
      }))
      if (input.execution && reservation && usageRecords[0]) {
        await input.execution.recordModelUsage(usageRecords[0], reservation)
        usageRecorded = true
      }
      return {
        markdown,
        claimIds: extractUsedClaimIds(markdown, new Set(input.draft.claimIds)),
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
            stage: 'editor',
            model,
            turnId,
            attempt: input.revision?.attempt,
            usage: lastUsage
          }, reservation)
          usageRecorded = true
        }
        await input.execution.finishModelCall(reservation, { chargeEstimateOnMissing: !usageRecorded })
      }
    }
  }
}

function assertFinalizedEditorDraft(
  markdown: string,
  input: ResearchEditorInput,
  edited: boolean,
  enforceCompressionRatio: boolean
): void {
  assertEditorDidNotAddClaims(markdown, input)
  assertDraftFollowsBlueprint(markdown, input)
  if (enforceCompressionRatio) assertEditorPreservesArgumentDepth(markdown, input)
  assertUsableModelDraft(markdown, input, {
    compact: Boolean(input.revision),
    edited,
    enforceSectionDepth: edited || input.draft.sectioned !== true
  })
  assertSupportedDraftNumbers(markdown, input)
  assertSupportedDraftTechnicalTerms(markdown, input)
  assertSupportedDraftRecommendations(markdown, input)
  const writerClosingIssue = reportClosingDepthIssue(input.draft.markdown, input.budget.preset)
  const closingIssue = reportClosingDepthIssue(markdown, input.budget.preset)
  if (edited && !writerClosingIssue && closingIssue) throw new Error(closingIssue)
}

export function assertEditorPreservesArgumentDepth(markdown: string, input: ResearchEditorInput): void {
  const originalLength = visibleProseLength(input.draft.markdown)
  const editedLength = visibleProseLength(markdown)
  if (originalLength >= 1_200 && editedLength < originalLength * 0.72) {
    throw new Error(`editor compressed report from ${originalLength} to ${editedLength} prose characters`)
  }
  for (const section of input.reportBlueprint?.sections ?? []) {
    const originalSection = markdownSectionBody(input.draft.markdown, section.title)
    const editedSection = markdownSectionBody(markdown, section.title)
    const originalSectionLength = visibleProseLength(originalSection)
    const editedSectionLength = visibleProseLength(editedSection)
    if (originalSectionLength >= 240 && editedSectionLength < Math.max(180, originalSectionLength * 0.55)) {
      throw new Error(`editor over-compressed blueprint section ${section.title}`)
    }
  }
}

function markdownSectionBody(markdown: string, title: string): string {
  const lines = markdown.split('\n')
  const headingIndex = lines.findIndex((line) => line.trim() === `### ${title}`)
  if (headingIndex < 0) return ''
  const nextHeading = lines.slice(headingIndex + 1).findIndex((line) => /^#{2,3}\s+/u.test(line.trim()))
  const endIndex = nextHeading < 0 ? lines.length : headingIndex + 1 + nextHeading
  return lines.slice(headingIndex + 1, endIndex).join('\n')
}

function visibleProseLength(markdown: string): number {
  return markdown
    .replace(/\[claim:[^\]]+\]/gu, '')
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/[*_`>\s]/gu, '')
    .length
}

function sanitizeEditorMarkdown(markdown: string, input: ResearchEditorInput): string {
  if (input.budget.preset === 'quick' || input.brief.sourcePolicy.requireCitations === false) return markdown
  return sanitizeUncitedDraftSentences(markdown)
}

function finalizeEditorMarkdown(markdown: string, input: ResearchEditorInput): string {
  const repairedFragments = repairFragmentedSynthesisParagraphs(removeCollapsedReportEchoLines(markdown))
  const withoutRepeatedLead = stripFindingsPreambleBeforeMultipleSubsections(repairedFragments)
  const withoutExtractionNoise = sanitizeExtractionBoilerplateSentences(withoutRepeatedLead)
  const withoutFalseFallbackDisclosure = sanitizeFalseFallbackDisclosure(withoutExtractionNoise, input)
  const withConclusionCoverage = ensureConclusionClaimCitations(withoutFalseFallbackDisclosure, input)
  const editorialSafe = sanitizeEditorialDefects(withConclusionCoverage, input)
  const citationSafe = sanitizeEditorMarkdown(editorialSafe, input)
  const postCleanupConclusionSafe = ensureConclusionClaimCitations(citationSafe, input)
  const coverageSafe = ensureBlueprintSectionBoundaries(postCleanupConclusionSafe, input)
  return dedupeSummaryBullets(repairSectionLeadingConnectors(repairDanglingConclusionConnectors(
    normalizeDanglingProseEndings(ensureLimitationsContent(coverageSafe, input))
  )))
}

function finalizeEditorSafetyMarkdown(markdown: string, input: ResearchEditorInput): string {
  const repairedFragments = repairFragmentedSynthesisParagraphs(removeCollapsedReportEchoLines(markdown))
  const withoutExtractionNoise = sanitizeExtractionBoilerplateSentences(repairedFragments)
  const withoutFalseFallbackDisclosure = sanitizeFalseFallbackDisclosure(withoutExtractionNoise, input)
  const editorialSafe = sanitizeEditorialDefects(withoutFalseFallbackDisclosure, input)
  const coverageSafe = ensureBlueprintSectionBoundaries(editorialSafe, input)
  return dedupeSummaryBullets(repairSectionLeadingConnectors(repairDanglingConclusionConnectors(
    normalizeDanglingProseEndings(ensureLimitationsContent(coverageSafe, input))
  )))
}

export function repairSectionLeadingConnectors(markdown: string): string {
  let awaitingSectionProse = false
  return markdown.split('\n').map((line) => {
    if (/^###\s+/u.test(line.trim())) {
      awaitingSectionProse = true
      return line
    }
    if (!awaitingSectionProse || !line.trim()) return line
    if (/^#{1,6}\s+/u.test(line.trim())) {
      awaitingSectionProse = false
      return line
    }
    awaitingSectionProse = false
    return line.replace(/^(\s*)(?:而|但|但是|然而|不过)[，,]?\s*/u, '$1')
  }).join('\n')
}

export function sanitizeEditorialDefects(markdown: string, input: ResearchEditorInput): string {
  const seenClaims = new Set<string>()
  const deduped = markdown.split('\n').map((line) => splitCitationSentences(line)
    .filter((sentence) => {
      if (isDanglingCoordinatedSynthesis(sentence)) return false
      if (isUnsupportedCausalContrast(sentence, input)) return false
      const claimIds = [...sentence.matchAll(/\[claim:([^\]]+)\]/gu)]
        .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
        .filter(Boolean)
      const pretendsIndependent = /(?:另一来源|另一项证据|并非孤证|同样确认)/u.test(sentence)
      const onlySeenClaims = claimIds.length > 0 && claimIds.every((claimId) => seenClaims.has(claimId))
      for (const claimId of claimIds) seenClaims.add(claimId)
      return !(pretendsIndependent && onlySeenClaims)
    })
    .join('')
    .trim())
    .join('\n')
    .replace(/断层式优势/gu, '明显优势')
    .replace(/统治力无可撼动/gu, '统治力仍然较强')
    .replace(/短期内难以被撼动/gu, '短期内仍具有较强优势')
  const concessionSafe = deduped.split('\n').map((line) => splitCitationSentences(line)
    .map((sentence) => /虽然/u.test(sentence) && !/(?:但|仍|却|然而)/u.test(sentence)
      ? sentence.replace(/虽然/gu, '')
      : sentence)
    .join(''))
    .join('\n')
  return ensureBlueprintSectionBoundaries(concessionSafe, input)
}

export function repairFragmentedSynthesisParagraphs(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/u).map((block) => block.trim()).filter(Boolean)
  const repaired: string[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    let block = blocks[index] ?? ''
    if (!isIncompleteSynthesisLead(block)) {
      repaired.push(block)
      continue
    }
    while (index + 1 < blocks.length && !hasTerminalProsePunctuation(block)) {
      const continuation = blocks[index + 1] ?? ''
      if (/^#{1,6}\s+/u.test(continuation) || !/^(?:与|和|及|以及|之间|二者|两者)/u.test(continuation)) break
      block = `${block.trimEnd()}${continuation.trimStart()}`
      index += 1
    }
    if (isIncompleteSynthesisLead(block)) continue
    repaired.push(block.replace(/之间存在(?:显著|明显|较大|较强)?的?非对称关系/gu, '的变化幅度不同'))
  }
  return repaired.join('\n\n').trim()
}

export function finalizeResolvedReportProse(markdown: string): string {
  const repaired = repairFragmentedSynthesisParagraphs(markdown)
  return pruneUnusedCitationDefinitions(
    dedupeRepeatedListClauses(
      dedupeRepeatedSentencesBySection(sanitizeExtractionBoilerplateSentences(repaired))
    )
  )
}

export function dedupeRepeatedListClauses(markdown: string): string {
  return markdown.split('\n').map((line) => {
    if (/^\s*\[\d+\]:\s/u.test(line) || !/[；;]/u.test(line)) return line
    const seen = new Set<string>()
    return line.split(/([；;])/u).reduce<string[]>((parts, token, index, tokens) => {
      if (/^[；;]$/u.test(token)) {
        if (parts.length > 0 && index < tokens.length - 1) parts.push(token)
        return parts
      }
      const normalized = token
        .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
        .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
        .replace(/\[\d+\](?!:)/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, '')
        .toLowerCase()
      if (normalized.length >= 4 && seen.has(normalized)) {
        if (/^[；;]$/u.test(parts.at(-1) ?? '')) parts.pop()
        return parts
      }
      if (normalized.length >= 4) seen.add(normalized)
      parts.push(token)
      return parts
    }, []).join('').replace(/[；;]{2,}/gu, '；')
  }).join('\n')
}

function isIncompleteSynthesisLead(block: string): boolean {
  if (!/^(?:关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看))[，,]/u.test(block)) return false
  return !hasTerminalProsePunctuation(block)
}

function hasTerminalProsePunctuation(value: string): boolean {
  return /[。！？!?；;]$/u.test(visibleSynthesisProse(value))
}

function visibleSynthesisProse(value: string): string {
  return value
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .trim()
}

function isUnsupportedCausalContrast(sentence: string, input: ResearchEditorInput): boolean {
  if (!/(?:主要|完全)?(?:受益于|源于|归因于).{2,120}而非/u.test(sentence)) return false
  const claimIds = [...sentence.matchAll(/\[claim:([^\]]+)\]/gu)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter(Boolean)
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const supportText = input.claims
    .filter((claim) => claimIds.includes(claim.id))
    .flatMap((claim) => [claim.text, ...claim.supportSpanIds.map((spanId) => spanById.get(spanId)?.text ?? '')])
    .join('\n')
  return !/(?:受益于|源于|归因于)[\s\S]{0,160}(?:而非|不是|并非)/u.test(supportText)
}

export function isDanglingCoordinatedSynthesis(sentence: string): boolean {
  const prose = sentence
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .replace(/[。！？!?；;\s]+$/gu, '')
    .trim()
  return /^(?:关键在于|区别在于)[，,].{6,160}[，,](?:与|和|及).{4,80}$/u.test(prose)
}

function ensureBlueprintSectionBoundaries(markdown: string, input: ResearchEditorInput): string {
  let result = markdown
  for (const section of input.reportBlueprint?.sections ?? []) {
    const body = markdownSectionBody(result, section.title)
    if (!body) continue
    const limitations = [
      ...section.limitations,
      ...((input.sectionEvidenceMap ?? []).find((candidate) => candidate.sectionId === section.id)?.limitations ?? [])
    ].filter((value) => value && !isInternalResearchProcessLimitation(value))
    const explicitBoundary = limitations.find(hasExplicitEvidenceGapBoundary)
    const limitation = explicitBoundary ?? limitations[0]
    if (!limitation) continue
    if (body.includes(limitation)) continue
    if (!explicitBoundary && /(?:适用边界|边界条件|局限|现有证据不足|不能外推|无法判断)/u.test(body)) continue
    const heading = `### ${section.title}`
    const start = result.indexOf(heading)
    if (start < 0) continue
    const bodyStart = start + heading.length
    const nextHeadingOffset = result.slice(bodyStart).search(/\n#{2,3}\s+/u)
    const end = nextHeadingOffset < 0 ? result.length : bodyStart + nextHeadingOffset
    const boundary = `\n\n限制在于：${limitation.replace(/[。\s]+$/u, '')}。`
    result = `${result.slice(0, end).trimEnd()}${boundary}${result.slice(end)}`
  }
  return result
}

function sanitizeFalseFallbackDisclosure(markdown: string, input: ResearchEditorInput): string {
  if (input.budget.preset === 'quick') return markdown
  return markdown.split('\n').map((line) => splitCitationSentences(line)
    .filter((sentence) => !/(?:模型生成资料卡|模型资料卡).{0,40}(?:需要|需|应).{0,20}(?:外部来源|真实网页|联网).{0,12}(?:复核|核验|验证)/u.test(sentence))
    .join('')
    .trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function buildResearchEditorPrompt(input: ResearchEditorInput): string {
  return [
    '请编辑下面的报告原稿。',
    '',
    '硬性规则：',
    '- 先给直接答案，再展开依据；每个章节只承担蓝图规定的一个论证任务。',
    '- 删除重复结论、重复证据、模板话术和研究过程说明。',
    '- 不得增加原稿没有使用的 claim id；不得改写或删除 [claim:claim_id] 格式。',
    '- 每个 claim 必须在蓝图所属章节完成主要解释；只有列入该章节 contextClaimIds 的 claim 才能交叉引用。conditional_application 章节可先单独陈述机制前提，但场景结论必须是同时引用至少两条前提的条件判断。',
    '- 不得输出搜索词、任务目标、Gap、Research Notes 或后续搜索提示。',
    '- 保留“主要发现”“结论/结论与建议”“局限与不确定性”及蓝图三级标题；结论综合全文主论点和边界，不得逐章复述，最多保留两条最关键 claim 引用。',
    '',
    'ReportBlueprint：',
    JSON.stringify(input.reportBlueprint, null, 2),
    '',
    '原稿允许使用的 claim id：',
    JSON.stringify(input.draft.claimIds),
    '',
    '报告原稿：',
    input.draft.markdown
  ].join('\n')
}

export function assertDraftFollowsBlueprint(markdown: string, input: SynthesisWriterInput): void {
  const blueprint = input.reportBlueprint
  if (!blueprint || blueprint.sections.length === 0) return
  for (const phrase of EDITORIAL_SCAFFOLD_PHRASES) {
    if (markdown.includes(phrase)) throw new Error(`report contains editorial scaffold phrase: ${phrase}`)
  }
  const sectionByTitle = new Map(blueprint.sections.map((section) => [section.title, section]))
  const ownerByClaimId = new Map(blueprint.sections.flatMap((section) => section.claimIds.map((claimId) => [claimId, section] as const)))
  const contextBySectionId = new Map(blueprint.sections.map((section) => [section.id, new Set(section.contextClaimIds ?? [])]))
  const declaredContextClaimIds = new Set(blueprint.sections.flatMap((section) => section.contextClaimIds ?? []))
  const usedBySection = new Map<string, Set<string>>()
  let currentSectionId: string | undefined
  for (const line of markdown.split('\n')) {
    const heading = line.trim().match(/^(#{1,6})\s+(.+?)\s*$/u)
    if (heading) {
      const title = heading[2]?.replace(/[*`#]/g, '').trim() ?? ''
      const depth = heading[1]?.length ?? 0
      if (depth <= 3) currentSectionId = depth === 3 ? sectionByTitle.get(title)?.id : undefined
    }
    const lineClaimIds = [...line.matchAll(/\[claim:([^\]]+)\]/g)]
      .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
      .filter((claimId): claimId is string => Boolean(claimId))
    for (const claimId of lineClaimIds) {
      const allowedContextClaim = currentSectionId
        ? contextBySectionId.get(currentSectionId)?.has(claimId) === true
        : declaredContextClaimIds.has(claimId)
      if (!ownerByClaimId.has(claimId) && !allowedContextClaim) {
        throw new Error(`claim ${claimId} is not assigned by ReportBlueprint`)
      }
    }
    if (!currentSectionId) continue
    const section = blueprint.sections.find((candidate) => candidate.id === currentSectionId)
    if (!section) continue
    const lineUsesOwnerClaim = lineClaimIds.some((claimId) => ownerByClaimId.get(claimId)?.id === section.id)
    for (const claimId of lineClaimIds) {
      const owner = ownerByClaimId.get(claimId)
      if (owner && owner.id !== section.id) {
        const allowedAsContext = contextBySectionId.get(section.id)?.has(claimId) === true
        const conditionalApplication = section.evidenceMode === 'conditional_application'
        if (!allowedAsContext || (!lineUsesOwnerClaim && !conditionalApplication)) {
          throw new Error(`claim ${claimId} was moved out of blueprint section ${owner.title}`)
        }
      }
      const used = usedBySection.get(section.id) ?? new Set<string>()
      used.add(claimId)
      usedBySection.set(section.id, used)
    }
  }
  for (const section of blueprint.sections) {
    const usedClaimIds = usedBySection.get(section.id) ?? new Set<string>()
    if (section.claimIds.length > 0 && !section.claimIds.some((claimId) => usedClaimIds.has(claimId))) {
      throw new Error(`blueprint section ${section.title} does not use its assigned claims`)
    }
    const missingCoverageClaimIds = (section.coverageClaimIds ?? [])
      .filter((claimId) => !usedClaimIds.has(claimId))
    if (missingCoverageClaimIds.length > 0) {
      throw new Error(`blueprint section ${section.title} omitted required coverage claims ${missingCoverageClaimIds.join(', ')}`)
    }
    const body = markdownSectionBody(markdown, section.title)
    const missingCoverageBoundaries = section.limitations
      .filter(hasExplicitEvidenceGapBoundary)
      .filter((limitation) => !body.includes(limitation))
    if (missingCoverageBoundaries.length > 0) {
      throw new Error(`blueprint section ${section.title} omitted required coverage evidence-gap boundary`)
    }
    if (section.evidenceMode === 'conditional_application') {
      const usedContextCount = (section.contextClaimIds ?? []).filter((claimId) => usedClaimIds.has(claimId)).length
      if (usedContextCount < requiredConditionalContextClaimCount(section)) {
        throw new Error(`blueprint conditional application section ${section.title} does not use enough mechanism premises`)
      }
    }
  }
  for (const [claimId, owner] of ownerByClaimId) {
    const usedSectionIds = blueprint.sections
      .filter((section) => usedBySection.get(section.id)?.has(claimId))
      .map((section) => section.id)
    if (usedSectionIds.length > 0 && !usedSectionIds.includes(owner.id)) {
      const everyUsageIsAuthorizedContext = usedSectionIds.every((sectionId) =>
        contextBySectionId.get(sectionId)?.has(claimId) === true
      )
      if (!everyUsageIsAuthorizedContext) {
        throw new Error(`claim ${claimId} was moved out of blueprint section ${owner.title}`)
      }
    }
    const unauthorizedSectionIds = usedSectionIds.filter((sectionId) =>
      sectionId !== owner.id && contextBySectionId.get(sectionId)?.has(claimId) !== true
    )
    if (unauthorizedSectionIds.length > 0) {
      throw new Error(`claim ${claimId} is repeated outside its explicitly authorized context sections`)
    }
  }
}

export function repairDraftClaimPlacement(markdown: string, input: SynthesisWriterInput): string {
  const blueprint = input.reportBlueprint
  if (!blueprint) return markdown
  const sectionByTitle = new Map(blueprint.sections.map((section) => [section.title, section.id]))
  const ownerByClaimId = new Map(blueprint.sections.flatMap((section) => (
    section.claimIds.map((claimId) => [claimId, section.id] as const)
  )))
  const contextBySectionId = new Map(blueprint.sections.map((section) => [section.id, new Set(section.contextClaimIds ?? [])]))
  const conditionalApplicationSectionIds = new Set(blueprint.sections
    .filter((section) => section.evidenceMode === 'conditional_application')
    .map((section) => section.id))
  const lines = markdown.split('\n')
  const currentSectionByLine: Array<string | undefined> = []
  const usedSectionsByClaim = new Map<string, Set<string>>()
  let currentSectionId: string | undefined
  for (const line of lines) {
    const heading = line.trim().match(/^(#{1,6})\s+(.+?)\s*$/u)
    if (heading) {
      const title = heading[2]?.replace(/[*`#]/g, '').trim() ?? ''
      const depth = heading[1]?.length ?? 0
      if (depth <= 3) currentSectionId = depth === 3 ? sectionByTitle.get(title) : undefined
    }
    currentSectionByLine.push(currentSectionId)
    if (!currentSectionId) continue
    for (const claimId of claimIdsInLine(line)) {
      const used = usedSectionsByClaim.get(claimId) ?? new Set<string>()
      used.add(currentSectionId)
      usedSectionsByClaim.set(claimId, used)
    }
  }
  const misplaced = new Set([...ownerByClaimId].filter(([claimId, ownerId]) => {
    const used = usedSectionsByClaim.get(claimId)
    if (!used || used.size === 0 || used.has(ownerId)) return false
    return [...used].some((sectionId) => contextBySectionId.get(sectionId)?.has(claimId) !== true)
  }).map(([claimId]) => claimId))
  const movedBySection = new Map<string, string[]>()
  const kept = lines.map((line, index) => {
    const claimIds = claimIdsInLine(line)
    const misplacedIds = claimIds.filter((claimId) => misplaced.has(claimId))
    const currentSectionId = currentSectionByLine[index]
    const foreignIds = claimIds.filter((claimId) => {
      const ownerId = ownerByClaimId.get(claimId)
      return currentSectionId && ownerId && ownerId !== currentSectionId
    })
    const hasCurrentSectionClaim = claimIds.some((claimId) => ownerByClaimId.get(claimId) === currentSectionId)
    const hasDisallowedForeignClaim = foreignIds.some((claimId) => !contextBySectionId.get(currentSectionId ?? '')?.has(claimId))
    if (misplacedIds.length === 0) {
      if (foreignIds.length === 0 || (!hasDisallowedForeignClaim && (hasCurrentSectionClaim || conditionalApplicationSectionIds.has(currentSectionId ?? '')))) return line
      return foreignIds.reduce((result, claimId) => result.replaceAll(`[claim:${claimId}]`, ''), line)
    }
    const owners = [...new Set(misplacedIds.map((claimId) => ownerByClaimId.get(claimId)).filter(Boolean))] as string[]
    if (owners.length !== 1 || currentSectionId === owners[0]) return line
    const moved = movedBySection.get(owners[0]!) ?? []
    moved.push(line)
    movedBySection.set(owners[0]!, moved)
    return ''
  })
  const repaired: string[] = []
  for (const line of kept) {
    repaired.push(line)
    const heading = line.trim().match(/^###\s+(.+?)\s*$/u)
    const sectionId = heading ? sectionByTitle.get(heading[1]?.replace(/[*`#]/g, '').trim() ?? '') : undefined
    if (sectionId && movedBySection.has(sectionId)) repaired.push('', ...movedBySection.get(sectionId)!)
  }
  return repaired.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function claimIdsInLine(line: string): string[] {
  return [...line.matchAll(/\[claim:([^\]]+)\]/g)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter((claimId): claimId is string => Boolean(claimId))
}

export function ensureConclusionClaimCitations(markdown: string, input: ResearchEditorInput): string {
  const blueprint = input.reportBlueprint
  if (!blueprint) return markdown
  const lines = markdown.split('\n')
  const headingIndex = lines.findIndex((line) => /^(?:##)\s+(?:结论|结论与建议)\s*$/u.test(line.trim()))
  if (headingIndex < 0) return markdown
  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex((line) => /^##\s+/u.test(line.trim()))
  const endIndex = nextHeadingOffset < 0 ? lines.length : headingIndex + 1 + nextHeadingOffset
  const originalClaimIds = new Set(input.draft.claimIds)
  const conclusionClaimIds = new Set(lines.slice(headingIndex + 1, endIndex).flatMap(claimIdsInLine))
  if (conclusionClaimIds.size > 0) return markdown
  const leadClaims = blueprint.sections.flatMap((section) => {
    const claim = input.claims
      .filter((candidate) => section.claimIds.includes(candidate.id) && originalClaimIds.has(candidate.id))
      .sort((left, right) => reportClaimQualityScore(right.text, right.claimType) - reportClaimQualityScore(left.text, left.claimType))[0]
    return claim ? [{ claim, prose: reportSentenceForClaim(markdown, claim.id) }] : []
  }).sort((left, right) => reportClaimQualityScore(right.claim.text, right.claim.claimType) - reportClaimQualityScore(left.claim.text, left.claim.claimType))
    .slice(0, 1)
  if (leadClaims.length === 0) return markdown
  const synthesis = leadClaims
    .map(({ claim, prose }) => prose
      ? prose.replace(/[。！？.!?；;]+$/u, '').trim()
      : `${claim.text.replace(/[。！？.!?]+$/u, '').trim()} [claim:${claim.id}]`)
    .join('；')
  return appendEditorConclusionSentences(markdown, [`综合来看，${synthesis}。`])
}

function appendEditorConclusionSentences(markdown: string, sentences: string[]): string {
  if (sentences.length === 0) return markdown
  const lines = markdown.split('\n')
  const headingIndex = lines.findIndex((line) => /^(?:##)\s+(?:结论|结论与建议)\s*$/u.test(line.trim()))
  if (headingIndex < 0) return markdown
  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex((line) => /^##\s+/u.test(line.trim()))
  const endIndex = nextHeadingOffset < 0 ? lines.length : headingIndex + 1 + nextHeadingOffset
  lines.splice(endIndex, 0, '', ...sentences)
  return lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function reportSentenceForClaim(markdown: string, claimId: string): string | undefined {
  const placeholder = `[claim:${claimId}]`
  for (const line of markdown.split('\n')) {
    for (const sentence of splitCitationSentences(line)) {
      const trimmed = sentence.trim()
      if (!trimmed.includes(placeholder) || /^#{1,6}\s/u.test(trimmed)) continue
      if (containsExtractionBoilerplate(trimmed)) continue
      if (trimmed.replace(/\[claim:[^\]]+\]/gu, '').trim().length < 6) continue
      return trimmed
    }
  }
  return undefined
}

function reportClaimQualityScore(text: string, claimType: string): number {
  let score = claimType === 'fact' ? 4 : 0
  if (text.length >= 24 && text.length <= 220) score += 3
  if (containsExtractionBoilerplate(text)) score -= 20
  if (/^(?:This means|这意味着|因此)/iu.test(text)) score += 1
  return score
}

export function ensureLimitationsContent(markdown: string, input: ResearchEditorInput): string {
  const lines = markdown.split('\n')
  const headingIndex = lines.findIndex((line) => /^##\s+局限与不确定性\s*$/u.test(line.trim()))
  if (headingIndex < 0) return markdown
  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex((line) => /^##\s+/u.test(line.trim()))
  const endIndex = nextHeadingOffset < 0 ? lines.length : headingIndex + 1 + nextHeadingOffset
  const body = lines.slice(headingIndex + 1, endIndex).join(' ').replace(/\s+/gu, ' ').trim()
  const existing = splitCitationSentences(body)
    .map((sentence) => sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim())
    .filter((sentence) => !/(?:^|\s)#{1,6}\s+\S/u.test(sentence))
    .filter((sentence) => sentence.replace(/[。！？.!?；;\s]/gu, '').length >= 12)
  if (!reportLimitationsDepthIssue(markdown, input.budget.preset)) return markdown
  const domains = [...new Set(input.brief.sourcePolicy.allowedDomains ?? [])]
  const defaultLimitation = domains.length > 0
    ? `本报告按用户要求仅使用 ${domains.join('、')}，没有用其他来源交叉验证，结论范围以该来源明确覆盖的内容为限。`
    : '本报告仅使用本次已收集并通过引用校验的来源；未被这些来源明确覆盖的对象、时间范围和实现差异不纳入结论。'
  const candidates = [
    ...(input.sectionEvidenceMap ?? []).flatMap((section) => section.limitations),
    ...input.notes.flatMap((note) => note.limitations),
    ...splitCitationSentences(lines.slice(0, headingIndex).join(' ').replace(/\s+/gu, ' ')),
    ...evidenceTopologyLimitations(input),
    defaultLimitation
  ]
    .map((sentence) => sentence.replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '').trim())
    .filter((sentence) => !isInternalResearchProcessLimitation(sentence))
    .filter((sentence) => /(?:现有|当前|本次|所用|本报告).{0,24}(?:证据|材料|来源|资料)|未(?:覆盖|提供|说明|验证|讨论)|不足以|无法|不能(?:据此)?外推|仅(?:覆盖|限于|支持)/u.test(sentence))
    .filter((sentence) => sentence.replace(/[。！？.!?；;\s]/gu, '').length >= 12)
  const normalizedExisting = new Set(existing.map(normalizeLimitationForEditor))
  const additions: string[] = []
  for (const candidate of candidates) {
    const normalized = normalizeLimitationForEditor(candidate)
    if (!normalized || normalizedExisting.has(normalized) || additions.some((value) => normalizeLimitationForEditor(value) === normalized)) continue
    additions.push(/[。！？.!?]$/u.test(candidate) ? candidate : `${candidate}。`)
    if (existing.length + additions.length >= (input.budget.preset === 'quick' ? 1 : 5)) break
  }
  if (additions.length > 0) lines.splice(endIndex, 0, '', ...additions)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function normalizeLimitationForEditor(value: string): string {
  return normalizeResearchChineseScript(value)
    .replace(/[，。；：、,.!！?？`*_#>\s]/gu, '')
    .trim()
}

export function dedupeRepeatedParagraphs(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/u)
  const seen = new Set<string>()
  const kept: string[] = []
  for (const block of blocks) {
    const normalized = block
      .replace(/\[claim:[^\]]+\]/g, '')
      .replace(/\s+/g, '')
      .replace(/[，。；：、,.!！?？]/g, '')
      .trim()
    if (!block.trim().startsWith('#') && normalized.length >= 30 && seen.has(normalized)) continue
    if (normalized.length >= 30) seen.add(normalized)
    kept.push(block.trim())
  }
  return dedupeRepeatedSentencesBySection(kept.filter(Boolean).join('\n\n').trim())
}

export function dedupeSummaryBullets(markdown: string): string {
  const lines = markdown.split('\n')
  const headingIndex = lines.findIndex((line) => /^##\s+摘要\s*$/u.test(line.trim()))
  if (headingIndex < 0) return markdown
  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex((line) => /^##\s+/u.test(line.trim()))
  const endIndex = nextHeadingOffset < 0 ? lines.length : headingIndex + 1 + nextHeadingOffset
  const seen: string[] = []
  const removed = new Set<number>()
  for (let index = headingIndex + 1; index < endIndex; index += 1) {
    if (!/^\s*[-*+]\s+/u.test(lines[index] ?? '')) continue
    const normalized = normalizeSummaryBullet(lines[index] ?? '')
    if (normalized.length < 28) continue
    if (seen.some((previous) => characterBigramContainment(previous, normalized) >= 0.78)) {
      removed.add(index)
      continue
    }
    seen.push(normalized)
  }
  if (removed.size === 0) return markdown
  return lines.filter((_line, index) => !removed.has(index)).join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function normalizeSummaryBullet(value: string): string {
  return normalizeResearchChineseScript(value)
    .toLowerCase()
    .replace(/^\s*[-*+]\s+/u, '')
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .replace(/[^\p{L}\p{N}%]+/gu, '')
    .trim()
}

function dedupeRepeatedSentencesBySection(markdown: string): string {
  let seen: Array<{ normalized: string; claimIds: Set<string>; synthesis: boolean }> = []
  const findingsSentences: Array<{ section: string; sentence: string }> = []
  let inFindings = false
  let currentFindingSection = ''
  return markdown.split('\n').map((line) => {
    const secondLevelTitle = line.trim().match(/^##\s+(.+?)\s*$/u)?.[1]?.replace(/[*`#]/gu, '').trim()
    const thirdLevelTitle = line.trim().match(/^###\s+(.+?)\s*$/u)?.[1]?.replace(/[*`#]/gu, '').trim()
    if (secondLevelTitle) {
      inFindings = /^(?:主要发现|Findings)$/iu.test(secondLevelTitle)
      currentFindingSection = ''
      seen = []
      return line
    }
    if (thirdLevelTitle) {
      currentFindingSection = inFindings ? thirdLevelTitle : ''
      seen = []
      return line
    }
    if (/^#{1,6}\s+/u.test(line.trim())) {
      seen = []
      return line
    }
    if (!line.trim() || /^```/u.test(line.trim()) || line.includes('|')) return line
    return splitCitationSentences(line).filter((sentence) => {
      const claimIds = new Set([...sentence.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/gu)]
        .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u))
        .map((claimId) => claimId.trim())
        .filter(Boolean))
      const normalized = sentence
        .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
        .replace(/[，。；：、,.!！?？`*_\s]/gu, '')
        .trim()
      if (normalized.length < 8) return true
      if (seen.some((previous) => previous.normalized === normalized)) return false
      if (inFindings && currentFindingSection && findingsSentences.some((previous) => (
        previous.section !== currentFindingSection && reportSentencesAreNearDuplicates(previous.sentence, sentence)
      ))) return false
      const synthesis = /^(?:因此|因而|所以|从而|关键在于|区别在于|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看))/u.test(normalized)
      if (seen.some((previous) => (
        synthesis && previous.synthesis && claimSetOverlap(previous.claimIds, claimIds) >= 0.5
          && characterBigramContainment(previous.normalized, normalized) >= 0.45
      ))) return false
      seen.push({ normalized, claimIds, synthesis })
      if (inFindings && currentFindingSection && normalized.length >= 24) {
        findingsSentences.push({ section: currentFindingSection, sentence })
      }
      return true
    }).join('').trim()
  }).join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function claimSetOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  const intersection = [...left].filter((claimId) => right.has(claimId)).length
  return intersection / Math.min(left.size, right.size)
}

function characterBigramContainment(left: string, right: string): number {
  const bigrams = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)))
  const leftBigrams = bigrams(left)
  const rightBigrams = bigrams(right)
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0
  const intersection = [...leftBigrams].filter((bigram) => rightBigrams.has(bigram)).length
  return intersection / Math.min(leftBigrams.size, rightBigrams.size)
}

function assertEditorDidNotAddClaims(markdown: string, input: ResearchEditorInput): void {
  const originalClaimIds = new Set(input.draft.claimIds)
  const usedClaimIds = [...markdown.matchAll(/\[claim:([^\]]+)\]/g)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter((claimId): claimId is string => Boolean(claimId))
  const added = [...new Set(usedClaimIds.filter((claimId) => !originalClaimIds.has(claimId)))]
  if (added.length > 0) throw new Error(`editor added claims not present in writer draft: ${added.join(', ')}`)
}

function hashEditorInput(input: ResearchEditorInput): string {
  const text = `${input.runId}\n${input.draft.markdown}\n${input.revision?.attempt ?? 1}`
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
  return Math.abs(hash).toString(36)
}
