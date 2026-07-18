import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it } from 'vitest'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import {
  createDefaultShape,
  createEmptyDocument,
  createHtmlFrameShape,
  createSvgFrameShape
} from '../../../design/canvas/canvas-types'
import { createRunningAppFrameShape } from '../../../design/canvas/running-app-frame'
import { useCanvasViewportStore } from '../../../design/canvas/canvas-viewport-store'
import { useDesignWorkspaceStore } from '../../../design/design-workspace-store'
import type { DesignArtifact } from '../../../design/design-types'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import {
  resetSvgAnimationPreviewStore,
  useSvgAnimationPreviewStore
} from '../../../design/svg/svg-animation-preview-store'
import { RunningAppFrameOverlay } from './RunningAppFrameOverlay'
import { SvgFrameOverlay } from './SvgFrameOverlay'
import { ScreenOverlay } from './html-frame/HtmlFrameScreenOverlay'
import { ShapeDispatcher } from './shapes/ShapeDispatcher'

const createdAt = '2026-07-13T00:00:00.000Z'

function artifact(id: string, kind: 'html' | 'svg'): DesignArtifact {
  const extension = kind === 'svg' ? 'svg' : 'html'
  const relativePath = `.kun-design/doc/${id}/v1.${extension}`
  return {
    id,
    kind,
    title: `${id} artifact`,
    relativePath,
    createdAt,
    updatedAt: createdAt,
    versions: [{ id: `${id}-v1`, relativePath, createdAt, summary: '' }]
  }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument())
  useCanvasSelectionStore.setState({ selectedIds: new Set() })
  useCanvasViewportStore.setState({
    vbox: { x: 0, y: 0, width: 1200, height: 800 },
    containerWidth: 1200,
    containerHeight: 800,
    activeTool: 'select'
  })
  useDesignWorkspaceStore.setState({
    workspaceRoot: '/workspace',
    artifacts: [],
    activeArtifactId: null,
    parallelPageStates: {},
    pagesRun: null
  })
  useCanvasMotionStore.getState().reset()
  resetSvgAnimationPreviewStore()
})

describe('canvas motion preview wrappers', () => {
  it('keeps native SVG geometry on an inner static transform group', () => {
    const shape = {
      ...createDefaultShape('rect', 12, 24),
      id: 'native-card',
      rotation: 15,
      opacity: 0.6
    }

    const html = renderToStaticMarkup(createElement(ShapeDispatcher, {
      shapeId: shape.id,
      objects: { [shape.id]: shape }
    }))

    expect(html).toContain('id="shape-native-card"')
    expect(html).toContain('data-canvas-motion-target="native-card"')
    expect(html).toContain('data-canvas-motion-kind="svg"')
    expect(html).toContain('opacity="0.6"')
    expect(html).toContain('transform="translate(12, 24) rotate(15, 50, 50)"')
  })

  it('wraps a running app as one portal target without changing iframe scale', () => {
    const shape = createRunningAppFrameShape({
      x: 20,
      y: 40,
      url: 'localhost:5173/dashboard',
      title: 'Live dashboard'
    })!
    shape.id = 'running-app'
    shape.rotation = 12
    shape.opacity = 0.7

    const html = renderToStaticMarkup(createElement(RunningAppFrameOverlay, {
      shape,
      screenX: 30,
      screenY: 60,
      screenWidth: 640,
      screenHeight: 400,
      zIndex: 3,
      zoom: 0.5,
      active: true,
      interactive: false,
      panning: false,
      editing: false,
      onDoubleClick: () => undefined
    }))

    expect(html).toContain('data-canvas-motion-target="running-app"')
    expect(html).toContain('data-canvas-motion-kind="portal"')
    expect(html).toContain('opacity:0.7')
    expect(html).toContain('transform:rotate(12deg)')
    expect(html).toContain('transform:scale(0.5)')
  })

  it('wraps an HTML artifact frame as one portal target', () => {
    const screen = artifact('home', 'html')
    const shape = createHtmlFrameShape('Home', 10, 20, screen.id, 'mobile')
    shape.id = 'html-frame'
    shape.rotation = 8
    shape.opacity = 0.8
    useDesignWorkspaceStore.setState({ artifacts: [screen], activeArtifactId: screen.id })

    const html = renderToStaticMarkup(createElement(ScreenOverlay, {
      shape,
      workspaceRoot: '/workspace',
      screenX: 15,
      screenY: 30,
      screenWidth: 195,
      screenHeight: 422,
      zIndex: 2,
      zoom: 0.5,
      active: true,
      interactive: false,
      panning: false,
      editing: false,
      onDoubleClick: () => undefined,
      onToggleModify: () => undefined
    }))

    expect(html).toContain('data-canvas-motion-target="html-frame"')
    expect(html).toContain('data-canvas-motion-kind="portal"')
    expect(html).toContain('opacity:0.8')
    expect(html).toContain('transform:rotate(8deg)')
  })

  it('wraps an SVG artifact frame as one outer portal target', async () => {
    const svg = artifact('logo-loop', 'svg')
    const shape = createSvgFrameShape('Logo loop', 50, 60, svg.id, 320, 240)
    shape.id = 'svg-frame'
    shape.parentId = '__root__'
    shape.rotation = 5
    shape.opacity = 0.65
    const document = createEmptyDocument()
    document.objects[shape.id] = shape
    document.objects[document.rootId] = {
      ...document.objects[document.rootId],
      children: [shape.id]
    }
    useCanvasShapeStore.getState().loadDocument(document)
    useCanvasSelectionStore.setState({ selectedIds: new Set([shape.id]) })
    useCanvasMotionStore.setState({ open: true, activeFrameId: document.rootId })
    useCanvasViewportStore.setState({
      vbox: { x: 10_000, y: 10_000, width: 120_000, height: 80_000 },
      containerWidth: 1_200,
      containerHeight: 800
    })
    useDesignWorkspaceStore.setState({ artifacts: [svg], activeArtifactId: svg.id })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(SvgFrameOverlay, {
        workspaceRoot: '/workspace'
      }))
    })
    const target = renderer.root.findByProps({ 'data-canvas-motion-target': 'svg-frame' })
    expect(target.props['data-canvas-motion-kind']).toBe('portal')
    expect(target.props['data-svg-artifact-id']).toBe('logo-loop')
    expect(target.props.style).toMatchObject({ opacity: 0.65, transform: 'rotate(5deg)' })
    expect(useSvgAnimationPreviewStore.getState().previews[shape.id]).toMatchObject({
      shapeId: shape.id,
      artifactId: svg.id,
      title: svg.title,
      status: 'loading',
      animationCount: 0
    })
    await act(async () => useCanvasMotionStore.getState().setOpen(false))
    expect(useSvgAnimationPreviewStore.getState().previews[shape.id]).toBeUndefined()
    await act(async () => useCanvasMotionStore.getState().setOpen(true))
    expect(useSvgAnimationPreviewStore.getState().previews[shape.id]).toMatchObject({
      artifactId: svg.id,
      status: 'loading'
    })
    await act(async () => renderer.unmount())
    expect(useSvgAnimationPreviewStore.getState().previews[shape.id]).toBeUndefined()
  })

  it('reports missing SVG artifact metadata instead of leaving Motion inspection pending', async () => {
    const shape = createSvgFrameShape('Missing loop', 50, 60, 'missing-svg', 320, 240)
    shape.id = 'missing-svg-frame'
    shape.parentId = '__root__'
    const document = createEmptyDocument()
    document.objects[shape.id] = shape
    document.objects[document.rootId] = {
      ...document.objects[document.rootId],
      children: [shape.id]
    }
    useCanvasShapeStore.getState().loadDocument(document)
    useCanvasSelectionStore.setState({ selectedIds: new Set([shape.id]) })
    useCanvasMotionStore.setState({ open: true, activeFrameId: shape.id })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = createRenderer(createElement(SvgFrameOverlay, { workspaceRoot: '/workspace' }))
    })

    expect(useSvgAnimationPreviewStore.getState().previews[shape.id]).toMatchObject({
      artifactId: 'missing-svg',
      title: 'Missing loop',
      status: 'missing'
    })
    await act(async () => renderer.unmount())
  })
})
