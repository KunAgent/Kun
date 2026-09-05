import type { OfficeDocumentPreviewFormat } from '@shared/office-document'
import type { WriteSelectionSourceKind } from '../components/write/write-markdown-editor-types'
import type { WritePromptDisplayQuote } from './quoted-selection'

const WORK_REFERENCE_QUOTES_KIND = 'work-reference-quotes'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function quoteFromReferenceItem(item: unknown): WritePromptDisplayQuote | null {
  const raw = asRecord(item)
  if (!raw) return null
  const text = asString(raw.text)
  if (!text) return null
  const sourceTitle = asString(raw.sourceName) ?? asString(raw.sourceKind) ?? ''
  const sourceKind = asString(raw.sourceKind)
  const sourceFormat = asString(raw.sourceFormat)
  const lineStart = asFiniteNumber(raw.lineStart)
  const lineEnd = asFiniteNumber(raw.lineEnd)
  const pageStart = asFiniteNumber(raw.pageStart)
  const pageEnd = asFiniteNumber(raw.pageEnd)
  const slide = asFiniteNumber(raw.slide)
  const sheetName = asString(raw.sheetName)
  const cellRange = asString(raw.cellRange)
  const charCount = asFiniteNumber(raw.charCount)

  return {
    sourceTitle,
    text,
    ...(sourceKind ? { sourceKind: sourceKind as WriteSelectionSourceKind } : {}),
    ...(sourceFormat ? { sourceFormat: sourceFormat as OfficeDocumentPreviewFormat } : {}),
    ...(lineStart != null ? { lineStart } : {}),
    ...(lineEnd != null ? { lineEnd } : {}),
    ...(pageStart != null ? { pageStart } : {}),
    ...(pageEnd != null ? { pageEnd } : {}),
    ...(slide != null ? { slide } : {}),
    ...(sheetName ? { sheetName } : {}),
    ...(cellRange ? { cellRange } : {}),
    ...(charCount != null ? { charCount } : {})
  }
}

/**
 * Reads quoted user selections back out of a turn's composer contexts.
 *
 * Quoted passages travel through the `work-reference-quotes` composer context
 * attachment rather than being embedded in the user prompt text, so the
 * timeline has to inspect `meta.composerContexts` to show the user what was
 * actually quoted for a turn instead of silently folding it into the request.
 */
export function writePromptQuotesFromComposerContexts(
  composerContexts: readonly unknown[] | undefined
): WritePromptDisplayQuote[] {
  if (!composerContexts?.length) return []
  const quotes: WritePromptDisplayQuote[] = []
  for (const entry of composerContexts) {
    const record = asRecord(entry)
    if (!record) continue
    const reference = asRecord(record.reference)
    if (!reference || reference.kind !== WORK_REFERENCE_QUOTES_KIND) continue
    const list = reference.quotes
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const quote = quoteFromReferenceItem(item)
      if (quote) quotes.push(quote)
    }
  }
  return quotes
}
