import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatexProject } from '@shared/latex-project'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { createWriteDocumentSession } from './write-editor-layout'
import { openWriteDocumentState } from './write-workspace-file-action-helpers'
import { editLatexBuffer, latexSession, latexSessionKey, useLatexProjectStore } from './latex/latex-project-store'
import { workbenchWriteSourceContext } from '../components/workbench/workbench-write-source-reference'

vi.mock('../i18n', () => ({ default: { t: (key: string) => key } }))

const workspaceRoot = '/tmp/write'
const project: LatexProject = { rootPath: '/tmp/write/paper', mainPath: '/tmp/write/paper/main.tex', mainCandidates: ['main.tex'], files: ['main.tex', 'intro.tex'],
  config: { version: 1, title: 'Paper', mainFile: 'main.tex', engine: 'pdflatex', autoBuild: false, toolDirectory: '', bibFile: 'references.bib' } }
const key = latexSessionKey(workspaceRoot, project.mainPath)
const save = vi.fn(async () => ({ ok: true }))
const write = vi.fn(async (input: { path: string; content: string }) => ({ ok: true, path: input.path, size: input.content.length }))
beforeEach(() => {
  save.mockClear(); write.mockClear()
  useLatexProjectStore.setState({ sessions: {} })
  vi.stubGlobal('window', { kunGui: { latexReadProject: vi.fn(async () => ({ ok: true, project })),
    latexReadSource: vi.fn(async () => ({ ok: true, content: 'source' })), latexReadPdf: vi.fn(async () => ({ ok: true, pdf: null, currentSourceHash: '' })),
    latexSave: save, writeWorkspaceFile: write } })
  useWriteWorkspaceStore.setState({ workspaceRoot, autoSaveEnabled: true })
})
afterEach(() => { useWriteWorkspaceStore.getState().resetWorkspace(); useLatexProjectStore.setState({ sessions: {} }); vi.unstubAllGlobals() })

describe('LaTeX Work document wiring', () => {
  it('opens sources in one project tab, saves the active subfile and supplies its assistant context', async () => {
    await useWriteWorkspaceStore.getState().openFile(workspaceRoot, project.mainPath)
    await useWriteWorkspaceStore.getState().openFile(workspaceRoot, `${project.rootPath}/intro.tex`)
    const state = useWriteWorkspaceStore.getState()
    expect(state.activeFileKind).toBe('latex')
    expect(state.activeFilePath).toBe(project.mainPath)
    expect(state.editorLayout.groups[0].tabs).toHaveLength(1)
    expect(latexSession(key)?.activeFile).toBe('intro.tex')
    editLatexBuffer(key, 'intro.tex', 'revised source')
    expect(await state.saveDocument(workspaceRoot, project.mainPath)).toBe(true)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ edits: [{ file: 'intro.tex', before: 'source', after: 'revised source' }] }))
    expect(workbenchWriteSourceContext(workspaceRoot, state.activeFilePath, state.activeFileKind)).toMatchObject({
      fileReference: { path: `${project.rootPath}/intro.tex` }, activeResource: { locator: 'paper/intro.tex', sourceFormat: 'latex' }
    })
    await useWriteWorkspaceStore.getState().closeTab('primary', project.mainPath, true)
    expect(latexSession(key)).toBeUndefined()
  })
  it('keeps the previous Markdown autosave when entering a paper', async () => {
    const document = createWriteDocumentSession({ path: '/tmp/write/notes.md', kind: 'text', fileContent: 'draft', persistedContent: 'saved', saveStatus: 'dirty' })
    useWriteWorkspaceStore.setState((state) => openWriteDocumentState(state, document, 'primary', 'rich'))
    await useWriteWorkspaceStore.getState().openFile(workspaceRoot, project.mainPath)
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith(expect.objectContaining({ path: '/tmp/write/notes.md', content: 'draft' })))
    expect(useWriteWorkspaceStore.getState().activeFileKind).toBe('latex')
  })
})
