import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactCard } from './ArtifactCard'
import type { LibraryArtifact } from './artifact-types'

const previews = vi.hoisted(() => ({ useBoardPreview: vi.fn() }))

vi.mock('./artifact-board-preview', () => ({
  useBoardPreview: previews.useBoardPreview
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' }
  })
}))

const board: LibraryArtifact = {
  id: 'board:/work:.kun-whiteboards/board-1',
  kind: 'board',
  title: 'Retrieval flow',
  workspaceRoot: '/work',
  projectName: 'work',
  path: '.kun-whiteboards/board-1',
  ext: '',
  updatedAt: Date.parse('2026-10-20T00:00:00.000Z'),
  whiteboardId: 'board-1'
}

let observerCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null
const observe = vi.fn()
const disconnect = vi.fn()

class FakeIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    observerCallback = callback
  }
  observe = observe
  disconnect = disconnect
  unobserve = vi.fn()
  takeRecords = (): unknown[] => []
  root = null
  rootMargin = ''
  thresholds: number[] = []
}

// react-test-renderer keeps host refs null unless a node mock is supplied.
const createNodeMock = (): { nodeType: number } => ({ nodeType: 1 })

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  previews.useBoardPreview.mockReset()
  previews.useBoardPreview.mockReturnValue({ url: '' })
  observe.mockClear()
  disconnect.mockClear()
  observerCallback = null
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
  if (renderer) act(() => renderer?.unmount())
  renderer = null
  vi.unstubAllGlobals()
})

describe('ArtifactCard thumbnails', () => {
  it('does not read a board preview before the card nears the viewport', async () => {
    await act(async () => {
      renderer = create(createElement(ArtifactCard, { artifact: board, onOpen: vi.fn() }), { createNodeMock })
    })

    expect(previews.useBoardPreview).not.toHaveBeenCalled()
    expect(observe).toHaveBeenCalledTimes(1)
    expect(disconnect).not.toHaveBeenCalled()
  })

  it('starts one preview read once the card becomes visible, then stops observing', async () => {
    await act(async () => {
      renderer = create(createElement(ArtifactCard, { artifact: board, onOpen: vi.fn() }), { createNodeMock })
    })

    await act(async () => {
      observerCallback?.([{ isIntersecting: true }])
    })

    expect(previews.useBoardPreview).toHaveBeenCalledTimes(1)
    expect(previews.useBoardPreview).toHaveBeenCalledWith(board)
    expect(disconnect).toHaveBeenCalled()
  })
})
