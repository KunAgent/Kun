import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactCard } from './ArtifactCard'
import type { LibraryArtifact } from './artifact-types'

const previews = vi.hoisted(() => ({ useArtifactThumbnail: vi.fn() }))

vi.mock('./artifact-thumbnail', () => ({
  useArtifactThumbnail: previews.useArtifactThumbnail
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
  previews.useArtifactThumbnail.mockReset()
  previews.useArtifactThumbnail.mockReturnValue({ status: 'loading' })
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

    expect(previews.useArtifactThumbnail).not.toHaveBeenCalled()
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

    expect(previews.useArtifactThumbnail).toHaveBeenCalledTimes(1)
    expect(previews.useArtifactThumbnail).toHaveBeenCalledWith(board)
    expect(disconnect).toHaveBeenCalled()
  })

  it('shows the real preview image inside the page frame once loaded', async () => {
    previews.useArtifactThumbnail.mockReturnValue({ status: 'image', url: 'data:image/webp;base64,AAAA' })
    await act(async () => {
      renderer = create(createElement(ArtifactCard, { artifact: board, onOpen: vi.fn() }), { createNodeMock })
    })
    await act(async () => {
      observerCallback?.([{ isIntersecting: true }])
    })

    const images = renderer!.root.findAll((node) => node.type === 'img')
    expect(images.map((node) => node.props.src)).toEqual(['data:image/webp;base64,AAAA'])
  })

  it('lays out several design screens with a screen count', async () => {
    const design: LibraryArtifact = { ...board, id: 'design:/work:.kun-design/d1', kind: 'design', path: '.kun-design/d1', whiteboardId: undefined, designDocumentId: 'd1' }
    previews.useArtifactThumbnail.mockReturnValue({ status: 'screens', urls: ['a', 'b', 'c'], total: 8 })
    await act(async () => {
      renderer = create(createElement(ArtifactCard, { artifact: design, onOpen: vi.fn() }), { createNodeMock })
    })
    await act(async () => {
      observerCallback?.([{ isIntersecting: true }])
    })

    expect(renderer!.root.findAll((node) => node.type === 'img')).toHaveLength(3)
    expect(JSON.stringify(renderer!.toJSON())).toContain('artifactsScreenCount')
  })
})
