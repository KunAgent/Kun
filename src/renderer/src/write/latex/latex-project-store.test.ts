import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatexProject, LatexBuild } from '@shared/latex-project'
import { buildLatex } from './latex-build-controller'
import { editLatexBuffer, latexSession, latexSessionKey, openLatexSession, patchLatex, saveLatexSession, useLatexProjectStore } from './latex-project-store'
import { resolveLatexRevision } from './latex-revision'
import { parseLatexAssistantEdits } from './latex-assistant-context'

vi.mock('../../store/chat-store', () => ({ useChatStore: { getState: () => ({ busy: false }), subscribe: vi.fn() } }))
vi.mock('../write-workspace-store', () => ({ useWriteWorkspaceStore: { getState: vi.fn() } }))
const project: LatexProject = { rootPath: '/work/paper', mainPath: '/work/paper/main.tex', mainCandidates: ['main.tex'], files: ['main.tex', 'intro.tex', 'refs.bib'],
  config: { version: 1, title: 'Paper', mainFile: 'main.tex', engine: 'pdflatex', autoBuild: true, toolDirectory: '', bibFile: 'refs.bib' } }
const key = latexSessionKey('/work', project.mainPath)
let api: { latexSave: ReturnType<typeof vi.fn>; latexBuild: ReturnType<typeof vi.fn> }
const completed = (sourceRevision: number): LatexBuild => ({ buildId: 'build', status: 'succeeded', sourceRevision, sourceHash: 'hash', durationMs: 10, completedAt: 1,
  diagnostics: [], log: '', pdf: { buildId: 'build', sourceHash: 'hash', dataBase64: 'pdf', mtimeMs: 1, size: 3 }, tools: { latexmk: '/tex', engine: '/tex', synctex: null, searchedPaths: [] } })
beforeEach(() => {
  useLatexProjectStore.setState({ sessions: {} })
  api = { latexSave: vi.fn(async () => ({ ok: true })), latexBuild: vi.fn(async (input) => ({ ok: true, build: completed(input.sourceRevision) })) }
  vi.stubGlobal('window', { kunGui: { ...api,
    latexReadProject: vi.fn(async () => ({ ok: true, project })),
    latexReadSource: vi.fn(async ({ path }) => ({ ok: true, content: path.endsWith('.bib') ? '' : 'source' })),
    latexReadPdf: vi.fn(async () => ({ ok: true, pdf: null, currentSourceHash: '' })),
    onLatexBuildLog: vi.fn(() => () => {})
  } })
})

describe('LaTeX document state and review', () => {
  it('uses one project session while switching source files', async () => {
    await openLatexSession('/work', project.mainPath)
    editLatexBuffer(key, 'main.tex', 'unsaved main')
    await openLatexSession('/work', '/work/paper/intro.tex')
    expect(Object.keys(useLatexProjectStore.getState().sessions)).toHaveLength(1)
    expect(latexSession(key)?.activeFile).toBe('intro.tex')
    expect(latexSession(key)?.buffers['main.tex'].content).toBe('unsaved main')
  })
  it('drains edits made during an in-flight save without parallel writes', async () => {
    await openLatexSession('/work', project.mainPath)
    let release!: (result: object) => void
    api.latexSave.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    editLatexBuffer(key, 'main.tex', 'first')
    const saving = saveLatexSession('/work', project.mainPath)
    editLatexBuffer(key, 'main.tex', 'newest')
    const second = saveLatexSession('/work', project.mainPath)
    expect(api.latexSave).toHaveBeenCalledTimes(1)
    release({ ok: true })
    expect(await saving).toBe(true)
    expect(await second).toBe(true)
    expect(api.latexSave).toHaveBeenCalledTimes(2)
    expect(latexSession(key)?.buffers['main.tex'].saved).toBe('newest')
  })
  it('marks a PDF with the captured revision while newer edits stay dirty', async () => {
    await openLatexSession('/work', project.mainPath)
    let release!: (result: object) => void
    api.latexBuild.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const compiling = buildLatex(key)
    await vi.waitFor(() => expect(api.latexBuild).toHaveBeenCalled())
    editLatexBuffer(key, 'main.tex', 'new draft')
    release({ ok: true, build: completed(0) })
    expect(await compiling).toBe(true)
    expect(latexSession(key)?.pdfRevision).toBe(0)
    expect(latexSession(key)?.revision).toBe(1)
  })
  it('stages a disk conflict for review and preserves the local draft when it is rejected', async () => {
    await openLatexSession('/work', project.mainPath)
    editLatexBuffer(key, 'main.tex', 'local draft')
    api.latexSave.mockResolvedValueOnce({ ok: false, message: 'Source changed on disk.' })
    vi.mocked(window.kunGui.latexReadSource).mockResolvedValue({ ok: true, content: 'external source' })
    expect(await saveLatexSession('/work', project.mainPath)).toBe(false)
    await vi.waitFor(() => expect(latexSession(key)?.review).toHaveLength(2))
    await resolveLatexRevision(key, 'reject')
    expect(api.latexSave).toHaveBeenLastCalledWith(expect.objectContaining({ edits: [{ file: 'main.tex', before: 'external source', after: 'local draft' }, { file: 'refs.bib', before: 'external source', after: '' }] }))
    expect(latexSession(key)?.buffers['main.tex'].saved).toBe('local draft')
  })
  it('does not save or compile rejected AI suggestions', async () => {
    await openLatexSession('/work', project.mainPath)
    patchLatex(key, { review: [{ file: 'main.tex', before: 'source', after: 'proposal' }] })
    await resolveLatexRevision(key, 'reject')
    expect(api.latexSave).not.toHaveBeenCalled()
    expect(api.latexBuild).not.toHaveBeenCalled()
    expect(latexSession(key)?.buffers['main.tex'].content).toBe('source')
  })
  it('allows rejecting an outdated proposal without losing newer local edits', async () => {
    await openLatexSession('/work', project.mainPath)
    editLatexBuffer(key, 'main.tex', 'newer local draft')
    patchLatex(key, { review: [{ file: 'main.tex', before: 'source', after: 'outdated proposal' }] })
    await resolveLatexRevision(key, 'accept')
    expect(latexSession(key)?.review).toHaveLength(1)
    await resolveLatexRevision(key, 'reject')
    expect(latexSession(key)?.review).toHaveLength(0)
    expect(latexSession(key)?.buffers['main.tex'].content).toBe('newer local draft')
    expect(api.latexSave).not.toHaveBeenCalled()
  })
  it('validates assistant proposals against the captured source and saves accepted changes', async () => {
    await openLatexSession('/work', project.mainPath)
    const text = '```kun-latex-edits\n' + JSON.stringify({ edits: [{ file: 'main.tex', before: 'source', after: 'fixed source' }] }) + '\n```'
    patchLatex(key, { review: parseLatexAssistantEdits(key, text) })
    await resolveLatexRevision(key, 'accept')
    expect(api.latexSave).toHaveBeenCalledTimes(1)
    expect(api.latexBuild).toHaveBeenCalledTimes(1)
    expect(latexSession(key)?.buffers['main.tex'].saved).toBe('fixed source')
    expect(() => parseLatexAssistantEdits(key, text)).toThrow('changed')
  })
  it('compiles the accepted subset after the remaining proposals are rejected', async () => {
    await openLatexSession('/work', '/work/paper/intro.tex')
    patchLatex(key, { review: [{ file: 'main.tex', before: 'source', after: 'accepted' }, { file: 'intro.tex', before: 'source', after: 'rejected' }] })
    await resolveLatexRevision(key, 'accept', 'main.tex')
    expect(api.latexSave).not.toHaveBeenCalled()
    await resolveLatexRevision(key, 'reject', 'intro.tex')
    expect(api.latexSave).toHaveBeenCalledWith(expect.objectContaining({ edits: [{ file: 'main.tex', before: 'source', after: 'accepted' }] }))
    expect(api.latexBuild).toHaveBeenCalledTimes(1)
    expect(latexSession(key)?.buffers['intro.tex'].content).toBe('source')
  })
})
