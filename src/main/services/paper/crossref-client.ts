import { paperFetchText, PAPER_HTML_MAX_BYTES } from './paper-http'
import type { PaperFetchContext } from './arxiv-client'

/**
 * Crossref REST client: DOI → metadata (+ optional `mailto` politeness param)
 * and DOI → reference list. https://api.crossref.org/works/{doi}
 */

const CROSSREF_API = 'https://api.crossref.org/works'

export type CrossrefWorkMeta = {
  doi: string
  title: string
  authors: string[]
  year?: string
  venue?: string
  abstract?: string
  pdfUrl?: string
  arxivId?: string
}

export type CrossrefReference = {
  raw: string
  doi?: string
  title?: string
  authors?: string[]
  year?: string
  venue?: string
}

type CrossrefAuthor = { given?: string; family?: string; name?: string }

type CrossrefMessage = {
  DOI?: string
  title?: string[]
  author?: CrossrefAuthor[]
  issued?: { 'date-parts'?: number[][] }
  'container-title'?: string[]
  abstract?: string
  link?: { URL?: string; 'content-type'?: string }[]
  relation?: { 'is-preprint-of'?: { id?: string; 'id-type'?: string }[] }
  reference?: {
    key?: string
    DOI?: string
    'article-title'?: string
    author?: string
    year?: string
    'journal-title'?: string
    unstructured?: string
  }[]
}

function authorName(author: CrossrefAuthor): string {
  if (author.name) return author.name
  return [author.given, author.family].filter(Boolean).join(' ')
}

function stripJats(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function workUrl(doi: string, mailto?: string): string {
  const base = `${CROSSREF_API}/${encodeURIComponent(doi)}`
  return mailto ? `${base}?mailto=${encodeURIComponent(mailto)}` : base
}

/** arXiv DOIs minted by Crossref look like `10.48550/arXiv.2101.12345`. */
function arxivIdFromDoi(doi: string | undefined): string | undefined {
  const match = /^10\.48550\/arXiv\.(.+)$/i.exec(doi ?? '')
  return match?.[1]
}

export async function fetchCrossrefWork(
  doi: string,
  options: PaperFetchContext & { mailto?: string } = {}
): Promise<CrossrefWorkMeta | null> {
  const raw = await paperFetchText(workUrl(doi, options.mailto), {
    ...options,
    timeoutMs: options.timeoutMs ?? 15_000,
    maxBytes: PAPER_HTML_MAX_BYTES
  })
  const body = JSON.parse(raw) as { message?: CrossrefMessage }
  const message = body.message
  if (!message?.DOI) return null
  const links = message.link ?? []
  const pdfLink = links.find((link) => link['content-type']?.includes('pdf'))?.URL
  const preprintDoi = message.relation?.['is-preprint-of']?.find((r) => r['id-type'] === 'doi')?.id
  return {
    doi: message.DOI,
    title: message.title?.[0] ?? '',
    authors: (message.author ?? []).map(authorName).filter(Boolean),
    year: message.issued?.['date-parts']?.[0]?.[0]
      ? String(message.issued['date-parts'][0][0])
      : undefined,
    venue: message['container-title']?.[0] || undefined,
    abstract: message.abstract ? stripJats(message.abstract) : undefined,
    pdfUrl: pdfLink || undefined,
    arxivId: arxivIdFromDoi(message.DOI) ?? arxivIdFromDoi(preprintDoi)
  }
}

export async function fetchCrossrefReferences(
  doi: string,
  options: PaperFetchContext & { mailto?: string } = {}
): Promise<CrossrefReference[]> {
  const raw = await paperFetchText(workUrl(doi, options.mailto), {
    ...options,
    timeoutMs: options.timeoutMs ?? 20_000,
    maxBytes: 2 * PAPER_HTML_MAX_BYTES
  })
  const body = JSON.parse(raw) as { message?: CrossrefMessage }
  return (body.message?.reference ?? []).map((ref) => ({
    raw: ref.unstructured ?? ref['article-title'] ?? ref.key ?? '',
    doi: ref.DOI || undefined,
    title: ref['article-title'] || undefined,
    authors: ref.author ? [ref.author] : undefined,
    year: ref.year || undefined,
    venue: ref['journal-title'] || undefined
  })).filter((ref) => ref.raw || ref.title)
}
