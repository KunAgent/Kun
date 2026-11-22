import { replaceRichAnnotation } from './rich-replacement'

type Target = { richText?: boolean; from: number; to: number; blockEnd: number }
type Suggestion = { kind: 'replace' | 'insertAfter'; text: string }

/** Both editor surfaces review the same canonical Markdown, preserving surrounding bytes. */
export function annotationProposal(source: string, target: Target, suggestion: Suggestion): string | null {
  const { from, to, blockEnd } = target
  if (from < 0 || from >= to || to > source.length || !suggestion.text.trim()) return null
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const replacement = suggestion.text.replace(/\r?\n/g, eol)
  if (suggestion.kind === 'replace') {
    if (target.richText) return replaceRichAnnotation(source, target, replacement)
    const next = source.slice(0, from) + replacement + source.slice(to)
    return next === source ? null : next
  }
  if (blockEnd < to || blockEnd > source.length) return null
  const before = source.slice(0, blockEnd)
  const after = source.slice(blockEnd)
  const separator = eol + eol
  const left = before.endsWith(separator) ? '' : before.endsWith(eol) ? eol : separator
  const right = !after.trim() || after.startsWith(separator) ? '' : after.startsWith(eol) ? eol : separator
  return before + left + replacement.trim() + right + after
}
