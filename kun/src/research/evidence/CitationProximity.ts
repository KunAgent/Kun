/**
 * [INPUT]: 依赖 Markdown 章节、表格结构、claim/evidence 占位符、最终 Markdown/旧 HTML 引用标记和 EvidenceEligibility 的通用抽取损坏判断
 * [OUTPUT]: 对外提供严格句子/表格行级引用覆盖检查、占位符与数字引用两阶段无引用事实清理、删除清理后只剩标点和引用的空句、保留仍被正文使用的程序生成 Markdown 来源定义并清除正文裸 URL/模型链接、双语页眉/多级导航/残缺混合语言及只指向页码或章节的抽取噪声清理、跨核心章节近义句检测、无论句首措辞如何都统一识别并保留诚实 evidence-gap 边界、自然关系综合识别，以及对无引用机制、定性评价、伪综合、效果、适用性和建议的领域无关拦截
 * [POS]: research/evidence 的引用邻接纯函数层，被 Writer、CitationResolver、数字安全层和 QualityVerifier 复用；同行后置引用不能替前置事实背书
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { isExtractionCorruptionText } from './EvidenceEligibility.js'

const TARGET_SECTION_TITLES = new Set([
  '主要发现',
  'Findings',
  '结论',
  '结论与建议',
  'Conclusion',
  'Recommendations',
  '局限与不确定性',
  'Caveats',
  'Limitations'
])
const DRAFT_CITATION_RE = /\[(?:structured-claim|claim|evidence):[^\]]+\]/u
const RESOLVED_CITATION_RE = /<sup\b[^>]*data-citation-id=["'][^"']+["'][^>]*>[\s\S]*?<\/sup>|\[\d+\](?!:)/iu
const SENTENCE_BOUNDARY_RE = /[。！？!?；;]/u
const INDEPENDENT_CLAUSE_PREFIX_RE = /^\s*(?:但|但是|而(?!是|不)|因此|所以|这意味着|这一|这也|同时|另一方面|从(?:性能|安全|成本|实践|实现)角度)/u
const ANY_CITATION_RE = /\[(?:structured-claim|claim|evidence):[^\]]+\]|<sup\b[^>]*data-citation-id=|\[\d+\](?!:)/iu
const EXTRACTION_BOILERPLATE_RE = /(?:Header\s+type\s+(?:Response|Request|Representation)\s+header|Forbidden\s+request\s+header|Syntax\s+https?\b|Directives\s+W\/\s+Optional|[A-Z][A-Z\s&.'()-]{12,}.{0,120}(?:ANNUAL|INTERIM|ENVIRONMENTAL,\s*SOCIAL\s+AND\s+GOVERNANCE)\s+REPORT\b.{0,180}(?:年報|年报|報告|报告|\bManagement\b|\bIn compliance\b)|(?:描述|详情|詳情|信息|说明|說明).{0,20}(?:载于|載於|参见|參見|请见|請見|位于|位於).{0,32}(?:第\s*\d+\s*(?:页|頁|章|节|節)|[「“"][^」”"]{2,40}[」”"]))/u
const REPORT_URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'“”‘’，。；：！？、（）()\[\]{}]+/iu
const REPORT_MARKDOWN_LINK_RE = /\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)/giu

export function uncitedReportSentences(markdown: string): string[] {
  return targetSectionSentenceRecords(markdown)
    .filter(({ sentence, sectionTitle }) => (
      isMeaningfulFactualSentence(sentence) &&
      !RESOLVED_CITATION_RE.test(sentence) &&
      !isSafeConclusionSynthesis(sentence, sectionTitle)
    ))
    .map(({ sentence }) => cleanSentenceForMessage(sentence))
}

export function sanitizeUncitedDraftSentences(markdown: string): string {
  return sanitizeUncitedSentences(markdown, DRAFT_CITATION_RE)
}

export function sanitizeUncitedResolvedSentences(markdown: string): string {
  return sanitizeUncitedSentences(markdown, RESOLVED_CITATION_RE)
}

function sanitizeUncitedSentences(markdown: string, citationPattern: RegExp): string {
  let inTargetSection = false
  let currentSectionTitle = ''
  const sourceLines = markdown.split('\n')
  const lines = sourceLines.map((line, index) => {
    const secondLevelTitle = line.trim().match(/^##\s+(.+?)\s*$/u)?.[1]?.replace(/[*`#]/g, '').trim()
    if (secondLevelTitle) {
      currentSectionTitle = secondLevelTitle
      inTargetSection = TARGET_SECTION_TITLES.has(secondLevelTitle)
    }
    const tableDataRow = isMarkdownTableDataRow(sourceLines, index)
    if (!inTargetSection || shouldSkipProseLine(line, tableDataRow)) return line
    const sentences = splitCitationSentences(line)
    const kept = sentences.filter((sentence) => (
      !isCitationOnlyFragment(sentence) && (
        !isMeaningfulFactualSentence(sentence) ||
        citationPattern.test(sentence) ||
        isSafeConclusionSynthesis(sentence, currentSectionTitle)
      )
    ))
    if (tableDataRow && kept.length === 0) return ''
    return kept.join('').trim()
  })
  return lines
    .filter((line, index) => line.trim() !== '' || index === 0 || lines[index - 1]?.trim() !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isCitationOnlyFragment(sentence: string): boolean {
  if (!ANY_CITATION_RE.test(sentence)) return false
  return sentence
    .replace(/\[(?:structured-claim|claim|evidence):[^\]]+\]/giu, '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/[\s，。；：！？、,.!?:;()（）\[\]{}*_`~>-]+/gu, '')
    .length === 0
}

export function sanitizeExtractionBoilerplateSentences(markdown: string): string {
  return sanitizeReportBodyUrls(markdown)
    .split('\n')
    .map((line) => {
      if (/^\s*\[\d+\]:\s/u.test(line)) return line
      return splitCitationSentences(line)
        .filter((sentence) => !containsExtractionBoilerplate(sentence))
        .join('')
        .trim()
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function reportBodyUrlIssue(markdown: string): string | undefined {
  for (const line of markdown.split('\n')) {
    if (/^\s*\[\d+\]:\s/u.test(line)) continue
    const withoutResolvedCitations = line.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
    const markdownLink = withoutResolvedCitations.match(REPORT_MARKDOWN_LINK_RE)?.[0]
    if (markdownLink) return markdownLink
    const rawUrl = withoutResolvedCitations.match(REPORT_URL_RE)?.[0]
    if (rawUrl) return rawUrl
  }
  return undefined
}

export function sanitizeReportBodyUrls(markdown: string): string {
  return markdown.split('\n').map((line) => {
    if (/^\s*\[\d+\]:\s/u.test(line)) return line
    const protectedCitations: string[] = []
    const protectedLine = line.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, (citation) => {
      const token = `__KUN_RESOLVED_CITATION_${protectedCitations.length}__`
      protectedCitations.push(citation)
      return token
    })
    const cleaned = protectedLine
      .replace(REPORT_MARKDOWN_LINK_RE, '$1')
      .replace(/<(?:https?:\/\/|www\.)[^>]+>/giu, '')
      .replace(new RegExp(REPORT_URL_RE.source, 'giu'), '')
      .replace(/[ \t]+([，。；：！？,.!?:;])/gu, '$1')
      .replace(/[ \t]{2,}/gu, ' ')
      .trimEnd()
    return protectedCitations.reduce(
      (result, citation, index) => result.replace(`__KUN_RESOLVED_CITATION_${index}__`, citation),
      cleaned
    )
  }).filter((line, index, lines) => line.trim() !== '' || index === 0 || lines[index - 1]?.trim() !== '')
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export function pruneUnusedCitationDefinitions(markdown: string): string {
  const lines = markdown.split('\n')
  const usedDisplayIds = new Set(lines
    .filter((line) => !/^\s*\[\d+\]:\s/u.test(line))
    .flatMap((line) => [...line.matchAll(/\[(\d+)\](?!:)/gu)].map((match) => match[1] ?? ''))
    .filter(Boolean))
  return lines
    .filter((line) => {
      const displayId = line.match(/^\s*\[(\d+)\]:\s/u)?.[1]
      return !displayId || usedDisplayIds.has(displayId)
    })
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export function reportSentencesAreNearDuplicates(left: string, right: string): boolean {
  const normalizedLeft = normalizeReportSentenceForDedup(left)
  const normalizedRight = normalizeReportSentenceForDedup(right)
  if (normalizedLeft.length < 24 || normalizedRight.length < 24) return false
  if (normalizedLeft === normalizedRight) return true
  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight
  const longer = shorter === normalizedLeft ? normalizedRight : normalizedLeft
  if (shorter.length >= 32 && longer.includes(shorter)) return true
  return characterBigramContainment(normalizedLeft, normalizedRight) >= 0.88
}

export function repeatedFindingSentenceAcrossSections(markdown: string): string | undefined {
  const seen: Array<{ section: string; sentence: string }> = []
  let inFindings = false
  let currentSection = ''
  for (const line of markdown.split('\n')) {
    const secondLevelTitle = line.trim().match(/^##\s+(.+?)\s*$/u)?.[1]?.replace(/[*`#]/gu, '').trim()
    if (secondLevelTitle) {
      inFindings = /^(?:主要发现|Findings)$/iu.test(secondLevelTitle)
      currentSection = ''
      continue
    }
    const thirdLevelTitle = line.trim().match(/^###\s+(.+?)\s*$/u)?.[1]?.replace(/[*`#]/gu, '').trim()
    if (thirdLevelTitle) {
      currentSection = inFindings ? thirdLevelTitle : ''
      continue
    }
    if (!inFindings || !currentSection || !line.trim() || /^\s*\[\d+\]:\s/u.test(line)) continue
    for (const sentence of splitCitationSentences(line)) {
      const repeated = seen.find((candidate) => (
        candidate.section !== currentSection && reportSentencesAreNearDuplicates(candidate.sentence, sentence)
      ))
      if (repeated) return cleanSentenceForMessage(sentence)
      if (normalizeReportSentenceForDedup(sentence).length >= 24) seen.push({ section: currentSection, sentence })
    }
  }
  return undefined
}

function normalizeReportSentenceForDedup(value: string): string {
  return value
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .replace(/[，。；：、,.!！?？`*_\s]/gu, '')
    .toLowerCase()
    .trim()
}

function characterBigramContainment(left: string, right: string): number {
  const bigrams = (value: string) => new Set(Array.from(
    { length: Math.max(0, value.length - 1) },
    (_, index) => value.slice(index, index + 2)
  ))
  const leftBigrams = bigrams(left)
  const rightBigrams = bigrams(right)
  if (leftBigrams.size === 0 || rightBigrams.size === 0) return 0
  const intersection = [...leftBigrams].filter((bigram) => rightBigrams.has(bigram)).length
  return intersection / Math.min(leftBigrams.size, rightBigrams.size)
}

export function containsExtractionBoilerplate(value: string): boolean {
  return EXTRACTION_BOILERPLATE_RE.test(value) || isExtractionCorruptionText(value)
}

export function hasExplicitEvidenceGapBoundary(value: string): boolean {
  const cleaned = cleanSentenceForMessage(value).replace(/\s+/gu, ' ')
  const explainsMissingAnswer = /(?:当前|现有|本次|所用|已收集的)?(?:可引用|可核验|直接)?(?:证据|资料|来源|材料).{0,100}(?:不足以|不足|缺少|未能|没有|无法).{0,80}(?:回答|支持|形成|得出|判断|结论)/u.test(cleaned)
    || /无法.{0,40}(?:形成|得出).{0,20}(?:可靠|明确|方向性|总体)?结论/u.test(cleaned)
  const limitsSubstitutionOrExtrapolation = /(?:不能|不得|不可|不应|不把|未把).{0,140}(?:外推|替代|冒充|作为).{0,60}(?:答案|结论|判断|证据)?/u.test(cleaned)
    || /(?:外推|适用)(?:范围|边界).{0,80}(?:受限|不明|无法|不能|未覆盖)/u.test(cleaned)
  return explainsMissingAnswer && limitsSubstitutionOrExtrapolation
}

export function citationSentenceAtOffset(markdown: string, offset: number): string {
  const lineStart = markdown.lastIndexOf('\n', offset) + 1
  const lineEnd = markdown.indexOf('\n', offset)
  const line = markdown.slice(lineStart, lineEnd === -1 ? markdown.length : lineEnd)
  const localOffset = Math.max(0, offset - lineStart)
  let cursor = 0
  for (const sentence of splitCitationSentences(line)) {
    const sentenceStart = line.indexOf(sentence, cursor)
    const sentenceEnd = sentenceStart + sentence.length
    if (localOffset >= sentenceStart && localOffset <= sentenceEnd) return sentence
    cursor = sentenceEnd
  }
  return line
}

export function splitCitationSentences(line: string): string[] {
  const sentences: string[] = []
  let start = 0
  let cursor = 0
  while (cursor < line.length) {
    const character = line[cursor] ?? ''
    const isSentenceBoundary = SENTENCE_BOUNDARY_RE.test(character)
    const isIndependentClauseBoundary = /[，,]/u.test(character)
      && INDEPENDENT_CLAUSE_PREFIX_RE.test(line.slice(cursor + 1))
      && ANY_CITATION_RE.test(line.slice(start, cursor))
    if (!isSentenceBoundary && !isIndependentClauseBoundary) {
      cursor += 1
      continue
    }
    cursor += 1
    const trailing = line.slice(cursor).match(/^(?:\s*(?:\[(?:structured-claim|claim|evidence):[^\]]+\]|<sup\b[\s\S]*?<\/sup>|\[\d+\](?!:)))+/iu)?.[0] ?? ''
    cursor += trailing.length
    sentences.push(line.slice(start, cursor))
    start = cursor
  }
  if (start < line.length) sentences.push(line.slice(start))
  return sentences.length > 0 ? sentences : [line]
}

function targetSectionSentenceRecords(markdown: string): Array<{
  sentence: string
  sectionTitle: string
}> {
  const sentences: Array<{ sentence: string; sectionTitle: string }> = []
  let inTargetSection = false
  let currentSectionTitle = ''
  const lines = markdown.split('\n')
  for (const [index, line] of lines.entries()) {
    if (/^\s*\[\d+\]:\s/u.test(line)) {
      inTargetSection = false
      continue
    }
    const secondLevelTitle = line.trim().match(/^##\s+(.+?)\s*$/u)?.[1]?.replace(/[*`#]/g, '').trim()
    if (secondLevelTitle) {
      currentSectionTitle = secondLevelTitle
      inTargetSection = TARGET_SECTION_TITLES.has(secondLevelTitle)
    }
    const tableDataRow = isMarkdownTableDataRow(lines, index)
    if (!inTargetSection || shouldSkipProseLine(line, tableDataRow)) continue
    const lineSentences = splitCitationSentences(line)
    sentences.push(...lineSentences.map((sentence) => ({ sentence, sectionTitle: currentSectionTitle })))
  }
  return sentences
}

function isSafeConclusionSynthesis(sentence: string, sectionTitle: string): boolean {
  if (!/^(?:结论|结论与建议|Conclusion|Recommendations)$/iu.test(sectionTitle)) return false
  const cleaned = cleanSentenceForMessage(sentence)
  if (!cleaned || /\d|https?:\/\/|\|/iu.test(cleaned)) return false
  if (/(?:根据|数据显示|文档指出|来源表明|MDN.{0,12}(?:指出|说明|规定)|必须|一定|始终|所有|完全|唯一)/u.test(cleaned)) return false
  if (hasUnsupportedApplicabilityOrAction(cleaned)) return false
  if (hasExternallyCheckableMechanism(cleaned)) return false
  return cleaned.length >= 14 && isEvidenceSynthesis(cleaned)
}

export function isMarkdownTableDataRow(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  if (!isMarkdownTableRow(line) || isMarkdownTableSeparator(line)) return false
  const nextNonEmpty = lines.slice(index + 1).find((candidate) => candidate.trim().length > 0)
  return !nextNonEmpty || !isMarkdownTableSeparator(nextNonEmpty)
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes('|') && (trimmed.startsWith('|') || trimmed.endsWith('|'))
}

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim().replace(/^\|/u, '').replace(/\|$/u, '')
  if (!trimmed.includes('|') && !/^:?-{3,}:?$/u.test(trimmed)) return false
  const cells = trimmed.split('|').map((cell) => cell.trim())
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell))
}

function shouldSkipProseLine(line: string, tableDataRow = false): boolean {
  const trimmed = line.trim()
  return !trimmed
    || /^#{1,6}\s/u.test(trimmed)
    || /^\[\d+\]:\s/u.test(trimmed)
    || /^```/u.test(trimmed)
    || (isMarkdownTableRow(line) && !tableDataRow)
}

function isMeaningfulFactualSentence(sentence: string): boolean {
  const cleaned = cleanSentenceForMessage(sentence)
  if (cleaned.length < 14 && !/\d/u.test(cleaned)) return false
  if (/[？?]$/u.test(cleaned)) return cleaned.length >= 14
  if (/^(?:以下|下文|具体如下|本节分为|本报告将)/u.test(cleaned)) return false
  if (hasExplicitEvidenceGapBoundary(cleaned)) return false
  if (hasUnsupportedApplicabilityOrAction(cleaned)) return true
  if (isEpistemicBoundary(cleaned)) {
    return /(?:例如|比如|譬如)|[（(]如(?:通过|使用|采用)/u.test(cleaned)
      || hasUnsupportedApplicabilityOrAction(cleaned)
      || hasUnsupportedEvidenceBoundaryExpansion(cleaned)
  }
  if (isEvidenceSynthesis(cleaned)) return hasExternallyCheckableMechanism(cleaned)
  return /[\p{L}\p{N}]/u.test(cleaned)
}

function hasUnsupportedApplicabilityOrAction(sentence: string): boolean {
  return /(?:适用于|(?:更)?适合|更合适|更可靠(?:的)?选择|合理选择|理想选择|最佳(?:实践|策略|选择)|通常(?:使用|采用)|常用|优先(?:使用|采用|选择|考虑)|建议|应该|应当|推荐|必须|(?:可以|可)[^。！？!?；;]{0,12}(?:配置|设置|选择|调整|部署|启用|禁用|管理|实施)|做到极致|冗余信息|保证|确保|后备|(?:导致|使得)[^。！？!?；;]{0,48}(?:无法|不能|增加|减少|提升|降低|改变)|(?:可能|会)[^。！？!?；;]{0,32}(?:提高|提升|降低|下降|增加|减少|改善|恶化)|(?:成本|开销|效率|延迟|收益|风险)[^。！？!?；;]{0,28}(?:提高|提升|降低|下降|增加|减少|改善|恶化|更高|更低|更快|更慢|极高|极低|很高|很低|较高|较低)|(?:提高|提升|降低|下降|增加|减少|改善|恶化)[^。！？!?；;]{0,28}(?:成本|开销|效率|延迟|收益|风险)|(?:并非|不是)[^。！？!?；;]{0,12}(?:唯一|绝对最优)|(?:唯一|绝对最优)[^。！？!?；;]{0,12}(?:方案|选择|策略)|(?:本质上|实际上|等同于|可视为)[^。！？!?；;]{0,24}(?:策略|机制|模式|保证)|根本差异)/u.test(sentence)
}

export function hasExternallyCheckableMechanism(sentence: string): boolean {
  const hasTechnicalMarker = /`[^`]+`|\b[A-Z][A-Za-z0-9/-]*\b|\b[a-z][a-z0-9]*-[a-z0-9-]+\b|[“"][^”"]{2,40}[”"]/u.test(sentence)
  const hasOperationalClaim = /(?:保证|确保|允许|禁止|忽略|绕过|恢复|返回|下载|更新|发起|发送|检查|确认|比较|区分|划分|构成|触发|通知|嵌入|附带|配合|配置|互补|互斥|结合|决定|交给|影响|减少|节省|避免|牺牲|换来|换取|强制|阻止|支持|实现|使用|采用|命名|设置|复用|处理|扩展|提供|依赖|导致|消除|失效|过期|修改|获取|获得|执行|计算|要求|声明|标识|标记|涉及|检测|替换|冗余|信任|合并|归并|转变|转为|切换|优先|后备|不会|无法|始终|每次)/u.test(sentence)
  const hasMechanismExpansion = /(?:通过|依靠|凭借|借助)[^。！？!?；;]{1,120}(?:形成|开辟|创造|推动|带来|实现|获得|建立|维持|提升|降低|改变|扩大)/u.test(sentence)
  const hasQualitativeExpansion = /(?:保持|处于|呈现|表现为)[^。！？!?；;]{0,36}(?:较低|较高|高速|强劲|稳健|健康|安全|领先|落后|良好|优秀|脆弱|不佳)/u.test(sentence)
  const hasComparativeExpansion = /(?:存在|呈现|体现出)[^。！？!?；;]{0,24}(?:显著|明显|较大)(?:差异|差距)|(?:显著|明显)(?:高于|低于|多于|少于|强于|弱于)|更为?(?:多元|集中|分散|活跃|成熟|稳健|严格|宽松|复杂|简单)|(?:更多体现在|更强调|更依赖)|(?:有|占)[^。！？!?；;]{0,12}(?:相当一部分|大部分|多数|少数)/u.test(sentence)
  const hasUncitedCausalOutcome = /(?:会|将|可能|能够)[^。！？!?；;]{0,80}(?:形成|造成|引发|导致|迫使|改变|重塑|影响|构成|增加|减少|提升|降低|改善|恶化|死亡|失效|成功|失败)|(?:从而|进而|导致|使得|迫使)[^。！？!?；;]{0,80}(?:形成|造成|引发|导致|迫使|改变|重塑|影响|构成|增加|减少|提升|降低|改善|恶化|死亡|失效|成功|失败)|(?:即便|即使|只要|如果|若)[^。！？!?；;]{0,120}(?:仍|也|就|便)?(?:会|将|可|能够|可能)[^。！？!?；;]{0,80}(?:形成|造成|引发|导致|改变|影响|构成|增加|减少|提升|降低|改善|恶化|实现|维持|保持)/u.test(sentence)
  return /(?:例如|比如|譬如)/u.test(sentence) || hasMechanismExpansion || hasQualitativeExpansion || hasComparativeExpansion || hasUncitedCausalOutcome || (hasTechnicalMarker && hasOperationalClaim)
}

export function hasUnsupportedEvidenceBoundaryExpansion(sentence: string): boolean {
  const cleaned = cleanSentenceForMessage(sentence)
  const expansion = cleaned.match(/(?:——|--|：|:|(?:^|[，,；;（(])即(?!使|便|可|将)|例如|比如|也就是说)([\s\S]+)$/u)?.[1]?.trim()
  if (expansion && (/\d/u.test(expansion) || hasExternallyCheckableMechanism(expansion))) return true
  return /(?:未覆盖|未说明|未验证|未讨论|未涉及)[^。；;]{0,90}(?:必须|始终|每次|此时|从而|因此会|意味着会|一定会|(?:或|以及|和)[^。；;]{0,36}(?:策略|机制|方法|技术|方案))/u.test(cleaned)
}

function isEvidenceSynthesis(sentence: string): boolean {
  return /^(?:(?:这一|这些|上述)(?:事实|证据|结果|成绩|材料|表现|数据|对比|差异)(?:共同)?(?:直接)?(?:表明|说明|意味着|反映|显示)|这(?:表明|说明|反映|显示))/u.test(sentence)
    || /^基于(?:上述|这些|本章)(?:事实|证据|结果|成绩|材料|表现|数据|对比|差异)/u.test(sentence)
    || /^(?:综合|总体|由此)(?:来看|而言|可见|判断)/u.test(sentence)
    || /^(?:因此|因而|所以|从而|换言之|也就是说|相较之下|相比之下|关键在于|区别在于)/u.test(sentence)
    || /^(?!.*(?:每次|必须|一定|始终|所有|完全|直接证明))(?:这|其)(?:意味着|使得|解释了|导致|体现出|反映出)/u.test(sentence)
    || /^(?:两者|二者|前者|后者).{0,40}(?:关系|差异|作用|分工|不能|并非|共同|分别)/u.test(sentence)
    || /^(?:在这一|在该)(?:机制|过程|阶段|条件|前提)(?:中|下)/u.test(sentence)
    || /^(?:需要|需)注意/u.test(sentence)
}

function isEpistemicBoundary(sentence: string): boolean {
  return /^(?:关于|就)[「“][^」”]{1,80}[」”][，,]?.{0,40}(?:可引用|可核验|直接)?(?:证据|资料|来源|材料).{0,100}(?:不足以|不足|缺少|未能|没有|无法).{0,80}(?:回答|支持|形成|得出|判断|结论)/u.test(sentence)
    || /^(?:其他|其余|相邻)[^。！？!?；;]{0,100}(?:不能|不得|不可|不应).{0,100}(?:替代|冒充|外推)/u.test(sentence)
    || /^(?:本报告|当前|现有|所用|上述|这些)?(?:可引用|可核验|已收集的)?(?:证据|资料|来源|材料|调研|报告|分析).{0,60}(?:不足|有限|受限|缺少|未覆盖|没有覆盖|未记录|无法|不能|尚待|仍需|仅限)/u.test(sentence)
    || /^(?:当前|现有|本章|本次)(?:证据|资料|来源|材料).{0,140}(?:(?:未|没有)(?:覆盖|说明|验证|讨论)|不足以|无法判断|不能(?:据此)?外推)/u.test(sentence)
    || /^本报告.{0,40}(?:基于|仅使用).{0,50}(?:受限|覆盖范围|未覆盖|未验证)/u.test(sentence)
    || /^本报告仅使用.{0,80}(?:来源|资料|证据)/u.test(sentence)
    || /^本报告按用户要求仅使用/u.test(sentence)
    || /^未被(?:这些|上述|当前|本次).{0,60}(?:覆盖|验证|核验).{0,40}(?:不纳入|不作|不构成|仅作)/u.test(sentence)
    || /^(?:没有|未)用其他来源交叉验证/u.test(sentence)
    || /^(?:此外[，,]\s*)?(?:官方文档|来源文本|网页来源|当前来源).{0,30}(?:未|没有|缺少|未明确|未说明|未展开)/u.test(sentence)
    || /^(?:未|尚未)(?:讨论|覆盖|说明|验证|核验|纳入)/u.test(sentence)
    || /^(?:当前|本次)(?:测试|运行|报告|调研).{0,30}(?:只|仅|验证|未覆盖|有限)/u.test(sentence)
    || /^(?:真实研究|后续研究|下一步).{0,30}(?:需要|仍需|应当|应)/u.test(sentence)
    || /^(?:本报告存在以下局限|这一结论的适用边界)/u.test(sentence)
    || /^(?:这一|该)(?:判断|结论)的(?:适用)?边界(?:是|在于|包括)/u.test(sentence)
    || /^(?:这一|该)(?:判断|结论)(?:只)?限于/u.test(sentence)
    || /^本报告(?:不|未)把.{0,120}(?:外推|替代|冒充|作为).{0,40}(?:答案|结论|判断|证据)?/u.test(sentence)
    || /^[^。；;]{2,24}(?:分析)?(?:仅|主要|集中|受限)(?:于|在|使用|覆盖)/u.test(sentence)
}

function cleanSentenceForMessage(sentence: string): string {
  return sentence
    .replace(/\[(?:structured-claim|claim|evidence):[^\]]+\]/giu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .replace(/<sup\b[\s\S]*?<\/sup>/giu, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(?:[-*+] |\d+[.)、]\s*)/u, '')
    .replace(/^\s*\|\s*|\s*\|\s*$/gu, '')
    .replace(/\s*\|\s*/gu, ' | ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
