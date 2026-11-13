import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatexToolchainState } from '@shared/latex-toolchain'
import type { LatexTools } from '@shared/latex-project'
import { completedLatexBuild, installLatexSessionFixture, latexGate } from './latex-session-test-support'
import { latexSession, openLatexSession, patchLatex } from './latex-project-store'
import { releaseLatexSession } from './latex-session-lifecycle'
import { observeLatexToolchain } from './latex-toolchain-observer'

let fixture: ReturnType<typeof installLatexSessionFixture>
let handler: (state: LatexToolchainState) => void
const tools: LatexTools = { latexmk: '/managed/latexmk', engine: '/managed/pdflatex', synctex: null, searchedPaths: ['/managed'] }
const detect = vi.fn(async () => ({ ok: true as const, tools }))
const unsubscribe = vi.fn()
const ready: LatexToolchainState = { jobId: 'install', phase: 'ready', version: 'v2026.11', downloadedBytes: 100, totalBytes: 100, log: '', error: null }
beforeEach(async () => {
  vi.clearAllMocks()
  fixture = installLatexSessionFixture()
  Object.assign(window.kunGui, { latexDetectTools: detect, onLatexToolchainState: (listener: typeof handler) => { handler = listener; return unsubscribe } })
  await openLatexSession('/work', fixture.project.mainPath)
  patchLatex(fixture.key, { build: { ...completedLatexBuild('missing', 0, ''), status: 'missing-tools', pdf: null } })
})
afterEach(() => vi.unstubAllGlobals())
describe('paper status after background TeX installation', () => {
  it('refreshes tools and clears missing-tools status after the dialog is closed', async () => {
    const stop = observeLatexToolchain(fixture.key)
    handler(ready)
    await vi.waitFor(() => expect(latexSession(fixture.key)?.tools).toEqual(tools))
    expect(latexSession(fixture.key)?.build).toBeNull()
    stop()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
  it('does not send an old detection result to a reopened paper', async () => {
    const pending = latexGate<{ ok: true; tools: LatexTools }>()
    detect.mockReturnValueOnce(pending.promise)
    const stop = observeLatexToolchain(fixture.key)
    handler(ready)
    releaseLatexSession('/work', fixture.project.mainPath)
    await openLatexSession('/work', fixture.project.mainPath)
    pending.resolve({ ok: true, tools })
    await Promise.resolve()
    expect(latexSession(fixture.key)?.tools).toBeNull()
    stop()
  })
  it('discards results when the project configuration changes while detection is pending', async () => {
    const pending = latexGate<{ ok: true; tools: LatexTools }>()
    detect.mockReturnValueOnce(pending.promise)
    const stop = observeLatexToolchain(fixture.key)
    handler(ready)
    const project = latexSession(fixture.key)!.project
    patchLatex(fixture.key, { project: { ...project, config: { ...project.config, engine: 'xelatex' } } })
    pending.resolve({ ok: true, tools })
    await Promise.resolve()
    expect(latexSession(fixture.key)?.tools).toBeNull()
    stop()
  })
})
