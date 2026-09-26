import type { PaperSourceConnector, PaperSourceHit } from './paper-search-types.js'
import { PaperSourceHttpError } from './paper-search-api-sources.js'
import { cleanText, decodeEntities, inYearRange, normalizeArxivId, yearOf } from './paper-search-text.js'

/**
 * papers.cool search pages: `/arxiv/search` (arXiv with abstracts) and
 * `/venue/search` (accepted conference papers, e.g. ICLR/NeurIPS/ACL). Both
 * render the same `panel paper` cards.
 */

type CoolBranch = 'arxiv' | 'venue'

function panelHit(branch: CoolBranch, id: string, block: string): PaperSourceHit | null {
  const titleMatch = block.match(/<a[^>]*class="title-link[^"]*"[^>]*>([\s\S]*?)<\/a>/)
  const title = titleMatch ? cleanText(titleMatch[1]) : ''
  if (!title) return null
  const authors = [...block.matchAll(/<a[^>]*class="author[^"]*"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => cleanText(m[1]))
    .filter(Boolean)
  const summary = block.match(/<p[^>]*class="summary[^"]*"[^>]*>([\s\S]*?)<\/p>/)
  const pdf = block.match(/<a[^>]*class="title-pdf[^"]*"[^>]*\sdata="([^"]+)"/)
  const forum = block.match(/<h2 class="title">\s*<a href="([^"]+)"/)
  const subject = block.match(/<a[^>]*class="subject-[^"]*"[^>]*>([\s\S]*?)<\/a>/)
  const subjectText = subject ? cleanText(subject[1]) : ''
  const pdfUrl = pdf ? decodeEntities(pdf[1]) : undefined
  const forumUrl = forum ? decodeEntities(forum[1]) : undefined
  if (branch === 'arxiv') {
    const arxivId = normalizeArxivId(id)
    if (!arxivId) return null
    return {
      title,
      authors,
      abstract: summary ? cleanText(summary[1]) || undefined : undefined,
      year: yearOf(`20${arxivId.slice(0, 2)}`),
      arxivId,
      url: `https://arxiv.org/abs/${arxivId}`,
      pdfUrl: pdfUrl ?? `https://arxiv.org/pdf/${arxivId}`
    }
  }
  // Venue subjects read "ICLR.2025 - Oral"; keep the edition as the venue.
  const edition = subjectText.split(' - ')[0]?.trim() || undefined
  return {
    title,
    authors,
    abstract: summary ? cleanText(summary[1]) || undefined : undefined,
    year: yearOf(edition),
    venue: subjectText || undefined,
    coolId: id,
    url: forumUrl && /^https?:\/\//.test(forumUrl) ? forumUrl : `https://papers.cool/venue/${id}`,
    ...(pdfUrl && /^https?:\/\//.test(pdfUrl) ? { pdfUrl } : {})
  }
}

export function parseCoolSearchPage(branch: CoolBranch, html: string): PaperSourceHit[] {
  const starts = [...html.matchAll(/<div id="([^"]+)" class="panel paper"/g)]
  const hits: PaperSourceHit[] = []
  starts.forEach((match, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].index : html.length
    const hit = panelHit(branch, decodeEntities(match[1]), html.slice(match.index, end))
    if (hit) hits.push(hit)
  })
  return hits
}

function coolConnector(branch: CoolBranch): PaperSourceConnector {
  return async (q, { fetch, signal }) => {
    const query = q.query.replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim()
    if (!query) return []
    const response = await fetch(
      `https://papers.cool/${branch}/search?query=${encodeURIComponent(query)}`,
      { signal }
    )
    if (!response.ok) throw new PaperSourceHttpError(response.status, `HTTP ${response.status}`)
    const hits = parseCoolSearchPage(branch, await response.text())
    return hits
      .filter((hit) => (q.yearFrom === undefined && q.yearTo === undefined) || inYearRange(hit.year, q.yearFrom, q.yearTo))
      .slice(0, q.limit)
  }
}

export const searchCoolArxiv = coolConnector('arxiv')
export const searchCoolVenues = coolConnector('venue')
