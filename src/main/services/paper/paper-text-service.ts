/**
 * Derives `paper.md` from the unit PDF through the existing pdfjs+OCR text
 * pipeline. Pages are marked with `<!-- page N -->` comments so the agent and
 * the UI can cite `[p.N](<pdf>#page=N)` anchors. The References section is
 * truncated with a marker when nothing follows it (appendices stay).
 */
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { readLocalPdfText } from '../write-pdf-text-service'
import { PAPER_TEXT_FILE_NAME } from '../../../shared/paper/paper-types'
import type { PaperUnitMeta } from '../../../shared/paper/paper-types'

const REFERENCES_HEADING = /\b(References|Bibliography|参考文献)\b/
const AFTER_REFERENCES = /\b(Appendix|Appendices|Supplementary|Acknowledg)/i

/**
 * Writes `<unitDir>/paper.md`. Returns 'ok' when any page text was extracted
 * (including OCR), 'failed' otherwise.
 */
export async function generatePaperText(unitDirAbs: string, meta: PaperUnitMeta): Promise<'ok' | 'failed'> {
  // Metadata-only units (v2, no pdfFile) have nothing to extract.
  if (!meta.pdfFile) return 'failed'
  const pdfPath = join(unitDirAbs, meta.pdfFile)
  const result = await readLocalPdfText({ path: pdfPath })
  if (!result.ok || !result.hasText) return 'failed'

  const parts: string[] = []
  let referencesSeen = false
  for (const page of result.pages) {
    const text = page.text.trim()
    if (!text) continue
    parts.push(`<!-- page ${page.page} -->`)
    if (!referencesSeen && REFERENCES_HEADING.test(text)) {
      const at = text.search(REFERENCES_HEADING)
      const tail = text.slice(at)
      if (!AFTER_REFERENCES.test(tail)) {
        parts.push(text.slice(0, at).trim())
        parts.push('<!-- references section truncated -->')
        referencesSeen = true
        continue
      }
    }
    parts.push(text)
    parts.push('')
  }

  if (!parts.length) return 'failed'
  await writeFile(join(unitDirAbs, PAPER_TEXT_FILE_NAME), `${parts.join('\n\n')}\n`, 'utf8')
  return 'ok'
}
