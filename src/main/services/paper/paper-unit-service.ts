/**
 * Paper-unit filesystem store: import (arXiv / papers.cool / local PDF),
 * dedupe by arxivId or Cool Papers id, atomic `paper.json` writes, and unit
 * discovery for the sidebar. All paths handled here are already resolved
 * inside the workspace by the IPC layer.
 */
import { basename, join, relative } from 'node:path'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import {
  isVenueCoolId,
  paperSlugForArxiv,
  paperSlugForCool,
  paperSlugForLocalFile,
  parseArxivId,
  parseCoolPapersUrl
} from '../../../shared/paper/paper-ids'
import {
  PAPER_META_FILE_NAME,
  PAPER_NOTES_FILE_NAME,
  paperFigureIndexV1Schema,
  paperUnitMetaV1Schema,
  type PaperFigureIndexV1,
  type PaperUnitMetaV1
} from '../../../shared/paper/paper-types'
import { atomicWriteFile } from '../../atomic-json-file'
import {
  paperUnitMetaSchema,
  paperUnitMetaV2Schema,
  type PaperUnitMeta,
  type PaperUnitMetaV2
} from '../../../shared/paper/paper-meta-v2'
import { pathExists } from '../workspace-paths'
import {
  downloadArxivPdf,
  downloadArxivPdfFromUrl,
  fetchArxivMeta,
  type PaperFetchContext
} from './arxiv-client'
import { fetchCoolPageMeta } from './coolpapers-client'
import { fetchCrossrefWork } from './crossref-client'
import { fetchUrlPaperMeta } from './paper-discover-service'
import { identifyLocalPdf, type PaperIdentifyResult } from './paper-identify-service'

export type PaperProgressReporter = (stage: string, message?: string) => void

export type ResolvedPaperUnit = {
  /** Absolute path of the unit directory. */
  dir: string
  meta: PaperUnitMeta
}

export class PaperUnitError extends Error {
  constructor(readonly code: 'invalid-input' | 'invalid-unit' | 'not-found' | 'io', message: string) {
    super(message)
    this.name = 'PaperUnitError'
  }
}

export function paperMetaPath(unitDirAbs: string): string {
  return join(unitDirAbs, PAPER_META_FILE_NAME)
}

/** Reads `paper.json` in either v1 or v2 form (never rewrites). */
export async function readPaperUnitMeta(unitDirAbs: string): Promise<PaperUnitMeta | null> {
  try {
    const raw = await readFile(paperMetaPath(unitDirAbs), 'utf8')
    const parsed = paperUnitMetaSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function readPaperFigureIndex(unitDirAbs: string): Promise<PaperFigureIndexV1 | null> {
  try {
    const raw = await readFile(join(unitDirAbs, 'figures', 'index.json'), 'utf8')
    const parsed = paperFigureIndexV1Schema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * Atomic `paper.json` rewrite; `mutate` receives a clone and returns the next
 * meta. The file keeps its own version: v1 metas validate as v1, v2 as v2 —
 * a v1 unit is only promoted to v2 by the library patch path, never here.
 */
export async function updatePaperUnitMeta(
  unitDirAbs: string,
  mutate: (meta: PaperUnitMeta) => PaperUnitMeta
): Promise<PaperUnitMeta> {
  const current = await readPaperUnitMeta(unitDirAbs)
  if (!current) throw new PaperUnitError('invalid-unit', `${PAPER_META_FILE_NAME} is missing or invalid.`)
  const next = mutate(structuredClone(current))
  const checked = (next.version === 2 ? paperUnitMetaV2Schema : paperUnitMetaV1Schema).parse(next)
  await atomicWriteFile(paperMetaPath(unitDirAbs), `${JSON.stringify(checked, null, 2)}\n`)
  return checked
}

/** Every direct child of `parentAbs` containing a valid `paper.json`. */
export async function listPaperUnits(parentAbs: string): Promise<ResolvedPaperUnit[]> {
  const units: ResolvedPaperUnit[] = []
  let entries
  try {
    entries = await readdir(parentAbs, { withFileTypes: true })
  } catch {
    return units
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(parentAbs, entry.name)
    const meta = await readPaperUnitMeta(dir)
    if (meta) units.push({ dir, meta })
  }
  units.sort((a, b) => a.dir.localeCompare(b.dir))
  return units
}

async function uniqueUnitDir(parentAbs: string, slug: string): Promise<string> {
  for (let n = 0; n < 100; n += 1) {
    const candidate = join(parentAbs, n === 0 ? slug : `${slug}-${n + 1}`)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new PaperUnitError('io', 'Could not allocate a paper directory name.')
}

function yamlQuote(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, ' ').trim())
}

/** NOTES.md shell: aliases + arxiv + title frontmatter, `# title` body, abstract quote. */
export function buildPaperNotesShell(
  meta: Pick<PaperUnitMetaV1, 'title' | 'authors' | 'arxivId' | 'venue' | 'abstract'>
): string {
  const lines = ['---', `title: ${yamlQuote(meta.title)}`, 'aliases:', `  - ${yamlQuote(meta.title)}`]
  if (meta.arxivId) lines.push(`arxiv: ${yamlQuote(meta.arxivId)}`)
  if (meta.venue) lines.push(`venue: ${yamlQuote(meta.venue)}`)
  lines.push('---', '', `# ${meta.title}`, '')
  const abstract = meta.abstract?.replace(/\s+/g, ' ').trim()
  if (abstract) lines.push(`> ${abstract}`, '')
  return `${lines.join('\n')}\n`
}

type PaperSourceResolution =
  | { kind: 'arxiv'; arxivId: string; coolId?: string; sourceUrl?: string }
  | { kind: 'venue'; coolId: string; sourceUrl?: string }
  | { kind: 'local'; localPdfPath: string }
  | { kind: 'doi'; doi: string; sourceUrl?: string }
  | { kind: 'url'; url: string }

/** DOI forms: bare `10.xxxx/yyy`, `doi:10.x`, `https://doi.org/10.x`. */
function parseDoiInput(raw: string): string | null {
  const text = raw.trim().replace(/^doi:\s*/i, '')
  const fromUrl = /^https?:\/\/(?:dx\.)?doi\.org\/(\S+)$/i.exec(text)?.[1]
  const doi = (fromUrl ?? text).replace(/[.;,]+$/, '')
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi : null
}

/** Classify the raw import input into a fetch strategy. */
export function resolvePaperImportSource(input: {
  input: string
  localPdfPath?: string
}): PaperSourceResolution | null {
  const localPdfPath = input.localPdfPath?.trim()
  if (localPdfPath) return { kind: 'local', localPdfPath }
  const raw = input.input.trim()
  if (!raw) return null
  const arxivId = parseArxivId(raw)
  if (arxivId) return { kind: 'arxiv', arxivId }
  const cool = parseCoolPapersUrl(raw)
  if (cool) {
    if (cool.branch === 'venue') {
      return { kind: 'venue', coolId: cool.id, sourceUrl: raw }
    }
    const coolArxivId = parseArxivId(cool.id) ?? cool.id
    return { kind: 'arxiv', arxivId: coolArxivId, coolId: cool.id, sourceUrl: raw }
  }
  if (isVenueCoolId(raw)) return { kind: 'venue', coolId: raw }
  const doi = parseDoiInput(raw)
  if (doi) return { kind: 'doi', doi, sourceUrl: raw }
  if (/^https?:\/\/\S+$/i.test(raw)) return { kind: 'url', url: raw }
  return null
}

async function findExistingUnit(
  parentAbs: string,
  match: { arxivId?: string; coolId?: string }
): Promise<ResolvedPaperUnit | null> {
  const units = await listPaperUnits(parentAbs)
  return (
    units.find((unit) => {
      if (match.arxivId && unit.meta.arxivId === match.arxivId) return true
      if (match.coolId && unit.meta.coolPapers?.id === match.coolId) return true
      return false
    }) ?? null
  )
}

export type PaperImportOutcome = {
  unitDir: string
  meta: PaperUnitMeta
  reused: boolean
}

/**
 * Create a paper unit under `parentAbs`. Existing units are returned instead
 * of re-importing (`reused: true`).
 */
export async function importPaperUnit(
  parentAbs: string,
  resolution: PaperSourceResolution,
  fetch: PaperFetchContext & { onProgress?: PaperProgressReporter }
): Promise<PaperImportOutcome> {
  const progress = fetch.onProgress ?? (() => undefined)
  await mkdir(parentAbs, { recursive: true })

  if (resolution.kind === 'local') {
    const sourcePath = resolution.localPdfPath
    const info = await stat(sourcePath).catch(() => null)
    if (!info?.isFile()) throw new PaperUnitError('invalid-input', 'Local PDF file not found.')

    // Identify the first pages (DOI / arXiv id) and fetch canonical metadata;
    // uncertain PDFs stay flagged `needsReview` (plan §PM4).
    progress('metadata', 'identifying PDF')
    const identified = await identifyLocalPdf(sourcePath).catch(
      (): PaperIdentifyResult => ({})
    )
    let fetched:
      | { title: string; authors: string[]; abstract?: string; year?: string; arxivId?: string; doi?: string }
      | null = null
    if (identified.arxivId) {
      fetched = await fetchArxivMeta(identified.arxivId, fetch).catch(() => null)
    }
    if (!fetched && identified.doi) {
      const work = await fetchCrossrefWork(identified.doi, fetch).catch(() => null)
      fetched = work?.title ? work : null
    }

    const existing = await findPaperUnitByIds(parentAbs, {
      arxivId: fetched?.arxivId ?? identified.arxivId,
      doi: fetched?.doi ?? identified.doi,
      title: fetched?.title ?? identified.titleGuess,
      year: fetched?.year
    })
    if (existing) {
      // Dedupe hit: when the existing unit is metadata-only, attach this PDF.
      if (!existing.meta.pdfFile) {
        const pdfFile = `${basename(existing.dir)}.pdf`
        await copyFile(sourcePath, join(existing.dir, pdfFile))
        const meta = { ...existing.meta, pdfFile }
        await atomicWriteFile(paperMetaPath(existing.dir), `${JSON.stringify(meta, null, 2)}\n`)
        return { unitDir: existing.dir, meta, reused: false }
      }
      return { unitDir: existing.dir, meta: existing.meta, reused: true }
    }

    const slug = paperSlugForLocalFile(basename(sourcePath))
    progress('pdf', 'copying PDF')
    const dir = await uniqueUnitDir(parentAbs, slug)
    await mkdir(dir, { recursive: true })
    const pdfFile = `${basename(dir)}.pdf`
    await copyFile(sourcePath, join(dir, pdfFile))
    const fallbackTitle = basename(sourcePath).replace(/\.pdf$/i, '')
    if (!fetched) {
      const meta: PaperUnitMetaV1 = {
        version: 1,
        slug: basename(dir),
        title: identified.titleGuess ?? fallbackTitle,
        authors: [],
        doi: identified.doi,
        arxivId: identified.arxivId,
        pdfFile,
        originalPath: sourcePath,
        importedAt: new Date().toISOString()
      }
      await atomicWriteFile(paperMetaPath(dir), `${JSON.stringify(meta, null, 2)}\n`)
      await writeFile(join(dir, PAPER_NOTES_FILE_NAME), buildPaperNotesShell(meta), 'utf8')
      return { unitDir: dir, meta, reused: false }
    }
    const meta: PaperUnitMetaV2 = {
      version: 2,
      slug: basename(dir),
      title: fetched.title,
      authors: fetched.authors,
      abstract: fetched.abstract,
      year: fetched.year,
      arxivId: fetched.arxivId ?? identified.arxivId,
      doi: fetched.doi ?? identified.doi,
      pdfFile,
      originalPath: sourcePath,
      importedAt: new Date().toISOString(),
      source: 'local-pdf',
      needsReview: !identified.arxivId && !identified.doi
    }
    await atomicWriteFile(paperMetaPath(dir), `${JSON.stringify(meta, null, 2)}\n`)
    await writeFile(join(dir, PAPER_NOTES_FILE_NAME), buildPaperNotesShell(meta), 'utf8')
    return { unitDir: dir, meta, reused: false }
  }

  if (resolution.kind === 'arxiv') {
    const existing = await findExistingUnit(parentAbs, {
      arxivId: resolution.arxivId,
      coolId: resolution.coolId
    })
    if (existing) return { unitDir: existing.dir, meta: existing.meta, reused: true }
    progress('metadata', 'fetching arXiv metadata')
    const meta = await fetchArxivMeta(resolution.arxivId, fetch)
    if (!meta) throw new PaperUnitError('not-found', `arXiv paper ${resolution.arxivId} was not found.`)
    const slug = paperSlugForArxiv(resolution.arxivId)
    const dir = await uniqueUnitDir(parentAbs, slug)
    await mkdir(dir, { recursive: true })
    const pdfFile = `${basename(dir)}.pdf`
    progress('pdf', 'downloading PDF')
    const pdf = await downloadArxivPdf(resolution.arxivId, fetch)
    await writeFile(join(dir, pdfFile), pdf)
    const unitMeta: PaperUnitMetaV1 = {
      version: 1,
      slug: basename(dir),
      title: meta.title,
      authors: meta.authors,
      abstract: meta.abstract,
      year: meta.year,
      arxivId: meta.arxivId,
      doi: meta.doi,
      coolPapers: resolution.coolId
        ? { branch: 'arxiv', id: resolution.coolId }
        : { branch: 'arxiv', id: resolution.arxivId },
      sourceUrl: resolution.sourceUrl ?? meta.sourceUrl,
      pdfUrl: meta.pdfUrl,
      pdfFile,
      importedAt: new Date().toISOString()
    }
    await atomicWriteFile(paperMetaPath(dir), `${JSON.stringify(unitMeta, null, 2)}\n`)
    await writeFile(join(dir, PAPER_NOTES_FILE_NAME), buildPaperNotesShell(unitMeta), 'utf8')
    return { unitDir: dir, meta: unitMeta, reused: false }
  }

  if (resolution.kind === 'doi') {
    progress('metadata', 'resolving DOI via Crossref')
    const work = await fetchCrossrefWork(resolution.doi, fetch)
    if (!work?.title) {
      throw new PaperUnitError('not-found', `DOI ${resolution.doi} was not found.`)
    }
    const existing = await findPaperUnitByIds(parentAbs, {
      arxivId: work.arxivId,
      doi: work.doi,
      title: work.title,
      year: work.year
    })
    if (existing) return { unitDir: existing.dir, meta: existing.meta, reused: true }
    if (work.arxivId) {
      return importPaperUnit(parentAbs, {
        kind: 'arxiv',
        arxivId: work.arxivId,
        sourceUrl: resolution.sourceUrl
      }, fetch)
    }
    const slugHint = `doi-${work.doi.replace(/[^a-z0-9]+/gi, '-').slice(0, 48)}`
    const metaBase = {
      title: work.title,
      authors: work.authors,
      abstract: work.abstract,
      year: work.year,
      venue: work.venue,
      doi: work.doi,
      pdfUrl: work.pdfUrl,
      sourceUrl: resolution.sourceUrl ?? `https://doi.org/${work.doi}`,
      source: 'doi' as const
    }
    if (work.pdfUrl) {
      progress('pdf', 'downloading PDF')
      const dir = await uniqueUnitDir(parentAbs, slugHint)
      await mkdir(dir, { recursive: true })
      const pdfFile = `${basename(dir)}.pdf`
      try {
        const pdf = await downloadArxivPdfFromUrl(work.pdfUrl, fetch)
        await writeFile(join(dir, pdfFile), pdf)
      } catch (error) {
        // PDF fetch is best-effort for DOI imports — fall back to meta-only.
        await rm(dir, { recursive: true, force: true })
        return importPaperUnitFromMeta({ parentAbs, slugHint, meta: metaBase })
      }
      // `source` is a v2 field, so this unit is written as v2 from the start.
      const meta: PaperUnitMetaV2 = {
        version: 2,
        slug: basename(dir),
        ...metaBase,
        pdfFile,
        importedAt: new Date().toISOString()
      }
      await atomicWriteFile(paperMetaPath(dir), `${JSON.stringify(meta, null, 2)}\n`)
      await writeFile(join(dir, PAPER_NOTES_FILE_NAME), buildPaperNotesShell(meta), 'utf8')
      return { unitDir: dir, meta, reused: false }
    }
    return importPaperUnitFromMeta({ parentAbs, slugHint, meta: metaBase })
  }

  if (resolution.kind === 'url') {
    progress('metadata', 'fetching page metadata')
    const outcome = await fetchUrlPaperMeta(resolution.url, fetch)
    if (!outcome.ok) {
      throw new PaperUnitError(
        outcome.code === 'not-found' ? 'not-found' : 'invalid-input',
        outcome.message
      )
    }
    const meta = outcome.meta
    if (meta.arxivId) {
      return importPaperUnit(parentAbs, {
        kind: 'arxiv',
        arxivId: meta.arxivId,
        sourceUrl: resolution.url
      }, fetch)
    }
    if (meta.doi) {
      return importPaperUnit(parentAbs, {
        kind: 'doi',
        doi: meta.doi,
        sourceUrl: resolution.url
      }, fetch)
    }
    const existing = await findPaperUnitByIds(parentAbs, { title: meta.title, year: meta.year })
    if (existing) return { unitDir: existing.dir, meta: existing.meta, reused: true }
    const slugHint = `url-${meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}`
    const metaBase = {
      title: meta.title,
      authors: meta.authors,
      abstract: meta.abstract,
      year: meta.year,
      venue: meta.venue,
      pdfUrl: meta.pdfUrl,
      sourceUrl: resolution.url,
      needsReview: true
    }
    if (meta.pdfUrl) {
      progress('pdf', 'downloading PDF')
      const dir = await uniqueUnitDir(parentAbs, slugHint)
      await mkdir(dir, { recursive: true })
      const pdfFile = `${basename(dir)}.pdf`
      try {
        const pdf = await downloadArxivPdfFromUrl(meta.pdfUrl, fetch)
        await writeFile(join(dir, pdfFile), pdf)
      } catch {
        await rm(dir, { recursive: true, force: true })
        return importPaperUnitFromMeta({ parentAbs, slugHint, meta: metaBase })
      }
      const unitMeta: PaperUnitMetaV2 = {
        version: 2,
        slug: basename(dir),
        importedAt: new Date().toISOString(),
        ...metaBase,
        pdfFile
      }
      await atomicWriteFile(paperMetaPath(dir), `${JSON.stringify(unitMeta, null, 2)}\n`)
      await writeFile(join(dir, PAPER_NOTES_FILE_NAME), buildPaperNotesShell(unitMeta), 'utf8')
      return { unitDir: dir, meta: unitMeta, reused: false }
    }
    return importPaperUnitFromMeta({ parentAbs, slugHint, meta: metaBase })
  }

  // venue import via papers.cool citation_* metadata
  const existing = await findExistingUnit(parentAbs, { coolId: resolution.coolId })
  if (existing) return { unitDir: existing.dir, meta: existing.meta, reused: true }
  progress('metadata', 'fetching papers.cool metadata')
  const page = await fetchCoolPageMeta(
    { branch: 'venue', id: resolution.coolId },
    fetch
  )
  if (!page) throw new PaperUnitError('not-found', `papers.cool paper ${resolution.coolId} was not found.`)
  if (!page.pdfUrl) {
    throw new PaperUnitError('not-found', `papers.cool page for ${resolution.coolId} has no PDF link.`)
  }
  const slug = paperSlugForCool({ branch: 'venue', id: resolution.coolId })
  const dir = await uniqueUnitDir(parentAbs, slug)
  await mkdir(dir, { recursive: true })
  const pdfFile = `${basename(dir)}.pdf`
  progress('pdf', 'downloading PDF')
  const pdf = await downloadArxivPdfFromUrl(page.pdfUrl, fetch)
  await writeFile(join(dir, pdfFile), pdf)
  const unitMeta: PaperUnitMetaV1 = {
    version: 1,
    slug: basename(dir),
    title: page.title,
    authors: page.authors,
    abstract: page.abstractText,
    year: page.date?.slice(0, 4),
    venue: page.publisher,
    coolPapers: { branch: 'venue', id: resolution.coolId },
    sourceUrl: page.publicUrl ?? resolution.sourceUrl,
    pdfUrl: page.pdfUrl,
    pdfFile,
    importedAt: new Date().toISOString()
  }
  await atomicWriteFile(paperMetaPath(dir), `${JSON.stringify(unitMeta, null, 2)}\n`)
  await writeFile(join(dir, PAPER_NOTES_FILE_NAME), buildPaperNotesShell(unitMeta), 'utf8')
  return { unitDir: dir, meta: unitMeta, reused: false }
}

/** Directory of `path` relative to `rootAbs`, with forward slashes. */
export function workspaceRelativeDir(rootAbs: string, path: string): string {
  return relative(rootAbs, path).split('\\').join('/')
}

/** Normalized title key for dedupe: lowercase, alphanumeric only. */
export function paperTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Dedupe lookup for import flows (plan §PM4): arXiv id → DOI → normalized
 * title+year, in that order.
 */
export async function findPaperUnitByIds(
  parentAbs: string,
  match: { arxivId?: string; doi?: string; title?: string; year?: string }
): Promise<ResolvedPaperUnit | null> {
  const units = await listPaperUnits(parentAbs)
  const wantTitle = match.title ? paperTitleKey(match.title) : ''
  return (
    units.find((unit) => {
      if (match.arxivId && unit.meta.arxivId === match.arxivId) return true
      if (match.doi && unit.meta.doi?.toLowerCase() === match.doi.toLowerCase()) return true
      if (wantTitle && match.year) {
        const sameTitle = unit.meta.title && paperTitleKey(unit.meta.title) === wantTitle
        if (sameTitle && (!unit.meta.year || unit.meta.year === match.year)) return true
      }
      return false
    }) ?? null
  )
}

/**
 * Create a metadata-only paper unit (DOI / BibTeX / title-search import).
 * `meta` carries v2 fields; `pdfFile` stays absent until a PDF is fetched.
 */
export async function importPaperUnitFromMeta(input: {
  parentAbs: string
  slugHint: string
  meta: Omit<PaperUnitMetaV1, 'version' | 'slug' | 'pdfFile' | 'importedAt'> & {
    bibtex?: string
    citeKey?: string
    source?: PaperUnitMetaV2['source']
    needsReview?: boolean
  }
}): Promise<{ unitDir: string; meta: PaperUnitMetaV2; reused: false }> {
  await mkdir(input.parentAbs, { recursive: true })
  const dir = await uniqueUnitDir(input.parentAbs, input.slugHint.slice(0, 80) || 'paper')
  await mkdir(dir, { recursive: true })
  const meta = {
    version: 2 as const,
    slug: basename(dir),
    importedAt: new Date().toISOString(),
    ...input.meta
  }
  await atomicWriteFile(paperMetaPath(dir), `${JSON.stringify(meta, null, 2)}\n`)
  await writeFile(join(dir, PAPER_NOTES_FILE_NAME), buildPaperNotesShell(meta), 'utf8')
  return { unitDir: dir, meta, reused: false }
}
