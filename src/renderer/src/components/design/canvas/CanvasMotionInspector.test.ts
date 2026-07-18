import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useCanvasShapeStore } from '../../../design/canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../../../design/canvas/canvas-selection-store'
import {
  createDefaultShape,
  createEmptyDocument,
  type CanvasDocument
} from '../../../design/canvas/canvas-types'
import { useCanvasUndoStore } from '../../../design/canvas/canvas-undo-store'
import {
  commitAutoKeyCanvasGesture,
  shouldAutoKeyCanvasGesture
} from '../../../design/motion/canvas-motion-auto-key'
import { applyMotionPreset } from '../../../design/motion/canvas-motion-mutations'
import { evaluateMotionTrack } from '../../../design/motion/evaluator'
import { useCanvasMotionStore } from '../../../design/motion/canvas-motion-store'
import { commitInspectorUpdate } from './PropertiesPanel'
import { MotionKeyframeControls } from './properties-panel/MotionKeyframeControls'

function installDocument(): { document: CanvasDocument; shapeId: string; frameId: string } {
  const document = createEmptyDocument()
  const frame = {
    ...createDefaultShape('frame', 0, 0),
    id: 'inspector-frame',
    parentId: document.rootId,
    children: ['inspector-card']
  }
  const shape = {
    ...createDefaultShape('rect', 10, 20),
    id: 'inspector-card',
    parentId: frame.id,
    frameId: frame.id
  }
  document.objects[document.rootId] = {
    ...document.objects[document.rootId],
    children: [frame.id]
  }
  document.objects[frame.id] = frame
  document.objects[shape.id] = shape
  useCanvasShapeStore.getState().loadDocument(document, 'motion-inspector-test')
  useCanvasSelectionStore.setState({ selectedIds: new Set([shape.id]) })
  useCanvasMotionStore.setState({
    open: true,
    activeFrameId: frame.id,
    currentTimeMs: 500,
    playing: false
  })
  return { document, shapeId: shape.id, frameId: frame.id }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useCanvasMotionStore.getState().reset()
  useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), 'motion-inspector-empty')
  useCanvasSelectionStore.setState({ selectedIds: new Set() })
  useCanvasUndoStore.getState().clear()
})

afterEach(() => {
  useCanvasMotionStore.getState().reset()
})

describe('Motion inspector keyframes', () => {
  it('stays hidden outside Motion mode', () => {
    const shape = createDefaultShape('rect', 0, 0)
    useCanvasMotionStore.getState().reset()

    expect(renderToStaticMarkup(createElement(MotionKeyframeControls, { shape }))).toBe('')
  })

  it('adds and removes a property keyframe at the current playhead', async () => {
    const { shapeId, frameId } = installDocument()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(MotionKeyframeControls, {
        shape: useCanvasShapeStore.getState().document.objects[shapeId]
      }))
    })

    const addX = renderer.root.findByProps({ 'aria-label': 'Add x keyframe' })
    expect(addX.props['aria-pressed']).toBe(false)
    await act(async () => {
      addX.props.onClick()
      renderer.update(createElement(MotionKeyframeControls, {
        shape: useCanvasShapeStore.getState().document.objects[shapeId]
      }))
    })

    const track = useCanvasShapeStore.getState().document.motion!.timelines[frameId].tracks.find(
      (candidate) => candidate.targetShapeId === shapeId && candidate.property === 'x'
    )!
    expect(track.keyframes.map((keyframe) => [keyframe.timeMs, keyframe.value])).toEqual([
      [0, 10],
      [500, 10]
    ])
    expect(renderer.root.findByProps({ 'aria-label': 'Remove x keyframe' }).props['aria-pressed']).toBe(true)

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Remove x keyframe' }).props.onClick()
    })
    expect(
      useCanvasShapeStore.getState().document.motion!.timelines[frameId].tracks[0].keyframes
    ).toHaveLength(1)

    await act(async () => renderer.unmount())
  })

  it('adds an offset keyframe relative to the current shape base', async () => {
    const { shapeId, frameId } = installDocument()
    let document = useCanvasShapeStore.getState().document
    document.motion = applyMotionPreset(document.motion, document, frameId, [shapeId], 'move', {
      direction: 'right',
      distance: 20,
      durationMs: 100
    })
    document = {
      ...document,
      objects: {
        ...document.objects,
        [shapeId]: { ...document.objects[shapeId], x: 50 }
      }
    }
    useCanvasShapeStore.getState().loadDocument(document, 'motion-inspector-offset-base')
    useCanvasMotionStore.setState({ open: true, activeFrameId: frameId, currentTimeMs: 50 })
    const beforeTrack = useCanvasShapeStore.getState().document.motion!.timelines[frameId].tracks.find(
      (candidate) => candidate.targetShapeId === shapeId && candidate.property === 'x'
    )!
    const expectedRaw = evaluateMotionTrack(beforeTrack, 50, 50) - 50

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(MotionKeyframeControls, {
        shape: useCanvasShapeStore.getState().document.objects[shapeId]
      }))
    })
    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Add x keyframe' }).props.onClick()
    })

    const afterTrack = useCanvasShapeStore.getState().document.motion!.timelines[frameId].tracks.find(
      (candidate) => candidate.targetShapeId === shapeId && candidate.property === 'x'
    )!
    expect(afterTrack.keyframes.find((keyframe) => keyframe.timeMs === 50)?.value).toBeCloseTo(expectedRaw)
    await act(async () => renderer.unmount())
  })

  it('routes supported PropertiesPanel edits through Auto-key without rewriting base geometry', () => {
    const { shapeId, frameId } = installDocument()
    useCanvasMotionStore.getState().setAutoKey(true)

    commitInspectorUpdate('design', 'set-x', [shapeId], { x: 42 })

    const state = useCanvasShapeStore.getState()
    expect(state.document.objects[shapeId].x).toBe(10)
    expect(state.document.motion!.timelines[frameId].tracks[0]).toMatchObject({
      targetShapeId: shapeId,
      property: 'x',
      baseValue: 10
    })
    expect(
      state.document.motion!.timelines[frameId].tracks[0].keyframes.map((keyframe) => [
        keyframe.timeMs,
        keyframe.value
      ])
    ).toEqual([
      [0, 10],
      [500, 42]
    ])
  })

  it('turns one transient canvas gesture into one Auto-key mutation', () => {
    const { shapeId, frameId } = installDocument()
    useCanvasMotionStore.getState().setAutoKey(true)
    const patches = [{ id: shapeId, before: { x: 10 }, after: { x: 64 } }]

    useCanvasShapeStore.getState().updateShape(shapeId, { x: 64 }, true)
    expect(shouldAutoKeyCanvasGesture(patches)).toBe(true)
    expect(commitAutoKeyCanvasGesture(patches, 'move')).toBe(true)

    const state = useCanvasShapeStore.getState()
    expect(state.document.objects[shapeId].x).toBe(10)
    expect(state.document.motion!.timelines[frameId].tracks[0].keyframes.at(-1)).toMatchObject({
      timeMs: 500,
      value: 64
    })
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)
  })
})
