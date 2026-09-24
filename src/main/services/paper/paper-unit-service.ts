/**
 * Paper-unit filesystem store: import (arXiv / papers.cool / local PDF),
 * dedupe by arxivId or Cool Papers id, atomic `paper.json` writes, and unit
 * discovery for the sidebar. All paths handled here are already resolved
 * inside the workspace by the IPC layer.
 */
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
  type PaperUnitMetaV1
} from '../../../shared/paper/paper-types'
import { atomicWriteFile } from '../../atomic-json-file'
import { pathExists } from '../workspace-paths'
import {
  downloadArxivPdf,
  downloadArxivPdfFromUrl,
  fetchArxivMeta,
  type PaperFetchContext
} from './arxiv-client'
import { fetchCoolPageMeta } from './coolpapers-client'

export type PaperProgressReporter = (stage: string, message?: string) => void

export type ResolvedPaperUnit = {
  /** Absolute path of the unit directory. */
  dir: string
  meta: PaperUnitMetaV1
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

export async function readPaperUnitMeta(unitDirAbs: string): Promise<PaperUnitMetaV1 | null> {
  try {
    const raw = await readFile(paperMetaPath(unitDirAbs), 'utf8')
    const parsed = paperUnitMetaV1Schema.safeParse(JSON.parse(raw))
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

/** Atomic `paper.json` rewrite; `mutate` receives a clone and returns the next meta. */
export async function updatePaperUnitMeta(
  unitDirAbs: string,
  mutate: (meta: PaperUnitMetaV1) => PaperUnitMetaV1
): Promise<PaperUnitMetaV1> {
  const current = await readPaperUnitMeta(unitDirAbs)
  if (!current) throw new PaperUnitError('invalid-unit', `${PAPER_META_FILE_NAME} is missing or invalid.`)
  const next = mutate(structuredClone(current))
  const checked = paperUnitMetaV1Schema.parse(next)
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
export function buildPaperNotesShell(meta: PaperUnitMetaV1): string {
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
  meta: PaperUnitMetaV1
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
    const slug = paperSlugForLocalFile(basename(sourcePath))
    progress('pdf', 'copying PDF')
    const dir = await uniqueUnitDir(parentAbs, slug)
    await mkdir(dir, { recursive: true })
    const pdfFile = `${basename(dir)}.pdf`
    await copyFile(sourcePath, join(dir, pdfFile))
    const meta: PaperUnitMetaV1 = {
      version: 1,
      slug: basename(dir),
      title: basename(sourcePath).replace(/\.pdf$/i, ''),
      authors: [],
      pdfFile,
      originalPath: sourcePath,
      importedAt: new Date().toISOString()
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
