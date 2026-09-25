/**
 * Paper identifier and URL parsing, ported from Agentero
 * (`agentero-core/.../identifiers/parsers.rs` and
 * `src-tauri/.../coolpapers/mod.rs`, MIT licensed). Kept in shared so renderer
 * input validation and main-process import agree on every accepted form.
 */

export type CoolPapersRef = {
  branch: 'arxiv' | 'venue'
  id: string
}

/**
 * Trim, drop an `arXiv:`/`arxiv:` prefix, then strip a trailing `vN` version
 * suffix. The `v` must not be the first character so old-style ids such as
 * `cs.CL/0101001` survive.
 */
export function stripArxivVersion(id: string): string {
  const s = id
    .trim()
    .replace(/^arxiv:/i, '')
    .trim()
  const i = s.lastIndexOf('v')
  if (i > 0 && /^v\d+$/.test(s.slice(i))) {
    return s.slice(0, i)
  }
  return s
}

function isArxivId(s: string): boolean {
  // New style: 1234.5678 or 1234.56789
  if (s.length >= 9 && s[4] === '.') {
    const a = s.slice(0, 4)
    const b = s.slice(5)
    return /^\d{4}$/.test(a) && /^\d{4,5}$/.test(b)
  }
  // Old style: archive/YYMMNNN
  const slash = s.indexOf('/')
  if (slash > 0) {
    const num = s.slice(slash + 1)
    return /^\d{7}$/.test(num)
  }
  return false
}

/**
 * Extract a canonical arXiv id (no `vN`) from a wide variety of user-facing
 * forms: bare ids, `arXiv:` prefixes, and arxiv.org URL paths (`/abs`, `/pdf`,
 * `/html`, `/src`, `/e-print`). Returns null for anything else.
 */
export function parseArxivId(text: string): string | null {
  const s = text.trim()
  if (!s) return null
  const stripped = s
    .replace(/^https?:\/\//, '')
    .replace(/^export\.arxiv\.org\//, '')
    .replace(/^arxiv\.org\//, '')
  const prefixMatch = stripped.match(/^(abs|pdf|html|src|e-print)\//)
  const afterPath = prefixMatch
    ? stripped.slice(prefixMatch[0].length)
    : s.replace(/^arxiv:/i, '')
  // Old-style ids (`hep-th/9901001`) contain a slash, so only the query and
  // fragment are cut here; extra URL segments are retried via first-segment.
  let id = (afterPath.split(/[?#]/)[0] ?? afterPath)
    .replace(/\.pdf$/i, '')
    .trim()
    .replace(/\/+$/, '')
  const bare = stripArxivVersion(id)
  if (isArxivId(bare)) return bare
  const first = id.split('/')[0]
  if (first && first !== id) {
    const bareFirst = stripArxivVersion(first)
    if (isArxivId(bareFirst)) return bareFirst
  }
  return null
}

/** papers.cool venue row ids look like `38818@AAAI` or `2024.acl-long.290@ACL`. */
export function isVenueCoolId(raw: string): boolean {
  const id = raw.trim()
  if (!id || !id.includes('@')) return false
  return /^[A-Za-z0-9@._-]+$/.test(id)
}

/**
 * `https://papers.cool/{arxiv|venue}/{id}` including the `/kimi?paper=<id>`
 * form. Query and fragment are otherwise ignored. Returns null for other
 * hosts, search pages, or empty ids.
 */
export function parseCoolPapersUrl(raw: string): CoolPapersRef | null {
  const s = raw.trim()
  const m = s.match(/^https?:\/\/(?:www\.)?papers\.cool\/(.*)$/i)
  if (!m) return null
  const after = m[1]
  const path = after.split(/[?#]/)[0] ?? after
  const segs = path.split('/').filter((seg) => seg.length > 0)
  const branch = segs[0]
  if (branch !== 'arxiv' && branch !== 'venue') return null
  const next = segs[1] ?? ''
  if (next === 'kimi') {
    const query = after.includes('?') ? after.slice(after.indexOf('?') + 1) : ''
    for (const pair of query.split('&')) {
      const eq = pair.indexOf('=')
      if (eq < 0) return null
      if (pair.slice(0, eq) === 'paper') {
        let id: string
        try {
          id = decodeURIComponent(pair.slice(eq + 1)).trim()
        } catch {
          return null
        }
        return id ? { branch, id } : null
      }
    }
    return null
  }
  if (!next || next === 'search') return null
  let id: string
  try {
    id = decodeURIComponent(next).trim()
  } catch {
    return null
  }
  return id ? { branch, id } : null
}

// ---- Paper directory slugs ----

const INVALID_FILE_NAME_CHARS = /[\\/:*?"<>|\p{Cc}]/gu

/** arXiv units keep the canonical id verbatim (`1706.03762`). */
export function paperSlugForArxiv(arxivId: string): string {
  return arxivId
}

/** Venue units replace `@` with `-` (`38818@AAAI` -> `38818-AAAI`). */
export function paperSlugForCool(ref: CoolPapersRef): string {
  return ref.branch === 'venue' ? ref.id.replace(/@/g, '-') : ref.id
}

/**
 * Local-PDF imports derive the slug from the file base name. Unicode letters
 * (including CJK) are kept; path-hostile characters and whitespace collapse to
 * single dashes. Collisions get a `-2`, `-3`, ... suffix from the caller.
 */
export function paperSlugForLocalFile(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]*$/, '')
    .normalize('NFKC')
    .replace(INVALID_FILE_NAME_CHARS, ' ')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  const clipped = base.slice(0, 80).replace(/-+$/g, '')
  return clipped || 'paper'
}

/** boardIds only allow `^[a-zA-Z0-9_-]{1,64}$`; derive a short ASCII tag. */
export function paperBoardTag(slug: string): string {
  const ascii = slug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
  return ascii || 'unit'
}

/** Whiteboard titles become PNG file names; strip path-hostile characters. */
export function sanitizePaperAssetFileName(name: string, maxLength = 160): string {
  const cleaned = name
    .normalize('NFKC')
    .replace(INVALID_FILE_NAME_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
  const clipped = cleaned.slice(0, maxLength).trim()
  return clipped || 'figure'
}
