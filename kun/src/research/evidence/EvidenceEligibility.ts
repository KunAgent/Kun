/**
 * [INPUT]: 依赖 evidence/types 的 SourceRecord 与 EvidenceSpan
 * [OUTPUT]: 对外提供来源、证据片段、强网页证据的可用性判断函数
 * [POS]: research/evidence 的证据准入门，统一 Gap、Citation 和 Verification 对强证据的口径
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { EvidenceSpan, SourceRecord } from './types.js'

const MIN_CITABLE_EVIDENCE_CHARS = 20
const MIN_STRONG_WEB_EVIDENCE_CHARS = 80

const FALLBACK_SOURCE_TAGS = new Set([
  'fallback_extracted',
  'fallback_structured',
  'fallback_text',
  'extraction_failed',
  'model_generated',
  'requires_external_verification'
])

const UNUSABLE_EVIDENCE_PATTERNS = [
  /this operation was aborted/i,
  /aborterror/i,
  /operation aborted/i,
  /fetch failed/i,
  /network error/i,
  /网页来源已抓取，但模型未能抽取结构化证据/u,
  /模型未能抽取结构化证据/u,
  /未能抽取/u,
  /抽取失败/u,
  /最终报告应避免从该片段过度推断/u
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
    !isModelFallbackSource(source) &&
    !isFallbackExtractedSource(source)
}

export function canCiteEvidenceSpan(span: EvidenceSpan | undefined, source: SourceRecord | undefined): boolean {
  if (!span || !source || !canCiteSource(source)) return false
  return isUsableEvidenceText(span.text, MIN_CITABLE_EVIDENCE_CHARS)
}

export function isEligibleEvidenceSource(source: SourceRecord, spans: EvidenceSpan[]): boolean {
  if (!canCiteSource(source)) return false
  return spans.some((span) => canCiteEvidenceSpan(span, source))
}

export function isEligibleStrongWebEvidence(source: SourceRecord, span: EvidenceSpan | undefined): boolean {
  if (!span || source.status !== 'fetched') return false
  if (source.kind !== 'web_strong' && !(
    source.sourceType === 'web' &&
    source.sourcePolicyTags.includes('web_fetch') &&
    source.sourcePolicyTags.includes('strong_web_evidence')
  )) {
    return false
  }
  if (!canCiteSource(source)) return false
  return isUsableEvidenceText(span.text, MIN_STRONG_WEB_EVIDENCE_CHARS)
}

export function isUsableEvidenceText(text: string, minChars = MIN_CITABLE_EVIDENCE_CHARS): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length < minChars) return false
  return !UNUSABLE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalized))
}
