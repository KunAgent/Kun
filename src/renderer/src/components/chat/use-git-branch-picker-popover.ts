import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject
} from 'react'
import {
  calculateComposerPopoverPlacement,
  type ComposerPopoverPlacement
} from './floating-composer-popover-placement'
import { bodyZoom } from '../../lib/body-zoom'

const POPOVER_WIDTH = 560
const POPOVER_MAX_HEIGHT = 640
const POPOVER_ESTIMATED_HEIGHT = 580

export function useGitBranchPickerPopover({
  open,
  anchorRef,
  onClose
}: {
  open: boolean
  anchorRef: RefObject<HTMLDivElement | null>
  onClose: () => void
}): {
  panelRef: RefObject<HTMLDivElement | null>
  panelStyle: CSSProperties
  updatePanelPosition: () => void
} {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<ComposerPopoverPlacement | null>(null)

  const updatePanelPosition = useCallback((): void => {
    const anchor = anchorRef.current
    if (!anchor) return
    setPlacement(calculateComposerPopoverPlacement({
      anchorRect: anchor.getBoundingClientRect(),
      popoverHeight: Math.max(
        panelRef.current?.scrollHeight ?? 0,
        POPOVER_ESTIMATED_HEIGHT
      ),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      preferredWidth: POPOVER_WIDTH,
      maximumHeight: POPOVER_MAX_HEIGHT,
      coordinateScale: bodyZoom()
    }))
  }, [anchorRef])

  useEffect(() => {
    if (!open) return
    updatePanelPosition()
    const frame = window.requestAnimationFrame(updatePanelPosition)
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updatePanelPosition)
      window.removeEventListener('scroll', updatePanelPosition, true)
    }
  }, [anchorRef, onClose, open, updatePanelPosition])

  const panelStyle: CSSProperties = placement
    ? {
        left: `${placement.left}px`,
        top: `${placement.top}px`,
        width: `${placement.width}px`,
        maxHeight: `${placement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${POPOVER_WIDTH}px`,
        maxHeight: `${POPOVER_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }

  return { panelRef, panelStyle, updatePanelPosition }
}
