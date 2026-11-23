import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { configureLatex, editLatexBuffer, latexSession, latexSessionKey, patchLatex, useLatexProjectStore } from './latex/latex-project-store'
import { installLatexSessionFixture, latexGate } from './latex/latex-session-test-support'

vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }))
let fixture: ReturnType<typeof installLatexSessionFixture>
let refreshWorkspace: ReturnType<typeof useWriteWorkspaceStore.getState>['refreshWorkspace']
let deleteFile: ReturnType<typeof vi.fn<(input: { path: string }) => Promise<{ ok: true; path: string }>>>
beforeEach(() => {
  fixture = installLatexSessionFixture()
  refreshWorkspace = useWriteWorkspaceStore.getState().refreshWorkspace
  deleteFile = vi.fn(async ({ path }) => {
    fixture.disk.delete(path.slice(fixture.project.rootPath.length + 1))
    return { ok: true, path }
  })
  Object.assign(fixture.api, { deleteWorkspaceEntry: deleteFile })
  useWriteWorkspaceStore.setState({ workspaceRoot: '/work', autoSaveEnabled: false, refreshWorkspace: vi.fn(async () => {}) })
})
afterEach(() => {
  useWriteWorkspaceStore.getState().resetWorkspace()
  useWriteWorkspaceStore.setState({ refreshWorkspace })
  useLatexProjectStore.setState({ sessions: {} })
  vi.unstubAllGlobals()
})

describe('LaTeX main-file deletion in Work', () => {
  it('moves the paper tab to its selected main and keeps drafts when the old anchor is deleted', async () => {
    const { key, project, disk } = fixture
    disk.set('new-main.tex', 'saved new body')
    await useWriteWorkspaceStore.getState().openFile('/work', project.mainPath)
    await configureLatex(key, { ...project.config, mainFile: 'new-main.tex' })
    await useWriteWorkspaceStore.getState().openFile('/work', `${project.rootPath}/new-main.tex`)
    editLatexBuffer(key, 'new-main.tex', 'unsaved new body')
    const originalInstance = latexSession(key)!.instanceId
    expect(await useWriteWorkspaceStore.getState().deleteEntry('/work', project.mainPath)).toBe(true)
    const path = `${project.rootPath}/new-main.tex`
    const current = latexSession(latexSessionKey('/work', path))!
    expect(current.instanceId).not.toBe(originalInstance)
    expect(current.buffers['new-main.tex'].content).toBe('unsaved new body')
    expect(current.project.config.mainFile).toBe('new-main.tex')
    expect(latexSession(key)).toBeUndefined()
    expect(disk.get('new-main.tex')).toBe('saved new body')
    const state = useWriteWorkspaceStore.getState()
    expect(state.activeFilePath).toBe(path)
    expect(state.documentsByPath[path]?.kind).toBe('latex')
    expect(state.editorLayout.groups[0].tabs).toEqual([{ path, viewMode: 'plain' }])
  })

  it('saves other source drafts and locks edits before deleting the last main file', async () => {
    const { key, project, disk, api } = fixture
    await useWriteWorkspaceStore.getState().openFile('/work', project.mainPath)
    editLatexBuffer(key, 'refs.bib', '@article{kept,title={Saved bibliography}}')
    const gate = latexGate<{ ok: true; path: string }>()
    deleteFile.mockImplementationOnce(() => gate.promise)
    const deleting = useWriteWorkspaceStore.getState().deleteEntry('/work', project.mainPath)
    await vi.waitFor(() => expect(deleteFile).toHaveBeenCalled())
    expect(disk.get('refs.bib')).toContain('Saved bibliography')
    expect(api.latexSave).toHaveBeenCalledTimes(1)
    expect(latexSession(key)?.deleting).toBe(true)
    editLatexBuffer(key, 'refs.bib', 'typing after deletion started')
    expect(latexSession(key)?.buffers['refs.bib'].content).toContain('Saved bibliography')
    gate.resolve({ ok: true, path: project.mainPath })
    expect(await deleting).toBe(true)
    expect(latexSession(key)).toBeUndefined()
    expect(disk.get('refs.bib')).toContain('Saved bibliography')
  })

  it('does not delete a main file while another source has an unresolved review', async () => {
    const { key, project } = fixture
    await useWriteWorkspaceStore.getState().openFile('/work', project.mainPath)
    patchLatex(key, { review: [{ file: 'refs.bib', before: '', after: 'proposed bibliography' }] })
    expect(await useWriteWorkspaceStore.getState().deleteEntry('/work', project.mainPath)).toBe(false)
    expect(deleteFile).not.toHaveBeenCalled()
    expect(latexSession(key)?.review).toHaveLength(1)
  })

  it('aborts deletion when another draft cannot be persisted', async () => {
    const { key, project, api } = fixture
    await useWriteWorkspaceStore.getState().openFile('/work', project.mainPath)
    editLatexBuffer(key, 'refs.bib', 'unsaved bibliography')
    api.latexSave.mockResolvedValueOnce({ ok: false, message: 'disk error' })
    expect(await useWriteWorkspaceStore.getState().deleteEntry('/work', project.mainPath)).toBe(false)
    expect(deleteFile).not.toHaveBeenCalled()
    expect(latexSession(key)?.deleting).toBe(false)
    expect(latexSession(key)?.buffers['refs.bib'].content).toBe('unsaved bibliography')
  })
})
