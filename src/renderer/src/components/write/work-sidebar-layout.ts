import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../../lib/browser-storage'

/**
 * Per-space Work sidebar layout: whether 会话 is unfolded and how tall the
 * 文件 pane is. Both are conveniences, so storage failures fall back to the
 * defaults.
 */
const SESSIONS_EXPANDED_KEY = 'kun.work.sessionsExpanded.v1'
const FILES_HEIGHT_KEY = 'kun.work.filesPaneHeight.v1'

export const FILES_PANE_DEFAULT = 260
export const FILES_PANE_MIN = 140
export const FILES_PANE_MAX = 1200
const KEY_STEP = 24
/** Folded 会话 height (five 35px rows) the unfolded list never gives below. */
const SESSIONS_FOLDED_HEIGHT = 5 * 35

/**
 * Tallest the pane may get right now: its current height plus whatever the
 * unfolded session list can give back. Layout pixels.
 */
function paneMaxHeight(handle: HTMLElement, paneHeight: number): number {
  const list = handle.closest('[data-work-sidebar]')?.querySelector<HTMLElement>('[data-expanded="true"]')
  const spare = list ? Math.max(0, list.clientHeight - SESSIONS_FOLDED_HEIGHT) : 0
  return Math.max(FILES_PANE_MIN, paneHeight + spare)
}

function readMap<T>(key: string, accept: (value: unknown) => value is T): Record<string, T> {
  try {
    const parsed = JSON.parse(readBrowserStorageItem(key) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => accept(value))) as Record<string, T>
  } catch {
    return {}
  }
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function readSessionsExpanded(): Record<string, boolean> {
  return readMap(SESSIONS_EXPANDED_KEY, isBoolean)
}

/** Stores the flag for one space and returns the whole updated map. */
export function writeSessionsExpanded(spaceKey: string, expanded: boolean): Record<string, boolean> {
  const next = { ...readSessionsExpanded() }
  if (expanded) next[spaceKey] = true
  else delete next[spaceKey]
  writeBrowserStorageItem(SESSIONS_EXPANDED_KEY, JSON.stringify(next))
  return next
}

export function clampFilesHeight(value: number): number {
  return Math.round(Math.min(FILES_PANE_MAX, Math.max(FILES_PANE_MIN, value)))
}

export function readFilesHeight(spaceKey: string): number {
  const stored = readMap(FILES_HEIGHT_KEY, isNumber)[spaceKey]
  return stored === undefined ? FILES_PANE_DEFAULT : clampFilesHeight(stored)
}

export function writeFilesHeight(spaceKey: string, height: number): void {
  const next = { ...readMap(FILES_HEIGHT_KEY, isNumber) }
  if (height === FILES_PANE_DEFAULT) delete next[spaceKey]
  else next[spaceKey] = clampFilesHeight(height)
  writeBrowserStorageItem(FILES_HEIGHT_KEY, JSON.stringify(next))
}

/**
 * The 文件 pane's top-edge handle: it splits height between an unfolded
 * session list and the tree. Dragging up makes the pane taller (the list
 * scrolls in less room, never below its folded five rows); the pane still
 * grows into free space. Pointer deltas are client pixels while heights are
 * layout pixels, so the drag divides by the pane's on-screen scale (the app
 * zooms the body).
 */
export function useFilesPaneResize(spaceKey: string): {
  height: number
  handleProps: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onPointerMove: (event: PointerEvent<HTMLElement>) => void
    onPointerUp: (event: PointerEvent<HTMLElement>) => void
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void
    onDoubleClick: () => void
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  }
} {
  const [heights, setHeights] = useState<Record<string, number>>({})
  const height = heights[spaceKey] ?? readFilesHeight(spaceKey)
  const drag = useRef<{ startY: number; startHeight: number; scale: number; max: number } | null>(null)
  const set = (value: number, persist: boolean, max = FILES_PANE_MAX): void => {
    const next = clampFilesHeight(Math.min(value, max))
    setHeights((current) => ({ ...current, [spaceKey]: next }))
    if (persist) writeFilesHeight(spaceKey, next)
  }
  const finish = (event: PointerEvent<HTMLElement>): void => {
    if (!drag.current) return
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    writeFilesHeight(spaceKey, height)
  }
  return {
    height,
    handleProps: {
      onPointerDown: (event) => {
        if (event.button !== 0) return
        const pane = event.currentTarget.closest<HTMLElement>('[data-work-files-pane]')
        const rect = pane?.getBoundingClientRect()
        const layoutHeight = pane?.offsetHeight ?? 0
        const scale = rect && layoutHeight > 0 ? rect.height / layoutHeight : 1
        const startHeight = layoutHeight || height
        drag.current = {
          startY: event.clientY,
          startHeight,
          scale: scale > 0 ? scale : 1,
          max: paneMaxHeight(event.currentTarget, startHeight)
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        event.preventDefault()
      },
      onPointerMove: (event) => {
        const state = drag.current
        if (!state) return
        set(state.startHeight + (state.startY - event.clientY) / state.scale, false, state.max)
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onDoubleClick: () => set(FILES_PANE_DEFAULT, true),
      onKeyDown: (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        const paneHeight = event.currentTarget.closest<HTMLElement>('[data-work-files-pane]')?.offsetHeight ?? height
        const base = Math.min(height, paneHeight)
        set(base + (event.key === 'ArrowUp' ? KEY_STEP : -KEY_STEP), true, paneMaxHeight(event.currentTarget, paneHeight))
      }
    }
  }
}
