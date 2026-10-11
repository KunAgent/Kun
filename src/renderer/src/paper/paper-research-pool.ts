import type { ChatBlock, ToolBlock } from '../agent/types'
import {
  jaccardSimilarity,
  titleKey,
  titleTokens,
  type PaperReportPriority,
  type PaperSearchCardHit,
  type PaperSearchSource
} from '@shared/paper/paper-search'
import {
  parseRendererPaperSearchMeta,
  type RendererPaperDetails,
  type RendererPaperList
} from '../agent/paper-list-adapter'

/**
 * The research "paper pool": every paper the Agent's paper tools surfaced in
 * one research conversation, merged with the engine's identity rules (DOI,
 * arXiv id, papers.cool id, normalized title, fuzzy title within a year) and
 * annotated with `paper_report` recommendations. Derived from chat blocks
 * only — replayed events rebuild it, nothing is persisted separately.
 */

export type ResearchPoolEntry = PaperSearchCardHit & {
  key: string
  /** Number of tool calls that returned this paper. */
  hits: number
  /** Tool block where the paper first appeared (for jump-to). */
  firstBlockId: string
  recommended?: { reason: string; priority?: PaperReportPriority; group?: string }
}

export type ResearchPoolStats = {
  searches: number
  candidates: number
  recommended: number
  failedSources: PaperSearchSource[]
}

export type ResearchPool = {
  entries: ResearchPoolEntry[]
  /** Papers that entered the pool for the first time in each tool block. */
  newCountByBlock: Record<string, number>
  stats: ResearchPoolStats
}

const FUZZY_TITLE_JACCARD = 0.9
const FUZZY_YEAR_DELTA = 1

function toolName(block: ToolBlock): string {
  const name = typeof block.meta?.toolName === 'string' ? block.meta.toolName : ''
  return name.replace(/^mcp__kun__/, '')
}

/** Identity keys of a paper: DOI, arXiv id, venue id, then the normalized title. */
export function paperIdentityKeys(card: Pick<PaperSearchCardHit, 'doi' | 'arxivId' | 'coolId' | 'title'>): string[] {
  return [
    ...(card.doi ? [`doi:${card.doi.toLowerCase()}`] : []),
    ...(card.arxivId ? [`arxiv:${card.arxivId}`] : []),
    ...(card.coolId ? [`cool:${card.coolId}`] : []),
    `title:${titleKey(card.title)}`
  ]
}

function mergeCard(target: ResearchPoolEntry, card: PaperSearchCardHit): void {
  target.doi ??= card.doi
  target.arxivId ??= card.arxivId
  target.coolId ??= card.coolId
  target.year ??= card.year
  target.venue ??= card.venue
  target.url ??= card.url
  target.pdfUrl ??= card.pdfUrl
  if (!target.authors.length) target.authors = card.authors
  if ((card.abstract?.length ?? 0) > (target.abstract?.length ?? 0)) target.abstract = card.abstract
  if (card.citations !== undefined) target.citations = Math.max(target.citations ?? 0, card.citations)
  for (const source of card.sources) if (!target.sources.includes(source)) target.sources.push(source)
}

class PoolBuilder {
  readonly entries: ResearchPoolEntry[] = []
  private readonly tokens: Array<Set<string>> = []
  private readonly index = new Map<string, ResearchPoolEntry>()

  find(card: PaperSearchCardHit): ResearchPoolEntry | undefined {
    for (const key of paperIdentityKeys(card)) {
      const hit = this.index.get(key)
      if (hit) return hit
    }
    const tokens = titleTokens(card.title)
    if (!tokens.size) return undefined
    return this.entries.find((entry, i) =>
      !(card.year !== undefined && entry.year !== undefined && Math.abs(card.year - entry.year) > FUZZY_YEAR_DELTA) &&
      jaccardSimilarity(tokens, this.tokens[i]!) >= FUZZY_TITLE_JACCARD
    )
  }

  /** Add or merge; returns true when the paper is new to the pool. */
  add(card: PaperSearchCardHit, blockId: string): { entry: ResearchPoolEntry; isNew: boolean } {
    let entry = this.find(card)
    const isNew = !entry
    if (!entry) {
      entry = { ...card, authors: [...card.authors], sources: [...card.sources], key: '', hits: 0, firstBlockId: blockId }
      this.entries.push(entry)
      this.tokens.push(titleTokens(card.title))
    } else {
      mergeCard(entry, card)
    }
    for (const key of paperIdentityKeys(entry)) this.index.set(key, entry)
    entry.key = paperIdentityKeys(entry)[0]!
    return { entry, isNew }
  }
}

function detailsOf(block: ToolBlock): RendererPaperDetails | null {
  const value = block.meta?.paperDetails as RendererPaperDetails | undefined
  return value && Array.isArray(value.papers) ? value : null
}

export function buildResearchPool(blocks: readonly ChatBlock[]): ResearchPool {
  const pool = new PoolBuilder()
  const newCountByBlock: Record<string, number> = {}
  // Latest outcome per source: a later successful call clears an earlier failure.
  const failing = new Map<PaperSearchSource, boolean>()
  let searches = 0
  const reports: RendererPaperList[] = []
  for (const block of blocks) {
    if (block.kind === 'paper-list') {
      reports.push(block.list)
      continue
    }
    if (block.kind !== 'tool') continue
    const name = toolName(block)
    const searchMeta = name === 'paper_search' || name === 'paper_citations'
      ? parseRendererPaperSearchMeta(block.meta?.paperSearch)
      : null
    const cards = searchMeta?.papers ?? (name === 'paper_details' ? detailsOf(block)?.papers ?? [] : [])
    if (name === 'paper_search') searches += 1
    for (const report of searchMeta?.sources ?? []) failing.set(report.source, Boolean(report.error))
    let fresh = 0
    for (const card of cards) {
      const { entry, isNew } = pool.add(card, block.id)
      entry.hits += 1
      if (isNew) fresh += 1
    }
    if (cards.length) newCountByBlock[block.id] = fresh
  }
  // The latest report wins for recommendations; a paper it names that no
  // search surfaced (unverified) still enters the pool so it stays visible.
  let recommended = 0
  const latest = reports.at(-1)
  for (const item of latest?.papers ?? []) {
    const card: PaperSearchCardHit = item.paper ?? { id: item.id, title: item.title, authors: [], sources: [] }
    const { entry } = pool.add(card, '')
    entry.recommended = { reason: item.reason, ...(item.priority ? { priority: item.priority } : {}), ...(item.group ? { group: item.group } : {}) }
    recommended += 1
  }
  return {
    entries: pool.entries,
    newCountByBlock,
    stats: { searches, candidates: pool.entries.length, recommended, failedSources: [...failing].filter(([, down]) => down).map(([source]) => source) }
  }
}
