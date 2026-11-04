import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { BrowserUseViewState } from '@shared/browser-use'
import { browserUsePreviewNeedsAttention, useAgentBrowserPreviewStore } from './agent-browser-preview-state'
import {
  moveBrowserPreview, resolveBrowserPreviewFrame, resizeBrowserPreview,
  type BrowserPreviewFrame, type BrowserPreviewResizeDirection, type BrowserPreviewSize
} from './agent-browser-preview-layout'

interface Gesture {
  pointerId: number; x: number; y: number; frame: BrowserPreviewFrame; owner: BrowserUseViewState
  direction?: BrowserPreviewResizeDirection
}

const ARROW_DELTAS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16]
}

export function useAgentBrowserPreviewFrame(
  canvas: RefObject<HTMLDivElement | null>, state: BrowserUseViewState, open: boolean
) {
  const [container, setContainer] = useState<BrowserPreviewSize>({ width: 0, height: 0 })
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef(false)
  const geometry = useAgentBrowserPreviewStore((store) => state.threadId ? store.byThreadId[state.threadId]?.geometry : undefined)
  const frame = resolveBrowserPreviewFrame(container, geometry, browserUsePreviewNeedsAttention(state, state.threadId ?? null))

  useLayoutEffect(() => {
    const element = canvas.current
    if (!element || !open) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setContainer((before) => before.width === rect.width && before.height === rect.height
        ? before : { width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [canvas, open, state.threadId, state.sessionId])

  const save = (owner: BrowserUseViewState, next: BrowserPreviewFrame) => {
    useAgentBrowserPreviewStore.getState().setGeometry(owner, { width: next.width, position: { x: next.x, y: next.y } })
  }
  const begin = (event: PointerEvent<HTMLElement>, direction?: BrowserPreviewResizeDirection) => {
    if (event.button !== 0) return
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, frame, owner: state, direction }
    suppressClick.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = gesture.current
    if (!current || event.pointerId !== current.pointerId) return
    const delta = { x: event.clientX - current.x, y: event.clientY - current.y }
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
    if (!delta || event.metaKey || event.ctrlKey || event.altKey) return
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
