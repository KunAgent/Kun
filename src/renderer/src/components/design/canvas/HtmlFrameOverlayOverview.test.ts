import { createElement, useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyDocument, createHtmlFrameShape } from '../../../design/canvas/canvas-types'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import { useChatStore } from '../../../store/chat-store'
import type { StartDesignHtmlPreviewWatchOptions } from '../../../design/design-preview-file'
import { HtmlFrameOverlay } from './HtmlFrameOverlay'

vi.mock('../../../design/design-preview-file', () => ({
  startDesignHtmlPreviewWatch: (options: StartDesignHtmlPreviewWatchOptions) => {
    options.onPreviewStateChange?.('renderable')
    options.onRevision(1)
    return () => undefined
  }
}))
vi.mock('./html-frame/HtmlFrameScreenOverlay', () => ({
  ScreenOverlay: (props: { shape: { id: string }; captureKey?: string; onCapture: (id: string, key: string, image: string) => void }) => {
    const { shape, captureKey, onCapture } = props
    useEffect(() => {
      if (captureKey) onCapture(shape.id, captureKey, 'data:image/png;base64,aW1hZ2U=')
    }, [captureKey, onCapture, shape.id])
    return createElement('div', { 'data-live-preview': props.shape.id })
  }
}))

describe('whiteboard overview rendered output', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const document = createEmptyDocument()
    const frames = Array.from({ length: 24 }, (_, index) => {
      const shape = createHtmlFrameShape(`Board ${index}`, index % 6 * 480, Math.floor(index / 6) * 1000, `artifact-${index}`, 'mobile')
      shape.id = `board-${index}`
      shape.parentId = document.rootId
      document.objects[shape.id] = shape
      return shape
    })
    document.objects[document.rootId].children = frames.map((frame) => frame.id)
    useCanvasShapeStore.setState({ document })
    useCanvasSelectionStore.setState({ selectedIds: new Set() })
    useCanvasViewportStore.setState({
      containerWidth: 660, containerHeight: 550,
      vbox: { x: 0, y: 0, width: 6000, height: 5000 }, activeTool: 'select'
    })
    useChatStore.setState({ busy: false })
    useDesignWorkspaceStore.setState({
      artifacts: frames.map((frame) => ({
        id: frame.htmlArtifactId!, kind: 'html', title: frame.name, relativePath: `${frame.id}.html`,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', versions: [], previewStatus: 'ready'
      })),
      parallelPageStates: {}, pagesRun: null
    })
  })
  afterEach(async () => { if (renderer) await act(async () => renderer?.unmount()); renderer = undefined })

  it('renders all 24 previews at 11%, not only the last ten', async () => {
    await act(async () => {
      renderer = create(createElement(HtmlFrameOverlay, {
        workspaceRoot: '/workspace', interactiveId: null, onToggleInteractive: vi.fn()
      }))
    })
    expect(renderer!.root.findAllByType('img')).toHaveLength(24)
    expect(renderer!.root.findAll((node) => Boolean(node.props['data-live-preview']))).toHaveLength(0)
  })

  it('promotes a selected thumbnail to a live preview without dropping other boards', async () => {
    await act(async () => {
      renderer = create(createElement(HtmlFrameOverlay, {
        workspaceRoot: '/workspace', interactiveId: null, onToggleInteractive: vi.fn()
      }))
    })
    await act(async () => useCanvasSelectionStore.setState({ selectedIds: new Set(['board-0']) }))
    expect(renderer!.root.findAllByType('img')).toHaveLength(23)
    expect(renderer!.root.findAll((node) => Boolean(node.props['data-live-preview']))).toHaveLength(1)
  })
})
