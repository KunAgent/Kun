/**
 * Search-page localStorage helpers (plan P5): recent queries and per-feed
 * "seen" keys for search subscriptions. Every access is wrapped — storage can
 * be unavailable or hold stale shapes.
 */
import {
  DEFAULT_PAPER_SEARCH_SOURCES,
  PAPER_SEARCH_SOURCES,
  type PaperSearchSource
} from '@shared/paper/paper-search'

const HISTORY_KEY = 'kun.paper.searchHistory'
const HISTORY_MAX = 20
const SEEN_PREFIX = 'kun.paper.searchSeen.'
const SEEN_MAX_KEYS = 400

export type PaperSearchHistoryEntry = {
  query: string
  sources?: PaperSearchSource[]
  yearFrom?: number
  yearTo?: number
  at: string
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage quota or privacy mode — history is convenience only.
  }
}

export function readSearchHistory(): PaperSearchHistoryEntry[] {
  const raw = readJson(HISTORY_KEY)
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (entry): entry is PaperSearchHistoryEntry =>
        !!entry && typeof (entry as PaperSearchHistoryEntry).query === 'string'
    )
    .slice(0, HISTORY_MAX)
}

export function pushSearchHistory(entry: Omit<PaperSearchHistoryEntry, 'at'>): PaperSearchHistoryEntry[] {
  const query = entry.query.trim()
  if (!query) return readSearchHistory()
  const rest = readSearchHistory().filter((item) => item.query !== query)
  const next = [{ ...entry, query, at: new Date().toISOString() }, ...rest].slice(0, HISTORY_MAX)
  writeJson(HISTORY_KEY, next)
  return next
}

/** Feed url scheme for saved searches: `kun-paper-search://` + URL-encoded JSON. */
export const PAPER_SEARCH_FEED_SCHEME = 'kun-paper-search://'

export type PaperSearchFeedSpec = {
  query: string
  sources?: PaperSearchSource[]
  yearFrom?: number
  yearTo?: number
}

export function isPaperSearchFeed(url: string): boolean {
  return url.startsWith(PAPER_SEARCH_FEED_SCHEME)
}

export function encodePaperSearchFeed(spec: PaperSearchFeedSpec): string {
  return PAPER_SEARCH_FEED_SCHEME + encodeURIComponent(JSON.stringify(spec))
}

export function decodePaperSearchFeed(url: string): PaperSearchFeedSpec | null {
  if (!isPaperSearchFeed(url)) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(url.slice(PAPER_SEARCH_FEED_SCHEME.length)))
    if (!parsed || typeof parsed.query !== 'string' || !parsed.query.trim()) return null
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.filter((value: unknown): value is PaperSearchSource =>
          (PAPER_SEARCH_SOURCES as readonly string[]).includes(String(value))
        )
      : undefined
    return {
      query: parsed.query.trim(),
      sources: sources?.length ? sources : [...DEFAULT_PAPER_SEARCH_SOURCES],
      yearFrom: typeof parsed.yearFrom === 'number' ? parsed.yearFrom : undefined,
      yearTo: typeof parsed.yearTo === 'number' ? parsed.yearTo : undefined
    }
  } catch {
    return null
  }
}

export type PaperSearchSeen = { checkedAt: string; keys: string[] }

export function readSearchSeen(feedId: string): PaperSearchSeen {
  const raw = readJson(`${SEEN_PREFIX}${feedId}`)
  if (!raw || typeof raw !== 'object') return { checkedAt: '', keys: [] }
  const keys = Array.isArray((raw as PaperSearchSeen).keys)
    ? (raw as PaperSearchSeen).keys.filter((key): key is string => typeof key === 'string')
    : []
  return {
    checkedAt:
      typeof (raw as PaperSearchSeen).checkedAt === 'string'
        ? (raw as PaperSearchSeen).checkedAt
        : '',
    keys: keys.slice(0, SEEN_MAX_KEYS)
  }
}

export function writeSearchSeen(feedId: string, keys: string[]): PaperSearchSeen {
  const seen = { checkedAt: new Date().toISOString(), keys: keys.slice(0, SEEN_MAX_KEYS) }
  writeJson(`${SEEN_PREFIX}${feedId}`, seen)
  return seen
}
