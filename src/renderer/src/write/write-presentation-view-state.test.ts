import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkspaceOfficePreviewSuccess,
  WorkspacePresentationViewReference
} from '@shared/office-document'
import { createWriteDocumentSession } from './write-editor-layout'
import {
  selectFocusedPresentationView
} from './write-presentation-view-state'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { initialState } from './write-workspace-store-helpers'

const PATH = '/work/deck.pptx'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function preview(sourceSha256: string): WorkspaceOfficePreviewSuccess {
  return {
    ok: true,
    path: PATH,
    name: 'deck.pptx',
    sourceFormat: 'pptx',
    renderFormat: 'pptx',
    viewer: 'presentation',
    size: 3,
    mtimeMs: 1,
    sourceSha256,
    data: new Uint8Array([1, 2, 3])
  }
}

function view(
  slide: number,
  sourceSha256 = SHA_A,
  overrides: Partial<WorkspacePresentationViewReference> = {}
): WorkspacePresentationViewReference {
  return {
    kind: 'presentation',
    path: PATH,
    sourceName: 'deck.pptx',
    sourceFormat: 'pptx',
    sourceSha256,
    slide,
    slideCount: 9,
    ...overrides
  }
}

function installPresentation(sourceSha256 = SHA_A): void {
  const document = createWriteDocumentSession({
    path: PATH,
    kind: 'office',
    officePreview: preview(sourceSha256)
  })
  useWriteWorkspaceStore.setState({
    ...initialState(),
    workspaceRoot: '/work',
    documentsByPath: { [PATH]: document },
    editorLayout: {
      version: 1,
      orientation: 'horizontal',
      ratio: 0.5,
      focusedGroupId: 'primary',
      groups: [
        { id: 'primary', tabs: [{ path: PATH, viewMode: 'plain' }], activePath: PATH },
        { id: 'secondary', tabs: [{ path: PATH, viewMode: 'plain' }], activePath: PATH }
      ]
    }
  })
}

beforeEach(() => {
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined }
  })
  installPresentation()
})

afterEach(() => {
  useWriteWorkspaceStore.getState().resetWorkspace()
  vi.unstubAllGlobals()
})

describe('write presentation view state', () => {
  it('keeps independent slide locations for two occurrences of the same deck', () => {
    const state = useWriteWorkspaceStore.getState()
    state.setPresentationViewForGroup('primary', view(2))
    state.setPresentationViewForGroup('secondary', view(7))

    expect(selectFocusedPresentationView(useWriteWorkspaceStore.getState())?.slide).toBe(2)
    useWriteWorkspaceStore.getState().focusEditorGroup('secondary')
    expect(selectFocusedPresentationView(useWriteWorkspaceStore.getState())?.slide).toBe(7)
    useWriteWorkspaceStore.getState().focusEditorGroup('primary')
    expect(selectFocusedPresentationView(useWriteWorkspaceStore.getState())?.slide).toBe(2)
  })

  it('rejects locations that do not match the group path or loaded source SHA', () => {
    const state = useWriteWorkspaceStore.getState()
    state.setPresentationViewForGroup('primary', view(3, SHA_B))
    state.setPresentationViewForGroup('primary', view(3, SHA_A, { path: '/work/other.pptx' }))
    expect(useWriteWorkspaceStore.getState().presentationViewByGroup.primary).toBeUndefined()

    useWriteWorkspaceStore.setState({ presentationViewByGroup: { primary: view(3, SHA_B) } })
    expect(selectFocusedPresentationView(useWriteWorkspaceStore.getState())).toBeNull()
  })

  it('does not let cleanup from an old source erase the current source', () => {
    installPresentation(SHA_B)
    const state = useWriteWorkspaceStore.getState()
    state.setPresentationViewForGroup('primary', view(4, SHA_B))
    state.clearPresentationViewForGroup('primary', { path: PATH, sourceSha256: SHA_A })
    state.setPresentationViewForGroup('primary', view(8, SHA_A))

    expect(useWriteWorkspaceStore.getState().presentationViewByGroup.primary)
      .toEqual(expect.objectContaining({ sourceSha256: SHA_B, slide: 4 }))
    state.clearPresentationViewForGroup('primary', { path: PATH, sourceSha256: SHA_B })
    expect(useWriteWorkspaceStore.getState().presentationViewByGroup.primary).toBeUndefined()
  })

  it('clears transient locations when the workspace resets', () => {
    useWriteWorkspaceStore.getState().setPresentationViewForGroup('primary', view(5))
    useWriteWorkspaceStore.getState().resetWorkspace()
    expect(useWriteWorkspaceStore.getState().presentationViewByGroup).toEqual({})
  })
})
