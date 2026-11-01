import { constants } from 'node:fs'
/**
 * Paper-unit filesystem store: import (arXiv / papers.cool / local PDF),
 * dedupe by arxivId or Cool Papers id, atomic `paper.json` writes, and unit
 * discovery for the sidebar. All paths handled here are already resolved
 * inside the workspace by the IPC layer.
 */
import { withPaperImportLock } from './paper-import-lock'
import { createHash } from 'node:crypto'
import { basename, join, relative } from 'node:path'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
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
  type PaperImportHintMeta,
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
import { downloadVerifiedOaPdf, isPaperOaAbort, type PaperOaFetchContext } from './paper-oa-import'
import type { PaperSearchCredentials } from '../../../../kun/src/services/paper-search/paper-search-types'

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

/** Unit internals never hold nested units or folders. */
const UNIT_CHILD_DIRS = new Set(['figures', 'marks', 'source', 'assets'])
const DEEP_LIST_MAX_DEPTH = 3

/**
 * Every unit under `rootAbs`, descending into folders (depth <= 3), so
 * import dedupe covers the whole papers dir instead of one target folder.
 */
export async function listPaperUnitsDeep(rootAbs: string): Promise<ResolvedPaperUnit[]> {
  const units: ResolvedPaperUnit[] = []
  const walk = async (dirAbs: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || UNIT_CHILD_DIRS.has(entry.name)) continue
      const dir = join(dirAbs, entry.name)
      const meta = await readPaperUnitMeta(dir)
      if (meta) units.push({ dir, meta })
      else if (depth < DEEP_LIST_MAX_DEPTH) await walk(dir, depth + 1)
    }
  }
  await walk(rootAbs, 0)
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

export type PaperImportOutcome = {
  unitDir: string
  meta: PaperUnitMeta
  reused: boolean
}

export type PaperImportOptions = {
  /**
   * Batch-import metadata from the caller (P3): when a search card already
   * resolved title/authors/identifiers, a DOI import can skip the Crossref
   * round-trip and seed the OA-PDF resolver directly.
   */
  prefetched?: PaperImportHintMeta
  /** Unpaywall/CORE/OpenAlex credentials for the OA-PDF chain. */
  credentials?: PaperSearchCredentials
  /**
   * Papers-dir root to dedupe against when importing into a folder below it,
   * so a paper already filed elsewhere is reused instead of duplicated.
   */
  dedupeRootAbs?: string
  dedupeRootsAbs?: readonly string[]
}

/**
 * Create a paper unit under `parentAbs`. Existing units are returned instead
 * of re-importing (`reused: true`).
 */
export async function importPaperUnit(
  parentAbs: string,
  resolution: PaperSourceResolution,
  fetch: PaperFetchContext & { onProgress?: PaperProgressReporter },
  options: PaperImportOptions = {}
): Promise<PaperImportOutcome> {
  return withPaperImportLock(options.dedupeRootAbs ?? parentAbs, () => {
    fetch.signal?.throwIfAborted()
    return importPaperUnitUnlocked(parentAbs, resolution, fetch, options)
  })
}

async function importPaperUnitUnlocked(
  parentAbs: string,
  resolution: PaperSourceResolution,
  fetch: PaperFetchContext & { onProgress?: PaperProgressReporter },
  options: PaperImportOptions = {}
): Promise<PaperImportOutcome> {
  const progress = fetch.onProgress ?? (() => undefined)
  const oaContext: PaperOaFetchContext = {
    signal: fetch.signal,
    proxyUrl: fetch.proxyUrl,
    credentials: options.credentials
  }
  await mkdir(parentAbs, { recursive: true })
  const roots = [...new Set([options.dedupeRootAbs ?? parentAbs, ...(options.dedupeRootsAbs ?? [])])]
  const findExisting = async (match: Parameters<typeof findPaperUnitByIds>[1]): Promise<ResolvedPaperUnit | null> => {
    for (const root of roots) {
      const hit = await findPaperUnitByIds(root, match, Boolean(options.dedupeRootAbs || options.dedupeRootsAbs))
      if (hit) return hit
    }
    return null
  }

  if (resolution.kind === 'local') {
    const sourcePath = resolution.localPdfPath
    const info = await stat(sourcePath).catch(() => null)
    if (!info?.isFile()) throw new PaperUnitError('invalid-input', 'Local PDF file not found.')

    // Identify the first pages (DOI / arXiv id) and fetch canonical metadata;
    // uncertain PDFs stay flagged `needsReview`.
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

    const existing = await findExisting({
      arxivId: fetched?.arxivId ?? identified.arxivId,
      doi: fetched?.doi ?? identified.doi,
      title: fetched?.title ?? identified.titleGuess,
      year: fetched?.year,
      originalPath: sourcePath
    })
    if (existing) {
      // Dedupe hit: when the existing unit is metadata-only, attach this PDF.
      if (!existing.meta.pdfFile) {
        const pdfFile = `${basename(existing.dir)}.pdf`
        await copyFile(sourcePath, join(existing.dir, pdfFile), constants.COPYFILE_EXCL)
        const meta = { ...existing.meta, pdfFile }
        await atomicWriteFile(paperMetaPath(existing.dir), `${JSON.stringify(meta, null, 2)}\n`)
        return { unitDir: existing.dir, meta, reused: true }
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
    // 4-way dedupe (plan P3.3): search cards carry DOI/title alongside the id.
    const existing = await findExisting({
      arxivId: resolution.arxivId,
      coolId: resolution.coolId,
      doi: options.prefetched?.doi,
      title: options.prefetched?.title,
      year: options.prefetched?.year
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
    const known = await findExisting({ doi: resolution.doi })
    if (known) return { unitDir: known.dir, meta: known.meta, reused: true }
    // Batch imports carry search-card metadata (`prefetched`); otherwise the
    // DOI resolves through Crossref as before.
    const prefetched = options.prefetched
    progress('metadata', prefetched?.title ? 'using search metadata' : 'resolving DOI via Crossref')
    const work = prefetched?.title
      ? {
          title: prefetched.title,
          authors: prefetched.authors ?? [],
          abstract: prefetched.abstract,
          year: prefetched.year,
          venue: prefetched.venue,
          doi: prefetched.doi ?? resolution.doi,
          arxivId: prefetched.arxivId,
          pdfUrl: prefetched.pdfUrl
        }
      : await fetchCrossrefWork(resolution.doi, fetch)
    if (!work?.title) {
      throw new PaperUnitError('not-found', `DOI ${resolution.doi} was not found.`)
    }
    const existing = await findExisting({
      arxivId: work.arxivId,
      doi: work.doi,
      coolId: prefetched?.coolId,
      title: work.title,
      year: work.year
    })
    if (existing) return { unitDir: existing.dir, meta: existing.meta, reused: true }
    if (work.arxivId) {
      return importPaperUnitUnlocked(parentAbs, {
        kind: 'arxiv',
        arxivId: work.arxivId,
        sourceUrl: resolution.sourceUrl
      }, fetch, options)
    }
    const slugHint = `doi-${work.doi.replace(/[^a-z0-9]+/gi, '-').slice(0, 48)}`
    const metaBase = {
      title: work.title,
      authors: work.authors,
      abstract: work.abstract,
      year: work.year,
      venue: work.venue,
      doi: work.doi,
      sourceUrl: resolution.sourceUrl ?? `https://doi.org/${work.doi}`,
      source: 'doi' as const
    }
    // P3 OA chain: hit pdfUrl → arXiv twin → Unpaywall → Europe PMC → CORE;
    // every download must pass the page-1 title check before it lands.
    progress('pdf', 'resolving open-access PDF')
    const downloaded = await downloadVerifiedOaPdf(
      { doi: work.doi, arxivId: work.arxivId, pdfUrl: work.pdfUrl, pmid: prefetched?.pmid },
      { title: work.title, doi: work.doi, arxivId: work.arxivId },
      oaContext
    ).catch((error) => {
      if (isPaperOaAbort(error, fetch.signal)) throw error
      return { status: 'rejected' as const, tried: 0 }
    })
    if (downloaded.status === 'ok') {
      const dir = await uniqueUnitDir(parentAbs, slugHint)
      await mkdir(dir, { recursive: true })
      const pdfFile = `${basename(dir)}.pdf`
      await writeFile(join(dir, pdfFile), downloaded.pdf)
      // `source` is a v2 field, so this unit is written as v2 from the start.
      const meta: PaperUnitMetaV2 = {
        version: 2,
        slug: basename(dir),
        ...metaBase,
        pdfUrl: downloaded.url,
        pdfFile,
        importedAt: new Date().toISOString()
      }
      await atomicWriteFile(paperMetaPath(dir), `${JSON.stringify(meta, null, 2)}\n`)
      await writeFile(join(dir, PAPER_NOTES_FILE_NAME), buildPaperNotesShell(meta), 'utf8')
      return { unitDir: dir, meta, reused: false }
    }
    return importPaperUnitFromMeta({
      parentAbs,
      slugHint,
      meta: {
        ...metaBase,
        pdfUrl: work.pdfUrl,
        // A rejected candidate means we probably saw the wrong file — flag it.
        ...(downloaded.status === 'rejected' && downloaded.tried > 0 ? { needsReview: true } : {})
      }
    })
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
      return importPaperUnitUnlocked(parentAbs, {
        kind: 'arxiv',
        arxivId: meta.arxivId,
        sourceUrl: resolution.url
      }, fetch, options)
    }
    if (meta.doi) {
      return importPaperUnitUnlocked(parentAbs, {
        kind: 'doi',
        doi: meta.doi,
        sourceUrl: resolution.url
      }, fetch, options)
    }
    const existing = await findExisting({ title: meta.title, year: meta.year })
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
      const downloaded = await downloadVerifiedOaPdf(
        { pdfUrl: meta.pdfUrl },
        { title: meta.title, doi: meta.doi, arxivId: meta.arxivId },
        oaContext
      ).catch((error) => {
        if (isPaperOaAbort(error, fetch.signal)) throw error
        return { status: 'rejected' as const, tried: 0 }
      })
      if (downloaded.status === 'ok') {
        const dir = await uniqueUnitDir(parentAbs, slugHint)
        await mkdir(dir, { recursive: true })
        const pdfFile = `${basename(dir)}.pdf`
        await writeFile(join(dir, pdfFile), downloaded.pdf)
        const unitMeta: PaperUnitMetaV2 = {
          version: 2,
          slug: basename(dir),
          importedAt: new Date().toISOString(),
          ...metaBase,
          pdfUrl: downloaded.url,
          pdfFile
        }
        await atomicWriteFile(paperMetaPath(dir), `${JSON.stringify(unitMeta, null, 2)}\n`)
        await writeFile(join(dir, PAPER_NOTES_FILE_NAME), buildPaperNotesShell(unitMeta), 'utf8')
        return { unitDir: dir, meta: unitMeta, reused: false }
      }
    }
    return importPaperUnitFromMeta({ parentAbs, slugHint, meta: metaBase })
  }

  // venue import via papers.cool citation_* metadata
  const existing = await findExisting({ coolId: resolution.coolId })
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

async function fileSha256(path: string): Promise<string | null> {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex')
  } catch {
    return null
  }
}

/** Normalized title key for dedupe: lowercase, alphanumeric only. */
export function paperTitleKey(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/**
 * Dedupe lookup for import flows (plan P3): arXiv id → DOI → papers.cool id →
 * normalized title+year, in that order. `deep` also searches nested folders.
 */
export async function findPaperUnitByIds(
  parentAbs: string,
  match: { arxivId?: string; doi?: string; coolId?: string; title?: string; year?: string; originalPath?: string },
  deep = false
): Promise<ResolvedPaperUnit | null> {
  const units = deep ? await listPaperUnitsDeep(parentAbs) : await listPaperUnits(parentAbs)
  const wantTitle = match.title ? paperTitleKey(match.title) : ''
  const identified = units.find((unit) => {
      if (match.originalPath && unit.meta.originalPath === match.originalPath) return true
      if (match.arxivId && unit.meta.arxivId?.replace(/v\d+$/i, '') === match.arxivId.replace(/v\d+$/i, '')) return true
      if (match.doi && unit.meta.doi?.toLowerCase() === match.doi.toLowerCase()) return true
      if (match.coolId && unit.meta.coolPapers?.id === match.coolId) return true
      if (wantTitle && match.year) {
        const sameTitle = unit.meta.title && paperTitleKey(unit.meta.title) === wantTitle
        if (sameTitle && (!unit.meta.year || unit.meta.year === match.year)) return true
      }
      return false
    })
  if (identified) return identified
  if (match.originalPath) {
    const digest = await fileSha256(match.originalPath)
    if (digest) for (const unit of units) {
      if (unit.meta.pdfFile && await fileSha256(join(unit.dir, unit.meta.pdfFile)) === digest) return unit
    }
  }
  return null
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
