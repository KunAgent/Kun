import { normalizeArxivId, normalizeDoi, titleKey } from './paper-search-text.js'
import type { PaperSearchCardHit } from './paper-search-types.js'

/**
 * Session-wide memory of papers returned by `paper_search` (and the
 * citation/details lookup tools). `paper_report` resolves its `papers[].id`
 * values against this store so the model can only recommend papers it
 * actually found; ids that do not resolve are kept but flagged
 * `verified: false`.
 *
 * The scope is intentionally the runtime process, not a single thread:
 * delegated literature subagents run in their own threads but their findings
 * must still validate when the parent submits the final report. Everything
 * is in-memory — a runtime restart simply means a fresh context, matching
 * the model's own conversation-memory lifecycle.
 */

const MAX_PAPERS = 600

function cardAliases(card: PaperSearchCardHit): string[] {
  const aliases = new Set<string>()
  aliases.add(card.id)
  if (card.arxivId) {
    aliases.add(card.arxivId)
    aliases.add(`arxiv:${card.arxivId}`)
  }
  if (card.doi) {
    aliases.add(card.doi)
    aliases.add(`doi:${card.doi}`)
  }
  if (card.coolId) {
    aliases.add(card.coolId)
    aliases.add(`cool:${card.coolId}`)
  }
  aliases.add(`t:${titleKey(card.title)}`)
  return [...aliases].filter(Boolean)
}

/** Normalize a model-supplied id into the alias forms we index. */
export function paperIdCandidates(raw: string): string[] {
  const id = raw.trim()
  if (!id) return []
  const candidates = new Set<string>([id])
  const lower = id.toLowerCase()
  for (const prefix of ['arxiv:', 'doi:', 'cool:', 'pmid:', 's2:']) {
    if (lower.startsWith(prefix)) candidates.add(id.slice(prefix.length))
  }
  const arxiv = normalizeArxivId(id)
  if (arxiv) {
    candidates.add(arxiv)
    candidates.add(`arxiv:${arxiv}`)
  }
  const doi = normalizeDoi(id)
  if (doi) {
    candidates.add(doi)
    candidates.add(`doi:${doi}`)
  }
  // Bare title fallback: models sometimes echo the title instead of the id.
  const tk = titleKey(id)
  if (tk.length >= 8) candidates.add(`t:${tk}`)
  return [...candidates]
}

export class PaperSeenStore {
  private readonly order: PaperSearchCardHit[] = []
  private readonly byAlias = new Map<string, PaperSearchCardHit>()

  record(cards: PaperSearchCardHit[]): void {
    for (const card of cards) {
      const aliases = cardAliases(card)
      const existing = aliases.map((a) => this.byAlias.get(a)).find(Boolean)
      const target = existing ?? card
      if (!existing) this.order.push(card)
      for (const alias of aliases) this.byAlias.set(alias, target)
    }
    while (this.order.length > MAX_PAPERS) {
      const evicted = this.order.shift()
      if (!evicted) break
      for (const alias of cardAliases(evicted)) {
        if (this.byAlias.get(alias) === evicted) this.byAlias.delete(alias)
      }
    }
  }

  resolve(rawId: string): PaperSearchCardHit | undefined {
    for (const candidate of paperIdCandidates(rawId)) {
      const hit = this.byAlias.get(candidate)
      if (hit) return hit
    }
    return undefined
  }

  /** True when at least one paper was recorded this session. */
  hasAny(): boolean {
    return this.order.length > 0
  }

  get size(): number {
    return this.order.length
  }

  clear(): void {
    this.order.length = 0
    this.byAlias.clear()
  }
}
