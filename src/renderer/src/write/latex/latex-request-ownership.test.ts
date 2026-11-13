import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KunGuiLatexApi } from '@shared/latex-project'
import { buildLatex } from './latex-build-controller'
import { editLatexBuffer, latexSession, openLatexSession, refreshLatexSources } from './latex-project-store'
import { proposeLatexRevision } from './latex-revision'
import { releaseLatexSession } from './latex-session-lifecycle'
import { completedLatexBuild, installLatexSessionFixture, latexGate } from './latex-session-test-support'

vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }))
let fixture: ReturnType<typeof installLatexSessionFixture>
beforeEach(() => { fixture = installLatexSessionFixture() })
afterEach(() => vi.unstubAllGlobals())

describe('LaTeX asynchronous request ownership', () => {
  it('discards late successful builds after close and reopen, including their logs', async () => {
    const { key, project, disk, api } = fixture
    await openLatexSession('/work', project.mainPath)
    const gate = latexGate<Awaited<ReturnType<KunGuiLatexApi['latexBuild']>>>()
    api.latexBuild.mockImplementationOnce(() => gate.promise)
    const building = buildLatex(key)
    await vi.waitFor(() => expect(api.latexBuild).toHaveBeenCalled())
    const input = api.latexBuild.mock.calls[0][0]
    const logger = api.onLatexBuildLog.mock.calls[0][0]
    releaseLatexSession('/work', project.mainPath)
    expect(api.latexAbortBuild).toHaveBeenCalled()
    disk.set('main.tex', 'reopened source')
    await openLatexSession('/work', project.mainPath)
    logger({ buildId: input.buildId, text: 'old log' })
    gate.resolve({ ok: true, build: completedLatexBuild(input.buildId, input.sourceRevision, 'old source') })
    expect(await building).toBe(false)
    expect(latexSession(key)?.pdf).toBeNull()
    expect(latexSession(key)?.log).toBe('')
    expect(latexSession(key)?.buildId).toBeNull()
  })

  it('waits for the cancelled previous owner before starting a reopened build', async () => {
    const { key, project, disk, api } = fixture
    await openLatexSession('/work', project.mainPath)
    const gate = latexGate<Awaited<ReturnType<KunGuiLatexApi['latexBuild']>>>()
    api.latexBuild.mockImplementationOnce(() => gate.promise)
    const old = buildLatex(key)
    await vi.waitFor(() => expect(api.latexBuild).toHaveBeenCalledTimes(1))
    const input = api.latexBuild.mock.calls[0][0]
    releaseLatexSession('/work', project.mainPath)
    disk.set('main.tex', 'new source')
    await openLatexSession('/work', project.mainPath)
    const current = buildLatex(key)
    expect(api.latexBuild).toHaveBeenCalledTimes(1)
    gate.resolve({ ok: true, build: completedLatexBuild(input.buildId, input.sourceRevision, 'old source') })
    expect(await old).toBe(false)
    expect(await current).toBe(true)
    expect(latexSession(key)?.pdf?.sourceHash).toBe('new source')
    expect(api.latexBuild).toHaveBeenCalledTimes(2)
  })

  it('keeps an external review that arrived while an AI request was pending', async () => {
    const { key, project, disk, api } = fixture
    await openLatexSession('/work', project.mainPath)
    const gate = latexGate<Awaited<ReturnType<KunGuiLatexApi['latexProposeFix']>>>()
    api.latexProposeFix.mockImplementationOnce(() => gate.promise)
    const request = proposeLatexRevision(key, 'repair')
    await vi.waitFor(() => expect(api.latexProposeFix).toHaveBeenCalled())
    disk.set('main.tex', 'external edit')
    await refreshLatexSources(key)
    const review = latexSession(key)!.review
    gate.resolve({ ok: true, edits: [{ file: 'main.tex', before: 'original source', after: 'stale AI edit' }] })
    await request
    expect(latexSession(key)?.review).toBe(review)
    expect(latexSession(key)?.reviewOrigin).toBe('external')
    expect(latexSession(key)?.proposing).toBe(false)
    expect(disk.get('main.tex')).toBe('external edit')
  })

  it('discards an AI proposal after its source changed', async () => {
    const { key, project, api } = fixture
    await openLatexSession('/work', project.mainPath)
    const gate = latexGate<Awaited<ReturnType<KunGuiLatexApi['latexProposeFix']>>>()
    api.latexProposeFix.mockImplementationOnce(() => gate.promise)
    const request = proposeLatexRevision(key, 'repair')
    await vi.waitFor(() => expect(api.latexProposeFix).toHaveBeenCalled())
    editLatexBuffer(key, 'main.tex', 'newer draft')
    gate.resolve({ ok: true, edits: [{ file: 'main.tex', before: 'original source', after: 'stale AI edit' }] })
    await request
    expect(latexSession(key)?.review).toHaveLength(0)
    expect(latexSession(key)?.buffers['main.tex'].content).toBe('newer draft')
  })

  it('does not apply a previous session AI response to a reopened paper', async () => {
    const { key, project, api } = fixture
    await openLatexSession('/work', project.mainPath)
    const gate = latexGate<Awaited<ReturnType<KunGuiLatexApi['latexProposeFix']>>>()
    api.latexProposeFix.mockImplementationOnce(() => gate.promise)
    const request = proposeLatexRevision(key, 'repair')
    await vi.waitFor(() => expect(api.latexProposeFix).toHaveBeenCalled())
    releaseLatexSession('/work', project.mainPath)
    await openLatexSession('/work', project.mainPath)
    gate.resolve({ ok: true, edits: [{ file: 'main.tex', before: 'original source', after: 'old request' }] })
    await request
    expect(latexSession(key)?.review).toHaveLength(0)
    expect(latexSession(key)?.error).toBeNull()
  })
})
