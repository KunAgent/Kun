import type { PaperUnitMetaV2 } from './paper-meta-v2'

/**
 * Minimal BibTeX support for the paper library: generate `.bib` output from
 * unit metadata (preferring a stored `bibtex` record) and parse `.bib` files
 * back into entry objects for import. The parser intentionally covers the
 * common `{value}` / `"value"` / bare-value field forms; it is not a full
 * BibTeX grammar.
 */

export type PaperBibtexEntry = {
  type: string
  citeKey: string
  fields: Record<string, string>
  /** The verbatim `@type{...}` source span. */
  raw: string
}

const BIBTEX_WORD_RE = /[A-Za-z0-9]+/g

function citeKeyBase(meta: Pick<PaperUnitMetaV2, 'title'> & Partial<PaperUnitMetaV2>): string {
  const author = meta.authors?.[0]?.trim() ?? ''
  const lastName = author.split(/\s+/).filter(Boolean).at(-1) ?? ''
  const lastNameClean = (lastName.match(BIBTEX_WORD_RE) ?? []).join('')
  const year = (meta.year ?? '').match(/\d{4}/)?.[0] ?? ''
  const titleWord = (meta.title ?? '')
    .match(BIBTEX_WORD_RE)
    ?.find((word) => word.length > 3)?.toLowerCase() ?? ''
  return `${lastNameClean.toLowerCase()}${year}${titleWord}` || 'paper'
}

/**
 * Resolve a unique cite key for `meta`. An explicit `citeKey` wins; otherwise
 * derive `authorYearWord` and suffix `-b`, `-c`, ... on collision.
 */
export function paperCiteKey(
  meta: Pick<PaperUnitMetaV2, 'title'> & Partial<PaperUnitMetaV2>,
  taken: ReadonlySet<string>
): string {
  const declared = meta.citeKey?.trim()
  if (declared && !taken.has(declared)) return declared
  const base = citeKeyBase(meta)
  if (!taken.has(base)) return base
  for (let i = 98 /* 'b' */; ; i += 1) {
    const candidate = `${base}-${String.fromCharCode(i)}`
    if (!taken.has(candidate)) return candidate
  }
}

function bibFieldValue(value: string): string {
  return `{${value.replace(/[{}\\]/g, '')}}`
}

/** One entry: stored `meta.bibtex` verbatim when present, else generated. */
export function paperBibtexEntry(meta: PaperUnitMetaV2, citeKey: string): string {
  const stored = meta.bibtex?.trim()
  if (stored) return stored
  const fields: [string, string][] = [['title', meta.title]]
  if (meta.authors?.length) fields.push(['author', meta.authors.join(' and ')])
  if (meta.year) fields.push(['year', meta.year])
  if (meta.doi) {
    fields.push(['journal', meta.venue ?? meta.doi])
    fields.push(['doi', meta.doi])
  } else if (meta.venue) {
    fields.push(['journal', meta.venue])
  }
  if (meta.arxivId) {
    fields.push(['eprint', meta.arxivId])
    fields.push(['archivePrefix', 'arXiv'])
  }
  if (meta.pdfUrl) fields.push(['url', meta.pdfUrl])
  else if (meta.sourceUrl) fields.push(['url', meta.sourceUrl])
  if (meta.abstract) fields.push(['abstract', meta.abstract])
  const type = meta.doi || meta.venue ? 'article' : 'misc'
  const body = fields.map(([k, v]) => `  ${k} = ${bibFieldValue(v)}`).join(',\n')
  return `@${type}{${citeKey},\n${body}\n}`
}

/** Whole-library `.bib` text with a trailing newline; dedupes cite keys. */
export function generatePaperBibtex(metas: readonly PaperUnitMetaV2[]): string {
  const taken = new Set<string>()
  const chunks: string[] = []
  for (const meta of metas) {
    const key = paperCiteKey(meta, taken)
    taken.add(key)
    chunks.push(paperBibtexEntry(meta, key))
  }
  return chunks.length ? `${chunks.join('\n\n')}\n` : ''
}

function readBibtexValue(text: string, start: number): { value: string; next: number } {
  let i = start
  while (i < text.length && /\s/.test(text[i])) i += 1
  if (text[i] === '{') {
    let depth = 0
    const begin = i
    for (; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}') {
        depth -= 1
        if (depth === 0) return { value: text.slice(begin + 1, i), next: i + 1 }
      }
    }
    return { value: text.slice(begin + 1), next: i }
  }
  if (text[i] === '"') {
    const end = text.indexOf('"', i + 1)
    if (end === -1) return { value: text.slice(i + 1), next: text.length }
    return { value: text.slice(i + 1, end), next: end + 1 }
  }
  const match = /^[^,\n}]+/.exec(text.slice(i))
  const raw = match?.[0] ?? ''
  return { value: raw.trim(), next: i + raw.length }
}

/** Parse a `.bib` file into entries; skips `@comment`/`@preamble`/`@string`. */
export function parseBibtexEntries(text: string): PaperBibtexEntry[] {
  const entries: PaperBibtexEntry[] = []
  let i = 0
  while (i < text.length) {
    const at = text.indexOf('@', i)
    if (at === -1) break
    const head = /^@([A-Za-z]+)\s*[{(]\s*/.exec(text.slice(at, at + 64))
    if (!head) {
      i = at + 1
      continue
    }
    const type = head[1].toLowerCase()
    let cursor = at + head[0].length
    if (type === 'comment' || type === 'preamble' || type === 'string') {
      i = cursor
      continue
    }
    const keyEnd = text.indexOf(',', cursor)
    const closeIdx = text.indexOf('}', cursor)
    if (keyEnd === -1 || (closeIdx !== -1 && closeIdx < keyEnd)) {
      i = cursor
      continue
    }
    const citeKey = text.slice(cursor, keyEnd).trim()
    cursor = keyEnd + 1
    const fields: Record<string, string> = {}
    while (cursor < text.length) {
      while (cursor < text.length && /[\s,]/.test(text[cursor])) cursor += 1
      if (text[cursor] === '}' || text[cursor] === ')' || cursor >= text.length) {
        cursor += 1
        break
      }
      const nameMatch = /^[A-Za-z][A-Za-z0-9_-]*/.exec(text.slice(cursor))
      if (!nameMatch) {
        cursor += 1
        continue
      }
      const name = nameMatch[0].toLowerCase()
      cursor += nameMatch[0].length
      while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1
      if (text[cursor] !== '=') continue
      cursor += 1
      const { value, next } = readBibtexValue(text, cursor)
      fields[name] = value.replace(/\s+/g, ' ').trim()
      cursor = next
    }
    if (citeKey) entries.push({ type, citeKey, fields, raw: text.slice(at, cursor) })
    i = cursor
  }
  return entries
}
