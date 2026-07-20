/**
 * [INPUT]: 依赖 ResearchTaskWorkerInput、FetchedSeedSource、中文书写体系归一和网页证据动态信号词
 * [OUTPUT]: 对外提供网页原文兜底的边界对齐聚焦选句、连接词悬空句补全、重复句折叠、成对概念分面、整词裁剪、残留块标签清洗、独立 UI 词清洗、归一化前 PDF 字形乱码/公告页头/免责声明/表格残片/数字截断/导航噪声判断、claim 文本和问题维度函数
 * [POS]: research/runtime 的网页兜底文本纯函数层，保留 HTML block 边界，在 Unicode 归一化前执行证据门；导航清洗只能删除独立 UI 词，不能改写逐小时、标准化、搜索策略等证据正文
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchTaskWorkerInput } from '../agents/types.js'
import { normalizeResearchChineseScript } from '../core/chinese-script.js'
import { isUsableEvidenceText, researchDimensionFocusGroups } from '../evidence/EvidenceEligibility.js'
import { repairDanglingExcerptText } from '../evidence/EvidenceStore.js'
import { normalizeWhitespace, type FetchedSeedSource } from './ResearchWebContent.js'
import {
  hasResearchSignal,
  keywordIndexes,
  researchEvidenceSignalKeywords
} from './ResearchWebEvidenceText.js'

export function primaryFocusAliases(question: string): string[] {
  return primaryFocusGroups(question).flat()
}

export function primaryFocusGroups(question: string): string[][] {
  return researchDimensionFocusGroups(question)
}

export function exactExcerptClaimText(evidenceText: string, input: ResearchTaskWorkerInput): string {
  const leadingClause = evidenceText
    .split(/\s+(?=当与|Header type|语法|规范|浏览器兼容性|示例)/u)[0]
    ?.trim() ?? ''
  if (leadingClause.length >= 18 && leadingClause.length <= 360) {
    return repairDanglingExcerptText(leadingClause, evidenceText)
  }
  const candidate = firstMeaningfulSentence(evidenceText, input).split(/\s+示例\b/u)[0]?.trim() ?? ''
  return repairDanglingExcerptText(candidate, evidenceText)
}

export function fallbackClaimText(
  source: FetchedSeedSource,
  dimension: string,
  evidenceText: string,
  input?: ResearchTaskWorkerInput
): string {
  const sentence = firstMeaningfulSentence(evidenceText, input)
  return `${dimension}：${sentence || `来源「${source.title}」提供了与本维度相关的可复核网页材料`}`
}

export function fallbackEvidenceDimension(
  _source: FetchedSeedSource,
  input: ResearchTaskWorkerInput,
  _evidenceText: string
): string {
  const question = input.task.questionIds
    .map((questionId) => input.frame.coreQuestions.find((candidate) => candidate.id === questionId))
    .find(Boolean)
  const basis = question?.text ?? input.task.objective
  return basis.replace(/[？?。.!！]+$/u, '').trim().slice(0, 48) || '当前研究问题'
}

export function selectRelevantFallbackExcerpt(source: FetchedSeedSource, input: ResearchTaskWorkerInput): string {
  const text = cleanFallbackSourceText(source.text)
  const sentences = splitFallbackSentences(text, input)
  const keywords = fallbackKeywords(source, input)
  const ranked = sentences
    .map((sentence, index) => ({ sentence: cleanFallbackSentence(sentence), index, score: scoreFallbackSentence(sentence, keywords) }))
    .filter((item) => item.sentence.length >= 20 && item.score > 0 && isInformativeFallbackSentence(item.sentence, input))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.sentence === item.sentence) === index)
    .slice(0, 3)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.sentence)
  const fallbackSentences = sentences
    .map(cleanFallbackSentence)
    .filter((sentence) => sentence.length >= 20 && !isFallbackBoilerplateSentence(sentence))
    .filter((sentence, index, items) => items.indexOf(sentence) === index)
    .slice(0, 3)
  const excerpt = ranked.length > 0 ? ranked.join('。') : fallbackSentences.join('。') || source.title
  return excerpt.slice(0, 1_200)
}

export function fallbackKeywords(source: FetchedSeedSource, input: ResearchTaskWorkerInput): string[] {
  return [
    ...researchEvidenceSignalKeywords(input),
    source.title,
    source.publisher,
    ...source.tags,
    input.brief.topic,
    input.frame.coreResearchThread,
    input.task.objective,
    ...input.task.searchHints
  ]
    .join(' ')
    .split(/[^\p{L}\p{N}+#&]+/u)
    .map((keyword) => keyword.trim().toLowerCase())
    .filter((keyword) => keyword.length >= 2)
}

export function scoreFallbackSentence(sentence: string, keywords: string[]): number {
  if (isFallbackBoilerplateSentence(sentence)) return -100
  const lower = normalizeResearchChineseScript(sentence).toLowerCase()
  let score = 0
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeResearchChineseScript(keyword).toLowerCase()
    if (lower.includes(normalizedKeyword)) score += normalizedKeyword.length > 4 ? 2 : 1
  }
  if (/[0-9]/.test(sentence)) score += 1
  return score
}

export function splitFallbackSentences(text: string, input?: ResearchTaskWorkerInput): string[] {
  const blocks = text.split(/\n+/u).map(normalizeWhitespace).filter(Boolean)
  const matches = blocks.flatMap((block) => block.match(/[^。！？.!?]{12,320}[。！？.!?]?/g) ?? [])
  return matches
    .flatMap((sentence) => expandFallbackSentenceWindows(sentence, input))
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function firstMeaningfulSentence(text: string, input?: ResearchTaskWorkerInput): string {
  const withoutPrefix = text.replace(/^来源：[^。]+。/u, '').trim()
  const sentences = splitFallbackSentences(withoutPrefix, input).map(cleanFallbackSentence).filter(Boolean)
  const candidate = sentences.find((sentence) => isInformativeFallbackSentence(sentence, input))
    ?? sentences.find((sentence) => !isFallbackBoilerplateSentence(sentence))
    ?? withoutPrefix.slice(0, 180)
  return cleanFallbackSentence(candidate)
}

export function cleanExtractedWebText(text: string): string {
  const cleaned = cleanFallbackSourceText(text)
    .replace(/^来源：[^。！？.!?]{0,140}[。！？.!?]?\s*/u, '')
    .replace(/^该来源可用于回答[^。！？.!?]{0,260}[。！？.!?]?\s*/u, '')
    .replace(/并服务于主线[:：][^。！？.!?]{0,260}[。！？.!?]?/u, '')
    .replace(/(?:Skip to main content|official website|Toggle navigation|Main navigation|Data by Topic|Data by Place|Data by Economic Account|Tools Intera)[^。！？.!?]{0,300}/gi, ' ')
    .replace(/(?:Organizational Chart|Data Communiqués|Legal Framework|Classifications & Methods|Latest Releases|International Cooperation|Understanding Statistics)[^。！？.!?]{0,300}/gi, ' ')
    .replace(/(?:Trade Agreements|Agreements on Reciprocal Trade|Free Trade Agreements|Trade & Inve)[^。！？.!?]{0,300}/gi, ' ')
    .replace(/(?:规范\s+规范|浏览器兼容性|帮助改进\s*MDN|此页面最后更新)[\s\S]*/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return truncateAtWordBoundary(cleaned, 500)
}

export function isUsefulWebEvidence(text: string, input?: ResearchTaskWorkerInput): boolean {
  const cleaned = cleanExtractedWebText(text)
  if (cleaned.length < 24 || isLowSignalWebText(cleaned)) return false
  return hasResearchSignal(cleaned, input)
}

export function isUsefulWebClaim(claimText: string, evidenceText: string, input?: ResearchTaskWorkerInput): boolean {
  const cleaned = cleanExtractedWebText(claimText)
  if (cleaned.length < 18 || isLowSignalWebText(cleaned)) return false
  const structuredText = /^[{[]/u.test(cleaned)
  if (!structuredText && hasUnbalancedQuotation(cleaned)) return false
  if (!structuredText && /^[a-z][a-z\s"'()-]{20,}/u.test(cleaned) && /[A-Z]/u.test(cleaned)) return false
  if (/来源「[^」]+」提供了?与本维度相关的可复核网页材料/.test(cleaned)) return false
  return hasResearchSignal(`${cleaned}\n${evidenceText}`, input)
}

function hasUnbalancedQuotation(value: string): boolean {
  const straightDoubleQuotes = (value.match(/"/gu) ?? []).length
  return straightDoubleQuotes % 2 !== 0
}

export function isLowSignalWebText(text: string): boolean {
  if (!isUsableEvidenceText(text)) return true
  const normalized = normalizeResearchChineseScript(text.replace(/\s+/g, ' ').trim())
  if (/^\/\//u.test(normalized)) return true
  if (/^[A-Za-z-]+:\s*(?:[A-Za-z-]+(?:=[^,\s]+)?\s*,\s*){2,}[A-Za-z-]+(?:=[^,\s]+)?$/u.test(normalized)) return true
  if (/(?:本报告|本文件|本资料).{0,40}(?:不得|不可|禁止).{0,140}(?:发放|发布|分发|传播)/u.test(normalized)) return true
  if (/\b(?:this report|this document)\b.{0,160}\b(?:may not|must not|cannot|should not)\b.{0,80}\b(?:distribut|publish|circulat)/iu.test(normalized)) return true
  if (/(?:19|20)\d{2}\s*年?\s+\d{1,2}\s*$/u.test(normalized)) return true
  if (/(?:占比|比例|rate|percent|%)[\s\S]{0,180}\d[\d,.]*\s+\d{1,2}\s*$/iu.test(normalized)) return true
  if (/(?:预计|预测|分别为|分别达到|\bforecast|\bexpected|\bprojected)[\s\S]{0,180}\d[\d,.]*\s+\d{1,2}\s*$/iu.test(normalized)) return true
  if (/浏览器不被支持|下载APP|下载客户端|登录 注册|媒体矩阵|爆料专线|-->/.test(normalized)) return true
  if (/Skip to main content|official website|Toggle navigation|Main navigation/i.test(normalized)) return true
  if (/Organizational Chart|Data Communiqués|Legal Framework|Classifications & Methods|Latest Releases|International Cooperation|Understanding Statistics/i.test(normalized)) return true
  return /Trade Agreements|Free Trade Agreements|Trade & Inve|email&#160;protected/i.test(normalized)
}

function isInformativeFallbackSentence(sentence: string, input?: ResearchTaskWorkerInput): boolean {
  return !isFallbackBoilerplateSentence(sentence) && hasResearchSignal(sentence, input)
}

export function cleanFallbackSentence(sentence: string): string {
  let cleaned = normalizeWhitespace(sentence)
    .replace(/^[\p{L}\p{N}]{1,2}["'’”\)\]}]+\s*/u, '')
    .replace(/-->+/g, ' ')
    .replace(/您的浏览器不被支持[^。！？.!?]*/gi, ' ')
    .replace(/请尽快升级到最新版下列浏览器[^。！？.!?]*/gi, ' ')
    .replace(/\b(?:Edge|Chrome|Firefox)\b/gi, ' ')
    .replace(/(?<![\p{L}\p{N}])字号\s*(?:超大|标准|小)(?![\p{L}\p{N}])/giu, ' ')
    .replace(/(?<![\p{L}\p{N}])(?:首页|登录|注册|下载客户端|下载APP|打开APP|搜索|媒体矩阵|爆料专线|个人中心|退出登录|RSS)(?![\p{L}\p{N}])/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (isFallbackBoilerplateSentence(cleaned)) {
    const useful = lastUsefulWindow(cleaned)
    if (useful) cleaned = useful
  }
  return truncateAtWordBoundary(cleaned.replace(/[。！？.!?]+$/u, '').trim(), 260)
}

function truncateAtWordBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const prefix = value.slice(0, maxChars + 1)
  const boundary = Math.max(
    prefix.lastIndexOf('。'), prefix.lastIndexOf('！'), prefix.lastIndexOf('？'),
    prefix.lastIndexOf('. '), prefix.lastIndexOf('! '), prefix.lastIndexOf('? '),
    prefix.lastIndexOf('；'), prefix.lastIndexOf('; '), prefix.lastIndexOf(' ')
  )
  return value.slice(0, boundary >= Math.floor(maxChars * 0.55) ? boundary + 1 : maxChars)
    .trim()
    .replace(/[。！？.!?；;]+$/u, '')
}

export function cleanFallbackSourceText(text: string): string {
  return stripResidualBlockMarkup(text).split(/\n+/u).map(normalizeWhitespace).filter(Boolean).join('\n')
    .replace(/^此页面由社区从英文翻译而来。?\s*(?:了解更多并加入 MDN Web Docs 社区。?\s*)?/u, '')
    .replace(/^View in English\s+Always switch to English\s*/iu, '')
    .replace(/^[^\s]{2,80}\s+基线\s+广泛可用.{0,260}?查看完整兼容性\s*/u, '')
    .replace(/您的浏览器不被支持[^。！？.!?]*/gi, ' ')
    .replace(/请尽快升级到最新版下列浏览器[^。！？.!?]*/gi, ' ')
    .replace(/\b(?:Edge|Chrome|Firefox)\b/gi, ' ')
    .replace(/(?<![\p{L}\p{N}])字号\s*(?:超大|标准|小)(?![\p{L}\p{N}])/giu, ' ')
    .replace(/(?<![\p{L}\p{N}])(?:首页|登录|注册|下载客户端|下载APP|打开APP|媒体矩阵|爆料专线|个人中心|退出登录|RSS)(?![\p{L}\p{N}])/giu, ' ')
}

function stripResidualBlockMarkup(text: string): string {
  return text
    .replace(/&lt;\/?(?:p|div|span|br|section|article|li|ul|ol|h[1-6])\b[^&]{0,240}?&gt;/giu, ' ')
    .replace(/<\/?(?:p|div|span|br|section|article|li|ul|ol|h[1-6])\b[^>]{0,240}>/giu, ' ')
    .replace(/&(?:nbsp|#160);/giu, ' ')
}

function isFallbackBoilerplateSentence(sentence: string): boolean {
  return /浏览器不被支持|Edge Chrome Firefox|打开APP|下载APP|下载客户端|首页|登录|注册|媒体矩阵|爆料专线|个人中心|退出登录|字号|RSS|快讯|视频|直播|专题|search menu|arrow_back|keyboard_arrow_right|规范\s+规范|浏览器兼容性|帮助改进\s*MDN|此页面最后更新|Header\s+type\s+(?:Response|Request|Representation)\s+header|Forbidden\s+request\s+header|Syntax\s+http|-->/i.test(sentence)
}

function expandFallbackSentenceWindows(sentence: string, input?: ResearchTaskWorkerInput): string[] {
  const cleaned = normalizeWhitespace(sentence)
  if (cleaned.length <= 220) return [cleaned]
  const windows = relevantTermWindows(cleaned, input)
  return windows.length > 0 ? windows : [cleaned.slice(0, 220)]
}

function relevantTermWindows(text: string, input?: ResearchTaskWorkerInput): string[] {
  const dynamicKeywords = input ? researchEvidenceSignalKeywords(input).filter((keyword) => keyword.length >= 3).slice(0, 16) : []
  const dynamicIndexes = dynamicKeywords.flatMap((keyword) => keywordIndexes(text, keyword)).slice(0, 8)
  return [...new Set(dynamicIndexes.map((index) => alignedContextWindow(text, index)))].slice(0, 4)
}

function alignedContextWindow(text: string, index: number): string {
  let start = Math.max(0, index - 50)
  let end = Math.min(text.length, index + 190)
  if (start > 0) {
    const nextBoundary = text.slice(start, Math.min(index, start + 60)).search(/[\s。！？.!?；;：:]/u)
    if (nextBoundary >= 0) start += nextBoundary + 1
  }
  if (end < text.length) {
    const tail = text.slice(Math.max(index, end - 60), end)
    const previousBoundary = Math.max(...[' ', '\n', '。', '！', '？', '.', '!', '?', '；', ';'].map((token) => tail.lastIndexOf(token)))
    if (previousBoundary >= 0) end = Math.max(index, end - tail.length + previousBoundary + 1)
  }
  return text.slice(start, end).trim()
}

function lastUsefulWindow(text: string): string {
  return relevantTermWindows(text).map((window) => window.trim()).filter(Boolean).at(-1) ?? ''
}
