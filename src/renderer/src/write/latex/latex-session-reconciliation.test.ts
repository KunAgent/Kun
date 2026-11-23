import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLatex } from './latex-build-controller'
import { resolveLatexRevision } from './latex-revision'
import { configureLatex, editLatexBuffer, latexSession, loadLatexBuffer, openLatexSession, patchLatex, reconcileLatexProject, refreshLatexSources, saveLatexSession } from './latex-project-store'
import { releaseLatexSession } from './latex-session-lifecycle'
import { completedLatexBuild, installLatexSessionFixture, latexGate } from './latex-session-test-support'

vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }))
let fixture: ReturnType<typeof installLatexSessionFixture>
beforeEach(() => { fixture = installLatexSessionFixture() })
afterEach(() => vi.unstubAllGlobals())

describe('LaTeX project reconciliation', () => {
  it('reviews background disk changes before compiling a reactivated paper', async () => {
    const { key, project, disk, api } = fixture
    await openLatexSession('/work', project.mainPath)
    disk.set('main.tex', 'external source')
    await openLatexSession('/work', project.mainPath)
    expect(latexSession(key)?.review).toEqual([{ file: 'main.tex', before: 'original source', after: 'external source' }])
    expect(await buildLatex(key)).toBe(false)
    expect(api.latexBuild).not.toHaveBeenCalled()
    await resolveLatexRevision(key, 'accept')
    const current = latexSession(key)!
    expect(current.buffers['main.tex'].content).toBe('external source')
    expect(current.pdf?.sourceHash).toBe('external source')
    expect(current.pdfRevision).toBe(current.revision)
  })

  it('updates source selection and AI validation metadata when new files appear', async () => {
    const { key, project, disk } = fixture
    await openLatexSession('/work', project.mainPath)
    disk.set('sections/new.tex', 'new section')
    await openLatexSession('/work', `${project.rootPath}/sections/new.tex`)
    expect(latexSession(key)?.project.files).toContain('sections/new.tex')
    expect(latexSession(key)?.activeFile).toBe('sections/new.tex')
    expect(latexSession(key)?.buffers['sections/new.tex'].content).toBe('new section')
  })

  it('preserves both a local draft and an existing review across rediscovery', async () => {
    const { key, project, disk } = fixture
    await openLatexSession('/work', project.mainPath)
    editLatexBuffer(key, 'main.tex', 'local draft')
    disk.set('main.tex', 'external source')
    await refreshLatexSources(key)
    const review = latexSession(key)!.review
    await openLatexSession('/work', project.mainPath)
    expect(latexSession(key)?.review).toBe(review)
    expect(latexSession(key)?.buffers['main.tex'].content).toBe('local draft')
  })

  it('does not import a source load from a closed session into a reopened paper', async () => {
    const { key, project, disk, api } = fixture
    await openLatexSession('/work', project.mainPath)
    disk.set('part.tex', 'old part')
    const gate = latexGate<{ ok: true; content: string }>()
    api.latexReadSource.mockImplementationOnce(() => gate.promise)
    const loading = loadLatexBuffer(key, 'part.tex')
    releaseLatexSession('/work', project.mainPath)
    disk.set('part.tex', 'new part')
    await openLatexSession('/work', project.mainPath)
    gate.resolve({ ok: true, content: 'old part' })
    await loading
    expect(latexSession(key)?.buffers['part.tex']).toBeUndefined()
    await loadLatexBuffer(key, 'part.tex')
    expect(latexSession(key)?.buffers['part.tex'].content).toBe('new part')
  })

  it('rejects a raced refresh when typing advanced the local revision', async () => {
    const { key, project, api } = fixture
    await openLatexSession('/work', project.mainPath)
    const gate = latexGate<{ ok: true; content: string }>()
    api.latexReadSource.mockImplementationOnce(() => gate.promise)
    const refreshing = refreshLatexSources(key)
    editLatexBuffer(key, 'main.tex', 'newer typing')
    gate.resolve({ ok: true, content: 'external source' })
    await refreshing
    expect(latexSession(key)?.buffers['main.tex'].content).toBe('newer typing')
    expect(latexSession(key)?.review).toHaveLength(0)
  })

  it('does not roll back configuration with an earlier discovery response', async () => {
    const { key, project, api } = fixture
    await openLatexSession('/work', project.mainPath)
    const gate = latexGate<{ ok: true; project: typeof project }>()
    api.latexReadProject.mockImplementationOnce(() => gate.promise)
    const discovering = reconcileLatexProject(key)
    await configureLatex(key, { ...project.config, engine: 'lualatex' })
    gate.resolve({ ok: true, project })
    await discovering
    expect(latexSession(key)?.project.config.engine).toBe('lualatex')
  })

  it('waits for an old authorized save before loading a reopened paper', async () => {
    const { key, project, api, disk } = fixture
    await openLatexSession('/work', project.mainPath)
    const instance = latexSession(key)!.instanceId
    editLatexBuffer(key, 'main.tex', 'saved during close')
    const gate = latexGate<{ ok: true }>()
    api.latexSave.mockImplementationOnce(() => gate.promise)
    const saving = saveLatexSession('/work', project.mainPath)
    releaseLatexSession('/work', project.mainPath)
    const reopening = openLatexSession('/work', project.mainPath)
    disk.set('main.tex', 'saved during close')
    gate.resolve({ ok: true })
    expect(await saving).toBe(false)
    await reopening
    expect(latexSession(key)?.instanceId).not.toBe(instance)
    expect(latexSession(key)?.buffers['main.tex']).toMatchObject({ content: 'saved during close', saved: 'saved during close' })
    expect(latexSession(key)?.saving).toBe(false)
  })

  it('invalidates a cached PDF when a background figure changed without changing the file list', async () => {
    const { key, project, api, disk } = fixture
    disk.set('figure.png', 'original image')
    const hash = () => JSON.stringify([...disk.entries()])
    api.latexReadPdf.mockImplementation(async () => ({ ok: true, pdf: null, currentSourceHash: hash() }))
    await openLatexSession('/work', project.mainPath)
    patchLatex(key, { pdf: completedLatexBuild('cached', 0, hash()).pdf, pdfRevision: 0 })
    disk.set('figure.png', 'external image change')
    await reconcileLatexProject(key)
    expect(latexSession(key)?.pdfRevision).not.toBe(latexSession(key)?.revision)
    expect(latexSession(key)?.sourceObservation?.hash).toBe(hash())
    expect(api.latexReadPdf).toHaveBeenLastCalledWith(expect.objectContaining({ metadataOnly: true }))
  })

  it('keeps a build stale when a later digest observes newer physical inputs', async () => {
    const { key, project, api, disk } = fixture
    disk.set('figure.png', 'original image')
    const hash = () => JSON.stringify([...disk.entries()])
    api.latexReadPdf.mockImplementation(async () => ({ ok: true, pdf: null, currentSourceHash: hash() }))
    await openLatexSession('/work', project.mainPath)
    const originalHash = hash()
    const gate = latexGate<Awaited<ReturnType<typeof api.latexBuild>>>()
    api.latexBuild.mockImplementationOnce(() => gate.promise)
    const building = buildLatex(key)
    await vi.waitFor(() => expect(api.latexBuild).toHaveBeenCalled())
    const request = api.latexBuild.mock.calls[0][0]
    disk.set('figure.png', 'new image')
    await reconcileLatexProject(key)
    gate.resolve({ ok: true, build: completedLatexBuild(request.buildId, request.sourceRevision, originalHash) })
    await building
    expect(latexSession(key)?.pdf?.sourceHash).toBe(originalHash)
    expect(latexSession(key)?.pdfRevision).not.toBe(latexSession(key)?.revision)
  })
})
