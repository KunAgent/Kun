import { describe, expect, it, vi } from 'vitest'
import { latexApi } from './latex-api'

const mock = vi.hoisted(() => ({ invoke: vi.fn(async (_channel: string, _payload?: unknown) => ({ ok: true })),
  on: vi.fn((_channel: string, _listener: (event: unknown, payload: unknown) => void) => {}),
  removeListener: vi.fn((_channel: string, _listener: unknown) => {}) }))
vi.mock('electron', () => ({ ipcRenderer: mock }))
describe('LaTeX desktop bridge', () => {
  it('routes source, build and export operations to fixed channels', async () => {
    const target = { workspaceRoot: '/work', path: '/work/paper/main.tex' }
    await latexApi.latexReadProject(target)
    await latexApi.latexSave({ ...target, edits: [] })
    await latexApi.latexBuild({ ...target, buildId: 'build', sourceRevision: 2 })
    await latexApi.latexAbortBuild({ ...target, buildId: 'build' })
    await latexApi.latexExport({ ...target, format: 'pdf', sourceHash: 'hash' })
    expect(mock.invoke.mock.calls.map((call) => call[0])).toEqual(['latex:read-project', 'latex:save', 'latex:build', 'latex:abort-build', 'latex:export'])
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
