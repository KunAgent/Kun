import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject
} from 'react'
import { calculateComposerPopoverPlacement } from './floating-composer-popover-placement'
import { bodyZoom } from '../../lib/body-zoom'

type UseComposerPickerPopoverOptions = {
  open: boolean
  onClose: () => void
  preferredWidth: number
  estimatedHeight: number
  maximumHeight?: number
}

type ComposerPickerPopover = {
  triggerRef: RefObject<HTMLButtonElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  menuStyle: CSSProperties
}

/**
 * Positions a composer picker menu portaled to document.body so it cannot be
 * clipped by `overflow: hidden` ancestors (12 §7 pickers sit inside
 * `.ds-composer-toolbar-actions`, which hides overflow for narrow layouts).
 * Handles outside-pointer-down close, Escape close with focus return, and
 * resize/scroll repositioning.
 */
export function useComposerPickerPopover({
  open,
  onClose,
  preferredWidth,
  estimatedHeight,
  maximumHeight = 420
}: UseComposerPickerPopoverOptions): ComposerPickerPopover {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const updatePosition = useCallback((): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const placement = calculateComposerPopoverPlacement({
      anchorRect: rect,
      popoverHeight: menuRef.current?.offsetHeight ?? estimatedHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      preferredWidth,
      maximumHeight,
      coordinateScale: bodyZoom()
    })
    setMenuStyle({
      left: placement.left,
      top: placement.top,
      width: placement.width,
      maxHeight: placement.maxHeight
    })
  }, [estimatedHeight, maximumHeight, preferredWidth])

  useEffect(() => {
    if (!open) return
    updatePosition()
    // jsdom/node test stubs may not provide rAF — position once and move on.
    const frame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(updatePosition)
      : null
    const closeOnPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) {
        onClose()
        return
      }
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      onClose()
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
      triggerRef.current?.focus()
    }
    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      if (frame !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frame)
      }
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, onClose, updatePosition])

  return { triggerRef, menuRef, menuStyle }
}
