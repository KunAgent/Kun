/**
 * Paper-mode library service: recursive scan of `<root>/<papersDir>` for paper
 * units (groups = subdirectories), meta patching with v1→v2 upgrade-on-write,
 * group moves, and trash. Paths reaching this file are already canonicalized
 * and contained inside the workspace by the IPC layer.
 */
import { basename, join, relative, sep } from 'node:path'
import { mkdir, readdir, readFile, rename } from 'node:fs/promises'
import {
  paperUnitMetaSchema,
  upgradePaperMeta,
  normalizePaperTags,
  type PaperUnitMetaV2
} from '../../../shared/paper/paper-meta-v2'
import type {
  PaperLibraryEntry,
  PaperLibraryMetaPatch
} from '../../../shared/paper/paper-library-types'
import { atomicWriteFile } from '../../atomic-json-file'
import { pathExists } from '../workspace-paths'
import {
  PaperUnitError,
  importPaperUnitFromMeta,
  listPaperUnits,
  paperMetaPath,
  paperTitleKey,
  workspaceRelativeDir
} from './paper-unit-service'
import {
  generatePaperBibtex,
  paperCiteKey,
  parseBibtexEntries
} from '../../../shared/paper/paper-bibtex'

/** Unit internals never hold nested units or groups. */
const PAPER_UNIT_CHILD_DIRS = new Set(['figures', 'marks', 'source', 'assets', '.cache'])
const SCAN_MAX_DEPTH = 3

export type ScannedPaperUnit = {
  /** Absolute unit dir. */
  dirAbs: string
  /** Library-root-relative unit dir (forward slashes). */
  unitDir: string
  meta: PaperUnitMetaV2
  /** Subgroup inside `<papersDir>/` ('' = top level). */
  group: string
  hasPdf: boolean
  hasNotes: boolean
  interpretationCount: number
}

function toSlashes(value: string): string {
  return value.split(sep).join('/')
}

/** Read `paper.json` accepting v1 or v2; upgrades v1 in memory only. */
export async function readPaperUnitMetaV2(unitDirAbs: string): Promise<PaperUnitMetaV2 | null> {
  try {
    const raw = await readFile(paperMetaPath(unitDirAbs), 'utf8')
    const parsed = paperUnitMetaSchema.safeParse(JSON.parse(raw))
    return parsed.success ? upgradePaperMeta(parsed.data) : null
  } catch {
    return null
  }
}

async function isPaperUnitDir(dirAbs: string): Promise<PaperUnitMetaV2 | null> {
  return readPaperUnitMetaV2(dirAbs)
}

async function scanDir(
  dirAbs: string,
  rootAbs: string,
  papersDirAbs: string,
  depth: number,
  out: ScannedPaperUnit[]
): Promise<void> {
  const meta = await isPaperUnitDir(dirAbs)
  if (meta) {
    const unitDir = toSlashes(relative(rootAbs, dirAbs))
    const group = toSlashes(relative(papersDirAbs, dirAbs))
      .split('/')
      .slice(0, -1)
      .join('/')
    let hasPdf = false
    let hasNotes = false
    try {
      const entries = await readdir(dirAbs, { withFileTypes: true })
      hasPdf = meta.pdfFile
        ? entries.some((entry) => entry.isFile() && entry.name === meta.pdfFile)
        : entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
      hasNotes = entries.some((entry) => entry.isFile() && entry.name === 'NOTES.md')
    } catch {
      // Unreadable unit dirs still surface with metadata only.
    }
    out.push({
      dirAbs,
      unitDir,
      meta,
      group,
      hasPdf,
      hasNotes,
      interpretationCount: meta.interpretations?.length ?? 0
    })
    return
  }
  if (depth >= SCAN_MAX_DEPTH) return
  let entries
  try {
    entries = await readdir(dirAbs, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.') || PAPER_UNIT_CHILD_DIRS.has(entry.name)) continue
    await scanDir(join(dirAbs, entry.name), rootAbs, papersDirAbs, depth + 1, out)
  }
}

/** Recursive unit scan under `<rootAbs>/<papersDir>` (depth ≤ 3 below it). */
export async function scanPaperLibrary(
  rootAbs: string,
  papersDirAbs: string
): Promise<ScannedPaperUnit[]> {
  const out: ScannedPaperUnit[] = []
  if (!(await pathExists(papersDirAbs))) return out
  let entries
  try {
    entries = await readdir(papersDirAbs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('.')) continue
    await scanDir(join(papersDirAbs, entry.name), rootAbs, papersDirAbs, 1, out)
  }
  out.sort((a, b) => a.unitDir.localeCompare(b.unitDir))
  return out
}

/**
 * Onboarding helper: scan each workspace for paper units so a folder that
 * already holds `<papersDir>/<unit>/paper.json` can be adopted as a library.
 */
export async function detectPaperLibraries(
  workspaces: readonly string[],
  papersDir: string
): Promise<{ workspaceRoot: string; unitCount: number }[]> {
  const candidates: { workspaceRoot: string; unitCount: number }[] = []
  for (const workspace of workspaces) {
    const root = workspace.trim()
    if (!root) continue
    const units = await listPaperUnits(join(root, papersDir))
    if (units.length > 0) candidates.push({ workspaceRoot: root, unitCount: units.length })
  }
  return candidates
}

function applyMetaPatch(meta: PaperUnitMetaV2, patch: PaperLibraryMetaPatch): PaperUnitMetaV2 {
  const next: PaperUnitMetaV2 = { ...meta, version: 2 }
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (title) next.title = title
  }
  if (patch.authors !== undefined) {
    next.authors = patch.authors.map((author) => author.trim()).filter(Boolean)
  }
  if (patch.abstract !== undefined) next.abstract = patch.abstract?.trim() || undefined
  if (patch.year !== undefined) next.year = patch.year?.trim() || undefined
  if (patch.venue !== undefined) next.venue = patch.venue?.trim() || undefined
  if (patch.arxivId !== undefined) next.arxivId = patch.arxivId?.trim() || undefined
  if (patch.doi !== undefined) next.doi = patch.doi?.trim() || undefined
  if (patch.tags !== undefined) next.tags = normalizePaperTags(patch.tags)
  if (patch.status !== undefined) {
    next.status = patch.status
    if (patch.status === 'read' && !next.readAt) next.readAt = new Date().toISOString()
    if (patch.status !== 'read') next.readAt = undefined
  }
  if (patch.rating !== undefined) {
    next.rating = patch.rating === null ? undefined : Math.min(5, Math.max(1, Math.round(patch.rating)))
  }
  if (patch.pdfFile !== undefined) next.pdfFile = patch.pdfFile?.trim() || undefined
  if (patch.needsReview !== undefined) next.needsReview = patch.needsReview || undefined
  return next
}

/**
 * Patch `paper.json`; the write upgrades the on-disk file to v2 because the
 * caller changed v2 fields (plan §5.2 — v1 files stay untouched until edited).
 */
export async function updatePaperUnitMetaV2(
  unitDirAbs: string,
  patch: PaperLibraryMetaPatch
): Promise<PaperUnitMetaV2> {
  const current = await readPaperUnitMetaV2(unitDirAbs)
  if (!current) {
    throw new PaperUnitError('invalid-unit', 'paper.json is missing or invalid.')
  }
  const next = applyMetaPatch(current, patch)
  await atomicWriteFile(paperMetaPath(unitDirAbs), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

/**
 * Move a unit into `<papersDir>/<group>` ('' = top level). Group names are
 * single path segments chains; '..' / separators escaping the papers dir are
 * rejected by the caller's containment check.
 */
export async function movePaperUnitToGroup(
  rootAbs: string,
  papersDirAbs: string,
  unitDirAbs: string,
  group: string
): Promise<{ unitDirAbs: string; unitDir: string }> {
  const insidePapers = toSlashes(relative(papersDirAbs, unitDirAbs))
  if (!insidePapers || insidePapers.startsWith('..') || insidePapers.startsWith('/')) {
    throw new PaperUnitError('invalid-unit', 'Paper unit is outside the papers directory.')
  }
  const targetParent = group ? join(papersDirAbs, group) : papersDirAbs
  const parentInside = toSlashes(relative(papersDirAbs, targetParent))
  if (parentInside.startsWith('..') || parentInside.startsWith('/')) {
    throw new PaperUnitError('invalid-unit', 'Group path escapes the papers directory.')
  }
  await mkdir(targetParent, { recursive: true })
  const target = join(targetParent, basename(unitDirAbs))
  if (target === unitDirAbs) {
    return { unitDirAbs: target, unitDir: toSlashes(relative(rootAbs, target)) }
  }
  if (await pathExists(target)) {
    throw new PaperUnitError('io', `A paper already exists at ${toSlashes(relative(rootAbs, target))}.`)
  }
  await rename(unitDirAbs, target)
  return { unitDirAbs: target, unitDir: toSlashes(relative(rootAbs, target)) }
}

/** List the subgroup dirs directly inside `<papersDir>/` (one level). */
export async function listPaperGroups(papersDirAbs: string): Promise<string[]> {
  const groups = new Set<string>()
  const collect = async (dirAbs: string, prefix: string, depth: number): Promise<void> => {
    if (depth > SCAN_MAX_DEPTH) return
    if (await isPaperUnitDir(dirAbs)) return
    let entries
    try {
      entries = await readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (PAPER_UNIT_CHILD_DIRS.has(entry.name)) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const childAbs = join(dirAbs, entry.name)
      if (await isPaperUnitDir(childAbs)) {
        groups.add(prefix)
        continue
      }
      await collect(childAbs, rel, depth + 1)
    }
  }
  if (await pathExists(papersDirAbs)) {
    try {
      const entries = await readdir(papersDirAbs, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const childAbs = join(papersDirAbs, entry.name)
        if (await isPaperUnitDir(childAbs)) continue
        groups.add(entry.name)
        await collect(childAbs, entry.name, 1)
      }
    } catch {
      // unreadable papers dir → no groups
    }
  }
  groups.delete('')
  return [...groups].sort((a, b) => a.localeCompare(b))
}

export type { PaperLibraryEntry }

export function scannedUnitToEntry(
  unit: ScannedPaperUnit,
  local?: { lastOpenedAt?: string; lastPage?: number; pageCount?: number }
): PaperLibraryEntry {
  return {
    unitDir: unit.unitDir,
    meta: unit.meta,
    hasPdf: unit.hasPdf,
    hasNotes: unit.hasNotes,
    interpretationCount: unit.interpretationCount,
    group: unit.group,
    ...(local?.lastOpenedAt ? { lastOpenedAt: local.lastOpenedAt } : {}),
    ...(local?.lastPage ? { lastPage: local.lastPage } : {}),
    ...(local?.pageCount ? { pageCount: local.pageCount } : {})
  }
}

// ---- BibTeX -------------------------------------------------------------------

/** `.bib` text for one unit dir or the whole scanned library. */
export async function exportPaperBibtex(
  rootAbs: string,
  papersDirAbs: string,
  unitDirAbs?: string
): Promise<string> {
  if (unitDirAbs) {
    const meta = await readPaperUnitMetaV2(unitDirAbs)
    if (!meta) throw new PaperUnitError('invalid-unit', 'paper.json is missing or invalid.')
    return `${generatePaperBibtex([meta])}`
  }
  const units = await scanPaperLibrary(rootAbs, papersDirAbs)
  return generatePaperBibtex(units.map((unit) => unit.meta))
}

export type PaperBibtexImportEntry = {
  citeKey: string
  ok: boolean
  unitDir?: string
  message?: string
}

/** Slug for a BibTeX-derived unit: first-author + year + title word. */
function bibtexSlug(fields: Record<string, string>, citeKey: string): string {
  const author = fields.author?.split(/\s+and\s+/)[0]?.split(/\s+/).filter(Boolean).at(-1) ?? ''
  const year = fields.year?.match(/\d{4}/)?.[0] ?? ''
  const word = fields.title?.toLowerCase().match(/[a-z0-9]{4,}/)?.[0] ?? ''
  const slug = [author.toLowerCase(), year, word].filter(Boolean).join('-').replace(/[^a-z0-9-]/g, '')
  return slug || citeKey.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'paper'
}

/**
 * Import `.bib` entries as metadata-only units (plan §PM4): dedupe by
 * arXiv → DOI → title+year; a hit on a unit missing its PDF attaches the PDF
 * url instead of duplicating the unit. `downloadPdfs` stays false here — PDF
 * fetching runs through the normal `paperImport` path afterwards.
 */
export async function importPaperBibtex(
  rootAbs: string,
  papersDirAbs: string,
  bibtex: string,
  signal?: AbortSignal
): Promise<{ imported: number; skipped: number; entries: PaperBibtexImportEntry[] }> {
  const parsed = parseBibtexEntries(bibtex)
  if (parsed.length === 0) {
    throw new PaperUnitError('invalid-input', 'No BibTeX entries found.')
  }
  const takenKeys = new Set<string>()
  const existing = await scanPaperLibrary(rootAbs, papersDirAbs)
  for (const unit of existing) {
    if (unit.meta.citeKey) takenKeys.add(unit.meta.citeKey)
  }
  const matchExisting = (ids: { arxivId?: string; doi?: string; title?: string; year?: string }) => {
    const wantTitle = ids.title ? paperTitleKey(ids.title) : ''
    return existing.find((unit) => {
      if (ids.arxivId && unit.meta.arxivId === ids.arxivId) return true
      if (ids.doi && unit.meta.doi?.toLowerCase() === ids.doi.toLowerCase()) return true
      if (wantTitle && ids.year && unit.meta.title && paperTitleKey(unit.meta.title) === wantTitle) {
        return !unit.meta.year || unit.meta.year === ids.year
      }
      return false
    })
  }
  const entries: PaperBibtexImportEntry[] = []
  let imported = 0
  let skipped = 0
  for (const entry of parsed) {
    if (signal?.aborted) break
    const fields = entry.fields
    const title = fields.title?.trim()
    if (!title) {
      entries.push({ citeKey: entry.citeKey, ok: false, message: 'entry has no title' })
      skipped += 1
      continue
    }
    const arxivId = fields.eprint ?? fields.arxivid
    const doi = fields.doi
    const year = fields.year?.match(/\d{4}/)?.[0]
    const hit = matchExisting({ arxivId, doi, title, year })
    if (hit) {
      entries.push({ citeKey: entry.citeKey, ok: false, unitDir: hit.unitDir, message: 'already in library' })
      skipped += 1
      continue
    }
    const citeKey = paperCiteKey(
      { citeKey: entry.citeKey, title, authors: [], year },
      takenKeys
    )
    takenKeys.add(citeKey)
    const created = await importPaperUnitFromMeta({
      parentAbs: papersDirAbs,
      slugHint: bibtexSlug(fields, citeKey),
      meta: {
        title,
        authors: fields.author?.split(/\s+and\s+/).map((a) => a.trim()).filter(Boolean) ?? [],
        abstract: fields.abstract,
        year,
        venue: fields.journal ?? fields.booktitle ?? fields.publisher,
        arxivId: arxivId?.replace(/^arXiv:/i, ''),
        doi,
        sourceUrl: fields.url,
        pdfUrl: fields.url?.toLowerCase().endsWith('.pdf') ? fields.url : undefined,
        bibtex: entry.raw,
        citeKey,
        source: 'bibtex'
      }
    })
    entries.push({ citeKey, ok: true, unitDir: workspaceRelativeDir(rootAbs, created.unitDir) })
    imported += 1
  }
  return { imported, skipped, entries }
}
