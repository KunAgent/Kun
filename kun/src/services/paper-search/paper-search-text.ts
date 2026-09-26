/** Small text helpers shared by the paper-search connectors. */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** Strip markup (HTML/JATS), decode entities and collapse whitespace. */
export function cleanText(raw: string | undefined | null): string {
  if (!raw) return ''
  return decodeEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** `https://doi.org/10.1/x` / `doi:10.1/x` / `10.1/X` → `10.1/x`. */
export function normalizeDoi(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  const m = raw.trim().match(/10\.\d{4,9}\/\S+/)
  return m ? m[0].replace(/[.,;]+$/, '').toLowerCase() : undefined
}

/** arXiv id without version from an id, abs/pdf URL or `arXiv:` string. */
export function normalizeArxivId(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  const modern = raw.match(/(\d{4}\.\d{4,5})(v\d+)?/)
  if (modern) return modern[1]
  const legacy = raw.match(/([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i)
  return legacy ? legacy[1] : undefined
}

/** Title comparison key: letters and digits only, lowercased. */
export function titleKey(title: string): string {
  return [...title.toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c)).join('')
}

export function yearOf(raw: string | number | undefined | null): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  const m = raw?.match(/\b(1[89]\d{2}|20\d{2})\b/)
  return m ? Number(m[1]) : undefined
}

export function inYearRange(year: number | undefined, from?: number, to?: number): boolean {
  if (year === undefined) return from === undefined && to === undefined
  if (from !== undefined && year < from) return false
  if (to !== undefined && year > to) return false
  return true
}
