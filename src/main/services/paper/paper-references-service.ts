import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  paperReferencesFileSchema,
  type PaperReferenceItem,
  type PaperReferencesFile
} from '../../../shared/paper/paper-references-types'
import { parseBibtexEntries } from '../../../shared/paper/paper-bibtex'
import { atomicWriteFile } from '../../atomic-json-file'
import type { PaperFetchContext } from './arxiv-client'
import { fetchCrossrefReferences } from './crossref-client'
import { PaperFetchError } from './paper-http'
import { scholarFetchCitations, scholarFetchReferences } from './scholar-client'
import type { PaperUnitMetaV2 } from '../../../shared/paper/paper-meta-v2'

/**
 * `<unit>/references.json` (plan §6.4): resolution order is local
 * `source/*.bbl` / `*.bib` (saved during e-print unpack) → Semantic Scholar →
 * Crossref. Results cache in the unit dir; `force` refetches over the cache.
 */

const REFERENCES_FILE_NAME = 'references.json'
const CITATIONS_FILE_NAME = 'citations.json'
const SOURCE_DIR_NAME = 'source'
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024
const MAX_REFERENCES = 500

export async function readPaperReferencesFile(
  unitDirAbs: string,
  fileName: string = REFERENCES_FILE_NAME
): Promise<PaperReferencesFile | null> {
  try {
    const raw = await readFile(join(unitDirAbs, fileName), 'utf8')
    const parsed = paperReferencesFileSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function writePaperReferencesFile(
  unitDirAbs: string,
  file: PaperReferencesFile,
  fileName: string = REFERENCES_FILE_NAME
): Promise<void> {
  await atomicWriteFile(join(unitDirAbs, fileName), JSON.stringify(file, null, 2))
}

// ---- local source files ------------------------------------------------------

const BBL_ITEM_RE = /\\bibitem(?:\[[^\]]*\])?\{[^}]*\}/g
const BBL_DOI_RE = /\b10\.\d{4,9}\/[^\s}]+/

function parseBblReferences(text: string): PaperReferenceItem[] {
  const marks = [...text.matchAll(BBL_ITEM_RE)]
  const items: PaperReferenceItem[] = []
  for (const [index, mark] of marks.entries()) {
    const start = (mark.index ?? 0) + mark[0].length
    const end = marks[index + 1]?.index ?? text.indexOf('\\end{thebibliography}', start)
    const raw = text
      .slice(start, end === -1 ? undefined : end)
      .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^{}]*)\})?/g, '$1')
      .replace(/[{}~\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const doi = BBL_DOI_RE.exec(raw)?.[0]?.replace(/[.,;]+$/, '')
    items.push({ n: index + 1, raw: raw.slice(0, 2000), doi })
  }
  return items.filter((item) => item.raw)
}

async function readLocalSourceReferences(
  unitDirAbs: string
): Promise<{ source: 'bbl' | 'bib'; items: PaperReferenceItem[] } | null> {
  let names: string[]
  try {
    names = await readdir(join(unitDirAbs, SOURCE_DIR_NAME))
  } catch {
    return null
  }
  const bbl = names.find((name) => name.endsWith('.bbl'))
  const bib = names.find((name) => name.endsWith('.bib'))
  const file = bbl ?? bib
  if (!file) return null
  try {
    const raw = await readFile(join(unitDirAbs, SOURCE_DIR_NAME, file), 'utf8')
    if (raw.length > MAX_SOURCE_FILE_BYTES) return null
    if (bbl) {
      const items = parseBblReferences(raw).slice(0, MAX_REFERENCES)
      return items.length ? { source: 'bbl', items } : null
    }
    const items = parseBibtexEntries(raw).slice(0, MAX_REFERENCES).map((entry, index) => ({
      n: index + 1,
      title: entry.fields.title,
      authors: entry.fields.author?.split(/\s+and\s+/).filter(Boolean),
      year: entry.fields.year,
      venue: entry.fields.journal ?? entry.fields.booktitle,
      doi: entry.fields.doi,
      arxivId: entry.fields.eprint
    }))
    return items.length ? { source: 'bib', items } : null
  } catch {
    return null
  }
}

// ---- online -----------------------------------------------------------------

function s2PaperId(meta: PaperUnitMetaV2): string | null {
  if (meta.arxivId) return `ARXIV:${meta.arxivId}`
  if (meta.doi) return `DOI:${meta.doi}`
  return null
}

async function fetchOnlineReferences(
  meta: PaperUnitMetaV2,
  options: PaperFetchContext & { scholarApiKey?: string; crossrefMailto?: string }
): Promise<{ source: 's2' | 'crossref'; items: PaperReferenceItem[] } | null> {
  const s2Id = s2PaperId(meta)
  if (s2Id) {
    try {
      const refs = await scholarFetchReferences(s2Id, { ...options, limit: MAX_REFERENCES })
      if (refs.length) {
        return {
          source: 's2',
          items: refs.map((ref, index) => ({
            n: index + 1,
            title: ref.title,
            authors: ref.authors,
            year: ref.year,
            venue: ref.venue,
            doi: ref.doi,
            arxivId: ref.arxivId
          }))
        }
      }
    } catch {
      // Fall through to Crossref.
    }
  }
  if (meta.doi) {
    const refs = await fetchCrossrefReferences(meta.doi, {
      ...options,
      mailto: options.crossrefMailto
    })
    if (refs.length) {
      return {
        source: 'crossref',
        items: refs.map((ref, index) => ({
          n: index + 1,
          title: ref.title,
          authors: ref.authors,
          year: ref.year,
          venue: ref.venue,
          doi: ref.doi,
          raw: ref.raw || undefined
        }))
      }
    }
  }
  return null
}

export type PaperReferencesOutcome =
  | { ok: true; source: 'bbl' | 'bib' | 's2' | 'crossref'; items: PaperReferenceItem[]; fromCache: boolean }
  | { ok: false; code: 'network' | 'timeout' | 'io' | 'not-found'; message: string }

export async function resolvePaperReferences(input: {
  unitDirAbs: string
  meta: PaperUnitMetaV2
  force?: boolean
  online: boolean
  /** `citations` uses S2 cited-by instead of the bibliography (plan §PM5). */
  kind?: 'references' | 'citations'
  fetchContext?: PaperFetchContext
  scholarApiKey?: string
  crossrefMailto?: string
}): Promise<PaperReferencesOutcome> {
  const citations = input.kind === 'citations'
  const fileName = citations ? CITATIONS_FILE_NAME : REFERENCES_FILE_NAME
  if (!input.force) {
    const cached = await readPaperReferencesFile(input.unitDirAbs, fileName)
    if (cached) {
      return { ok: true, source: cached.source, items: cached.items, fromCache: true }
    }
  }

  if (citations) {
    const s2Id = s2PaperId(input.meta)
    if (!s2Id) {
      return { ok: false, code: 'not-found', message: 'Citations need an arXiv id or DOI.' }
    }
    if (!input.online) {
      return { ok: false, code: 'not-found', message: 'Online lookup disabled.' }
    }
    try {
      const refs = await scholarFetchCitations(s2Id, {
        signal: input.fetchContext?.signal,
        proxyUrl: input.fetchContext?.proxyUrl,
        limit: MAX_REFERENCES
      })
      if (!refs.length) {
        return { ok: false, code: 'not-found', message: 'No citations found.' }
      }
      const items: PaperReferenceItem[] = refs.map((ref, index) => ({
        n: index + 1,
        title: ref.title,
        authors: ref.authors,
        year: ref.year,
        venue: ref.venue,
        doi: ref.doi,
        arxivId: ref.arxivId
      }))
      const file: PaperReferencesFile = {
        version: 1,
        source: 's2',
        fetchedAt: new Date().toISOString(),
        items
      }
      await writePaperReferencesFile(input.unitDirAbs, file, fileName).catch(() => undefined)
      return { ok: true, source: 's2', items, fromCache: false }
    } catch (error) {
      if (error instanceof PaperFetchError && error.code === 'timeout') {
        return { ok: false, code: 'timeout', message: error.message }
      }
      return {
        ok: false,
        code: 'network',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const local = await readLocalSourceReferences(input.unitDirAbs)
  if (local) {
    const file: PaperReferencesFile = {
      version: 1,
      source: local.source,
      fetchedAt: new Date().toISOString(),
      items: local.items
    }
    await writePaperReferencesFile(input.unitDirAbs, file).catch(() => undefined)
    return { ok: true, source: local.source, items: local.items, fromCache: false }
  }

  if (!input.online) {
    return { ok: false, code: 'not-found', message: 'No local .bbl/.bib sources; online lookup disabled.' }
  }
  try {
    const online = await fetchOnlineReferences(input.meta, {
      signal: input.fetchContext?.signal,
      proxyUrl: input.fetchContext?.proxyUrl,
      scholarApiKey: input.scholarApiKey,
      crossrefMailto: input.crossrefMailto
    })
    if (!online) {
      return { ok: false, code: 'not-found', message: 'No references found.' }
    }
    const file: PaperReferencesFile = {
      version: 1,
      source: online.source,
      fetchedAt: new Date().toISOString(),
      items: online.items
    }
    await writePaperReferencesFile(input.unitDirAbs, file).catch(() => undefined)
    return { ok: true, source: online.source, items: online.items, fromCache: false }
  } catch (error) {
    if (error instanceof PaperFetchError && error.code === 'timeout') {
      return { ok: false, code: 'timeout', message: error.message }
    }
    return {
      ok: false,
      code: 'network',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
