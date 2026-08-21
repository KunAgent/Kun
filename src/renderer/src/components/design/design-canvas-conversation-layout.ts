import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

export const CANVAS_CONVERSATION_LAYOUT_VERSION = 1 as const
const CANVAS_CONVERSATION_LAYOUT_STORAGE_KEY = 'kun:design-canvas-conversation-layout:v1'
const MAX_STORED_TARGETS = 24

export const CANVAS_CONVERSATION_PANEL_WIDTH = 420
export const CANVAS_CONVERSATION_PANEL_MIN_WIDTH = 320
export const CANVAS_CONVERSATION_PANEL_MAX_HEIGHT = 680
export const CANVAS_CONVERSATION_EDGE_MARGIN = 24
export const CANVAS_CONVERSATION_RIGHT_TOOLBAR_WIDTH = 56
export const CANVAS_CONVERSATION_TOOLBAR_GAP = 16
export const CANVAS_CONVERSATION_MOBILE_BREAKPOINT = 768

export type CanvasConversationLayout = {
  open: boolean
  minimized: boolean
  x: number
  y: number
}

export type CanvasConversationLayoutBounds = {
  width: number
  height: number
}

export type CanvasConversationResponsiveMode = 'desktop' | 'compact' | 'sheet'

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

export function canvasConversationLayoutKey(workspaceRoot: string, documentId: string): string {
  const workspace = workspaceRoot.trim().replaceAll('\\', '/')
  const document = documentId.trim()
  if (!workspace || !document) return ''
  return `${workspace}::${document}`
}

export function defaultCanvasConversationLayout(
  bounds: CanvasConversationLayoutBounds,
  mode: CanvasConversationResponsiveMode = 'desktop'
): CanvasConversationLayout {
  if (mode === 'sheet') {
    return { open: false, minimized: false, x: 0, y: Math.max(0, bounds.height - 96) }
  }
  const panelWidth = clampNumber(
    CANVAS_CONVERSATION_PANEL_WIDTH,
    CANVAS_CONVERSATION_PANEL_MIN_WIDTH,
    Math.max(CANVAS_CONVERSATION_PANEL_MIN_WIDTH, bounds.width - CANVAS_CONVERSATION_EDGE_MARGIN * 2)
  )
  const rightOffset =
    CANVAS_CONVERSATION_EDGE_MARGIN +
    CANVAS_CONVERSATION_RIGHT_TOOLBAR_WIDTH +
    CANVAS_CONVERSATION_TOOLBAR_GAP
  const x = Math.max(
    CANVAS_CONVERSATION_EDGE_MARGIN,
    bounds.width - panelWidth - rightOffset
  )
  return { open: false, minimized: false, x, y: CANVAS_CONVERSATION_EDGE_MARGIN + 8 }
}

export function canvasConversationResponsiveMode(
  viewportWidth: number
): CanvasConversationResponsiveMode {
  if (viewportWidth < CANVAS_CONVERSATION_MOBILE_BREAKPOINT) return 'sheet'
  if (viewportWidth < 1100) return 'compact'
  return 'desktop'
}

export function canvasConversationPanelSize(
  bounds: CanvasConversationLayoutBounds,
  mode: CanvasConversationResponsiveMode
): { width: number; height: number } {
  if (mode === 'sheet') {
    return {
      width: Math.max(0, bounds.width - CANVAS_CONVERSATION_EDGE_MARGIN * 2),
      height: Math.min(
        Math.round(bounds.height * 0.72),
        CANVAS_CONVERSATION_PANEL_MAX_HEIGHT
      )
    }
  }
  const maxWidth = Math.max(
    CANVAS_CONVERSATION_PANEL_MIN_WIDTH,
    mode === 'compact'
      ? Math.min(400, bounds.width - CANVAS_CONVERSATION_EDGE_MARGIN * 2)
      : bounds.width -
        CANVAS_CONVERSATION_EDGE_MARGIN * 2 -
        CANVAS_CONVERSATION_RIGHT_TOOLBAR_WIDTH -
        CANVAS_CONVERSATION_TOOLBAR_GAP
  )
  const width = clampNumber(
    CANVAS_CONVERSATION_PANEL_WIDTH,
    CANVAS_CONVERSATION_PANEL_MIN_WIDTH,
    maxWidth
  )
  const height = Math.min(
    CANVAS_CONVERSATION_PANEL_MAX_HEIGHT,
    Math.max(0, bounds.height - CANVAS_CONVERSATION_EDGE_MARGIN * 2)
  )
  return { width, height }
}

export function clampCanvasConversationLayout(
  layout: CanvasConversationLayout,
  bounds: CanvasConversationLayoutBounds,
  mode: CanvasConversationResponsiveMode = 'desktop'
): CanvasConversationLayout {
  if (mode === 'sheet') {
    return { ...layout, x: 0, y: 0 }
  }
  const { width: panelWidth, height: panelHeight } = canvasConversationPanelSize(bounds, mode)
  const maxX = Math.max(
    CANVAS_CONVERSATION_EDGE_MARGIN,
    bounds.width - panelWidth - CANVAS_CONVERSATION_EDGE_MARGIN
  )
  const maxY = Math.max(
    CANVAS_CONVERSATION_EDGE_MARGIN,
    bounds.height - panelHeight - CANVAS_CONVERSATION_EDGE_MARGIN
  )
  return {
    ...layout,
    x: clampNumber(layout.x, CANVAS_CONVERSATION_EDGE_MARGIN, maxX),
    y: clampNumber(layout.y, CANVAS_CONVERSATION_EDGE_MARGIN, maxY)
  }
}

export function normalizeCanvasConversationLayout(value: unknown): CanvasConversationLayout | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<CanvasConversationLayout>
  if (typeof source.x !== 'number' || typeof source.y !== 'number') return null
  if (!Number.isFinite(source.x) || !Number.isFinite(source.y)) return null
  return {
    open: source.open === true,
    minimized: source.minimized === true,
    x: Math.round(source.x),
    y: Math.round(source.y)
  }
}

export function readCanvasConversationLayout(
  key: string,
  bounds: CanvasConversationLayoutBounds,
  mode: CanvasConversationResponsiveMode = 'desktop'
): CanvasConversationLayout {
  if (!key) return defaultCanvasConversationLayout(bounds, mode)
  let stored: Record<string, unknown> = {}
  try {
    const raw = readBrowserStorageItem(CANVAS_CONVERSATION_LAYOUT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && (parsed as { targets?: unknown }).targets) {
        stored = (parsed as { targets: Record<string, unknown> }).targets
      }
    }
  } catch {
    stored = {}
  }
  const target = stored[key]
  if (Array.isArray(target) && target.length === 2) {
    const legacy = normalizeCanvasConversationLayout({ x: target[0], y: target[1], open: true })
    if (legacy) {
      return clampCanvasConversationLayout(
        { ...legacy, open: true, minimized: false },
        bounds,
        mode
      )
    }
  }
  const normalized = normalizeCanvasConversationLayout(target)
  if (!normalized) return defaultCanvasConversationLayout(bounds, mode)
  return clampCanvasConversationLayout(normalized, bounds, mode)
}

export function writeCanvasConversationLayout(key: string, layout: CanvasConversationLayout): void {
  if (!key) return
  let stored: Record<string, unknown> = {}
  try {
    const raw = readBrowserStorageItem(CANVAS_CONVERSATION_LAYOUT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && (parsed as { targets?: unknown }).targets) {
        stored = (parsed as { targets: Record<string, unknown> }).targets
      }
    }
  } catch {
    stored = {}
  }
  const next: Record<string, unknown> = {
    ...stored,
    [key]: {
      open: layout.open,
      minimized: layout.minimized,
      x: Math.round(layout.x),
      y: Math.round(layout.y)
    }
  }
  const keys = Object.keys(next)
  if (keys.length > MAX_STORED_TARGETS) {
    for (const stale of keys.slice(0, keys.length - MAX_STORED_TARGETS)) delete next[stale]
  }
  try {
    writeBrowserStorageItem(
      CANVAS_CONVERSATION_LAYOUT_STORAGE_KEY,
      JSON.stringify({ version: CANVAS_CONVERSATION_LAYOUT_VERSION, targets: next })
    )
  } catch {
    /* ignore persistence failures */
  }
}
