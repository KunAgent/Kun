import { beforeEach, describe, expect, it, vi } from 'vitest'
import { latexApi } from './latex-api'

const mock = vi.hoisted(() => ({ invoke: vi.fn(async (_channel: string, _payload?: unknown) => ({ ok: true })),
  on: vi.fn((_channel: string, _listener: (event: unknown, payload: unknown) => void) => {}),
  removeListener: vi.fn((_channel: string, _listener: unknown) => {}) }))
vi.mock('electron', () => ({ ipcRenderer: mock }))
beforeEach(() => vi.clearAllMocks())
describe('LaTeX desktop bridge', () => {
  it('keeps installation and directory selection behind fixed native channels', async () => {
    await latexApi.latexToolchainStatus({ engine: 'xelatex', toolDirectory: '/tools' })
    await latexApi.latexInstallTools()
    await latexApi.latexCancelToolInstall({ jobId: 'owned-install' })
    await latexApi.latexChooseToolDirectory()
    expect(mock.invoke.mock.calls).toEqual([
      ['latex:toolchain-status', { engine: 'xelatex', toolDirectory: '/tools' }],
      ['latex:install-tools', {}], ['latex:cancel-tool-install', { jobId: 'owned-install' }], ['latex:choose-tool-directory', {}]
    ])
  })
  it('unsubscribes installation progress without removing another listener', () => {
    const handler = vi.fn()
    const unsubscribe = latexApi.onLatexToolchainState(handler)
    const listener = mock.on.mock.calls[0][1]
    listener({}, { phase: 'downloading', downloadedBytes: 100 })
    expect(handler).toHaveBeenCalledExactlyOnceWith({ phase: 'downloading', downloadedBytes: 100 })
    unsubscribe()
    expect(mock.removeListener).toHaveBeenCalledExactlyOnceWith('latex:toolchain-state', listener)
  })
  it('routes source, build and export operations to fixed channels', async () => {
    const target = { workspaceRoot: '/work', path: '/work/paper/main.tex' }
    await latexApi.latexReadProject(target)
    await latexApi.latexSave({ ...target, edits: [] })
    await latexApi.latexBuild({ ...target, buildId: 'build', sourceRevision: 2 })
    await latexApi.latexAbortBuild({ ...target, buildId: 'build' })
    await latexApi.latexExport({ ...target, format: 'pdf', sourceHash: 'hash' })
    await latexApi.latexReadPdf({ ...target, metadataOnly: true })
    expect(mock.invoke.mock.calls.map((call) => call[0])).toEqual(['latex:read-project', 'latex:save', 'latex:build', 'latex:abort-build', 'latex:export', 'latex:read-pdf'])
    expect(mock.invoke).toHaveBeenLastCalledWith('latex:read-pdf', { ...target, metadataOnly: true })
  })
  it('isolates native event arguments and removes the exact listener', () => {
    const handler = vi.fn()
    const unsubscribe = latexApi.onLatexBuildLog(handler)
    const listener = mock.on.mock.calls[0][1]
    listener({ sender: 'native' }, { buildId: 'build', text: 'output' })
    expect(handler).toHaveBeenCalledExactlyOnceWith({ buildId: 'build', text: 'output' })
    unsubscribe()
    expect(mock.removeListener).toHaveBeenCalledExactlyOnceWith('latex:build-log', listener)
  })
})
