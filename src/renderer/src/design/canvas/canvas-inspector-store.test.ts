import { afterEach, describe, expect, it } from 'vitest'
import {
  CANVAS_INSPECTOR_DEFAULT_HEIGHT,
  CANVAS_INSPECTOR_MIN_HEIGHT,
  canvasInspectorTabsForSurface,
  clampCanvasInspectorHeight,
  openCanvasInspectorTab,
  parsePersistedCanvasInspectorState,
  toggleCanvasInspector,
  useCanvasInspectorStore
} from './canvas-inspector-store'
import { useCanvasMotionStore } from '../motion/canvas-motion-store'

afterEach(() => {
  useCanvasInspectorStore.setState({ open: false, tab: 'properties', focusedShapeId: null })
  useCanvasMotionStore.getState().setOpen(false)
})

describe('canvas inspector store', () => {
  it('keeps the drawer between its minimum and its share of the host', () => {
    expect(clampCanvasInspectorHeight(40, 800)).toBe(CANVAS_INSPECTOR_MIN_HEIGHT)
    expect(clampCanvasInspectorHeight(700, 800)).toBe(576)
    expect(clampCanvasInspectorHeight(320, 800)).toBe(320)
    expect(clampCanvasInspectorHeight(Number.NaN, 0)).toBe(CANVAS_INSPECTOR_DEFAULT_HEIGHT)
    expect(clampCanvasInspectorHeight(400, 100)).toBe(CANVAS_INSPECTOR_MIN_HEIGHT)
  })

  it('offers Tweaks only on the Design canvas', () => {
    expect(canvasInspectorTabsForSurface(true)).toEqual(['properties', 'outline', 'code', 'tweaks', 'notes'])
    expect(canvasInspectorTabsForSurface(false)).toEqual(['properties', 'outline', 'code'])
  })

  it('restores valid persisted fields and falls back on junk', () => {
    expect(parsePersistedCanvasInspectorState(
      JSON.stringify({ open: true, tab: 'code', height: 420.4, minimapVisible: true, focusFit: 'fill' })
    )).toEqual({ open: true, tab: 'code', height: 420, minimapVisible: true, focusFit: 'fill', flowsVisible: false })
    expect(parsePersistedCanvasInspectorState(JSON.stringify({ flowsVisible: true })).flowsVisible).toBe(true)
    expect(parsePersistedCanvasInspectorState(JSON.stringify({ tab: 'layers', height: 'tall', focusFit: 'zoom' })))
      .toMatchObject({ open: false, tab: 'properties', height: CANVAS_INSPECTOR_DEFAULT_HEIGHT, focusFit: 'fit' })
    expect(parsePersistedCanvasInspectorState('{not json').tab).toBe('properties')
  })

  it('shares the bottom edge with the motion dock one at a time', () => {
    useCanvasMotionStore.getState().setOpen(true)
    openCanvasInspectorTab('outline')
    expect(useCanvasInspectorStore.getState()).toMatchObject({ open: true, tab: 'outline' })
    expect(useCanvasMotionStore.getState().open).toBe(false)

    toggleCanvasInspector()
    expect(useCanvasInspectorStore.getState().open).toBe(false)
    useCanvasMotionStore.getState().setOpen(true)
    toggleCanvasInspector()
    expect(useCanvasInspectorStore.getState().open).toBe(true)
    expect(useCanvasMotionStore.getState().open).toBe(false)
  })
})
