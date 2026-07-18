import { beforeEach, describe, expect, it } from 'vitest'
import {
  createDefaultShape,
  createEmptyDocument,
  type CanvasDocument
} from '../canvas/canvas-types'
import { useCanvasShapeStore } from '../canvas/canvas-shape-store'
import { useCanvasSelectionStore } from '../canvas/canvas-selection-store'
import { useCanvasUndoStore } from '../canvas/canvas-undo-store'
import { addPropertyTracks, applyMotionPreset } from './canvas-motion-mutations'
import {
  beginAutoKeyCanvasGesture,
  commitActiveAutoKeyCanvasGesture
} from './canvas-motion-auto-key'
import { useCanvasMotionStore } from './canvas-motion-store'
import { createEmptyMotionDocument } from './model'

function documentWithTwoFrames(): CanvasDocument {
  const document = createEmptyDocument()
  const frameA = {
    ...createDefaultShape('frame', 0, 0),
    id: 'frame-a',
    parentId: document.rootId,
    children: ['child', 'sibling']
  }
  const frameB = {
    ...createDefaultShape('frame', 500, 0),
    id: 'frame-b',
    parentId: document.rootId,
    children: []
  }
  const child = {
    ...createDefaultShape('rect', 10, 20),
    id: 'child',
    parentId: frameA.id,
    frameId: frameA.id
  }
  const sibling = {
    ...createDefaultShape('rect', 40, 20),
    id: 'sibling',
    parentId: frameA.id,
    frameId: frameA.id
  }
  document.objects[document.rootId] = {
    ...document.objects[document.rootId],
    children: [frameA.id, frameB.id]
  }
  document.objects[frameA.id] = frameA
  document.objects[frameB.id] = frameB
  document.objects[child.id] = child
  document.objects[sibling.id] = sibling
  return document
}

describe('canvas motion document state and undo', () => {
  beforeEach(() => {
    useCanvasShapeStore.getState().loadDocument(documentWithTwoFrames(), 'motion-test')
    useCanvasUndoStore.getState().clear()
    useCanvasMotionStore.getState().reset()
    useCanvasSelectionStore.getState().clearSelection()
  })

  it('records, undoes, and redoes a motion-only change', () => {
    const store = useCanvasShapeStore.getState()
    const next = applyMotionPreset(
      store.document.motion,
      store.document,
      'frame-a',
      ['child'],
      'fade'
    )
    store.setMotionDocument(next, 'fade-child')

    const entry = useCanvasUndoStore.getState().undoStack[0]
    expect(entry).toMatchObject({ label: 'fade-child', patches: [] })
    expect(entry.motionPatch?.before.timelines).toEqual({})
    expect(useCanvasShapeStore.getState().document.motion?.timelines['frame-a']).toBeDefined()

    useCanvasShapeStore.getState().undo()
    expect(useCanvasShapeStore.getState().document.motion?.timelines).toEqual({})
    useCanvasShapeStore.getState().redo()
    expect(useCanvasShapeStore.getState().document.motion?.timelines['frame-a']).toBeDefined()
  })

  it('groups multiple motion mutations using the first before and final after snapshots', () => {
    const undo = useCanvasUndoStore.getState()
    undo.withGroup('author-motion', () => {
      useCanvasShapeStore.getState().updateMotion(
        (motion) =>
          addPropertyTracks(motion, {
            document: useCanvasShapeStore.getState().document,
            frameId: 'frame-a',
            targetShapeIds: ['child'],
            properties: ['x']
          }),
        'add-x'
      )
      useCanvasShapeStore.getState().updateMotion(
        (motion) =>
          addPropertyTracks(motion, {
            document: useCanvasShapeStore.getState().document,
            frameId: 'frame-a',
            targetShapeIds: ['child'],
            properties: ['opacity']
          }),
        'add-opacity'
      )
    })

    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)
    expect(useCanvasUndoStore.getState().undoStack[0].motionPatch?.before.timelines).toEqual({})
    expect(
      useCanvasUndoStore.getState().undoStack[0].motionPatch?.after.timelines['frame-a'].tracks
    ).toHaveLength(2)

    useCanvasShapeStore.getState().undo()
    expect(useCanvasShapeStore.getState().document.motion?.timelines).toEqual({})
    useCanvasShapeStore.getState().redo()
    expect(
      useCanvasShapeStore.getState().document.motion?.timelines['frame-a'].tracks
    ).toHaveLength(2)
  })

  it('does not record a semantic no-op motion replacement', () => {
    useCanvasShapeStore.getState().setMotionDocument(createEmptyMotionDocument())
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('routes a mixed inspector edit through Auto-key as one atomic undo entry', () => {
    const motionState = useCanvasMotionStore.getState()
    motionState.setOpen(true)
    motionState.setActiveFrameId('frame-a')
    motionState.setCurrentTimeMs(500)
    motionState.setAutoKey(true)

    useCanvasShapeStore.getState().updateShape('child', { x: 120, width: 180 })
    expect(useCanvasShapeStore.getState().document.objects.child).toMatchObject({ x: 10, width: 180 })
    expect(
      useCanvasShapeStore.getState().document.motion?.timelines['frame-a'].tracks[0].keyframes.map(
        ({ timeMs, value }) => ({ timeMs, value })
      )
    ).toEqual([
      { timeMs: 0, value: 10 },
      { timeMs: 500, value: 120 }
    ])
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)
    expect(useCanvasUndoStore.getState().undoStack[0]).toMatchObject({
      patches: [{ id: 'child', before: { width: 100 }, after: { width: 180 } }]
    })
    expect(useCanvasUndoStore.getState().undoStack[0].motionPatch).toBeDefined()

    useCanvasShapeStore.getState().undo()
    expect(useCanvasShapeStore.getState().document.objects.child).toMatchObject({ x: 10, width: 100 })
    expect(useCanvasShapeStore.getState().document.motion?.timelines).toEqual({})
    useCanvasShapeStore.getState().redo()
    expect(useCanvasShapeStore.getState().document.objects.child).toMatchObject({ x: 10, width: 180 })
    expect(useCanvasShapeStore.getState().document.motion?.timelines['frame-a']).toBeDefined()
  })

  it('keeps the normal base-shape edit path when Auto-key is disabled', () => {
    const motionState = useCanvasMotionStore.getState()
    motionState.setOpen(true)
    motionState.setActiveFrameId('frame-a')
    motionState.setCurrentTimeMs(500)

    useCanvasShapeStore.getState().updateShape('child', { x: 120 })
    expect(useCanvasShapeStore.getState().document.objects.child.x).toBe(120)
    expect(useCanvasShapeStore.getState().document.motion?.timelines).toEqual({})
  })

  it('keeps canvas gesture previews transient and commits one Auto-key transaction', () => {
    const motionState = useCanvasMotionStore.getState()
    motionState.setOpen(true)
    motionState.setActiveFrameId('frame-a')
    motionState.setCurrentTimeMs(500)
    motionState.setAutoKey(true)
    useCanvasSelectionStore.getState().select(['child'])

    expect(beginAutoKeyCanvasGesture(['child'])).toBe(true)
    useCanvasShapeStore.getState().updateShape('child', { x: 120, y: 80 }, true)
    expect(useCanvasShapeStore.getState().document.objects.child).toMatchObject({ x: 10, y: 20 })
    expect(useCanvasMotionStore.getState().gestureOverrides.child).toMatchObject({ x: 120, y: 80 })

    expect(commitActiveAutoKeyCanvasGesture('move')).toBe(true)
    expect(useCanvasShapeStore.getState().document.objects.child).toMatchObject({ x: 10, y: 20 })
    expect(useCanvasMotionStore.getState().gestureOverrides).toEqual({})
    const tracks = useCanvasShapeStore.getState().document.motion?.timelines['frame-a'].tracks ?? []
    expect(tracks.map((track) => track.property).sort()).toEqual(['x', 'y'])
    expect(tracks.map((track) => track.keyframes.at(-1)?.value).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([80, 120])
    expect(useCanvasUndoStore.getState().undoStack).toHaveLength(1)

    useCanvasShapeStore.getState().undo()
    expect(useCanvasShapeStore.getState().document.motion?.timelines).toEqual({})
  })

  it('limits Auto-key gestures to active-frame root selections', () => {
    const motionState = useCanvasMotionStore.getState()
    motionState.setOpen(true)
    motionState.setActiveFrameId('frame-a')
    motionState.setCurrentTimeMs(500)
    motionState.setAutoKey(true)

    expect(beginAutoKeyCanvasGesture(['frame-a', 'child', 'frame-b'])).toBe(true)
    expect(Object.keys(useCanvasMotionStore.getState().gestureStartValues)).toEqual(['frame-a'])
  })

  it('prunes deleted subtree tracks in the same undoable transaction', () => {
    const store = useCanvasShapeStore.getState()
    store.setMotionDocument(
      addPropertyTracks(store.document.motion, {
        document: store.document,
        frameId: 'frame-a',
        targetShapeIds: ['child', 'sibling'],
        properties: ['x']
      })
    )
    useCanvasUndoStore.getState().clear()

    useCanvasShapeStore.getState().deleteShape('child')
    expect(useCanvasShapeStore.getState().document.objects.child).toBeUndefined()
    expect(
      useCanvasShapeStore
        .getState()
        .document.motion?.timelines['frame-a'].tracks.map((track) => track.targetShapeId)
    ).toEqual(['sibling'])
    const change = useCanvasUndoStore.getState().undoStack[0]
    expect(change.patches.some((patch) => patch.id === 'child')).toBe(true)
    expect(change.motionPatch).toBeDefined()

    useCanvasShapeStore.getState().undo()
    expect(useCanvasShapeStore.getState().document.objects.child).toBeDefined()
    expect(
      useCanvasShapeStore
        .getState()
        .document.motion?.timelines['frame-a'].tracks.map((track) => track.targetShapeId)
    ).toEqual(['child', 'sibling'])
    useCanvasShapeStore.getState().redo()
    expect(useCanvasShapeStore.getState().document.objects.child).toBeUndefined()
    expect(
      useCanvasShapeStore
        .getState()
        .document.motion?.timelines['frame-a'].tracks.map((track) => track.targetShapeId)
    ).toEqual(['sibling'])
  })

  it('removes an owning-frame timeline with its subtree and restores both on undo', () => {
    const store = useCanvasShapeStore.getState()
    store.setMotionDocument(
      applyMotionPreset(store.document.motion, store.document, 'frame-a', ['child'], 'scale')
    )
    useCanvasUndoStore.getState().clear()

    useCanvasShapeStore.getState().deleteShape('frame-a')
    expect(useCanvasShapeStore.getState().document.motion?.timelines).toEqual({})
    expect(useCanvasShapeStore.getState().document.objects.child).toBeUndefined()
    useCanvasShapeStore.getState().undo()
    expect(useCanvasShapeStore.getState().document.objects['frame-a']).toBeDefined()
    expect(useCanvasShapeStore.getState().document.objects.child).toBeDefined()
    expect(
      useCanvasShapeStore.getState().document.motion?.timelines['frame-a'].tracks
    ).toHaveLength(2)
  })

  it('prunes tracks that become out of scope when a target is reparented', () => {
    const store = useCanvasShapeStore.getState()
    store.setMotionDocument(
      applyMotionPreset(store.document.motion, store.document, 'frame-a', ['child'], 'fade')
    )
    useCanvasUndoStore.getState().clear()

    useCanvasShapeStore.getState().reparentShape('child', 'frame-b')
    expect(useCanvasShapeStore.getState().document.objects.child.parentId).toBe('frame-b')
    expect(useCanvasShapeStore.getState().document.motion?.timelines['frame-a']?.tracks).toEqual([])

    useCanvasShapeStore.getState().undo()
    expect(useCanvasShapeStore.getState().document.objects.child.parentId).toBe('frame-a')
    expect(useCanvasShapeStore.getState().document.motion?.timelines['frame-a']).toBeDefined()
  })

  it('resets transient editor and playback state on a document switch', () => {
    const motionState = useCanvasMotionStore.getState()
    motionState.setOpen(true)
    motionState.setActiveFrameId('frame-a')
    motionState.setCurrentTimeMs(450)
    motionState.setPlaying(true)
    motionState.setAutoKey(true)
    motionState.selectKeyframe('track', 'keyframe')

    useCanvasShapeStore.getState().loadDocument(documentWithTwoFrames(), 'motion-test')
    expect(useCanvasMotionStore.getState()).toMatchObject({
      open: true,
      activeFrameId: 'frame-a',
      currentTimeMs: 450,
      playing: true,
      autoKey: true
    })

    useCanvasShapeStore.getState().loadDocument(createEmptyDocument(), 'next-document')
    expect(useCanvasMotionStore.getState()).toMatchObject({
      open: false,
      activeFrameId: null,
      currentTimeMs: 0,
      playing: false,
      autoKey: false,
      selectedTrackId: null,
      selectedKeyframeId: null
    })
  })
})
