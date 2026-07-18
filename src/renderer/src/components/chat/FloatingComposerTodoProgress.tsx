import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ThreadTodoItem, ThreadTodoList } from '../../agent/types'

const TODO_POPOVER_WIDTH = 640
const TODO_POPOVER_MAX_HEIGHT = 360
const TODO_POPOVER_MARGIN = 12
const TODO_POPOVER_GAP = 8
const TODO_ROW_ESTIMATED_HEIGHT = 56
const TODO_POPOVER_CHROME_HEIGHT = 24

type PopoverAnchorRect = Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>

export type TodoProgressPopoverPlacement = {
  left: number
  top: number
  width: number
  maxHeight: number
}

export type TodoProgress = {
  completed: number
  current: number
  total: number
  allComplete: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function currentBodyZoom(): number {
  if (typeof window === 'undefined') return 1
  const parsed = Number.parseFloat(window.getComputedStyle(document.body).zoom)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export function getTodoProgress(items: readonly ThreadTodoItem[]): TodoProgress {
  const total = items.length
  const completed = items.filter((item) => item.status === 'completed').length
  if (total === 0) return { completed: 0, current: 0, total: 0, allComplete: false }

  const activeIndex = items.findIndex((item) => item.status === 'in_progress')
  const nextPendingIndex = items.findIndex((item) => item.status === 'pending')
  const currentIndex = activeIndex >= 0
    ? activeIndex
    : nextPendingIndex >= 0
      ? nextPendingIndex
      : total - 1

  return {
    completed,
    current: currentIndex + 1,
    total,
    allComplete: completed === total
  }
}

export function calculateTodoProgressPopoverPlacement({
  anchorRect,
  popoverHeight,
  viewportHeight,
  viewportWidth,
  coordinateScale = 1
}: {
  anchorRect: PopoverAnchorRect
  popoverHeight: number
  viewportHeight: number
  viewportWidth: number
  coordinateScale?: number
}): TodoProgressPopoverPlacement {
  const scale = Number.isFinite(coordinateScale) && coordinateScale > 0 ? coordinateScale : 1
  const normalizedAnchorRect = {
    bottom: anchorRect.bottom / scale,
    left: anchorRect.left / scale,
    right: anchorRect.right / scale,
    top: anchorRect.top / scale
  }
  const normalizedViewportHeight = viewportHeight / scale
  const normalizedViewportWidth = viewportWidth / scale
  const width = Math.min(
    TODO_POPOVER_WIDTH,
    Math.max(1, normalizedViewportWidth - TODO_POPOVER_MARGIN * 2)
  )
  const anchorCenter = (normalizedAnchorRect.left + normalizedAnchorRect.right) / 2
  const left = clamp(
    anchorCenter - width / 2,
    TODO_POPOVER_MARGIN,
    Math.max(TODO_POPOVER_MARGIN, normalizedViewportWidth - TODO_POPOVER_MARGIN - width)
  )
  const contentHeight = Math.max(1, popoverHeight)
  const targetHeight = Math.min(contentHeight, TODO_POPOVER_MAX_HEIGHT)
  const spaceAbove = Math.max(
    1,
    normalizedAnchorRect.top - TODO_POPOVER_MARGIN - TODO_POPOVER_GAP
  )
  const spaceBelow = Math.max(
    1,
    normalizedViewportHeight - normalizedAnchorRect.bottom - TODO_POPOVER_MARGIN - TODO_POPOVER_GAP
  )
  const openAbove = spaceAbove >= targetHeight || spaceAbove >= spaceBelow
  const availableHeight = openAbove ? spaceAbove : spaceBelow
  const maxHeight = Math.min(TODO_POPOVER_MAX_HEIGHT, availableHeight)
  const visibleHeight = Math.min(contentHeight, maxHeight)
  const preferredTop = openAbove
    ? normalizedAnchorRect.top - TODO_POPOVER_GAP - visibleHeight
    : normalizedAnchorRect.bottom + TODO_POPOVER_GAP
  const top = clamp(
    preferredTop,
    TODO_POPOVER_MARGIN,
    Math.max(TODO_POPOVER_MARGIN, normalizedViewportHeight - TODO_POPOVER_MARGIN - visibleHeight)
  )

  return { left, top, width, maxHeight }
}

export function FloatingComposerTodoProgress({
  todos
}: {
  todos: ThreadTodoList
}): ReactElement | null {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<TodoProgressPopoverPlacement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const hoverCloseTimerRef = useRef<number | null>(null)
  const progress = getTodoProgress(todos.items)
  const estimatedPopoverHeight = Math.min(
    TODO_POPOVER_MAX_HEIGHT,
    TODO_POPOVER_CHROME_HEIGHT + todos.items.length * TODO_ROW_ESTIMATED_HEIGHT
  )

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      setPlacement(null)
      return
    }
    const updatePlacement = (): void => {
      const button = buttonRef.current
      if (!button) return
      setPlacement(calculateTodoProgressPopoverPlacement({
        anchorRect: button.getBoundingClientRect(),
        popoverHeight: popoverRef.current?.offsetHeight ?? estimatedPopoverHeight,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        coordinateScale: currentBodyZoom()
      }))
    }
    updatePlacement()
    const frame = window.requestAnimationFrame(updatePlacement)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [estimatedPopoverHeight, open, todos.updatedAt])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => () => {
    if (hoverCloseTimerRef.current != null && typeof window !== 'undefined') {
      window.clearTimeout(hoverCloseTimerRef.current)
    }
  }, [])

  if (todos.items.length === 0) return null

  const cancelClose = (): void => {
    if (hoverCloseTimerRef.current == null || typeof window === 'undefined') return
    window.clearTimeout(hoverCloseTimerRef.current)
    hoverCloseTimerRef.current = null
  }
  const openDetails = (): void => {
    cancelClose()
    setOpen(true)
  }
  const closeDetailsSoon = (): void => {
    cancelClose()
    if (typeof window === 'undefined') {
      setOpen(false)
      return
    }
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null
      setOpen(false)
    }, 140)
  }
  const popoverStyle: CSSProperties = placement
    ? {
        left: `${placement.left}px`,
        top: `${placement.top}px`,
        width: `${placement.width}px`,
        maxHeight: `${placement.maxHeight}px`
      }
    : {
        left: 0,
        top: 0,
        width: `${TODO_POPOVER_WIDTH}px`,
        maxHeight: `${TODO_POPOVER_MAX_HEIGHT}px`,
        visibility: 'hidden'
      }
  const progressLabel = t('todoProgressStep', {
    current: progress.current,
    total: progress.total
  })

  return (
    <>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={t('todoProgressDetails')}
              className="ds-no-drag fixed z-[1000] overflow-y-auto rounded-[22px] border border-ds-border bg-white/98 p-2.5 text-ds-ink shadow-[0_18px_48px_rgba(20,47,95,0.16)] backdrop-blur-xl dark:bg-ds-card/98"
              style={popoverStyle}
              data-todo-progress-popover
              onMouseEnter={cancelClose}
              onMouseLeave={closeDetailsSoon}
            >
              <ol className="space-y-0.5">
                {todos.items.map((item) => (
                  <TodoDetailRow key={item.id} item={item} />
                ))}
              </ol>
            </div>,
            document.body
          )
        : null}
      <div ref={rootRef} className="pointer-events-auto relative shrink-0">
        <button
          ref={buttonRef}
          type="button"
          onClick={openDetails}
          onFocus={openDetails}
          onBlur={closeDetailsSoon}
          onMouseEnter={openDetails}
          onMouseLeave={closeDetailsSoon}
          className="ds-no-drag inline-flex h-11 items-center gap-2.5 rounded-full border border-ds-border bg-white/96 px-4 text-[14px] font-medium text-ds-muted shadow-[0_10px_30px_rgba(20,47,95,0.10)] backdrop-blur-xl transition hover:border-ds-border-strong hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 dark:bg-ds-card/96"
          aria-label={t('todoProgressAria', {
            current: progress.current,
            total: progress.total
          })}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          {progress.allComplete ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" strokeWidth={1.9} />
          ) : (
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-accent/25"
              aria-hidden="true"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
          )}
          <span>{progressLabel}</span>
        </button>
      </div>
    </>
  )
}

function TodoDetailRow({ item }: { item: ThreadTodoItem }): ReactElement {
  const { t } = useTranslation('common')
  const completed = item.status === 'completed'
  const active = item.status === 'in_progress'

  return (
    <li
      className={`flex min-w-0 items-start gap-3 rounded-xl px-2.5 py-2 ${
        active ? 'bg-accent/[0.06]' : ''
      }`}
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
        {completed ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600" strokeWidth={1.9} />
        ) : active ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
        ) : (
          <Circle className="h-5 w-5 text-ds-muted" strokeWidth={1.8} />
        )}
      </span>
      <span
        className={`min-w-0 flex-1 break-words text-[14px] leading-[1.375rem] [overflow-wrap:anywhere] ${
          completed ? 'text-ds-faint line-through decoration-ds-faint/50' : 'text-ds-muted'
        }`}
      >
        <span className="sr-only">{t(`todoStatus.${item.status}`)}: </span>
        {item.content}
      </span>
    </li>
  )
}
