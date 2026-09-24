/**
 * BM25 lexical relevance scoring (plan §6.4 `paper-recommend`): score an
 * arXiv-today / feed item against the local library corpus. Pure and cheap —
 * titles+abstracts only, no embeddings.
 */

const TOKEN_RE = /[A-Za-z0-9]+/g
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'for', 'to', 'with', 'by',
  'is', 'are', 'we', 'our', 'this', 'that', 'from', 'as', 'at', 'be', 'via',
  'using', 'based', 'approach', 'method', 'paper', 'study', 'results'
])

export function paperTokens(text: string): string[] {
  const out: string[] = []
  for (const match of text.toLowerCase().matchAll(TOKEN_RE)) {
    const token = match[0]
    if (token.length < 2 || STOP_WORDS.has(token)) continue
    out.push(token)
  }
  return out
}

const BM25_K1 = 1.2

export type PaperBm25Index = {
  docCount: number
  /** term → number of library docs containing it */
  docFreq: Map<string, number>
}

export function buildPaperBm25Index(docTexts: readonly string[]): PaperBm25Index {
  const docs = docTexts.map((text) => new Set(paperTokens(text)))
  const docFreq = new Map<string, number>()
  let totalLen = 0
  for (const doc of docs) {
    totalLen += doc.size
    for (const term of doc) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
    }
  }
  return {
    docCount: docs.length,
    docFreq
  }
}

/** BM25-style score of `candidateText` against the library index. */
export function bm25Score(index: PaperBm25Index, candidateText: string): number {
  if (index.docCount === 0) return 0
  const freq = new Map<string, number>()
  for (const token of paperTokens(candidateText)) {
    freq.set(token, (freq.get(token) ?? 0) + 1)
  }
  let score = 0
  for (const [term, tf] of freq) {
    const df = index.docFreq.get(term) ?? 0
    if (df === 0) continue
    const idf = Math.log(1 + (index.docCount - df + 0.5) / (df + 0.5))
    score += idf * ((tf * (BM25_K1 + 1)) / (tf + BM25_K1))
  }
  return score
}
