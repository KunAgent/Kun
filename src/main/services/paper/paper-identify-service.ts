import { readFile } from 'node:fs/promises'
import { loadPdfJs, readLocalPdfText } from '../write-pdf-text-service'

/**
 * Local-PDF identification (plan §6.4): pull DOI / arXiv id / a title
 * candidate out of the first pages so an imported local PDF can auto-fill its
 * metadata. Uncertain results set `needsReview` in the caller, not here.
 */

const DOI_RE = /\b10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]+\b/g
const ARXIV_RE = /\barXiv[:\s]?(\d{4}\.\d{4,5})(v\d+)?\b|(?<![\w.])(\d{4}\.\d{4,5})(v\d+)?(?![\w.])/g
const DOI_TRAILING = /[.,;\])}>'"’”]+$/

const IDENTIFY_PAGES = 2
const TITLE_MIN_FONT_SIZE = 12

export type PaperIdentifyResult = {
  doi?: string
  arxivId?: string
  titleGuess?: string
}

function cleanDoi(raw: string): string {
  let doi = raw.replace(DOI_TRAILING, '')
  // A trailing 'v2'-style version marker or stray 'pdf' suffix is not part of the DOI.
  doi = doi.replace(/\.pdf$/i, '')
  return doi
}

export function extractIdsFromText(text: string): { doi?: string; arxivId?: string } {
  const doiMatch = DOI_RE.exec(text)
  DOI_RE.lastIndex = 0
  const doi = doiMatch ? cleanDoi(doiMatch[0]) : undefined
  let arxivId: string | undefined
  for (const match of text.matchAll(ARXIV_RE)) {
    const id = match[1] ?? match[3]
    if (id) {
      arxivId = id
      break
    }
  }
  return { doi, arxivId }
}

/** Largest-font line on page 1 is the best cheap title candidate. */
async function guessTitleFromPdf(data: Uint8Array): Promise<string | undefined> {
  try {
    const pdfjs = await loadPdfJs()
    const document = await pdfjs.getDocument({
      data,
      disableFontFace: true,
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: false
    } as unknown).promise
    try {
      if (document.numPages < 1) return undefined
      const page = await document.getPage(1)
      try {
        const content = await page.getTextContent()
        let best = ''
        let bestSize = 0
        for (const raw of content.items) {
          const item = raw as { str?: string; transform?: number[] }
          const str = typeof item.str === 'string' ? item.str.trim() : ''
          if (str.length < 8) continue
          const size = Math.abs(item.transform?.[3] ?? 0)
          if (size >= TITLE_MIN_FONT_SIZE && size > bestSize && str.length <= 300) {
            best = str
            bestSize = size
          }
        }
        return best || undefined
      } finally {
        page.cleanup()
      }
    } finally {
      await document.destroy()
    }
  } catch {
    return undefined
  }
}

export async function identifyLocalPdf(path: string): Promise<PaperIdentifyResult> {
  const out: PaperIdentifyResult = {}
  const textResult = await readLocalPdfText({ path })
  if (textResult.ok) {
    const head = textResult.pages
      .filter((page) => page.page <= IDENTIFY_PAGES)
      .map((page) => page.text)
      .join('\n')
    const ids = extractIdsFromText(head)
    out.doi = ids.doi
    out.arxivId = ids.arxivId
  }
  try {
    const bytes = await readFile(path)
    out.titleGuess = await guessTitleFromPdf(new Uint8Array(bytes))
  } catch {
    // Title guess is best-effort; id extraction already ran.
  }
  return out
}
