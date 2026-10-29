import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importPaperUnit, listPaperUnitsDeep } from './paper-unit-service'
import { importPaperBibtex } from './paper-library-service'
import { paperImportSourceForUnit } from './paper-import-sources'

vi.mock('./paper-identify-service', () => ({ identifyLocalPdf: vi.fn(async () => ({})) }))
let root: string
let fixed: string
let legacy: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kun-single-paper-space-'))
  fixed = join(root, 'fixed')
  legacy = join(root, 'legacy')
  await Promise.all([mkdir(join(fixed, 'papers'), { recursive: true }), mkdir(join(legacy, 'papers', 'old-group'), { recursive: true })])
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function oldUnit(): Promise<string> {
  const dir = join(legacy, 'papers', 'old-group', 'a')
  await mkdir(join(dir, 'marks'), { recursive: true })
  await writeFile(join(dir, 'paper.json'), JSON.stringify({ version: 2, slug: 'a', title: 'User edited title', authors: ['Author'],
    arxivId: '2401.12345', doi: '10.1234/example', year: '2025', pdfFile: 'original.pdf', importedAt: '2025-01-01T00:00:00Z', tags: ['keep'] }))
  await writeFile(join(dir, 'NOTES.md'), 'Private edited notes\n')
  await writeFile(join(dir, 'marks', 'notes.json'), '{"private":"mark"}')
  await writeFile(join(dir, 'original.pdf'), '%PDF-original-user-bytes')
  return dir
}

describe('fixed-space import and legacy-source reuse', () => {
  it('reuses legacy arXiv identities without moving files or replacing notes, marks, metadata or PDFs', async () => {
    const dir = await oldUnit()
    const before = await Promise.all(['paper.json', 'NOTES.md', 'marks/notes.json', 'original.pdf'].map((file) => readFile(join(dir, file), 'utf8')))
    const result = await importPaperUnit(join(fixed, 'papers'), { kind: 'arxiv', arxivId: '2401.12345v2' }, {}, {
      dedupeRootAbs: join(fixed, 'papers'), dedupeRootsAbs: [join(legacy, 'papers')]
    })
    expect(result).toMatchObject({ unitDir: dir, reused: true, meta: { title: 'User edited title' } })
    expect(await Promise.all(['paper.json', 'NOTES.md', 'marks/notes.json', 'original.pdf'].map((file) => readFile(join(dir, file), 'utf8')))).toEqual(before)
    expect(await listPaperUnitsDeep(join(fixed, 'papers'))).toEqual([])
    expect(paperImportSourceForUnit([{ workspaceRoot: fixed, papersAbs: join(fixed, 'papers') },
      { workspaceRoot: legacy, papersAbs: join(legacy, 'papers') }], fixed, result.unitDir)).toBe(legacy)
  })

  it('returns a successful reused BibTeX result with its source root, preserving edited content', async () => {
    const dir = await oldUnit()
    const result = await importPaperBibtex(fixed, join(fixed, 'papers'), '@article{incoming,title={Different title},doi={10.1234/EXAMPLE}}',
      undefined, join(fixed, 'papers'), [{ workspaceRoot: legacy, papersAbs: join(legacy, 'papers') }])
    expect(result).toMatchObject({ imported: 0, skipped: 1, entries: [{ ok: true, reused: true, workspaceRoot: legacy, unitDir: 'papers/old-group/a' }] })
    expect(await readFile(join(dir, 'NOTES.md'), 'utf8')).toBe('Private edited notes\n')
    expect(await listPaperUnitsDeep(join(fixed, 'papers'))).toEqual([])
  })

  it('serializes concurrent BibTeX allocations and also deduplicates entries in the same file', async () => {
    const entry = '@article{same,title={Concurrent Paper},year={2026},doi={10.1234/concurrent}}'
    const [first, second] = await Promise.all([
      importPaperBibtex(fixed, join(fixed, 'papers'), `${entry}\n${entry}`),
      importPaperBibtex(fixed, join(fixed, 'papers'), entry)
    ])
    expect(first.imported + second.imported).toBe(1)
    expect(first.entries.every((item) => item.ok)).toBe(true)
    expect(await listPaperUnitsDeep(join(fixed, 'papers'))).toHaveLength(1)
  })

  it('reuses identical local PDFs imported through different file names', async () => {
    const a = join(root, 'source-a.pdf')
    const b = join(root, 'source-b.pdf')
    await Promise.all([writeFile(a, '%PDF-1.4 same bytes'), writeFile(b, '%PDF-1.4 same bytes')])
    const first = await importPaperUnit(join(fixed, 'papers'), { kind: 'local', localPdfPath: a }, {}, { dedupeRootAbs: join(fixed, 'papers') })
    await writeFile(join(first.unitDir, 'NOTES.md'), 'User notes')
    const second = await importPaperUnit(join(fixed, 'papers'), { kind: 'local', localPdfPath: b }, {}, { dedupeRootAbs: join(fixed, 'papers') })
    expect(second).toMatchObject({ reused: true, unitDir: first.unitDir })
    expect(await readFile(join(first.unitDir, 'NOTES.md'), 'utf8')).toBe('User notes')
    expect(await readdir(join(fixed, 'papers'))).toHaveLength(1)
  })

  it('deduplicates Unicode title/year identities without conflating different titles', async () => {
    const result = await importPaperBibtex(fixed, join(fixed, 'papers'), [
      '@article{a,title={中文论文甲},year={2026}}',
      '@article{b,title={中文论文甲},year={2026}}',
      '@article{c,title={中文论文乙},year={2026}}'
    ].join('\n'))
    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(1)
  })

  it('does not treat a similarly prefixed directory as the source of a unit', () => {
    expect(paperImportSourceForUnit([{ workspaceRoot: fixed, papersAbs: join(fixed, 'papers') }], legacy,
      `${fixed}-other/papers/a`)).toBe(legacy)
  })
})
