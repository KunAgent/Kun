import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { BrowserUseViewState } from '@shared/browser-use'
import { bodyZoom, toLayoutPx } from '../lib/body-zoom'
import { observeBrowserLayout } from './agent-browser-layout-observer'
import { browserUsePreviewNeedsAttention, useAgentBrowserPreviewStore } from './agent-browser-preview-state'
import {
  moveBrowserPreview, resolveBrowserPreviewFrame, resizeBrowserPreview,
  type BrowserPreviewFrame, type BrowserPreviewResizeDirection, type BrowserPreviewSize
} from './agent-browser-preview-layout'

interface Gesture {
  pointerId: number; x: number; y: number; frame: BrowserPreviewFrame; owner: BrowserUseViewState
  direction?: BrowserPreviewResizeDirection
  scale: number
}

const ARROW_DELTAS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16]
}

export function useAgentBrowserPreviewFrame(
  canvas: RefObject<HTMLDivElement | null>, state: BrowserUseViewState, open: boolean, expanded = false
) {
  const [container, setContainer] = useState<BrowserPreviewSize>({ width: 0, height: 0 })
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef(false)
  const geometry = useAgentBrowserPreviewStore((store) => state.threadId ? store.byThreadId[state.threadId]?.geometry : undefined)
  const frame = resolveBrowserPreviewFrame(container, geometry, browserUsePreviewNeedsAttention(state, state.threadId ?? null), expanded)

  useLayoutEffect(() => { gesture.current = null }, [state.threadId, state.sessionId, state.turnId, expanded, open])

  useLayoutEffect(() => {
    const element = canvas.current
    if (!element || !open) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      const scale = bodyZoom()
      if (gesture.current && gesture.current.scale !== scale) gesture.current = null
      const width = toLayoutPx(rect.width, scale)
      const height = toLayoutPx(rect.height, scale)
      setContainer((before) => before.width === width && before.height === height ? before : { width, height })
    }
    measure()
    return observeBrowserLayout(element, measure)
  }, [canvas, open, state.threadId, state.sessionId, expanded])

  const save = (owner: BrowserUseViewState, next: BrowserPreviewFrame) => {
    useAgentBrowserPreviewStore.getState().setGeometry(owner, { width: next.width, position: { x: next.x, y: next.y } })
  }
  const begin = (event: PointerEvent<HTMLElement>, direction?: BrowserPreviewResizeDirection) => {
    if (event.button !== 0 || expanded) return
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, frame, owner: state, direction, scale: bodyZoom() }
    suppressClick.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || event.pointerId !== current.pointerId) return
    if (current.scale !== bodyZoom() || current.owner.threadId !== state.threadId ||
      current.owner.sessionId !== state.sessionId || current.owner.turnId !== state.turnId) {
      gesture.current = null
      return
    }
    const delta = { x: toLayoutPx(event.clientX - current.x, current.scale), y: toLayoutPx(event.clientY - current.y, current.scale) }
    if (!suppressClick.current && Math.hypot(delta.x, delta.y) < 6) return
    suppressClick.current = true
    const next = current.direction ? resizeBrowserPreview(current.frame, current.direction, delta, container)
      : { ...current.frame, ...moveBrowserPreview({ x: current.frame.x + delta.x, y: current.frame.y + delta.y }, current.frame, container) }
    save(current.owner, next)
  }
  const end = (event: PointerEvent<HTMLElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    const delta = ARROW_DELTAS[event.key]
    suppressClick.current = false
    if (!delta || expanded || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault()
    const next = event.shiftKey ? resizeBrowserPreview(frame, 'se', { x: delta[0], y: delta[1] }, container)
      : { ...frame, ...moveBrowserPreview({ x: frame.x + delta[0], y: frame.y + delta[1] }, frame, container) }
    save(state, next)
  }
  return {
    frame, ready: container.width > 0 && container.height > 0, suppressClick,
    begin, keyDown, pointerEvents: { onPointerMove: move, onPointerUp: end, onPointerCancel: end }
  }
}
