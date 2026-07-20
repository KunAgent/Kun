/**
 * [INPUT]: 依赖 evidence/types 的 SourceRecord 与 EvidenceSpan、core/chinese-script 的中文书写体系归一
 * [OUTPUT]: 对外提供来源信任边界、强网页证据、繁简体一致且保留“主要风险”等真实复合分面的动态 all-of 焦点、严格焦点匹配、带期间/单位/完整数值的连续表格证据准入及标题复述、文章写作意图、平台免责声明、日期编号索引串、原始 XML 标签、半截枚举、PDF/表格/导航/残句等网页噪声判断函数
 * [POS]: research/evidence 的领域中立证据准入门，强制 synthetic/fallback/search summary 不可引用，不维护任何具体主题词典
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { EvidenceSpan, SourceRecord } from './types.js'
import { comparisonTargetAliases, extractComparisonTargets } from '../core/comparison.js'
import { normalizeResearchChineseScript } from '../core/chinese-script.js'

const MIN_CITABLE_EVIDENCE_CHARS = 20

const FALLBACK_SOURCE_TAGS = new Set([
  'fallback_extracted',
  'fallback_structured',
  'fallback_text',
  'extraction_failed',
  'model_generated',
  'requires_external_verification',
  'synthetic',
  'p0-runtime',
  'web_search_only',
  'search_content_fallback'
])

const UNUSABLE_EVIDENCE_PATTERNS = [
  /this operation was aborted/i,
  /aborterror/i,
  /operation aborted/i,
  /fetch failed/i,
  /network error/i,
  /skip to main content/i,
  /toggle navigation/i,
  /main navigation/i,
  /--[a-z0-9-]+:\s*[^;]+;/i,
  /<\s*\[CDATA\[/i,
  /<?(?:dc|rdf|prism|foaf):(?:title|creator|subject|identifier|description)\b/i,
  /^(?:[A-Za-z][A-Za-z0-9-]*,\s*){2,}[A-Za-z][A-Za-z0-9-]*(?:\s+[a-z]+){0,3}\s+(?:headers?|directives?|methods?|properties?)$/i,
  /^(?:The\s+)?(?:development|design|analysis|assessment|evaluation)\s+of\b.{12,180}(?:based on|case study|model)\s*[:.-]?\s*$/i,
  /^\d{1,3}\s+\p{L}.{10,320}\b(?:Same as|Equivalent to|See(?: also)?)\b/iu,
  /网页来源已抓取，但模型未能抽取结构化证据/u,
  /模型未能抽取结构化证据/u,
  /未能抽取/u,
  /抽取失败/u,
  /最终报告应避免从该片段过度推断/u,
  /^(?:本文|本章|本节|下文|this (?:article|chapter|section))[^。！？.!?]{0,100}(?:将|旨在|will|aims? to)[^。！？.!?]{0,140}(?:分析|剖析|介绍|讨论|比较|examine|analy[sz]e|introduce|discuss|compare)/iu,
  /(?:^|[\s；;。.!！?？])原标题[:：]/u,
  /(?:但是[，,]?)?也存在一些问题(?:[；;，,。\s]*(?:但是[，,]?)?也存在一些问题){1,}/u,
  /(?:另请参阅|参见(?:相关|更多)?|\bsee also\b|\blearn more\b|\brelated topics?\b)/iu,
  /(?:请务必阅读|务必阅读).{0,100}免责声明/u,
  /(?:平台声明|免责声明)[^。！？.!?]{0,180}(?:仅代表作者|不代表平台|仅提供(?:信息)?存储|不构成[^。！？.!?]{0,40}(?:建议|意见))/u,
  /(?:相关|上述|所载)?(?:信息|内容|资料)[^。！？.!?]{0,80}(?:未经|未经过|没有经过)[^。！？.!?]{0,60}(?:证实|核实|验证)[^。！？.!?]{0,120}(?:不构成|风险自担|自行承担)/u,
  /(?:应|须)[^。！？.!?]{0,160}(?:自行判断|自行承担|自负)[^。！？.!?]{0,40}(?:风险|责任|后果)/u,
  /(?:19|20)\d{2}-\d{1,2}-\d{1,2}\s+\d+[.、][\s\S]{2,160}(?:19|20)\d{2}-\d{1,2}-\d{1,2}\s+\d+[.、]/u,
  /(?:本报告|本文件|本资料|this report|this document|these materials)[^。！？.!?]{0,160}(?:未|没有|不会|does not|do not|has not|have not)[^。！？.!?]{0,120}(?:目标|情况|需要|objectives?|circumstances?|needs?)/iu,
  /(?:不承担|概不承担).{0,80}(?:法律责任|任何责任|一切后果)/u,
  /^(?:否则|反之|因此|因而|所以|从而|但是|然而|不过|另外|此外|同时|并且)[，,]/u,
  /(?:^|[；;。.!?]\s*)(?:而|且|但)?[^；;。.!?]{0,20}(?:若|如果|当|一旦)[^；;。.!?]{0,8}$/u,
  /[:：]\s*$/u,
  /^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?=[\[{(])(?=[\s\S]*(?:[\[{(][^\]}\)]*$|["'][^"']*$))/u,
  /\[Table_[A-Za-z0-9_]+\]/iu,
  /\b[a-z]{3,}\s+(?:Building|Using|The|This|These|Those|When|If|For|To|A|An)\s+[a-z]/u,
  /[\u3400-\u9fff]\s+(?:通常|一般|构建|这|该|如果|当|因此|但是|然而).{20,140}[\u3400-\u9fff]\s+(?:通常|一般|构建|这|该|如果|当|因此|但是|然而)/u,
  /被\s+化(?:作为|为)/u,
  /\.{3}|…|\[SOURCE_CHUNK_BOUNDARY\]/u,
  /(?:19|20)\d{2}\s*年?\s+\d{1,2}\s*$/u,
  /(?:占比|比例|rate|percent|%)[\s\S]{0,180}\d[\d,.]*\s+\d{1,2}\s*$/iu,
  /(?:预计|预测|分别为|分别达到|\bforecast|\bexpected|\bprojected)[\s\S]{0,180}\d[\d,.]*\s+\d{1,2}\s*$/iu,
  /(?:分别为|分别达到|依次为)[^。！？.!?]{0,120}\d[\d,.]*\s*$/u,
  /(?:达到|实现|记录|测得|reached|achieved|recorded|measured)[^。！？.!?]{0,40}\d{3,}[\d,.]*\s*$/iu,
  /\b(?:is|are|was|were|the|a|an|of|to|and|or|but|with|from|in|on|for|when|while|that|which|as)$/iu,
  /\b[a-z]{2,}\s+[a-z]$/u,
  /^[a-z][a-z0-9-]*(?:\s+[a-z0-9][a-z0-9'/-]*){1,5}$/iu,
  /^(?=.{120,}$)(?:[A-Za-z0-9+/]{16,}={0,2}\s*){3,}$/u
]

export function isModelFallbackSource(source: SourceRecord): boolean {
  return source.kind === 'model_fallback' ||
    source.sourcePolicyTags.includes('model_generated') ||
    source.sourcePolicyTags.includes('requires_external_verification')
}

export function isFallbackExtractedSource(source: SourceRecord): boolean {
  return source.sourcePolicyTags.some((tag) => FALLBACK_SOURCE_TAGS.has(tag))
}

export function canCiteSource(source: SourceRecord): boolean {
  return source.status === 'fetched' &&
    !source.path?.startsWith('synthetic://') &&
    !isModelFallbackSource(source) &&
    !isFallbackExtractedSource(source)
}

export function canCiteEvidenceSpan(span: EvidenceSpan | undefined, source: SourceRecord | undefined): boolean {
  if (!span || !source || !canCiteSource(source)) return false
  if (isSourceTitleOnlyText(span.text, source.title)) return false
  return isUsableEvidenceText(span.text, MIN_CITABLE_EVIDENCE_CHARS)
}

export function isEligibleEvidenceSource(source: SourceRecord, spans: EvidenceSpan[]): boolean {
  if (!canCiteSource(source)) return false
  return spans.some((span) => canCiteEvidenceSpan(span, source))
}

export function isEligibleStrongWebEvidence(source: SourceRecord, span: EvidenceSpan | undefined): boolean {
  if (!span || source.status !== 'fetched') return false
  if (source.kind !== 'web_strong') return false
  if (source.sourceType !== 'web') return false
  if (source.reliability !== 'high') return false
  return canCiteEvidenceSpan(span, source)
}

export function isUsableEvidenceText(text: string, minChars = MIN_CITABLE_EVIDENCE_CHARS): boolean {
  if (hasPdfCompatibilityGlyphNoise(text)) return false
  const normalized = normalizeResearchChineseScript(text.replace(/\s+/g, ' ').trim())
  if (normalized.length < minChars) return false
  if (isHeadingOnlyEvidenceText(normalized)) return false
  if (hasGluedNumericCells(normalized)) return false
  if (hasUnbalancedEvidenceDelimiters(normalized)) return false
  if (isRawMarkupFragment(normalized)) return false
  if (isMidListFragment(normalized)) return false
  if (hasEmbeddedPdfPageHeader(normalized)) return false
  if (hasTruncatedShortEnglishTail(normalized)) return false
  if (isUnattributedEntityProfileText(normalized)) return false
  if (isAnonymousComparisonTableHeader(normalized)) return false
  if (isPageHeadingGluedFragment(normalized)) return false
  if (isIncompleteEnumeratedLeadIn(normalized)) return false
  if (isMeetingAgendaOnlyText(normalized)) return false
  if (hasDanglingChineseLocativeTail(normalized)) return false
  if (isLikelyTruncatedDenseNumericRow(normalized)) return false
  if (hasDanglingSingleNumericTail(normalized)) return false
  if (isLikelyIncompleteEnglishProse(normalized)) return false
  if (isContextlessNumericTableRow(normalized)) return false
  if (isBibliographicMetadataOnlyText(normalized)) return false
  if (isDocumentHeaderMetadataOnlyText(normalized)) return false
  if (isDocumentNavigationOrProvisionalNotice(normalized)) return false
  if (isNavigationBreadcrumbText(normalized)) return false
  if (isNavigationLabelListText(normalized)) return false
  if (isResearchUtilityStatementOnly(normalized)) return false
  if (hasUnresolvedEvidenceReference(normalized)) return false
  return !UNUSABLE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isExtractionCorruptionText(text: string): boolean {
  const normalized = normalizeResearchChineseScript(text
    .replace(/\[(?:structured-claim|claim|evidence):[^\]]+\]/giu, '')
    .replace(/<sup\b[\s\S]*?<\/sup>/giu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .replace(/\s+/gu, ' ')
    .trim())
  if (!normalized) return false
  return hasUnbalancedEvidenceDelimiters(normalized)
    || isRawMarkupFragment(normalized)
    || isMidListFragment(normalized)
    || isNavigationBreadcrumbText(normalized)
    || isMalformedMixedLanguageFragment(normalized)
}

function isRawMarkupFragment(text: string): boolean {
  const tags = text.match(/<\/?[a-z][^>]{0,160}>/giu) ?? []
  return tags.length >= 2 || /^\s*\d+\s*<\/[a-z][^>]*>/iu.test(text)
}

function isMidListFragment(text: string): boolean {
  return /^\s*[（(](?:[二三四五六七八九十]|[2-9]|[1-9]\d|[b-z])[）)]/iu.test(text)
}

function isNavigationBreadcrumbText(text: string): boolean {
  const separators = text.match(/\s>\s/gu) ?? []
  if (separators.length < 2) return false
  const labels = text
    .replace(/^\s*>\s*/u, '')
    .replace(/[。.!！?？]+$/u, '')
    .split(/\s>\s/gu)
    .map((label) => label.trim())
    .filter(Boolean)
  if (labels.length < 3 || labels.some((label) => label.length > 32)) return false
  return !/(?:是|为|有|将|已|可|能|由|在|于|向|对|与|并|发布|显示|达到|增长|下降|要求|允许|禁止)|\b(?:is|are|was|were|has|have|will|can|published|shows?|requires?|allows?|prohibits?)\b/iu.test(
    labels.join(' ')
  )
}

function isMalformedMixedLanguageFragment(text: string): boolean {
  const hanCharacters = text.match(/[\u3400-\u9fff]/gu) ?? []
  if (hanCharacters.length === 0 || hanCharacters.length > 12) return false
  const latinWords = text.match(/\b[A-Za-z][A-Za-z'-]{1,}\b/gu) ?? []
  if (latinWords.length < 7) return false
  const visibleStart = text.replace(/^[\s>*_`#\[(]+/u, '')
  return /^[a-z]/u.test(visibleStart)
}

function isNavigationLabelListText(text: string): boolean {
  if (!/(?:更多|\bmore\b)/iu.test(text)) return false
  const afterMarker = text.split(/(?:更多|\bmore\b)/iu).at(-1) ?? ''
  const labels = afterMarker.match(/[\p{L}\p{N}][\p{L}\p{N}()./_-]{1,16}/gu) ?? []
  return labels.length >= 5 && !/[。！？.!?]/u.test(afterMarker)
}

function isResearchUtilityStatementOnly(text: string): boolean {
  const utilityClaim = /^(?:(?:这|该项|上述|相关)(?:信息|数据|材料|内容)?(?:只)?(?:有助于|便于|允许|可用于)|(?:有助于|便于|允许|可用于)).{0,48}(?:理解|了解|分析|研究|判断)|^(?:this|it)\s+(?:allows?|helps?|enables?|provides?)\b.{0,48}\b(?:understand|understanding|analyse|analyze|analysis|research|assess|overview)\b/iu
  if (!utilityClaim.test(text)) return false
  return !CONCRETE_RESULT_SIGNAL.test(text)
}

const CONCRETE_RESULT_SIGNAL = /(?:达到|增长|上升|下降|减少|增加|占比|份额|合计|总数|发生|完成|通过|拒绝|采用|要求|禁止|必须|\d[\d,.]*\s*(?:%|％|‰|万|亿|兆|million|billion|trillion))|\b(?:reached|grew|increased|decreased|declined|fell|accounted for|totaled|required|prohibited|adopted|completed|passed|rejected)\b/iu

function hasEmbeddedPdfPageHeader(text: string): boolean {
  for (const match of text.matchAll(/\s\d{1,3}\s+/gu)) {
    if ((match.index ?? Number.POSITIVE_INFINITY) > 140) continue
    const afterPageNumber = text.slice((match.index ?? 0) + match[0].length).trimStart()
    if (/^(?:[A-Z][A-Z'-]*\s+){3,}/u.test(afterPageNumber)) return true
  }
  return false
}

function hasTruncatedShortEnglishTail(text: string): boolean {
  if (text.length < 100 || /[。！？.!?;；:：]["”’')\]】）]*$/u.test(text)) return false
  const tail = text.match(/\b([a-z]{2})$/iu)?.[1]?.toLowerCase()
  if (!tail) return false
  return !new Set(['ai', 'api', 'eu', 'go', 'ip', 'os', 'uk', 'us']).has(tail)
}

function hasDanglingSingleNumericTail(text: string): boolean {
  if (text.length < 32 || !/\d$/u.test(text) || /(?:19|20)\d{2}$/u.test(text)) return false
  const numericTokens = text.match(/\d[\d,.]*/gu) ?? []
  return numericTokens.length === 1 && /\p{L}[^。！？.!?]{12,}\d$/u.test(text)
}

function isLikelyIncompleteEnglishProse(text: string): boolean {
  if (text.length < 70 || /[。！？.!?;；:：]["”’')\]】）]*$/u.test(text)) return false
  if (!/[a-z]$/iu.test(text) || /[\p{Script=Han}]/u.test(text)) return false
  const words = text.match(/[a-z][a-z'-]*/giu) ?? []
  return words.length >= 10
}

function isHeadingOnlyEvidenceText(text: string): boolean {
  if (text.length > 120 || /[。！？.!?;；:：]/u.test(text)) return false
  const latinWords = text.match(/[A-Za-z][A-Za-z'-]*/gu) ?? []
  if (latinWords.length < 3) return false
  return latinWords.every((word) => word === word.toUpperCase())
    && /^[\p{Lu}\p{N}\s&/+,'’-]+$/u.test(text)
}

function hasGluedNumericCells(text: string): boolean {
  const withoutRecognizedUnits = text
    .replace(/\b[A-Z]{2,8}\s*\d[\d,.]*/gu, ' ')
    .replace(/\d[\d,.]*\s*[\p{Script=Han}]{1,10}/gu, ' ')
  return /(?:\p{L}\d[\d,.]{7,}|[\d,.]{7,}\p{L})/u.test(withoutRecognizedUnits)
}

function isPageHeadingGluedFragment(text: string): boolean {
  if (!/^(?!(?:19|20)\d{2}\b)\d{1,3}\s+\p{L}{2,80}/u.test(text)) return false
  return text.length >= 40 && !/[。！？.!?]$/u.test(text)
}

function isIncompleteEnumeratedLeadIn(text: string): boolean {
  if (!/^(?:考虑到|鉴于|由于|基于)\s*[（(]?(?:i|1|一)[）)]?/iu.test(text)) return false
  if (/[。！？.!?]$/u.test(text)) return false
  const tail = text.split(/[，,；;]/u).at(-1)?.trim() ?? ''
  return !/(?:决定|决议|认为|意味着|导致|因此|故|从而|我们将|需要|可以|可将)/u.test(tail)
}

function isMeetingAgendaOnlyText(text: string): boolean {
  if (!/(?:召开|举行).{0,60}(?:发布会|会议).{0,120}(?:就|围绕).{0,120}(?:进行解读|作出说明|展开讨论|进行介绍)/u.test(text)) {
    return false
  }
  return !/(?:增长|下降|达到|实现|完成|签署|发布(?!会)|通过|否决|发生|发现|结果|%|％|\d)/u.test(text)
}

function isAnonymousComparisonTableHeader(text: string): boolean {
  const anonymousColumns = text.match(/(?:^|\s)(?:[A-ZＡ-Ｚ]|[甲乙丙丁])(?=\s|$)/giu) ?? []
  if (anonymousColumns.length < 2) return false
  return /(?:排名|比较|指标|得分|占比|rank|comparison|metric|score|share|%|％|\d)/iu.test(text)
}

function isUnattributedEntityProfileText(text: string): boolean {
  const firstSentence = text.split(/[。！？!?；;]/u)[0]?.trim() ?? ''
  const anonymousChineseEntity = /^(?:一家|一间|一个)[^。！？!?；;]{4,120}[，,]/u
  const anonymousEnglishEntity = /^(?:a|an|one)\s+[^.!?;]{4,120}\b(?:based|founded|located|headquartered|established)\b/iu
  return anonymousChineseEntity.test(firstSentence) || anonymousEnglishEntity.test(firstSentence)
}

function hasPdfCompatibilityGlyphNoise(text: string): boolean {
  return (text.match(/[\u2e80-\u2fff]/gu) ?? []).length >= 2
}

function hasUnbalancedEvidenceDelimiters(text: string): boolean {
  if ((text.match(/"/gu) ?? []).length % 2 !== 0) return true
  const pairs: Array<[string, string]> = [
    ['“', '”'], ['「', '」'], ['『', '』'], ['（', '）'], ['(', ')'], ['[', ']'], ['{', '}']
  ]
  return pairs.some(([open, close]) => countCharacter(text, open) !== countCharacter(text, close))
}

function countCharacter(text: string, character: string): number {
  return text.split(character).length - 1
}

function hasDanglingChineseLocativeTail(text: string): boolean {
  const sentences = text.split(/[。！？!?；;]/u).map((sentence) => sentence.trim()).filter(Boolean)
  if (sentences.length < 2) return false
  const tail = sentences.at(-1) ?? ''
  return /(?:在|于)[^。！？!?；;]{1,28}(?:范围|方面|层面|阶段|过程中|条件下|情况下)$/u.test(tail)
}

function isLikelyTruncatedDenseNumericRow(text: string): boolean {
  if (isCompleteStructuredTableEvidence(text)) return false
  const numericCells = evidenceNumericCells(text)
  if (numericCells.length >= 6 && !/(?:[。！？!?;；]|(?<!\d)\.(?!\d))/u.test(text)) return true
  return numericCells.length >= 5 && /(?:^|\s)\d{1,2}\s*$/u.test(text)
}

function isCompleteStructuredTableEvidence(text: string): boolean {
  const numericCells = evidenceNumericCells(text)
  if (numericCells.length < 4) return false
  const hasPeriodHeader = /(?:\bfor\s+the\s+(?:year|period)\s+ended\b|\byear\s+ended\b|\bas\s+at\b|截至.{0,24}(?:年度|期间|年|月|日)|(?:本|上|该)年度)/iu.test(text)
  const hasColumnsOrUnits = /(?:\bchange\b|\bunits?\b|\(\s*[A-Za-z%]{1,16}(?:\s+[A-Za-z]{1,16})?\s*\)|\b[A-Z]{2,8}\s*[’'‘′]?\s*000\b|单位\s*[:：]|同比|环比|变动)/iu.test(text)
  const hasNamedRow = /[\p{L}\p{Script=Han}]{3,}.{0,80}(?<![\p{L}\p{N}])\d[\d,.]*(?:%|％)?/u.test(text)
  const endsAtCompleteCell = /(?:\d[\d,.]*(?:%|％)?|\))\s*$/u.test(text)
  return hasPeriodHeader && hasColumnsOrUnits && hasNamedRow && endsAtCompleteCell
}

function isContextlessNumericTableRow(text: string): boolean {
  if (text.length > 180) return false
  const numericCells = evidenceNumericCells(text)
  if (numericCells.length < 2) return false
  if (/(?:[\u3002\uff01\uff1f!?\uff0c\uff1b;]|(?<!\d)\.(?!\d))/u.test(text)) return false
  if (/(?:\b(?:reached|grew|increased|decreased|rose|fell|was|were|amounted|totaled)\b|达到|增长|下降|上升|实现|录得|采用|代表|需要|包括|覆盖|支持)/iu.test(text)) return false
  const hasPeriodOrUnitContext = /(?:\b(?:Q[1-4]|H[12]|FY\s*\d{2,4}|(?:19|20)\d{2})\b|(?:19|20)\d{2}年|截至\s*(?:19|20)\d{2}|\bunits?\s*[:：]|\b[A-Z]{2,8}\s*[’'‘′]?\s*000\b|单位\s*[:：])/iu.test(text)
  if (hasPeriodOrUnitContext) return false
  const label = text
    .replace(/[(\uff08-]?\d[\d,.]*(?:%|[)\uff09])?/gu, ' ')
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
  return label.length > 0 && label.split(/\s+/u).length <= 8
}

function evidenceNumericCells(text: string): string[] {
  return text.match(/(?<![A-Za-z0-9])\d+(?:[.,]\d+)*(?:%|％)?(?![A-Za-z0-9])/gu) ?? []
}

function hasUnresolvedEvidenceReference(text: string): boolean {
  if (!/\bthe value\b/iu.test(text)) return false
  if (/\bthe value\s+(?:of|for)\b/iu.test(text)) return false
  return !/(?:field|attribute|parameter|property|metric|indicator|variable).{0,40}\bthe value\b/iu.test(text)
}

export function isBibliographicMetadataOnlyText(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const metadataSignals = [
    /^(?:10\.\d{4,9}\/|\d{3,7}\/s\d{4,}-)/iu,
    /\bDepartment of\b/iu,
    /\b(?:Keywords?|Affiliations?|Corresponding author|Author information)\s*:/iu,
    /\b(?:Introduction|References)\b/iu,
    /(?:\b[A-Z][a-z]+\s+[A-Z][a-z]+\s*[1-9,*\u2709]\s*){2,}/u
  ].filter((pattern) => pattern.test(normalized)).length
  if (metadataSignals < 2) return false
  return !/(?:\bResults?\b|\bConclusions?\b|\bwe (?:found|observed|showed)\b|\bsignificantly\b|\b(?:higher|lower|increased|decreased)\b|研究结果|结果显示|研究发现|结论表明)/iu.test(normalized)
}

function isDocumentHeaderMetadataOnlyText(text: string): boolean {
  const headerSignals = [
    /\b(?:registered|principal|publication|document)\s+(?:address|office|identifier|number)\b/iu,
    /\b[A-Za-z][A-Za-z ]{0,24}(?:code|number|identifier)\s*:\s*[A-Za-z0-9-]+\b/iu,
    /\b(?:dated|periodic|official)\b.{0,40}\b(?:announcement|report|publication|document)\b/iu,
    /(?:参考编号|登记编号|文档编号|发布日期|文档标识)/u
  ].filter((pattern) => pattern.test(text)).length
  if (headerSignals < 2) return false
  return !/(?:\b(?:reached|grew|increased|decreased|rose|fell|amounted|totaled|found|observed|measured)\b[^.!?]{0,100}\d|(?:达到|增长|下降|上升|实现|发现|测得)[^。！？]{0,100}\d)/iu.test(text)
}

function isDocumentNavigationOrProvisionalNotice(text: string): boolean {
  const navigation = /\b(?:open|access|download|view|find|filed|published)\b[^.!?]{0,100}\b(?:document|report|publication|index|directory|archive|portal)\b|\b(?:document|report|publication|index|directory|archive|portal)\b[^.!?]{0,100}\b(?:open|access|download|view|find|filed|published)\b/iu
  if (navigation.test(text)) return true
  return /\b(?:figures?|values?|data|results?)\b[^.!?]{0,100}\b(?:document|report|publication)\b[^.!?]{0,100}\b(?:provisional|preliminary|indicative|unaudited)\b/iu.test(text)
}

export function isSourceTitleOnlyText(text: string, sourceTitle: string): boolean {
  const normalizedText = normalizeComparableText(text)
  const normalizedTitle = normalizeComparableText(sourceTitle)
  if (normalizedTitle.length < 12 || normalizedText.length < 12) return false
  if (normalizedText === normalizedTitle) return true
  if (normalizedText.length > normalizedTitle.length * 1.1) return false
  const textPairs = characterPairs(normalizedText)
  const titlePairs = new Set(characterPairs(normalizedTitle))
  const overlap = textPairs.filter((pair) => titlePairs.has(pair)).length
  return textPairs.length >= 10 && overlap / textPairs.length >= 0.82
}

function characterPairs(value: string): string[] {
  const pairs: string[] = []
  for (let index = 0; index < value.length - 1; index += 1) pairs.push(value.slice(index, index + 2))
  return [...new Set(pairs)]
}

function normalizeComparableText(value: string): string {
  return normalizeResearchChineseScript(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export function sourceIdentityKey(source: SourceRecord): string {
  const trustBoundary = canCiteSource(source) ? 'citable' : 'non_citable'
  const url = source.canonicalUrl ?? source.originalUrl
  if (url) return `${trustBoundary}:url:${normalizeSourceUrl(url)}`
  if (source.path) return `${trustBoundary}:path:${source.path}`
  if (source.documentId) return `${trustBoundary}:document:${source.documentId}`
  return `${trustBoundary}:fingerprint:${source.fingerprint}`
}

export function uniqueEvidenceSources(sources: SourceRecord[]): SourceRecord[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = sourceIdentityKey(source)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function uniqueEligibleEvidenceSources(sources: SourceRecord[], spans: EvidenceSpan[]): SourceRecord[] {
  const spansBySourceId = new Map<string, EvidenceSpan[]>()
  for (const span of spans) {
    const sourceSpans = spansBySourceId.get(span.sourceId) ?? []
    sourceSpans.push(span)
    spansBySourceId.set(span.sourceId, sourceSpans)
  }
  return uniqueEvidenceSources(sources.filter((source) =>
    isEligibleEvidenceSource(source, spansBySourceId.get(source.id) ?? [])
  ))
}

export function eligibleEvidenceSourceCount(sources: SourceRecord[], spans: EvidenceSpan[]): number {
  return uniqueEligibleEvidenceSources(sources, spans).length
}

export function isResearchTextRelevant(researchText: string, evidenceText: string): boolean {
  const comparisonAliases = extractComparisonTargets(researchText).flatMap(comparisonTargetAliases)
  const signals = researchSignalTerms(researchText)
  if (signals.length === 0) return false
  const normalizedEvidence = normalizeResearchChineseScript(evidenceText).toLowerCase()
  const hits = signals.filter((signal) => normalizedEvidence.includes(normalizeResearchChineseScript(signal).toLowerCase()))
  if (hits.some((signal) => comparisonAliases.some((alias) =>
    normalizeResearchChineseScript(alias).toLowerCase() === normalizeResearchChineseScript(signal).toLowerCase()
  ))) return true
  if (hits.some((signal) => isNamedEntitySignal(signal, researchText))) return true
  if (hits.some((signal) => /[\u4e00-\u9fff]{3,}/u.test(signal))) return true
  return hits.length >= 2
}

export function isResearchEvidenceFocused(questionText: string, evidenceText: string, contextText = ''): boolean {
  const dimension = questionText.match(/在「([^」]+)」维度/u)?.[1]?.trim()
  if (!dimension) return isResearchTextRelevant(questionText, evidenceText)
  const normalizedEvidence = normalizeResearchChineseScript(evidenceText).toLowerCase()
  const normalizedDimension = cleanDimensionFacet(dimension)
  const facetFocusGroups = researchDimensionFocusGroups(dimension, contextText)
  const focusTerms = [normalizedDimension, ...facetFocusGroups.flat()]
    .filter((term) => term.length >= 2)
  const matchedFocusTerms = focusTerms.filter((term) => evidenceIncludesFocusTerm(normalizedEvidence, term))
  if (matchedFocusTerms.length === 0) return false
  if (isIncidentalResearchFocusMention(evidenceText, matchedFocusTerms)) return false
  if (matchedFocusTerms.some((term) => !AMBIGUOUS_DIMENSION_TERMS.has(normalizeResearchChineseScript(term).toLowerCase()))) {
    return true
  }
  const normalizedFocusTerms = new Set(focusTerms.map((term) => normalizeResearchChineseScript(term).toLowerCase()))
  const contextAnchors = researchSignalTerms(contextText)
    .map((term) => normalizeResearchChineseScript(term).toLowerCase())
    .filter((term) => !normalizedFocusTerms.has(term))
    .filter((term) => !AMBIGUOUS_DIMENSION_TERMS.has(term))
    .filter((term) => term.length >= 3)
  return contextAnchors.some((term) => evidenceIncludesFocusTerm(normalizedEvidence, term))
}

export function isIncidentalResearchFocusMention(evidenceText: string, matchedTerms: string[]): boolean {
  const normalizedEvidence = normalizeResearchChineseScript(evidenceText).toLowerCase()
  const positions = [...new Set(matchedTerms
    .map((term) => normalizeResearchChineseScript(term).toLowerCase().trim())
    .filter((term) => term.length >= 2)
    .map((term) => normalizedEvidence.indexOf(term))
    .filter((index) => index >= 0))]
  if (positions.length === 0 || Math.max(...positions) - Math.min(...positions) > 40) return false
  const start = Math.max(0, Math.min(...positions) - 70)
  const end = Math.min(normalizedEvidence.length, Math.max(...positions) + 70)
  const focusWindow = normalizedEvidence.slice(start, end)
  const informationProcess = /(?:文件|文档|资料|材料|会议|董事|委员会|\bdocuments?\b|\bmaterials?\b|\bmeetings?\b|\bboards?\b|\bdirectors?\b|\bcommittees?\b)/iu.test(normalizedEvidence)
  const awarenessOnly = /(?:了解|知悉|获悉|掌握|审阅|阅读|知情|\bunderstand\b|\bbe informed\b|\breview\b|\bread\b|\bawareness\b)/iu.test(focusWindow)
  return informationProcess && awarenessOnly
}

export function researchDimensionFocusGroups(question: string, contextText: string | number = ''): string[][] {
  const dimension = dimensionTitleFromQuestion(question)
  const facets = splitDimensionFacets(dimension)
  const resolvedContextText = typeof contextText === 'string' ? contextText : ''
  const aliases = bilingualAliases(`${question}\n${resolvedContextText}`)
  return facets
    .map((facet) => dimensionFacetAliases(facet, aliases))
    .filter((group) => group.length > 0)
}

export function coversResearchDimensionFocusGroups(groups: string[][], evidenceText: string): boolean {
  const normalizedEvidence = normalizeResearchChineseScript(evidenceText).toLowerCase()
  return groups.every((group) => group.some((alias) => evidenceIncludesFocusTerm(normalizedEvidence, alias)))
}

function dimensionTitleFromQuestion(question: string): string {
  return question.match(/在「([^」]+)」维度/u)?.[1]?.trim() ?? question.trim()
}

function splitDimensionFacets(value: string): string[] {
  const dimension = cleanDimensionFacet(value)
  if (!dimension) return []
  const compactContrast = dimension.match(/^(强弱|男女|新旧|高低|正反|内外|前后|上下|左右)\s*(.{1,30})$/u)
  if (compactContrast) {
    const suffix = cleanDimensionFacet(compactContrast[2] ?? '')
    const markers = [...(compactContrast[1] ?? '')]
    if (suffix && markers.length === 2) return markers.map((marker) => `${marker}${suffix}`)
  }
  const parts = splitOutsideParentheses(dimension)
    .map(cleanDimensionFacet)
    .filter((part) => part.length >= 2)
  if (parts.length < 2) return [dimension]
  return [...new Set(parts.flatMap(expandCompactContrastFacet))]
}

function expandCompactContrastFacet(facet: string): string[] {
  const match = facet.match(/^(强弱|男女|新旧|高低|正反|内外|前后|上下|左右)\s*(.{1,30})$/u)
  if (!match) return [facet]
  const suffix = cleanDimensionFacet(match[2] ?? '')
  const markers = [...(match[1] ?? '')]
  return suffix && markers.length === 2 ? markers.map((marker) => `${marker}${suffix}`) : [facet]
}

function splitOutsideParentheses(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  const flush = () => {
    if (current.trim()) parts.push(current.trim())
    current = ''
  }
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? ''
    if (char === '(' || char === '（' || char === '[' || char === '【') depth += 1
    if (char === ')' || char === '）' || char === ']' || char === '】') depth = Math.max(0, depth - 1)
    if (depth === 0 && /[、，,；;]/u.test(char)) {
      flush()
      continue
    }
    if (depth === 0 && char === '/' && /\p{Script=Han}/u.test(value[index - 1] ?? '') && /\p{Script=Han}/u.test(value[index + 1] ?? '')) {
      flush()
      continue
    }
    if (depth === 0 && /[与和及或]/u.test(char)) {
      flush()
      continue
    }
    current += char
  }
  flush()
  const wordSplit = parts.flatMap((part) => part.split(/\s+(?:and|or|vs\.?|versus)\s+/iu))
  const cleaned = wordSplit.map((part) => part.trim()).filter(Boolean)
  if (cleaned.length >= 2 && cleaned.every((part) => cleanDimensionFacet(part).length >= 2)) return cleaned
  return [value]
}

function cleanDimensionFacet(value: string): string {
  const normalized = normalizeResearchChineseScript(value)
    .replace(/^[「“"']|[」”"']$/gu, '')
    .replace(/^(?:请|研究|调研|分析|解释|说明|判断|评估|讨论|比较|对比|区分)\s*/u, '')
    .replace(/(?:应用)?场景$/u, '')
    .replace(/维度$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
  const stripped = normalized
    .replace(/(?:的)?(?:具体含义|定义|区别|差异|异同|相互关联|关联|关系|协同机制|协同|作用机制|适用边界)(?:及|与|和)?(?:相互关联|关系|协同机制|适用边界)?$/u, '')
    .replace(/的风险$/u, '')
    .trim()
  if (stripped.length < 2 || /^(?:主要|核心|关键|潜在|重大|整体|总体)$/u.test(stripped)) return normalized
  return stripped
}

const AMBIGUOUS_DIMENSION_TERMS = new Set([
  'result', 'results', 'performance', 'process', 'method', 'strategy', 'system', 'model',
  'validation', 'resource', 'resources', 'application', 'applications',
  '结果', '表现', '流程', '方法', '策略', '体系', '系统', '模型', '场景', '验证', '资源', '应用'
])

function evidenceIncludesFocusTerm(normalizedEvidence: string, rawTerm: string): boolean {
  const term = normalizeResearchChineseScript(rawTerm).toLowerCase().trim()
  if (!term) return false
  if (!/^[a-z0-9+#.&-]+$/iu.test(term)) return normalizedEvidence.includes(term)
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'iu').test(normalizedEvidence)
}

function bilingualAliases(contextText: string): Map<string, string[]> {
  const aliases = new Map<string, string[]>()
  const normalized = normalizeResearchChineseScript(contextText).toLowerCase()
  for (const match of normalized.matchAll(/([\p{Script=Han}]{2,24})\s*[（(]([a-z][a-z0-9+#.& -]{1,50})[）)]/giu)) {
    addChineseLatinAliases(aliases, match[1] ?? '', match[2] ?? '')
  }
  for (const match of normalized.matchAll(/([a-z][a-z0-9+#.& -]{1,50})\s*[（(]([\p{Script=Han}]{2,24})[）)]/giu)) {
    addChineseLatinAliases(aliases, match[2] ?? '', match[1] ?? '')
  }
  return aliases
}

function addChineseLatinAliases(aliases: Map<string, string[]>, rawChinese: string, rawLatin: string): void {
  const chinese = rawChinese.trim()
  const latin = rawLatin.trim()
  if (!chinese || !latin) return
  const chineseCandidates = [chinese]
  for (let length = 2; length <= Math.min(12, chinese.length); length += 1) {
    chineseCandidates.push(chinese.slice(-length))
  }
  for (const candidate of chineseCandidates) {
    addBilingualAlias(aliases, candidate, latin)
    addBilingualAlias(aliases, latin, candidate)
  }
}

function dimensionFacetAliases(facet: string, aliases: Map<string, string[]>): string[] {
  const normalized = cleanDimensionFacet(facet).toLowerCase()
  if (!normalized) return []
  const parenthetical = [...normalized.matchAll(/([^()（）]{1,60})\s*[（(]([^()（）]{1,60})[）)]/gu)]
    .flatMap((match) => [match[1]?.trim(), match[2]?.trim()])
    .filter((value): value is string => Boolean(value))
  const base = normalized.replace(/\s*[（(][^()（）]{1,60}[）)]\s*/gu, ' ').replace(/\s+/g, ' ').trim()
  const dynamicAliases = [normalized, base, ...parenthetical, ...(aliases.get(base) ?? []), ...(aliases.get(normalized) ?? [])]
  const contrast = base.match(/^([强弱男女新旧高低正反内外前后上下左右])\s*(.{1,30})$/u)
  if (contrast) {
    const modifierAliases = CONTRAST_MARKER_ALIASES[contrast[1] ?? ''] ?? []
    const subject = contrast[2]?.trim() ?? ''
    if (subject.length >= 2) {
      dynamicAliases.push(...modifierAliases)
      dynamicAliases.push(...modifierAliases.flatMap((modifier) => [`${modifier} ${subject}`, `${subject} ${modifier}`]))
    }
  }
  dynamicAliases.push(...dynamicAliases.flatMap(englishMorphologyAliases))
  dynamicAliases.push(...dynamicAliases.flatMap(chineseMorphologyAliases))
  return [...new Set(dynamicAliases
    .map((alias) => alias.trim())
    .filter((alias) => alias.length >= 2))]
}

function chineseMorphologyAliases(value: string): string[] {
  const term = value.trim()
  if (!/^[\p{Script=Han}]{3,}$/u.test(term)) return []
  const aliases: string[] = []
  if (/[度性化]$/u.test(term)) aliases.push(term.slice(0, -1))
  const analyticalSuffix = term.match(/^(.*?)(?:机制|结构|构成|分布|体系|制度|流程|规则|标准|框架|模式|规模|水平|能力|表现)$/u)?.[1]?.trim()
  if (analyticalSuffix && analyticalSuffix.length >= 2) aliases.push(analyticalSuffix)
  const unqualified = term.replace(/^(?:主要|核心|关键|整体|总体)/u, '').trim()
  if (unqualified.length >= 2 && unqualified !== term) aliases.push(unqualified)
  return [...new Set(aliases)]
}

function englishMorphologyAliases(value: string): string[] {
  const term = value.toLowerCase().trim()
  if (!/^[a-z][a-z-]{3,}$/u.test(term)) return []
  if (term.endsWith('ness') && term.length > 6) return [term.slice(0, -4)]
  if (term.endsWith('ation') && term.length > 7) {
    const stem = term.slice(0, -5)
    return [`re${term}`, `${stem}ate`]
  }
  if (term.endsWith('ity') && term.length > 6) return [term.slice(0, -3)]
  if (term.endsWith('ies') && term.length > 5) return [`${term.slice(0, -3)}y`]
  if (term.endsWith('s') && term.length > 4) return [term.slice(0, -1)]
  return []
}

const CONTRAST_MARKER_ALIASES: Record<string, string[]> = {
  强: ['strong'],
  弱: ['weak'],
  男: ['male', 'men'],
  女: ['female', 'women'],
  新: ['new'],
  旧: ['old'],
  高: ['high'],
  低: ['low'],
  正: ['positive'],
  反: ['negative'],
  内: ['internal'],
  外: ['external'],
  前: ['before'],
  后: ['after'],
  上: ['upper'],
  下: ['lower'],
  左: ['left'],
  右: ['right']
}

function addBilingualAlias(aliases: Map<string, string[]>, key: string, value: string): void {
  const values = aliases.get(key) ?? []
  if (!values.includes(value)) values.push(value)
  aliases.set(key, values)
}

export function researchSignalTerms(text: string): string[] {
  const expandedText = expandResearchAliases(normalizeResearchChineseScript(text))
  const latin = expandedText.match(/[A-Za-z0-9][A-Za-z0-9+#.&-]{1,}/g) ?? []
  const cjkRuns = expandedText.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const cjk = cjkRuns.flatMap(cjkSignalTerms)
  return [...new Set([...latin, ...cjk]
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !RESEARCH_SIGNAL_STOPWORDS.has(term.toLowerCase())))]
    .slice(0, 48)
}

function isNamedEntitySignal(signal: string, researchText: string): boolean {
  if (/^(?:[A-Z]{4,}|[A-Za-z]*[0-9][A-Za-z0-9+#.&-]*)$/.test(signal)) return true
  if (/[+#.&-]/.test(signal)) return true
  if (!/^[A-Z][a-z]{2,}$/.test(signal)) return false
  const escaped = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (researchText.match(new RegExp(`\\b${escaped}\\b`, 'g')) ?? []).length >= 2
}

function expandResearchAliases(text: string): string {
  const comparisonAliases = extractComparisonTargets(text).flatMap(comparisonTargetAliases)
  const contextAliases = [...bilingualAliases(text).entries()].flatMap(([key, values]) => [key, ...values])
  const expanded = [...new Set([...comparisonAliases, ...contextAliases])]
  return expanded.length > 0 ? `${expanded.join(' ')} ${text}` : text
}

function cjkSignalTerms(value: string): string[] {
  const cleaned = CJK_QUESTION_FILLERS.reduce((result, filler) => result.replaceAll(filler, ' '), value)
    .replace(/[的与和或及在于]/gu, ' ')
  const chunks = cleaned.split(/\s+/u).map((chunk) => chunk.trim()).filter((chunk) => chunk.length >= 2)
  const signals: string[] = []
  for (const chunk of chunks) {
    if (chunk.length <= 8) signals.push(chunk)
    for (const size of [3, 2]) {
      if (chunk.length < size) continue
      for (let index = 0; index <= chunk.length - size; index += 1) {
        signals.push(chunk.slice(index, index + size))
      }
    }
  }
  return signals.filter((signal) => !RESEARCH_SIGNAL_STOPWORDS.has(signal))
}

const CJK_QUESTION_FILLERS = [
  '当前', '哪些', '什么', '如何', '怎么', '是否', '有没有', '主要', '核心', '问题', '判断',
  '报告', '调研', '研究', '分析', '范围', '关键', '事实', '指标', '案例', '时间线', '支撑',
  '结论', '下一步', '应该', '理解', '基于', '以上', '证据', '主线', '维度',
  '是什么', '有哪些'
]

const RESEARCH_SIGNAL_STOPWORDS = new Set([
  'current', 'latest', 'research', 'report', 'analysis', 'question', 'evidence', 'source', 'data', 'compare', 'comparison',
  'http', 'https',
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'of', 'on', 'or',
  'that', 'the', 'their', 'this', 'to', 'versus', 'what', 'when', 'where', 'which', 'who', 'why', 'with',
  '当前', '用户', '个人', '报告', '调研', '研究', '分析', '问题', '判断', '关键', '事实', '证据', '结论', '维度',
  '主要', '核心', '范围', '哪些', '什么', '如何', '怎么', '是否', '应该', '需要', '差异', '优势', '风险'
])

export function normalizeSourceUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key)
    }
    url.pathname = url.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?\/docs\//i, '/docs/')
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return value.trim()
  }
}
