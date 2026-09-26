import type { PaperSourceConnector, PaperSourceHit } from './paper-search-types.js'
import { PaperSourceHttpError } from './paper-search-api-sources.js'
import { cleanText, decodeEntities, normalizeDoi, yearOf } from './paper-search-text.js'

/**
 * NCBI E-utilities connector: `esearch` resolves PMIDs, `efetch` returns the
 * PubMed XML records. Raw PubMed query syntax (Boolean operators, field tags
 * like `title[ti]`, `MeSH`) is passed through unchanged.
 */

function xmlTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return m ? cleanText(m[1]) : undefined
}

export function parsePubmedEfetch(xml: string): PaperSourceHit[] {
  const hits: PaperSourceHit[] = []
  for (const match of xml.matchAll(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g)) {
    const article = match[0]
    const title = xmlTag(article, 'ArticleTitle')
    if (!title) continue
    const pmid = xmlTag(article, 'PMID')
    const doi = normalizeDoi(
      article.match(/<ELocationID[^>]*EIdType="doi"[^>]*>([\s\S]*?)<\/ELocationID>/)?.[1]
        ?? article.match(/<ArticleId[^>]*IdType="doi"[^>]*>([\s\S]*?)<\/ArticleId>/)?.[1]
    )
    const abstractParts = [...article.matchAll(/<AbstractText(?:\s[^>]*)?>([\s\S]*?)<\/AbstractText>/g)]
      .map((m) => cleanText(m[1]))
      .filter(Boolean)
    const authors: string[] = []
    for (const author of article.matchAll(/<Author[\s>][\s\S]*?<\/Author>/g)) {
      const block = author[0]
      const collective = xmlTag(block, 'CollectiveName')
      if (collective) {
        authors.push(collective)
        continue
      }
      const name = [xmlTag(block, 'ForeName'), xmlTag(block, 'LastName')].filter(Boolean).join(' ')
      if (name) authors.push(name)
    }
    const year = yearOf(xmlTag(article, 'PubDate'))
    const journal = xmlTag(article, 'Title')
    hits.push({
      title,
      authors,
      abstract: abstractParts.join(' ') || undefined,
      year,
      venue: journal,
      doi,
      url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined
    })
  }
  return hits
}

export function parsePubmedEsearchIds(body: unknown): string[] {
  const list = (body as { esearchresult?: { idlist?: unknown } } | undefined)?.esearchresult?.idlist
  return Array.isArray(list) ? list.map((id) => String(id)) : []
}

async function getJson<T>(
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>,
  url: string,
  signal: AbortSignal | undefined
): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    const hint = response.status === 429 ? ' (rate limited)' : ''
    throw new PaperSourceHttpError(response.status, `HTTP ${response.status}${hint}`)
  }
  return (await response.json()) as T
}

async function getText(
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>,
  url: string,
  signal: AbortSignal | undefined
): Promise<string> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    const hint = response.status === 429 ? ' (rate limited)' : ''
    throw new PaperSourceHttpError(response.status, `HTTP ${response.status}${hint}`)
  }
  return decodeEntities(await response.text())
}

export const searchPubMed: PaperSourceConnector = async (q, { fetch, signal }) => {
  const term = q.query.trim()
  if (!term) return []
  const params = new URLSearchParams({
    db: 'pubmed',
    term,
    retmax: String(q.limit),
    retmode: 'json',
    sort: 'relevance'
  })
  if (q.yearFrom !== undefined || q.yearTo !== undefined) {
    params.set('datetype', 'pdat')
    params.set('mindate', String(q.yearFrom ?? 1800))
    params.set('maxdate', String(q.yearTo ?? 2100))
  }
  const ids = parsePubmedEsearchIds(
    await getJson(fetch, `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`, signal)
  )
  if (ids.length === 0) return []
  const xml = await getText(
    fetch,
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${ids.join(',')}&retmode=xml`,
    signal
  )
  return parsePubmedEfetch(xml).slice(0, q.limit)
}
