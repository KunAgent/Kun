/**
 * [INPUT]: 依赖 research/core/types 的 ResearchRun 和句子级引用切分，接收 SynthesisWriter 生成的 Markdown 草稿
 * [OUTPUT]: 对外提供 renderFinalReportMarkdown、sanitizeFinalReportMarkdown 与压缩整稿回声清理，生成以可引用、近义去重且跨章节全局按综合质量排序的核心判断直接开篇、排除 evidence-gap/稀疏章节通用边界模板、用清理了输出指令与尾部残留标点的用户原题作为单一“研究问题”方法句，并归一行内中文抽取空格后保留正文事实
 * [POS]: research/markdown 的最终报告渲染器，优先从作者的全部主要发现中选择质量最高的带引用综合判断生成最多三条短摘要，只有没有综合句时才回退到事实；不按章节顺序让前几章事实挤掉后续综合，不插入过程话术、内部 Frame 问句或重复导语，并在最终包装前删除同一行内包含多级 Markdown 标题的整稿回声，但不删除合法独立标题或章节唯一事实句
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchRun } from '../core/types.js'
import { resolveResearchReportTitle } from '../core/report-title.js'
import { splitCitationSentences } from '../evidence/CitationProximity.js'

const RESOLVED_CITATION_RE = /<sup\b[^>]*data-citation-id=["'][^"']+["'][^>]*>[\s\S]*?<\/sup>|\[\d+\](?!:)/iu
const RESOLVED_CITATION_GLOBAL_RE = /<sup\b[^>]*data-citation-id=["'][^"']+["'][^>]*>[\s\S]*?<\/sup>|\[\d+\](?!:)/giu

export type RenderFinalReportOptions = {
  generatedAt: string
  sourceCount: number
  claimCount: number
}

export function renderFinalReportMarkdown(
  run: ResearchRun,
  resolvedMarkdown: string,
  options: RenderFinalReportOptions
): string {
  void options
  const sanitized = sanitizeFinalReportMarkdown(resolvedMarkdown.trim())
  const withoutGeneratedSections = stripGeneratedReportSections(sanitized).trim()
  const { title, body: rawBody } = splitReportTitle(withoutGeneratedSections, run.brief.topic)
  const body = stripFindingsPreambleBeforeMultipleSubsections(stripBodyPreambleBeforeFindings(rawBody))
  const summaryLeads = citedSummaryLeads(rawBody)
  const summary = renderFinalSummary(run, summaryLeads.map((lead) => lead.rendered))
  const finalSections = [
    title,
    summary,
    renderScopeMethodNote(run),
    body.trim()
  ].filter(Boolean)

  return `${finalSections.join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`
}

function stripBodyPreambleBeforeFindings(markdown: string): string {
  const findingsIndex = markdown.search(/^##\s+(?:主要发现|Findings)\s*$/mu)
  if (findingsIndex <= 0) return markdown
  const preamble = markdown.slice(0, findingsIndex).trim()
  if (!preamble || /^##\s+/mu.test(preamble)) return markdown
  return markdown.slice(findingsIndex).trim()
}

export function stripFindingsPreambleBeforeMultipleSubsections(markdown: string): string {
  const lines = markdown.split('\n')
  const findingsIndex = lines.findIndex((line) => isSectionHeading(line, ['主要发现', 'Findings']))
  if (findingsIndex < 0) return markdown
  const nextSectionOffset = lines.slice(findingsIndex + 1).findIndex((line) => isSecondLevelHeading(line))
  const sectionEnd = nextSectionOffset < 0 ? lines.length : findingsIndex + 1 + nextSectionOffset
  const subsectionIndexes = lines
    .slice(findingsIndex + 1, sectionEnd)
    .map((line, offset) => /^###\s+/u.test(line.trim()) ? findingsIndex + 1 + offset : -1)
    .filter((index) => index >= 0)
  if (subsectionIndexes.length < 1) return markdown
  const firstSubsectionIndex = subsectionIndexes[0]!
  const preamble = lines.slice(findingsIndex + 1, firstSubsectionIndex).join(' ').trim()
  if (!preamble) return markdown
  if (subsectionIndexes.length === 1) {
    const subsectionBody = lines.slice(firstSubsectionIndex + 1, sectionEnd).join(' ').replace(/\s+/gu, ' ').trim()
    const subsectionSentences = splitCitationSentences(subsectionBody).map(normalizeRepeatedFindingSentence).filter(Boolean)
    const preambleSentences = splitCitationSentences(preamble).map(normalizeRepeatedFindingSentence).filter(Boolean)
    if (preambleSentences.length === 0 || !preambleSentences.every((sentence) =>
      subsectionSentences.some((candidate) => repeatedFindingSentenceMatches(sentence, candidate))
    )) return markdown
  }
  return [
    ...lines.slice(0, findingsIndex + 1),
    '',
    ...lines.slice(firstSubsectionIndex)
  ].join('\n').replace(/\n{3,}/g, '\n\n')
}

function normalizeRepeatedFindingSentence(value: string): string {
  return value
    .replace(RESOLVED_CITATION_GLOBAL_RE, '')
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .replace(/[，。；：、,.!！?？`*_#>\s]/gu, '')
    .trim()
}

function repeatedFindingSentenceMatches(left: string, right: string): boolean {
  if (left === right) return true
  if (Math.min(left.length, right.length) >= 16 && (left.includes(right) || right.includes(left))) return true
  const leftPairs = characterPairs(left)
  const rightPairs = characterPairs(right)
  if (leftPairs.size === 0 || rightPairs.size === 0) return false
  const overlap = [...leftPairs].filter((pair) => rightPairs.has(pair)).length
  return (2 * overlap) / (leftPairs.size + rightPairs.size) >= 0.62
}

function characterPairs(value: string): Set<string> {
  const pairs = new Set<string>()
  for (let index = 0; index < value.length - 1; index += 1) pairs.add(value.slice(index, index + 2))
  return pairs
}

const USER_HIDDEN_SECTION_TITLES = ['核心问题与回答', '证据链']
const RUNTIME_GENERATED_SECTION_TITLES = ['摘要', 'Executive Summary', '调研范围与方法', 'Scope and Method']

const INTERNAL_META_LABELS = [
  '运行 ID',
  '生成时间',
  '来源数量',
  '论断数量',
  '校验状态',
  '需求匹配评分',
  '模型评审',
  '报告完整度'
]

export function sanitizeFinalReportMarkdown(markdown: string): string {
  return convertLegacyHtmlCitations(
    normalizeVisibleReportText(removeCollapsedReportEchoLines(stripHiddenReportSections(stripInternalReportMeta(markdown))))
  ).trim()
}

export function removeCollapsedReportEchoLines(markdown: string): string {
  return markdown.split('\n')
    .filter((line) => [...line.matchAll(/(?:^|\s)#{1,6}\s+\S/gu)].length < 2)
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function convertLegacyHtmlCitations(markdown: string): string {
  const definitions = new Map<string, string>()
  const converted = markdown.replace(
    /<sup\b[^>]*data-citation-id=["']cit_(\d+)["'][^>]*>([\s\S]*?)<\/sup>/giu,
    (_match, label: string, body: string) => {
      const href = decodeHtmlAttribute(body.match(/<a\b[^>]*href=["']([^"']+)["']/iu)?.[1] ?? '')
      const title = decodeHtmlAttribute(body.match(/<a\b[^>]*title=["']([^"']+)["']/iu)?.[1] ?? `引用 ${label}`)
      const destination = href ? `<${href.replace(/>/g, '%3E')}>` : `#citation-${label}`
      definitions.set(label, `[${label}]: ${destination} "${escapeReferenceTitle(title)}"`)
      return `[${label}]`
    }
  )
  if (definitions.size === 0) return converted
  const existingLabels = new Set([...converted.matchAll(/^\[(\d+)\]:\s/gmu)].map((match) => match[1] ?? ''))
  const missingDefinitions = [...definitions]
    .filter(([label]) => !existingLabels.has(label))
    .map(([, definition]) => definition)
  return missingDefinitions.length > 0
    ? `${converted.trim()}\n\n${missingDefinitions.join('\n')}\n`
    : converted
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function escapeReferenceTitle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\s+/g, ' ').trim()
}

function normalizeVisibleReportText(markdown: string): string {
  let normalized = markdown
    .replace(/\b(?:Curosr|Curor)\b/g, 'Cursor')
    .replace(/。{2,}/g, '。')
    .replace(/([。！？!?])\s*([。！？!?])+/g, '$1')
    .replace(/，([。！？!?])/g, '$1')
  for (let pass = 0; pass < 2; pass += 1) {
    normalized = normalized.replace(/([\p{Script=Han}])[ \t]+(?=[\p{Script=Han}])/gu, '$1')
  }
  return normalized
    .replace(/\s+([，。；：、！？％%,.!?:;)）])/gu, '$1')
    .replace(/([（(])\s+/gu, '$1')
}

function renderFinalSummary(run: ResearchRun, leads: string[]): string {
  const subject = conciseSummarySubject(run)
  const coreJudgement = leads.length > 0 ? leads.slice(0, 3).map((lead) => `- ${lead}`).join('\n') : undefined
  return [
    '## 摘要',
    '',
    coreJudgement ?? subject
  ].filter((value): value is string => value !== undefined).join('\n')
}

function renderScopeMethodNote(run: ResearchRun): string {
  const domains = run.brief.sourcePolicy?.allowedDomains ?? []
  const sourceBoundary = domains.length > 0
    ? `来源仅限 ${domains.join('、')}`
    : '来源限于本次简报允许的可核验资料'
  return [
    '## 调研范围与方法',
    '',
    `${sourceBoundary}；研究问题：${conciseSummarySubject(run)}。正文逐条绑定依据。`
  ].join('\n')
}

function stripInternalReportMeta(markdown: string): string {
  const lines = markdown.split('\n')
  return lines
    .filter((line) => !isInternalMetaLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function stripHiddenReportSections(markdown: string): string {
  return stripSectionsByTitle(markdown, USER_HIDDEN_SECTION_TITLES)
}

function stripGeneratedReportSections(markdown: string): string {
  return stripSectionsByTitle(markdown, RUNTIME_GENERATED_SECTION_TITLES)
}

function stripSectionsByTitle(markdown: string, titles: string[]): string {
  const lines = markdown.split('\n')
  const kept: string[] = []
  let skipping = false

  for (const line of lines) {
    if (isSectionHeading(line, titles)) {
      skipping = true
      continue
    }
    if (skipping && isSecondLevelHeading(line)) {
      skipping = false
    }
    if (!skipping) kept.push(line)
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n')
}

function isInternalMetaLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('>')) return false
  const text = trimmed.replace(/^>\s*/, '')
  return INTERNAL_META_LABELS.some((label) => text.startsWith(`${label}：`) || text.startsWith(`${label}:`))
}

function isSectionHeading(line: string, titles: string[]): boolean {
  const title = secondLevelHeadingTitle(line)
  if (!title) return false
  return titles.some((hidden) => title === hidden || title.startsWith(`${hidden}：`) || title.startsWith(`${hidden}:`))
}

function isSecondLevelHeading(line: string): boolean {
  return secondLevelHeadingTitle(line) !== undefined
}

function secondLevelHeadingTitle(line: string): string | undefined {
  const match = line.trim().match(/^##\s+(.+?)\s*$/)
  return match?.[1]?.replace(/[*`#]/g, '').trim()
}

function splitReportTitle(markdown: string, fallbackTopic: string): { title: string; body: string } {
  const lines = markdown.split('\n')
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstNonEmptyIndex >= 0) {
    const first = lines[firstNonEmptyIndex]?.trim() ?? ''
    if (/^#\s+/.test(first) && !/^##\s+/.test(first)) {
      return {
        title: `# ${resolveResearchReportTitle(fallbackTopic, first)}`,
        body: [...lines.slice(0, firstNonEmptyIndex), ...lines.slice(firstNonEmptyIndex + 1)].join('\n').trim()
      }
    }
  }
  return {
    title: `# ${resolveResearchReportTitle(fallbackTopic)}`,
    body: markdown.trim()
  }
}

function sectionBody(markdown: string, titles: string[]): string {
  const lines = markdown.split('\n')
  const collected: string[] = []
  let collecting = false

  for (const line of lines) {
    const title = secondLevelHeadingTitle(line)
    if (title && titles.some((candidate) => title === candidate || title.startsWith(`${candidate}：`) || title.startsWith(`${candidate}:`))) {
      collecting = true
      continue
    }
    if (collecting && isSecondLevelHeading(line)) break
    if (collecting && /^\s*\[\d+\]:\s/u.test(line)) break
    if (collecting) collected.push(line)
  }

  return collected.join('\n').trim()
}

type SummaryLead = { rendered: string; source: string; score: number }

function citedSummaryLeads(body: string): SummaryLead[] {
  const findings = sectionBody(body, ['主要发现', 'Findings'])
  const subsectionBodies = findings.split(/^###\s+.+$/gmu).map((value) => value.trim()).filter(Boolean)
  const leads = subsectionBodies
    .map((subsection) => bestCitedMeaningfulSentence(subsection))
    .filter((lead): lead is SummaryLead => Boolean(lead))
  if (leads.length > 0) {
    return uniqueSummaryLeads(leads)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
  }
  const fallback = bestCitedMeaningfulSentence(findings)
    ?? bestCitedMeaningfulSentence(sectionBody(body, ['结论与建议', '结论', 'Conclusion']))
  return fallback ? [fallback] : []
}

function uniqueSummaryLeads(leads: SummaryLead[]): SummaryLead[] {
  const seen: string[] = []
  return leads.filter((lead) => {
    const key = normalizeRepeatedFindingSentence(lead.rendered)
    if (!key || seen.some((candidate) => repeatedFindingSentenceMatches(key, candidate))) return false
    seen.push(key)
    return true
  })
}

function bestCitedMeaningfulSentence(text: string): SummaryLead | undefined {
  let best: SummaryLead | undefined
  for (const line of text.split('\n')) {
    if (!line.trim() || /^#{1,6}\s+/u.test(line.trim())) continue
    for (const source of splitCitationSentences(line)) {
      if (!RESOLVED_CITATION_RE.test(source)) continue
      const normalized = source
        .replace(/\[[^\]]+\]\([^)]+\)/g, '')
        .replace(/\[claim:[^\]]+\]/g, '')
        .replace(/^\s*[-*]\s+/u, '')
        .replace(/\s+/g, ' ')
        .trim()
      const plainText = normalized.replace(RESOLVED_CITATION_GLOBAL_RE, '').trim()
      if (plainText.length < 12 || isReportScaffoldingSentence(plainText)) continue
      const candidate = {
        rendered: compactSummarySentence(normalized),
        source,
        score: summaryJudgementScore(plainText)
      }
      if (!best || candidate.score > best.score) best = candidate
    }
  }
  return best
}

function summaryJudgementScore(sentence: string): number {
  let score = 0
  if (/^(?:因此|因而|所以|从而|由此(?:判断|可见)|综合(?:来看|判断)|总体(?:而言|来看)|关键在于|区别在于)/u.test(sentence)) score += 20
  if (/(?:意味着|反映|表明|说明|判断|同时|但|而|不能|缺乏|边界)/u.test(sentence)) score += 4
  if (/^(?:现有证据|当前证据|现有材料)/u.test(sentence)) score -= 8
  if (/^(?:截至\s*)?\d{4}年/u.test(sentence)) score -= 4
  return score
}

function compactSummarySentence(sentence: string): string {
  const citations = sentence.match(RESOLVED_CITATION_GLOBAL_RE) ?? []
  const cleaned = sentence
    .replace(RESOLVED_CITATION_GLOBAL_RE, '')
    .replace(/^综合判断\s*/, '')
    .replace(/^(?:而|但|但是|然而|具体而言|与此同时|进一步地)[，,\s]*/u, '')
    .replace(/[，,、：:；;。.!！？?]+\s*$/u, '')
    .trim()
  const compacted = compactPlainSummarySentence(cleaned)
  return citations.length > 0 ? `${compacted}。 ${citations.join('')}` : `${compacted}。`
}

function compactPlainSummarySentence(cleaned: string): string {
  if (cleaned.length <= 220) return cleaned
  const window = cleaned.slice(120, 220)
  const punctuationOffset = Math.max(
    window.lastIndexOf('。'),
    window.lastIndexOf('；'),
    window.lastIndexOf(';')
  )
  if (punctuationOffset >= 0) return cleaned.slice(0, 120 + punctuationOffset + 1).trim()
  const commaOffset = Math.max(window.lastIndexOf('，'), window.lastIndexOf(','))
  if (commaOffset >= 0) return `${cleaned.slice(0, 120 + commaOffset).trim()}。`
  return `${cleaned.slice(0, 220).replace(/[，,、：:；;]\s*$/, '').trim()}。`
}

function conciseSummarySubject(run: ResearchRun): string {
  const candidate = run.brief.topic || run.frame.centralQuestion || run.frame.coreResearchThread || run.brief.userIntent
  const cleaned = candidate
    .replace(/^核心问题[:：]\s*/, '')
    .replace(/^仅基于\s*[^，,]{1,80}(?:官方)?(?:文档|资料)[，,]\s*/u, '')
    .replace(/[。.]?\s*输出(?:中文)?(?:完整)?报告[。.]?\s*$/u, '')
    .replace(/[，,；;：:。！？!?]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned
}

function isReportScaffoldingSentence(sentence: string): boolean {
  return /^这里先重复所有章节的结论/.test(sentence)
    || /^本报告围绕这条判断线索展开/.test(sentence)
    || /^正文优先呈现/.test(sentence)
    || /^阅读本节时/.test(sentence)
    || /^这部分材料的价值不在于/.test(sentence)
    || /^由此判断，[“"]?[^”"]{2,80}[”"]?当前能够确认的是上述事实及其明确限定的对象、时间与条件/.test(sentence)
}
