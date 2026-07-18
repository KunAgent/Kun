import { create } from 'zustand'
import type { CanvasMotionProjection } from './canvas-motion-types'

export type CanvasMotionDirection = 1 | -1

type CanvasMotionState = {
  /** Whether the Design Motion authoring surface is open. */
  open: boolean
  /** Frame owning the active timeline, or null until the canvas resolves one. */
  activeFrameId: string | null
  currentTimeMs: number
  playing: boolean
  direction: CanvasMotionDirection
  rate: number
  autoKey: boolean
  timelineZoom: number
  selectedTrackId: string | null
  selectedKeyframeId: string | null
  gestureStartValues: Readonly<Record<string, CanvasMotionProjection>>
  gestureOverrides: Readonly<Record<string, CanvasMotionProjection>>

  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setActiveFrameId: (frameId: string | null) => void
  setCurrentTimeMs: (timeMs: number) => void
  setPlaying: (playing: boolean) => void
  togglePlaying: () => void
  setDirection: (direction: CanvasMotionDirection) => void
  setRate: (rate: number) => void
  setAutoKey: (autoKey: boolean) => void
  setTimelineZoom: (zoom: number) => void
  selectKeyframe: (trackId: string | null, keyframeId?: string | null) => void
  beginGesturePreview: (values: Record<string, CanvasMotionProjection>) => void
  applyGesturePreviewPatch: (
    id: string,
    patch: CanvasMotionProjection,
    base: CanvasMotionProjection
  ) => void
  clearGesturePreview: () => void
  reset: () => void
}

const INITIAL_STATE = {
  open: false,
  activeFrameId: null,
  currentTimeMs: 0,
  playing: false,
  direction: 1 as CanvasMotionDirection,
  rate: 1,
  autoKey: false,
  timelineZoom: 1,
  selectedTrackId: null,
  selectedKeyframeId: null,
  gestureStartValues: {},
  gestureOverrides: {}
}

function finiteAtLeast(value: number, minimum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback
}

/**
 * Editor and transport state only. Canonical authored motion remains in
 * `useCanvasShapeStore.document.motion`; this store is intentionally never
 * connected to canvas persistence.
 */
export const useCanvasMotionStore = create<CanvasMotionState>((set) => ({
  ...INITIAL_STATE,

  setOpen: (open) =>
    set((state) =>
      open
        ? { open }
        : {
            open,
            currentTimeMs: 0,
            playing: false,
            direction: 1,
            selectedTrackId: state.selectedTrackId,
            selectedKeyframeId: state.selectedKeyframeId,
            gestureStartValues: {},
            gestureOverrides: {}
          }
    ),

  toggleOpen: () =>
    set((state) =>
      state.open
        ? {
            open: false,
            currentTimeMs: 0,
            playing: false,
            direction: 1,
            gestureStartValues: {},
            gestureOverrides: {}
          }
        : { open: true }
    ),

  setActiveFrameId: (activeFrameId) =>
    set((state) =>
      state.activeFrameId === activeFrameId
        ? state
        : {
            activeFrameId,
            currentTimeMs: 0,
            playing: false,
            direction: 1,
            selectedTrackId: null,
            selectedKeyframeId: null,
            gestureStartValues: {},
            gestureOverrides: {}
          }
    ),

  setCurrentTimeMs: (currentTimeMs) => set({ currentTimeMs: finiteAtLeast(currentTimeMs, 0, 0) }),

  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((state) => ({ playing: !state.playing })),
  setDirection: (direction) => set({ direction: direction === -1 ? -1 : 1 }),
  setRate: (rate) => set({ rate: Math.min(4, finiteAtLeast(rate, 0.1, 1)) }),
  setAutoKey: (autoKey) => set({ autoKey }),
  setTimelineZoom: (timelineZoom) =>
    set({ timelineZoom: Math.min(8, finiteAtLeast(timelineZoom, 0.25, 1)) }),
  selectKeyframe: (selectedTrackId, selectedKeyframeId = null) =>
    set({ selectedTrackId, selectedKeyframeId }),
  beginGesturePreview: (values) => set({ gestureStartValues: values, gestureOverrides: values }),
  applyGesturePreviewPatch: (id, patch, base) => set((state) => {
    const start = state.gestureStartValues[id]
    if (!start) return state
    const next: CanvasMotionProjection = { ...state.gestureOverrides[id] }
    for (const property of ['x', 'y', 'rotation', 'opacity'] as const) {
      const requested = patch[property]
      const baseValue = base[property]
      const startValue = start[property]
      if (requested !== undefined && baseValue !== undefined && startValue !== undefined) {
        next[property] = startValue + requested - baseValue
      }
    }
    return { gestureOverrides: { ...state.gestureOverrides, [id]: next } }
  }),
  clearGesturePreview: () => set({ gestureStartValues: {}, gestureOverrides: {} }),
  reset: () => set(INITIAL_STATE)
}))
