/** @vitest-environment jsdom */
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperViewSurface } from './PaperViewSurface'
import { useChatStore } from '../../store/chat-store'
import { useWorkSlotsStore } from '../../write/work-slots-store'
import { useWorkViewStore } from '../../write/work-view-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { emptyWriteEditorLayout, writePaperViewTabKey } from '../../write/write-editor-layout'

const paper = vi.hoisted(() => ({ open: vi.fn<(...args: unknown[]) => Promise<boolean>>() }))
vi.mock('../../paper/paper-space', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../paper/paper-space')>(),
  openPaperSpace: paper.open
}))

let renderer: ReactTestRenderer
const closeTab = vi.fn(async () => true)

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  paper.open.mockReset()
  closeTab.mockClear()
  const layout = emptyWriteEditorLayout()
  layout.groups[0] = { id: 'primary', activePath: writePaperViewTabKey('library'), tabs: [{ kind: 'paper-view', view: 'library', viewMode: 'rich' }] }
  useWriteWorkspaceStore.setState({ workspaceRoot: '/work', editorLayout: layout, closeTab })
  useWorkSlotsStore.setState({ assistantMain: true })
  useWorkViewStore.setState({ split: false, peek: false })
  useChatStore.setState({ route: 'write' })
})
afterEach(() => {
  act(() => renderer.unmount())
  vi.unstubAllGlobals()
})

describe('legacy paper view migration', () => {
  it('does not redirect a hidden editor; migrates its tab when shown', async () => {
    paper.open.mockImplementation(async () => {
      useChatStore.getState().setRoute('papers')
      return true
    })
    await act(async () => { renderer = create(createElement(PaperViewSurface, { view: 'library', groupId: 'primary' })) })
    expect(paper.open).not.toHaveBeenCalled()
    await act(async () => { useWorkSlotsStore.setState({ assistantMain: false }) })
    expect(paper.open).toHaveBeenCalledWith('library')
    expect(closeTab).toHaveBeenCalledWith('primary', writePaperViewTabKey('library'))
  })

  it('keeps the legacy tab when navigation is cancelled', async () => {
    paper.open.mockResolvedValue(false)
    useWorkSlotsStore.setState({ assistantMain: false })
    await act(async () => { renderer = create(createElement(PaperViewSurface, { view: 'library', groupId: 'primary' })) })
    expect(paper.open).toHaveBeenCalledWith('library')
    expect(closeTab).not.toHaveBeenCalled()
  })
})
