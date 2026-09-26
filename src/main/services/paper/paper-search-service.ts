import { app } from 'electron'
import { fetchWithOptionalProxy } from '../../proxy-fetch'
import {
  PaperRateLimiter,
  PaperSearchCache,
  runPaperSearch
} from '../../../../kun/src/services/paper-search/paper-search'
import {
  fetchOpenAlexCitationTrend,
  fetchPaperDetails
} from '../../../../kun/src/services/paper-search/paper-search-lookup'
import type {
  PaperSearchCredentials,
  PaperSearchSource,
  PaperSourceHit
} from '../../../../kun/src/services/paper-search/paper-search-types'
import type { PaperSearchResult } from '../../../shared/paper/paper-search'
import type { PaperFetchContext } from './arxiv-client'

/**
 * GUI paper-search page backend: runs the Kun multi-source search engine in
 * the main process through the app proxy so results match what the
 * `paper_search` agent tool sees.
 */

export type GuiPaperSearchContext = PaperFetchContext & {
  credentials?: PaperSearchCredentials
  /** Settings-level source allow-list; absent/empty means no restriction. */
  enabledSources?: readonly string[]
}

function userAgent(): string {
  let version = 'dev'
  try {
    version = app.getVersion()
  } catch {
    // Non-Electron test contexts have no `app`.
  }
  return `Kun/${version} (paper search; +https://github.com/KunAgent/Kun)`
}

// Process-wide GUI search state so repeated searches hit the same cache and
// per-source pacing/degradation survives across requests.
const guiCache = new PaperSearchCache<PaperSourceHit[]>()
const guiRateLimiter = new PaperRateLimiter()

export async function searchPapersForGui(
  request: {
    query: string
    sources?: PaperSearchSource[]
    limit?: number
    yearFrom?: number
    yearTo?: number
  },
  context: GuiPaperSearchContext = {}
): Promise<PaperSearchResult> {
  const query = request.query.trim()
  if (!query) return { ok: false, code: 'invalid-input', message: 'Query is required.' }
  const enabled = context.enabledSources?.length ? new Set(context.enabledSources) : null
  const credentials = context.credentials
  const sources = (enabled ? request.sources?.filter((s) => enabled.has(s)) : request.sources)
    ?.filter((s) => s !== 'core' || credentials?.coreApiKey)
  if (enabled && request.sources?.length && !sources?.length) {
    return { ok: false, code: 'invalid-input', message: 'All selected sources are disabled in settings.' }
  }
  try {
    const response = await runPaperSearch(
      { ...request, ...(sources ? { sources } : {}) },
      {
        fetch: (url, init) => fetchWithOptionalProxy(url, init, context.proxyUrl ?? ''),
        signal: context.signal,
        credentials,
        userAgent: userAgent(),
        cache: guiCache,
        rateLimiter: guiRateLimiter
      }
    )
    return { ok: true, ...response }
  } catch (error) {
    return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Detail-pane lookup (plan P5): S2 fields (tldr, fieldsOfStudy, OA pdf) plus
 * the OpenAlex citation trend, keyed by whatever id the hit carried.
 */
export async function paperDetailForGui(
  id: string,
  context: GuiPaperSearchContext = {}
): Promise<
  | {
      ok: true
      paper: PaperSourceHit & { tldr?: string; fieldsOfStudy?: string[] }
      countsByYear?: Array<{ year: number; citations: number }>
    }
  | { ok: false; message: string }
> {
  const trimmed = id.trim()
  if (!trimmed) return { ok: false, message: 'Paper id is required.' }
  const ctx = {
    fetch: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) =>
      fetchWithOptionalProxy(url, init, context.proxyUrl ?? ''),
    signal: context.signal,
    credentials: context.credentials
  }
  try {
    const [details, countsByYear] = await Promise.all([
      fetchPaperDetails([trimmed], ctx),
      fetchOpenAlexCitationTrend(trimmed, ctx)
    ])
    const resolved = details[0]
    if (!resolved?.hit) return { ok: false, message: `Could not resolve "${trimmed.slice(0, 80)}".` }
    return {
      ok: true,
      paper: { ...resolved.hit, ...(resolved.extra ?? {}) },
      ...(countsByYear ? { countsByYear } : {})
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
