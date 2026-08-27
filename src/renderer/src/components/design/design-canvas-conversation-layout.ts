import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

export const CANVAS_CONVERSATION_LAYOUT_VERSION = 1 as const
const CANVAS_CONVERSATION_LAYOUT_STORAGE_KEY = 'kun:design-canvas-conversation-layout:v1'
const MAX_STORED_TARGETS = 24

export const CANVAS_CONVERSATION_PANEL_WIDTH = 420
export const CANVAS_CONVERSATION_PANEL_MIN_WIDTH = 320
export const CANVAS_CONVERSATION_PANEL_MAX_WIDTH = 720
export const CANVAS_CONVERSATION_PANEL_MIN_HEIGHT = 320
export const CANVAS_CONVERSATION_PANEL_MAX_HEIGHT = 680
export const CANVAS_CONVERSATION_EDGE_MARGIN = 24
export const CANVAS_CONVERSATION_TOP_MARGIN = 72
/** macOS traffic-light window controls occupy ~112px on the left when the
 * left sidebar is collapsed; keep the floating panel clear of them. */
export const CANVAS_CONVERSATION_SAFE_INSET = 112
export const CANVAS_CONVERSATION_RIGHT_TOOLBAR_WIDTH = 56
export const CANVAS_CONVERSATION_TOOLBAR_GAP = 16
export const CANVAS_CONVERSATION_MOBILE_BREAKPOINT = 768

export type CanvasConversationLayout = {
  open: boolean
  minimized: boolean
  x: number
  y: number
  width: number
  height: number
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
  mode: CanvasConversationResponsiveMode = 'desktop',
  topInset = 0
): CanvasConversationLayout {
  if (mode === 'sheet') {
    const size = canvasConversationPanelSize(bounds, mode)
    return {
      open: false,
      minimized: false,
      x: 0,
      y: Math.max(0, bounds.height - 96),
      width: size.width,
      height: size.height
    }
  }
  const size = canvasConversationPanelSize(bounds, mode, undefined, topInset)
  return {
    open: false,
    minimized: false,
    x: CANVAS_CONVERSATION_EDGE_MARGIN + CANVAS_CONVERSATION_SAFE_INSET,
    y: CANVAS_CONVERSATION_TOP_MARGIN + topInset,
    width: size.width,
    height: size.height
  }
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
  mode: CanvasConversationResponsiveMode,
  requested?: Pick<CanvasConversationLayout, 'width' | 'height'>,
  topInset = 0
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
      : Math.min(
          CANVAS_CONVERSATION_PANEL_MAX_WIDTH,
          bounds.width -
            CANVAS_CONVERSATION_EDGE_MARGIN * 2 -
            CANVAS_CONVERSATION_RIGHT_TOOLBAR_WIDTH -
            CANVAS_CONVERSATION_TOOLBAR_GAP
        )
  )
  const width = clampNumber(
    requested?.width ?? CANVAS_CONVERSATION_PANEL_WIDTH,
    Math.min(CANVAS_CONVERSATION_PANEL_MIN_WIDTH, maxWidth),
    maxWidth
  )
  const maxHeight = Math.min(
    CANVAS_CONVERSATION_PANEL_MAX_HEIGHT,
    Math.max(0, bounds.height - CANVAS_CONVERSATION_TOP_MARGIN - topInset - CANVAS_CONVERSATION_EDGE_MARGIN)
  )
  const minHeight = Math.min(CANVAS_CONVERSATION_PANEL_MIN_HEIGHT, maxHeight)
  const height = clampNumber(
    requested?.height ?? CANVAS_CONVERSATION_PANEL_MAX_HEIGHT,
    minHeight,
    maxHeight
  )
  return { width, height }
}

export function clampCanvasConversationLayout(
  layout: CanvasConversationLayout,
  bounds: CanvasConversationLayoutBounds,
  mode: CanvasConversationResponsiveMode = 'desktop',
  topInset = 0
): CanvasConversationLayout {
  if (mode === 'sheet') {
    const size = canvasConversationPanelSize(bounds, mode, layout)
    return { ...layout, x: 0, y: 0, ...size }
  }
  const size = canvasConversationPanelSize(bounds, mode, layout, topInset)
  const maxX = Math.max(
    CANVAS_CONVERSATION_EDGE_MARGIN,
    bounds.width - size.width - CANVAS_CONVERSATION_EDGE_MARGIN
  )
  const minY = CANVAS_CONVERSATION_TOP_MARGIN + topInset
  const maxY = Math.max(
    minY,
    bounds.height - size.height - CANVAS_CONVERSATION_EDGE_MARGIN
  )
  return {
    ...layout,
    ...size,
    x: clampNumber(layout.x, CANVAS_CONVERSATION_EDGE_MARGIN, maxX),
    y: clampNumber(layout.y, minY, maxY)
  }
}

export function normalizeCanvasConversationLayout(value: unknown): CanvasConversationLayout | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<CanvasConversationLayout>
  if (typeof source.x !== 'number' || typeof source.y !== 'number') return null
  if (!Number.isFinite(source.x) || !Number.isFinite(source.y)) return null
  const width = typeof source.width === 'number'
    ? source.width
    : CANVAS_CONVERSATION_PANEL_WIDTH
  const height = typeof source.height === 'number'
    ? source.height
    : CANVAS_CONVERSATION_PANEL_MAX_HEIGHT
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  return {
    open: source.open === true,
    minimized: source.minimized === true,
    x: Math.round(source.x),
    y: Math.round(source.y),
    width: Math.round(width),
    height: Math.round(height)
  }
}

export function readCanvasConversationLayout(
  key: string,
  bounds: CanvasConversationLayoutBounds,
  mode: CanvasConversationResponsiveMode = 'desktop',
  topInset = 0
): CanvasConversationLayout {
  if (!key) return defaultCanvasConversationLayout(bounds, mode, topInset)
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
        mode,
        topInset
      )
    }
  }
  const normalized = normalizeCanvasConversationLayout(target)
  if (!normalized) return defaultCanvasConversationLayout(bounds, mode, topInset)
  return clampCanvasConversationLayout(normalized, bounds, mode, topInset)
}

/**
 * The focused whiteboard titlebar drops below the macOS window controls via
 * `--ds-window-controls-safe-block`; the floating conversation must clear the
 * same band so its launcher and panel never slide under that chrome.
 */
export function readCanvasConversationTopInset(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 0
  const raw = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--ds-window-controls-safe-block')
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? Math.max(0, value) : 0
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
      y: Math.round(layout.y),
      width: Math.round(layout.width),
      height: Math.round(layout.height)
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
