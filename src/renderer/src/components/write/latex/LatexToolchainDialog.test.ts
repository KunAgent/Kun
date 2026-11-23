// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatexEngine, LatexTools } from '@shared/latex-project'
import type { LatexToolchainState, LatexToolchainStatus } from '@shared/latex-toolchain'
import { LatexToolchainDialog } from './LatexToolchainDialog'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const idle = (): LatexToolchainState => ({ jobId: null, phase: 'idle', version: null, downloadedBytes: 0, totalBytes: 0, log: '', error: null })
const absent: LatexTools = { latexmk: null, engine: null, synctex: null, searchedPaths: ['/tools'] }
const present: LatexTools = { latexmk: '/tools/latexmk', engine: '/tools/xelatex', synctex: null, searchedPaths: ['/tools'] }
const result = (state = idle(), tools = absent): { ok: true } & LatexToolchainStatus => ({ ok: true, state, tools, platform: 'darwin', supported: true, installRoot: '/kun/tools' })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
let root: Root
let host: HTMLDivElement
let listener: (state: LatexToolchainState) => void
let native: {
  latexToolchainStatus: ReturnType<typeof vi.fn>
  latexInstallTools: ReturnType<typeof vi.fn>
  latexCancelToolInstall: ReturnType<typeof vi.fn>
  latexChooseToolDirectory: ReturnType<typeof vi.fn>
  onLatexToolchainState: ReturnType<typeof vi.fn>
  openExternal: ReturnType<typeof vi.fn>
}
const onClose = vi.fn(), onCompile = vi.fn(), onDirectoryChange = vi.fn(), onTools = vi.fn(), unsubscribe = vi.fn()
const button = (label: string): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === label)!
async function render(engine: LatexEngine = 'xelatex', toolDirectory = ''): Promise<void> {
  await act(async () => root.render(createElement(LatexToolchainDialog, { engine, toolDirectory, onDirectoryChange, onTools, onCompile, onClose })))
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  native = {
    latexToolchainStatus: vi.fn(async () => result()), latexInstallTools: vi.fn(async () => ({ ok: true, state: idle() })),
    latexCancelToolInstall: vi.fn(async () => ({ ok: true })), latexChooseToolDirectory: vi.fn(async () => ({ ok: true, toolDirectory: '/existing/bin' })),
    onLatexToolchainState: vi.fn((handler) => { listener = handler; return unsubscribe }), openExternal: vi.fn(async () => {})
  }
  vi.stubGlobal('kunGui', native)
  Object.defineProperty(window, 'kunGui', { configurable: true, value: native })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('TeX environment setup', () => {
  it('detects without installing, supports an existing directory and cleans up progress subscriptions', async () => {
    await render()
    expect(native.latexToolchainStatus).toHaveBeenCalledWith({ engine: 'xelatex', toolDirectory: '' })
    expect(native.latexInstallTools).not.toHaveBeenCalled()
    await act(async () => button('latexUseExistingTools').click())
    expect(onDirectoryChange).toHaveBeenCalledWith('/existing/bin')
    await act(async () => root.unmount())
    expect(unsubscribe).toHaveBeenCalledOnce()
    root = createRoot(host)
  })
  it('shows progress, sends cancellation for the owned job and compiles after automatic re-detection', async () => {
    const installation = deferred<{ ok: true; state: LatexToolchainState }>()
    native.latexInstallTools.mockReturnValue(installation.promise)
    await render()
    await act(async () => button('latexInstallOneClick').click())
    const downloading: LatexToolchainState = { ...idle(), jobId: 'install-1', phase: 'downloading', downloadedBytes: 37, totalBytes: 100 }
    await act(async () => listener(downloading))
    expect(document.querySelector('progress')?.value).toBe(37)
    await act(async () => button('latexCancelInstall').click())
    expect(native.latexCancelToolInstall).toHaveBeenCalledWith({ jobId: 'install-1' })
    const ready: LatexToolchainState = { ...downloading, phase: 'ready' }
    native.latexToolchainStatus.mockResolvedValue(result(ready, present))
    await act(async () => { listener(ready); installation.resolve({ ok: true, state: ready }) })
    expect(onTools).toHaveBeenLastCalledWith(present)
    expect(button('latexReturnCompile')).toBeTruthy()
    await act(async () => button('latexReturnCompile').click())
    expect(onCompile).toHaveBeenCalledOnce()
  })
  it('does not replace live installation progress with a late idle detection response', async () => {
    const detection = deferred<ReturnType<typeof result>>()
    native.latexToolchainStatus.mockReturnValue(detection.promise)
    await render()
    await act(async () => listener({ ...idle(), jobId: 'active', phase: 'downloading', downloadedBytes: 60, totalBytes: 100 }))
    await act(async () => detection.resolve(result()))
    expect(document.querySelector('progress')?.value).toBe(60)
    expect(button('latexInstallOneClick')).toBeUndefined()
  })
  it('uses the current engine when an installation finishes after an engine change', async () => {
    const installation = deferred<{ ok: true; state: LatexToolchainState }>()
    native.latexInstallTools.mockReturnValue(installation.promise)
    await render('pdflatex')
    await act(async () => button('latexInstallOneClick').click())
    await render('xelatex')
    await act(async () => installation.resolve({ ok: true, state: { ...idle(), phase: 'ready' } }))
    expect(native.latexToolchainStatus).toHaveBeenLastCalledWith({ engine: 'xelatex', toolDirectory: '' })
  })
  it('resumes an existing installation when reopened and leaves it running when dismissed', async () => {
    native.latexToolchainStatus.mockResolvedValue(result({ ...idle(), jobId: 'ongoing', phase: 'configuring' }))
    await render()
    expect(document.body.textContent).toContain('latexInstallPhase_configuring')
    expect(native.latexInstallTools).not.toHaveBeenCalled()
    await act(async () => button('latexContinueWriting').click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(native.latexCancelToolInstall).not.toHaveBeenCalled()
  })
  it('can clear a custom tools directory and return to managed or system detection', async () => {
    await render('xelatex', '/old/tex/bin')
    await act(async () => button('latexRestoreAutoDetection').click())
    expect(onDirectoryChange).toHaveBeenCalledWith('')
  })
})
