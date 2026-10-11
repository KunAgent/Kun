import { loadPdfJs } from '../write-pdf-text-service'
import type { PaperVersionSnapshot } from '../../../shared/paper/paper-evidence-types'
import { parseArxivId } from '../../../shared/paper/paper-ids'
import { PaperEvidenceError } from './paper-evidence-store'

export type EvidencePdfText = { pageCount: number; pages: { page: number; text: string }[]; truncated: boolean }

/** Parse the same bytes that were hashed, bypassing path/mtime caches and model/OCR calls. */
export async function extractEvidencePdfText(bytes: Buffer, selectedPage?: number): Promise<EvidencePdfText> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true,
    disableWorker: true, isEvalSupported: false, useSystemFonts: false } as unknown)
  try {
    const document = await task.promise
    const pageCount = document.numPages
    if (selectedPage && selectedPage > pageCount) throw new PaperEvidenceError('stale-anchor', 'The mark page is outside the current PDF.')
    const numbers = selectedPage ? [...new Set([1, selectedPage])]
      : Array.from({ length: Math.min(300, pageCount) }, (_, index) => index + 1)
    const pages: EvidencePdfText['pages'] = []
    let remaining = 1_000_000
    let truncated = !selectedPage && pageCount > numbers.length
    for (const number of numbers) {
      const page = await document.getPage(number)
      try {
        const content = await page.getTextContent()
        const full = content.items.map((item) => 'str' in item ? item.str : '').join(' ').trim()
        const text = full.slice(0, remaining)
        remaining -= text.length
        if (text.length < full.length) truncated = true
        pages.push({ page: number, text })
      } finally { page.cleanup() }
      if (!remaining) { truncated = true; break }
    }
    return { pageCount, pages, truncated }
  } finally { await task.destroy() }
}

/** A version belongs to the actual PDF only when its own arXiv stamp identifies it. */
export function withPaperArxivVersion(snapshot: PaperVersionSnapshot, firstPageText: string): PaperVersionSnapshot {
  const match = firstPageText.match(/arxiv\s*:\s*((?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7}))(v[1-9]\d*)\b/i)
  if (!match || snapshot.canonicalId !== `arxiv:${parseArxivId(match[1])}`) return snapshot
  return { ...snapshot, arxivVersion: match[2].toLowerCase() }
}
