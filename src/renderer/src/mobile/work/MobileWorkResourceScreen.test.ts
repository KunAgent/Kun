// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceEntry } from '@shared/workspace-file'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { workFileResourceKey } from './work-resource-key'
import { rememberMobileWorkRoute } from './mobile-work-resource-route'

vi.mock('../../components/workbench/useWorkbenchWriteAssistantRuntime', () => ({ useWorkbenchWriteAssistantRuntime: () => undefined }))
vi.mock('../../components/write/use-write-editor-group-file-watches', () => ({ useWriteEditorGroupFileWatches: () => undefined }))
vi.mock('../../components/write/use-write-workspace-lifecycle', () => ({ useWriteWorkspaceLifecycle: () => undefined }))
vi.mock('../../components/write/WriteEditorGroupContent', () => ({ WriteEditorGroupContent: () => null }))
vi.mock('./MobileWorkResource', () => ({ MobileWorkResource: () => null }))
vi.mock('./MobileWorkAssistant', () => ({ MobileWorkAssistant: () => null }))
vi.mock('../sheets/MobileSheet', () => ({ MobileSheet: () => null }))
import { MobileWorkResourceScreen } from './MobileWorkResourceScreen'

let root: Root
let host: HTMLDivElement
const original = useWriteWorkspaceStore.getState()
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  window.sessionStorage.clear()
})
afterEach(() => { act(() => root.unmount()); host.remove(); window.sessionStorage.clear(); useWriteWorkspaceStore.setState(original) })

describe('mobile Work deep-link activation', () => {
  it('activates cached A even when B is still the global active file', async () => {
    const first = '/workspace/A.md'
    const second = '/workspace/B.md'
    const files = [first, second].map((path) => ({ type: 'file', path, name: path.split('/').at(-1)! })) as WorkspaceEntry[]
    const document = (path: string) => ({ path, kind: 'text', fileContent: path,
      fileSize: path.length, saveStatus: 'saved', fileTruncated: false })
    const openFile = vi.fn(async (_workspace: string, path: string) => {
      useWriteWorkspaceStore.setState({ activeFilePath: path })
    })
    useWriteWorkspaceStore.setState({ workspaceRoot: '/workspace', activeFilePath: second,
      entriesByDir: { '/workspace': files }, documentsByPath: { [first]: document(first), [second]: document(second) } as never,
      openFile })
    await act(async () => root.render(createElement(MobileWorkResourceScreen, {
      resourceKey: workFileResourceKey('/workspace', first), view: 'read',
      onBack: vi.fn(), onView: vi.fn(), onSettings: vi.fn()
    })))
    expect(openFile).toHaveBeenCalledWith('/workspace', first)
    expect(useWriteWorkspaceStore.getState().activeFilePath).toBe(first)
  })

  it('restores a nested A file from an opaque history key after switching to B', async () => {
    const first = '/A/sub/nested.md'
    const key = workFileResourceKey('/A', first)
    rememberMobileWorkRoute({ key, root: '/A', path: first, kind: 'document' })
    const document = { path: first, kind: 'text', fileContent: 'A content', fileSize: 9,
      saveStatus: 'saved', fileTruncated: false }
    const initializeWorkspace = vi.fn(async (workspaceRoot: string) => {
      useWriteWorkspaceStore.setState({ workspaceRoot, rootDirectory: workspaceRoot,
        entriesByDir: { [workspaceRoot]: [] }, documentsByPath: {}, activeFilePath: null })
    })
    const openFile = vi.fn(async (_workspaceRoot: string, path: string) => {
      useWriteWorkspaceStore.setState({ activeFilePath: path, documentsByPath: { [path]: document } as never })
    })
    useWriteWorkspaceStore.setState({ workspaceRoot: '/B', rootDirectory: '/B',
      workspaceRoots: ['/A', '/B'], entriesByDir: { '/B': [] }, documentsByPath: {},
      activeFilePath: null, initializeWorkspace, openFile })
    await act(async () => root.render(createElement(MobileWorkResourceScreen, {
      resourceKey: key, view: 'read', onBack: vi.fn(), onView: vi.fn(), onSettings: vi.fn()
    })))
    expect(initializeWorkspace).toHaveBeenCalledWith('/A')
    expect(openFile).toHaveBeenCalledWith('/A', first)
    expect(useWriteWorkspaceStore.getState().activeFilePath).toBe(first)
    expect(host.textContent).not.toContain('File not found')
  })
})
