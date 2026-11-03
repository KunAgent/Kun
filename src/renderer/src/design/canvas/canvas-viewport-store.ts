import { create } from 'zustand'
import type { CanvasTool, DevicePreset, Rect, ViewBox } from './canvas-types'

const MIN_ZOOM = 0.02
const MAX_ZOOM = 50
const DEFAULT_WIDTH = 1200
const DEFAULT_HEIGHT = 800

type ViewportState = {
  vbox: ViewBox
  containerWidth: number
  containerHeight: number
  activeTool: CanvasTool
  gridVisible: boolean
  snapEnabled: boolean
  /** Device chosen from the board menu; null = follow the design target. */
  screenDevicePreset: DevicePreset | null

  setContainerSize: (width: number, height: number) => void
  setVbox: (vbox: ViewBox) => void
  pan: (dx: number, dy: number) => void
  zoomTo: (factor: number, center: { x: number; y: number }) => void
  zoomToFit: (bounds: Rect, padding?: number, options?: { maxZoom?: number; minZoom?: number }) => void
  resetView: () => void
  setActiveTool: (tool: CanvasTool) => void
  setScreenDevicePreset: (preset: DevicePreset | null) => void
  toggleGrid: () => void
  toggleSnap: () => void
  getZoom: () => number
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

function safeSize(size: number, fallback: number): number {
  return Number.isFinite(size) && size > 0 ? size : fallback
}

export const useCanvasViewportStore = create<ViewportState>((set, get) => ({
  vbox: { x: -DEFAULT_WIDTH / 2, y: -DEFAULT_HEIGHT / 2, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  containerWidth: DEFAULT_WIDTH,
  containerHeight: DEFAULT_HEIGHT,
  activeTool: 'select',
  gridVisible: true,
  snapEnabled: true,
  screenDevicePreset: null,

  setContainerSize: (width, height) => {
    set((s) => {
      const containerWidth = safeSize(width, DEFAULT_WIDTH)
      const containerHeight = safeSize(height, DEFAULT_HEIGHT)
      const currentZoom = safeSize(s.containerWidth, DEFAULT_WIDTH) / safeSize(s.vbox.width, DEFAULT_WIDTH)
      const zoom = clampZoom(currentZoom)
      const cx = s.vbox.x + s.vbox.width / 2
      const cy = s.vbox.y + s.vbox.height / 2
      const nextWidth = containerWidth / zoom
      const nextHeight = containerHeight / zoom
      return {
        containerWidth,
        containerHeight,
        vbox: {
          x: cx - nextWidth / 2,
          y: cy - nextHeight / 2,
          width: nextWidth,
          height: nextHeight
        }
      }
    })
  },

  setVbox: (vbox) => set({ vbox }),

  pan: (dx, dy) =>
    set((s) => ({
      vbox: { ...s.vbox, x: s.vbox.x - dx, y: s.vbox.y - dy }
    })),

  zoomTo: (factor, center) =>
    set((s) => {
      const currentZoom = safeSize(s.containerWidth, DEFAULT_WIDTH) / safeSize(s.vbox.width, DEFAULT_WIDTH)
      const newZoom = clampZoom(currentZoom * factor)
      const newWidth = safeSize(s.containerWidth, DEFAULT_WIDTH) / newZoom
      const newHeight = safeSize(s.containerHeight, DEFAULT_HEIGHT) / newZoom
      const cx = center.x
      const cy = center.y
      return {
        vbox: {
          x: cx - (cx - s.vbox.x) * (newWidth / s.vbox.width),
          y: cy - (cy - s.vbox.y) * (newHeight / s.vbox.height),
          width: newWidth,
          height: newHeight
        }
      }
    }),

  zoomToFit: (bounds, padding = 40, options) =>
    set((s) => {
      const { containerWidth, containerHeight } = s
      if (bounds.width <= 0 || bounds.height <= 0) return s
      const safeWidth = safeSize(containerWidth, DEFAULT_WIDTH)
      const safeHeight = safeSize(containerHeight, DEFAULT_HEIGHT)
      const safePadding = Math.max(0, padding)
      const availableWidth = Math.max(1, safeWidth - safePadding * 2)
      const availableHeight = Math.max(1, safeHeight - safePadding * 2)
      const rawZoom = Math.min(availableWidth / bounds.width, availableHeight / bounds.height)
      const maxZoom = options?.maxZoom ?? MAX_ZOOM
      const minZoom = options?.minZoom ?? MIN_ZOOM
      const zoom = Math.max(minZoom, Math.min(maxZoom, clampZoom(rawZoom)))
      const newWidth = safeWidth / zoom
      const newHeight = safeHeight / zoom
      const cx = bounds.x + bounds.width / 2
      const cy = bounds.y + bounds.height / 2
      return {
        vbox: {
          x: cx - newWidth / 2,
          y: cy - newHeight / 2,
          width: newWidth,
          height: newHeight
        }
      }
    }),

  resetView: () =>
    set((s) => ({
      vbox: {
        x: -safeSize(s.containerWidth, DEFAULT_WIDTH) / 2,
        y: -safeSize(s.containerHeight, DEFAULT_HEIGHT) / 2,
        width: safeSize(s.containerWidth, DEFAULT_WIDTH),
        height: safeSize(s.containerHeight, DEFAULT_HEIGHT)
      }
    })),

  setActiveTool: (tool) => set({ activeTool: tool }),
  setScreenDevicePreset: (preset) => set({ screenDevicePreset: preset }),

  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),

  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

  getZoom: () => {
    const s = get()
    return safeSize(s.containerWidth, DEFAULT_WIDTH) / safeSize(s.vbox.width, DEFAULT_WIDTH)
  }
}))
