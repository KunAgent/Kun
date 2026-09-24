/**
 * Per-line import classification for the multiline import dialog (PM4).
 * Pure functions so the queue and tests share one definition of "what is
 * this line": arXiv id/URL, DOI, papers.cool, generic URL, BibTeX block, or
 * a bare title that needs a search first.
 */
export type PaperImportLineKind =
  | 'arxiv'
  | 'doi'
  | 'cool'
  | 'url'
  | 'bibtex'
  | 'title'
  | 'localPdf'
  | 'empty'

export type PaperImportLine = {
  /** Original line text (trimmed). */
  raw: string
  kind: PaperImportLineKind
  /** Identifier extracted for the backend (arxiv id / doi / url). */
  ref: string
}

const ARXIV_ID_RE = /^(?:arxiv:)?(\d{4}\.\d{4,5})(v\d+)?$/i
const ARXIV_URL_RE = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i
const COOL_RE = /papers\.cool\/(?:arxiv|venue|paper)\/([^\s/?#]+)/i
const DOI_RE = /^10\.\d{4,9}\/\S+$/i
const DOI_URL_RE = /^https?:\/\/(?:dx\.)?doi\.org\/(\S+)$/i
const URL_RE = /^https?:\/\/\S+$/i

export function classifyPaperImportLine(raw: string): PaperImportLine {
  const line = raw.trim()
  if (!line) return { raw, kind: 'empty', ref: '' }
  if (line.startsWith('@')) return { raw, kind: 'bibtex', ref: line }

  const arxivId =
    ARXIV_ID_RE.exec(line)?.[1]
    ?? ARXIV_URL_RE.exec(line)?.[1]
  if (arxivId) return { raw, kind: 'arxiv', ref: arxivId }

  const cool = COOL_RE.exec(line)?.[1]
  if (cool) return { raw, kind: 'cool', ref: line }

  const doi = DOI_URL_RE.exec(line)?.[1] ?? (DOI_RE.test(line) ? line : null)
  if (doi) return { raw, kind: 'doi', ref: doi }

  if (URL_RE.test(line)) return { raw, kind: 'url', ref: line }
  return { raw, kind: 'title', ref: line }
}

/**
 * Split a textarea blob into lines. A BibTeX paste is a multi-line block —
 * detect a leading `@entry{` and treat the whole blob as one bibtex line.
 */
export function parsePaperImportInput(text: string): PaperImportLine[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (/^@\w+\s*\{/m.test(trimmed)) {
    return [{ raw: trimmed, kind: 'bibtex', ref: trimmed }]
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => classifyPaperImportLine(line))
    .filter((line) => line.kind !== 'empty')
}

/** Queue entry for a picked/dropped local PDF (path on `ref`). */
export function localPdfImportLine(path: string): PaperImportLine {
  const name = path.split(/[\\/]/).pop() ?? path
  return { raw: name, kind: 'localPdf', ref: path }
}
