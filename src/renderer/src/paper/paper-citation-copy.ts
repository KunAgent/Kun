/**
 * R3.2 「复制引用」: clipboard Markdown for highlights / region marks.
 *
 *   > 原文引用文字
 *   > —— 《论文标题》 [p.12](papers/1706.03762/1706.03762.pdf#page=12)
 *   注：批注
 *
 * The `#page=N` suffix matches the existing PDF deep-link behavior.
 */

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function paperTitleForCitation(title: string, unitDir: string): string {
  const trimmed = title.trim()
  if (trimmed) return trimmed
  const slug = unitDir.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop()
  return slug || unitDir
}

export function paperCitationMarkdown(input: {
  quote: string
  title: string
  page: number
  /** Unit dir relative to the workspace, e.g. `papers/1706.03762`. */
  unitDir: string
  /** PDF file name inside the unit; defaults to `<slug>.pdf`. */
  pdfFile?: string
  comment?: string
}): string {
  const unit = input.unitDir.replace(/\\/g, '/').replace(/\/+$/, '')
  const slug = unit.split('/').pop() ?? 'paper'
  const pdfFile = input.pdfFile?.trim() || `${slug}.pdf`
  const title = paperTitleForCitation(input.title, input.unitDir)
  const link = `${unit}/${encodeURIComponent(pdfFile)}#page=${input.page}`
  const quote = collapseWhitespace(input.quote)
  const lines: string[] = []
  if (quote) lines.push(`> ${quote}`)
  lines.push(`> —— 《${title}》 [p.${input.page}](${link})`)
  const comment = collapseWhitespace(input.comment ?? '')
  if (comment) lines.push(`注：${comment}`)
  return lines.join('\n')
}
