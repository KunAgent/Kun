import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findPaperUnitByIds, importPaperUnit, listPaperUnitsDeep } from './paper-unit-service'
import {
  createPaperGroup,
  importPaperBibtex,
  listPaperGroups,
  movePaperUnitToGroup,
  normalizePaperGroupPath,
  scanPaperLibrary
} from './paper-library-service'

async function writeUnit(dir: string, meta: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'paper.json'),
    JSON.stringify({
      version: 1,
      slug: 'unit',
      title: 'A Paper',
      authors: [],
      pdfFile: 'unit.pdf',
      importedAt: '2026-09-27T00:00:00.000Z',
      ...meta
    })
  )
}

describe('paper folders', () => {
  let papers = ''

  beforeEach(async () => {
    papers = await mkdtemp(join(tmpdir(), 'paper-folders-'))
  })

  afterEach(async () => {
    await rm(papers, { recursive: true, force: true })
  })

  it('lists units in nested folders but not inside unit internals', async () => {
    await writeUnit(join(papers, 'top'), { arxivId: '2401.00001' })
    await writeUnit(join(papers, 'nlp', 'agents', 'deep', 'filed'), { arxivId: '2401.00002' })
    await writeUnit(join(papers, 'top', 'figures', 'ghost'), { arxivId: '2401.00003' })
    await writeUnit(join(papers, '.trash', 'old'), { arxivId: '2401.00004' })
    const units = await listPaperUnitsDeep(papers)
    expect(units.map((unit) => unit.meta.arxivId).sort()).toEqual(['2401.00001', '2401.00002'])
  })

  it('dedupes across folders only when searching deep', async () => {
    await writeUnit(join(papers, 'survey', 'filed'), { doi: '10.1234/abcd' })
    expect(await findPaperUnitByIds(papers, { doi: '10.1234/ABCD' })).toBeNull()
    const hit = await findPaperUnitByIds(papers, { doi: '10.1234/ABCD' }, true)
    expect(hit?.dir).toBe(join(papers, 'survey', 'filed'))
  })

  it('reuses a local PDF across folders even without paper identifiers', async () => {
    const source = join(papers, 'reading.pdf')
    await writeFile(source, '%PDF-1.4\n')
    const resolution = { kind: 'local' as const, localPdfPath: source }
    const first = await importPaperUnit(join(papers, 'survey', 'deep', 'filed'), resolution, {}, { dedupeRootAbs: papers })
    const second = await importPaperUnit(join(papers, 'other'), resolution, {}, { dedupeRootAbs: papers })
    expect(second.reused).toBe(true)
    expect(second.unitDir).toBe(first.unitDir)
    expect(await listPaperUnitsDeep(papers)).toHaveLength(1)
  })

  it('creates nested folders that show up as groups while empty', async () => {
    expect(await createPaperGroup(papers, ' reading / week 1 ')).toBe('reading/week 1')
    expect((await stat(join(papers, 'reading', 'week 1'))).isDirectory()).toBe(true)
    expect(await listPaperGroups(papers)).toEqual(['reading', 'reading/week 1'])
    expect(await createPaperGroup(papers, 'reading/week 1/notes')).toBe('reading/week 1/notes')
    expect(await listPaperGroups(papers)).toEqual(['reading', 'reading/week 1', 'reading/week 1/notes'])
    await writeUnit(join(papers, 'reading', 'week 1', 'notes', 'filed'), { doi: '10.1234/deep' })
    const units = await scanPaperLibrary(dirname(papers), papers)
    expect(units.map((unit) => unit.group)).toEqual(['reading/week 1/notes'])
  })

  it('imports BibTeX into the chosen folder and dedupes across the library', async () => {
    const bibtex = '@article{folder2026, title={Folder Target Check}, author={A. Test}, year={2026}}'
    const first = await importPaperBibtex(dirname(papers), papers, bibtex, undefined, join(papers, 'survey', 'deep'))
    expect(first.imported).toBe(1)
    expect((await scanPaperLibrary(dirname(papers), papers)).map((unit) => unit.group)).toEqual(['survey/deep'])
    const second = await importPaperBibtex(dirname(papers), papers, bibtex, undefined, join(papers, 'other'))
    expect(second.skipped).toBe(1)
    expect(await listPaperUnitsDeep(papers)).toHaveLength(1)
  })

  it('rejects unsafe or reserved folder names', async () => {
    await writeUnit(join(papers, 'paper-a'), {})
    await symlink(tmpdir(), join(papers, 'link-out'))
    for (const bad of ['', '..', '../x', '.hidden', 'a//b', '/a', 'a/', 'a/b/c/d', 'figures', 'a:b', 'paper-a/inner', 'link-out/inner']) {
      await expect(createPaperGroup(papers, bad)).rejects.toThrow()
    }
  })

  it('moves papers only into folders the library scan can see', async () => {
    const root = dirname(papers)
    await writeUnit(join(papers, 'paper-a'), {})
    await writeUnit(join(papers, 'paper-b'), {})
    const moved = await movePaperUnitToGroup(root, papers, join(papers, 'paper-a'), 'x/y/z')
    expect((await scanPaperLibrary(root, papers)).map((unit) => unit.group).sort()).toEqual(['', 'x/y/z'])
    const back = await movePaperUnitToGroup(root, papers, moved.unitDirAbs, '')
    expect(back.unitDirAbs).toBe(join(papers, 'paper-a'))
    for (const bad of ['a/b/c/d', '.hidden', 'figures', 'paper-b', 'paper-b/inner']) {
      await expect(movePaperUnitToGroup(root, papers, join(papers, 'paper-a'), bad)).rejects.toThrow()
    }
  })

  it('normalizes group paths with the top level allowed', () => {
    expect(normalizePaperGroupPath('')).toBe('')
    expect(normalizePaperGroupPath(' a / b ')).toBe('a/b')
    expect(normalizePaperGroupPath('a/b/c/d')).toBeNull()
    expect(normalizePaperGroupPath('a//b')).toBeNull()
  })
})
