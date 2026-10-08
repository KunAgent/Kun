import { describe, expect, it } from 'vitest'
import type { PaperUnitMeta } from '@shared/paper/paper-meta-v2'
import { writePaperReference } from './write-paper-reference'

const meta = {
  version: 2, slug: 'swe', title: 'SWE-Explore', authors: ['A. Author'], year: '2026',
  venue: 'arXiv', arxivId: '2609.01481', pdfFile: 'swe.pdf', importedAt: '2026-10-09'
} as PaperUnitMeta
const unitFiles = [
  { name: 'paper.json', path: '/space/papers/swe/paper.json', type: 'file' },
  { name: 'paper.md', path: '/space/papers/swe/paper.md', type: 'file' },
  { name: 'NOTES.md', path: '/space/papers/swe/NOTES.md', type: 'file' }
] as never

describe('the open paper as Work context', () => {
  it('names the paper and its workspace-relative text, notes, PDF and reader page', () => {
    expect(writePaperReference(
      { workspaceRoot: '/space', activeFilePath: '/space/papers/swe/swe.pdf', entriesByDir: { '/space/papers/swe': unitFiles } },
      { entries: [{ unitDir: 'papers/swe', meta }], unitsByDir: {}, readerPage: { unitDir: 'papers/swe', page: 4, pageCount: 20 } }
    )).toEqual({
      title: 'SWE-Explore', authors: ['A. Author'], year: '2026', venue: 'arXiv', arxivId: '2609.01481',
      unitLocator: 'papers/swe', textLocator: 'papers/swe/paper.md', notesLocator: 'papers/swe/NOTES.md',
      pdfLocator: 'papers/swe/swe.pdf', page: 4, pageCount: 20
    })
  })

  it('finds the unit from known library units before the tree has loaded, without claiming paper.md', () => {
    const reference = writePaperReference(
      { workspaceRoot: '/space', activeFilePath: '/space/papers/swe/swe.pdf', entriesByDir: {} },
      { entries: [], unitsByDir: { 'papers/swe': meta }, readerPage: { unitDir: 'papers/other', page: 2, pageCount: 9 } }
    )
    expect(reference).toMatchObject({ unitLocator: 'papers/swe', pdfLocator: 'papers/swe/swe.pdf' })
    expect(reference).not.toHaveProperty('textLocator')
    expect(reference).not.toHaveProperty('page')
  })

  it('trusts preprocessing and the library index before the tree lists the unit', () => {
    const preprocessed = { ...meta, preprocess: { textStatus: 'ok', figuresStatus: 'none' } } as PaperUnitMeta
    expect(writePaperReference(
      { workspaceRoot: '/space', activeFilePath: '/space/papers/swe/swe.pdf', entriesByDir: {} },
      { entries: [{ unitDir: 'papers/swe', meta: preprocessed, hasNotes: true }], unitsByDir: {}, readerPage: null }
    )).toMatchObject({ textLocator: 'papers/swe/paper.md', notesLocator: 'papers/swe/NOTES.md' })
  })

  it('is absent for ordinary documents', () => {
    expect(writePaperReference(
      { workspaceRoot: '/space', activeFilePath: '/space/notes/draft.md', entriesByDir: {} },
      { entries: [{ unitDir: 'papers/swe', meta }], unitsByDir: {}, readerPage: null }
    )).toBeUndefined()
  })
})
