import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exportPaperBibtex, movePaperUnitToGroup } from './paper-library-service'
import { readPaperVersion } from './paper-evidence-version'
import { PAPER_EVIDENCE_IDENTITY_FILE } from './paper-evidence-identity'
import { parseBibtexEntries } from '../../../shared/paper/paper-bibtex'
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }))
let root: string
let papers: string
let unit: string
const meta = { version: 2, slug: 'local-paper', title: 'Original result', authors: ['A. Author'],
  year: '2026', pdfFile: 'paper.pdf', importedAt: 'now', source: 'local-pdf' }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'evidence-bibtex-'))
  papers = join(root, 'papers')
  unit = join(papers, 'local-paper')
  await mkdir(unit, { recursive: true })
  await writeFile(join(unit, 'paper.json'), JSON.stringify(meta))
  await writeFile(join(unit, 'paper.pdf'), '%PDF-1.7\nlocal source bytes')
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const keys = (bibtex: string) => parseBibtexEntries(bibtex).map((entry) => entry.citeKey)

it('exports the exact evidence citation key after metadata edits and library group moves', async () => {
  const captured = (await readPaperVersion(unit)).snapshot
  expect(captured.canonicalId).toMatch(/^local:/)
  expect(keys(await exportPaperBibtex(root, papers, unit))).toEqual([captured.citeKey])
  expect(keys(await exportPaperBibtex(root, papers))).toEqual([captured.citeKey])
  const sidecarBefore = await readFile(join(unit, PAPER_EVIDENCE_IDENTITY_FILE), 'utf8')
  await writeFile(join(unit, 'paper.json'), JSON.stringify({ ...meta, title: 'Completely changed title', authors: ['New Author'], year: '2027' }))
  // BibTeX export must keep working without touching PDF bytes, even if removed.
  await rm(join(unit, 'paper.pdf'))
  expect(keys(await exportPaperBibtex(root, papers, unit))).toEqual([captured.citeKey])
  const moved = await movePaperUnitToGroup(root, papers, unit, 'reviewed')
  expect(keys(await exportPaperBibtex(root, papers, moved.unitDirAbs))).toEqual([captured.citeKey])
  expect(keys(await exportPaperBibtex(root, papers))).toEqual([captured.citeKey])
  expect(await readFile(join(moved.unitDirAbs, PAPER_EVIDENCE_IDENTITY_FILE), 'utf8')).toBe(sidecarBefore)
})

it('does not create an identity or read the PDF while exporting an uncaptured paper', async () => {
  await rm(join(unit, 'paper.pdf'))
  const metadataBefore = await readFile(join(unit, 'paper.json'), 'utf8')
  expect(keys(await exportPaperBibtex(root, papers, unit))).toEqual(['author2026original'])
  expect(keys(await exportPaperBibtex(root, papers))).toEqual(['author2026original'])
  await expect(access(join(unit, PAPER_EVIDENCE_IDENTITY_FILE))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(unit, 'paper.json'), 'utf8')).toBe(metadataBefore)
})

it('preserves explicit keys and imported BibTeX instead of replacing them with a fallback', async () => {
  await readPaperVersion(unit)
  await writeFile(join(unit, 'paper.json'), JSON.stringify({ ...meta, citeKey: 'UserChosenKey' }))
  expect(keys(await exportPaperBibtex(root, papers, unit))).toEqual(['UserChosenKey'])
  const rawBibtex = '@article{ImportedOriginalKey, title={Original result}, author={A. Author}}'
  await writeFile(join(unit, 'paper.json'), JSON.stringify({ ...meta, bibtex: rawBibtex }))
  expect(await exportPaperBibtex(root, papers, unit)).toBe(`${rawBibtex}\n`)
  expect(keys(await exportPaperBibtex(root, papers))).toEqual(['ImportedOriginalKey'])
})

it('does not overwrite a corrupt identity or silently export a mismatched fallback key', async () => {
  const path = join(unit, PAPER_EVIDENCE_IDENTITY_FILE)
  await writeFile(path, '{corrupt identity')
  await expect(exportPaperBibtex(root, papers, unit)).rejects.toMatchObject({ code: 'corrupt-identity' })
  expect(await readFile(path, 'utf8')).toBe('{corrupt identity')
})
