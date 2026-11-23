import { parseBibtexEntries, type PaperBibtexEntry } from './paper/paper-bibtex'

const doi = (entry: PaperBibtexEntry): string => (entry.fields.doi ?? '').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase()

/** Preserve existing keys and verbatim BibTeX, including nested field braces. */
export function mergeLatexBibliography(current: string, incoming: string): { content: string; key: string; added: boolean } {
  const entries = parseBibtexEntries(current)
  const entry = parseBibtexEntries(incoming)[0]
  if (!entry || !/^[A-Za-z0-9_:./+-]+$/.test(entry.citeKey)) throw new Error('The paper does not contain a valid BibTeX citation key.')
  const match = entries.find((existing) => (doi(entry) && doi(existing) === doi(entry)) || existing.raw.trim() === entry.raw.trim())
  if (match) return { content: current, key: match.citeKey, added: false }
  const taken = new Set(entries.map((entry) => entry.citeKey))
  let key = entry.citeKey
  let suffix = 2
  while (taken.has(key)) key = `${entry.citeKey}-${suffix++}`
  const raw = entry.raw.replace(/^(@\w+\s*[({]\s*)[^,\s]+/, `$1${key}`)
  return { content: current.trimEnd() + (current.trim() ? '\n\n' : '') + raw + '\n', key, added: true }
}

export function latexCitationUses(sources: Array<{ file: string; content: string }>): Map<string, Array<{ file: string; line: number }>> {
  const uses = new Map<string, Array<{ file: string; line: number }>>()
  for (const source of sources) {
    const content = source.content.replace(/(?<!\\)%[^\n]*/g, '')
    for (const match of content.matchAll(/\\(?:cite\w*|[aA]utocite|[pP]arencite|[tT]extcite)\*?(?:\s*\[[^\]]*\])*\s*\{([^}]+)\}/g)) {
      const line = content.slice(0, match.index).split('\n').length
      for (const key of match[1].split(',').map((key) => key.trim()).filter(Boolean)) {
        const locations = uses.get(key) ?? []
        locations.push({ file: source.file, line })
        uses.set(key, locations)
      }
    }
  }
  return uses
}
