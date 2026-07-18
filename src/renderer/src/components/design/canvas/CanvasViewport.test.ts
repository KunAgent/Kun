import { describe, expect, it } from 'vitest'
import {
  canvasViewportBackgroundFillClass,
  resolveCanvasDesignSystemBaseDir,
  shouldRenderCanvasMinimap,
  shouldHandleCanvasKeyboardEvent,
  shouldRenderDesignArtifactOverlays,
  shouldOpenImageAnnotation,
  resolveSelectedImageAnnotationAction,
  mergeLoadedCanvasDocumentWithLiveChanges,
  resolveCanvasSelectionAfterDocumentSync,
  resolveHtmlFrameOverlayInteractionState,
  shouldShowCanvasDocumentLoading,
  shouldResetCanvasTransientInteractionAfterDocumentSync,
  shouldSyncCanvasHtmlFrames,
  shouldToggleHtmlFrameInteractiveOnDoubleClick
} from './CanvasViewport'
import { createDefaultShape, createEmptyDocument, createHtmlFrameShape } from '../../../design/canvas/canvas-types'

describe('CanvasViewport surface behavior', () => {
  it('only exposes the design canvas fill layers to UI plugin backgrounds', () => {
    expect(canvasViewportBackgroundFillClass('design')).toBe('ds-stage-design-canvas-fill')
    expect(canvasViewportBackgroundFillClass('code')).toBe('')
  })

  it('renders the initialized empty canvas while a historical document is still loading', () => {
    expect(shouldShowCanvasDocumentLoading(createEmptyDocument())).toBe(false)
  })

  it('keeps design artifact overlays out of the code canvas', () => {
    expect(shouldRenderDesignArtifactOverlays('code')).toBe(false)
    expect(shouldRenderDesignArtifactOverlays('design')).toBe(true)
  })

  it('keeps the minimap out of the code sidebar canvas', () => {
    expect(shouldRenderCanvasMinimap('code')).toBe(false)
    expect(shouldRenderCanvasMinimap('design')).toBe(true)
  })

  it('keeps HTML frame artifact sync scoped to the design canvas', () => {
    expect(shouldSyncCanvasHtmlFrames('design', true)).toBe(true)
    expect(shouldSyncCanvasHtmlFrames('design', false)).toBe(false)
    expect(shouldSyncCanvasHtmlFrames('code', true)).toBe(false)
  })

  it('allows filled images to open annotation on design and code canvases', () => {
    const image = createDefaultShape('image', 0, 0)
    image.imageUrl = 'assets/image.png'
    const emptyImage = createDefaultShape('image', 0, 0)
    const rect = createDefaultShape('rect', 0, 0)

    expect(shouldOpenImageAnnotation('design', image)).toBe(true)
    expect(shouldOpenImageAnnotation('code', image)).toBe(true)
    expect(shouldOpenImageAnnotation('code', emptyImage)).toBe(false)
    expect(shouldOpenImageAnnotation('code', rect)).toBe(false)
  })

  it('positions the selected image annotation action near the image top edge', () => {
    const doc = createEmptyDocument()
    const image = createDefaultShape('image', 100, 100)
    image.width = 200
    image.height = 120
    image.imageUrl = 'assets/image.png'
    doc.objects[image.id] = { ...image, parentId: doc.rootId }
    doc.objects[doc.rootId]!.children.push(image.id)

    expect(
      resolveSelectedImageAnnotationAction('design', doc, new Set([image.id]), {
        vbox: { x: 0, y: 0, width: 500, height: 400 },
        containerWidth: 500,
        containerHeight: 400
      })
    ).toEqual({
      shapeId: image.id,
      left: 188,
      top: 60,
      width: 112,
      height: 30,
      placement: 'above'
    })
  })

  it('keeps the image annotation action attached when the SVG is vertically letterboxed', () => {
    const doc = createEmptyDocument()
    const image = createDefaultShape('image', 100, 100)
    image.width = 200
    image.height = 120
    image.imageUrl = 'assets/image.png'
    doc.objects[image.id] = { ...image, parentId: doc.rootId }
    doc.objects[doc.rootId]!.children.push(image.id)

    expect(
      resolveSelectedImageAnnotationAction('design', doc, new Set([image.id]), {
        vbox: { x: 0, y: 0, width: 500, height: 400 },
        containerWidth: 500,
        containerHeight: 700
      })
    ).toEqual({
      shapeId: image.id,
      left: 188,
      top: 210,
      width: 112,
      height: 30,
      placement: 'above'
    })
  })

  it('moves the selected image annotation action below when there is no room above', () => {
    const doc = createEmptyDocument()
    const image = createDefaultShape('image', 100, 20)
    image.width = 200
    image.height = 120
    image.imageUrl = 'assets/image.png'
    doc.objects[image.id] = { ...image, parentId: doc.rootId }
    doc.objects[doc.rootId]!.children.push(image.id)

    expect(
      resolveSelectedImageAnnotationAction('design', doc, new Set([image.id]), {
        vbox: { x: 0, y: 0, width: 500, height: 400 },
        containerWidth: 500,
        containerHeight: 400
      })?.placement
    ).toBe('below')
  })

  it('hides the selected image annotation action for empty or multi-selection', () => {
    const doc = createEmptyDocument()
    const image = createDefaultShape('image', 100, 100)
    const rect = createDefaultShape('rect', 320, 100)
    doc.objects[image.id] = { ...image, parentId: doc.rootId }
    doc.objects[rect.id] = { ...rect, parentId: doc.rootId }
    doc.objects[doc.rootId]!.children.push(image.id, rect.id)

    expect(
      resolveSelectedImageAnnotationAction('design', doc, new Set([image.id]), {
        vbox: { x: 0, y: 0, width: 500, height: 400 },
        containerWidth: 500,
        containerHeight: 400
      })
    ).toBeNull()

    image.imageUrl = 'assets/image.png'
    doc.objects[image.id] = { ...image, parentId: doc.rootId }
    expect(
      resolveSelectedImageAnnotationAction('design', doc, new Set([image.id, rect.id]), {
        vbox: { x: 0, y: 0, width: 500, height: 400 },
        containerWidth: 500,
        containerHeight: 400
      })
    ).toBeNull()

    expect(
      resolveSelectedImageAnnotationAction('design', doc, new Set([image.id]), {
        vbox: { x: 600, y: 0, width: 500, height: 400 },
        containerWidth: 500,
        containerHeight: 400
      })
    ).toBeNull()
  })

  it('toggles live HTML frame interaction from design-surface double-clicks only', () => {
    const htmlFrame = createDefaultShape('frame', 0, 0)
    htmlFrame.htmlArtifactId = 'artifact_html'
    const plainFrame = createDefaultShape('frame', 0, 0)

    expect(shouldToggleHtmlFrameInteractiveOnDoubleClick('design', htmlFrame)).toBe(true)
    expect(shouldToggleHtmlFrameInteractiveOnDoubleClick('code', htmlFrame)).toBe(false)
    expect(shouldToggleHtmlFrameInteractiveOnDoubleClick('design', plainFrame)).toBe(false)
    expect(shouldToggleHtmlFrameInteractiveOnDoubleClick('design', undefined)).toBe(false)
  })

  it('allows code canvases to override the design-system persistence directory', () => {
    expect(resolveCanvasDesignSystemBaseDir('.kun-canvas', '.kun-canvas/code-thread-1')).toBe(
      '.kun-canvas/code-thread-1'
    )
    expect(resolveCanvasDesignSystemBaseDir('.kun-design/doc-1', undefined)).toBe('.kun-design/doc-1')
  })

  it('keeps design canvas keyboard shortcuts global', () => {
    expect(shouldHandleCanvasKeyboardEvent('design', null, null, null)).toBe(true)
  })

  it('scopes code canvas keyboard shortcuts to the whiteboard tree', () => {
    const inside = {}
    const activeInside = {}
    const outside = {}
    const root = {
      contains: (target: unknown) => target === inside || target === activeInside
    } as HTMLElement

    expect(shouldHandleCanvasKeyboardEvent('code', inside as EventTarget, root, null)).toBe(true)
    expect(shouldHandleCanvasKeyboardEvent('code', outside as EventTarget, root, activeInside as Element)).toBe(true)
    expect(shouldHandleCanvasKeyboardEvent('code', outside as EventTarget, root, null)).toBe(false)
    expect(shouldHandleCanvasKeyboardEvent('code', inside as EventTarget, null, null)).toBe(false)
  })

  it('prunes selection state to shapes that still exist after document sync', () => {
    const doc = createEmptyDocument()
    const surviving = createDefaultShape('frame', 0, 0)
    doc.objects[surviving.id] = { ...surviving, parentId: doc.rootId }
    doc.objects[doc.rootId] = {
      ...doc.objects[doc.rootId]!,
      children: [surviving.id]
    }

    expect(resolveCanvasSelectionAfterDocumentSync(doc, {
      selectedIds: [surviving.id, 'removed-frame'],
      editingId: 'removed-frame',
      hoverTargetId: surviving.id
    })).toEqual({
      selectedIds: [surviving.id],
      editingId: null,
      hoverTargetId: surviving.id
    })
  })

  it('clears HTML overlay interaction state for removed, unselected, or non-html frames', () => {
    const doc = createEmptyDocument()
    const htmlFrame = createHtmlFrameShape('Home', 0, 0, 'artifact-home', 'desktop')
    const hiddenHtmlFrame = createHtmlFrameShape('Hidden', 0, 0, 'artifact-hidden', 'desktop')
    hiddenHtmlFrame.visible = false
    const plainFrame = createDefaultShape('frame', 0, 0)
    for (const shape of [htmlFrame, hiddenHtmlFrame, plainFrame]) {
      doc.objects[shape.id] = { ...shape, parentId: doc.rootId }
      doc.objects[doc.rootId]!.children.push(shape.id)
    }

    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set([htmlFrame.id]), {
      interactiveId: htmlFrame.id,
      editingId: htmlFrame.id
    })).toEqual({
      interactiveId: htmlFrame.id,
      editingId: htmlFrame.id
    })
    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set([htmlFrame.id]), {
      interactiveId: 'removed-frame',
      editingId: htmlFrame.id
    })).toEqual({
      interactiveId: null,
      editingId: htmlFrame.id
    })
    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set(), {
      interactiveId: htmlFrame.id,
      editingId: htmlFrame.id
    })).toEqual({
      interactiveId: null,
      editingId: null
    })
    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set([hiddenHtmlFrame.id, plainFrame.id]), {
      interactiveId: hiddenHtmlFrame.id,
      editingId: plainFrame.id
    })).toEqual({
      interactiveId: null,
      editingId: null
    })
    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set([htmlFrame.id]), {
      interactiveId: htmlFrame.id,
      editingId: htmlFrame.id,
      overlayAvailable: false
    })).toEqual({
      interactiveId: null,
      editingId: null
    })
    expect(resolveHtmlFrameOverlayInteractionState(doc, new Set([htmlFrame.id]), {
      interactiveId: htmlFrame.id,
      editingId: htmlFrame.id,
      mountableFrameIds: new Set()
    })).toEqual({
      interactiveId: null,
      editingId: null
    })
  })

  it('resets transient marquee and snap guides when sync removes shapes', () => {
    expect(shouldResetCanvasTransientInteractionAfterDocumentSync(['removed-frame'])).toBe(true)
    expect(shouldResetCanvasTransientInteractionAfterDocumentSync([])).toBe(false)
  })

  it('merges live-created frames when the initial disk load resolves late', () => {
    const initial = createEmptyDocument()
    const loaded = createEmptyDocument()
    const persisted = createDefaultShape('rect', 10, 20)
    loaded.objects[persisted.id] = { ...persisted, parentId: loaded.rootId }
    loaded.objects[loaded.rootId]!.children.push(persisted.id)

    const live = createEmptyDocument()
    const screen = createHtmlFrameShape('Home', 100, 120, 'artifact-home', 'desktop')
    live.objects[screen.id] = { ...screen, parentId: live.rootId }
    live.objects[live.rootId]!.children.push(screen.id)

    const merged = mergeLoadedCanvasDocumentWithLiveChanges(loaded, live, initial)

    expect(merged.objects[persisted.id]).toBeTruthy()
    expect(merged.objects[screen.id]?.htmlArtifactId).toBe('artifact-home')
    expect(merged.objects[merged.rootId]?.children).toEqual([persisted.id, screen.id])
  })

  it('keeps a live html-frame upgrade over a stale loaded plain frame with the same id', () => {
    const initial = createEmptyDocument()
    const loaded = createEmptyDocument()
    const stale = createDefaultShape('frame', 10, 20)
    loaded.objects[stale.id] = { ...stale, parentId: loaded.rootId }
    loaded.objects[loaded.rootId]!.children.push(stale.id)

    const live = createEmptyDocument()
    const upgraded = {
      ...stale,
      name: 'Home',
      htmlArtifactId: 'artifact-home',
      width: 1280,
      height: 900,
      parentId: live.rootId
    }
    live.objects[upgraded.id] = upgraded
    live.objects[live.rootId]!.children.push(upgraded.id)

    const merged = mergeLoadedCanvasDocumentWithLiveChanges(loaded, live, initial)

    expect(merged.objects[stale.id]).toMatchObject({
      name: 'Home',
      htmlArtifactId: 'artifact-home',
      width: 1280,
      height: 900
    })
    expect(merged.objects[merged.rootId]?.children).toEqual([stale.id])
  })

  it('merges a live motion edit over a late disk load without dropping loaded timelines', () => {
    const initial = createEmptyDocument()
    const loaded = createEmptyDocument()
    const loadedFrame = createDefaultShape('frame', 0, 0)
    loaded.objects[loadedFrame.id] = { ...loadedFrame, parentId: loaded.rootId }
    loaded.objects[loaded.rootId].children = [loadedFrame.id]
    loaded.motion!.timelines[loadedFrame.id] = {
      id: 'timeline-loaded',
      frameId: loadedFrame.id,
      durationMs: 1_000,
      playback: 'once',
      tracks: [{
        id: 'track-loaded',
        targetShapeId: loadedFrame.id,
        property: 'opacity',
        operation: 'set',
        baseValue: 1,
        keyframes: [{ id: 'key-loaded', timeMs: 0, value: 1, easing: { type: 'linear' } }]
      }]
    }
    const live = createEmptyDocument()
    live.motion!.timelines[live.rootId] = {
      id: 'timeline-live',
      frameId: live.rootId,
      durationMs: 2_000,
      playback: 'loop',
      tracks: [{
        id: 'track-live',
        targetShapeId: live.rootId,
        property: 'rotation',
        operation: 'offset',
        baseValue: 0,
        keyframes: [{ id: 'key-live', timeMs: 0, value: 0, easing: { type: 'linear' } }]
      }]
    }

    const merged = mergeLoadedCanvasDocumentWithLiveChanges(loaded, live, initial)

    expect(merged.motion?.timelines[loadedFrame.id]?.id).toBe('timeline-loaded')
    expect(merged.motion?.timelines[live.rootId]).toMatchObject({
      id: 'timeline-live',
      durationMs: 2_000,
      playback: 'loop'
    })
  })
})
