import { useEffect, useMemo, type CSSProperties, type RefObject } from 'react'
import type { CanvasDocument, CanvasShape, Point } from '../canvas/canvas-types'
import { useCanvasShapeStore } from '../canvas/canvas-shape-store'
import { evaluateMotionTarget } from './evaluator'
import { useCanvasMotionStore } from './canvas-motion-store'
import type { CanvasMotionProjection } from './canvas-motion-types'

type MotionTargetElement = HTMLElement | SVGElement

export type CanvasMotionPreviewValues = {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
  opacity: number
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function shapeMotionBaseValues(shape: CanvasShape): CanvasMotionProjection {
  return {
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    scaleX: 1,
    scaleY: 1,
    opacity: shape.opacity
  }
}

export function resolveCanvasMotionPreviewValues(
  shape: CanvasShape,
  projection: Partial<Record<'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity', number>>
): CanvasMotionPreviewValues {
  return {
    x: finite(projection.x, shape.x),
    y: finite(projection.y, shape.y),
    rotation: finite(projection.rotation, shape.rotation),
    scaleX: finite(projection.scaleX, 1),
    scaleY: finite(projection.scaleY, 1),
    opacity: Math.max(0, Math.min(1, finite(projection.opacity, shape.opacity)))
  }
}

export type CanvasMotionMatrix2D = [number, number, number, number, number, number]

function multiplyMatrix(left: CanvasMotionMatrix2D, right: CanvasMotionMatrix2D): CanvasMotionMatrix2D {
  const [a1, b1, c1, d1, e1, f1] = left
  const [a2, b2, c2, d2, e2, f2] = right
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1
  ]
}

function translateMatrix(x: number, y: number): CanvasMotionMatrix2D {
  return [1, 0, 0, 1, x, y]
}

function rotateMatrix(degrees: number): CanvasMotionMatrix2D {
  const radians = degrees * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return [cosine, sine, -sine, cosine, 0, 0]
}

function scaleMatrix(x: number, y: number): CanvasMotionMatrix2D {
  return [x, 0, 0, y, 0, 0]
}

function inverseMatrix(matrix: CanvasMotionMatrix2D): CanvasMotionMatrix2D {
  const [a, b, c, d, e, f] = matrix
  const determinant = a * d - b * c
  if (Math.abs(determinant) < 1e-10) return [1, 0, 0, 1, 0, 0]
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant
  ]
}

function absoluteShapeMatrix(
  shape: CanvasShape,
  x: number,
  y: number,
  rotation: number,
  scaleX: number,
  scaleY: number
): CanvasMotionMatrix2D {
  const centerX = shape.width / 2
  const centerY = shape.height / 2
  return multiplyMatrix(
    translateMatrix(x, y),
    multiplyMatrix(
      translateMatrix(centerX, centerY),
      multiplyMatrix(
        rotateMatrix(rotation),
        multiplyMatrix(scaleMatrix(scaleX, scaleY), translateMatrix(-centerX, -centerY))
      )
    )
  )
}

function cleanMatrixValue(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000
  return Object.is(rounded, -0) ? 0 : rounded
}

export function svgPreviewTransform(shape: CanvasShape, values: CanvasMotionPreviewValues): string {
  const delta = canvasMotionDeltaMatrix(shape, values)
  if (!delta) return ''
  return `matrix(${delta.map(cleanMatrixValue).join(' ')})`
}

export function canvasMotionDeltaMatrix(
  shape: CanvasShape,
  values: CanvasMotionPreviewValues
): CanvasMotionMatrix2D | null {
  const unchanged = values.x === shape.x && values.y === shape.y &&
    values.rotation === shape.rotation && values.scaleX === 1 && values.scaleY === 1
  if (unchanged) return null
  const base = absoluteShapeMatrix(shape, shape.x, shape.y, shape.rotation, 1, 1)
  const desired = absoluteShapeMatrix(
    shape,
    values.x,
    values.y,
    values.rotation,
    values.scaleX,
    values.scaleY
  )
  return multiplyMatrix(desired, inverseMatrix(base))
}

function transformPoint(matrix: CanvasMotionMatrix2D, point: Point): Point {
  const [a, b, c, d, e, f] = matrix
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
}

function canvasMotionWorldMatrix(
  document: CanvasDocument,
  frameId: string,
  shapeId: string,
  timeMs: number,
  gestureOverrides: Readonly<Record<string, Partial<CanvasMotionPreviewValues>>>
): CanvasMotionMatrix2D | null {
  const timeline = document.motion?.timelines[frameId]
  const path: CanvasShape[] = []
  const visited = new Set<string>()
  let currentId: string | null = shapeId
  while (currentId && currentId !== document.rootId && !visited.has(currentId)) {
    visited.add(currentId)
    const shape: CanvasShape | undefined = document.objects[currentId]
    if (!shape) break
    path.push(shape)
    currentId = shape.parentId
  }

  let world: CanvasMotionMatrix2D = [1, 0, 0, 1, 0, 0]
  let animated = false
  const orderedPath = path.reverse()
  for (let index = 0; index < orderedPath.length; index += 1) {
    const shape = orderedPath[index]
    const projection = {
      ...(timeline ? evaluateMotionTarget(timeline, shape.id, timeMs, shapeMotionBaseValues(shape)) : {}),
      ...gestureOverrides[shape.id]
    }
    const delta = canvasMotionDeltaMatrix(shape, resolveCanvasMotionPreviewValues(shape, projection))
    if (delta) {
      world = multiplyMatrix(world, delta)
      animated = true
    }
    world = multiplyMatrix(
      world,
      absoluteShapeMatrix(shape, shape.x, shape.y, shape.rotation, 1, 1)
    )
    if (index < orderedPath.length - 1) {
      world = multiplyMatrix(world, translateMatrix(-shape.x, -shape.y))
    }
  }
  return animated ? world : null
}

function projectedShape(shape: CanvasShape, world: CanvasMotionMatrix2D): CanvasShape {
  if (shape.points && shape.points.length >= 2) {
    const points = shape.points.map((point) => transformPoint(world, point))
    const minX = Math.min(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxX = Math.max(...points.map((point) => point.x))
    const maxY = Math.max(...points.map((point) => point.y))
    return {
      ...shape,
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
      rotation: 0,
      points: points.map((point) => ({ x: point.x - minX, y: point.y - minY }))
    }
  }

  const points = [
    { x: 0, y: 0 },
    { x: shape.width, y: 0 },
    { x: shape.width, y: shape.height },
    { x: 0, y: shape.height }
  ].map((point) => transformPoint(world, point))
  const width = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
  const height = Math.hypot(points[3].x - points[0].x, points[3].y - points[0].y)
  const rotation = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) * 180 / Math.PI
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length
  const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length
  return {
    ...shape,
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
    rotation
  }
}

/**
 * Builds a transient geometry view for selection, marquee, snapping, and hit
 * testing. Canonical canvas objects remain untouched; ancestor motion is
 * composed so a layer inside an animated frame is still selectable where it
 * is visibly rendered.
 */
export function projectCanvasMotionObjects(
  document: CanvasDocument,
  frameId: string,
  timeMs: number,
  gestureOverrides: Readonly<Record<string, Partial<CanvasMotionPreviewValues>>> = {}
): Record<string, CanvasShape> {
  const timeline = document.motion?.timelines[frameId]
  if (!timeline && Object.keys(gestureOverrides).length === 0) return document.objects
  const objects = { ...document.objects }
  let changed = false
  for (const shape of Object.values(document.objects)) {
    if (shape.id === document.rootId) continue
    const matrix = canvasMotionWorldMatrix(document, frameId, shape.id, timeMs, gestureOverrides)
    if (!matrix) continue
    objects[shape.id] = projectedShape(shape, matrix)
    changed = true
  }
  return changed ? objects : document.objects
}

function canvasMotionWorldOpacity(
  document: CanvasDocument,
  frameId: string,
  shapeId: string,
  timeMs: number,
  gestureOverrides: Readonly<Record<string, Partial<CanvasMotionPreviewValues>>>
): number {
  const timeline = document.motion?.timelines[frameId]
  let opacity = 1
  const visited = new Set<string>()
  let currentId: string | null = shapeId
  while (currentId && currentId !== document.rootId && !visited.has(currentId)) {
    visited.add(currentId)
    const shape: CanvasShape | undefined = document.objects[currentId]
    if (!shape) break
    const projection = {
      ...(timeline ? evaluateMotionTarget(timeline, shape.id, timeMs, shapeMotionBaseValues(shape)) : {}),
      ...gestureOverrides[shape.id]
    }
    opacity *= resolveCanvasMotionPreviewValues(shape, projection).opacity
    currentId = shape.parentId
  }
  return Math.max(0, Math.min(1, opacity))
}

export function resolveCanvasMotionPortalStyle(
  document: CanvasDocument,
  shape: CanvasShape,
  frameId: string,
  timeMs: number,
  zoom: number,
  gestureOverrides: Readonly<Record<string, Partial<CanvasMotionPreviewValues>>> = {}
): CSSProperties {
  const projected = projectCanvasMotionObjects(
    document,
    frameId,
    timeMs,
    gestureOverrides
  )[shape.id] ?? shape
  // Portal elements are positioned at the canonical top-left and transformed
  // around their center. A scaled projection changes its bounding-box
  // top-left even when the visual center is stationary, so feeding projected.x
  // directly into the CSS translation would apply that scale displacement a
  // second time. Translate by center delta and let CSS scale own the bounds.
  const projectedCenterX = projected.x + projected.width / 2
  const projectedCenterY = projected.y + projected.height / 2
  const baseCenterX = shape.x + shape.width / 2
  const baseCenterY = shape.y + shape.height / 2
  const values: CanvasMotionPreviewValues = {
    x: shape.x + projectedCenterX - baseCenterX,
    y: shape.y + projectedCenterY - baseCenterY,
    rotation: projected.rotation,
    scaleX: shape.width === 0 ? 1 : projected.width / shape.width,
    scaleY: shape.height === 0 ? 1 : projected.height / shape.height,
    opacity: canvasMotionWorldOpacity(document, frameId, shape.id, timeMs, gestureOverrides)
  }
  return {
    opacity: values.opacity,
    transform: portalPreviewTransform(shape, values, zoom) || undefined,
    transformOrigin: 'center'
  }
}

export function portalPreviewTransform(
  shape: CanvasShape,
  values: CanvasMotionPreviewValues,
  zoom: number
): string {
  const dx = (values.x - shape.x) * zoom
  const dy = (values.y - shape.y) * zoom
  const parts: string[] = []
  if (dx || dy) parts.push(`translate(${dx}px, ${dy}px)`)
  if (values.rotation) parts.push(`rotate(${values.rotation}deg)`)
  if (values.scaleX !== 1 || values.scaleY !== 1) {
    parts.push(`scale(${values.scaleX}, ${values.scaleY})`)
  }
  return parts.join(' ')
}

/** React-owned portal styling survives webview/artifact rerenders and mounts. */
export function useCanvasMotionPortalStyle(shape: CanvasShape, zoom: number): CSSProperties {
  const open = useCanvasMotionStore((state) => state.open)
  const frameId = useCanvasMotionStore((state) => state.activeFrameId)
  const timeMs = useCanvasMotionStore((state) => state.currentTimeMs)
  const gestureOverrides = useCanvasMotionStore((state) => state.gestureOverrides)
  const document = useCanvasShapeStore((state) => state.document)
  return useMemo(() => {
    if (!open || !frameId) {
      const values = resolveCanvasMotionPreviewValues(shape, {})
      return {
        opacity: values.opacity,
        transform: portalPreviewTransform(shape, values, zoom) || undefined,
        transformOrigin: 'center'
      }
    }
    return resolveCanvasMotionPortalStyle(
      document,
      shape,
      frameId,
      timeMs,
      zoom,
      gestureOverrides
    )
  }, [document, frameId, gestureOverrides, open, shape, timeMs, zoom])
}

export function resetCanvasMotionTarget(
  element: MotionTargetElement,
  shape: CanvasShape
): void {
  const kind = element.getAttribute('data-canvas-motion-kind')
  if (kind === 'svg' || kind === 'selection') {
    element.removeAttribute('transform')
    if (kind === 'svg') element.setAttribute('opacity', String(shape.opacity))
    return
  }
  const html = element as HTMLElement
  html.style.transform = shape.rotation ? `rotate(${shape.rotation}deg)` : ''
  html.style.transformOrigin = 'center'
  html.style.opacity = String(shape.opacity)
}

export function applyCanvasMotionTarget(
  element: MotionTargetElement,
  shape: CanvasShape,
  values: CanvasMotionPreviewValues,
  zoom: number
): void {
  const kind = element.getAttribute('data-canvas-motion-kind')
  if (kind === 'svg' || kind === 'selection') {
    const transform = svgPreviewTransform(shape, values)
    if (transform) element.setAttribute('transform', transform)
    else element.removeAttribute('transform')
    if (kind === 'svg') element.setAttribute('opacity', String(values.opacity))
    return
  }
  const html = element as HTMLElement
  html.style.transform = portalPreviewTransform(shape, values, zoom)
  html.style.transformOrigin = 'center'
  html.style.opacity = String(values.opacity)
}

function targets(root: HTMLElement): MotionTargetElement[] {
  return [...root.querySelectorAll<MotionTargetElement>(
    '[data-canvas-motion-target][data-canvas-motion-kind="svg"], ' +
    '[data-canvas-motion-target][data-canvas-motion-kind="selection"]'
  )]
}

export function resetCanvasMotionPreview(root: HTMLElement, document: CanvasDocument): void {
  for (const element of targets(root)) {
    const shapeId = element.getAttribute('data-canvas-motion-target')
    const shape = shapeId ? document.objects[shapeId] : undefined
    if (shape) resetCanvasMotionTarget(element, shape)
  }
}

export function applyCanvasMotionPreview(
  root: HTMLElement,
  document: CanvasDocument,
  frameId: string,
  timeMs: number,
  zoom: number
): void {
  const timeline = document.motion?.timelines[frameId]
  const gestureOverrides = useCanvasMotionStore.getState().gestureOverrides
  if (!timeline && Object.keys(gestureOverrides).length === 0) {
    resetCanvasMotionPreview(root, document)
    return
  }
  for (const element of targets(root)) {
    const shapeId = element.getAttribute('data-canvas-motion-target')
    const shape = shapeId ? document.objects[shapeId] : undefined
    if (!shape) continue
    const projection = {
      ...(timeline ? evaluateMotionTarget(timeline, shape.id, timeMs, shapeMotionBaseValues(shape)) : {}),
      ...gestureOverrides[shape.id]
    }
    if (Object.keys(projection).length === 0) {
      resetCanvasMotionTarget(element, shape)
      continue
    }
    applyCanvasMotionTarget(
      element,
      shape,
      resolveCanvasMotionPreviewValues(shape, projection),
      zoom
    )
  }
}

/**
 * Subscribe imperatively so the 60-Hz transport updates DOM wrappers without
 * re-rendering CanvasViewport or writing persistent Zustand document state.
 */
export function useCanvasMotionPreview(
  rootRef: RefObject<HTMLElement | null>,
  document: CanvasDocument,
  zoom: number,
  enabled: boolean,
  refreshKey = ''
): void {
  useEffect(() => {
    const root = rootRef.current
    if (!root || !enabled) return
    const apply = (): void => {
      const state = useCanvasMotionStore.getState()
      const frameId = state.activeFrameId ?? document.rootId
      if (!state.open) resetCanvasMotionPreview(root, document)
      else applyCanvasMotionPreview(root, document, frameId, state.currentTimeMs, zoom)
    }
    apply()
    const unsubscribe = useCanvasMotionStore.subscribe(apply)
    return () => {
      unsubscribe()
      resetCanvasMotionPreview(root, document)
    }
  }, [document, enabled, refreshKey, rootRef, zoom])
}
