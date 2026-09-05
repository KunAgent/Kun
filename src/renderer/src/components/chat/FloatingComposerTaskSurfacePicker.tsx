import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Code2, Palette, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type ComposerTaskSurface = 'code' | 'design'

type Props = {
  surface: ComposerTaskSurface
  disabled?: boolean
  onSurfaceChange: (surface: ComposerTaskSurface) => void
}

type PlacementInput = {
  anchorRect: Pick<DOMRect, 'bottom' | 'left' | 'top' | 'width'>
  menuWidth: number
  menuHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}

export type TaskSurfaceMenuPlacement = {
  left: number
  top: number
  width: number
  placement: 'top' | 'bottom'
}

const MENU_MARGIN = 12
const MENU_GAP = 8
const MENU_WIDTH = 164
const MENU_ESTIMATED_HEIGHT = 104

export function calculateTaskSurfaceMenuPlacement({
  anchorRect,
  menuWidth,
  menuHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: PlacementInput): TaskSurfaceMenuPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const anchor = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    top: anchorRect.top / scale,
    width: anchorRect.width / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const above = anchor.top - menuHeight - MENU_GAP
  const placement = above >= MENU_MARGIN ? 'top' : 'bottom'
  const top = placement === 'top' ? above : anchor.bottom + MENU_GAP
  const left = clamp(
    anchor.left,
    MENU_MARGIN,
    Math.max(MENU_MARGIN, normalizedViewportWidth - menuWidth - MENU_MARGIN)
  )
  return {
    left,
    top: clamp(
      top,
      MENU_MARGIN,
      Math.max(MENU_MARGIN, normalizedViewportHeight - menuHeight - MENU_MARGIN)
    ),
    width: menuWidth,
    placement
  }
}

function currentBodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const parsed = Number.parseFloat(window.getComputedStyle(document.body).zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function FloatingComposerTaskSurfacePicker({
  surface,
  disabled = false,
  onSurfaceChange
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<TaskSurfaceMenuPlacement>({
    left: 0,
    top: 0,
    width: MENU_WIDTH,
    placement: 'top'
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pendingFocusRef = useRef<number | null>(null)
  const menuId = useId()
  const options: Array<{
    id: ComposerTaskSurface
    label: string
    Icon: LucideIcon
  }> = [
    { id: 'code', label: t('taskTypeCode', { defaultValue: 'Code' }), Icon: Code2 },
    { id: 'design', label: t('taskTypeDesign', { defaultValue: 'Design' }), Icon: Palette }
  ]
  const selectedOption = options.find((option) => option.id === surface) ?? options[0]
  const SelectedIcon = selectedOption.Icon

  const updatePosition = useCallback((): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuStyle(calculateTaskSurfaceMenuPlacement({
      anchorRect: rect,
      menuWidth: MENU_WIDTH,
      menuHeight: menuRef.current?.offsetHeight ?? MENU_ESTIMATED_HEIGHT,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      coordinateScale: currentBodyZoom()
    }))
  }, [])

  useEffect(() => {
    if (!disabled) return
    pendingFocusRef.current = null
    setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) return
    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    const closeOnPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && (
        rootRef.current?.contains(target) || menuRef.current?.contains(target)
      )) return
      setOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open || pendingFocusRef.current === null) return
    optionRefs.current[pendingFocusRef.current]?.focus()
    pendingFocusRef.current = null
  }, [open])

  const openAndFocus = (index: number): void => {
    updatePosition()
    if (open) optionRefs.current[index]?.focus()
    else {
      pendingFocusRef.current = index
      setOpen(true)
    }
  }

  const select = (next: ComposerTaskSurface): void => {
    if (disabled) return
    setOpen(false)
    if (next !== surface) onSurfaceChange(next)
    triggerRef.current?.focus()
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    openAndFocus(event.key === 'ArrowDown' ? 0 : options.length - 1)
  }

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
    optionRefs.current[nextIndex]?.focus()
  }

  const menu = open && !disabled && typeof document !== 'undefined' ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={`${options[0].label} / ${options[1].label}`}
      style={{ left: menuStyle.left, top: menuStyle.top, width: menuStyle.width }}
      data-task-surface-menu
      data-placement={menuStyle.placement}
      className="ds-composer-task-surface-menu ds-no-drag fixed z-50 rounded-xl border border-ds-border-muted bg-white p-1.5 text-[13px] text-ds-ink shadow-[0_18px_52px_rgba(15,23,42,0.18)] dark:bg-ds-card"
    >
      {options.map(({ id, label, Icon }, index) => {
        const selected = id === surface
        return (
          <button
            key={id}
            ref={(node) => { optionRefs.current[index] = node }}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            tabIndex={-1}
            data-task-surface={id}
            data-task-surface-option={id}
            onClick={() => select(id)}
            onKeyDown={(event) => handleOptionKeyDown(event, index)}
            className={`flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/30 ${
              selected ? 'bg-accent/10 text-ds-ink' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
            {selected ? <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} aria-hidden /> : null}
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <>
      <div ref={rootRef} className="ds-composer-task-surface-control ds-no-drag shrink-0">
        <button
          ref={triggerRef}
          type="button"
          data-task-surface-trigger
          data-task-surface={surface}
          disabled={disabled}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-expanded={open}
          onClick={() => {
            if (open) setOpen(false)
            else openAndFocus(options.findIndex((option) => option.id === surface))
          }}
          onKeyDown={handleTriggerKeyDown}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ds-border-muted bg-ds-card px-2.5 text-[13px] font-medium text-ds-ink transition-colors hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-55"
          title={selectedOption.label}
        >
          <SelectedIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
          <span className="ds-composer-task-surface-label">{selectedOption.label}</span>
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-ds-faint transition-transform ${open ? 'rotate-180' : ''}`}
            strokeWidth={1.8}
            aria-hidden
          />
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
