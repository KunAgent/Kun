import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import {
  captureResizePointer,
  fitWorkbenchWidths,
  PANEL_RESIZE_HANDLE_WIDTH,
  RAIL_WIDTH,
  WORKBENCH_RESIZE_CLASS,
  workbenchWidthConstraintsForRightPanel
} from '../workbench-layout-storage'
import { useRoomPresentationPreferences } from './room-presentation-preferences'

const constraints = workbenchWidthConstraintsForRightPanel('chat', BUILTIN_RIGHT_PANEL_IDS.files)

/** The outer Code navigation is already outside the Rooms stage. */
export function fitRoomWorkbenchWidth(availableWidth: number, preferredWidth: number): number {
  const fitted = fitWorkbenchWidths(availableWidth, 0, preferredWidth,
    { leftPanelVisible: false, rightPanelVisible: true }, constraints).right
  return Math.max(0, Math.min(fitted, availableWidth - RAIL_WIDTH - PANEL_RESIZE_HANDLE_WIDTH))
}

export function useRoomWorkbenchLayout(visible: boolean, scope: string | null) {
  const { workbenchWidth, setPreference } = useRoomPresentationPreferences()
  const panelRef = useRef<HTMLDivElement>(null)
  const stopResize = useRef<() => void>(() => {})
  const [availableWidth, setAvailableWidth] = useState(() =>
    typeof window === 'undefined' ? 1200 : window.innerWidth)
  const measure = useCallback(() => {
    const workspace = panelRef.current?.closest<HTMLElement>('[data-rooms-workspace]')
    if (!workspace) return
    const list = workspace.querySelector<HTMLElement>(':scope > .rooms-sidebar')
    setAvailableWidth(Math.max(0, workspace.clientWidth - (list?.getBoundingClientRect().width ?? 0)))
  }, [])
  useLayoutEffect(() => {
    measure()
    const workspace = panelRef.current?.closest<HTMLElement>('[data-rooms-workspace]')
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (workspace) observer?.observe(workspace)
    const list = workspace?.querySelector<HTMLElement>(':scope > .rooms-sidebar')
    if (list) observer?.observe(list)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [measure, visible, scope])
  useEffect(() => {
    if (!visible) stopResize.current()
    return () => stopResize.current()
  }, [scope, visible])
  const width = fitRoomWorkbenchWidth(availableWidth, workbenchWidth)
  const min = fitRoomWorkbenchWidth(availableWidth, 0)
  const max = fitRoomWorkbenchWidth(availableWidth, Number.POSITIVE_INFINITY)
  const resize = (next: number) => setPreference({ workbenchWidth: fitRoomWorkbenchWidth(availableWidth, next) })
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !visible) return
    event.preventDefault()
    stopResize.current()
    const initialX = event.clientX
    const initialWidth = width
    const release = captureResizePointer(event.currentTarget, event.pointerId)
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.classList.add(WORKBENCH_RESIZE_CLASS)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const move = (next: PointerEvent) => resize(initialWidth - (next.clientX - initialX))
    const end = () => {
      release()
      document.body.classList.remove(WORKBENCH_RESIZE_CLASS)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      stopResize.current = () => {}
    }
    stopResize.current = end
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }
  return { panelRef, width, min, max, beginResize, resize }
}
