/**
 * [INPUT]: 依赖模型返回的来源身份判断、已抓取网页正文和 EvidenceEligibility/WebEvidenceText 的通用文本校验
 * [OUTPUT]: 对外提供 applyVerifiedSourceAssessments，为正文可回查且 HTML 身份句同时绑定当前站点品牌的一手/权威来源添加高可信标签，并通过正文全称或动态首字母缩写确定性识别站点品牌与正式 PDF 发布主体一致的原始文档
 * [POS]: research/runtime 的来源身份校验边界；模型提出语义角色，程序要求 HTML 发布关系绑定当前站点，避免转载的第一人称原文冒充原始发布者；PDF 还要求主材料候选、站点品牌与正式发布正文三者一致，不维护机构、域名或题材名单
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { isSourceTitleOnlyText, isUsableEvidenceText } from '../evidence/EvidenceEligibility.js'
import { isExtractedEvidenceGroundedInSource } from './ResearchWebEvidenceText.js'
import type { FetchedSeedSource } from './ResearchWebContent.js'

type SourceAssessment = {
  sourceIndex?: unknown
  role?: unknown
  provenanceText?: unknown
  reason?: unknown
}

export function applyVerifiedSourceAssessments(
  value: unknown,
  sources: FetchedSeedSource[]
): FetchedSeedSource[] {
  const documentVerifiedSources = sources.map(applyVerifiedDocumentAuthority)
  if (!Array.isArray(value)) return documentVerifiedSources
  const verified = new Map<number, { tag: string; role: string; reason: string }>()
  for (const candidate of value.slice(0, documentVerifiedSources.length * 2)) {
    if (!candidate || typeof candidate !== 'object') continue
    const assessment = candidate as SourceAssessment
    const sourceIndex = numericSourceIndex(assessment.sourceIndex, documentVerifiedSources.length)
    const role = assessment.role === 'primary' || assessment.role === 'authoritative'
      ? assessment.role
      : undefined
    const provenanceText = typeof assessment.provenanceText === 'string'
      ? assessment.provenanceText.replace(/\s+/gu, ' ').trim()
      : ''
    if (!sourceIndex || !role || provenanceText.length < 24) continue
    const source = documentVerifiedSources[sourceIndex - 1]
    if (!source || source.tags.includes('search_content_fallback')) continue
    if (!isUsableEvidenceText(provenanceText, 24)) continue
    if (isSourceTitleOnlyText(provenanceText, source.title)) continue
    if (!isExtractedEvidenceGroundedInSource(provenanceText, source.text)) continue
    if (!provenanceIdentifiesCurrentPublisher(provenanceText, source)) continue
    const reason = typeof assessment.reason === 'string'
      ? assessment.reason.replace(/\s+/gu, ' ').trim().slice(0, 240)
      : ''
    verified.set(sourceIndex, {
      tag: role === 'primary' ? 'model_verified_primary_source' : 'model_verified_authoritative_source',
      role,
      reason
    })
  }
  if (verified.size === 0) return documentVerifiedSources
  return documentVerifiedSources.map((source, index) => {
    const assessment = verified.get(index + 1)
    if (!assessment) return source
    return {
      ...source,
      tags: [...new Set([...source.tags, assessment.tag])],
      reliabilityReason: [
        source.reliabilityReason,
        `抓取正文中的发布者身份依据已回查，来源角色判定为 ${assessment.role}。`,
        assessment.reason
      ].filter(Boolean).join(' ')
    }
  })
}

function applyVerifiedDocumentAuthority(source: FetchedSeedSource): FetchedSeedSource {
  const isPdf = /application\/pdf/iu.test(source.contentType ?? '') || /\.pdf(?:$|[?#])/iu.test(source.finalUrl)
  if (!isPdf || source.tags.includes('search_content_fallback') || !source.tags.includes('primary_material_candidate')) {
    return source
  }
  const identityTokens = publisherIdentityTokens(source)
  const rawDocumentLead = source.text.slice(0, 4_000)
  const documentLead = normalizeIdentityText(rawDocumentLead)
  const publisherIdentified = identityTokens.some((token) => documentLead.includes(token))
    || documentLeadContainsPublisherAcronym(rawDocumentLead, identityTokens)
  if (!publisherIdentified) return source
  const formalPublication = /(?:\b(?:official|final|audited|adopted|approved|peer[- ]reviewed)\b.{0,80}\b(?:report|publication|statement|standard|dataset|results?)\b|\b(?:board|committee|agency|institution|organization)\b.{0,180}\b(?:announce|publish|issue|adopt|approve)\b|(?:正式|最终|经审计|已通过|已批准|同行评审).{0,80}(?:报告|出版物|声明|标准|数据集|结果)|(?:委员会|机构|组织).{0,120}(?:宣布|公布|发布|通过|批准))/iu.test(source.text.slice(0, 6_000))
    || /(?:rules?|regulations?|standards?|specifications?|annual\s+reports?|statistical\s+(?:report|release)|规则|条例|标准|规范|年度报告|统计报告)/iu.test(`${source.title}\n${rawDocumentLead.slice(0, 800)}`)
  if (!formalPublication) return source
  return {
    ...source,
    tags: [...new Set([...source.tags, 'document_verified_primary_source'])],
    reliabilityReason: `${source.reliabilityReason} PDF 正文中的正式发布主体与当前站点品牌一致，已按原始文档核验。`
  }
}

function provenanceIdentifiesCurrentPublisher(text: string, source: FetchedSeedSource): boolean {
  if (/application\/pdf/iu.test(source.contentType ?? '') || source.tags.includes('linked_document')) return true
  if (!/(?:\b(?:publish(?:ed|es|ing)?|issu(?:ed|es|ing)|maintain(?:ed|s|ing)?|operat(?:ed|es|ing)|own(?:ed|s|ing)?|copyright|official(?:\s+[\p{L}-]+){0,3}\s+(?:page|site|website))\b|发布|发行|签发|维护|运营|主办|版权所有|官方网站|官网)/iu.test(text)) {
    return false
  }
  const normalizedText = normalizeIdentityText(text)
  return publisherIdentityTokens(source).some((token) => normalizedText.includes(token))
}

function publisherIdentityTokens(source: FetchedSeedSource): string[] {
  const genericTokens = new Set([
    'www', 'dev', 'data', 'market', 'markets', 'news', 'docs', 'document', 'documents',
    'report', 'reports', 'file', 'files', 'asset', 'assets', 'static', 'cdn', 'prod', 'out', 'res',
    'com', 'org', 'net', 'co', 'cn', 'hk', 'html', 'english', 'global', 'official', 'website'
  ])
  let host = ''
  try {
    host = new URL(source.finalUrl).hostname.replace(/^www\./iu, '')
  } catch {
    host = ''
  }
  const titlePublisher = source.title.includes('|') ? source.title.split('|').slice(1).join(' ') : ''
  return [...new Set([host, titlePublisher]
    .flatMap((value) => value.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map(normalizeIdentityText)
    .filter((token) => token.length >= 3 && !genericTokens.has(token)))]
}

function documentLeadContainsPublisherAcronym(text: string, identityTokens: string[]): boolean {
  const stopwords = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'the', 'to', 'with'])
  const words = (text.match(/[A-Za-z][A-Za-z-]*/gu) ?? [])
    .map((word) => word.toLowerCase())
    .filter((word) => !stopwords.has(word))
    .slice(0, 160)
  const acronyms = new Set<string>()
  for (let start = 0; start < words.length; start += 1) {
    let acronym = ''
    for (let end = start; end < Math.min(words.length, start + 8); end += 1) {
      acronym += words[end]?.[0] ?? ''
      if (acronym.length >= 2) acronyms.add(acronym)
    }
  }
  return identityTokens.some((token) => token.length >= 2 && token.length <= 8 && acronyms.has(token))
}

function normalizeIdentityText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function numericSourceIndex(value: unknown, sourceCount: number): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= sourceCount ? parsed : undefined
}
