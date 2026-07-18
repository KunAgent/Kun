import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import {
  createDefaultShape,
  createEmptyDocument,
  createSvgFrameShape,
  type CanvasDocument
} from '../../../design/canvas/canvas-types'
import { addPropertyTracks } from '../../../design/motion/canvas-motion-mutations'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import {
  publishSvgAnimationPreview,
  registerSvgAnimationPreviewController,
  resetSvgAnimationPreviewStore
} from '../../../design/svg/svg-animation-preview-store'
import { CanvasMotionDock } from './CanvasMotionDock'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | { defaultValue?: string },
      options?: Record<string, unknown>
    ): string => {
      const template = typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key
      const values: Record<string, unknown> | undefined = typeof fallback === 'object'
        ? { ...fallback }
        : options
      return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        values?.[name] === undefined ? match : String(values[name])
      )
    }
  })
}))

let reducedMotion = false

function installDocument(withTrack = true): CanvasDocument {
  const document = createEmptyDocument()
  const frame = {
    ...createDefaultShape('frame', 0, 0),
    id: 'motion-frame',
    name: 'Hero frame',
    parentId: document.rootId,
    children: ['motion-card']
  }
  const card = {
    ...createDefaultShape('rect', 40, 80),
    id: 'motion-card',
    name: 'Feature card',
    parentId: frame.id,
    frameId: frame.id
  }
  document.objects[document.rootId] = {
    ...document.objects[document.rootId],
    children: [frame.id]
  }
  document.objects[frame.id] = frame
  document.objects[card.id] = card
  if (withTrack) {
    document.motion = addPropertyTracks(document.motion, {
      document,
      frameId: frame.id,
      targetShapeIds: [card.id],
      properties: ['x'],
      durationMs: 600
    })
  }
  useCanvasShapeStore.getState().loadDocument(document, 'motion-dock-test')
  useCanvasSelectionStore.setState({ selectedIds: new Set([card.id]) })
  useCanvasMotionStore.setState({ open: true, activeFrameId: frame.id })
  return document
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  reducedMotion = false
  vi.stubGlobal('window', {
    matchMedia: vi.fn(() => ({
      matches: reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), 'motion-dock-empty')
  useCanvasSelectionStore.setState({ selectedIds: new Set() })
  useCanvasMotionStore.getState().reset()
  resetSvgAnimationPreviewStore()
})

afterEach(() => {
  useCanvasMotionStore.getState().reset()
  resetSvgAnimationPreviewStore()
  vi.unstubAllGlobals()
})

describe('CanvasMotionDock', () => {
  it('renders the transport, accessible controls, and no-selection empty state', async () => {
    useCanvasMotionStore.setState({ open: true, activeFrameId: '__root__' })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasMotionDock))
    })

    expect(renderer.root.findByProps({ 'aria-label': 'Motion dock' })).toBeDefined()
    expect(renderer.root.findByProps({ 'data-motion-timeline': true })).toBeDefined()
    expect(renderer.root.findByProps({ 'aria-label': 'Play' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': 'Motion playhead' })).toBeDefined()
    expect(renderer.root.findByProps({ 'aria-label': 'Playback mode' })).toBeDefined()
    expect(renderer.root.findByProps({ 'aria-label': 'Playback rate' })).toBeDefined()
    expect(JSON.stringify(renderer.toJSON())).toContain('Select a layer or frame, then add a Motion preset.')
    await act(async () => renderer.unmount())
  })

  it('renders editable property rows and keyframe diamonds for the active frame', async () => {
    installDocument()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasMotionDock))
    })

    const json = JSON.stringify(renderer.toJSON())
    expect(json).toContain('Hero frame')
    expect(json).toContain('Feature card · x')
    expect(renderer.root.findByProps({ 'aria-label': 'x keyframe at 0ms' })).toBeDefined()
    expect(renderer.root.findByProps({ 'aria-label': 'x keyframe at 600ms' })).toBeDefined()
    expect(json).toContain('Auto-key')
    expect(json).toContain('Fade')
    expect(json).toContain('Move')
    expect(json).toContain('Scale')
    expect(json).toContain('Rotate')
    await act(async () => renderer.unmount())
  })

  it('isolates Delete, Space, and select-all shortcuts inside the timeline boundary', async () => {
    installDocument()
    const track = useCanvasShapeStore.getState().document.motion!.timelines['motion-frame'].tracks[0]
    useCanvasMotionStore.getState().selectKeyframe(track.id, track.keyframes[1].id)
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasMotionDock))
    })

    const deletePrevented = vi.fn()
    const deleteStopped = vi.fn()
    await act(async () => {
      renderer.root.findByProps({ 'data-motion-timeline': true }).props.onKeyDown({
        key: 'Delete',
        metaKey: false,
        ctrlKey: false,
        target: { matches: () => false },
        currentTarget: {},
        preventDefault: deletePrevented,
        stopPropagation: deleteStopped
      })
    })
    expect(deletePrevented).toHaveBeenCalledOnce()
    expect(deleteStopped).toHaveBeenCalledOnce()
    expect(
      useCanvasShapeStore.getState().document.motion!.timelines['motion-frame'].tracks[0].keyframes
    ).toHaveLength(1)

    const boundary = { matches: () => false }
    const spacePrevented = vi.fn()
    const spaceStopped = vi.fn()
    await act(async () => {
      renderer.root.findByProps({ 'data-motion-timeline': true }).props.onKeyDown({
        key: ' ',
        metaKey: false,
        ctrlKey: false,
        target: boundary,
        currentTarget: boundary,
        preventDefault: spacePrevented,
        stopPropagation: spaceStopped
      })
    })
    expect(spacePrevented).toHaveBeenCalledOnce()
    expect(spaceStopped).toHaveBeenCalledOnce()
    expect(useCanvasMotionStore.getState().playing).toBe(true)

    const selectAllPrevented = vi.fn()
    const selectAllStopped = vi.fn()
    renderer.root.findByProps({ 'data-motion-timeline': true }).props.onKeyDown({
      key: 'a',
      metaKey: true,
      ctrlKey: false,
      target: { matches: () => false },
      currentTarget: {},
      preventDefault: selectAllPrevented,
      stopPropagation: selectAllStopped
    })
    expect(selectAllPrevented).toHaveBeenCalledOnce()
    expect(selectAllStopped).toHaveBeenCalledOnce()

    await act(async () => {
      useCanvasMotionStore.getState().setPlaying(false)
      renderer.unmount()
    })
  })

  it('disables automatic playback under reduced-motion while keeping scrub controls', async () => {
    installDocument()
    reducedMotion = true
    useCanvasMotionStore.getState().setPlaying(true)
    let renderer!: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(CanvasMotionDock))
    })

    expect(JSON.stringify(renderer.toJSON())).toContain('Reduced motion is enabled')
    expect(renderer.root.findByProps({ 'aria-label': 'Play' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'aria-label': 'Motion playhead' }).props.disabled).not.toBe(true)
    expect(useCanvasMotionStore.getState().playing).toBe(false)

    await act(async () => renderer.unmount())
  })

  it('separates selected SVG content animation from editable container Motion', async () => {
    const document = createEmptyDocument()
    const svgFrame = createSvgFrameShape('Whale spray', 20, 30, 'whale-spray', 640, 480)
    svgFrame.id = 'whale-svg-frame'
    svgFrame.parentId = document.rootId
    document.objects[document.rootId] = {
      ...document.objects[document.rootId],
      children: [svgFrame.id]
    }
    document.objects[svgFrame.id] = svgFrame
    useCanvasShapeStore.getState().loadDocument(document, 'motion-svg-dock-test')
    useCanvasSelectionStore.setState({ selectedIds: new Set([svgFrame.id]) })
    useCanvasMotionStore.setState({ open: true, activeFrameId: svgFrame.id })

    const controller = {
      play: vi.fn(),
      pause: vi.fn(),
      restart: vi.fn(),
      seek: vi.fn(),
      setRate: vi.fn()
    }
    const unregister = registerSvgAnimationPreviewController(svgFrame.id, controller)

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasMotionDock))
    })
    await act(async () => {
      publishSvgAnimationPreview({
        shapeId: svgFrame.id,
        artifactId: 'whale-spray',
        title: 'Whale spray',
        status: 'ready',
        animationCount: 24,
        durationMs: 5_000,
        loopsIndefinitely: true,
        currentTimeMs: 1_250,
        playing: false,
        rate: 1
      })
    })

    const json = JSON.stringify(renderer.toJSON())
    expect(json).toContain('Container Motion')
    expect(json).toContain('SVG internal animation')
    expect(json).toContain('24 animations')
    expect(json).toContain('Looping')
    expect(json).toMatch(/(?:5000ms|5\.0s) representative cycle/)
    expect(json).toContain('Preview only')
    expect(renderer.root.findByProps({
      'aria-label': 'Preview-only content animation. Container Motion presets move, scale, rotate, or fade the whole SVG.'
    })).toBeDefined()
    expect(renderer.root.findByProps({ 'data-motion-transport': 'container' })).toBeDefined()
    expect(renderer.root.findByProps({ 'data-motion-track-grid': true })).toBeDefined()
    expect(renderer.root.findByProps({ 'data-motion-track-kind': 'svg-content' })).toBeDefined()
    expect(json).not.toContain('Apply a preset or add a property to start animating the selected layer.')
    expect(json).not.toContain('Select a layer or frame, then add a Motion preset.')
    expect(renderer.root.findByProps({ 'aria-label': 'Play' }).props.disabled).toBe(true)
    const fadePreset = renderer.root.findAllByType('button').find((button) => button.children.includes('Fade'))
    expect(fadePreset?.props.disabled).toBe(false)

    await act(async () => fadePreset?.props.onClick())
    useCanvasMotionStore.getState().setPlaying(false)
    const spacePrevented = vi.fn()
    const spaceStopped = vi.fn()
    await act(async () => {
      renderer.root.findByProps({ 'data-motion-timeline': true }).props.onKeyDown({
        key: ' ',
        metaKey: false,
        ctrlKey: false,
        target: { matches: (selector: string) => selector.includes('button') },
        currentTarget: {},
        preventDefault: spacePrevented,
        stopPropagation: spaceStopped
      })
    })
    expect(spacePrevented).not.toHaveBeenCalled()
    expect(spaceStopped).not.toHaveBeenCalled()
    expect(useCanvasMotionStore.getState().playing).toBe(false)

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Play SVG internal animation' }).props.onClick()
    })
    expect(controller.play).toHaveBeenCalledOnce()

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'SVG internal animation playhead' }).props.onChange({
        target: { value: '2500' }
      })
    })
    expect(controller.seek).toHaveBeenCalledWith(2_500)

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'SVG internal animation rate' }).props.onChange({
        target: { value: '2' }
      })
    })
    expect(controller.setRate).toHaveBeenCalledWith(2)

    await act(async () => renderer.unmount())
    unregister()
  })

  it('tolerates a transient selection whose shape was already removed', async () => {
    const document = createEmptyDocument()
    useCanvasShapeStore.getState().loadDocument(document, 'motion-stale-selection-test')
    useCanvasSelectionStore.setState({ selectedIds: new Set(['already-removed']) })
    useCanvasMotionStore.setState({ open: true, activeFrameId: document.rootId })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(CanvasMotionDock))
    })

    expect(JSON.stringify(renderer.toJSON())).not.toContain('SVG internal animation')
    await act(async () => renderer.unmount())
  })
})
