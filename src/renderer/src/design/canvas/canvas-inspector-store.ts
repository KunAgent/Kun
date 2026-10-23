import { create } from 'zustand'
import { useCanvasMotionStore } from '../motion/canvas-motion-store'

/** Tabs of the bottom inspector drawer, in display order. */
export const CANVAS_INSPECTOR_TABS = ['properties', 'outline', 'code', 'tweaks'] as const
export type CanvasInspectorTab = (typeof CANVAS_INSPECTOR_TABS)[number]

export const CANVAS_INSPECTOR_DEFAULT_HEIGHT = 300
export const CANVAS_INSPECTOR_MIN_HEIGHT = 168
/** The drawer never takes more than this share of the canvas host. */
export const CANVAS_INSPECTOR_MAX_RATIO = 0.72

const STORAGE_KEY = 'kun.canvas.inspector.v1'

export type CanvasBoardFocusFit = 'fit' | 'fill'

type PersistedInspectorState = {
  open: boolean
  tab: CanvasInspectorTab
  height: number
  minimapVisible: boolean
  focusFit: CanvasBoardFocusFit
}

type CanvasInspectorState = PersistedInspectorState & {
  /** Board (canvas shape id) shown in the focus view, or null for the canvas. */
  focusedShapeId: string | null
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  /** Opens the drawer on a tab; used by board shortcuts and toolbar menu items. */
  openTab: (tab: CanvasInspectorTab) => void
  setTab: (tab: CanvasInspectorTab) => void
  setHeight: (height: number) => void
  setMinimapVisible: (visible: boolean) => void
  setFocusFit: (fit: CanvasBoardFocusFit) => void
  focusBoard: (shapeId: string | null) => void
}

export function isCanvasInspectorTab(value: unknown): value is CanvasInspectorTab {
  return typeof value === 'string' && (CANVAS_INSPECTOR_TABS as readonly string[]).includes(value)
}

/** Keeps the drawer between its minimum and the share of the host it may cover. */
export function clampCanvasInspectorHeight(height: number, hostHeight: number): number {
  const max = Number.isFinite(hostHeight) && hostHeight > 0
    ? Math.max(CANVAS_INSPECTOR_MIN_HEIGHT, Math.floor(hostHeight * CANVAS_INSPECTOR_MAX_RATIO))
    : Number.POSITIVE_INFINITY
  const value = Number.isFinite(height) ? height : CANVAS_INSPECTOR_DEFAULT_HEIGHT
  return Math.round(Math.max(CANVAS_INSPECTOR_MIN_HEIGHT, Math.min(max, value)))
}

/** Tabs a surface offers: design-generation tweaks only exist on the Design canvas. */
export function canvasInspectorTabsForSurface(designSurface: boolean): readonly CanvasInspectorTab[] {
  return designSurface ? CANVAS_INSPECTOR_TABS : CANVAS_INSPECTOR_TABS.filter((tab) => tab !== 'tweaks')
}

export function parsePersistedCanvasInspectorState(raw: string | null): PersistedInspectorState {
  const fallback: PersistedInspectorState = {
    open: false,
    tab: 'properties',
    height: CANVAS_INSPECTOR_DEFAULT_HEIGHT,
    minimapVisible: false,
    focusFit: 'fit'
  }
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof PersistedInspectorState, unknown>>
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : fallback.open,
      tab: isCanvasInspectorTab(parsed.tab) ? parsed.tab : fallback.tab,
      height: typeof parsed.height === 'number' && Number.isFinite(parsed.height)
        ? Math.max(CANVAS_INSPECTOR_MIN_HEIGHT, Math.round(parsed.height))
        : fallback.height,
      minimapVisible: typeof parsed.minimapVisible === 'boolean' ? parsed.minimapVisible : fallback.minimapVisible,
      focusFit: parsed.focusFit === 'fill' ? 'fill' : 'fit'
    }
  } catch {
    return fallback
  }
}

function readPersisted(): PersistedInspectorState {
  try {
    return parsePersistedCanvasInspectorState(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return parsePersistedCanvasInspectorState(null)
  }
}

function writePersisted(state: PersistedInspectorState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable (private profile, tests); the drawer still works for the session.
  }
}

function persistedSlice(state: CanvasInspectorState): PersistedInspectorState {
  return {
    open: state.open,
    tab: state.tab,
    height: state.height,
    minimapVisible: state.minimapVisible,
    focusFit: state.focusFit
  }
}

export const useCanvasInspectorStore = create<CanvasInspectorState>((set, get) => {
  const update = (patch: Partial<CanvasInspectorState>): void => {
    set(patch)
    writePersisted(persistedSlice(get()))
  }
  return {
    ...readPersisted(),
    focusedShapeId: null,
    setOpen: (open) => update({ open }),
    toggleOpen: () => update({ open: !get().open }),
    openTab: (tab) => update({ open: true, tab }),
    setTab: (tab) => update({ tab }),
    setHeight: (height) => update({ height: Math.max(CANVAS_INSPECTOR_MIN_HEIGHT, Math.round(height)) }),
    setMinimapVisible: (minimapVisible) => update({ minimapVisible }),
    setFocusFit: (focusFit) => update({ focusFit }),
    focusBoard: (focusedShapeId) => set({ focusedShapeId })
  }
})

function closeMotionDock(): void {
  const motion = useCanvasMotionStore.getState()
  if (motion.open) motion.setOpen(false)
}

/** Opens the drawer on a tab; the motion dock shares the bottom edge, so it closes. */
export function openCanvasInspectorTab(tab: CanvasInspectorTab): void {
  closeMotionDock()
  useCanvasInspectorStore.getState().openTab(tab)
}

export function toggleCanvasInspector(): void {
  const inspector = useCanvasInspectorStore.getState()
  if (!inspector.open) closeMotionDock()
  inspector.toggleOpen()
}
