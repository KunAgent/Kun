import { useCanvasViewportStore } from '../canvas-viewport-store'
import type { CanvasPointerEvent, CanvasToolHandler } from './tool-types'

export function createHandTool(): CanvasToolHandler {
  let dragging = false
  let lastX = 0
  let lastY = 0

  return {
    cursor: 'grab',

    onPointerDown(e: CanvasPointerEvent) {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
    },

    onPointerMove(e: CanvasPointerEvent) {
      if (!dragging) return
      const { vbox, containerWidth, containerHeight } = useCanvasViewportStore.getState()
      const scaleX = vbox.width / containerWidth
      const scaleY = vbox.height / containerHeight
      const dx = (e.clientX - lastX) * scaleX
      const dy = (e.clientY - lastY) * scaleY
      useCanvasViewportStore.getState().pan(dx, dy)
      lastX = e.clientX
      lastY = e.clientY
    },

    onPointerUp() {
      dragging = false
    }
  }
}
