/**
 * arXiv client: export-API metadata, PDF download, LaTeXML HTML figure
 * scraping, and e-print fetching. Export API calls are spaced at least 3s
 * apart per arXiv's usage policy; everything is https + size-capped through
 * `paper-http`.
 */
import { gunzipSync } from 'node:zlib'
import type { PaperFigureSource } from '../../../shared/paper/paper-types'
import {
  PAPER_EPRINT_MAX_BYTES,
  PAPER_HTML_MAX_BYTES,
  PAPER_PDF_MAX_BYTES,
  PaperFetchError,
  paperFetchBytes,
  paperFetchText
} from './paper-http'
import { decodeEntities, stripTags } from './coolpapers-client'

const ARXIV_EXPORT_API_MIN_GAP_MS = 3_100
const ARXIV_EXPORT_TIMEOUT_MS = 30_000
const ARXIV_DOWNLOAD_TIMEOUT_MS = 120_000

let lastArxivExportRequestAt = 0

export type PaperFetchContext = {
  signal?: AbortSignal
  proxyUrl?: string
}

async function spacedExportFetch(url: string, options: PaperFetchContext): Promise<string> {
  const wait = ARXIV_EXPORT_API_MIN_GAP_MS - (Date.now() - lastArxivExportRequestAt)
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  try {
    return await paperFetchText(url, {
      signal: options.signal,
      timeoutMs: ARXIV_EXPORT_TIMEOUT_MS,
      maxBytes: PAPER_HTML_MAX_BYTES,
      proxyUrl: options.proxyUrl
    })
  } finally {
    lastArxivExportRequestAt = Date.now()
  }
}

export type ArxivPaperMeta = {
  arxivId: string
  title: string
  authors: string[]
  abstract?: string
  year?: string
  doi?: string
  pdfUrl: string
  sourceUrl: string
}

function xmlTagText(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
  if (!m) return undefined
  const text = decodeEntities(stripTags(m[1])).trim()
  return text || undefined
}

/** Parse the first `<entry>` of an export-API Atom response. */
export function parseArxivAtomEntry(xml: string): Omit<ArxivPaperMeta, 'arxivId' | 'pdfUrl' | 'sourceUrl'> | null {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1]
  if (!entry) return null
  const title = xmlTagText(entry, 'title')?.replace(/\s+/g, ' ').trim()
  if (!title) return null
  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)]
    .map((m) => decodeEntities(stripTags(m[1])).trim())
    .filter(Boolean)
  const published = xmlTagText(entry, 'published')
  return {
    title,
    authors,
    abstract: xmlTagText(entry, 'summary')?.replace(/\s+/g, ' ').trim(),
    year: published?.slice(0, 4),
    doi: xmlTagText(entry, 'arxiv:doi')
  }
}

/** Returns null when the export API has no entry for the id. */
export async function fetchArxivMeta(
  arxivId: string,
  options: PaperFetchContext = {}
): Promise<ArxivPaperMeta | null> {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`
  const xml = await spacedExportFetch(url, options)
  const parsed = parseArxivAtomEntry(xml)
  if (!parsed) return null
  return {
    arxivId,
    ...parsed,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    sourceUrl: `https://arxiv.org/abs/${arxivId}`
  }
}

export async function downloadArxivPdf(arxivId: string, options: PaperFetchContext = {}): Promise<Buffer> {
  return paperFetchBytes(`https://arxiv.org/pdf/${arxivId}`, {
    signal: options.signal,
    timeoutMs: ARXIV_DOWNLOAD_TIMEOUT_MS,
    maxBytes: PAPER_PDF_MAX_BYTES,
    expectPdf: true,
    proxyUrl: options.proxyUrl
  })
}

export async function downloadArxivPdfFromUrl(pdfUrl: string, options: PaperFetchContext = {}): Promise<Buffer> {
  return paperFetchBytes(pdfUrl, {
    signal: options.signal,
    timeoutMs: ARXIV_DOWNLOAD_TIMEOUT_MS,
    maxBytes: PAPER_PDF_MAX_BYTES,
    expectPdf: true,
    allowAnyHost: true,
    proxyUrl: options.proxyUrl
  })
}

export type ArxivEprintPayload =
  | { kind: 'tar-gz'; data: Buffer }
  | { kind: 'gz'; data: Buffer }
  | { kind: 'pdf'; data: Buffer }

/** e-print payloads arrive as a tar.gz bundle, a single gzipped .tex, or bare PDF. */
export async function downloadArxivEprint(
  arxivId: string,
  options: PaperFetchContext = {}
): Promise<ArxivEprintPayload | null> {
  let data: Buffer
  try {
    data = await paperFetchBytes(`https://arxiv.org/e-print/${arxivId}`, {
      signal: options.signal,
      timeoutMs: ARXIV_DOWNLOAD_TIMEOUT_MS,
      maxBytes: PAPER_EPRINT_MAX_BYTES,
      proxyUrl: options.proxyUrl
    })
  } catch (error) {
    if (error instanceof PaperFetchError && error.status === 404) return null
    throw error
  }
  if (!data.length) return null
  if (data.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) return { kind: 'pdf', data }
  if (data[0] === 0x1f && data[1] === 0x8b) {
    const inflated = gunzipSync(data)
    // tar archives carry the `ustar` magic at offset 257.
    if (inflated.length > 262 && inflated.subarray(257, 262).toString('ascii') === 'ustar') {
      return { kind: 'tar-gz', data }
    }
    return { kind: 'gz', data: inflated }
  }
  return null
}

// ---- LaTeXML HTML figures -------------------------------------------------

export type ArxivHtmlFigure = {
  label: string
  caption: string
  /** Image URL resolved against the html page. */
  imgUrl: string
}

function firstFigureTagEnd(html: string, start: number): number {
  // Match the outermost <figure> … </figure>, counting nested figures
  // (LaTeXML nests subfigures inside the enclosing figure block).
  let depth = 0
  const re = /<\/?figure\b[^>]*>/g
  re.lastIndex = start
  for (;;) {
    const m = re.exec(html)
    if (!m) return -1
    if (m[0].startsWith('</')) {
      depth -= 1
      if (depth === 0) return re.lastIndex
    } else {
      depth += 1
    }
  }
}

/**
 * Parse `figure.ltx_figure` blocks from an arXiv HTML page. Each outermost
 * figure contributes every `<img>` it contains (subfigure groups become
 * letter-suffixed entries) and the caption of its last `<figcaption>`.
 */
export function parseArxivHtmlFigures(html: string, pageUrl: string): ArxivHtmlFigure[] {
  const out: ArxivHtmlFigure[] = []
  const re = /<figure\b[^>]*class="[^"]*\bltx_figure\b[^"]*"[^>]*>/g
  let figureIndex = 0
  for (;;) {
    const m = re.exec(html)
    if (!m) break
    const blockEnd = firstFigureTagEnd(html, m.index)
    if (blockEnd < 0) break
    const block = html.slice(m.index, blockEnd)
    re.lastIndex = blockEnd
    figureIndex += 1

    const captions = [...block.matchAll(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/g)]
    const captionHtml = captions.at(-1)?.[1] ?? ''
    const tagText = captionHtml.match(/<[^>]*ltx_tag_figure[^>]*>([\s\S]*?)<\/[^>]*>/)?.[1]
    const label = decodeEntities(stripTags(tagText ?? '')).trim().replace(/[.:：]\s*$/, '')
    const caption = decodeEntities(stripTags(captionHtml)).trim().replace(/\s+/g, ' ')

    const imgs = [...block.matchAll(/<img\b[^>]*src="([^"]+)"[^>]*>/g)]
    imgs.forEach((img, i) => {
      const src = img[1]
      if (!src || src.startsWith('data:')) return
      const resolved = new URL(src, pageUrl).toString()
      const suffix = imgs.length > 1 ? String.fromCharCode(97 + i) : ''
      out.push({
        label: label || `Figure ${figureIndex}${suffix}`,
        caption,
        imgUrl: resolved
      })
    })
  }
  return out
}

/** Fetch the LaTeXML HTML page when it exists (older papers may not have one). */
export async function fetchArxivHtmlPage(
  arxivId: string,
  options: PaperFetchContext = {}
): Promise<string | null> {
  try {
    return await paperFetchText(`https://arxiv.org/html/${arxivId}`, {
      signal: options.signal,
      timeoutMs: 60_000,
      maxBytes: PAPER_HTML_MAX_BYTES,
      proxyUrl: options.proxyUrl
    })
  } catch (error) {
    if (error instanceof PaperFetchError && error.status === 404) return null
    throw error
  }
}

export const ARXIV_FIGURE_SOURCE: PaperFigureSource = 'arxiv-html'
