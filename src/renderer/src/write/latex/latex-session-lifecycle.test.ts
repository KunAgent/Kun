import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatexProject } from '@shared/latex-project'
import { editLatexBuffer, latexSession, latexSessionKey, openLatexSession, patchLatex, useLatexProjectStore } from './latex-project-store'
import { forgetLatexEntry, releaseLatexWorkspace, relocateLatexSessions } from './latex-session-lifecycle'

const project: LatexProject = { rootPath: '/work/paper', mainPath: '/work/paper/main.tex', mainCandidates: ['main.tex'], files: ['main.tex', 'intro.tex'],
  config: { version: 1, title: 'Paper', mainFile: 'main.tex', engine: 'pdflatex', autoBuild: true, toolDirectory: '', bibFile: 'refs.bib' } }
const key = latexSessionKey('/work', project.mainPath)
beforeEach(() => {
  useLatexProjectStore.setState({ sessions: {} })
  vi.stubGlobal('window', { kunGui: {
    latexReadProject: vi.fn(async () => ({ ok: true, project })),
    latexReadSource: vi.fn(async () => ({ ok: true, content: 'source' })),
    latexReadPdf: vi.fn(async () => ({ ok: true, pdf: null, currentSourceHash: '' })),
    latexAbortBuild: vi.fn(async () => ({ ok: true }))
  } })
})

describe('LaTeX Work file lifecycle', () => {
  it('keeps unsaved drafts and pending proposals across workspace navigation until discarded', async () => {
    await openLatexSession('/work', project.mainPath)
    editLatexBuffer(key, 'main.tex', 'local draft')
    releaseLatexWorkspace('/work')
    expect(latexSession(key)?.buffers['main.tex'].content).toBe('local draft')
    patchLatex(key, { review: [{ file: 'main.tex', before: 'local draft', after: 'proposal' }] })
    releaseLatexWorkspace('/work')
    expect(latexSession(key)?.review).toHaveLength(1)
    releaseLatexWorkspace('/work', true)
    expect(latexSession(key)).toBeUndefined()
  })
  it('moves the whole project session and its draft when its folder is renamed', async () => {
    await openLatexSession('/work', project.mainPath)
    editLatexBuffer(key, 'main.tex', 'local draft')
    relocateLatexSessions('/work', '/work/paper', '/work/renamed')
    const moved = latexSession(latexSessionKey('/work', '/work/renamed/main.tex'))
    expect(latexSession(key)).toBeUndefined()
    expect(moved?.project.rootPath).toBe('/work/renamed')
    expect(moved?.buffers['main.tex'].content).toBe('local draft')
    expect(moved?.project.config.mainFile).toBe('main.tex')
  })
  it('updates a main filename without losing its buffer', async () => {
    await openLatexSession('/work', project.mainPath)
    relocateLatexSessions('/work', project.mainPath, '/work/paper/paper.tex')
    const moved = latexSession(latexSessionKey('/work', '/work/paper/paper.tex'))
    expect(moved?.project.config.mainFile).toBe('paper.tex')
    expect(moved?.buffers['paper.tex'].content).toBe('source')
  })
  it('forgets deleted sources and leaves unrelated entries alone', async () => {
    await openLatexSession('/work', '/work/paper/intro.tex')
    patchLatex(key, { pdfRevision: 4 })
    forgetLatexEntry('/work', '/work/other.txt')
    expect(latexSession(key)?.pdfRevision).toBe(4)
    forgetLatexEntry('/work', '/work/paper/intro.tex')
    expect(latexSession(key)?.buffers['intro.tex']).toBeUndefined()
    expect(latexSession(key)?.activeFile).toBe('main.tex')
    forgetLatexEntry('/work', '/work/paper')
    expect(latexSession(key)).toBeUndefined()
  })
  it('normalizes Windows path separators for the document identity', () => {
    expect(latexSessionKey('C:\\Work', 'C:\\Work\\paper\\main.tex')).toBe(latexSessionKey('C:/Work', 'C:/Work/paper/main.tex'))
  })
})
