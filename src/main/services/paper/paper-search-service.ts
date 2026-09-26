import { app } from 'electron'
import { fetchWithOptionalProxy } from '../../proxy-fetch'
import { runPaperSearch } from '../../../../kun/src/services/paper-search/paper-search'
import type { PaperSearchResult, PaperSearchSource } from '../../../shared/paper/paper-search'
import type { PaperFetchContext } from './arxiv-client'

/**
 * GUI paper-search page backend: runs the Kun multi-source search engine in
 * the main process through the app proxy so results match what the
 * `paper_search` agent tool sees.
 */

function userAgent(): string {
  let version = 'dev'
  try {
    version = app.getVersion()
  } catch {
    // Non-Electron test contexts have no `app`.
  }
  return `Kun/${version} (paper search; +https://github.com/KunAgent/Kun)`
}

export async function searchPapersForGui(
  request: {
    query: string
    sources?: PaperSearchSource[]
    limit?: number
    yearFrom?: number
    yearTo?: number
  },
  context: PaperFetchContext = {}
): Promise<PaperSearchResult> {
  const query = request.query.trim()
  if (!query) return { ok: false, code: 'invalid-input', message: 'Query is required.' }
  try {
    const response = await runPaperSearch(request, {
      fetch: (url, init) => fetchWithOptionalProxy(url, init, context.proxyUrl ?? ''),
      signal: context.signal,
      semanticScholarApiKey: process.env.KUN_SEMANTIC_SCHOLAR_API_KEY?.trim() || undefined,
      userAgent: userAgent()
    })
    return { ok: true, ...response }
  } catch (error) {
    return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) }
  }
}
